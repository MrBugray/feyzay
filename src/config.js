// Ortam değişkenleri ve yol sabitleri. Tüm process.env okumaları buradan yapılır.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'database.sqlite');
const PRODUCTS_PATH = path.join(DATA_DIR, 'products.json');

if (!process.env.SECRET_CRYPT_KEY) {
    console.error("HATA: SECRET_CRYPT_KEY .env dosyasında bulunamadı! Sunucu başlatılamıyor.");
    process.exit(1);
}

const crypto = require('crypto');

module.exports = {
    ROOT_DIR,
    DATA_DIR,
    PUBLIC_DIR,
    DB_PATH,
    PRODUCTS_PATH,
    SECRET_KEY: crypto.createHash('sha256').update(process.env.SECRET_CRYPT_KEY).digest(),
    PORT: process.env.PORT || 3000,
    SITE_URL: process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`,
    env: process.env
};
