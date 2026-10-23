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

export const cfg = {
  dryRun: str('DRY_RUN', '1') !== '0',
  rakuten: {
    appId: str('RAKUTEN_APP_ID'),
    accessKey: str('RAKUTEN_ACCESS_KEY'),
    affiliateId: str('RAKUTEN_AFFILIATE_ID'),
    allowedSite: str('RAKUTEN_ALLOWED_SITE', 'https://example.com'),
    searchUrl: str('RAKUTEN_SEARCH_URL', 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701'),
  },
  threads: { userId: str('THREADS_USER_ID'), token: str('THREADS_ACCESS_TOKEN') },
  claude: { apiKey: str('ANTHROPIC_API_KEY'), model: str('CLAUDE_MODEL', 'claude-haiku-4-5') },
  site: {
    url: str('SITE_URL', 'https://example.com').replace(/\/$/, ''),
    title: str('SITE_TITLE', 'レトロゲーム・アニメ 値下がり速報'),
  },
  rules: {
    minDropPct: num('MIN_DROP_PCT', 10),
    maxPostsPerDay: num('MAX_POSTS_PER_DAY', 6),
    maxPostsPerRun: num('MAX_POSTS_PER_RUN', 2),
    cooldownDays: num('COOLDOWN_DAYS', 7),
    minPrice: num('MIN_PRICE', 1000),
  },
  dbPath: str('DB_PATH', join(ROOT, 'data', 'app.db')),
  publicDir: str('PUBLIC_DIR', join(ROOT, 'public')),
  stopFile: join(ROOT, 'STOP'),
};

export const log = (...a) => console.log(new Date().toISOString(), ...a);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
