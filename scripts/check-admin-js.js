// admin.html içindeki scripti sahte bir DOM ile çalıştırıp başlangıç hatası
// olup olmadığını denetler. Bir hata oluşursa sonraki tüm event handler'lar
// (sol menü dahil) hiç bağlanmaz — tıklanamazlığın tipik sebebi budur.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'admin.html'), 'utf8');
const bloklar = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
console.log('script bloğu sayısı:', bloklar.length);

const yap = () => ({
    addEventListener() { }, onclick: null, value: '', textContent: '', innerHTML: '',
    style: {}, dataset: {}, disabled: false,
    classList: { add() { }, remove() { }, contains() { return false; } },
    appendChild() { }, remove() { }, click() { }, closest() { return null; },
    querySelectorAll() { return []; }, querySelector() { return null; }
});
const elemanlar = {};
global.document = {
    getElementById(id) { return elemanlar[id] || (elemanlar[id] = yap()); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    createElement() { return yap(); },
    body: yap()
};
global.window = { location: { href: '' } };
global.fetch = async () => ({ status: 200, json: async () => ({ success: false }), headers: { get: () => null } });
global.confirm = () => true;
global.prompt = () => 'test';
global.location = { href: '', reload() { } };

let hata = null;
try {
    for (const kod of bloklar) new Function(kod)();
} catch (e) {
    hata = e;
}
if (hata) {
    console.log('SCRIPT ÇALIŞMA HATASI:', hata.message);
    process.exit(1);
} else {
    console.log('Script hatasız çalıştı (handler bağlama adımlarına kadar).');
}
