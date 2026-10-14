require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false, // 587 portu için false olmalı
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

async function sendMail(to, subject, htmlContent) {
    if (!process.env.SMTP_USER) return;
    try {
        await transporter.sendMail({
            from: `"Feyzay" <${process.env.SMTP_USER}>`,
            to,
            subject,
            html: htmlContent
        });
        console.log(`[MAIL] ${to} adresine e-posta gönderildi: ${subject}`);
    } catch (err) {
        console.error(`[MAIL HATASI] Gönderilemedi:`, err.message);
    }
}
let ExcelJS = null;
function exceljsYukle() {
    if (!ExcelJS) ExcelJS = require('exceljs');
    return ExcelJS;
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cors({
    origin: process.env.SITE_URL || false,
    credentials: true
}));

const GIZLI_DOSYA_KALIBI = /^\.|\/(\.env|server\.js|package(-lock)?\.json|.*\.sqlite(-journal|-wal|-shm)?)$|^\/(scripts|\.git|data)\//i;
app.use((req, res, next) => {
    if (GIZLI_DOSYA_KALIBI.test(req.path)) return res.status(404).end();
    next();
});

app.use(express.static(__dirname, { dotfiles: 'deny', index: false }));

if (!process.env.SECRET_CRYPT_KEY) {
    console.error("HATA: SECRET_CRYPT_KEY .env dosyasında bulunamadı! Sunucu başlatılamıyor.");
    process.exit(1);
}


const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new sqlite3.Database(path.join(DATA_DIR, 'database.sqlite'));

db.run('PRAGMA foreign_keys = ON');
db.run('PRAGMA journal_mode = WAL');
const SECRET_KEY = crypto.createHash('sha256').update(process.env.SECRET_CRYPT_KEY).digest();

function dbGet(sql, params) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
}

// =====================================================================
// ============== OTURUM YÖNETİMİ (harici bağımlılık yok) =============
// =====================================================================

const OTURUM_COOKIE = 'feyzay_sid';
const OTURUM_SURESI_MS = 1000 * 60 * 60 * 24 * 30;

function cerezOku(req, ad) {
    const ham = req.headers.cookie;
    if (!ham) return null;
    for (const parca of ham.split(';')) {
        const i = parca.indexOf('=');
        if (i === -1) continue;
        if (parca.slice(0, i).trim() === ad) return decodeURIComponent(parca.slice(i + 1).trim());
    }
    return null;
}

function cerezYaz(res, sid, maxAgeSn) {
    const guvenli = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.append('Set-Cookie', `${OTURUM_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSn}${guvenli}`);
}

function oturumOlustur(res, userId, isAdmin, cb) {
    const sid = crypto.randomBytes(32).toString('base64url');
    const son = Date.now() + OTURUM_SURESI_MS;
    db.run(`INSERT INTO sessions (sid, user_id, is_admin, expires_at) VALUES (?, ?, ?, ?)`,
        [sid, userId, isAdmin ? 1 : 0, son], (err) => {
            if (err) return cb(err);
            cerezYaz(res, sid, Math.floor(OTURUM_SURESI_MS / 1000));
            cb(null);
        });
}

function oturumKapat(req, res, cb) {
    const sid = cerezOku(req, OTURUM_COOKIE);
    const bitir = () => {
        cerezYaz(res, '', 0);
        if (cb) cb();
    };
    if (!sid) return bitir();
    db.run(`DELETE FROM sessions WHERE sid = ?`, [sid], bitir);
}

function kullaniciGerekli(req, res, next) {
    if (!req.oturum || !req.oturum.user_id) {
        return res.status(401).json({ success: false, message: 'Giriş yapmanız gerekiyor.' });
    }
    next();
}

function adminGerekli(req, res, next) {
    if (!req.oturum || !req.oturum.is_admin) {
        return res.status(401).json({ success: false, message: 'Yetkisiz erişim.' });
    }
    next();
}

app.use((req, res, next) => {
    req.oturum = null;
    const sid = cerezOku(req, OTURUM_COOKIE);
    if (!sid) return next();

    db.get(`SELECT * FROM sessions WHERE sid = ?`, [sid], (err, row) => {
        if (err || !row) return next();
        if (row.expires_at <= Date.now()) {
            db.run(`DELETE FROM sessions WHERE sid = ?`, [sid]);
            return next();
        }
        req.oturum = row;
        next();
    });
});

// Kullanım dışı kalan oturumları periyodik olarak temizle.
setInterval(() => {
    db.run(`DELETE FROM sessions WHERE expires_at <= ?`, [Date.now()]);
}, 1000 * 60 * 60).unref();


