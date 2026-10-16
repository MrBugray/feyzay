// SQLite bağlantısı, şema kurulumu ve yardımcı sorgu sarmalayıcıları.
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const config = require('./config');

if (!fs.existsSync(config.DATA_DIR)) fs.mkdirSync(config.DATA_DIR, { recursive: true });

const db = new sqlite3.Database(config.DB_PATH);

db.run('PRAGMA foreign_keys = ON');
db.run('PRAGMA journal_mode = WAL');

function dbGet(sql, params) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
}

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        first_name TEXT,
        last_name TEXT,
        city TEXT,
        district TEXT,
        street TEXT,
        zipcode TEXT,
        marketing_consent INTEGER DEFAULT 0,
        consent_date DATETIME
    )`);

    db.run(`ALTER TABLE users ADD COLUMN marketing_consent INTEGER DEFAULT 0`, () => { });
    db.run(`ALTER TABLE users ADD COLUMN consent_date DATETIME`, () => { });
    db.run(`ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0`, () => { });
    db.run(`ALTER TABLE users ADD COLUMN verify_token TEXT`, () => { });

    db.run(`CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at INTEGER NOT NULL
    )`);


    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        merchant_oid TEXT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        email TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        city TEXT,
        district TEXT,
        street TEXT,
        zipcode TEXT,
        phone TEXT,
        total_amount INTEGER NOT NULL DEFAULT 0,
        payment_status INTEGER DEFAULT 0,
        cargo_state INTEGER DEFAULT 0,
        cargo_tracking_code TEXT DEFAULT NULL,
        aras_waybill TEXT,
        aras_error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`ALTER TABLE orders ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`, () => { });
    db.run(`ALTER TABLE orders ADD COLUMN total_amount INTEGER NOT NULL DEFAULT 0`, () => { });
    db.run(`ALTER TABLE orders ADD COLUMN aras_waybill TEXT`, () => { });
    db.run(`ALTER TABLE orders ADD COLUMN aras_error TEXT`, () => { });

    db.run(`CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        beden TEXT NOT NULL,
        urun_id TEXT NOT NULL,
        urun_name TEXT NOT NULL,
        adet INTEGER NOT NULL,
        renk TEXT,
        FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
    )`);

    db.run(`ALTER TABLE order_items ADD COLUMN renk TEXT`, () => { });
    db.run(`ALTER TABLE orders ADD COLUMN phone TEXT`, () => { });
    db.run(`ALTER TABLE orders ADD COLUMN cancel_reason TEXT`, () => { });
    db.run(`ALTER TABLE orders ADD COLUMN approval_state INTEGER DEFAULT 0`, () => { });
});

module.exports = { db, dbGet };
