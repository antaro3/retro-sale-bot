import { cfg, log } from './env.js';

const yen = (n) => n.toLocaleString('ja-JP');
const hhmm = () => new Date().toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
const shortName = (s, n = 60) => {
  const clean = s.replace(/【[^】]*】|\[[^\]]*\]|★|☆|◆|■|送料無料|ポイント\d+倍|最安値?挑戦中?|最安値?|激安|今だけ|100%|絶対|必ず|確実|底値/g, '').replace(/\s+/g, ' ').trim();
  return clean.length > n ? clean.slice(0, n) + '…' : clean;
};

// Claudeには「一言コメント」だけを書かせる。商品名・価格はテンプレートで差し込む（数字の誤りを防ぐ）
async function oneLiner(c) {
  if (!cfg.claude.apiKey) return '';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': cfg.claude.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model: cfg.claude.model,
        max_tokens: 120,
        messages: [{
          role: 'user',
          content: `お買い物情報のSNS投稿に添える一言を書いてください。
商品名: ${shortName(c.name, 100)}
条件:
- 日本語で40文字以内、1文だけ
- 価格・数字・割引率・在庫数には一切触れない
- 「最安」「絶対」「必ず」「激安」「今だけ」などの断定・煽り表現は使わない
- 商品の魅力や使いどころを素直に。絵文字・ハッシュタグなし
- 一言の本文だけを出力`,
        }],
      }),
    });
    const j = await res.json();
    return (j.content?.[0]?.text || '').trim().split('\n')[0];
  } catch (e) {
    log('Claude生成失敗（定型文のみで続行）', e.message);
    return '';
  }
}

export async function buildPost(c, postId) {
  const head = { drop: '【値下がり】', new: '【新着】', restock: '【再入荷】' }[c.kind];
  const priceLine = c.kind === 'drop'
    ? `${yen(c.prevPrice)}円 → ${yen(c.price)}円（当サイト観測で${c.pct}%ダウン）`
    : `${yen(c.price)}円`;
  const comment = await oneLiner(c);
  const link = c.affiliateUrl;
  const text = [
    head + shortName(c.name),
    priceLine,
    comment,
    `※${hhmm()}時点の楽天市場の価格です`,
    '#PR',
  ].filter(Boolean).join('\n');
  return { text, link, comment, title: shortName(c.name, 90), image: c.image };
}
