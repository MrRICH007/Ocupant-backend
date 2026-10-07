const path = require('path');
const Database = require('better-sqlite3');
require('dotenv').config();

const dbFile = process.env.DB_FILE || 'ocupant.db';
const db = new Database(path.resolve(__dirname, dbFile));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'basic',
  premium_until TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS houses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  location TEXT NOT NULL,
  generic_location TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'vacant',
  beds INTEGER NOT NULL DEFAULT 1,
  baths INTEGER NOT NULL DEFAULT 1,
  area TEXT,
  first_year_price INTEGER NOT NULL,
  subsequent_price INTEGER NOT NULL,
  image TEXT,
  description TEXT,
  owner_name TEXT NOT NULL,
  owner_phone TEXT NOT NULL,
  owner_whatsapp TEXT NOT NULL,
  google_maps_url TEXT,
  videos TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roommate_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  house_id INTEGER NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  budget INTEGER,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, house_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tx_ref TEXT NOT NULL UNIQUE,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  flutterwave_tx_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  house_id INTEGER NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Safe migration for existing databases created before videos/maps were added.
function addColumnIfMissing(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumnIfMissing('houses', 'google_maps_url', 'TEXT');
addColumnIfMissing('houses', 'videos', 'TEXT');

module.exports = db;
