// Ürün kataloğu: SQLite üzerinde saklanır; senkron çağrılar için bellek içi önbellek.
// products.json'dan ilk açılışta tek seferlik içe aktarım yapılır, dosya silinir.
const fs = require('fs');
const { db } = require('../db');
const config = require('../config');

let katalogOnbellek = [];

function satirdanUrun(satir) {
    const urun = {
        id: satir.id,
        name: satir.name,
        price: satir.price
    };
    if (satir.tags !== null) urun.tags = JSON.parse(satir.tags);
    if (satir.sizes !== null) urun.sizes = JSON.parse(satir.sizes);
    if (satir.colors !== null) urun.colors = JSON.parse(satir.colors);
    if (satir.stock !== null) urun.stock = satir.stock;
    if (satir.image !== null) urun.image = satir.image;
    if (satir.images !== null) urun.images = JSON.parse(satir.images);
    if (satir.description !== null && satir.description !== undefined) urun.description = satir.description;
    return urun;
}

function urundenSatir(urun) {
    return [
        urun.id,
        urun.name,
        urun.price,
        urun.tags !== undefined ? JSON.stringify(urun.tags) : null,
        urun.sizes !== undefined ? JSON.stringify(urun.sizes) : null,
        urun.colors !== undefined ? JSON.stringify(urun.colors) : null,
        urun.stock !== undefined ? urun.stock : null,
        urun.image !== undefined ? urun.image : null,
        urun.images !== undefined ? JSON.stringify(urun.images) : null,
        urun.description !== undefined ? urun.description : null
    ];
}

function tumunuYukle() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM products', [], (err, satirlar) => {
            if (err) return reject(err);
            katalogOnbellek = satirlar.map(satirdanUrun);
            resolve(katalogOnbellek);
        });
    });
}

// Tablo boşsa ve products.json hâlâ duruyorsa tek seferlik içe aktar.
function gerekirseIceAktar(urunler) {
    if (urunler.length > 0 || !fs.existsSync(config.PRODUCTS_PATH)) return Promise.resolve(urunler);

    let dosyaUrunleri;
    try {
        dosyaUrunleri = JSON.parse(fs.readFileSync(config.PRODUCTS_PATH, 'utf8'));
        if (!Array.isArray(dosyaUrunleri) || dosyaUrunleri.length === 0) throw new Error('katalog boş');
    } catch (err) {
        return Promise.reject(new Error(`products.json okunamadı (${err.message})`));
    }

    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            let hata = null;
            dosyaUrunleri.forEach(urun => {
                db.run(
                    'INSERT INTO products (id, name, price, tags, sizes, colors, stock, image, images, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    urundenSatir(urun),
                    (err) => { if (err && !hata) hata = err; }
                );
            });
            // Sıradaki son adım: eklemeler bittiğinde hata varsa geri al, yoksa onayla.
            db.run('SELECT 1', [], () => {
                db.run(hata ? 'ROLLBACK' : 'COMMIT', (err) => {
                    if (err || hata) return reject(hata || err);
                    console.log(`Katalog products.json'dan SQLite'e aktarıldı: ${dosyaUrunleri.length} ürün.`);
                    try {
                        fs.unlinkSync(config.PRODUCTS_PATH);
                    } catch (e) {
                        console.error(`UYARI: products.json silinemedi (${e.message}).`);
                    }
                    katalogOnbellek = dosyaUrunleri;
                    resolve(katalogOnbellek);
                });
            });
        });
    });
}

// İlk yükleme tamamlanmadan senkron fonksiyonlar güvenilir sonuç vermez;
// server.js dinlemeye bu söz çözülünce başlar.
const katalogHazir = tumunuYukle()
    .then(gerekirseIceAktar)
    .then((urunler) => {
        console.log(`Katalog yüklendi: ${urunler.length} ürün.`);
        return urunler;
    });

function katalog() {
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

// Admin rotaları döndürülen listeyi değiştirdiği için önbelleğin kopyası verilir.
function urunleriOku() {
    return JSON.parse(JSON.stringify(katalogOnbellek));
}

// Tüm tabloyu yeniden yazar; yalnızca admin ürün CRUD'u kullanır.
function urunleriYaz(urunler, cb) {
    cb = cb || function () { };
    db.serialize(() => {
        db.run('DELETE FROM products');
        let hata = null;
        urunler.forEach(urun => {
            db.run(
                'INSERT INTO products (id, name, price, tags, sizes, colors, stock, image, images, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                urundenSatir(urun),
                (err) => { if (err && !hata) hata = err; }
            );
        });
        db.run('SELECT 1', [], () => {
            if (hata) return cb(hata);
            katalogOnbellek = JSON.parse(JSON.stringify(urunler));
            cb(null);
        });
    });
}

module.exports = { katalog, katalogUrun, stokYeterliMi, urunleriOku, urunleriYaz, katalogHazir };
