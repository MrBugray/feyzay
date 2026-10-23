// Entegrasyon: ürün kataloğu, sitemap ve robots (tohum ürünler geçici DB'de).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { testOrtamiKur, uygulamaBaslat, istemci, dbRun, temizle } = require('./helpers/bootstrap');

const ortam = testOrtamiKur();
let base, server, api;

before(async () => {
    // Ürünler katalog modülü yüklenmeden tohumlanır.
    await dbRun(
        `INSERT INTO products (id, name, price, tags, sizes, colors, stock, image, images) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['TEST-URN-1', 'Test Ürün 1', 99.9, JSON.stringify(['bandana']), JSON.stringify(['Standart']),
         JSON.stringify([{ name: 'Siyah', hex: '#000', stock: 5, images: ['x.png'] }]), null, null, null]
    );
    await dbRun(
        `INSERT INTO products (id, name, price, tags, sizes, colors, stock, image, images) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['TEST-URN-2', 'Test Ürün 2', 49.9, null, null, null, 7, 'y.png', null]
    );
    const u = await uygulamaBaslat();
    base = u.base;
    server = u.server;
    api = istemci(base);
});

after(async () => temizle(server, ortam.tmpDir));

test('GET /products.json: tohum katalog döner', async () => {
    const r = await api.req('GET', '/products.json');
    assert.equal(r.status, 200);
    assert.equal(r.data.length, 2);
    const urun = r.data.find(u => u.id === 'TEST-URN-1');
    assert.equal(urun.name, 'Test Ürün 1');
    assert.equal(urun.price, 99.9);
    assert.deepEqual(urun.tags, ['bandana']);
    assert.equal(urun.colors[0].stock, 5);
    assert.equal(r.data.find(u => u.id === 'TEST-URN-2').stock, 7);
});

test('GET /sitemap.xml: statik sayfalar + ürün URL\'leri', async () => {
    const r = await api.req('GET', '/sitemap.xml');
    assert.equal(r.status, 200);
    const urlSayisi = (r.data.match(/<url>/g) || []).length;
    assert.equal(urlSayisi, 11); // 9 statik sayfa + 2 ürün
    assert.ok(r.data.includes('/detay.html?id=TEST-URN-1'));
    assert.ok(r.data.includes('/detay.html?id=TEST-URN-2'));
    assert.ok(r.data.includes('/kvkk.html'));
});

test('GET /robots.txt: özel sayfalar engelli', async () => {
    const r = await api.req('GET', '/robots.txt');
    assert.equal(r.status, 200);
    for (const yol of ['/admin.html', '/kayit.html', '/sifre-sifirla.html']) {
        assert.ok(r.data.includes(`Disallow: ${yol}`), yol);
    }
    assert.ok(r.data.includes('Sitemap:'));
});
