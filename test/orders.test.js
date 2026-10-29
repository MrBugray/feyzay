// Entegrasyon: PayTR bildirimi (geçerli HMAC) → yönetici bildirim maili,
// mükerrer bildirimde tekrar mail yok; kullanıcı iptali ve sahiplik kuralları.
// PayTR/Aras'a gerçek istek yok: HMAC yerel üretilir, Aras servisi sahtedir.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { testOrtamiKur, uygulamaBaslat, istemci, dbGet, kullaniciEkle, siparisEkle, temizle, paytrHash } = require('./helpers/bootstrap');

const ortam = testOrtamiKur();
let base, server, ali, veli, aliId, veliId, paidOrderId;

before(async () => {
    const u = await uygulamaBaslat();
    base = u.base;
    server = u.server;
    ali = istemci(base);
    veli = istemci(base);
    aliId = await kullaniciEkle('ali@example.com', 'Ali');
    veliId = await kullaniciEkle('veli@example.com', 'Veli');
    assert.equal((await ali.req('POST', '/api/login', { email: 'ali@example.com', password: 'Test1234' })).data.success, true);
    assert.equal((await veli.req('POST', '/api/login', { email: 'veli@example.com', password: 'Test1234' })).data.success, true);
});

after(async () => temizle(server, ortam.tmpDir));

async function paytrBildirimi(merchantOid, totalAmount = '159800') {
    const hash = paytrHash(merchantOid, 'success', totalAmount);
    const res = await fetch(base + '/api/paytr-callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ merchant_oid: merchantOid, status: 'success', total_amount: totalAmount, hash }).toString()
    });
    return res.text();
}

test('paytr-callback: geçersiz HMAC siparişi güncellemez', async () => {
    await siparisEkle(aliId, 'TEST-HMAC-1', { odendi: 0 });
    const res = await fetch(base + '/api/paytr-callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'merchant_oid=TEST-HMAC-1&status=success&total_amount=159800&hash=bozuk'
    });
    await res.text();
    assert.equal((await dbGet(`SELECT payment_status p FROM orders WHERE merchant_oid = 'TEST-HMAC-1'`)).p, 0);
});

test('paytr-callback: ödeme işlenir, yönetici ve müşteri mailleri yakalanır', async () => {
    paidOrderId = await siparisEkle(aliId, 'TEST-MAIL-1', { odendi: 0 });
    assert.equal(await paytrBildirimi('TEST-MAIL-1'), 'OK');

    // Yanıt, DB yazımı tamamlanmadan döner; ödeme durumunu kısa süre yokla.
    let odeme = 0;
    for (let i = 0; i < 40 && odeme !== 1; i++) {
        await new Promise(r => setTimeout(r, 100));
        odeme = (await dbGet(`SELECT payment_status p FROM orders WHERE id = ?`, [paidOrderId])).p;
    }
    assert.equal(odeme, 1);

    let adminMail;
    for (let i = 0; i < 40 && !adminMail; i++) {
        await new Promise(r => setTimeout(r, 100));
        adminMail = ortam.mailler.find(m => m.to === 'feyza.uner@hotmail.com');
    }
    assert.ok(adminMail, 'yönetici bildirimi yakalanmalı');
    assert.equal(adminMail.subject, `Yeni Sipariş (#${paidOrderId}) - Feyzay`);
    for (const parca of ['Test Kullanici', 'test@example.com', '5551234567', 'Atatürk Mah.', 'Vatan Caddesi', 'No:12 D:4',
        'Arifiye / Sakarya', '54580', 'TESBONE02', 'Tesettür Bone', 'Siyah', 'Standart', '1598.00 TL', 'Ödendi']) {
        assert.ok(adminMail.html.includes(parca), 'mail içeriği eksik: ' + parca);
    }
    assert.ok(ortam.mailler.some(m => m.subject === `Siparişiniz Alındı (#${paidOrderId}) - Feyzay`), 'müşteri onay maili');
});

test('paytr-callback: mükerrer bildirimde mail tekrar gönderilmez', async () => {
    const once = ortam.mailler.length;
    assert.equal(await paytrBildirimi('TEST-MAIL-1'), 'OK');
    await new Promise(r => setTimeout(r, 200));
    assert.equal(ortam.mailler.length, once);
});

test('kullanıcı iptali: başkasının siparişi ve oturumsuz istek reddedilir', async () => {
    const r = await veli.req('POST', `/api/user/orders/${paidOrderId}/cancel`, { reason: 'x' });
    assert.equal(r.status, 404);

    const anonim = istemci(base);
    const r2 = await anonim.req('POST', `/api/user/orders/${paidOrderId}/cancel`, {});
    assert.equal(r2.status, 401);
});

test('kullanıcı iptali: Onay Bekliyor iptal edilir, ikinci iptal 409', async () => {
    const r = await ali.req('POST', `/api/user/orders/${paidOrderId}/cancel`, { reason: 'Yanlış sipariş' });
    assert.equal(r.data.success, true);
    const o = await dbGet(`SELECT cancel_reason, cargo_state, approval_state FROM orders WHERE id = ?`, [paidOrderId]);
    assert.equal(o.cancel_reason, 'Yanlış sipariş');
    assert.equal(o.cargo_state, 0);
    assert.equal(o.approval_state, 0);

    const tekrar = await ali.req('POST', `/api/user/orders/${paidOrderId}/cancel`, {});
    assert.equal(tekrar.status, 409);
});

test('kullanıcı iptali: Hazırlanıyor iptalinde Aras sahte çağrıya gider (ağ yok)', async () => {
    const id = await siparisEkle(aliId, 'TEST-CANCEL-2', { approvalState: 1 });
    const r = await ali.req('POST', `/api/user/orders/${id}/cancel`, {});
    assert.equal(r.data.success, true);
    assert.equal(r.data.arasWarning, null);
    assert.ok(ortam.arasCagrilar.some(c => c.ad === 'cancelDispatch' && c.args[0] === 'FZ-' + id));
    assert.equal((await dbGet(`SELECT cancel_reason c FROM orders WHERE id = ?`, [id])).c, 'Müşteri kendi talebiyle siparişi iptal etti.');
});

test('kullanıcı iptali: Kargoda sipariş reddedilir ve kaydı değişmez', async () => {
    const id = await siparisEkle(aliId, 'TEST-CANCEL-3', { cargoState: 1, approvalState: 1, arasWaybill: 'FZ-X' });
    const r = await ali.req('POST', `/api/user/orders/${id}/cancel`, { reason: 'x' });
    assert.equal(r.status, 409);
    const o = await dbGet(`SELECT cancel_reason, cargo_state FROM orders WHERE id = ?`, [id]);
    assert.equal(o.cancel_reason, null);
    assert.equal(o.cargo_state, 1);
});

test('kullanıcı iptali: ödenmemiş sipariş iptal edilemez', async () => {
    const id = await siparisEkle(aliId, 'TEST-CANCEL-4', { odendi: 0 });
    const r = await ali.req('POST', `/api/user/orders/${id}/cancel`, {});
    assert.equal(r.status, 404);
});
