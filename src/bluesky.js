import { cfg, log } from './env.js';

const PDS = 'https://bsky.social/xrpc';
let session = null;

async function xrpc(method, { body, query, raw, contentType } = {}) {
  const url = `${PDS}/${method}${query ? '?' + new URLSearchParams(query) : ''}`;
  const headers = {};
  if (session) headers.Authorization = `Bearer ${session.accessJwt}`;
  if (body !== undefined || raw) headers['Content-Type'] = contentType || 'application/json';
  const res = await fetch(url, {
    method: body !== undefined || raw ? 'POST' : 'GET',
    headers,
    body: raw || (body !== undefined ? JSON.stringify(body) : undefined),
    signal: AbortSignal.timeout(30000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Bluesky ${method} ${res.status}: ${j.error || ''} ${j.message || ''}`.trim());
  return j;
}

export const blueskyEnabled = () => Boolean(cfg.bluesky.handle && cfg.bluesky.appPassword);

async function login() {
  if (session) return session;
  session = null;
  session = await xrpc('com.atproto.server.createSession', {
    body: { identifier: cfg.bluesky.handle, password: cfg.bluesky.appPassword },
  });
  return session;
}

// 接続確認（空運転中も認証だけ試す）
export async function checkBluesky() {
  const s = await login();
  return s.handle;
}

// 商品画像をリンクカードのサムネイルにする（失敗してもカードなしで投稿）
async function uploadThumb(imageUrl) {
  if (!imageUrl) return undefined;
  try {
    const img = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
    if (!img.ok) return undefined;
    const buf = Buffer.from(await img.arrayBuffer());
    if (buf.length > 950_000) return undefined;
    const up = await xrpc('com.atproto.repo.uploadBlob', { raw: buf, contentType: img.headers.get('content-type') || 'image/jpeg' });
    return up.blob;
  } catch (e) {
    log('サムネイル省略', e.message);
    return undefined;
  }
}

export async function publishBluesky(text, link, { title, image } = {}) {
  const s = await login();
  const thumb = await uploadThumb(image);
  const record = {
    $type: 'app.bsky.feed.post',
    text,
    langs: ['ja'],
    createdAt: new Date().toISOString(),
    embed: {
      $type: 'app.bsky.embed.external',
      external: { uri: link, title: (title || '楽天市場').slice(0, 100), description: '楽天市場の商品ページ（PR）', ...(thumb ? { thumb } : {}) },
    },
  };
  const r = await xrpc('com.atproto.repo.createRecord', { body: { repo: s.did, collection: 'app.bsky.feed.post', record } });
  return r.uri;
}

// 反応（いいね・リポスト・返信・引用）を取得
export async function blueskyInsights(uris) {
  if (!uris.length) return {};
  await login();
  const out = {};
  for (let i = 0; i < uris.length; i += 25) {
    const j = await xrpc('app.bsky.feed.getPosts', { query: uris.slice(i, i + 25).map((u) => ['uris', u]) });
    for (const p of j.posts || []) {
      out[p.uri] = (p.likeCount || 0) + 2 * ((p.repostCount || 0) + (p.replyCount || 0) + (p.quoteCount || 0));
    }
  }
  return out;
}
