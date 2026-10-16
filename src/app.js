// Express uygulaması: ara katman sıralama ve rota montajı. Port bağlama server.js'te.
const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const { oturumYukleyici } = require('./middleware/session');

const authRoutes = require('./routes/auth');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');
const shipmentRoutes = require('./routes/shipments');

const app = express();
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
    res.sendFile(config.PRODUCTS_PATH);
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
