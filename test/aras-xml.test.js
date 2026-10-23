// Birim testleri: Aras XML kaçış yardımcıları (saf fonksiyonlar, ağ yok).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { testOrtamiKur, temizle } = require('./helpers/bootstrap');

const ortam = testOrtamiKur();
const { xmlKacis, cdataKacis } = require('../src/services/arasKargo');

after(async () => temizle(null, ortam.tmpDir));

test('xmlKacis: özel karakterleri XML varlıklarına çevirir', () => {
    assert.equal(xmlKacis(`<a>&"'</a>`), '&lt;a&gt;&amp;&quot;&apos;&lt;/a&gt;');
    assert.equal(xmlKacis('Düz Metin 123'), 'Düz Metin 123');
});

test('xmlKacis: null/undefined/sayı güvenli', () => {
    assert.equal(xmlKacis(null), '');
    assert.equal(xmlKacis(undefined), '');
    assert.equal(xmlKacis(42), '42');
});

test('cdataKacis: CDATA kapanışını böler', () => {
    assert.equal(cdataKacis('a]]>b'), 'a]]]]><![CDATA[>b');
    assert.equal(cdataKacis('normal'), 'normal');
    assert.equal(cdataKacis(null), '');
});
