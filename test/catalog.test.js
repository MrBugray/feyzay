// Birim testleri: SQLite destekli katalog (geçici DB, sunucu yok).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { testOrtamiKur, dbRun, temizle } = require('./helpers/bootstrap');

const ortam = testOrtamiKur();
let katalogModulu;

// Tohumlar katalog modülü yüklenmeden yazılır; ilk yükleme bunları görmelidir.
async function tohumla() {
    await dbRun(
        `INSERT INTO products (id, name, price, tags, sizes, colors, stock, image, images) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['RENKLI-01', 'Renkli Ürün', 100, JSON.stringify(['bandana']), JSON.stringify(['Standart']),
         JSON.stringify([{ name: 'Siyah', hex: '#000000', stock: 2, images: ['siyah.png'] }, { name: 'Bordo', hex: '#800000', stock: 0, images: [] }]),
         null, 'ana.png', null]
    );
    await dbRun(
        `INSERT INTO products (id, name, price, tags, sizes, colors, stock, image, images) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['DUZ-01', 'Düz Ürün', 50.5, null, null, null, 3, null, JSON.stringify(['a.png', 'b.png'])]
    );
    await dbRun(
        `INSERT INTO products (id, name, price, tags, sizes, colors, stock, image, images) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['BOS-01', 'Stoksuz Ürün', 25, null, null, null, null, null, null]
    );
    katalogModulu = require('../src/lib/catalog');
    await katalogModulu.katalogHazir;
}

after(async () => temizle(null, ortam.tmpDir));

test('tohumlama ve ilk yükleme', async () => {
    await tohumla();
    assert.equal(katalogModulu.katalog().length, 3);
});

test('katalog/katalogUrun: alanlar orijinal şekliyle geri kurulur', () => {
    const { katalog, katalogUrun } = katalogModulu;
    const renkli = katalogUrun('RENKLI-01');
    assert.equal(renkli.name, 'Renkli Ürün');
    assert.equal(renkli.price, 100);
    assert.deepEqual(renkli.tags, ['bandana']);
    assert.deepEqual(renkli.sizes, ['Standart']);
    assert.equal(renkli.colors.length, 2);
    assert.equal(renkli.colors[0].images[0], 'siyah.png');
    assert.equal(renkli.image, 'ana.png');
    assert.equal(renkli.stock, undefined); // null alanlar şekle eklenmez

    const duz = katalogUrun('DUZ-01');
    assert.equal(duz.stock, 3);
    assert.deepEqual(duz.images, ['a.png', 'b.png']);
    assert.equal(duz.colors, undefined);
    assert.equal(duz.tags, undefined);

    assert.equal(katalogUrun('OLMAYAN'), null);
    assert.equal(katalog().find(u => u.id === 'BOS-01').stock, undefined);
});

test('stokYeterliMi: renk stoku dalları', () => {
    const { katalogUrun, stokYeterliMi } = katalogModulu;
    const renkli = katalogUrun('RENKLI-01');
    assert.equal(stokYeterliMi(renkli, 'Siyah', 2), true);
    assert.equal(stokYeterliMi(renkli, 'Siyah', 3), false);
    assert.equal(stokYeterliMi(renkli, 'Bordo', 1), false);
    assert.equal(stokYeterliMi(renkli, 'Yeşil', 1), false); // olmayan renk
    assert.equal(stokYeterliMi(renkli, null, 2), true); // renk verilmezse ilk renk
    assert.equal(stokYeterliMi(renkli, null, 3), false);
});

test('stokYeterliMi: düz stok ve stoksuz ürün dalları', () => {
    const { katalogUrun, stokYeterliMi } = katalogModulu;
    assert.equal(stokYeterliMi(katalogUrun('DUZ-01'), null, 3), true);
    assert.equal(stokYeterliMi(katalogUrun('DUZ-01'), null, 4), false);
    assert.equal(stokYeterliMi(katalogUrun('BOS-01'), null, 999), true);
});

test('urunleriOku: derin kopya, önbellek etkilenmez', () => {
    const { urunleriOku, katalogUrun } = katalogModulu;
    const kopya = urunleriOku();
    kopya.find(u => u.id === 'RENKLI-01').colors[0].stock = 999;
    kopya.find(u => u.id === 'RENKLI-01').tags.push('yeni');
    kopya.push({ id: 'SAHTE' });
    assert.equal(katalogUrun('RENKLI-01').colors[0].stock, 2);
    assert.deepEqual(katalogUrun('RENKLI-01').tags, ['bandana']);
    assert.equal(katalogUrun('SAHTE'), null);
});

test('urunleriYaz: tabloyu ve önbelleği birlikte günceller', async () => {
    const { urunleriOku, urunleriYaz, katalogUrun, katalog } = katalogModulu;
    const liste = urunleriOku().filter(u => u.id !== 'BOS-01');
    liste.push({ id: 'YENI-01', name: 'Yeni Ürün', price: 10, stock: 1 });
    await new Promise((resolve, reject) => urunleriYaz(liste, (err) => err ? reject(err) : resolve()));
    assert.equal(katalog().length, 3);
    assert.equal(katalogUrun('BOS-01'), null);
    assert.equal(katalogUrun('YENI-01').name, 'Yeni Ürün');
    const { dbGet } = require('./helpers/bootstrap');
    assert.equal((await dbGet(`SELECT COUNT(*) c FROM products`)).c, 3);
});
