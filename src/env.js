import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// .env を読み込む（依存パッケージなし）
const envPath = process.env.ENV_FILE || join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const num = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : Number(process.env[k]));
const str = (k, d = '') => (process.env[k] || '').trim() || d;

// LIVE_FROM（例: 2026-11-06T00:00:00+09:00）を過ぎたら空運転を自動で終えて本番投稿に切り替える
const liveFrom = Date.parse(str('LIVE_FROM'));

export const cfg = {
  dryRun: str('DRY_RUN', '1') !== '0' && !(liveFrom && Date.now() >= liveFrom),
  rakuten: {
    appId: str('RAKUTEN_APP_ID'),
    accessKey: str('RAKUTEN_ACCESS_KEY'),
    affiliateId: str('RAKUTEN_AFFILIATE_ID'),
    allowedSite: str('RAKUTEN_ALLOWED_SITE', 'https://example.com'),
    searchUrl: str('RAKUTEN_SEARCH_URL', 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701'),
  },
  threads: { userId: str('THREADS_USER_ID'), token: str('THREADS_ACCESS_TOKEN') },
  bluesky: { handle: str('BSKY_HANDLE').replace(/^@/, ''), appPassword: str('BSKY_APP_PASSWORD') },
  yahoo: {
    appId: str('YAHOO_APP_ID'), // Yahoo!デベロッパーのClient ID
    vcAffiliateId: str('YAHOO_VC_AFFILIATE_ID'), // バリューコマースのアフィリエイトID
    rate: num('YAHOO_AFFILIATE_RATE', 1), // 報酬率の想定値(%)
  },
  pinterest: {
    token: str('PINTEREST_ACCESS_TOKEN'),
    refreshToken: str('PINTEREST_REFRESH_TOKEN'),
    appId: str('PINTEREST_APP_ID'),
    appSecret: str('PINTEREST_APP_SECRET'),
    boardId: str('PINTEREST_BOARD_ID'),
  },
  claude: { apiKey: str('ANTHROPIC_API_KEY'), model: str('CLAUDE_MODEL', 'claude-haiku-4-5') },
  site: {
    url: str('SITE_URL', 'https://example.com').replace(/\/$/, ''),
    title: str('SITE_TITLE', 'レトロゲーム・アニメ 値下がり速報'),
  },
  rules: {
    minDropPct: num('MIN_DROP_PCT', 7), // 実測（stats.json）で10%以上の値下がりは平常時ほぼ無いため7%に
    maxPicksPerDay: num('MAX_PICKS_PER_DAY', 4), // 「人気商品」紹介の1日上限（値下がりが無い日も投稿を続けるため）
    pickMinReviews: num('PICK_MIN_REVIEWS', 100),
    pickMinAvg: num('PICK_MIN_AVG', 4.2),
    pickCooldownDays: num('PICK_COOLDOWN_DAYS', 30),
    maxPostsPerDay: num('MAX_POSTS_PER_DAY', 6),
    maxPostsPerRun: num('MAX_POSTS_PER_RUN', 2),
    cooldownDays: num('COOLDOWN_DAYS', 7),
    minPrice: num('MIN_PRICE', 1000),
    minAffiliateRate: num('MIN_AFFILIATE_RATE', 4), // 報酬率(%)がこれ未満の商品は扱わない
    postFromHour: num('POST_FROM_HOUR', 7), // 投稿する時間帯（日本時間）。深夜は取得・記録だけ行う
    postToHour: num('POST_TO_HOUR', 23),
    minPostGapMin: num('MIN_POST_GAP_MIN', 60), // 投稿どうしの最短間隔（分）。1時間ごとの実行でも投稿が固まらないように
    postNew: num('POST_NEW', 0) === 1, // 新着も投稿するか（検索順の揺れで誤検知しやすいので既定はオフ）
  },
  dbPath: str('DB_PATH', join(ROOT, 'data', 'app.db')),
  publicDir: str('PUBLIC_DIR', join(ROOT, 'public')),
  stopFile: join(ROOT, 'STOP'),
};

export const log = (...a) => console.log(new Date().toISOString(), ...a);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
