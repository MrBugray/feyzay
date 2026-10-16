// İptali HER aşamada doğrular:
// A) "Onay Bekliyor": Aras çağrısı olmadan yerel iptal + müşteri e-postası; Aras'ta kayıt oluşmamalı.
// B) "Kurye Bekleniyor": onaylanıp Aras'a gönderildikten sonra iptal (CancelDispatch canlı çağrılır).
// C) "Kargoda": geri bildirim sonrası iptal; yerel kayıt temizlenir, müşteri e-postası gider.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');
const { encryptData } = require('../src/lib/crypto');
const shipmentsRouter = require('../src/routes/shipments');
const { getOrderWithIntegrationCode } = require('../src/services/arasKargo');

const B = 'http://localhost:3999';
let cookie = '';
async function req(method, path, body) {
    const res = await fetch(B + path, {
        method,
        headers: { 'Content-Type': 'application/json', cookie },
        body: body ? JSON.stringify(body) : undefined
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    let data = null;
    try { data = await res.json(); } catch (e) { }
    return { status: res.status, data };
}
function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
    });
}
function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    });
}
const bekle = (ms) => new Promise(r => setTimeout(r, ms));
let hata = 0;
function dogrula(ad, kosul) {
    console.log(`${kosul ? 'PASS' : 'FAIL'} - ${ad}`);
    if (!kosul) hata++;
}
const ENC = (s) => encryptData(s);

async function yeniSiparis() {
    const info = await run(
        `INSERT INTO orders (merchant_oid, user_id, email, first_name, last_name, city, district, street, zipcode, phone, total_amount, payment_status, approval_state)
         VALUES ('CANCEL-STAGE-TEST-DO-NOT-KEEP', NULL, ?, ?, ?, ?, ?, ?, ?, ?, 150, 1, 0)`,
        [ENC('cancel-stage-test@feyzay.com'), ENC('Test'), ENC('Alıcı'),
         ENC('İstanbul'), ENC('Kadıköy'), ENC('Test adresi 1'), ENC('34000'), ENC('05555555555')]
    );
    return info.lastID;
}