db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        first_name TEXT,
        last_name TEXT,
        city TEXT,
        district TEXT,
        street TEXT,
        zipcode TEXT,
        marketing_consent INTEGER DEFAULT 0,
        consent_date DATETIME
    )`);

    db.run(`ALTER TABLE users ADD COLUMN marketing_consent INTEGER DEFAULT 0`, () => { });
    db.run(`ALTER TABLE users ADD COLUMN consent_date DATETIME`, () => { });
    db.run(`ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0`, () => { });
    db.run(`ALTER TABLE users ADD COLUMN verify_token TEXT`, () => { });

    db.run(`CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at INTEGER NOT NULL
    )`);


    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        merchant_oid TEXT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        email TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        city TEXT,
        district TEXT,
        street TEXT,
        zipcode TEXT,
        phone TEXT,
        total_amount INTEGER NOT NULL DEFAULT 0,
        payment_status INTEGER DEFAULT 0,
        cargo_state INTEGER DEFAULT 0,
        cargo_tracking_code TEXT DEFAULT NULL,
        aras_waybill TEXT,
        aras_error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`ALTER TABLE orders ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`, () => { });
    db.run(`ALTER TABLE orders ADD COLUMN total_amount INTEGER NOT NULL DEFAULT 0`, () => { });
    db.run(`ALTER TABLE orders ADD COLUMN aras_waybill TEXT`, () => { });
    db.run(`ALTER TABLE orders ADD COLUMN aras_error TEXT`, () => { });

    db.run(`CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        beden TEXT NOT NULL,
        urun_id TEXT NOT NULL,
        urun_name TEXT NOT NULL,
        adet INTEGER NOT NULL,
        renk TEXT,
        FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
    )`);

    db.run(`ALTER TABLE order_items ADD COLUMN renk TEXT`, () => { });
    db.run(`ALTER TABLE orders ADD COLUMN phone TEXT`, () => { });
});


const CRYPTO_VERSION = 'v1';

function encryptData(text) {
    if (text === undefined || text === null || text === '' || text === 'undefined' || text === 'null') return '';
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', SECRET_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [CRYPTO_VERSION, iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');
}

function decryptData(text) {
    if (!text) return '';
    const parts = String(text).split(':');
    if (parts.length !== 4 || parts[0] !== CRYPTO_VERSION) {
        throw new Error('Şifreli veri biçimi tanınmadı.');
    }
    const [, ivHex, tagHex, dataHex] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', SECRET_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return decrypted.toString('utf8');
}


(function anahtarKontrolu() {
    const prob = 'feyzay-anahtar-kontrolu';
    if (decryptData(encryptData(prob)) !== prob) {
        console.error('HATA: SECRET_CRYPT_KEY doğrulanamadı.');
        process.exit(1);
    }
})();

// =====================================================================
// ======================= ÜRÜN KATALOĞU (OTORİTE) =====================
// =====================================================================
const PRODUCTS_PATH = path.join(__dirname, 'products.json');

let katalogOnbellek = null;
let katalogMtime = 0;

function katalog() {
    const stat = fs.statSync(PRODUCTS_PATH);
    if (!katalogOnbellek || stat.mtimeMs !== katalogMtime) {
        katalogOnbellek = JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8'));
        katalogMtime = stat.mtimeMs;
    }
    return katalogOnbellek;
}

function katalogUrun(id) {
    return katalog().find(u => u.id === id) || null;
}


function stokYeterliMi(urun, renkAdi, adet) {
    if (urun.colors && urun.colors.length > 0) {
        const renk = renkAdi
            ? urun.colors.find(c => c.name === renkAdi)
            : urun.colors[0];
        if (!renk) return false;
        return Number(renk.stock) >= adet;
    }
    if (urun.stock !== undefined) return Number(urun.stock) >= adet;
    return true;
}


(function katalogKontrolu() {
    try {
        const urunler = katalog();
        if (!Array.isArray(urunler) || urunler.length === 0) throw new Error('katalog boş');
        console.log(`Katalog yüklendi: ${urunler.length} ürün.`);
    } catch (err) {
        console.error(`HATA: products.json okunamadı (${err.message}).`);
        process.exit(1);
    }
})();


const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, SCRYPT_KEYLEN = 64;

function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('hex'), hash.toString('hex')].join('$');
}

function verifyPassword(password, stored) {
    if (typeof stored !== 'string' || typeof password !== 'string') return false;
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltHex, hashHex] = parts;
    const beklenen = Buffer.from(hashHex, 'hex');
    const hesaplanan = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), beklenen.length, {
        N: Number(n), r: Number(r), p: Number(p)
    });
    return crypto.timingSafeEqual(beklenen, hesaplanan);
}

// =====================================================================
// ================= ARAS KARGO CANLI SİPARİŞ İLETİMİ ==================
// =====================================================================


function xmlKacis(deger) {
    return String(deger ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    })[ch]);
}


function cdataKacis(deger) {
    return String(deger ?? '').replace(/]]>/g, ']]]]><![CDATA[>');
}

async function sendToArasKargo(orderId, orderObj) {
    const apiUrl = "https://customerws.araskargo.com.tr/arascargoservice.asmx"; // CANLI ORTAM
    //const apiUrl = "https://customerservicestest.araskargo.com.tr/arascargoservice/arascargoservice.asmx";//test
    const userName = process.env.ARAS_USERNAME;
    const password = process.env.ARAS_PASSWORD;

    if (!userName || !password) {
        db.run(`UPDATE orders SET aras_error = ? WHERE id = ?`, ['Aras Kargo API bilgileri (.env) eksik.', orderId]);
        console.error("Aras Kargo API bilgileri (.env) eksik. Kargo entegrasyonu atlanıyor.");
        return null;
    }

    const waybillNo = "FZ" + Date.now().toString().slice(-6) + orderId;
    const barcodeNo = waybillNo + "01";
    const integrationCode = "FZ-" + orderId;

    const aliciAdi = `${orderObj.firstName || ''} ${orderObj.lastName || ''}`.trim();

    const xmlPayload = `
    <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:tem="http://tempuri.org/">
       <soap:Header/>
       <soap:Body>
          <SetOrder xmlns="http://tempuri.org/">
             <orderInfo>
                <Order>
                   <UserName>${xmlKacis(userName)}</UserName>
                   <Password>${xmlKacis(password)}</Password>
                   <TradingWaybillNumber>${xmlKacis(waybillNo)}</TradingWaybillNumber>
                   <ReceiverName>${xmlKacis(aliciAdi)}</ReceiverName>
                   <ReceiverAddress>${xmlKacis(orderObj.addressObj && orderObj.addressObj.street)}</ReceiverAddress>
                   <ReceiverPhone1>${xmlKacis(orderObj.phone || '05555555555')}</ReceiverPhone1>
                   <ReceiverCityName>${xmlKacis(orderObj.addressObj && orderObj.addressObj.city)}</ReceiverCityName>
                   <ReceiverTownName>${xmlKacis(orderObj.addressObj && orderObj.addressObj.district)}</ReceiverTownName>
                   <PieceCount>1</PieceCount>
                   <IntegrationCode>${xmlKacis(integrationCode)}</IntegrationCode>
                   <PayorTypeCode>1</PayorTypeCode>
                   <IsWorldWide>0</IsWorldWide>
                   <PieceDetails>
                      <PieceDetail>
                         <VolumetricWeight>1</VolumetricWeight>
                         <Weight>1</Weight>
                         <BarcodeNumber>${xmlKacis(barcodeNo)}</BarcodeNumber>
                         <ProductNumber />
                         <Description>Web Siparis ID: ${xmlKacis(orderId)}</Description>
                      </PieceDetail>
                   </PieceDetails>
                </Order>
             </orderInfo>
             <userName>${xmlKacis(userName)}</userName>
             <password>${xmlKacis(password)}</password>
          </SetOrder>
       </soap:Body>
    </soap:Envelope>
    `;

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/soap+xml; charset=utf-8'
            },
            body: xmlPayload
        });

        const responseText = await response.text();

        if (responseText.includes('<ResultCode>0</ResultCode>')) {
            db.run(`UPDATE orders SET cargo_state = 1, aras_waybill = ?, cargo_tracking_code = ?, aras_error = NULL WHERE id = ?`,
                [waybillNo, waybillNo, orderId]);
            console.log(`[ARAS] Sipariş aktarımı BAŞARILI (Sipariş ID: ${orderId}, Takip: ${waybillNo})`);
            return responseText;
        }

        const hata = responseText.slice(0, 500);
        db.run(`UPDATE orders SET aras_error = ? WHERE id = ?`, [hata, orderId]);
        console.error(`[ARAS] Aktarım HATASI (Sipariş ID: ${orderId}):`, responseText);
        return null;
    } catch (error) {
        db.run(`UPDATE orders SET aras_error = ? WHERE id = ?`, [String(error.message || error), orderId]);
        console.error("[ARAS] Sunucu Hatası:", error);
        return null;
    }
}

// =====================================================================
// ================= ARAS KARGO CANLI DURUM SORGULAMA ==================
// =====================================================================
app.post('/api/user/cargo-status', kullaniciGerekli, async (req, res) => {
    const { orderId } = req.body;

    const siparisId = Number(orderId);
    if (!Number.isInteger(siparisId) || siparisId < 1) {
        return res.json({ success: false, message: 'Geçersiz sipariş numarası.' });
    }


    try {
        const siparis = await dbGet(`SELECT id FROM orders WHERE id = ? AND user_id = ?`, [siparisId, req.oturum.user_id]);
        if (!siparis) return res.json({ success: false, message: 'Sipariş bulunamadı.' });
    } catch (err) {
        return res.json({ success: false, message: 'Sorgulanamadı' });
    }

    const userName = process.env.ARAS_QUERY_USERNAME;
    const password = process.env.ARAS_QUERY_PASSWORD;
    const customerCode = process.env.ARAS_MUSTERI_KODU || '2623003491526';

    if (!userName || !password) {
        return res.json({ success: false, message: "Kargo API bilgileri eksik." });
    }

    const loginInfo = `<LoginInfo><UserName>${xmlKacis(userName)}</UserName><Password>${xmlKacis(password)}</Password><CustomerCode>${xmlKacis(customerCode)}</CustomerCode></LoginInfo>`;
    const queryInfo = `<QueryInfo><QueryType>11</QueryType><IntegrationCode>FZ-${siparisId}</IntegrationCode></QueryInfo>`;

    const soapPayload = `
    <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
       <soapenv:Header/>
       <soapenv:Body>
          <tem:GetQueryJSON>
             <tem:loginInfo><![CDATA[${cdataKacis(loginInfo)}]]></tem:loginInfo>
             <tem:queryInfo><![CDATA[${cdataKacis(queryInfo)}]]></tem:queryInfo>
          </tem:GetQueryJSON>
       </soapenv:Body>
    </soapenv:Envelope>`;

    try {
        const response = await fetch("https://customerservices.araskargo.com.tr/ArasCargoCustomerIntegrationService/ArasCargoIntegrationService.svc", {
            method: "POST",
            headers: {
                "Content-Type": "text/xml; charset=utf-8",
                "SOAPAction": "http://tempuri.org/IArasCargoIntegrationService/GetQueryJSON"
            },
            body: soapPayload
        });

        const text = await response.text();
        const match = text.match(/<GetQueryJSONResult>([\s\S]*?)<\/GetQueryJSONResult>/);

        if (match && match[1]) {
            let cleanJsonStr = match[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            const parsedData = JSON.parse(cleanJsonStr);

            if (parsedData && parsedData.QueryResult && parsedData.QueryResult.length > 0) {
                const cargoData = parsedData.QueryResult[0];
                return res.json({
                    success: true,
                    durum: cargoData.DURUMU,
                    takipNo: cargoData.KARGO_TAKIP_NO
                });
            }
        }
        res.json({ success: false, message: 'Şube onayı bekleniyor' });
    } catch (err) {
        console.error("Kargo Sorgulama Hatası:", err);
        res.json({ success: false, message: 'Sorgulanamadı' });
    }
});

// =====================================================================
// ==================== KULLANICI & SİPARİŞ İŞLEMLERİ ==================
// =====================================================================

app.post('/api/signup', (req, res) => {
    const { firstName, lastName, email, password, marketingConsent } = req.body;
    if (!firstName || !lastName || !email || !password) {
        return res.status(400).json({ success: false, message: 'Tüm alanları doldurun.' });
    }
    if (!(/^(?=.*[a-z])(?=.*[A-Z])(?!.*\s).{6,}$/.test(password))) {
        return res.status(400).json({ success: false, message: 'Şifre en az 6 haneli, 1 büyük ve 1 küçük harf içermeli, boşluk içermemelidir.' });
    }

    const hashedPassword = hashPassword(password);
    const verifyToken = crypto.randomBytes(32).toString('hex'); // Eşsiz onay kodu üret

    const sql = `INSERT INTO users (first_name, last_name, email, password, marketing_consent, consent_date, is_verified, verify_token) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`;

    db.run(sql, [firstName, lastName, email, hashedPassword, marketingConsent ? 1 : 0, new Date().toISOString(), verifyToken], function (err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ success: false, message: 'Bu E-posta zaten kayıtlı.' });
            }
            return res.status(500).json({ success: false, message: 'Veritabanı hatası.' });
        }

        // --- ONAY MAİLİ GÖNDERİMİ ---
        const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
        const onayLinki = `${siteUrl}/api/verify-email?token=${verifyToken}`;
        const mailIcerigi = `
            <div style="font-family: sans-serif; color: #111; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 8px; text-align: center;">
                <h2 style="color: #111;">Feyzay'a Hoş Geldiniz!</h2>
                <p>Merhaba ${firstName},</p>
                <p>Aramıza katılmanıza çok sevindik! Hesabınızı aktifleştirmek ve alışverişe başlamak için aşağıdaki butona tıklayın:</p>
                <br>
                <a href="${onayLinki}" style="display: inline-block; padding: 12px 24px; background-color: #111; color: #fff; text-decoration: none; border-radius: 4px; font-weight: bold;">E-Posta Adresimi Onayla</a>
                <br><br>
                <p style="font-size: 12px; color: #888;">Buton çalışmıyorsa aşağıdaki linki tarayıcınıza yapıştırabilirsiniz:<br>${onayLinki}</p>
            </div>
        `;

        sendMail(email, "Feyzay - Hesabınızı Onaylayın", mailIcerigi);

        // Artık anında oturum açmıyoruz, sadece uyarı dönüyoruz
        res.json({ success: true, message: 'Kayıt başarılı! Lütfen e-posta kutunuza gelen linke tıklayarak hesabınızı onaylayın.' });
    });
});
app.get('/api/verify-email', (req, res) => {
    const { token } = req.query;
    if (!token) return res.send('Geçersiz onay linki.');

    db.get(`SELECT id FROM users WHERE verify_token = ?`, [token], (err, row) => {
        if (err || !row) {
            return res.send(`
                <div style="text-align:center; font-family:sans-serif; margin-top:100px;">
                    <h1 style="color:#e74c3c;">Hata</h1>
                    <p>Geçersiz veya daha önceden kullanılmış onay linki.</p>
                    <a href="/kayit.html" style="color:#111; font-weight:bold;">Kayıt sayfasına dön</a>
                </div>
            `);
        }

        // Onay başarılıysa token'ı sil ve is_verified = 1 yap
        db.run(`UPDATE users SET is_verified = 1, verify_token = NULL WHERE id = ?`, [row.id], () => {
            res.send(`
                <div style="text-align:center; font-family:sans-serif; margin-top:100px;">
                    <h1 style="color:#2ecc71;">Hesabınız Onaylandı!</h1>
                    <p>E-posta adresiniz başarıyla doğrulandı. Yönlendiriliyorsunuz...</p>
                    <script>setTimeout(() => { window.location.href = '/kayit.html'; }, 3000);</script>
                </div>
            `);
        });
    });
});
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'E-posta ve şifre zorunludur.' });
    }

    db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: 'Veritabanı hatası.' });
        if (!row || !verifyPassword(password, row.password)) {
            return res.status(401).json({ success: false, message: 'E-posta veya şifre hatalı.' });
        }

        // --- E-POSTA ONAY KONTROLÜ ---
        if (row.is_verified === 0) {
            return res.status(403).json({ success: false, message: 'Hesabınız henüz onaylanmamış. Lütfen e-postanızı kontrol edin.' });
        }

        oturumOlustur(res, row.id, false, (oturumErr) => {
            if (oturumErr) {
                return res.status(500).json({ success: false, message: 'Oturum başlatılamadı.' });
            }
            res.json({ success: true, message: 'Giriş başarılı.', firstName: row.first_name, lastName: row.last_name });
        });
    });
});

app.post('/api/logout', (req, res) => {
    oturumKapat(req, res, () => res.json({ success: true }));
});


app.get('/api/me', (req, res) => {
    if (!req.oturum) return res.json({ success: true, user: null, isAdmin: false });

    if (req.oturum.is_admin) {
        return res.json({ success: true, user: null, isAdmin: true });
    }

    db.get(`SELECT email, first_name, last_name, city, district, street, zipcode FROM users WHERE id = ?`,
        [req.oturum.user_id], (err, row) => {
            if (err || !row) return res.json({ success: true, user: null, isAdmin: false });
            res.json({
                success: true,
                isAdmin: false,
                user: {
                    email: row.email,
                    firstName: row.first_name,
                    lastName: row.last_name,
                    address: {
                        city: decryptData(row.city),
                        district: decryptData(row.district),
                        street: decryptData(row.street),
                        zipcode: decryptData(row.zipcode)
                    }
                }
            });
        });
});

app.post('/api/checkout', async (req, res) => {
    try {
        const { email, firstName, lastName, addressObj, phone, cart } = req.body;
        if (!addressObj || !Array.isArray(cart) || cart.length === 0) {
            return res.status(400).json({ success: false, message: 'Bilgiler eksik veya sepet boş.' });
        }


        let alici;
        if (req.oturum && req.oturum.user_id) {
            const kayitli = await dbGet(`SELECT * FROM users WHERE id = ?`, [req.oturum.user_id]);
            if (!kayitli) {
                return res.status(401).json({ success: false, message: 'Oturum geçersiz, lütfen tekrar giriş yapın.' });
            }

            alici = {
                userId: kayitli.id,
                email: kayitli.email,
                firstName: firstName || kayitli.first_name,
                lastName: lastName || kayitli.last_name
            };
        } else {
            if (!email || !firstName || !lastName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return res.status(400).json({ success: false, message: 'Ad, soyad ve geçerli bir e-posta zorunludur.' });
            }
            alici = { userId: null, email, firstName, lastName };
        }


        const sepet = [];
        for (const satir of cart) {
            const urun = katalogUrun(satir.id);
            if (!urun) {
                return res.status(400).json({ success: false, message: 'Sepetteki ürün bulunamadı.' });
            }

            const adet = Number(satir.adet);
            if (!Number.isInteger(adet) || adet < 1 || adet > 100) {
                return res.status(400).json({ success: false, message: 'Geçersiz adet: ' + urun.name });
            }

            const beden = typeof satir.beden === 'string' && satir.beden ? satir.beden.slice(0, 50) : 'Standart';
            if (Array.isArray(urun.sizes) && urun.sizes.length > 0 && !urun.sizes.includes(beden)) {
                return res.status(400).json({ success: false, message: 'Geçersiz beden: ' + urun.name });
            }

            const renk = typeof satir.renk === 'string' && satir.renk ? satir.renk.slice(0, 100) : null;
            if (Array.isArray(urun.colors) && urun.colors.length > 0 && !urun.colors.some(c => c.name === renk)) {
                return res.status(400).json({ success: false, message: 'Geçersiz renk: ' + urun.name });
            }

            if (!stokYeterliMi(urun, renk, adet)) {
                return res.status(409).json({ success: false, message: 'Stokta yeterli ürün yok: ' + urun.name });
            }

            sepet.push({
                id: urun.id,
                isim: urun.name,
                fiyat: Number(urun.price),
                adet,
                beden,
                renk
            });
        }

        const totalAmount = sepet.reduce((acc, item) => acc + (item.fiyat * item.adet), 0);
        const payment_amount = Math.round(totalAmount * 100);
        if (!(payment_amount > 0)) {
            return res.status(400).json({ success: false, message: 'Geçersiz sepet tutarı.' });
        }

        const merchant_id = process.env.PAYTR_MERCHANT_ID;
        const merchant_key = process.env.PAYTR_MERCHANT_KEY;
        const merchant_salt = process.env.PAYTR_MERCHANT_SALT;

        const merchant_oid = "FEYZAY" + Date.now() + Math.floor(Math.random() * 1000);
        const user_name = `${alici.firstName || ''} ${alici.lastName || ''}`.trim();
        const user_address = [addressObj.city, addressObj.district, addressObj.street].filter(Boolean).join(' ');
        const user_phone = phone || "05555555555";

        const merchant_ok_url = `${process.env.SITE_URL}/api/paytr-success`;
        const merchant_fail_url = `${process.env.SITE_URL}/api/paytr-fail`;

        const user_basket = JSON.stringify(sepet.map(item => [
            item.isim,
            item.fiyat.toString(),
            item.adet
        ]));

        let user_ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
        if (user_ip === '::1' || user_ip === '127.0.0.1' || user_ip.startsWith('::ffff:127.')) {
            user_ip = '85.105.105.105';
        }
        const timeout_limit = 30;
        const debug_on = 1;
        const test_mode = 0;
        const no_installment = 0;
        const max_installment = 0;
        const currency = "TL";

        const hash_str = merchant_id + user_ip + merchant_oid + alici.email + payment_amount + user_basket + no_installment + max_installment + currency + test_mode;
        const paytr_token = crypto.createHmac('sha256', merchant_key).update(hash_str + merchant_salt).digest('base64');

        const formData = new URLSearchParams();
        formData.append('merchant_id', merchant_id);
        formData.append('user_ip', user_ip);
        formData.append('merchant_oid', merchant_oid);
        formData.append('email', alici.email);
        formData.append('payment_amount', payment_amount);
        formData.append('paytr_token', paytr_token);
        formData.append('user_basket', user_basket);
        formData.append('debug_on', debug_on);
        formData.append('no_installment', no_installment);
        formData.append('max_installment', max_installment);
        formData.append('user_name', user_name);
        formData.append('user_address', user_address);
        formData.append('user_phone', user_phone);
        formData.append('merchant_ok_url', merchant_ok_url);
        formData.append('merchant_fail_url', merchant_fail_url);
        formData.append('timeout_limit', timeout_limit);
        formData.append('currency', currency);
        formData.append('test_mode', test_mode);

        const paytrRes = await fetch('https://www.paytr.com/odeme/api/get-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData
        });
        const paytrData = await paytrRes.json();

        if (paytrData.status === 'success') {
            const encEmail = encryptData(alici.email);
            const encFirstName = encryptData(alici.firstName || '');
            const encLastName = encryptData(alici.lastName || '');
            const encCity = encryptData(addressObj.city || '');
            const encDistrict = encryptData(addressObj.district || '');
            const encStreet = encryptData(addressObj.street || '');
            const encZipcode = encryptData(addressObj.zipcode || '');
            const encPhone = encryptData(phone || '');

            const orderSql = `INSERT INTO orders (merchant_oid, user_id, email, first_name, last_name, city, district, street, zipcode, phone, total_amount, payment_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`;
            db.run(orderSql, [merchant_oid, alici.userId, encEmail, encFirstName, encLastName, encCity, encDistrict, encStreet, encZipcode, encPhone, payment_amount], async function (err) {
                if (err) {
                    console.error('[CHECKOUT] Sipariş kaydedilemedi:', err.message);
                    return res.status(500).json({ success: false, message: 'Database error.' });
                }

                const lastOrderId = this.lastID;
                const itemSql = `INSERT INTO order_items (order_id, beden, urun_id, urun_name, adet, renk) VALUES (?, ?, ?, ?, ?, ?)`;

                sepet.forEach(item => {
                    db.run(itemSql, [lastOrderId, item.beden, item.id, item.isim, item.adet, item.renk]);
                });

                if (alici.userId) {
                    db.run(`UPDATE users SET city=?, district=?, street=?, zipcode=? WHERE id=?`,
                        [encCity, encDistrict, encStreet, encZipcode, alici.userId]);
                }
                return res.json({ success: true, token: paytrData.token });
            });
        } else {
            return res.status(500).json({ success: false, message: 'PayTR Error: ' + paytrData.reason });
        }
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

app.post('/api/paytr-callback', (req, res) => {
    const { merchant_oid, status, total_amount, hash } = req.body;
    const merchant_id = process.env.PAYTR_MERCHANT_ID;
    const merchant_key = process.env.PAYTR_MERCHANT_KEY;
    const merchant_salt = process.env.PAYTR_MERCHANT_SALT;
    const hash_str = merchant_oid + merchant_salt + status + total_amount;
    const generated_hash = crypto.createHmac('sha256', merchant_key).update(hash_str).digest('base64');

    console.log(`[PAYTR] Bildirim geldi: ${merchant_oid} status=${status} tutar=${total_amount}`);

    if (hash !== generated_hash) {
        console.error(`[PAYTR] Hash doğrulanamadı: ${merchant_oid} — PAYTR_MERCHANT_KEY/SALT değerlerini kontrol edin.`);
        return res.send('PAYTR notification failed: bad hash');
    }

    if (status === 'success') {
        db.get(`SELECT * FROM orders WHERE merchant_oid = ?`, [merchant_oid], (err, order) => {
            if (err || !order) {
                console.error(`[PAYTR] Bildirimdeki sipariş bulunamadı: ${merchant_oid}`);
                return res.send('OK');
            }

            if (Number(total_amount) !== Number(order.total_amount)) {
                console.error(`[PAYTR] Tutar uyuşmazlığı: ${merchant_oid} bildirilen=${total_amount} kayıtlı=${order.total_amount}`);
                return res.send('OK');
            }

            db.run(`UPDATE orders SET payment_status = 1 WHERE merchant_oid = ? AND payment_status = 0`, [merchant_oid], function (err) {
                if (err) {
                    console.error(`[PAYTR] Ödeme durumu güncellenemedi: ${merchant_oid} — ${err.message}`);
                    return;
                }
                if (this.changes !== 1) {
                    console.error(`[PAYTR] Sipariş #${order.id} güncellenmedi (durum zaten ${order.payment_status}).`);
                    return;
                }
                console.log(`[PAYTR] Sipariş #${order.id} ödendi olarak işaretlendi.`);

                // 1. Müşteri bilgilerini çöz
                const musteriMaili = decryptData(order.email);
                const musteriAdi = decryptData(order.first_name);

                const orderObj = {
                    firstName: musteriAdi,
                    lastName: decryptData(order.last_name),
                    phone: decryptData(order.phone) || '05555555555',
                    addressObj: {
                        city: decryptData(order.city),
                        district: decryptData(order.district),
                        street: decryptData(order.street)
                    },
                    cart: []
                };

                // 2. Aras Kargo'ya Gönder
                sendToArasKargo(order.id, orderObj).then(() => {
                    console.log(`[PAYTR] Sipariş #${order.id} ödendi ve kargoya iletildi.`);
                });

                // 3. Sipariş Onay Mailini Gönder
                const siparisMaili = `
                    <div style="font-family: sans-serif; color: #111; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
                        <h2 style="color: #2ecc71;">Siparişiniz Alındı!</h2>
                        <p>Merhaba ${musteriAdi},</p>
                        <p><strong>#${order.id}</strong> numaralı siparişiniz başarıyla alınmış ve hazırlanmaya başlanmıştır.</p>
                        <p>Paketiniz kargoya teslim edildiğinde takip numaranız ile birlikte size tekrar haber vereceğiz.</p>
                        <br>
                        <p>Bizi tercih ettiğiniz için teşekkür ederiz.</p>
                        <p><strong>Feyzay Ekibi</strong></p>
                    </div>
                `;
                sendMail(musteriMaili, `Siparişiniz Alındı (#${order.id}) - Feyzay`, siparisMaili);
            });
        });
    } else {
        db.run(`UPDATE orders SET payment_status = -1 WHERE merchant_oid = ? AND payment_status = 0`, [merchant_oid]);
    }
    res.send('OK');
});

