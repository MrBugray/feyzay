
const path = require('path');
const sqlite3 = require('sqlite3');

const db = new sqlite3.Database(path.join(__dirname, '..', 'data', 'database.sqlite'));

const DURUM = { 0: 'ödeme bekliyor', 1: 'ödendi', '-1': 'başarısız' };

db.all(`SELECT id, merchant_oid, user_id, payment_status, total_amount, cargo_state, aras_error, created_at
        FROM orders ORDER BY id DESC LIMIT 15`, (err, siparisler) => {
    if (err) {
        console.log('Siparişler okunamadı:', err.message);
        return db.close();
    }

    if (siparisler.length === 0) {
        console.log('Hiç sipariş kaydı yok.');
        console.log('Ödeme sırasında "Database error" alındıysa sipariş hiç oluşmamıştır.');
        return db.close();
    }

    console.log('\n--- Son siparişler ---');
    for (const s of siparisler) {
        const nedenler = [];
        if (s.payment_status !== 1) {
            nedenler.push(`ödeme onaylanmadı (durum: ${DURUM[s.payment_status] || s.payment_status}) — PayTR bildirimi gelmemiş olabilir`);
        }
        if (s.user_id === null) {
            nedenler.push('misafir siparişi (user_id yok) — hiçbir hesabın Siparişlerim listesinde görünmez');
        }
        if (s.aras_error) nedenler.push(`kargo hatası: ${s.aras_error}`);

        console.log(`\n#${s.id}  ${s.merchant_oid}  ${s.created_at}`);
        console.log(`   tutar=${s.total_amount} kuruş  ${DURUM[s.payment_status] || s.payment_status}  user_id=${s.user_id === null ? 'YOK' : s.user_id}`);
        console.log(nedenler.length ? `   -> ${nedenler.join('\n   -> ')}` : '   -> Sorun yok: ödendi ve bir hesaba bağlı.');
    }

    db.all(`SELECT sid, user_id, is_admin, datetime(expires_at/1000, 'unixepoch', 'localtime') AS bitis
            FROM sessions ORDER BY created_at DESC`, (err2, oturumlar) => {
        console.log('\n--- Açık oturumlar ---');
        if (err2) {
            console.log('Okunamadı:', err2.message);
        } else if (oturumlar.length === 0) {
            console.log('Hiç oturum yok. Giriş yapılmamışsa sipariş misafir olarak kaydedilir.');
        } else {
            for (const o of oturumlar) {
                console.log(`${o.is_admin ? 'ADMIN' : 'müşteri'}  user_id=${o.user_id === null ? '-' : o.user_id}  bitiş=${o.bitis}`);
            }
        }
        db.close();
    });
});
