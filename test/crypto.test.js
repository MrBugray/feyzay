// Birim testleri: alan şifreleme ve parola özetleme (sunucu yok, geçici env).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { testOrtamiKur, temizle } = require('./helpers/bootstrap');

const ortam = testOrtamiKur();
const { encryptData, decryptData, hashPassword, verifyPassword } = require('../src/lib/crypto');

after(async () => temizle(null, ortam.tmpDir));

test('encryptData/decryptData: metin ve unicode içerik geri çözülür', () => {
    for (const metin of ['merhaba', 'Şifreli İçerik ğüşıöç 123', '{"mahalle":"Atatürk Mah."}']) {
        const sifreli = encryptData(metin);
        assert.equal(sifreli.split(':').length, 4);
        assert.equal(sifreli.split(':')[0], 'v1');
        assert.notEqual(sifreli, metin);
        assert.equal(decryptData(sifreli), metin);
    }
});

test('encryptData: boş/null girdiler boş metin döndürür', () => {
    for (const girdi of ['', null, undefined, 'undefined', 'null']) {
        assert.equal(encryptData(girdi), '');
    }
    assert.equal(decryptData(''), '');
    assert.equal(decryptData(null), '');
});

test('encryptData: aynı metin her seferinde farklı şifreli değer üretir (IV)', () => {
    assert.notEqual(encryptData('aynı'), encryptData('aynı'));
});

test('decryptData: bozuk veya tanınmayan girdiyi reddeder', () => {
    for (const bozuk of ['duz-metin', 'v1:abc:def', 'v2:aa:bb:cc', 'v1:zz:zz:zz']) {
        assert.throws(() => decryptData(bozuk));
    }
});

test('decryptData: kurcalanmış şifreli veri açılamaz', () => {
    const sifreli = encryptData('gizli');
    const parcalar = sifreli.split(':');
    parcalar[3] = parcalar[3].slice(0, -2) + (parcalar[3].endsWith('00') ? '11' : '00');
    assert.throws(() => decryptData(parcalar.join(':')));
});

test('hashPassword/verifyPassword: doğru parola kabul, yanlış parola red', () => {
    const hash = hashPassword('Test1234');
    assert.equal(hash.split('$')[0], 'scrypt');
    assert.equal(verifyPassword('Test1234', hash), true);
    assert.equal(verifyPassword('Yanlis123', hash), false);
    assert.notEqual(hashPassword('Test1234'), hash); // tuz her seferinde farklı
});

test('verifyPassword: bozuk kayıtlı hash ve geçersiz tipler reddedilir', () => {
    for (const bozuk of ['xyz', 'scrypt$1$2$3', null, undefined, 42, '']) {
        assert.equal(verifyPassword('Test1234', bozuk), false);
    }
    assert.equal(verifyPassword(null, hashPassword('Test1234')), false);
});
