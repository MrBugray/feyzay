// Sunucu başlatma noktası.
const app = require('./app');
const config = require('./config');

app.listen(config.PORT, () => {
    console.log(`Sunucu ${config.SITE_URL} adresinde çalışıyor`);
});
