// IndexNow：新しく作ったページをBing等の検索エンジンへ即時通知する（アカウント不要・無料）
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cfg, log } from './env.js';
import { kvGet, kvSet } from './db.js';

// キーは公開前提（サイト上に置いて所有確認に使う）
const KEY = process.env.INDEXNOW_KEY || 'a8f3c2e91b7d4f06a5e2c8d1b9f04e37';

export async function notifyIndexNow(urls) {
  if (process.env.SITE_NOINDEX === '1' || !urls.length) return 0;
  writeFileSync(join(cfg.publicDir, `${KEY}.txt`), KEY);
  const sent = new Set(JSON.parse(kvGet('indexnow_sent') || '[]'));
  const day = new Date().toISOString().slice(0, 10);
  // 未通知のページ＋トップ・カテゴリ（1日1回）
  const fresh = urls.filter((u) => !sent.has(u));
  const daily = kvGet('indexnow_day') === day ? [] : urls.filter((u) => !u.includes('/items/'));
  const list = [...new Set([...daily, ...fresh])].slice(0, 9000);
  if (!list.length) return 0;
  const host = new URL(cfg.site.url).host;
  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key: KEY, keyLocation: `${cfg.site.url}/${KEY}.txt`, urlList: list }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok && res.status !== 202) throw new Error(`HTTP ${res.status}`);
    for (const u of list) sent.add(u);
    kvSet('indexnow_sent', JSON.stringify([...sent].slice(-20000)));
    kvSet('indexnow_day', day);
    return list.length;
  } catch (e) {
    log('IndexNow通知失敗（次回再送）', e.message);
    return 0;
  }
}
