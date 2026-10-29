// Kimlik doğrulama: kayıt, e-posta onayı, giriş/çıkış, mevcut kullanıcı.
const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const config = require('../config');
const { decryptData, hashPassword, verifyPassword } = require('../lib/crypto');
const { sendMail } = require('../lib/mailer');
const { oturumOlustur, oturumKapat } = require('../middleware/session');

const router = express.Router();

router.post('/api/signup', (req, res) => {
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
        const onayLinki = `${config.SITE_URL}/api/verify-email?token=${verifyToken}`;
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

router.get('/api/verify-email', (req, res) => {
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

        // Onay başarılıysa token'ı sil, is_verified = 1 yap ve kullanıcıyı otomatik giriş yaptır
        db.run(`UPDATE users SET is_verified = 1, verify_token = NULL WHERE id = ?`, [row.id], () => {
            oturumOlustur(res, row.id, false, (oturumErr) => {
                if (oturumErr) {
                    return res.send(`
                        <div style="text-align:center; font-family:sans-serif; margin-top:100px;">
                            <h1 style="color:#2ecc71;">Hesabınız Onaylandı!</h1>
                            <p>E-posta adresiniz doğrulandı ancak oturum açılamadı. Lütfen giriş yapın.</p>
                            <a href="/kayit.html" style="color:#111; font-weight:bold;">Giriş sayfasına git</a>
                        </div>
                    `);
                }
                res.send(`
                    <div style="text-align:center; font-family:sans-serif; margin-top:100px;">
                        <h1 style="color:#2ecc71;">Hesabınız Onaylandı!</h1>
                        <p>E-posta adresiniz doğrulandı ve giriş yapıldı. Yönlendiriliyorsunuz...</p>
                        <script>setTimeout(() => { window.location.href = '/index.html'; }, 2000);</script>
                    </div>
                `);
            });
        });
    });
});

router.post('/api/login', (req, res) => {
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

router.post('/api/logout', (req, res) => {
    oturumKapat(req, res, () => res.json({ success: true }));
});

// --- ŞİFRE SIFIRLAMA ---
// Kullanıcı var/yok ayrımı yapılmaz; yanıt her zaman aynıdır.
router.post('/api/forgot-password', (req, res) => {
    const { email } = req.body;
    const basariliYanit = { success: true, message: 'Eğer bu e-posta kayıtlıysa, şifre sıfırlama bağlantısı gönderildi.' };
    if (!email) return res.json(basariliYanit);

    db.get(`SELECT id, first_name FROM users WHERE email = ?`, [email], (err, row) => {
        if (err || !row) return res.json(basariliYanit);

        const resetToken = crypto.randomBytes(32).toString('hex');
        const suresi = Date.now() + 3600000; // 1 saat

        db.run(`UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?`, [resetToken, suresi, row.id], (err2) => {
            if (err2) return res.status(500).json({ success: false, message: 'Veritabanı hatası.' });

            const sifirlamaLinki = `${config.SITE_URL}/sifre-sifirla.html?token=${resetToken}`;
            const mailIcerigi = `
                <div style="font-family: sans-serif; color: #111; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 8px; text-align: center;">
                    <h2 style="color: #111;">Şifre Sıfırlama</h2>
                    <p>Merhaba ${row.first_name},</p>
                    <p>Hesabınız için şifre sıfırlama talebinde bulunuldu. Yeni şifrenizi belirlemek için aşağıdaki butona tıklayın:</p>
                    <br>
                    <a href="${sifirlamaLinki}" style="display: inline-block; padding: 12px 24px; background-color: #111; color: #fff; text-decoration: none; border-radius: 4px; font-weight: bold;">Şifremi Sıfırla</a>
                    <br><br>
                    <p>Bu bağlantı 1 saat içinde geçerliliğini yitirir. Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz.</p>
                    <p style="font-size: 12px; color: #888;">Buton çalışmıyorsa aşağıdaki linki tarayıcınıza yapıştırabilirsiniz:<br>${sifirlamaLinki}</p>
                </div>
            `;

            sendMail(email, "Feyzay - Şifre Sıfırlama", mailIcerigi);
            res.json(basariliYanit);
        });
    });
});

router.post('/api/reset-password', (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) {
        return res.status(400).json({ success: false, message: 'Geçersiz veya süresi dolmuş bağlantı.' });
    }
    if (!(/^(?=.*[a-z])(?=.*[A-Z])(?!.*\s).{6,}$/.test(password))) {
        return res.status(400).json({ success: false, message: 'Şifre en az 6 haneli, 1 büyük ve 1 küçük harf içermeli, boşluk içermemelidir.' });
    }

    db.get(`SELECT id FROM users WHERE reset_token = ? AND reset_expires > ?`, [token, Date.now()], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: 'Veritabanı hatası.' });
        if (!row) return res.status(400).json({ success: false, message: 'Geçersiz veya süresi dolmuş bağlantı.' });

        db.run(`UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?`,
            [hashPassword(password), row.id], (err2) => {
                if (err2) return res.status(500).json({ success: false, message: 'Veritabanı hatası.' });
                res.json({ success: true, message: 'Şifreniz güncellendi. Giriş yapabilirsiniz.' });
            });
    });
});

router.get('/api/me', (req, res) => {
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

module.exports = router;
