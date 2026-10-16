// Kargo yönetimi (admin): onay → kurye bekleniyor → kargoda iş akışı.
// - Onay Bekliyor: ödeme alınmış, admin henüz onaylamamış.
// - Kurye Bekleniyor: admin onayladı, SetOrder Aras'a iletildi; irsaliye/kurye
//   taraması (Aras geri bildirimi) bekleniyor.
// - Kargoda: Aras geri bildirimi alındı (takip numarası oluştu), müşteriye e-posta gider.
const express = require('express');
const { db, dbGet } = require('../db');
const config = require('../config');
const { decryptData } = require('../lib/crypto');
const { sendMail } = require('../lib/mailer');
const { adminGerekli } = require('../middleware/session');
const {
    sendToArasKargo,
    getOrderWithIntegrationCode,
    cancelDispatch,
    queryCargoByIntegrationCode
} = require('../services/arasKargo');

const router = express.Router();

// exceljs yalnızca istek gelince yüklenir (sunucu açılışını hafif tutar).
let ExcelJS = null;
function exceljsYukle() {
    if (!ExcelJS) ExcelJS = require('exceljs');
    return ExcelJS;
}

const INTEGRATION_PREFIX = 'FZ-';

function safeDecrypt(text) {
    try {
        return decryptData(text);
    } catch (e) {
        return '';
    }
}

// GetQueryJSON (QueryType=11) sonucunda gerçek takip numarası oluşmuş mu?
// Aras kolon adlarını hem alt çizgili hem boşluklu dönebiliyor.
function geriBildirimVarmi(cargo) {
    if (!cargo) return false;
    return Boolean(
        cargo.KARGO_TAKIP_NO || cargo['KARGO TAKIP NO'] || cargo.TRACKINGNUMBER ||
        cargo.DURUM_KODU || cargo['DURUM KODU']
    );
}

function geriBildirimTakipNo(cargo) {
    return String(cargo.KARGO_TAKIP_NO || cargo['KARGO TAKIP NO'] || cargo.TRACKINGNUMBER || '');
}

// "Kurye Bekleniyor" → "Kargoda" geçişini yapar ve müşteriye bilgilendirme e-postası gönderir.
// cargo_state = 0 koşullu güncelleme olduğu için e-posta en fazla bir kez gider.
// Dışarıdan (test için) cargo verilebilir; verilmezse Aras'tan sorgulanır.
async function geriBildirimIsle(orderRow, cargo = undefined) {
    if (orderRow.cargo_state === 1 || orderRow.cancel_reason) return { transitioned: false };
    if (cargo === undefined) {
        cargo = await queryCargoByIntegrationCode(INTEGRATION_PREFIX + orderRow.id);
    }
    if (!geriBildirimVarmi(cargo)) return { transitioned: false, cargo };

    const takipNo = geriBildirimTakipNo(cargo);
    const degisti = await new Promise((resolve, reject) => {
        db.run(`UPDATE orders SET cargo_state = 1, cargo_tracking_code = ? WHERE id = ? AND cargo_state = 0`,
            [takipNo, orderRow.id], function (err) {
                if (err) return reject(err);
                resolve(this.changes === 1);
            });
    });
    if (!degisti) return { transitioned: false, cargo };

    const musteriMaili = safeDecrypt(orderRow.email);
    const musteriAdi = safeDecrypt(orderRow.first_name) || 'Değerli Müşterimiz';
    if (musteriMaili) {
        const kargoMaili = `
            <div style="font-family: sans-serif; color: #111; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
                <h2 style="color: #3498db;">Siparişiniz Kargoda 🚚</h2>
                <p>Merhaba ${musteriAdi},</p>
                <p><strong>#${orderRow.id}</strong> numaralı siparişiniz Aras Kargo'ya teslim edilmiştir.</p>
                ${takipNo ? `
                <div style="background: #f9f9f9; padding: 15px; border-radius: 6px; margin: 20px 0;">
                    <p style="margin: 0;"><strong>Kargo Takip Numaranız:</strong> ${takipNo}</p>
                </div>
                <a href="http://kargotakip.araskargo.com.tr/mainpage.aspx?code=${encodeURIComponent(takipNo)}" style="display: inline-block; padding: 12px 20px; background: #111; color: #fff; text-decoration: none; border-radius: 4px; font-weight: bold;">Kargomu Takip Et</a>` : ''}
                <br><br>
                <p>İyi günlerde kullanın!</p>
                <p><strong>Feyzay Ekibi</strong></p>
            </div>
        `;
        sendMail(musteriMaili, `Siparişiniz Kargoda (#${orderRow.id}) - Feyzay`, kargoMaili);
    }
    console.log(`[ARAS] Sipariş #${orderRow.id} geri bildirimi alındı, kargoda olarak işaretlendi (takip: ${takipNo || 'yok'}).`);
    return { transitioned: true, cargo };
}

