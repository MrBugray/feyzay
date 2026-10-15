// Alan şifreleme (AES-256-GCM) ve parola özetleme (scrypt).
const crypto = require('crypto');
const config = require('../config');

const CRYPTO_VERSION = 'v1';

function encryptData(text) {
    if (text === undefined || text === null || text === '' || text === 'undefined' || text === 'null') return '';
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', config.SECRET_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [CRYPTO_VERSION, iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');
}

function decryptData(text) {
    if (!text) return '';
    const parts = String(text).split(':');
    if (parts.length !== 4 || parts[0] !== CRYPTO_VERSION) {
        throw new Error('Şifreli veri biçimi tanınmadı.');
    }
    const [, ivHex, tagHex, dataHex] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', config.SECRET_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return decrypted.toString('utf8');
}

(function anahtarKontrolu() {
    const prob = 'feyzay-anahtar-kontrolu';
    if (decryptData(encryptData(prob)) !== prob) {
        console.error('HATA: SECRET_CRYPT_KEY doğrulanamadı.');
        process.exit(1);
    }
})();

const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, SCRYPT_KEYLEN = 64;

function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('hex'), hash.toString('hex')].join('$');
}

function verifyPassword(password, stored) {
    if (typeof stored !== 'string' || typeof password !== 'string') return false;
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltHex, hashHex] = parts;
    const beklenen = Buffer.from(hashHex, 'hex');
    const hesaplanan = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), beklenen.length, {
        N: Number(n), r: Number(r), p: Number(p)
    });
    return crypto.timingSafeEqual(beklenen, hesaplanan);
}

module.exports = { encryptData, decryptData, hashPassword, verifyPassword };
