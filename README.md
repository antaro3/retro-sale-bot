# auto-affiliate（値下がり速報bot）

楽天の値下げ・新着・再入荷を検知して、Threads と GitHub Pages のサイトに楽天アフィリエイトリンク付きで自動配信します。
流れ：取得 → 判定 → 生成 → 自動審査 → 配信 → 計測（Threadsの反応でキーワードの優先度を自動調整）

- 実行：GitHub Actions（日本時間 8:10 / 12:10 / 18:10 / 21:10）。サーバー・PC不要、無料枠内
- 状態（DB・ログ）は Actions キャッシュに保存し、公開リポジトリには置かない
- Node.js 22（外部パッケージなし）

## 設定（GitHub の Settings）

**Secrets（Settings → Secrets and variables → Actions → Secrets）**

| 名前 | 内容 |
| --- | --- |
| RAKUTEN_APP_ID | 楽天ウェブサービスのアプリID |
| RAKUTEN_ACCESS_KEY | 同アクセスキー |
| RAKUTEN_AFFILIATE_ID | 楽天アフィリエイトID |
| THREADS_USER_ID | ThreadsのユーザーID |
| THREADS_ACCESS_TOKEN | Threadsの長期アクセストークン（以後50日ごとに自動更新） |
| ANTHROPIC_API_KEY | 任意。なければ一言コメントなしで投稿 |

**Variables**：`DRY_RUN`（1=空運転 / 0=本番）、`MAX_POSTS_PER_DAY`（既定6）

**Pages**：Settings → Pages → Source を「GitHub Actions」に。楽天アプリの許可サイトは `https://ユーザー名.github.io/リポジトリ名/`

## 空運転 → 本番

1. `DRY_RUN=1` で2週間。投稿はせず、審査を通った文面が Actions のログとサイト（noindex）に出ます
2. 誤った価格・不適切な商品・おかしな文面がゼロなら `DRY_RUN=0`
3. 以後は完全自動

## 安全装置

| 仕組み | 内容 |
| --- | --- |
| #PR 表記 | 全投稿とサイトに必須。無ければ投稿しない |
| 価格の再取得 | 投稿直前に価格を取り直し、一致しなければ却下 |
| 値下がりの根拠 | 自前の観測履歴（30日の最安値）を下回った時だけ。「定価より○%引き」は使わない |
| AIの役割を限定 | 商品名・価格はテンプレート。AIは数字なしの一言だけ。数字・煽り語が入れば却下 |
| 投稿上限 | 1日 `MAX_POSTS_PER_DAY`、1回2件、同一商品は7日空ける |
| 候補の持ち越し | 枠からあふれた候補は24時間以内なら次回に再挑戦 |
| 自動停止 | 投稿が3回連続で失敗するとリポジトリに `STOP` を作り停止。削除すれば再開 |
| 手動停止 | リポジトリ直下に `STOP` ファイルを置く |

## 注意

- 楽天APIは2026年2月の新仕様（`openapi.rakuten.co.jp`、accessKey、許可サイトのReferer/Origin必須）に対応
- 楽天の売上はAPIで取れないため、報酬は楽天の管理画面で確認
- キャッシュが消えた場合は基準データを作り直すだけで、投稿は自動で再開します
- `npm test` で全外部APIをモックした通しテスト
