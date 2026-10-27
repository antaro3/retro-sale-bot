// 運用状況の集計。判定基準の調整用に public/stats.json として公開する（個人情報・キーは含まない）
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { db } from './db.js';
import { cfg } from './env.js';

const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();

export function computeStats(extra = {}) {
  const tracked = db.prepare('SELECT COUNT(*) n FROM items WHERE last_seen>=?').get(ago(48)).n;
  // 直近24時間の価格変動（同じ商品の連続する記録どうしを比べる）
  const rows = db.prepare('SELECT item_code c, price p, available a, at FROM prices WHERE at>=? ORDER BY item_code, at').all(ago(48));
  const since = ago(24);
  const buckets = { '1-3%': 0, '3-5%': 0, '5-7%': 0, '7-10%': 0, '10%+': 0 };
  let up = 0, restock = 0, changed = new Set();
  const biggest = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.c !== b.c || b.at < since) continue;
    if (!a.a && b.a) restock++;
    if (b.p === a.p) continue;
    changed.add(b.c);
    if (b.p > a.p) { up++; continue; }
    const pct = (1 - b.p / a.p) * 100;
    const k = pct >= 10 ? '10%+' : pct >= 7 ? '7-10%' : pct >= 5 ? '5-7%' : pct >= 3 ? '3-5%' : pct >= 1 ? '1-3%' : null;
    if (k) buckets[k]++;
    biggest.push({ pct: Math.round(pct * 10) / 10, price: b.p });
  }
  biggest.sort((x, y) => y.pct - x.pct);
  const posts = db.prepare("SELECT status, COUNT(*) n FROM posts WHERE created_at>=? GROUP BY status").all(ago(24 * 7));
  return {
    updatedAt: new Date().toISOString(),
    mode: cfg.dryRun ? 'dry' : 'live',
    tracked,
    priceChanges24h: changed.size,
    drops24h: buckets,
    rises24h: up,
    restocks24h: restock,
    topDrops24h: biggest.slice(0, 10),
    posts7d: Object.fromEntries(posts.map((r) => [r.status, r.n])),
    rules: { minDropPct: cfg.rules.minDropPct, maxPostsPerDay: cfg.rules.maxPostsPerDay, minAffiliateRate: cfg.rules.minAffiliateRate },
    ...extra,
  };
}

export function writeStats(extra) {
  const s = computeStats(extra);
  mkdirSync(cfg.publicDir, { recursive: true });
  writeFileSync(join(cfg.publicDir, 'stats.json'), JSON.stringify(s, null, 2));
  return s;
}
