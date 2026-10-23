import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { db } from './db.js';
import { cfg } from './env.js';

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const label = { drop: '値下がり', new: '新着', restock: '再入荷' };

// 配信済みの投稿から静的サイトを再生成（空運転中は空運転分も表示し noindex）
export function buildSite() {
  const statuses = cfg.dryRun ? "('posted','dry')" : "('posted')";
  const rows = db.prepare(`SELECT p.*, i.name, i.image, i.shop, i.affiliate_url FROM posts p JOIN items i ON i.item_code=p.item_code
    WHERE p.status IN ${statuses} ORDER BY p.id DESC LIMIT 120`).all();
  const cards = rows.map((r) => {
    const d = new Date(r.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const price = r.kind === 'drop' ? `<s>${r.prev_price?.toLocaleString()}円</s> → <b>${r.price.toLocaleString()}円</b>` : `<b>${r.price.toLocaleString()}円</b>`;
    return `<article><a href="${esc(r.affiliate_url)}" rel="sponsored nofollow noopener" target="_blank">${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : ''}
<div><span class="tag ${r.kind}">${label[r.kind]}</span><h2>${esc(r.name.slice(0, 80))}</h2>
<p class="price">${price}</p><p class="meta">${esc(r.shop)} ・ ${d}時点</p></div></a></article>`;
  }).join('\n');

  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${cfg.dryRun ? '<meta name="robots" content="noindex">' : ''}
<title>${esc(cfg.site.title)}</title>
<style>
:root{--bg:#fbfaf7;--fg:#1d1d1b;--mut:#6b6a66;--line:#e4e1da;--acc:#c2410c}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#eceae4;--mut:#a09e98;--line:#2e2d2a;--acc:#fb923c}}
body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,"Hiragino Sans",sans-serif}
header,main,footer{max-width:760px;margin:auto;padding:16px}
h1{font-size:20px;margin:8px 0}.pr{font-size:13px;color:var(--mut)}
article{border-bottom:1px solid var(--line)}article a{display:flex;gap:12px;padding:12px 0;color:inherit;text-decoration:none}
img{width:88px;height:88px;object-fit:contain;background:#fff;border-radius:8px;flex:none}
h2{font-size:15px;margin:4px 0;line-height:1.4}.price{margin:2px 0}.price b{color:var(--acc)}.meta{font-size:12px;color:var(--mut);margin:0}
.tag{font-size:11px;border:1px solid var(--acc);color:var(--acc);border-radius:4px;padding:1px 6px}
</style></head><body>
<header><h1>${esc(cfg.site.title)}</h1>
<p class="pr">【PR】当サイトは楽天アフィリエイトを利用しています。価格は表示時点の楽天市場のもので、購入時と異なる場合があります。値下がり率は当サイトの観測履歴との比較です。</p></header>
<main>${cards || '<p>まだ投稿はありません。</p>'}</main>
<footer class="pr">自動更新</footer></body></html>`;
  mkdirSync(cfg.publicDir, { recursive: true });
  writeFileSync(join(cfg.publicDir, 'index.html'), html);
  return rows.length;
}
