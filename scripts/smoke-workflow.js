// Onay → Kurye Bekleniyor → Kargoda iş akışını uçtan uca doğrular.
// 1) Ödenmiş sipariş "Onay Bekliyor" olarak listelenir.
// 2) POST /approve onaylar ve Aras'a gerçekten gönderir (FZ-<id> oluşur).
// 3) /status hemen irsaliye bekler (transitioned:false).
// 4) geriBildirimIsle sahte cargo ile çağrılınca kargoda geçişi + e-posta tetiklenir.
// 5) Temizlik: Aras kaydı iptal edilir, sahte satır silinir.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');
const { encryptData } = require('../src/lib/crypto');
const shipmentsRouter = require('../src/routes/shipments');

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

(async () => {
    const login = await req('POST', '/api/admin/login', { password: process.env.ADMIN_PASSWORD });
    dogrula('admin girişi', login.data && login.data.success !== false);

    const info = await run(
        `INSERT INTO orders (merchant_oid, user_id, email, first_name, last_name, city, district, street, zipcode, phone, total_amount, payment_status, approval_state)
         VALUES ('WORKFLOW-TEST-DO-NOT-KEEP', NULL, ?, ?, ?, ?, ?, ?, ?, ?, 250, 1, 0)`,
        [encryptData('workflow-test@feyzay.com'), encryptData('Test'), encryptData('Alıcı'),
         encryptData('İstanbul'), encryptData('Kadıköy'), encryptData('Test adresi 1'),
         encryptData('34000'), encryptData('05555555555')]
    );
    const id = info.lastID;
    console.log('geçici sipariş id =', id);

    try {
        // 1) Liste: approvalState=0 olmalı
        let list = await req('GET', '/api/admin/shipments');
        let kayit = (list.data.shipments || []).find(s => s.id === id);
        dogrula('liste: approvalState=0 (Onay Bekliyor)', kayit && kayit.approvalState === 0 && kayit.cargoState === 0 && !kayit.cancelReason);

        // 2) Onay + Aras'a gönderim (gerçek servis çağrısı)
        const onay = await req('POST', `/api/admin/shipments/${id}/approve`);
        console.log('approve yanıtı:', onay.status, JSON.stringify(onay.data));
        dogrula('approve başarılı', onay.data && onay.data.success === true);
        await bekle(3000); // sunucudaki asenkron UPDATE işlensin

        let row = await get(`SELECT approval_state, cargo_state, aras_waybill, aras_error, cancel_reason FROM orders WHERE id = ?`, [id]);
        console.log('DB onay sonrası:', JSON.stringify(row));
        dogrula('DB: approval_state=1', row.approval_state === 1);
        dogrula('DB: cargo_state hâlâ 0 (geri bildirim bekleniyor)', row.cargo_state === 0);
        dogrula('DB: aras_waybill yazıldı (FZ-<id>)', row.aras_waybill === `FZ-${id}`);

        // 3) Hemen durum sorgusu: irsaliye kesilmediği için transitioned=false
        const durum = await req('POST', `/api/admin/shipments/${id}/status`);
        console.log('status yanıtı:', durum.status, 'transitioned =', durum.data && durum.data.transitioned, '| setOrder.sent =', durum.data && durum.data.setOrder && durum.data.setOrder.sent);
        dogrula('status: success', durum.data && durum.data.success === true);
        dogrula('status: Aras kaydı mevcut (sent)', durum.data && durum.data.setOrder && durum.data.setOrder.sent === true);
        dogrula('status: henüz geri bildirim yok (transitioned=false)', durum.data && durum.data.transitioned === false);
        await bekle(3000);

        // 4) Geri bildirim simülasyonu: sahte cargo ile geçiş fonksiyonu doğrudan çağrılır
        const sahteCargo = { 'KARGO TAKIP NO': 'TESTTRACK123', 'DURUM KODU': '7', 'DURUMU': 'Şubeden Çıktı / Yola Çıktı' };
        const gecis = await shipmentsRouter.geriBildirimIsle({ id, cargo_state: 0, cancel_reason: null, email: encryptData('workflow-test@feyzay.com'), first_name: encryptData('Test') }, sahteCargo);
        console.log('geriBildirimIsle:', JSON.stringify({ transitioned: gecis.transitioned }));
        dogrula('geçiş: transitioned=true', gecis.transitioned === true);
        await bekle(3000);

        row = await get(`SELECT cargo_state, cargo_tracking_code FROM orders WHERE id = ?`, [id]);
        console.log('DB geçiş sonrası:', JSON.stringify(row));
        dogrula('DB: cargo_state=1 (Kargoda)', row.cargo_state === 1);
        dogrula('DB: takip numarası yazıldı', row.cargo_tracking_code === 'TESTTRACK123');

        // Geçiş bir kez olur: ikinci çağrı transitioned=false dönmeli
        const tekrar = await shipmentsRouter.geriBildirimIsle({ id, cargo_state: 1, cancel_reason: null, email: encryptData('workflow-test@feyzay.com'), first_name: encryptData('Test') }, sahteCargo);
        dogrula('geçiş idempotent (ikinci çağrı transitioned=false)', tekrar.transitioned === false);

        // 5) Temizlik: Aras kaydını iptal et + sahte satırı sil
        const iptal = await req('POST', `/api/admin/shipments/${id}/cancel`, { reason: 'Test temizliği' });
        console.log('temizlik iptali:', iptal.status, JSON.stringify(iptal.data));
    } finally {
        await run(`DELETE FROM orders WHERE id = ?`, [id]);
        const kalan = await get(`SELECT COUNT(*) AS n FROM orders WHERE merchant_oid = 'WORKFLOW-TEST-DO-NOT-KEEP'`);
        console.log('kalan sahte satır =', kalan.n);
        db.close();
    }

    console.log(hata === 0 ? '\nTÜM TESTLER GEÇTİ' : `\n${hata} TEST BAŞARISIZ`);
    process.exit(hata === 0 ? 0 : 1);
})().catch(e => { console.error('TEST HATASI:', e.message); process.exit(1); });