app.get('/api/paytr-success', (req, res) => {
    res.send(`
        <div style="text-align:center; font-family:sans-serif; margin-top:100px;">
            <h1 style="color:#2ecc71;">Ödeme Başarılı!</h1>
            <p style="color:#555; font-size:18px;">Siparişiniz alındı, ana sayfaya yönlendiriliyorsunuz...</p>
            <script>
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage('PAYTR_SUCCESS', window.location.origin);
                } else {
                    setTimeout(() => { window.location.href = '/index.html?payment=success'; }, 2000);
                }
            </script>
        </div>
    `);
});

app.get('/api/paytr-fail', (req, res) => {
    res.send(`
        <div style="text-align:center; font-family:sans-serif; margin-top:100px;">
            <h1 style="color:#e74c3c;">Ödeme Başarısız</h1>
            <p style="color:#555; font-size:18px;">Bir sorun oluştu, ana sayfaya yönlendiriliyorsunuz...</p>
            <script>
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage('PAYTR_FAIL', window.location.origin);
                } else {
                    setTimeout(() => { window.location.href = '/index.html?payment=fail'; }, 2000);
                }
            </script>
        </div>
    `);
});

app.post('/api/user/get-address', kullaniciGerekli, (req, res) => {
    db.get(`SELECT city, district, street, zipcode FROM users WHERE id = ?`, [req.oturum.user_id], (err, row) => {
        if (err || !row) return res.status(500).json({ success: false });
        res.json({
            success: true,
            address: {
                city: decryptData(row.city),
                district: decryptData(row.district),
                street: decryptData(row.street),
                zipcode: decryptData(row.zipcode)
            }
        });
    });
});

