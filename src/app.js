// Express uygulaması: ara katman sıralama ve rota montajı. Port bağlama server.js'te.
const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const { oturumYukleyici } = require('./middleware/session');
const { katalog } = require('./lib/catalog');

const authRoutes = require('./routes/auth');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');
const shipmentRoutes = require('./routes/shipments');

const app = express();
// Reverse proxy (nginx/Cloudflare vb.) arkasında gerçek müşteri IP'sini almak için;
// PayTR user_ip alanında kullanılır.
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cors({
    origin: config.env.SITE_URL || false,
    credentials: true
}));

app.use(oturumYukleyici);

// Yalnızca public/ dizini statik sunulur; src/, data/, scripts/ asla dışarı açılmaz.
// HTML/JS/CSS için no-cache: tarayıcı her yüklemede yeniden doğrular (ETag ile ucuzdur),
// böylece panel/site güncellemeleri kullanıcıya eski dosyayla gitmez.
app.use(express.static(config.PUBLIC_DIR, {
    dotfiles: 'deny',
    index: false,
    setHeaders: (res, yol) => {
        if (/\.(html|js|css)$/i.test(yol)) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// Ürün kataloğu istemciler tarafından bu adresten okunur.
app.get('/products.json', (req, res) => {
    res.json(katalog());
});

// Arama motorları: robots.txt ve ürün kataloğundan üretilen sitemap.xml
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send([
        'User-agent: *',
        'Allow: /',
        'Disallow: /admin.html',
        'Disallow: /kayit.html',
        'Disallow: /sifre-sifirla.html',
        '',
        `Sitemap: ${config.SITE_URL}/sitemap.xml`,
        ''
    ].join('\n'));
});

app.get('/sitemap.xml', (req, res) => {
    try {
        const products = katalog();
        const base = config.SITE_URL.replace(/\/+$/, '');
        const statikSayfalar = [
            '',
            'urunler.html',
            'teslimat-odeme-kosullari.html',
            'iptal-iade-kosullari.html',
            'on-bilgilendirme-formu.html',
            'mesafeli-satis-sozlesmesi.html',
            'gizlilik-politikasi.html',
            'kvkk.html',
            'kullanim-sartlari.html'
        ];
        const urls = statikSayfalar
            .map(p => `  <url><loc>${base}/${p}</loc></url>`)
            .concat(products.map(p => `  <url><loc>${base}/detay.html?id=${encodeURIComponent(p.id)}</loc></url>`));
        res.type('application/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`);
    } catch (err) {
        res.status(500).send('Sitemap oluşturulamadı.');
    }
});

app.use(authRoutes);
app.use(orderRoutes);
app.use(adminRoutes);
app.use(shipmentRoutes);

app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(config.PUBLIC_DIR, 'index.html'));
});

module.exports = app;
