import { cfg, sleep } from './env.js';

// 楽天APIは1秒1リクエスト程度に抑える
let last = 0;
async function call(params) {
  const wait = last + Number(process.env.RAKUTEN_INTERVAL_MS ?? 1100) - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();

  const { appId, accessKey, affiliateId, allowedSite, searchUrl } = cfg.rakuten;
  const qs = new URLSearchParams({
    applicationId: appId, accessKey, affiliateId,
    format: 'json', formatVersion: '2', ...params,
  });
  const res = await fetch(`${searchUrl}?${qs}`, {
    // 新APIは許可サイトのReferer/Originが必須
    headers: { Referer: allowedSite, Origin: allowedSite.replace(/\/$/, '') },
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error || body.errors) {
    throw new Error(`Rakuten API ${res.status}: ${JSON.stringify(body.errors || body.error_description || body).slice(0, 200)}`);
  }
  return (body.Items || []).map(normalize);
}

function normalize(it) {
  const i = it.Item || it; // formatVersion 1/2 両対応
  const img = i.mediumImageUrls?.[0];
  return {
    itemCode: i.itemCode,
    name: i.itemName,
    price: Number(i.itemPrice),
    available: Number(i.availability ?? 1),
    itemUrl: i.itemUrl,
    affiliateUrl: i.affiliateUrl || i.itemUrl,
    image: (typeof img === 'string' ? img : img?.imageUrl) || '',
    shop: i.shopName || '',
  };
}

export const searchKeyword = (keyword, hits = 30) =>
  call({ keyword, hits: String(hits), sort: '-updateTimestamp', availability: '0' });

export async function getItem(itemCode) {
  const items = await call({ itemCode, hits: '1', availability: '0' });
  return items[0] || null;
}
