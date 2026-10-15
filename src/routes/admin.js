// Admin işlemleri: yönetici girişi, sipariş listesi/kargo/Excel dışa aktarımı,
// ürün CRUD (products.json üzerinden).
const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const config = require('../config');
const { decryptData, verifyPassword } = require('../lib/crypto');
const { sendMail } = require('../lib/mailer');
const { urunleriOku, urunleriYaz } = require('../lib/catalog');
const { oturumOlustur, oturumKapat, adminGerekli } = require('../middleware/session');

const router = express.Router();

let ExcelJS = null;
function exceljsYukle() {
    if (!ExcelJS) ExcelJS = require('exceljs');
    return ExcelJS;
}

function adminSifreDogruMu(girilen) {
    if (typeof girilen !== 'string' || girilen === '') return false;
    if (config.env.ADMIN_PASSWORD_HASH) {
        return verifyPassword(girilen, config.env.ADMIN_PASSWORD_HASH);
    }
    if (!config.env.ADMIN_PASSWORD) return false;
    const a = Buffer.from(girilen);
    const b = Buffer.from(config.env.ADMIN_PASSWORD);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post('/api/admin/login', (req, res) => {
    if (!config.env.ADMIN_PASSWORD && !config.env.ADMIN_PASSWORD_HASH) {
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

router.post('/api/admin/logout', (req, res) => {
    oturumKapat(req, res, () => res.json({ success: true }));
});

router.get('/api/admin/orders', adminGerekli, (req, res) => {
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

router.post('/api/admin/orders/:id/cargo', adminGerekli, (req, res) => {
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

router.get('/api/admin/orders/export', adminGerekli, (req, res) => {
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

router.get('/api/admin/products', adminGerekli, (req, res) => {
    try {
        res.json({ success: true, products: urunleriOku() });
    } catch (e) {
        res.status(500).json({ success: false, message: 'products.json okunamadı.' });
    }
});

router.post('/api/admin/products', adminGerekli, (req, res) => {
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

router.put('/api/admin/products/:id', adminGerekli, (req, res) => {
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

router.delete('/api/admin/products/:id', adminGerekli, (req, res) => {
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

module.exports = router;