app.post('/api/user/address', kullaniciGerekli, (req, res) => {
    const { city, district, street, zipcode } = req.body;
    const sql = `UPDATE users SET city=?, district=?, street=?, zipcode=? WHERE id=?`;
    db.run(sql, [encryptData(city), encryptData(district), encryptData(street), encryptData(zipcode), req.oturum.user_id], function (err) {
        if (err) return res.status(500).json({ success: false, message: 'Hata oluştu.' });
        res.json({ success: true, message: 'Adres başarıyla güncellendi!' });
    });
});

app.post('/api/user/update-profile', kullaniciGerekli, (req, res) => {
    const { firstName, lastName, newEmail, oldPassword, newPassword } = req.body;
    if (!firstName || !lastName || !newEmail) {
        return res.status(400).json({ success: false, message: 'İsim, soyisim ve e-posta alanları zorunludur.' });
    }
    db.get(`SELECT * FROM users WHERE id = ?`, [req.oturum.user_id], (err, user) => {
        if (err || !user) return res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı.' });
        const updateProfile = (hashedNewPwd) => {
            let sql = `UPDATE users SET first_name = ?, last_name = ?, email = ?`;
            let params = [firstName, lastName, newEmail];
            if (hashedNewPwd) {
                sql += `, password = ?`;
                params.push(hashedNewPwd);
            }
            sql += ` WHERE id = ?`;
            params.push(user.id);
            db.run(sql, params, function (err2) {
                if (err2) {
                    if (err2.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ success: false, message: 'Bu yeni E-posta adresi başka bir kullanıcı tarafından kullanılıyor.' });
                    }
                    return res.status(500).json({ success: false, message: 'Güncelleme sırasında hata oluştu.' });
                }
                res.json({ success: true, message: 'Profil başarıyla güncellendi.', firstName, lastName, email: newEmail });
            });
        };
        if (oldPassword && newPassword) {
            if (!(/^(?=.*[a-z])(?=.*[A-Z])(?!.*\s).{6,}$/.test(newPassword))) {
                return res.status(400).json({ success: false, message: 'Yeni şifre en az 6 haneli, 1 büyük ve 1 küçük harf içermeli, boşluk içermemelidir.' });
            }
            if (!verifyPassword(oldPassword, user.password)) {
                return res.status(400).json({ success: false, message: 'Mevcut şifreniz hatalı.' });
            }
            updateProfile(hashPassword(newPassword));
        } else {
            updateProfile(null);
        }
    });
});

