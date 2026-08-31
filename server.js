require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const ExcelJS = require('exceljs');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(__dirname));

if (!process.env.SECRET_CRYPT_KEY) {
    console.error("HATA: SECRET_CRYPT_KEY .env dosyasında bulunamadı! Sunucu başlatılamıyor.");
    process.exit(1);
}

const db = new sqlite3.Database('./database.sqlite');
const SECRET_KEY = crypto.createHash('sha256').update(process.env.SECRET_CRYPT_KEY).digest();

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
        zipcode TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        merchant_oid TEXT,
        email TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        city TEXT,
        district TEXT,
        street TEXT,
        zipcode TEXT,
        payment_status INTEGER DEFAULT 0,
        cargo_state INTEGER DEFAULT 0,
        cargo_tracking_code TEXT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        beden TEXT NOT NULL,
        urun_id TEXT NOT NULL,
        urun_name TEXT NOT NULL,
        adet INTEGER NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
    )`);


    db.run(`ALTER TABLE order_items ADD COLUMN renk TEXT`, () => { });
});

function encryptData(text) {
    if (!text || text === 'undefined' || text === 'null') return '';
    try {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', SECRET_KEY, iv);
        let encrypted = cipher.update(String(text), 'utf8');
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return iv.toString('hex') + ':' + encrypted.toString('hex');
    } catch (e) {
        return String(text);
    }
}

function decryptData(text) {
    if (!text) return '';
    try {
        const parts = text.split(':');
        if (parts.length !== 2) return text;
        const iv = Buffer.from(parts[0], 'hex');
        const encryptedText = Buffer.from(parts[1], 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', SECRET_KEY, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString('utf8');
    } catch (err) {
        return '';
    }
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

app.post('/api/signup', (req, res) => {
    const { firstName, lastName, email, password } = req.body;
    if (!firstName || !lastName || !email || !password) {
        return res.status(400).json({ success: false, message: 'Tüm alanları doldurun.' });
    }
    const hashedPassword = hashPassword(password);
    const sql = `INSERT INTO users (first_name, last_name, email, password) VALUES (?, ?, ?, ?)`;
    db.run(sql, [firstName, lastName, email, hashedPassword], function (err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ success: false, message: 'Bu E-posta zaten kayıtlı.' });
            }
            return res.status(500).json({ success: false, message: 'Veritabanı hatası.' });
        }
        res.json({ success: true, message: 'Kayıt başarılı.', firstName: firstName, lastName: lastName });
    });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const hashedPassword = hashPassword(password);
    db.get(`SELECT * FROM users WHERE email = ? AND password = ?`, [email, hashedPassword], (err, row) => {
        if (err) return res.status(500).json({ success: false, message: 'Veritabanı hatası.' });
        if (row) {
            res.json({ success: true, message: 'Giriş başarılı.', firstName: row.first_name, lastName: row.last_name });
        } else {
            res.status(401).json({ success: false, message: 'E-posta veya şifre hatalı.' });
        }
    });
});

app.post('/api/checkout', async (req, res) => {
    try {
        const { isGuest, email, firstName, lastName, addressObj, cart } = req.body;
        if (!addressObj || !cart || cart.length === 0) {
            return res.status(400).json({ success: false, message: 'Missing info or empty cart.' });
        }


        const totalAmount = cart.reduce((acc, item) => acc + ((item.fiyat || 0) * (item.adet || 1)), 0);
        const payment_amount = Math.round(totalAmount * 100);

        const merchant_id = process.env.PAYTR_MERCHANT_ID;
        const merchant_key = process.env.PAYTR_MERCHANT_KEY;
        const merchant_salt = process.env.PAYTR_MERCHANT_SALT;

        const merchant_oid = "FEYZAY" + Date.now() + Math.floor(Math.random() * 1000);
        const user_name = firstName + " " + lastName;
        const user_address = addressObj.city + " " + addressObj.district + " " + addressObj.street;
        const user_phone = "05555555555";

        const merchant_ok_url = "http://localhost:3000/api/paytr-success";
        const merchant_fail_url = "http://localhost:3000/api/paytr-fail";


        const user_basket = JSON.stringify(cart.map(item => [
            item.isim || 'Urun',
            (item.fiyat || 0).toString(),
            item.adet || 1
        ]));

        let user_ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        if (user_ip === '::1' || user_ip === '127.0.0.1') {
            user_ip = '85.105.105.105';
        }
        const timeout_limit = 30;
        const debug_on = 1;
        const test_mode = 1;
        const no_installment = 0;
        const max_installment = 0;
        const currency = "TL";

        const hash_str = merchant_id + user_ip + merchant_oid + email + payment_amount + user_basket + no_installment + max_installment + currency + test_mode;
        const paytr_token = crypto.createHmac('sha256', merchant_key).update(hash_str + merchant_salt).digest('base64');

        const formData = new URLSearchParams();
        formData.append('merchant_id', merchant_id);
        formData.append('user_ip', user_ip);
        formData.append('merchant_oid', merchant_oid);
        formData.append('email', email);
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
            const encEmail = encryptData(email || '');
            const encFirstName = encryptData(firstName || '');
            const encLastName = encryptData(lastName || '');
            const encCity = encryptData(addressObj.city || '');
            const encDistrict = encryptData(addressObj.district || '');
            const encStreet = encryptData(addressObj.street || '');
            const encZipcode = encryptData(addressObj.zipcode || '');

            const orderSql = `INSERT INTO orders (merchant_oid, email, first_name, last_name, city, district, street, zipcode, payment_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`;
            db.run(orderSql, [merchant_oid, encEmail, encFirstName, encLastName, encCity, encDistrict, encStreet, encZipcode], function (err) {
                if (err) return res.status(500).json({ success: false, message: 'Database error.' });

                const lastOrderId = this.lastID;
                const itemSql = `INSERT INTO order_items (order_id, beden, urun_id, urun_name, adet, renk) VALUES (?, ?, ?, ?, ?, ?)`;

                cart.forEach(item => {

                    db.run(itemSql, [lastOrderId, item.beden || 'Standart', item.id, item.isim || '', item.adet || 1, item.renk || null]);
                });

                if (!isGuest && email) {
                    db.run(`UPDATE users SET city=?, district=?, street=?, zipcode=? WHERE email=?`, [encCity, encDistrict, encStreet, encZipcode, email]);
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
    if (hash !== generated_hash) {
        return res.send('PAYTR notification failed: bad hash');
    }
    if (status === 'success') {
        db.run(`UPDATE orders SET payment_status = 1 WHERE merchant_oid = ?`, [merchant_oid]);
    } else {
        db.run(`UPDATE orders SET payment_status = -1 WHERE merchant_oid = ?`, [merchant_oid]);
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
                    window.parent.postMessage('PAYTR_SUCCESS', '*');
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
                    window.parent.postMessage('PAYTR_FAIL', '*');
                } else {
                    setTimeout(() => { window.location.href = '/index.html?payment=fail'; }, 2000);
                }
            </script>
        </div>
    `);
});
app.post('/api/user/get-address', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false });
    db.get(`SELECT city, district, street, zipcode FROM users WHERE email = ?`, [email], (err, row) => {
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
app.post('/api/user/address', (req, res) => {
    const { email, city, district, street, zipcode } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Kimlik eksik.' });
    const sql = `UPDATE users SET city=?, district=?, street=?, zipcode=? WHERE email=?`;
    db.run(sql, [encryptData(city), encryptData(district), encryptData(street), encryptData(zipcode), email], function (err) {
        if (err) return res.status(500).json({ success: false, message: 'Hata oluştu.' });
        res.json({ success: true, message: 'Adres başarıyla güncellendi!' });
    });
});
app.post('/api/user/update-profile', (req, res) => {
    const { currentEmail, firstName, lastName, newEmail, oldPassword, newPassword } = req.body;
    if (!currentEmail || !firstName || !lastName || !newEmail) {
        return res.status(400).json({ success: false, message: 'İsim, soyisim ve e-posta alanları zorunludur.' });
    }
    db.get(`SELECT * FROM users WHERE email = ?`, [currentEmail], (err, user) => {
        if (err || !user) return res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı.' });
        const updateProfile = (hashedNewPwd) => {
            let sql = `UPDATE users SET first_name = ?, last_name = ?, email = ?`;
            let params = [firstName, lastName, newEmail];
            if (hashedNewPwd) {
                sql += `, password = ?`;
                params.push(hashedNewPwd);
            }
            sql += ` WHERE email = ?`;
            params.push(currentEmail);
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
            const hashedOld = hashPassword(oldPassword);
            if (user.password !== hashedOld) {
                return res.status(400).json({ success: false, message: 'Mevcut şifreniz hatalı.' });
            }
            updateProfile(hashPassword(newPassword));
        } else {
            updateProfile(null);
        }
    });
});
app.post('/api/user/orders', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false });

    db.all(`SELECT o.*, i.beden, i.urun_id, i.urun_name, i.adet, i.renk FROM orders o 
            LEFT JOIN order_items i ON o.id = i.order_id 
            ORDER BY o.id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false });

        const filteredRows = rows.filter(row => decryptData(row.email) === email);

        const ordersMap = {};
        filteredRows.forEach(row => {
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
const PRODUCTS_PATH = path.join(__dirname, 'products.json');

function adminAuth(req, res, next) {
    if (!process.env.ADMIN_PASSWORD) {
        return res.status(503).json({ success: false, message: 'Admin paneli aktif değil: .env dosyasına ADMIN_PASSWORD ekleyin.' });
    }
    if (req.headers['x-admin-key'] !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, message: 'Yetkisiz erişim.' });
    }
    next();
}

function urunleriOku() {
    return JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8'));
}

function urunleriYaz(urunler) {
    fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(urunler, null, 4), 'utf8');
}

app.post('/api/admin/login', (req, res) => {
    if (!process.env.ADMIN_PASSWORD) {
        return res.status(503).json({ success: false, message: 'Admin paneli aktif değil: .env dosyasına ADMIN_PASSWORD ekleyin.' });
    }
    if (req.body.password === process.env.ADMIN_PASSWORD) {
        return res.json({ success: true });
    }
    return res.status(401).json({ success: false, message: 'Şifre hatalı.' });
});
app.get('/api/admin/orders', adminAuth, (req, res) => {
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

app.post('/api/admin/orders/:id/cargo', adminAuth, (req, res) => {
    const { trackingCode } = req.body;
    if (!trackingCode || !trackingCode.trim()) {
        return res.status(400).json({ success: false, message: 'Takip kodu boş olamaz.' });
    }
    db.run(`UPDATE orders SET cargo_state = 1, cargo_tracking_code = ? WHERE id = ?`, [trackingCode.trim(), req.params.id], function (err) {
        if (err || this.changes === 0) return res.status(404).json({ success: false, message: 'Sipariş bulunamadı.' });
        res.json({ success: true });
    });
});

app.get('/api/admin/orders/export', adminAuth, (req, res) => {
    db.all(`SELECT o.id, o.created_at, o.first_name, o.last_name, o.email, o.city, o.district, o.street, o.zipcode, o.cargo_state, o.cargo_tracking_code,
                   i.urun_id, i.urun_name, i.beden, i.renk, i.adet
            FROM orders o
            LEFT JOIN order_items i ON o.id = i.order_id
            ORDER BY o.id DESC`, [], async (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Veritabanı hatası.' });

        const workbook = new ExcelJS.Workbook();
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
app.get('/api/admin/products', adminAuth, (req, res) => {
    try {
        res.json({ success: true, products: urunleriOku() });
    } catch (e) {
        res.status(500).json({ success: false, message: 'products.json okunamadı.' });
    }
});
app.post('/api/admin/products', adminAuth, (req, res) => {
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
app.put('/api/admin/products/:id', adminAuth, (req, res) => {
    try {
        const urunler = urunleriOku();
        const idx = urunler.findIndex(u => u.id === req.params.id);
        if (idx === -1) return res.status(404).json({
            success: false, message: 'Ürün bulunamadı.'

        });

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

app.delete('/api/admin/products/:id', adminAuth, (req, res) => {
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

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde açık `);
});