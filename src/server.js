// Sunucu başlatma noktası.
const app = require('./app');
const config = require('./config');
const { katalogHazir } = require('./lib/catalog');

// Katalog (SQLite) hazır olmadan sipariş ve ürün uçları güvenilir çalışmaz.
katalogHazir.then(() => {
    app.listen(config.PORT, () => {
        console.log(`Sunucu ${config.SITE_URL} adresinde çalışıyor`);
    });
}).catch((err) => {
    console.error(`HATA: Katalog yüklenemedi (${err.message}). Sunucu başlatılamadı.`);
    process.exit(1);
});
