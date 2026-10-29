import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { db } from './db.js';
import { cfg, ROOT } from './env.js';

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const yen = (n) => `${Number(n).toLocaleString('ja-JP')}円`;
const label = { drop: '値下がり', new: '新着', restock: '再入荷', pick: '人気' };
const slug = (code) => code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const jstDate = (iso, withTime = true) => new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: withTime ? undefined : 'numeric', month: 'numeric', day: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
const shopLabel = (src) => (src === 'yahoo' ? 'Yahoo!ショッピング' : '楽天市場');

function loadOffers() {
  const p = process.env.OFFERS || join(ROOT, 'config', 'offers.json');
  if (!existsSync(p)) return [];
  try { return (JSON.parse(readFileSync(p, 'utf8')).offers || []).filter((o) => o.active && o.url); } catch { return []; }
}

const CSS = `:root{--bg:#fbfaf7;--fg:#1d1d1b;--mut:#6b6a66;--line:#e4e1da;--acc:#c2410c;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#eceae4;--mut:#a09e98;--line:#2e2d2a;--acc:#fb923c;--card:#1f1f1c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,"Hiragino Sans",sans-serif;line-height:1.6}
header,main,footer{max-width:760px;margin:auto;padding:16px}a{color:var(--acc)}
h1{font-size:20px;margin:8px 0}h2{font-size:15px;margin:4px 0;line-height:1.4}.pr,.meta{font-size:12px;color:var(--mut)}
nav a{display:inline-block;margin:0 10px 6px 0;font-size:13px}
article{border-bottom:1px solid var(--line)}article a{display:flex;gap:12px;padding:12px 0;color:inherit;text-decoration:none}
img.t{width:88px;height:88px;object-fit:contain;background:#fff;border-radius:8px;flex:none}
.price b{color:var(--acc);font-size:18px}.tag{font-size:11px;border:1px solid var(--acc);color:var(--acc);border-radius:4px;padding:1px 6px}
.hero{display:flex;gap:16px;flex-wrap:wrap}.hero img{width:220px;max-width:100%;aspect-ratio:1;object-fit:contain;background:#fff;border-radius:12px}
.btn{display:inline-block;background:var(--acc);color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid var(--line);padding:6px;text-align:left}
.offer{border:1px solid var(--line);background:var(--card);border-radius:10px;padding:12px;margin:16px 0}
svg{max-width:100%;height:auto}`;

const page = ({ title, desc, body, path, depth = 0 }) => {
  const up = depth ? '../'.repeat(depth) : './';
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${cfg.dryRun ? '<meta name="robots" content="noindex">' : ''}
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(cfg.site.url)}/${path}">
<style>${CSS}</style></head><body>
<header><a href="${up}" style="text-decoration:none;color:inherit"><strong>${esc(cfg.site.title)}</strong></a>
<p class="pr">【PR】当サイトは楽天アフィリエイト等のアフィリエイトプログラムを利用しています。価格は表示時点のもので、購入時と異なる場合があります。値下がり率は当サイトの観測履歴との比較です。</p></header>
<main>${body}</main>
<footer class="pr"><a href="${up}privacy.html">プライバシーポリシー</a> ・ 自動更新</footer></body></html>`;
};

// 価格推移の折れ線（SVG）
function sparkline(points) {
  if (points.length < 2) return '';
  const W = 640, H = 160, P = 28;
  const ps = points.map((p) => p.price), lo = Math.min(...ps), hi = Math.max(...ps);
  const t0 = Date.parse(points[0].at), t1 = Date.parse(points.at(-1).at) || t0 + 1;
  const x = (t) => P + ((Date.parse(t) - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
  const y = (v) => (hi === lo ? H / 2 : P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)} ${y(p.price).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="価格推移"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--acc)"/>
<text x="${P}" y="14" font-size="12" fill="currentColor">最高 ${yen(hi)}</text><text x="${P}" y="${H - 6}" font-size="12" fill="currentColor">最安 ${yen(lo)}</text></svg>`;
}

function itemPage(it, offers) {
  const hist = db.prepare('SELECT price, at FROM prices WHERE item_code=? AND available=1 ORDER BY at').all(it.item_code);
  const changes = hist.filter((h, i) => i === 0 || h.price !== hist[i - 1].price);
  const min = Math.min(...hist.map((h) => h.price)), max = Math.max(...hist.map((h) => h.price));
  const hay = `${it.name} ${it.keyword}`;
  const matched = offers.filter((o) => (o.match || []).some((m) => hay.includes(m)));
  const body = `<h1>${esc(it.name.slice(0, 90))} の価格推移・値下がり情報</h1>
<div class="hero">${it.image ? `<img src="${esc(it.image)}" alt="${esc(it.name.slice(0, 60))}">` : ''}
<div><p class="price">現在 <b>${yen(it.last_price)}</b></p>
<p class="meta">${esc(it.shop)}（${shopLabel(it.source)}）・ ${jstDate(it.last_seen)}時点</p>
<p class="meta">観測期間の最安 ${yen(min)} ／ 最高 ${yen(max)}</p>
<p><a class="btn" href="${esc(it.affiliate_url)}" rel="sponsored nofollow noopener" target="_blank">${shopLabel(it.source)}で見る（PR）</a></p></div></div>
<h2>価格の推移</h2>${sparkline(hist) || '<p class="meta">まだ価格の変化はありません。</p>'}
<table><tr><th>日時</th><th>価格</th></tr>${changes.slice(-15).reverse().map((h) => `<tr><td>${jstDate(h.at)}</td><td>${yen(h.price)}</td></tr>`).join('')}</table>
${matched.map((o) => `<div class="offer"><span class="tag">PR</span> <strong>${esc(o.title)}</strong><p>${esc(o.text || '')}</p><a href="${esc(o.url)}" rel="sponsored nofollow noopener" target="_blank">詳しく見る</a>${o.pixel ? `<img src="${esc(o.pixel)}" width="1" height="1" alt="" style="border:0">` : ''}</div>`).join('')}
<p class="meta"><a href="../c/${encodeURIComponent(slug(it.keyword) || 'other')}.html">「${esc(it.keyword)}」の一覧へ</a></p>`;
  return page({ title: `${it.name.slice(0, 50)} の値下がり・価格推移`, desc: `${it.name.slice(0, 80)}の現在価格${yen(it.last_price)}。観測期間の最安${yen(min)}。価格推移を自動で記録しています。`, body, path: `items/${slug(it.item_code)}.html`, depth: 1 });
}