app.post('/api/user/orders', kullaniciGerekli, (req, res) => {
    db.all(`SELECT o.*, i.beden, i.urun_id, i.urun_name, i.adet, i.renk FROM orders o
            LEFT JOIN order_items i ON o.id = i.order_id
            WHERE o.payment_status = 1 AND o.user_id = ?
            ORDER BY o.id DESC`, [req.oturum.user_id], (err, rows) => {
        if (err) return res.status(500).json({ success: false });

        const ordersMap = {};
        rows.forEach(row => {
            if (!ordersMap[row.id]) {
                ordersMap[row.id] = {
                    id: row.id,
                    firstName: decryptData(row.first_name),
                    lastName: decryptData(row.last_name),
                    city: decryptData(row.city),
                    district: decryptData(row.district),
                    cargoState: row.cargo_state,
                    cargoTrackingCode: row.cargo_tracking_code,
                    createdAt: row.created_at,
                    cartData: []
                };
            }
            if (row.urun_id) {
                ordersMap[row.id].cartData.push({
                    id: row.urun_id,
                    beden: row.beden,
                    renk: row.renk,
                    name: row.urun_name,
                    adet: row.adet
                });
            }
        });

        const finalOrders = Object.values(ordersMap).sort((a, b) => b.id - a.id);
        res.json({ success: true, orders: finalOrders });
    });
});

