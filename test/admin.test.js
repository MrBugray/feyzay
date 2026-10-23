// Entegrasyon: admin girişi, kullanıcı listesi/düzenleme/silme ve mail ucu.
// Siparişler yalnızca geçici DB'de; silinen kullanıcının siparişleri korunur.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { testOrtamiKur, uygulamaBaslat, istemci, dbGet, kullaniciEkle, siparisEkle, temizle } = require('./helpers/bootstrap');

const ortam = testOrtamiKur();
let server, admin, uid, orderId;

before(async () => {
    const u = await uygulamaBaslat();
    server = u.server;
    admin = istemci(u.base);
    uid = await kullaniciEkle('musteri@example.com', 'Mehmet');
    orderId = await siparisEkle(uid, 'TEST-ADMIN-1');
});

after(async () => temizle(server, ortam.tmpDir));

test('admin uçları oturumsuz 401 döner', async () => {
    const r = await admin.req('GET', '/api/admin/users');
    assert.equal(r.status, 401);
    const r2 = await admin.req('DELETE', `/api/admin/users/${uid}`);
    assert.equal(r2.status, 401);
});

test('admin login: yanlış şifre 401, doğru şifre başarılı', async () => {
    const yanlis = await admin.req('POST', '/api/admin/login', { password: 'yanlis' });
    assert.equal(yanlis.status, 401);
    const dogru = await admin.req('POST', '/api/admin/login', { password: 'test-admin-sifresi' });
    assert.equal(dogru.data.success, true);
});

test('users listesi: alanlar ve sipariş sayısı', async () => {
    const r = await admin.req('GET', '/api/admin/users');
    assert.equal(r.data.success, true);
    const u = r.data.users.find(x => x.id === uid);
    assert.equal(u.email, 'musteri@example.com');
    assert.equal(u.firstName, 'Mehmet');
    assert.equal(u.isVerified, 1);
    assert.equal(u.orderCount, 1);
    assert.equal(u.city, 'Sakarya'); // çözülmüş adres
});

test('users/:id/orders: sipariş ve kalemler çözülmüş döner', async () => {
    const r = await admin.req('GET', `/api/admin/users/${uid}/orders`);
    assert.equal(r.data.orders.length, 1);
    const o = r.data.orders[0];
    assert.equal(o.id, orderId);
    assert.equal(o.city, 'Sakarya');
    assert.equal(o.cartData[0].id, 'TESBONE02');
    assert.equal(o.cartData[0].adet, 2);
    assert.equal(o.cancelReason, null);
});

test('users/:id/mail: doğrulama ve sahte transport ile gönderim', async () => {
    const bos = await admin.req('POST', `/api/admin/users/${uid}/mail`, { subject: '', message: 'x' });
    assert.equal(bos.status, 400);

    const r = await admin.req('POST', `/api/admin/users/${uid}/mail`, { subject: 'Test Konusu', message: 'Merhaba <b>test</b>' });
    assert.equal(r.data.success, true);
    const mail = ortam.mailler.find(m => m.subject === 'Test Konusu');
    assert.equal(mail.to, 'musteri@example.com');
    assert.ok(mail.html.includes('&lt;b&gt;test&lt;/b&gt;')); // HTML kaçışlı

    const yok = await admin.req('POST', '/api/admin/users/99999/mail', { subject: 'x', message: 'y' });
    assert.equal(yok.status, 404);
});

test('kullanıcı düzenleme: alan güncelleme, zayıf şifre, 404', async () => {
    const r = await admin.req('PUT', `/api/admin/users/${uid}`, { firstName: 'YeniAd', city: 'İstanbul', marketingConsent: true });
    assert.equal(r.data.success, true);
    const u = (await admin.req('GET', '/api/admin/users')).data.users.find(x => x.id === uid);
    assert.equal(u.firstName, 'YeniAd');
    assert.equal(u.city, 'İstanbul');
    assert.equal(u.marketingConsent, 1);

    const zayif = await admin.req('PUT', `/api/admin/users/${uid}`, { password: 'kisa' });
    assert.equal(zayif.status, 400);
    const yok = await admin.req('PUT', '/api/admin/users/99999', { firstName: 'X' });
    assert.equal(yok.status, 404);
});

test('e-posta çakışması 400 döner', async () => {
    await kullaniciEkle('baska@example.com');
    const r = await admin.req('PUT', `/api/admin/users/${uid}`, { email: 'baska@example.com' });
    assert.equal(r.status, 400);
    assert.equal(r.data.message, 'Bu E-posta zaten kayıtlı.');
});

test('kullanıcı silme: sipariş korunur, user_id NULL olur', async () => {
    const r = await admin.req('DELETE', `/api/admin/users/${uid}`);
    assert.equal(r.data.success, true);
    assert.equal(await dbGet(`SELECT id FROM users WHERE id = ?`, [uid]), undefined);

    const o = await dbGet(`SELECT id, user_id FROM orders WHERE id = ?`, [orderId]);
    assert.equal(o.id, orderId); // sipariş silinmedi
    assert.equal(o.user_id, null); // ON DELETE SET NULL

    const tekrar = await admin.req('DELETE', `/api/admin/users/${uid}`);
    assert.equal(tekrar.status, 404);
});
