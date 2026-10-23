import { cfg, log } from './env.js';
import { kvGet, kvSet } from './db.js';

const API = 'https://graph.threads.net/v1.0';

function token() {
  return kvGet('threads_token') || cfg.threads.token;
}

// 長期トークン（60日）を50日ごとに自動更新
export async function refreshTokenIfNeeded() {
  const at = kvGet('threads_token_refreshed_at');
  if (at && Date.now() - Date.parse(at) < 50 * 864e5) return;
  if (!token()) return;
  const res = await fetch(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(token())}`);
  const j = await res.json();
  if (j.access_token) {
    kvSet('threads_token', j.access_token);
    kvSet('threads_token_refreshed_at', new Date().toISOString());
    log('Threadsトークンを更新しました');
  } else if (!at) {
    kvSet('threads_token_refreshed_at', new Date().toISOString()); // 発行直後は更新不可なことがある
  } else {
    log('Threadsトークン更新失敗', JSON.stringify(j).slice(0, 200));
  }
}

async function post(path, params) {
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    body: new URLSearchParams({ ...params, access_token: token() }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(`Threads ${res.status}: ${JSON.stringify(j.error || j).slice(0, 200)}`);
  return j;
}

export async function publishText(text, link) {
  const uid = cfg.threads.userId;
  const container = await post(`${uid}/threads`, { media_type: 'TEXT', text, link_attachment: link });
  await new Promise((r) => setTimeout(r, Number(process.env.THREADS_WAIT_MS ?? 5000))); // コンテナ処理待ち
  const pub = await post(`${uid}/threads_publish`, { creation_id: container.id });
  return pub.id;
}

// 投稿ごとの反応を取得（threads_manage_insights 権限が必要）
export async function fetchInsights(mediaId) {
  const res = await fetch(`${API}/${mediaId}/insights?metric=views,likes,replies,reposts,quotes&access_token=${encodeURIComponent(token())}`,
    { signal: AbortSignal.timeout(20000) });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(`Threads insights ${res.status}`);
  const v = Object.fromEntries((j.data || []).map((m) => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? 0]));
  return { views: v.views || 0, engagement: (v.likes || 0) + 2 * ((v.replies || 0) + (v.reposts || 0) + (v.quotes || 0)) };
}