// =====================================================================
// ========================= ADMİN İŞLEMLERİ ===========================
// =====================================================================


function adminSifreDogruMu(girilen) {
    if (typeof girilen !== 'string' || girilen === '') return false;
    if (process.env.ADMIN_PASSWORD_HASH) {
        return verifyPassword(girilen, process.env.ADMIN_PASSWORD_HASH);
    }
    if (!process.env.ADMIN_PASSWORD) return false;
    const a = Buffer.from(girilen);
    const b = Buffer.from(process.env.ADMIN_PASSWORD);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function urunleriOku() {
    return JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8'));
}

function urunleriYaz(urunler) {
    fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(urunler, null, 4), 'utf8');
}

app.post('/api/admin/login', (req, res) => {
    if (!process.env.ADMIN_PASSWORD && !process.env.ADMIN_PASSWORD_HASH) {
        return res.status(503).json({ success: false, message: 'Admin paneli aktif değil: .env dosyasına ADMIN_PASSWORD ekleyin.' });
    }
    if (!adminSifreDogruMu(req.body.password)) {
        return res.status(401).json({ success: false, message: 'Şifre hatalı.' });
    }
    oturumOlustur(res, null, true, (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Oturum başlatılamadı.' });
        res.json({ success: true });
    });
});

app.post('/api/admin/logout', (req, res) => {
    oturumKapat(req, res, () => res.json({ success: true }));
});

