import { cfg, log } from './env.js';
import { kvGet, kvSet } from './db.js';

// Pinterest API v5。ピンはStandard Access承認後に公開表示される（Trialでは本人にしか見えない）
const API = 'https://api.pinterest.com/v5';

export const pinterestEnabled = () => Boolean((cfg.pinterest.token || kvGet('pin_token')) && cfg.pinterest.boardId);

async function token() {
  const saved = JSON.parse(kvGet('pin_token') || 'null');
  const { refreshToken, appId, appSecret } = cfg.pinterest;
  // アクセストークン（約30日）が切れる前にリフレッシュトークンで自動更新
  if (refreshToken && appId && appSecret && (!saved || Date.now() > saved.expiresAt - 3 * 864e5)) {
    try {
      const res = await fetch(`${API}/oauth/token`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: saved?.refreshToken || refreshToken }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await res.json();
      if (j.access_token) {
        kvSet('pin_token', JSON.stringify({ token: j.access_token, refreshToken: j.refresh_token || saved?.refreshToken || refreshToken, expiresAt: Date.now() + (j.expires_in || 2592000) * 1000 }));
        log('Pinterestトークンを更新しました');
        return j.access_token;
      }
      log('Pinterestトークン更新失敗', JSON.stringify(j).slice(0, 200));
    } catch (e) {
      log('Pinterestトークン更新エラー', e.message);
    }
  }
  return saved?.token || cfg.pinterest.token;
}

export async function createPin({ title, description, link, imageUrl }) {
  const res = await fetch(`${API}/pins`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      board_id: cfg.pinterest.boardId,
      link,
      title: title.slice(0, 100),
      description: description.slice(0, 500),
      alt_text: title.slice(0, 500),
      media_source: { source_type: 'image_url', url: imageUrl },
    }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Pinterest ${res.status}: ${j.message || JSON.stringify(j).slice(0, 200)}`);
  return j.id;
}
