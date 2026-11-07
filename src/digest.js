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

// カテゴリ別の値下がりまとめ：直近24時間で値下がりが多いカテゴリを1つ選び、上位3件＋カテゴリページへの案内
// （単品の宣伝より「まとめ」の方が反応が良かったため。11/6の本番初日の実測）
export function categoryDigest(recentKeywords = []) {
  const since = new Date(Date.now() - 864e5).toISOString();
  const rows = db.prepare(`SELECT p.item_code c, p.price p, p.at, i.keyword k, i.name n, i.last_price lp, i.last_available av, i.affiliate_rate ar
    FROM prices p JOIN items i ON i.item_code=p.item_code WHERE p.at>=? AND p.available=1 ORDER BY p.item_code, p.at`).all(new Date(Date.now() - 2 * 864e5).toISOString());
  const best = {};
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.c !== b.c || b.p >= a.p || b.at < since || !b.av || (b.ar || 0) < cfg.rules.minAffiliateRate || b.lp < cfg.rules.minPrice) continue;
    const pct = Math.round((1 - b.p / a.p) * 100);
    if (pct >= 5 && (!best[b.c] || pct > best[b.c].pct)) best[b.c] = { pct, k: b.k, n: b.n };
  }
  const byKw = {};
  for (const v of Object.values(best)) (byKw[v.k] ||= []).push(v);
  const pick = Object.entries(byKw).filter(([k, v]) => v.length >= 2 && !recentKeywords.includes(k)).sort((a, b) => b[1].length - a[1].length)[0];
  if (!pick) return null;
  const [kw, list] = pick;
  const top = list.sort((a, b) => b.pct - a.pct).slice(0, 3);
  const text = [`【値下がりまとめ】${kw}`, `${list.length}商品が値下がり中（24時間）`, ...top.map((it, i) => `${i + 1}. ${short(it.n, 20)} ${it.pct}%↓`), `#PR #楽天 #${kw.replace(/[\s#]/g, '')} #値下がり`].join('\n');
  return { kw, text };
}