const card = (it, prefix, extra = '') => `<article><a href="${prefix}items/${slug(it.item_code)}.html">${it.image ? `<img class="t" src="${esc(it.image)}" alt="" loading="lazy">` : ''}
<div>${extra}<h2>${esc(it.name.slice(0, 80))}</h2><p class="price"><b>${yen(it.last_price)}</b></p><p class="meta">${esc(it.shop)} ・ ${shopLabel(it.source)}</p></div></a></article>`;

// サイト全体を再生成：トップ、商品ページ、カテゴリ、サイトマップ、robots、プライバシーポリシー
export function buildSite() {
  const dir = cfg.publicDir;
  mkdirSync(join(dir, 'items'), { recursive: true });
  mkdirSync(join(dir, 'c'), { recursive: true });
  const offers = loadOffers();
  const statuses = cfg.dryRun ? "('posted','dry')" : "('posted')";

  // ページを作る商品：投稿した商品＋この30日で価格が動いた商品（最大2000件）
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const items = db.prepare(`SELECT i.* FROM items i WHERE i.last_available=1 AND (
      i.item_code IN (SELECT item_code FROM posts WHERE status IN ${statuses})
      OR (SELECT COUNT(DISTINCT price) FROM prices p WHERE p.item_code=i.item_code AND p.at>=?) >= 2)
    ORDER BY i.last_seen DESC LIMIT 2000`).all(since);
  for (const it of items) writeFileSync(join(dir, 'items', `${slug(it.item_code)}.html`), itemPage(it, offers));

  const byKw = {};
  for (const it of items) (byKw[it.keyword] ||= []).push(it);
  const kws = Object.keys(byKw).sort();
  for (const kw of kws) {
    const body = `<h1>${esc(kw)} の値下がり・価格推移</h1>${byKw[kw].map((it) => card(it, '../')).join('\n')}`;
    writeFileSync(join(dir, 'c', `${slug(kw) || 'other'}.html`), page({ title: `${kw} の値下がり情報`, desc: `${kw}の価格推移と値下がりを自動で記録しています。`, body, path: `c/${slug(kw) || 'other'}.html`, depth: 1 }));
  }

  const recent = db.prepare(`SELECT p.kind, p.prev_price, p.price AS post_price, p.created_at, i.* FROM posts p JOIN items i ON i.item_code=p.item_code
    WHERE p.status IN ${statuses} ORDER BY p.id DESC LIMIT 60`).all();
  const body = `<h1>${esc(cfg.site.title)}</h1>
<nav>${kws.map((k) => `<a href="c/${slug(k) || 'other'}.html">${esc(k)}</a>`).join('')}</nav>
${recent.map((r) => card(r, './', `<span class="tag">${label[r.kind] || ''}</span> <span class="meta">${jstDate(r.created_at)}${r.kind === 'drop' && r.prev_price ? ` ・ ${yen(r.prev_price)}→${yen(r.post_price)}` : ''}</span>`)).join('\n') || '<p>まだ投稿はありません。</p>'}`;
  writeFileSync(join(dir, 'index.html'), page({ title: cfg.site.title, desc: '楽天市場などの値下がり・再入荷を自動で記録して紹介しています。', body, path: '' }));

  writeFileSync(join(dir, 'privacy.html'), page({ title: 'プライバシーポリシー', desc: 'プライバシーポリシー', path: 'privacy.html', body: `<h1>プライバシーポリシー</h1>
<p>当サイトは楽天アフィリエイト、バリューコマース、A8.net等のアフィリエイトプログラムに参加しています。リンク先での購入等により当サイトが報酬を受け取る場合があります。</p>
<p>当サイトは利用者の個人情報を収集しません。アフィリエイトリンク先の各サービスでは、各社の方針に基づきCookie等が使用される場合があります。</p>
<p>当サイトはSNS（Bluesky、Pinterest等）へ商品情報を自動投稿するため、各SNSのAPIを利用しています。取得したアクセストークンは投稿のみに使用し、第三者に提供しません。</p>` }));

  const urls = ['', 'privacy.html', ...kws.map((k) => `c/${slug(k) || 'other'}.html`), ...items.map((it) => `items/${slug(it.item_code)}.html`)];
  writeFileSync(join(dir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(cfg.site.url)}/${u}</loc></url>`).join('\n')}\n</urlset>\n`);
  writeFileSync(join(dir, 'robots.txt'), `User-agent: *\n${cfg.dryRun ? 'Disallow: /\n' : 'Allow: /\n'}Sitemap: ${cfg.site.url}/sitemap.xml\n`);
  return items.length;
}

export const itemPageUrl = (itemCode) => `${cfg.site.url}/items/${slug(itemCode)}.html`;
