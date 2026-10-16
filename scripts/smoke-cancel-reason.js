// İptal sonrası DB yazımını gecikmeli okuyarak doğrular (çapraz işlem yarışını önler).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');
const { encryptData } = require('../src/lib/crypto');

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

(async () => {
    await req('POST', '/api/admin/login', { password: process.env.ADMIN_PASSWORD });

    const info = await run(
        `INSERT INTO orders (merchant_oid, user_id, email, first_name, last_name, city, district, street, zipcode, phone, total_amount, payment_status)
         VALUES ('REASON-TEST-DO-NOT-KEEP', NULL, ?, ?, ?, ?, ?, ?, ?, ?, 100, 1)`,
        [encryptData('cancel-test@feyzay.com'), encryptData('Test'), encryptData('Alıcı'),
         encryptData('İstanbul'), encryptData('Kadıköy'), encryptData('Test adresi 1'),
         encryptData('34000'), encryptData('05555555555')]
    );
    const id = info.lastID;
    console.log('geçici sipariş id =', id);

    try {
        await req('POST', `/api/admin/shipments/${id}/send`);
        await bekle(8000); // Aras yansıması + DB yazımı için bekle

        const r = await req('POST', `/api/admin/shipments/${id}/cancel`, { reason: 'Test: stok yetersizliği' });
        console.log('iptal yanıtı:', r.status, JSON.stringify(r.data));

        await bekle(3000); // sunucudaki asenkron UPDATE'in işlenmesini bekle
        const row = await get(`SELECT cargo_state, cargo_tracking_code, cancel_reason FROM orders WHERE id = ?`, [id]);
        console.log('DB (gecikmeli): cargo_state =', row.cargo_state, '| takip =', row.cargo_tracking_code, '| neden =', row.cancel_reason);

        // Temizlik: tekrar gönder + tekrar iptal (Aras kaydını kapalı bırak)
        await req('POST', `/api/admin/shipments/${id}/send`);
        await bekle(6000);
        await req('POST', `/api/admin/shipments/${id}/cancel`, { reason: 'Test temizliği' });
        console.log('temizlik iptali gönderildi');
    } finally {
        await run(`DELETE FROM orders WHERE id = ?`, [id]);
        const kalan = await get(`SELECT COUNT(*) AS n FROM orders WHERE merchant_oid = 'REASON-TEST-DO-NOT-KEEP'`);
        console.log('kalan sahte satır =', kalan.n);
        db.close();
    }
})().catch(e => { console.error('TEST HATASI:', e.message); process.exit(1); });
