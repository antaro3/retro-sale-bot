import { cfg, sleep } from './env.js';

// Yahoo!ショッピング 商品検索API v3（バリューコマース経由のアフィリエイトリンク）
const API = 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch';
let last = 0;

export const yahooEnabled = () => Boolean(cfg.yahoo.appId);

export async function searchYahoo(keyword, hits = 30) {
  const wait = last + Number(process.env.YAHOO_INTERVAL_MS ?? 1100) - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();

  const qs = new URLSearchParams({ appid: cfg.yahoo.appId, query: keyword, results: String(Math.min(hits, 50)), sort: '-score', image_size: '600' });
  if (cfg.yahoo.vcAffiliateId) {
    qs.set('affiliate_type', 'vc');
    qs.set('affiliate_id', cfg.yahoo.vcAffiliateId);
  }
  const res = await fetch(`${API}?${qs}`, { signal: AbortSignal.timeout(15000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Yahoo API ${res.status}: ${JSON.stringify(body.Error || body).slice(0, 200)}`);
  return (body.hits || []).map((h) => ({
    itemCode: `y:${h.code}`,
    name: h.name,
    price: Number(h.price),
    available: h.inStock === false ? 0 : 1,
    itemUrl: h.url,
    affiliateUrl: h.url, // affiliate_id 指定時はアフィリエイトURLが返る
    image: h.exImage?.url || h.image?.medium || '',
    shop: h.seller?.name || 'Yahoo!ショッピング',
    affiliateRate: cfg.yahoo.rate,
    source: 'yahoo',
  }));
}
