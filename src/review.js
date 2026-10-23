import { db } from './db.js';
import { cfg } from './env.js';
import { getItem } from './rakuten.js';

const BANNED = ['最安', '絶対', '必ず', '激安', '今だけ', '100%', '確実', '底値'];
const COMMENT_BANNED = [...BANNED, '公式', '限定', 'お得', '安い'];

export function postsToday() {
  const start = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' }) + 'T00:00:00+09:00').toISOString();
  return db.prepare("SELECT COUNT(*) n FROM posts WHERE status IN ('posted','dry') AND created_at>=?").get(start).n;
}

// 自動審査。問題があれば理由を返し、投稿しない
export async function review(c, post) {
  if (!post.text.includes('#PR')) return 'PR表記なし';
  if ([...post.text].length > 290) return '文字数超過'; // Blueskyは300文字まで
  const hit = BANNED.find((w) => post.text.includes(w));
  if (hit) return `禁止語: ${hit}`;
  if (post.comment) {
    if (post.comment.length > 60) return 'コメントが長すぎる';
    if (/[0-9０-９円%％]/.test(post.comment)) return 'コメントに数字・価格が含まれる';
    const ch = COMMENT_BANNED.find((w) => post.comment.includes(w));
    if (ch) return `コメント禁止語: ${ch}`;
  }
  if (postsToday() >= cfg.rules.maxPostsPerDay) return '1日の投稿上限';
  const dup = db.prepare("SELECT 1 FROM posts WHERE text=? AND status IN ('posted','dry')").get(post.text);
  if (dup) return '重複文面';

  // 投稿直前に価格を取り直し、一致しなければ出さない
  // Yahoo!は商品コード検索がないため、同じ実行内で取得した価格をそのまま使う
  const fresh = c.source === 'yahoo' ? c : await getItem(c.itemCode).catch(() => null);
  if (!fresh) return '再取得失敗';
  if (fresh.price !== c.price) return `価格変動 ${c.price}→${fresh.price}`;
  if (!fresh.available) return '在庫切れ';
  return null;
}