app.get('/api/admin/orders', adminGerekli, (req, res) => {
    db.all(`SELECT o.*, i.beden, i.urun_id, i.urun_name, i.adet, i.renk FROM orders o 
            LEFT JOIN order_items i ON o.id = i.order_id 
            ORDER BY o.id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Veritabanı hatası.' });

        const ordersMap = {};
        rows.forEach(row => {
            if (!ordersMap[row.id]) {
                ordersMap[row.id] = {
                    id: row.id,
                    email: decryptData(row.email),
                    firstName: decryptData(row.first_name),
                    lastName: decryptData(row.last_name),
                    city: decryptData(row.city),
                    district: decryptData(row.district),
                    street: decryptData(row.street),
                    zipcode: decryptData(row.zipcode),
                    paymentStatus: row.payment_status,
                    cargoState: row.cargo_state,
                    cargoTrackingCode: row.cargo_tracking_code,
                    arasError: row.aras_error,
                    createdAt: row.created_at,
                    cartData: []
                };
            }
            if (row.urun_id) {
                ordersMap[row.id].cartData.push({
                    id: row.urun_id,
                    beden: row.beden,
                    renk: row.renk,
                    name: row.urun_name,
                    adet: row.adet
                });
            }
        });

        const finalOrders = Object.values(ordersMap).sort((a, b) => b.id - a.id);
        res.json({ success: true, orders: finalOrders });
    });
});

app.post('/api/admin/orders/:id/cargo', adminGerekli, (req, res) => {
    const { trackingCode } = req.body;
    if (!trackingCode || !trackingCode.trim()) {
        return res.status(400).json({ success: false, message: 'Takip kodu boş olamaz.' });
    }

    db.run(`UPDATE orders SET cargo_state = 1, cargo_tracking_code = ? WHERE id = ?`, [trackingCode.trim(), req.params.id], function (err) {
        if (err || this.changes === 0) return res.status(404).json({ success: false, message: 'Sipariş bulunamadı.' });

        // Güncelleme başarılıysa e-posta gönder
        db.get(`SELECT first_name, email FROM orders WHERE id = ?`, [req.params.id], (err2, row) => {
            if (row) {
                const musteriMaili = decryptData(row.email);
                const musteriAdi = decryptData(row.first_name);
                const kargoMaili = `
                    <div style="font-family: sans-serif; color: #111; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
                        <h2 style="color: #3498db;">Siparişiniz Kargoya Verildi 🚚</h2>
                        <p>Merhaba ${musteriAdi},</p>
                        <p><strong>#${req.params.id}</strong> numaralı siparişiniz Aras Kargo'ya teslim edilmiştir.</p>
                        <div style="background: #f9f9f9; padding: 15px; border-radius: 6px; margin: 20px 0;">
                            <p style="margin: 0;"><strong>Kargo Takip Numaranız:</strong> ${trackingCode.trim()}</p>
                        </div>
                        <a href="http://kargotakip.araskargo.com.tr/mainpage.aspx?code=${trackingCode.trim()}" style="display: inline-block; padding: 12px 20px; background: #111; color: #fff; text-decoration: none; border-radius: 4px; font-weight: bold;">Kargomu Takip Et</a>
                        <br><br>
                        <p>İyi günlerde kullanın!</p>
                        <p><strong>Feyzay Ekibi</strong></p>
                    </div>
                `;
                sendMail(musteriMaili, `Siparişiniz Kargoya Verildi (#${req.params.id}) - Feyzay`, kargoMaili);
            }
        });

        res.json({ success: true });
    });
});

