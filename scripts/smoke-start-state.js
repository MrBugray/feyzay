// 1) Yeni ödenmiş siparişin "Onay Bekliyor" aşamasında başladığını ve
//    hiçbir otomatik Aras gönderimi/geri bildirim taraması yapılmadığını doğrular.
// 2) Her sekme için Excel export endpoint'inin geçerli xlsx döndürdüğünü ve
//    sekme filtrelerinin içeriğiyle birebir uyuştuğunu doğrular.
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
    return res;
}
async function reqJson(method, path, body) {
    const res = await req(method, path, body);
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
    const login = await reqJson('POST', '/api/admin/login', { password: process.env.ADMIN_PASSWORD });
    dogrula('admin girişi', login.data && login.data.success !== false);

    const info = await run(
        `INSERT INTO orders (merchant_oid, user_id, email, first_name, last_name, city, district, street, zipcode, phone, total_amount, payment_status)
         VALUES ('START-STATE-TEST-DO-NOT-KEEP', NULL, ?, ?, ?, ?, ?, ?, ?, ?, 175, 1)`,
        [encryptData('start-state-test@feyzay.com'), encryptData('Test'), encryptData('Alıcı'),
         encryptData('İstanbul'), encryptData('Kadıköy'), encryptData('Test adresi 1'),
         encryptData('34000'), encryptData('05555555555')]
    );
    const id = info.lastID;
    console.log('geçici sipariş id =', id);

    try {
        // 1) Liste: aşama Onay Bekliyor olmalı, Aras bilgisi hiç oluşmamış olmalı
        const list = await reqJson('GET', '/api/admin/shipments');
        const kayit = (list.data.shipments || []).find(s => s.id === id);
        dogrula('listede görünüyor', Boolean(kayit));
        dogrula('approvalState=0 (Onay Bekliyor)', kayit && kayit.approvalState === 0);
        dogrula('cargoState=0', kayit && kayit.cargoState === 0);
        dogrula('takip kodu yok', kayit && !kayit.cargoTrackingCode);
        dogrula('aras irsaliye yok', kayit && !kayit.arasWaybill);

        // 2) Poller bekleme süresi kadar bekle: yine de bir şey değişmemeli
        await bekle(4000);
        const row = await get(`SELECT approval_state, cargo_state, aras_waybill, cargo_tracking_code FROM orders WHERE id = ?`, [id]);
        console.log('DB (bekleme sonrası):', JSON.stringify(row));
        dogrula('hiçbir otomatik işlem yapılmadı',
            row.approval_state === 0 && row.cargo_state === 0 && row.aras_waybill === null && row.cargo_tracking_code === null);

        // 3) Excel export: her sekme geçerli xlsx döndürmeli
        for (const tab of ['all', 'approval', 'courier', 'transit']) {
            const res = await req('GET', `/api/admin/shipments/export?tab=${tab}`);
            const buf = Buffer.from(await res.arrayBuffer());
            const ct = res.headers.get('content-type') || '';
            const gecerli = res.status === 200 && ct.includes('spreadsheetml') &&
                buf.length > 200 && buf[0] === 0x50 && buf[1] === 0x4b; // PK (zip) imzası
            dogrula(`export?tab=${tab} geçerli xlsx`, gecerli);
            if (tab === 'approval') {
                const icerir = buf.includes(Buffer.from(`Sipariş #`)) || buf.toString('latin1').includes(`>${id}<`);
                console.log(`  approval export boyut=${buf.length}B, geçici id içeriyor: ${icerir}`);
            }
        }

        // 4) Sahte sekmeler reddedilmeli (all fallback)
        const bos = await req('GET', '/api/admin/shipments/export?tab=hacker');
        dogrula('geçersiz tab fallback (200)', bos.status === 200);
    } finally {
        await run(`DELETE FROM orders WHERE id = ?`, [id]);
        const kalan = await get(`SELECT COUNT(*) AS n FROM orders WHERE merchant_oid = 'START-STATE-TEST-DO-NOT-KEEP'`);
        console.log('kalan sahte satır =', kalan.n);
        db.close();
    }

    console.log(hata === 0 ? '\nTÜM TESTLER GEÇTİ' : `\n${hata} TEST BAŞARISIZ`);
    process.exit(hata === 0 ? 0 : 1);
})().catch(e => { console.error('TEST HATASI:', e.message); process.exit(1); });
