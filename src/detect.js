import { db, now } from './db.js';
import { cfg, log } from './env.js';

const days = (n) => new Date(Date.now() - n * 864e5).toISOString();

// 取得した商品を保存し、投稿候補（値下がり・新着・再入荷）を返す
export function ingest(keyword, items, { bootstrap, ngWords = [], minDropPct = cfg.rules.minDropPct }) {
  const candidates = [];
  const t = now();
  const getItem = db.prepare('SELECT * FROM items WHERE item_code=?');
  const minRecent = db.prepare('SELECT MIN(price) m FROM prices WHERE item_code=? AND at>=? AND available=1');
  const upsert = db.prepare(`INSERT INTO items(item_code,keyword,name,item_url,affiliate_url,image,shop,first_seen,last_seen,last_price,last_available,source,affiliate_rate,review_count,review_avg)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(item_code) DO UPDATE SET name=excluded.name, item_url=excluded.item_url,
    affiliate_url=excluded.affiliate_url, image=excluded.image, shop=excluded.shop, last_seen=excluded.last_seen,
    last_price=excluded.last_price, last_available=excluded.last_available, source=excluded.source, affiliate_rate=excluded.affiliate_rate,
    review_count=excluded.review_count, review_avg=excluded.review_avg`);
  const addPrice = db.prepare('INSERT INTO prices(item_code,price,available,at) VALUES(?,?,?,?)');
  const lastAt = db.prepare('SELECT MAX(at) t FROM prices WHERE item_code=?');

  const rates = items.map((it) => it.affiliateRate || 0);
  log(`  報酬率 "${keyword}": 最大${Math.max(0, ...rates)}% / ${cfg.rules.minAffiliateRate}%以上 ${rates.filter((r) => r >= cfg.rules.minAffiliateRate).length}件`);
  for (const it of items) {
    if (!it.itemCode || !it.price) continue;
    if (ngWords.some((w) => it.name.includes(w))) continue;
    if (it.source !== 'yahoo' && (it.affiliateRate || 0) < cfg.rules.minAffiliateRate) continue;
    const prev = getItem.get(it.itemCode);
    const recentMin = minRecent.get(it.itemCode, days(30))?.m;

    if (!bootstrap && it.available && it.price >= cfg.rules.minPrice) {
      if (!prev) {
        if (cfg.rules.postNew) candidates.push({ ...it, keyword, kind: 'new', prevPrice: null, score: 1 });
      } else if (prev.last_available === 0) {
        candidates.push({ ...it, keyword, kind: 'restock', prevPrice: prev.last_price, score: 2 });
      } else if (prev.last_price && it.price < prev.last_price) {
        const pct = Math.round((1 - it.price / prev.last_price) * 100);
        // 自前の観測履歴（30日）の最安値を下回ったときだけ「値下がり」とする
        if (pct >= minDropPct && (recentMin == null || it.price < recentMin)) {
          candidates.push({ ...it, keyword, kind: 'drop', prevPrice: prev.last_price, pct, score: 3 + pct / 10 });
        }
      }
    }
    upsert.run(it.itemCode, prev?.keyword || keyword, it.name, it.itemUrl, it.affiliateUrl, it.image, it.shop,
      prev?.first_seen || t, t, it.price, it.available, it.source || 'rakuten', it.affiliateRate || 0, it.reviewCount || 0, it.reviewAverage || 0);
    // 毎時実行でDBが膨らまないよう、価格・在庫が同じなら6時間に1回だけ記録
    const same = prev && prev.last_price === it.price && prev.last_available === it.available;
    if (!same || Date.now() - Date.parse(lastAt.get(it.itemCode)?.t || 0) >= 6 * 3600e3) addPrice.run(it.itemCode, it.price, it.available, t);
  }
  return candidates;
}

// 値動きが無くても紹介できる「人気商品」候補（レビュー数・評価が十分な売れ筋）
export function picks(keyword, items, ngWords = []) {
  const r = cfg.rules;
  return items
    .filter((it) => it.available && it.price >= r.minPrice && (it.affiliateRate || 0) >= r.minAffiliateRate)
    .filter((it) => (it.reviewCount || 0) >= r.pickMinReviews && (it.reviewAverage || 0) >= r.pickMinAvg)
    .filter((it) => !ngWords.some((w) => it.name.includes(w)))
    .map((it) => ({ ...it, keyword, kind: 'pick', prevPrice: null, score: 0.8 * Math.min(2, 1 + Math.log10(it.reviewCount) / 3) }));
}

// Threadsの反応（閲覧・いいね・返信・再投稿）からキーワードごとの重みを出す（計測 → 判定の自動調整）
export function keywordWeights() {
  const rows = db.prepare(`SELECT keyword k, AVG(COALESCE(engagement,0) + COALESCE(views,0) / 100.0) s
    FROM posts WHERE status='posted' AND created_at>=? GROUP BY keyword`).all(days(14));
  const w = {};
  for (const r of rows) w[r.k] = 1 + Math.min(r.s, 10) / 10; // 1.0〜2.0
  return w;
}

export function rank(candidates) {
  const w = keywordWeights();
  const cooled = db.prepare("SELECT 1 FROM posts WHERE item_code=? AND status IN ('posted','dry') AND created_at>=?");
  const seen = new Set();
  return candidates
    .filter((c) => !seen.has(c.itemCode) && seen.add(c.itemCode))
    .filter((c) => !cooled.get(c.itemCode, days(c.kind === 'pick' ? cfg.rules.pickCooldownDays : cfg.rules.cooldownDays)))
    .filter((c) => c.source === 'yahoo' || (c.affiliateRate || 0) >= cfg.rules.minAffiliateRate) // 持ち越し候補にも報酬率の条件を適用
    .filter((c) => c.kind !== 'new' || cfg.rules.postNew)
    // 想定報酬額（価格×報酬率）が大きい商品ほど優先＝稼げるものに特化
    .map((c) => ({ ...c, reward: Math.round(c.price * (c.affiliateRate || 0) / 100), score: c.score * (w[c.keyword] || 1) * Math.max(1, Math.sqrt(c.price * (c.affiliateRate || 0) / 100 / 50)) }))
    .sort((a, b) => b.score - a.score);
}
