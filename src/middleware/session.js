// Oturum yönetimi (harici bağımlılık yok): çerez tabanlı SID + sessions tablosu.
const crypto = require('crypto');
const { db } = require('../db');

const OTURUM_COOKIE = 'feyzay_sid';
const OTURUM_SURESI_MS = 1000 * 60 * 60 * 24 * 30;

function cerezOku(req, ad) {
    const ham = req.headers.cookie;
    if (!ham) return null;
    for (const parca of ham.split(';')) {
        const i = parca.indexOf('=');
        if (i === -1) continue;
        if (parca.slice(0, i).trim() === ad) return decodeURIComponent(parca.slice(i + 1).trim());
    }
    return null;
}

function cerezYaz(res, sid, maxAgeSn) {
    const guvenli = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.append('Set-Cookie', `${OTURUM_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSn}${guvenli}`);
}

function oturumOlustur(res, userId, isAdmin, cb) {
    const sid = crypto.randomBytes(32).toString('base64url');
    const son = Date.now() + OTURUM_SURESI_MS;
    db.run(`INSERT INTO sessions (sid, user_id, is_admin, expires_at) VALUES (?, ?, ?, ?)`,
        [sid, userId, isAdmin ? 1 : 0, son], (err) => {
            if (err) return cb(err);
            cerezYaz(res, sid, Math.floor(OTURUM_SURESI_MS / 1000));
            cb(null);
        });
}

function oturumKapat(req, res, cb) {
    const sid = cerezOku(req, OTURUM_COOKIE);
    const bitir = () => {
        cerezYaz(res, '', 0);
        if (cb) cb();
    };
    if (!sid) return bitir();
    db.run(`DELETE FROM sessions WHERE sid = ?`, [sid], bitir);
}

function kullaniciGerekli(req, res, next) {
    if (!req.oturum || !req.oturum.user_id) {
        return res.status(401).json({ success: false, message: 'Giriş yapmanız gerekiyor.' });
    }
    next();
}

function adminGerekli(req, res, next) {
    if (!req.oturum || !req.oturum.is_admin) {
        return res.status(401).json({ success: false, message: 'Yetkisiz erişim.' });
    }
    next();
}

// Her istekte çerezdeki SID'ye göre req.oturum doldurur.
function oturumYukleyici(req, res, next) {
    req.oturum = null;
    const sid = cerezOku(req, OTURUM_COOKIE);
    if (!sid) return next();

    db.get(`SELECT * FROM sessions WHERE sid = ?`, [sid], (err, row) => {
        if (err || !row) return next();
        if (row.expires_at <= Date.now()) {
            db.run(`DELETE FROM sessions WHERE sid = ?`, [sid]);
            return next();
        }
        req.oturum = row;
        next();
    });
}

// Kullanım dışı kalan oturumları periyodik olarak temizle.
setInterval(() => {
    db.run(`DELETE FROM sessions WHERE expires_at <= ?`, [Date.now()]);
}, 1000 * 60 * 60).unref();

module.exports = { oturumYukleyici, oturumOlustur, oturumKapat, kullaniciGerekli, adminGerekli };
