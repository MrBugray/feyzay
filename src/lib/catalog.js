// Ürün kataloğu: products.json okuma/yazma, mtime ile önbellek ve stok kontrolü.
const fs = require('fs');
const config = require('../config');

let katalogOnbellek = null;
let katalogMtime = 0;

function katalog() {
    const stat = fs.statSync(config.PRODUCTS_PATH);
    if (!katalogOnbellek || stat.mtimeMs !== katalogMtime) {
        katalogOnbellek = JSON.parse(fs.readFileSync(config.PRODUCTS_PATH, 'utf8'));
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

function urunleriOku() {
    return JSON.parse(fs.readFileSync(config.PRODUCTS_PATH, 'utf8'));
}

function urunleriYaz(urunler) {
    fs.writeFileSync(config.PRODUCTS_PATH, JSON.stringify(urunler, null, 4), 'utf8');
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

module.exports = { katalog, katalogUrun, stokYeterliMi, urunleriOku, urunleriYaz };
