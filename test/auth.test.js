// Entegrasyon: kayıt → e-posta onayı → giriş → /api/me ve şifre sıfırlama akışı.
// Gerçek uygulama + geçici DB + sahte mail transport'u; gerçek mail gönderilmez.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { testOrtamiKur, uygulamaBaslat, istemci, dbGet, temizle } = require('./helpers/bootstrap');

const ortam = testOrtamiKur();
let base, server, api;

before(async () => {
    const u = await uygulamaBaslat();
    base = u.base;
    server = u.server;
    api = istemci(base);
});

after(async () => temizle(server, ortam.tmpDir));

test('signup: zayıf şifre reddedilir', async () => {
    const r = await api.req('POST', '/api/signup', { firstName: 'A', lastName: 'B', email: 'zayif@example.com', password: 'kisa' });
    assert.equal(r.status, 400);
    assert.equal(r.data.success, false);
});

test('signup: başarılı kayıt onay maili üretir (sahte transport)', async () => {
    const r = await api.req('POST', '/api/signup', { firstName: 'Ali', lastName: 'Veli', email: 'ali@example.com', password: 'Test1234', marketingConsent: true });
    assert.equal(r.data.success, true);
    const mail = ortam.mailler.find(m => m.to === 'ali@example.com');
    assert.ok(mail, 'onay maili yakalanmalı');
    assert.equal(mail.subject, 'Feyzay - Hesabınızı Onaylayın');
    assert.ok(mail.html.includes('/api/verify-email?token='));
});

test('signup: aynı e-posta ikinci kez kaydedilemez', async () => {
    const r = await api.req('POST', '/api/signup', { firstName: 'Ali', lastName: 'Veli', email: 'ali@example.com', password: 'Test1234' });
    assert.equal(r.status, 400);
    assert.equal(r.data.message, 'Bu E-posta zaten kayıtlı.');
});

test('login: onaysız hesap ve yanlış şifre reddedilir', async () => {
    const onaysiz = await api.req('POST', '/api/login', { email: 'ali@example.com', password: 'Test1234' });
    assert.equal(onaysiz.status, 403);

    await api.req('GET', '/api/verify-email?token=' + (await dbGet(`SELECT verify_token t FROM users WHERE email = 'ali@example.com'`)).t);
    const yanlis = await api.req('POST', '/api/login', { email: 'ali@example.com', password: 'Yanlis1' });
    assert.equal(yanlis.status, 401);
});

test('verify-email: onay sonrası otomatik giriş yapılır', async () => {
    await api.req('POST', '/api/signup', { firstName: 'Oto', lastName: 'Giris', email: 'oto@example.com', password: 'Test1234' });
    const token = (await dbGet(`SELECT verify_token t FROM users WHERE email = 'oto@example.com'`)).t;
    const onay = await api.req('GET', '/api/verify-email?token=' + token);
    assert.equal(onay.status, 200);

    // Ayrı bir oturum açma isteği olmadan /api/me kullanıcıyı dönmeli (oturum çerezi onay sırasında yazıldı).
    const bilgi = await api.req('GET', '/api/me');
    assert.equal(bilgi.data.user.email, 'oto@example.com');
    await api.req('POST', '/api/logout');
});

test('verify-email + login + /api/me akışı', async () => {
    const giris = await api.req('POST', '/api/login', { email: 'ali@example.com', password: 'Test1234' });
    assert.equal(giris.data.success, true);
    const bilgi = await api.req('GET', '/api/me');
    assert.equal(bilgi.data.user.email, 'ali@example.com');
    assert.equal(bilgi.data.user.firstName, 'Ali');
    assert.equal(bilgi.data.isAdmin, false);
});

test('forgot-password: kayıtlı/kayıtsız e-posta aynı yanıtı verir', async () => {
    const mesaj = 'Eğer bu e-posta kayıtlıysa, şifre sıfırlama bağlantısı gönderildi.';
    const var1 = await api.req('POST', '/api/forgot-password', { email: 'ali@example.com' });
    const yok = await api.req('POST', '/api/forgot-password', { email: 'yok@example.com' });
    assert.deepEqual(var1.data, { success: true, message: mesaj });
    assert.deepEqual(yok.data, { success: true, message: mesaj });

    const mail = ortam.mailler.find(m => m.subject === 'Feyzay - Şifre Sıfırlama' && m.to === 'ali@example.com');
    assert.ok(mail, 'sıfırlama maili yakalanmalı');
    assert.ok(mail.html.includes('/sifre-sifirla.html?token='));
    assert.ok(mail.html.includes('1 saat'));
});

test('reset-password: zayıf şifre, geçersiz token, tek kullanım ve eski şifre', async () => {
    const token = (await dbGet(`SELECT reset_token t FROM users WHERE email = 'ali@example.com'`)).t;
    assert.ok(token);

    const zayif = await api.req('POST', '/api/reset-password', { token, password: 'kisa' });
    assert.equal(zayif.status, 400);

    const gecersiz = await api.req('POST', '/api/reset-password', { token: 'olmayan-token', password: 'YeniSifre1' });
    assert.equal(gecersiz.status, 400);
    assert.equal(gecersiz.data.message, 'Geçersiz veya süresi dolmuş bağlantı.');

    const iyi = await api.req('POST', '/api/reset-password', { token, password: 'YeniSifre1' });
    assert.equal(iyi.data.success, true);

    const tekrar = await api.req('POST', '/api/reset-password', { token, password: 'YeniSifre1' });
    assert.equal(tekrar.status, 400); // token tek kullanımlık

    const eski = await api.req('POST', '/api/login', { email: 'ali@example.com', password: 'Test1234' });
    assert.equal(eski.status, 401);
    const yeni = await api.req('POST', '/api/login', { email: 'ali@example.com', password: 'YeniSifre1' });
    assert.equal(yeni.data.success, true);
});

test('reset-password: süresi dolmuş token reddedilir', async () => {
    const { dbRun } = require('./helpers/bootstrap');
    await api.req('POST', '/api/forgot-password', { email: 'ali@example.com' });
    await dbRun(`UPDATE users SET reset_expires = ? WHERE email = 'ali@example.com'`, [Date.now() - 1000]);
    const token = (await dbGet(`SELECT reset_token t FROM users WHERE email = 'ali@example.com'`)).t;
    const r = await api.req('POST', '/api/reset-password', { token, password: 'BaskaSifre1' });
    assert.equal(r.status, 400);
    assert.equal(r.data.message, 'Geçersiz veya süresi dolmuş bağlantı.');
});