(async () => {
    const login = await req('POST', '/api/admin/login', { password: process.env.ADMIN_PASSWORD });
    dogrula('admin girişi', login.data && login.data.success !== false);

    // ---- A) Onay Bekliyor aşamasında iptal ----
    const a = await yeniSiparis();
    console.log('\n[A] Onay Bekliyor aşaması, sipariş id =', a);
    try {
        const bos = await req('POST', `/api/admin/shipments/${a}/cancel`, {});
        dogrula('boş neden reddediliyor (400)', bos.status === 400);

        const arasOnceki = await getOrderWithIntegrationCode(`FZ-${a}`);
        console.log('iptal öncesi Aras durumu:', JSON.stringify({ sent: arasOnceki.sent, cancelled: arasOnceki.cancelled }));
        const r = await req('POST', `/api/admin/shipments/${a}/cancel`, { reason: 'Müşteri talebiyle iptal' });
        console.log('iptal yanıtı:', r.status, JSON.stringify(r.data));
        dogrula('iptal başarılı', r.data && r.data.success === true);
        dogrula('Aras warning yok (hiç gönderilmedi)', r.data && r.data.arasWarning === null);
        await bekle(3000);
        let row = await get(`SELECT cancel_reason, cargo_state, aras_waybill FROM orders WHERE id = ?`, [a]);
        dogrula('DB: neden yazıldı', row.cancel_reason === 'Müşteri talebiyle iptal');
        dogrula('DB: kargo alanları temiz', row.cargo_state === 0 && row.aras_waybill === null);
        // id'ler silinip yeniden kullanılabildiği için Aras'ta aynı koddan eski kayıt kalabilir;
        // önemli olan bu aşamada Aras tarafının DEĞİŞMEMESİ (hiçbir çağrı yapılmamalı).
        const arasSonraki = await getOrderWithIntegrationCode(`FZ-${a}`);
        dogrula('Aras kaydı değişmedi (çağrı yapılmadı)',
            arasSonraki.sent === arasOnceki.sent &&
            arasSonraki.cancelled === arasOnceki.cancelled &&
            arasSonraki.raw === arasOnceki.raw);
        const yine = await req('POST', `/api/admin/shipments/${a}/cancel`, { reason: 'tekrar' });
        dogrula('zaten iptal edilmişse 409', yine.status === 409);
    } finally {
        await run(`DELETE FROM orders WHERE id = ?`, [a]);
    }

    // ---- B) Kurye Bekleniyor aşamasında iptal ----
    const b = await yeniSiparis();
    console.log('\n[B] Kurye Bekleniyor aşaması, sipariş id =', b);
    try {
        const onay = await req('POST', `/api/admin/shipments/${b}/approve`);
        dogrula('onay + Aras gönderimi başarılı', onay.data && onay.data.success === true);
        await bekle(3000);
        const r = await req('POST', `/api/admin/shipments/${b}/cancel`, { reason: 'Test: kurye aşaması iptali' });
        console.log('iptal yanıtı:', r.status, JSON.stringify(r.data));
        dogrula('iptal başarılı', r.data && r.data.success === true);
        await bekle(3000);
        const row = await get(`SELECT cancel_reason, approval_state, cargo_state, aras_waybill FROM orders WHERE id = ?`, [b]);
        dogrula('DB: neden yazıldı', row.cancel_reason === 'Test: kurye aşaması iptali');
        dogrula('DB: tüm kargo alanları sıfırlandı', row.approval_state === 0 && row.cargo_state === 0 && row.aras_waybill === null);
    } finally {
        await run(`DELETE FROM orders WHERE id = ?`, [b]);
    }

    // ---- C) Kargoda aşamasında iptal ----
    const c = await yeniSiparis();
    console.log('\n[C] Kargoda aşaması, sipariş id =', c);
    try {
        const onay = await req('POST', `/api/admin/shipments/${c}/approve`);
        dogrula('onay + Aras gönderimi başarılı', onay.data && onay.data.success === true);
        await bekle(3000);
        const gecis = await shipmentsRouter.geriBildirimIsle(
            { id: c, cargo_state: 0, cancel_reason: null, email: ENC('cancel-stage-test@feyzay.com'), first_name: ENC('Test') },
            { 'KARGO TAKIP NO': 'TRACK-CANCEL-TEST', 'DURUM KODU': '7' });
        dogrula('kargoda geçişi yapıldı', gecis.transitioned === true);
        await bekle(3000);

        const r = await req('POST', `/api/admin/shipments/${c}/cancel`, { reason: 'Test: kargoda aşaması iptali' });
        console.log('iptal yanıtı:', r.status, JSON.stringify(r.data));
        dogrula('iptal başarılı (her aşamada)', r.data && r.data.success === true);
        await bekle(3000);
        const row = await get(`SELECT cancel_reason, cargo_state, cargo_tracking_code FROM orders WHERE id = ?`, [c]);
        dogrula('DB: neden yazıldı', row.cancel_reason === 'Test: kargoda aşaması iptali');
        dogrula('DB: takip no temizlendi', row.cargo_tracking_code === null && row.cargo_state === 0);
    } finally {
        await run(`DELETE FROM orders WHERE id = ?`, [c]);
    }

    const kalan = await get(`SELECT COUNT(*) AS n FROM orders WHERE merchant_oid = 'CANCEL-STAGE-TEST-DO-NOT-KEEP'`);
    console.log('\nkalan sahte satır =', kalan.n);
    dogrula('tüm sahte satırlar silindi', kalan.n === 0);
    db.close();

    console.log(hata === 0 ? '\nTÜM TESTLER GEÇTİ' : `\n${hata} TEST BAŞARISIZ`);
    process.exit(hata === 0 ? 0 : 1);
})().catch(e => { console.error('TEST HATASI:', e.message); process.exit(1); });
