// 週1回のまとめ投稿：この1週間で値下がりが大きかった商品TOP3（サイトのトップへ誘導）
import { db } from './db.js';
import { cfg } from './env.js';

const short = (s, n = 22) => {
  const c = s.replace(/【[^】]*】|\[[^\]]*\]|＼[^／]*／|★|☆|送料無料|ポイント\d+倍/g, '').replace(/\s+/g, ' ').trim();
  return c.length > n ? c.slice(0, n) + '…' : c;
};

export function weekKey(d = new Date()) {
  const j = new Date(d.getTime() + 9 * 3600e3);
  const day = (j.getUTCDay() + 6) % 7; // 月曜=0
  const mon = new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() - day));
  return mon.toISOString().slice(0, 10);
}

export function weeklyDigest() {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const rows = db.prepare('SELECT item_code c, price p, at FROM prices WHERE at>=? AND available=1 ORDER BY item_code, at').all(since);
  const best = {};
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.c !== b.c || b.p >= a.p) continue;
    const pct = Math.round((1 - b.p / a.p) * 100);
    if (pct >= 5 && (!best[b.c] || pct > best[b.c])) best[b.c] = pct;
  }
  const get = db.prepare('SELECT name, last_price, last_available, affiliate_rate, source FROM items WHERE item_code=?');
  const top = Object.entries(best)
    .map(([c, pct]) => ({ ...get.get(c), pct }))
    .filter((it) => it.name && it.last_available && it.last_price >= cfg.rules.minPrice && (it.source === 'yahoo' || (it.affiliate_rate || 0) >= cfg.rules.minAffiliateRate))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);
  if (top.length < 2) return null;
  const lines = top.map((it, i) => `${i + 1}. ${short(it.name)} ${it.pct}%ダウン`);
  return ['【今週の値下がりTOP3】', ...lines, '※当サイトの観測価格どうしの比較です', '#PR #楽天 #値下がり'].join('\n');
}
