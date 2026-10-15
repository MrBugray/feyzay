const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const ExcelJS = require('exceljs');
const config = require('../src/config');
const { decryptData } = require('../src/lib/crypto');

// Eski biçimli/ bozuk şifreli alanları çökertmeden atlamak için güvenli çözücü.
function coz(metin) {
    try {
        return decryptData(metin);
    } catch (e) {
        return '';
    }
}

const db = new sqlite3.Database(config.DB_PATH, (err) => {
    if (err) process.exit(1);
});

const sql = `
    SELECT o.id, o.created_at, o.first_name, o.last_name, o.email, o.city, o.district, o.street, o.zipcode, o.cargo_state, o.cargo_tracking_code,
           i.urun_id, i.urun_name, i.beden, i.adet
    FROM orders o
    LEFT JOIN order_items i ON o.id = i.order_id
    ORDER BY o.id DESC
`;

db.all(sql, [], async (err, rows) => {
    if (err) {
        console.error("Veri çekilirken hata:", err);
        db.close();
        return;
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Siparişler');
    worksheet.columns = [
        { header: 'Sipariş No', key: 'id', width: 12 },
        { header: 'Tarih', key: 'date', width: 22 },
        { header: 'İsim', key: 'firstName', width: 15 },
        { header: 'Soyisim', key: 'lastName', width: 15 },
        { header: 'E-posta', key: 'email', width: 30 },
        { header: 'Mahalle', key: 'mahalle', width: 20 },
        { header: 'Cadde / Sokak', key: 'cadde', width: 25 },
        { header: 'Bina/Daire No', key: 'binaNo', width: 15 },
        { header: 'Şehir / İl', key: 'city', width: 15 },
        { header: 'İlçe', key: 'district', width: 15 },
        { header: 'Posta Kodu', key: 'zipcode', width: 12 },
        { header: 'Ürün ID', key: 'urunId', width: 15 },
        { header: 'Ürün Adı', key: 'urunName', width: 40 },
        { header: 'Beden', key: 'beden', width: 12 },
        { header: 'Adet', key: 'adet', width: 8 },
        { header: 'Kargo Durumu', key: 'cargoState', width: 20 },
        { header: 'Takip Kodu', key: 'cargoCode', width: 20 }
    ];

    worksheet.getRow(1).font = { bold: true };

    rows.forEach(row => {
        let decryptedStreet = coz(row.street);
        let mahalle = '', cadde = '', binaNo = '';

        try {
            let streetObj = JSON.parse(decryptedStreet);
            mahalle = streetObj.mahalle || '';
            cadde = streetObj.cadde || '';
            binaNo = streetObj.binaNo || '';
        } catch (e) {
            cadde = decryptedStreet || '';
        }

        worksheet.addRow({
            id: row.id,
            date: new Date(row.created_at).toLocaleString('tr-TR'),
            firstName: coz(row.first_name),
            lastName: coz(row.last_name),
            email: coz(row.email),
            mahalle: mahalle,
            cadde: cadde,
            binaNo: binaNo,
            city: coz(row.city),
            district: coz(row.district),
            zipcode: coz(row.zipcode),
            urunId: row.urun_id,
            urunName: row.urun_name,
            beden: row.beden,
            adet: row.adet,
            cargoState: row.cargo_state === 1 ? 'Kargoya Verildi' : 'Hazırlanıyor',
            cargoCode: row.cargo_tracking_code || 'Atanmadı'
        });
    });

    const fileName = 'Feyzay_Siparisler.xlsx';
    await workbook.xlsx.writeFile(path.join(config.ROOT_DIR, fileName));
    db.close();
    console.log(`Siparişler "${fileName}" olarak kaydedildi `);
});
