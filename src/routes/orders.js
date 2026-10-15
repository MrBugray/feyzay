// Sipariş akışı: ödeme başlatma (PayTR), ödeme bildirimi, kullanıcı adres/profil/sipariş
// işlemleri ve Aras Kargo durum sorgulama.
const express = require('express');
const crypto = require('crypto');
const { db, dbGet } = require('../db');
const config = require('../config');
const { encryptData, decryptData, hashPassword, verifyPassword } = require('../lib/crypto');
const { sendMail } = require('../lib/mailer');
const { katalogUrun, stokYeterliMi } = require('../lib/catalog');
const { kullaniciGerekli } = require('../middleware/session');
const { xmlKacis, cdataKacis, sendToArasKargo } = require('../services/arasKargo');

const router = express.Router();

// ================= ARAS KARGO CANLI DURUM SORGULAMA ==================
router.post('/api/user/cargo-status', kullaniciGerekli, async (req, res) => {
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

    const userName = config.env.ARAS_QUERY_USERNAME;
    const password = config.env.ARAS_QUERY_PASSWORD;
    const customerCode = config.env.ARAS_MUSTERI_KODU || '2623003491526';

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

// ==================== ÖDEME BAŞLATMA (PayTR) ====================
router.post('/api/checkout', async (req, res) => {
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

        const merchant_id = config.env.PAYTR_MERCHANT_ID;
        const merchant_key = config.env.PAYTR_MERCHANT_KEY;
        const merchant_salt = config.env.PAYTR_MERCHANT_SALT;

        const merchant_oid = "FEYZAY" + Date.now() + Math.floor(Math.random() * 1000);
        const user_name = `${alici.firstName || ''} ${alici.lastName || ''}`.trim();
        const user_address = [addressObj.city, addressObj.district, addressObj.street].filter(Boolean).join(' ');
        const user_phone = phone || "05555555555";

        const merchant_ok_url = `${config.env.SITE_URL}/api/paytr-success`;
        const merchant_fail_url = `${config.env.SITE_URL}/api/paytr-fail`;

        const user_basket = Buffer.from(JSON.stringify(sepet.map(item => [
            item.isim,
            item.fiyat.toString(),
            item.adet
        ]))).toString('base64');

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

// ==================== PAYTR ÖDEME BİLDİRİMİ ====================
router.post('/api/paytr-callback', (req, res) => {
    const { merchant_oid, status, total_amount, hash } = req.body;
    const merchant_id = config.env.PAYTR_MERCHANT_ID;
    const merchant_key = config.env.PAYTR_MERCHANT_KEY;
    const merchant_salt = config.env.PAYTR_MERCHANT_SALT;
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

router.get('/api/paytr-success', (req, res) => {
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

router.get('/api/paytr-fail', (req, res) => {
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

// ==================== KULLANICI ADRES / PROFİL / SİPARİŞLERİ ====================
router.post('/api/user/get-address', kullaniciGerekli, (req, res) => {
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

router.post('/api/user/address', kullaniciGerekli, (req, res) => {
    const { city, district, street, zipcode } = req.body;
    const sql = `UPDATE users SET city=?, district=?, street=?, zipcode=? WHERE id=?`;
    db.run(sql, [encryptData(city), encryptData(district), encryptData(street), encryptData(zipcode), req.oturum.user_id], function (err) {
        if (err) return res.status(500).json({ success: false, message: 'Hata oluştu.' });
        res.json({ success: true, message: 'Adres başarıyla güncellendi!' });
    });
});

router.post('/api/user/update-profile', kullaniciGerekli, (req, res) => {
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

router.post('/api/user/orders', kullaniciGerekli, (req, res) => {
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

module.exports = router;