app.get('/api/admin/orders/export', adminGerekli, (req, res) => {
    db.all(`SELECT o.id, o.created_at, o.first_name, o.last_name, o.email, o.city, o.district, o.street, o.zipcode, o.cargo_state, o.cargo_tracking_code,
                   i.urun_id, i.urun_name, i.beden, i.renk, i.adet
            FROM orders o
            LEFT JOIN order_items i ON o.id = i.order_id
            ORDER BY o.id DESC`, [], async (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Veritabanı hatası.' });

        let Excel;
        try {
            Excel = exceljsYukle();
        } catch (e) {
            return res.status(500).json({ success: false, message: 'Excel kütüphanesi yüklü değil: npm install exceljs' });
        }

        const workbook = new Excel.Workbook();
        const worksheet = workbook.addWorksheet('Siparişler');
        worksheet.columns = [
            { header: 'Sipariş No', key: 'id', width: 12 },
            { header: 'Tarih', key: 'date', width: 22 },
            { header: 'İsim', key: 'firstName', width: 15 },
            { header: 'Soyisim', key: 'lastName', width: 15 },
            { header: 'E-posta', key: 'email', width: 30 },
            { header: 'Şehir', key: 'city', width: 15 },
            { header: 'İlçe', key: 'district', width: 15 },
            { header: 'Adres', key: 'street', width: 35 },
            { header: 'Posta Kodu', key: 'zipcode', width: 12 },
            { header: 'Ürün ID', key: 'urunId', width: 15 },
            { header: 'Ürün Adı', key: 'urunName', width: 30 },
            { header: 'Renk', key: 'renk', width: 18 },
            { header: 'Beden', key: 'beden', width: 10 },
            { header: 'Adet', key: 'adet', width: 8 },
            { header: 'Kargo Durumu', key: 'cargoState', width: 20 },
            { header: 'Takip Kodu', key: 'cargoCode', width: 20 }
        ];
        worksheet.getRow(1).font = { bold: true };

        rows.forEach(row => {
            worksheet.addRow({
                id: row.id,
                date: new Date(row.created_at).toLocaleString('tr-TR'),
                firstName: decryptData(row.first_name),
                lastName: decryptData(row.last_name),
                email: decryptData(row.email),
                city: decryptData(row.city),
                district: decryptData(row.district),
                street: decryptData(row.street),
                zipcode: decryptData(row.zipcode),
                urunId: row.urun_id,
                urunName: row.urun_name,
                renk: row.renk || '-',
                beden: row.beden,
                adet: row.adet,
                cargoState: row.cargo_state === 1 ? 'Kargoya Verildi' : 'Hazırlanıyor',
                cargoCode: row.cargo_tracking_code || 'Atanmadı'
            });
        });
        res.setHeader('Content-Disposition', 'attachment; filename="Feyzay_Siparisler.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        try {
            await workbook.xlsx.write(res);
            res.end();
        } catch (e) {
            res.status(500).end();
        }
    });
});

app.get('/api/admin/products', adminGerekli, (req, res) => {
    try {
        res.json({ success: true, products: urunleriOku() });
    } catch (e) {
        res.status(500).json({ success: false, message: 'products.json okunamadı.' });
    }
});

app.post('/api/admin/products', adminGerekli, (req, res) => {
    try {
        const urunler = urunleriOku();
        const yeniUrun = req.body;
        if (!yeniUrun.id || !yeniUrun.name || yeniUrun.price === undefined || yeniUrun.price === null) {
            return res.status(400).json({ success: false, message: 'Ürün ID, isim ve fiyat zorunludur.' });
        }
        if (urunler.some(u => u.id === yeniUrun.id)) {
            return res.status(400).json({ success: false, message: 'Bu ürün ID zaten kullanılıyor.' });
        }
        urunler.push(yeniUrun);
        urunleriYaz(urunler);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Ürün kaydedilemedi.' });
    }
});

app.put('/api/admin/products/:id', adminGerekli, (req, res) => {
    try {
        const urunler = urunleriOku();
        const idx = urunler.findIndex(u => u.id === req.params.id);
        if (idx === -1) return res.status(404).json({ success: false, message: 'Ürün bulunamadı.' });

        if (req.body.id && req.body.id !== req.params.id && urunler.some(u => u.id === req.body.id)) {
            return res.status(400).json({ success: false, message: 'Bu ürün ID zaten kullanılıyor.' });
        }

        urunler[idx] = req.body;
        urunleriYaz(urunler);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Ürün güncellenemedi.' });
    }
});

app.delete('/api/admin/products/:id', adminGerekli, (req, res) => {
    try {
        const urunler = urunleriOku();
        const yeni = urunler.filter(u => u.id !== req.params.id);
        if (yeni.length === urunler.length) return res.status(404).json({ success: false, message: 'Ürün bulunamadı.' });
        urunleriYaz(yeni);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Ürün silinemedi.' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Sunucu ${process.env.SITE_URL || `http://localhost:${PORT}`} adresinde çalışıyor`);
});