// Sekmeye göre aşama etiketi (Excel çıktısı ve liste için ortak).
function asamaEtiketi(row) {
    if (row.cancel_reason) return 'İptal Edildi';
    if (row.cargo_state === 1) return 'Kargoda';
    if (row.approval_state === 1) return 'Kurye Bekleniyor';
    return 'Onay Bekliyor';
}

// Sekme filtrelerini SQL koşuluna çevirir (frontend'deki filtreyle birebir aynı).
function sekmeyeGoreFiltre(tab) {
    switch (tab) {
        case 'approval': return { sql: 'AND approval_state = 0 AND cancel_reason IS NULL', ad: 'Onay_Bekliyor' };
        case 'courier': return { sql: 'AND approval_state = 1 AND cargo_state != 1 AND cancel_reason IS NULL', ad: 'Kurye_Bekleniyor' };
        case 'transit': return { sql: 'AND cargo_state = 1', ad: 'Kargoda' };
        default: return { sql: '', ad: 'Tumu' };
    }
}

// Aktif sekmeyi (veya tümünü) Excel olarak indirir.
router.get('/api/admin/shipments/export', adminGerekli, (req, res) => {
    const tab = typeof req.query.tab === 'string' ? req.query.tab : 'all';
    const filtre = sekmeyeGoreFiltre(['all', 'approval', 'courier', 'transit'].includes(tab) ? tab : 'all');

    db.all(`SELECT id, created_at, first_name, last_name, phone, city, district, street, zipcode,
                   total_amount, cargo_state, cargo_tracking_code, aras_waybill, aras_error, cancel_reason, approval_state
            FROM orders
            WHERE payment_status = 1 ${filtre.sql}
            ORDER BY id DESC`, [], async (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Veritabanı hatası.' });

        let Excel;
        try {
            Excel = exceljsYukle();
        } catch (e) {
            return res.status(500).json({ success: false, message: 'Excel kütüphanesi yüklü değil: npm install exceljs' });
        }

        const workbook = new Excel.Workbook();
        const worksheet = workbook.addWorksheet('Kargo');
        worksheet.columns = [
            { header: 'Sipariş No', key: 'id', width: 12 },
            { header: 'Tarih', key: 'date', width: 22 },
            { header: 'İsim', key: 'firstName', width: 15 },
            { header: 'Soyisim', key: 'lastName', width: 15 },
            { header: 'Telefon', key: 'phone', width: 16 },
            { header: 'Şehir', key: 'city', width: 15 },
            { header: 'İlçe', key: 'district', width: 15 },
            { header: 'Adres', key: 'street', width: 35 },
            { header: 'Tutar (TL)', key: 'total', width: 12 },
            { header: 'Aşama', key: 'stage', width: 18 },
            { header: 'Aras İrsaliye', key: 'waybill', width: 16 },
            { header: 'Takip Kodu', key: 'tracking', width: 20 },
            { header: 'İptal Nedeni', key: 'cancelReason', width: 30 }
        ];
        worksheet.getRow(1).font = { bold: true };

        rows.forEach(row => {
            worksheet.addRow({
                id: row.id,
                date: new Date(row.created_at).toLocaleString('tr-TR'),
                firstName: safeDecrypt(row.first_name),
                lastName: safeDecrypt(row.last_name),
                phone: safeDecrypt(row.phone),
                city: safeDecrypt(row.city),
                district: safeDecrypt(row.district),
                street: safeDecrypt(row.street),
                total: row.total_amount,
                stage: asamaEtiketi(row),
                waybill: row.aras_waybill || '—',
                tracking: row.cargo_tracking_code || '—',
                cancelReason: row.cancel_reason || ''
            });
        });

        res.setHeader('Content-Disposition', `attachment; filename="Feyzay_Kargo_${filtre.ad}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        try {
            await workbook.xlsx.write(res);
            res.end();
        } catch (e) {
            res.status(500).end();
        }
    });
});

// Ödenmiş siparişleri kargo bilgileriyle listeler.
router.get('/api/admin/shipments', adminGerekli, (req, res) => {    db.all(`SELECT id, created_at, first_name, last_name, city, district,
                   payment_status, cargo_state, cargo_tracking_code, aras_waybill, aras_error, cancel_reason, approval_state, total_amount
            FROM orders
            WHERE payment_status = 1
            ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Veritabanı hatası.' });

        res.json({
            success: true,
            shipments: rows.map(row => ({
                id: row.id,
                createdAt: row.created_at,
                firstName: safeDecrypt(row.first_name),
                lastName: safeDecrypt(row.last_name),
                city: safeDecrypt(row.city),
                district: safeDecrypt(row.district),
                cargoState: row.cargo_state,
                cargoTrackingCode: row.cargo_tracking_code,
                arasWaybill: row.aras_waybill,
                arasError: row.aras_error,
                cancelReason: row.cancel_reason,
                approvalState: row.approval_state,
                totalAmount: row.total_amount
            }))
        });
    });
});

// Admin onayı: siparişi onaylar ve bilgilerini Aras Kargo'ya iletir (SetOrder).
router.post('/api/admin/shipments/:id/approve', adminGerekli, async (req, res) => {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId < 1) {
        return res.status(400).json({ success: false, message: 'Geçersiz sipariş numarası.' });
    }

    try {
        const order = await dbGet(`SELECT * FROM orders WHERE id = ? AND payment_status = 1`, [orderId]);
        if (!order) return res.status(404).json({ success: false, message: 'Ödenmiş sipariş bulunamadı.' });
        if (order.cancel_reason) return res.status(409).json({ success: false, message: 'İptal edilmiş sipariş onaylanamaz.' });
        if (order.cargo_state === 1) return res.status(409).json({ success: false, message: 'Sipariş zaten kargoda.' });

        // Onay her durumda işlenir; Aras aktarımı başarısızsa "Kurye Bekleniyor"
        // sekmesinde hata görünür ve "Tekrar Gönder" ile denenir.
        await new Promise((resolve, reject) => {
            db.run(`UPDATE orders SET approval_state = 1 WHERE id = ?`, [orderId], (err) => err ? reject(err) : resolve());
        });

        const orderObj = {
            firstName: safeDecrypt(order.first_name),
            lastName: safeDecrypt(order.last_name),
            phone: safeDecrypt(order.phone) || '05555555555',
            addressObj: {
                city: safeDecrypt(order.city),
                district: safeDecrypt(order.district),
                street: safeDecrypt(order.street)
            },
            cart: []
        };

        const result = await sendToArasKargo(order.id, orderObj);
        if (result) {
            res.json({ success: true, message: `Sipariş #${orderId} onaylandı ve Aras Kargo'ya iletildi.` });
        } else {
            const guncel = await dbGet(`SELECT aras_error FROM orders WHERE id = ?`, [orderId]);
            res.json({ success: false, message: 'Onaylandı ancak Aras aktarımı başarısız: ' + (guncel && guncel.aras_error ? guncel.aras_error : 'bilinmeyen hata') });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: 'Onay hatası: ' + e.message });
    }
});

