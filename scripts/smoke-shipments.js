// Kargo yönetimi uçlarının duman testi (geçici dosya, çalıştırıldıktan sonra silinir).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const B = 'http://localhost:3999';
let cookie = '';

async function req(method, path, body) {
    const res = await fetch(B + path, {
        method,
        headers: { 'Content-Type': 'application/json', cookie },
        body: body ? JSON.stringify(body) : undefined
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    let data = null;
    try { data = await res.json(); } catch (e) { }
    return { status: res.status, data };
}

(async () => {
    // 1. Yetkisiz erişim engeli
    let r = await req('GET', '/api/admin/shipments');
    console.log('unauth list:', r.status, JSON.stringify(r.data));

    // 2. Admin girişi (şifre .env'den, ekrana basılmaz)
    r = await req('POST', '/api/admin/login', { password: process.env.ADMIN_PASSWORD });
    console.log('admin login:', r.status, JSON.stringify(r.data));

    // 3. Sevkiyat listesi
    r = await req('GET', '/api/admin/shipments');
    console.log('shipments list:', r.status, 'adet:', r.data && r.data.shipments && r.data.shipments.length);
    const liste = (r.data && r.data.shipments) || [];
    if (liste.length > 0) {
        const id = liste[0].id;
        // 4. Canlı durum sorgusu (yalnızca okuma)
        r = await req('POST', `/api/admin/shipments/${id}/status`);
        console.log(`status #${id}:`, r.status, JSON.stringify(r.data).slice(0, 300));
    } else {
        console.log('status: listede sipariş yok, atlandı');
    }

    // 5. Var olmayan sipariş için iptal → Aras'a hiç gidilmeden 404
    r = await req('POST', '/api/admin/shipments/999999/cancel');
    console.log('cancel nonexistent:', r.status, JSON.stringify(r.data));

    // 6. Var olmayan sipariş için gönderim → 404
    r = await req('POST', '/api/admin/shipments/999999/send');
    console.log('send nonexistent:', r.status, JSON.stringify(r.data));
})().catch(e => { console.error('TEST HATASI:', e.message); process.exit(1); });
