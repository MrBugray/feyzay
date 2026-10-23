// Test ortamı: uygulama modülleri YÜKLENMEDEN ÖNCE testOrtamiKur() çağrılmalıdır.
// Güvenceler:
//   - DB_PATH geçici dizindeki bir sqlite dosyasına yönlendirilir; gerçek
//     data/database.sqlite'a hiçbir yol dokunmaz (dotenv mevcut env'i ezmez).
//   - nodemailer require.cache'de sahteyle değiştirilir; sendMail çağrılsa bile
//     ağa çıkılmaz, tüm mailler bellekteki diziye yakalanır.
//   - Aras servisinin HTTP yapan fonksiyonları sahteyle değiştirilir;
//     yanlışlıkla tetiklenseler bile gerçek servise istek gitmez.
const fs = require('fs');
const os = require('os');
const path = require('path');

function testOrtamiKur() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feyzay-test-'));

    process.env.SECRET_CRYPT_KEY = 'test-icin-gizli-anahtar-0123456789';
    process.env.ADMIN_PASSWORD = 'test-admin-sifresi';
    process.env.DB_PATH = path.join(tmpDir, 'test.sqlite');
    process.env.PAYTR_MERCHANT_ID = 'test-merchant';
    process.env.PAYTR_MERCHANT_KEY = 'test-key';
    process.env.PAYTR_MERCHANT_SALT = 'test-salt';
    // Gerçek hesap bilgileri asla kullanılmaz; transport zaten sahte.
    process.env.SMTP_USER = 'test-smtp@example.invalid';
    process.env.SMTP_PASS = 'test';
    process.env.ARAS_USERNAME = '';
    process.env.ARAS_PASSWORD = '';
    process.env.ARAS_QUERY_USERNAME = '';
    process.env.ARAS_QUERY_PASSWORD = '';

    const mailler = [];
    const nodemailerYolu = require.resolve('nodemailer');
    require.cache[nodemailerYolu] = {
        id: nodemailerYolu,
        filename: nodemailerYolu,
        loaded: true,
        exports: {
            createTransport: () => ({
                sendMail: async (opts) => {
                    mailler.push(opts);
                    return { messageId: 'test' };
                }
            })
        }
    };

    const arasCagrilar = [];
    const arasYolu = require.resolve(path.join(__dirname, '..', '..', 'src', 'services', 'arasKargo'));
    const gercekAras = require(arasYolu);
    const sahte = (ad, sonuc) => async (...args) => {
        arasCagrilar.push({ ad, args });
        return sonuc;
    };
    require.cache[arasYolu].exports = {
        ...gercekAras,
        sendToArasKargo: sahte('sendToArasKargo', null),
        readArasKargoOrders: sahte('readArasKargoOrders', ''),
        getOrderWithIntegrationCode: sahte('getOrderWithIntegrationCode', ''),
        cancelDispatch: sahte('cancelDispatch', { success: true, code: '0', message: 'test' }),
        queryCargoByIntegrationCode: sahte('queryCargoByIntegrationCode', null)
    };

    return { tmpDir, mailler, arasCagrilar };
}

// Gerçek Express uygulamasını geçici DB ile ephemeral portta başlatır.
async function uygulamaBaslat() {
    const { katalogHazir } = require('../../src/lib/catalog');
    await katalogHazir;
    const app = require('../../src/app');
    const server = app.listen(0);
    await new Promise(r => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    return { base, server };
}

// Çerez hafızalı basit HTTP istemcisi (global fetch, harici bağımlılık yok).
function istemci(base) {
    let cookie = '';
    return {
        async req(method, url, body) {
            const res = await fetch(base + url, {
                method,
                headers: { 'Content-Type': 'application/json', cookie },
                body: body !== undefined ? JSON.stringify(body) : undefined
            });
            const sc = res.headers.get('set-cookie');
            if (sc) cookie = sc.split(';')[0];
            const text = await res.text();
            let data;
            try { data = JSON.parse(text); } catch (e) { data = text; }
            return { status: res.status, data };
        }
    };
}

function dbRun(sql, params = []) {
    const { db } = require('../../src/db');
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) { err ? reject(err) : resolve(this); });
    });
}

function dbGet(sql, params = []) {
    const { db } = require('../../src/db');
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => { err ? reject(err) : resolve(row); });
    });
}

// Sunucuyu ve DB'yi kapatır, geçici dizini (sqlite + wal + shm) siler.
async function temizle(server, tmpDir) {
    if (server) await new Promise(r => server.close(r));
    try {
        const { db } = require('../../src/db');
        await new Promise(r => db.close(r));
    } catch (e) { }
    fs.rmSync(tmpDir, { recursive: true, force: true });
}

// PayTR bildirimlerindeki HMAC üretimi (smoke scriptleriyle aynı yaklaşım).
function paytrHash(merchantOid, status, totalAmount) {
    const crypto = require('crypto');
    return crypto.createHmac('sha256', process.env.PAYTR_MERCHANT_KEY)
        .update(merchantOid + process.env.PAYTR_MERCHANT_SALT + status + totalAmount)
        .digest('base64');
}

// Throwaway kullanıcı + ödenmiş sipariş tohumları (yalnızca geçici DB'ye).
async function kullaniciEkle(email, ad = 'Test') {
    const { hashPassword, encryptData } = require('../../src/lib/crypto');
    await dbRun(
        `INSERT INTO users (first_name, last_name, email, password, is_verified, city, district, street, zipcode) VALUES (?, 'Kullanici', ?, ?, 1, ?, ?, ?, ?)`,
        [ad, email, hashPassword('Test1234'), encryptData('Sakarya'), encryptData('Arifiye'), encryptData('Test Sk.'), encryptData('54580')]
    );
    return (await dbGet(`SELECT id FROM users WHERE email = ?`, [email])).id;
}

async function siparisEkle(userId, merchantOid, { odendi = 1, cargoState = 0, approvalState = 0, arasWaybill = null } = {}) {
    const { encryptData } = require('../../src/lib/crypto');
    const sonuc = await dbRun(
        `INSERT INTO orders (merchant_oid, user_id, email, first_name, last_name, city, district, street, zipcode, phone, total_amount, payment_status, cargo_state, approval_state, aras_waybill)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 159800, ?, ?, ?, ?)`,
        [merchantOid, userId, encryptData('test@example.com'), encryptData('Test'), encryptData('Kullanici'),
         encryptData('Sakarya'), encryptData('Arifiye'),
         encryptData(JSON.stringify({ mahalle: 'Atatürk Mah.', cadde: 'Vatan Caddesi', binaNo: 'No:12 D:4' })),
         encryptData('54580'), encryptData('5551234567'), odendi, cargoState, approvalState, arasWaybill]
    );
    await dbRun(
        `INSERT INTO order_items (order_id, beden, urun_id, urun_name, adet, renk) VALUES (?, 'Standart', 'TESBONE02', 'Tesettür Bone', 2, 'Siyah')`,
        [sonuc.lastID]
    );
    return sonuc.lastID;
}

module.exports = { testOrtamiKur, uygulamaBaslat, istemci, dbRun, dbGet, temizle, paytrHash, kullaniciEkle, siparisEkle };