// Aras Kargo'dan canlı durum getirir: SetOrder yansıma kontrolü + kargo durumu.
// Geri bildirim (takip numarası) geldiyse siparişi "Kargoda" aşamasına geçirir.
router.post('/api/admin/shipments/:id/status', adminGerekli, async (req, res) => {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId < 1) {
        return res.status(400).json({ success: false, message: 'Geçersiz sipariş numarası.' });
    }

    try {
        const order = await dbGet(`SELECT * FROM orders WHERE id = ? AND payment_status = 1`, [orderId]);
        if (!order) return res.status(404).json({ success: false, message: 'Ödenmiş sipariş bulunamadı.' });

        const integrationCode = INTEGRATION_PREFIX + orderId;

        let setOrder = null;
        try {
            setOrder = await getOrderWithIntegrationCode(integrationCode);
        } catch (e) {
            setOrder = { sent: false, cancelled: false, error: e.message };
        }

        let cargo = null;
        try {
            cargo = await queryCargoByIntegrationCode(integrationCode);
        } catch (e) {
            return res.json({ success: false, message: 'Kargo durumu sorgulanamadı: ' + e.message, setOrder });
        }

        const gecis = await geriBildirimIsle(order, cargo);

        res.json({
            success: true,
            integrationCode,
            setOrder: { sent: setOrder.sent, cancelled: Boolean(setOrder.cancelled), error: setOrder.error || null },
            cargo,
            transitioned: gecis.transitioned
        });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Sorgulama hatası: ' + e.message });
    }
});

