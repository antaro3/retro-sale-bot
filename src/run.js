// 1回分のパイプライン：取得 → 判定 → 生成 → 審査 → 配信 → サイト再生成
// cron で定期実行する（例：1日4回）
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cfg, log, ROOT } from './env.js';
import { db, now, kvGet, kvSet } from './db.js';
import { searchKeyword } from './rakuten.js';
import { ingest, rank } from './detect.js';
import { buildPost } from './generate.js';
import { review, postsToday } from './review.js';
import { publishText, refreshTokenIfNeeded, fetchInsights } from './threads.js';
import { blueskyEnabled, publishBluesky, blueskyInsights, checkBluesky } from './bluesky.js';
import { buildSite } from './site.js';
import { yahooEnabled, searchYahoo } from './yahoo.js';
import { currentSale } from './sales.js';
import { pinterestEnabled, createPin } from './pinterest.js';
import { writeStats } from './stats.js';

export async function runOnce() {
  if (existsSync(cfg.stopFile)) { log('STOPファイルがあるため停止中'); return { stopped: true }; }
  const watch = JSON.parse(readFileSync(process.env.WATCHLIST || join(ROOT, 'config', 'watchlist.json'), 'utf8'));
  log(`開始 ${cfg.dryRun ? '[空運転]' : '[本番]'}`);

  const threadsOn = Boolean(cfg.threads.token);
  const bskyOn = blueskyEnabled();
  log(`配信先: ${[threadsOn && 'Threads', bskyOn && 'Bluesky'].filter(Boolean).join(', ') || 'なし（サイトのみ）'}`);
  if (bskyOn) await checkBluesky().then((h) => log('Bluesky接続OK', h)).catch((e) => log('Bluesky接続NG', e.message));
  const pinOn = pinterestEnabled();
  if (pinOn) log('配信先: Pinterest');

  // 楽天の大型セール中は投稿枠を増やし、値下がりの判定を緩める
  const sale = await currentSale().catch(() => null);
  if (sale) {
    cfg.rules.maxPostsPerDay *= 2;
    cfg.rules.maxPostsPerRun += 1;
    cfg.rules.minDropPct = Math.max(5, Math.floor(cfg.rules.minDropPct / 2));
    log(`${sale.name}開催中: 1日${cfg.rules.maxPostsPerDay}件・値下がり${cfg.rules.minDropPct}%以上に拡大`);
  }

  // 6'. 過去14日の投稿の反応を取り込み、判定の重みに使う
  if (!cfg.dryRun) {
    const since = new Date(Date.now() - 14 * 864e5).toISOString();
    const recent = db.prepare("SELECT id, threads_id, bsky_uri FROM posts WHERE status='posted' AND created_at>=?").all(since);
    const setIns = db.prepare('UPDATE posts SET views=?, engagement=? WHERE id=?');
    const bsky = bskyOn ? await blueskyInsights(recent.filter((p) => p.bsky_uri).map((p) => p.bsky_uri)).catch((e) => (log('Bluesky反応取得失敗', e.message), {})) : {};
    if (threadsOn) await refreshTokenIfNeeded().catch((e) => log('トークン更新エラー', e.message));
    for (const p of recent) {
      let views = 0, eng = bsky[p.bsky_uri] || 0;
      if (threadsOn && p.threads_id) {
        try { const m = await fetchInsights(p.threads_id); views = m.views; eng += m.engagement; } catch (e) { log('Threads反応取得失敗', p.id, e.message); }
      }
      setIns.run(views, eng, p.id);
    }
  }

  // 1-2. 取得と判定
  const countKw = db.prepare('SELECT COUNT(*) n FROM items WHERE keyword=?');
  let candidates = [];
  for (const kw of watch.keywords) {
    const bootstrap = countKw.get(kw).n === 0; // 初回はベースライン作成のみ
    try {
      // 追跡数を増やすほど値下がりを拾える。1キーワードあたり数ページ取得（重複は除く）
      const items = [];
      for (let pg = 1; pg <= (watch.pagesPerKeyword || 2); pg++) {
        const got = await searchKeyword(kw, watch.hitsPerKeyword || 30, pg).catch((e) => { if (pg === 1) throw e; return []; });
        items.push(...got.filter((g) => !items.some((i) => i.itemCode === g.itemCode)));
        if (got.length < (watch.hitsPerKeyword || 30)) break;
      }
      candidates.push(...ingest(kw, items, { bootstrap, ngWords: watch.ngWords }));
      log(`取得 "${kw}" ${items.length}件${bootstrap ? '（初回・基準作成）' : ''}`);
    } catch (e) {
      log(`取得失敗 "${kw}"`, e.message);
    }
    if (yahooEnabled()) {
      try {
        const yItems = await searchYahoo(kw, watch.hitsPerKeyword || 30);
        // Yahoo!側は初めて取得するキーワードを基準作成だけにする
        candidates.push(...ingest(kw, yItems, { bootstrap: bootstrap || !kvGet(`yahoo_seen_${kw}`), ngWords: watch.ngWords, minDropPct: cfg.rules.minDropPct }));
        kvSet(`yahoo_seen_${kw}`, 1);
        log(`取得(Yahoo) "${kw}" ${yItems.length}件`);
      } catch (e) {
        log(`取得失敗(Yahoo) "${kw}"`, e.message);
      }
    }
  }
  // 前回あふれた候補（24時間以内）も再挑戦する。価格は審査で取り直すので古くても安全
  const backlog = JSON.parse(kvGet('backlog') || '[]').filter((c) => Date.now() - Date.parse(c.foundAt) < 864e5);
  const fresh = new Set(candidates.map((c) => c.itemCode));
  candidates = [...candidates.map((c) => ({ ...c, foundAt: now() })), ...backlog.filter((c) => !fresh.has(c.itemCode))];
  const ranked = rank(candidates);
  const jstHour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hourCycle: 'h23' }));
  const lastPost = db.prepare("SELECT MAX(created_at) t FROM posts WHERE status IN ('posted','dry')").get().t;
  const gapOk = !lastPost || Date.now() - Date.parse(lastPost) >= cfg.rules.minPostGapMin * 60e3;
  const inHours = jstHour >= cfg.rules.postFromHour && jstHour < cfg.rules.postToHour;
  const slots = !inHours || !gapOk ? 0 : Math.max(0, Math.min(cfg.rules.maxPostsPerRun, cfg.rules.maxPostsPerDay - postsToday()));
  log(`候補 ${ranked.length}件 / 今回の枠 ${slots}${!inHours ? '（投稿時間外）' : !gapOk ? '（前回投稿から間隔不足）' : ''}`);

  // 3-5. 生成 → 審査 → 配信
  const insert = db.prepare("INSERT INTO posts(item_code,keyword,kind,price,prev_price,status,created_at) VALUES(?,?,?,?,?,'pending',?)");
  const update = db.prepare('UPDATE posts SET text=?, status=?, reason=?, threads_id=? WHERE id=?');
  const setBsky = db.prepare('UPDATE posts SET bsky_uri=? WHERE id=?');
  const setPin = db.prepare('UPDATE posts SET pin_id=? WHERE id=?');
  const result = { posted: 0, dry: 0, rejected: 0, errors: 0 };
  for (const c of ranked) {
    if (result.posted + result.dry >= slots) break;
    const id = Number(insert.run(c.itemCode, c.keyword, c.kind, c.price, c.prevPrice, now()).lastInsertRowid);
    const post = await buildPost(c, id, sale);
    const reason = await review(c, post);
    if (reason) {
      update.run(post.text, 'rejected', reason, null, id); result.rejected++;
      log(`却下 #${id} ${reason}`);
      continue;
    }
    if (cfg.dryRun) {
      update.run(post.text, 'dry', null, null, id); result.dry++;
      log(`空運転 #${id}（想定報酬 約${c.reward ?? '?'}円/件・報酬率${c.affiliateRate ?? '?'}%）\n${post.text}\n${post.link}`);
      continue;
    }
    if (!threadsOn && !bskyOn && !pinOn) {
      update.run(post.text, 'dry', 'no-channel', null, id); result.dry++;
      log(`配信先未設定のためサイトのみ #${id}`);
      continue;
    }
    const errs = [];
    let tid = null, buri = null;
    if (threadsOn) { try { tid = await publishText(post.text, post.link); } catch (e) { errs.push(e.message); } }
    if (bskyOn) { try { buri = await publishBluesky(post.text, post.link, post); } catch (e) { errs.push(e.message); } }
    let pid = null;
    if (pinOn && post.image) { try { pid = await createPin({ title: post.title, description: post.text, link: post.link, imageUrl: post.image }); } catch (e) { errs.push(e.message); } }
    if (tid || buri || pid) {
      update.run(post.text, 'posted', errs.join(' / ') || null, tid, id); setBsky.run(buri, id); setPin.run(pid, id); result.posted++;
      kvSet('consecutive_errors', 0);
      log(`投稿 #${id} threads=${tid || '-'} bluesky=${buri || '-'} pinterest=${pid || '-'}`);
    } else {
      update.run(post.text, 'error', errs.join(' / ').slice(0, 300), null, id); result.errors++;
      const n = Number(kvGet('consecutive_errors') || 0) + 1;
      kvSet('consecutive_errors', n);
      log(`投稿失敗 #${id}`, errs.join(' / '));
      if (n >= 3) {
        writeFileSync(cfg.stopFile, `${now()} 投稿が3回連続で失敗したため自動停止\n${errs.join('\n')}\n`);
        log('3回連続失敗のため自動停止（STOPファイル作成）');
        break;
      }
    }
  }

  const used = new Set(db.prepare('SELECT item_code FROM posts WHERE created_at>=?').all(new Date(Date.now() - 864e5).toISOString()).map((r) => r.item_code));
  kvSet('backlog', JSON.stringify(ranked.filter((c) => !used.has(c.itemCode)).slice(0, 20)));

  // 6. サイト再生成
  db.prepare('DELETE FROM prices WHERE at<?').run(new Date(Date.now() - 90 * 864e5).toISOString()); // 90日より古い価格記録は削除
  const shown = buildSite();
  try {
    const st = writeStats({ candidatesLastRun: ranked.length, sale: sale?.name || null });
    log(`集計 追跡${st.tracked}件 / 24h価格変動${st.priceChanges24h}件 値下がり${JSON.stringify(st.drops24h)}`);
  } catch (e) { log('集計失敗', e.message); }
  log(`完了 ${JSON.stringify(result)} 商品ページ${shown}件`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runOnce().catch((e) => { log('致命的エラー', e.stack); process.exit(1); });
}
