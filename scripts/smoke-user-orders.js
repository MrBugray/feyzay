// Müşteri "Siparişlerim" akışının yeni aşama etiketlerini doğrular:
// /api/user/orders yanıtında approvalState gelmeli; aşamalar
// approvalState=0 → Onay Bekliyor, =1+cargoState=0 → Hazırlanıyor, cargoState=1 → Kargoda.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');
const { encryptData, hashPassword } = require('../src/lib/crypto');

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
const ENC = (s) => encryptData(s);
let hata = 0;
function dogrula(ad, kosul) {
    console.log(`${kosul ? 'PASS' : 'FAIL'} - ${ad}`);
    if (!kosul) hata++;
}

(async () => {
    // Geçici kullanıcı
    const u = await run(
        `INSERT INTO users (email, password, first_name, last_name, city, district, street, zipcode, is_verified)
         VALUES ('siparislerim-test@feyzay.com', ?, 'Test', 'Musteri', 'x','x','x','x', 1)`,
        [hashPassword('test-sifre-123')]
    );
    const userId = u.lastID;

    // Aynı kullanıcıya ait 3 aşamada geçici sipariş
    const ortak = ['ORDERS-UI-TEST-DO-NOT-KEEP', userId, ENC('siparislerim-test@feyzay.com'), ENC('Test'), ENC('Musteri'),
        ENC('İstanbul'), ENC('Kadıköy'), ENC('Adres 1'), ENC('34000'), ENC('05555555555'), 100];
    const o1 = await run(
        `INSERT INTO orders (merchant_oid, user_id, email, first_name, last_name, city, district, street, zipcode, phone, total_amount, payment_status, approval_state, cargo_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0)`, ortak);
    const o2 = await run(
        `INSERT INTO orders (merchant_oid, user_id, email, first_name, last_name, city, district, street, zipcode, phone, total_amount, payment_status, approval_state, cargo_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 0)`, ortak);
    const o3 = await run(
        `INSERT INTO orders (merchant_oid, user_id, email, first_name, last_name, city, district, street, zipcode, phone, total_amount, payment_status, approval_state, cargo_state, cargo_tracking_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 'TRACK-UI-TEST')`, ortak);
    console.log('siparişler:', o1.lastID, o2.lastID, o3.lastID);

    try {
        const login = await req('POST', '/api/login', { email: 'siparislerim-test@feyzay.com', password: 'test-sifre-123' });
        dogrula('kullanıcı girişi', login.data && login.data.success === true);

        const r = await req('POST', '/api/user/orders');
        dogrula('sipariş listesi 200', r.status === 200 && r.data && r.data.success === true);
        const bul = (id) => (r.data.orders || []).find(o => o.id === id);

        const s1 = bul(o1.lastID), s2 = bul(o2.lastID), s3 = bul(o3.lastID);
        dogrula('3 sipariş de listeleniyor', Boolean(s1 && s2 && s3));
        dogrula('aşama 1: approvalState=0 (Onay Bekliyor)', s1 && s1.approvalState === 0 && s1.cargoState === 0);
        dogrula('aşama 2: approvalState=1, cargoState=0 (Hazırlanıyor)', s2 && s2.approvalState === 1 && s2.cargoState === 0);
        dogrula('aşama 3: cargoState=1 (Kargoda)', s3 && s3.cargoState === 1);
        dogrula('aşama 3: takip kodu iletiliyor', s3 && s3.cargoTrackingCode === 'TRACK-UI-TEST');
    } finally {
        await run(`DELETE FROM order_items WHERE order_id IN (?, ?, ?)`, [o1.lastID, o2.lastID, o3.lastID]);
        await run(`DELETE FROM orders WHERE merchant_oid = 'ORDERS-UI-TEST-DO-NOT-KEEP'`);
        await run(`DELETE FROM users WHERE id = ?`, [userId]);
        const kalan = await get(`SELECT COUNT(*) AS n FROM orders WHERE merchant_oid = 'ORDERS-UI-TEST-DO-NOT-KEEP'`);
        console.log('kalan sahte sipariş =', kalan.n);
        db.close();
    }

    console.log(hata === 0 ? '\nTÜM TESTLER GEÇTİ' : `\n${hata} TEST BAŞARISIZ`);
    process.exit(hata === 0 ? 0 : 1);
})().catch(e => { console.error('TEST HATASI:', e.message); process.exit(1); });