// Ödenmiş siparişi Aras Kargo'ya (yeniden) iletir (SetOrder).
router.post('/api/admin/shipments/:id/send', adminGerekli, async (req, res) => {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId < 1) {
        return res.status(400).json({ success: false, message: 'Geçersiz sipariş numarası.' });
    }

    try {
        const order = await dbGet(`SELECT * FROM orders WHERE id = ? AND payment_status = 1`, [orderId]);
        if (!order) return res.status(404).json({ success: false, message: 'Ödenmiş sipariş bulunamadı.' });

        const orderObj = {
            firstName: safeDecrypt(order.first_name),
            lastName: safeDecrypt(order.last_name),
            phone: safeDecrypt(order.phone) || '05555555555',
            addressObj: {
                city: safeDecrypt(order.city),
                district: safeDecrypt(order.district),
                street: safeDecrypt(order.street)
            },
            cart: []
        };

        const result = await sendToArasKargo(order.id, orderObj);
        if (result) {
            res.json({ success: true, message: `Sipariş #${orderId} Aras Kargo'ya iletildi.` });
        } else {
            const guncel = await dbGet(`SELECT aras_error FROM orders WHERE id = ?`, [orderId]);
            res.json({ success: false, message: 'Aras Kargo aktarımı başarısız: ' + (guncel && guncel.aras_error ? guncel.aras_error : 'bilinmeyen hata') });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: 'Gönderim hatası: ' + e.message });
    }
});

