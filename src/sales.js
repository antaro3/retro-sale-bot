import { log } from './env.js';
import { kvGet, kvSet } from './db.js';

// 楽天の大型セール（スーパーセール／お買い物マラソン）の開催中かを判定する
const PAGES = [
  { name: '楽天スーパーセール', url: 'https://event.rakuten.co.jp/campaign/supersale/' },
  { name: '楽天お買い物マラソン', url: 'https://event.rakuten.co.jp/campaign/point-up/marathon/' },
];
const RANGE = /(\d{4})年(\d{1,2})月(\d{1,2})日[(（][^)）]+[)）]\s*(\d{1,2}):(\d{2})\s*[～~〜]\s*(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日[(（][^)）]+[)）]\s*(\d{1,2}):(\d{2})/g;
const jst = (y, mo, d, h, mi) => Date.parse(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${mi}:00+09:00`);

// ページ内の期間表記を読み取り、開始が最も遅いもの（＝ポイントアップ本番の期間）を採用
export function parsePeriods(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
  const out = [];
  for (const m of text.matchAll(RANGE)) {
    const start = jst(m[1], m[2], m[3], m[4], m[5]);
    const endYear = m[6] || (Number(m[7]) < Number(m[2]) ? Number(m[1]) + 1 : m[1]);
    const end = jst(endYear, m[7], m[8], m[9], m[10]);
    if (start && end && end > start) out.push({ start, end });
  }
  return out.sort((a, b) => b.start - a.start)[0] || null;
}

// 公式ページが読めない時の目安：スーパーセールは例年3・6・9・12月の4日20時〜11日1:59
export function heuristicSuperSale(now = Date.now()) {
  const d = new Date(now + 9 * 3600e3);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  if (![3, 6, 9, 12].includes(m)) return null;
  const start = jst(y, m, 4, 20, '00'), end = jst(y, m, 11, 1, '59');
  return now >= start && now <= end ? { name: '楽天スーパーセール', start, end } : null;
}

export async function currentSale(now = Date.now()) {
  const cached = JSON.parse(kvGet('sale_cache') || 'null');
  if (cached && now - cached.checkedAt < 3 * 3600e3) return cached.sale && now <= cached.sale.end ? cached.sale : null;

  let sale = null;
  for (const p of PAGES) {
    try {
      const res = await fetch(p.url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } });
      const period = parsePeriods(await res.text());
      if (period && now >= period.start && now <= period.end) { sale = { name: p.name, ...period }; break; }
    } catch (e) {
      log('セール情報取得失敗', p.name, e.message);
    }
  }
  sale ||= heuristicSuperSale(now);
  kvSet('sale_cache', JSON.stringify({ checkedAt: now, sale }));
  return sale;
}

export const saleEndLabel = (sale) => {
  const d = new Date(sale.end + 9 * 3600e3);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
