import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { cfg } from './env.js';

mkdirSync(dirname(cfg.dbPath), { recursive: true });
export const db = new DatabaseSync(cfg.dbPath);
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS items (
  item_code TEXT PRIMARY KEY, keyword TEXT, name TEXT, item_url TEXT, affiliate_url TEXT,
  image TEXT, shop TEXT, first_seen TEXT, last_seen TEXT, last_price INTEGER, last_available INTEGER
);
CREATE TABLE IF NOT EXISTS prices (item_code TEXT, price INTEGER, available INTEGER, at TEXT);
CREATE INDEX IF NOT EXISTS prices_item ON prices(item_code, at);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, item_code TEXT, keyword TEXT, kind TEXT, text TEXT,
  price INTEGER, prev_price INTEGER, status TEXT, reason TEXT, threads_id TEXT, created_at TEXT
);
CREATE INDEX IF NOT EXISTS posts_created ON posts(created_at);
CREATE TABLE IF NOT EXISTS clicks (post_id INTEGER, item_code TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
`);

for (const col of ['views INTEGER', 'engagement INTEGER', 'bsky_uri TEXT', 'pin_id TEXT']) {
  try { db.exec(`ALTER TABLE posts ADD COLUMN ${col}`); } catch {}
}
for (const col of ['source TEXT', 'affiliate_rate REAL', 'review_count INTEGER', 'review_avg REAL']) {
  try { db.exec(`ALTER TABLE items ADD COLUMN ${col}`); } catch {}
}

export const now = () => new Date().toISOString();
export const kvGet = (k) => db.prepare('SELECT v FROM kv WHERE k=?').get(k)?.v;
export const kvSet = (k, v) => db.prepare('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));