// Siparişi HERHANGİ BİR AŞAMADA iptal eder:
//   - "Onay Bekliyor" (Aras'a hiç gönderilmemiş): Aras çağrısı yapılmaz, yalnızca
//     yerel kayıt iptal edilir ve müşteriye e-posta gönderilir.
//   - "Kurye Bekleniyor" / "Kargoda" (Aras'a gönderilmiş): önce CancelDispatch
//     denenir; Aras reddederse bile yerel iptal ve müşteri e-postası tamamlanır,
//     yanıtındaki arasWarning ile admin bilgilendirilir (manuel takip gerekir).
// Gövdedeki `reason` (zorunlu) müşteriye e-postayla bildirilir ve kayda yazılır.
router.post('/api/admin/shipments/:id/cancel', adminGerekli, async (req, res) => {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId < 1) {
        return res.status(400).json({ success: false, message: 'Geçersiz sipariş numarası.' });
    }

    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) {
        return res.status(400).json({ success: false, message: 'İptal nedeni zorunludur.' });
    }
    if (reason.length > 500) {
        return res.status(400).json({ success: false, message: 'İptal nedeni en fazla 500 karakter olabilir.' });
    }

    try {
        const order = await dbGet(`SELECT * FROM orders WHERE id = ? AND payment_status = 1`, [orderId]);
        if (!order) return res.status(404).json({ success: false, message: 'Ödenmiş sipariş bulunamadı.' });
        if (order.cancel_reason) return res.status(409).json({ success: false, message: 'Sipariş zaten iptal edilmiş.' });

        // Aras'a gönderilmemişse (onay bekliyor aşaması) Aras tarafını atla.
        const arasaGonderildi = order.approval_state === 1 || Boolean(order.aras_waybill);
        let arasWarning = null;
        if (arasaGonderildi) {
            const result = await cancelDispatch(INTEGRATION_PREFIX + orderId);
            if (!result.success) {
                arasWarning = `${result.code || '?'}: ${result.message || 'bilinmeyen Aras hatası'}`;
            }
        }

        // Yerel kaydı iptal et: kargo alanlarını temizle, nedeni sakla.
        db.run(`UPDATE orders SET approval_state = 0, cargo_state = 0, cargo_tracking_code = NULL, aras_waybill = NULL, aras_error = NULL, cancel_reason = ? WHERE id = ?`,
            [reason, orderId]);

        const musteriMaili = safeDecrypt(order.email);
        const musteriAdi = safeDecrypt(order.first_name) || 'Değerli Müşterimiz';
        if (musteriMaili) {
            const iptalMaili = `
                <div style="font-family: sans-serif; color: #111; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
                    <h2 style="color: #e74c3c;">Siparişiniz İptal Edildi</h2>
                    <p>Merhaba ${musteriAdi},</p>
                    <p><strong>#${orderId}</strong> numaralı siparişiniz iptal edilmiştir.</p>
                    <div style="background: #f9f9f9; padding: 15px; border-radius: 6px; margin: 20px 0;">
                        <p style="margin: 0;"><strong>İptal Nedeni:</strong> ${reason.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
                    </div>
                    <p>Ödemenizin iadesiyle ilgili bilgi için lütfen bizimle iletişime geçin.</p>
                    <p>Bizi tercih ettiğiniz için teşekkür ederiz.</p>
                    <p><strong>Feyzay Ekibi</strong></p>
                </div>
            `;
            sendMail(musteriMaili, `Siparişiniz İptal Edildi (#${orderId}) - Feyzay`, iptalMaili);
        }

        res.json({
            success: true,
            code: arasWarning ? 'LOCAL-ONLY' : '0',
            message: arasWarning
                ? `Sipariş iptal edildi ancak Aras kaydı iptal edilemedi: ${arasWarning}`
                : 'Sipariş iptal edildi.',
            arasWarning
        });
    } catch (e) {
        res.status(500).json({ success: false, message: 'İptal hatası: ' + e.message });
    }
});

// ---------------------------------------------------------------------
// Aras geri bildirimi için arka plan tarayıcısı: "Kurye Bekleniyor"
// aşamasındaki siparişlerde takip numarası oluştu mu diye düzenli aralıklarla
// Aras'ı sorgular; geri bildirim gelince siparişi "Kargoda"ya geçirir ve
// müşteriye e-posta gönderir. ARAS_POLL_MINUTES ile aralık ayarlanabilir (varsayılan 5).
// ---------------------------------------------------------------------
const POLL_DAKIKA = Math.max(1, Number(config.env.ARAS_POLL_MINUTES) || 5);

async function geriBildirimTara() {
    db.all(`SELECT * FROM orders
            WHERE payment_status = 1 AND approval_state = 1 AND cargo_state = 0 AND cancel_reason IS NULL
            ORDER BY id ASC`, [], async (err, rows) => {
        if (err) {
            console.error('[ARAS] Geri bildirim taraması DB hatası:', err.message);
            return;
        }
        for (const row of rows) {
            try {
                await geriBildirimIsle(row);
            } catch (e) {
                console.error(`[ARAS] Sipariş #${row.id} geri bildirim kontrolü hatası:`, e.message);
            }
            // Aras servisini yormamak için istekler arası kısa bekleme
            await new Promise(r => setTimeout(r, 1500));
        }
    });
}

setInterval(() => {
    geriBildirimTara().catch(e => console.error('[ARAS] Geri bildirim taraması hatası:', e.message));
}, POLL_DAKIKA * 60 * 1000).unref();

module.exports = router;
module.exports.geriBildirimIsle = geriBildirimIsle; // test/entegrasyon doğrulaması için
