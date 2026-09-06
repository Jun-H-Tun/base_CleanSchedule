# CleanSchedule — 民泊清掃管理Webアプリ

沖縄県内の民泊9棟(b1〜b9、同一間取り・最大定員6名)の清掃スタッフ割り振りを自動化するWebアプリです。
`beds24` の予約情報をもとに、優先順位固定の貪欲法でスタッフへ清掃タスクを自動割り振りし、
TimeTree風の月表示カレンダーで確認・手動修正できます。

## 技術スタック

| レイヤー | 技術 |
|---|---|
| コード管理・CI/CD | GitHub Actions |
| フロントエンド + バックエンドAPI | Cloudflare Workers (Static Assets + Hono) |
| データベース | Cloudflare D1 |

フロントエンド(カレンダーUI)とバックエンドAPIは、Cloudflare の推奨する現行方式である
**Workers Static Assets** を使い、1つの Worker にまとめてデプロイしています
(旧来の Cloudflare Pages を別立てする方式より運用がシンプルになるため)。
`wrangler deploy` 一発でフロント・API・D1バインディングがすべて公開されます。

## ディレクトリ構成

```
src/                 バックエンドAPI (Hono, TypeScript)
  index.ts           ルーティングのエントリポイント
  auth.ts            パスワードハッシュ(PBKDF2)・セッション署名(HMAC)
  assignment.ts       自動割り振りアルゴリズム(貪欲法)
  middleware.ts       認証・管理者チェック
  routes/             /api/auth, /api/staff, /api/units, /api/reservations,
                       /api/availability, /api/tasks
migrations/0001_init.sql   D1スキーマ + 初期データ(スタッフ4名・物件9棟・管理者アカウント)
public/              フロントエンド(静的ファイル、ビルド不要のVanilla JS)
  index.html / css/style.css / js/{api,calendar,app}.js
.github/workflows/deploy.yml   push時にD1マイグレーション適用 + Worker自動デプロイ
```

## データベース(Cloudflare D1)

`cleaning-app-db-design.md` の設計書通り、6テーブル構成です。

- `staff` — スタッフ・Rクリーン(外部業者)共通マスタ
- `users` — ログインアカウント(admin / staff)
- `units` — 物件マスタ(b1〜b9)
- `reservations` — beds24由来の予約情報(`unit_id + checkout_date` でupsert)
- `staff_availability` — スタッフの清掃可否入力(3件◯/2件◯/1件◯/✕/13:30〜◯)
- `cleaning_tasks` — 自動割り振り結果(手動修正時は `is_manual_override=1` で保護)

D1データベース `cleanschedule-db` はすでにCloudflareアカウント上に作成済みで、
`wrangler.toml` にバインディング済みです(database_id: `e3168c7b-05f6-4c04-8cf3-4d0ec78cfd4d`)。

## 自動割り振りロジック(仕様書 4-4 / 4-5)

優先順位固定: **細田さん → 普久原さん → 福田さん → Rクリーン**。各スタッフの当日の
予定入力(`staff_availability`)に応じて件数上限を適用し、残りをすべてRクリーンへ割り振ります。

「13:30〜◯」は同日ターンオーバー最大1件+翌日以降最大1件という制約付きの実質2件ルールとして、
`src/assignment.ts` の `allocateForStaff` に実装しています(福田さんの `staff_id` を直接
判定するのではなく `availability_type` 側にルールを持たせているため、同じ働き方をする
スタッフが将来増えても `staff_rules` テーブルの追加なしに対応できます)。

### 自動割り振りの実行タイミング

毎日 **JST 10:30**(`wrangler.toml` の Cron Trigger)に、今日から30日先までの清掃タスクを
自動で再計算します(`src/index.ts` の `scheduled` ハンドラ → `src/generateTasks.ts`)。
手動修正済み(`is_manual_override=1`)や完了/キャンセル済みのタスクは対象外です。
時刻を変えたい場合は `wrangler.toml` の `[triggers] crons` を編集してください(UTC指定)。

10:30なのは、beds24の予約データ取り込み(ローカルのClaude Code / Coworkの「ルーティン」機能
で毎日JST 10:00に実行)より後ろにして、その日の最新データを反映してから割り振りが
走るようにするためです。ルーティンの実行時刻を変えた場合は、こちらも合わせて調整してください。

カレンダー画面の「この月を自動割り振り」ボタンで、Cronを待たずにその場で再計算することも
できます(管理者のみ)。

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. シークレットの設定(初回のみ、ローカル/本番それぞれ)

アプリの認証まわりで以下の2つのシークレットが必要です。**リポジトリにはコミットしません。**

| 名前 | 用途 |
|---|---|
| `JWT_SECRET` | ログインセッションの署名鍵(ランダムな長い文字列) |
| `INGEST_API_KEY` | Claude in Chrome → Claude Code が beds24 の予約情報を upsert する際に送る `X-Api-Key`(未設定でも管理者ログイン中は動作します) |

本番(Cloudflare側)への設定:

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put INGEST_API_KEY
```

ローカル開発用は `.dev.vars` ファイル(gitignore済み)に書きます:

```
JWT_SECRET=dev-secret-change-me
INGEST_API_KEY=dev-ingest-key
```

### 3. ローカル開発

```bash
npm run db:migrate:local   # ローカルD1にスキーマ+初期データを投入
npm run dev                 # http://localhost:8787
```

### 4. 本番デプロイ

GitHub Actions (`.github/workflows/deploy.yml`) が `main` ブランチへのpushで自動デプロイします。
リポジトリの Settings → Secrets and variables → Actions に以下を登録してください:

| Secret名 | 内容 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Workers/D1編集権限を持つCloudflare APIトークン |
| `CLOUDFLARE_ACCOUNT_ID` | CloudflareアカウントID |
| `JWT_SECRET` | ログインセッションの署名鍵。ローカルで `openssl rand -hex 32` などで生成した値を登録(チャットやコードに貼らないこと) |
| `INGEST_API_KEY` | beds24連携用の共有キー(任意、`openssl rand -hex 32` などで生成) |

`JWT_SECRET` / `INGEST_API_KEY` はワークフロー内で自動的に `wrangler secret put` に渡されるため、
手元で個別に設定する必要はありません(未登録の場合はワークフローが警告を出してスキップします)。

登録後、`main` へマージ(または `workflow_dispatch` で手動実行)するとD1マイグレーション適用
→ `wrangler deploy` → シークレット同期が走り、`https://cleanschedule.<あなたのサブドメイン>.workers.dev` で公開されます。

手元から直接デプロイする場合:

```bash
npx wrangler login
npm run db:migrate:remote
npm run deploy
npx wrangler secret put JWT_SECRET
npx wrangler secret put INGEST_API_KEY
```

## 初期ログイン情報

| ユーザー名 | パスワード | 権限 |
|---|---|---|
| `admin` | `admin1234` | 管理者 |

**本番公開後は「スタッフ管理」画面、または `wrangler d1 execute` で必ずパスワードを変更してください。**
スタッフごとのログインアカウントは、管理者が「スタッフ管理」画面から追加できます。

## 権限・画面

- **管理者**: カレンダー全体閲覧、ドラッグ&ドロップでの清掃日変更・担当再割当、
  月次自動割り振りの実行、スタッフ管理(追加・削除)
- **スタッフ**: 自分の清掃可否入力(1週間前締切、超過時は画面に警告表示)、
  カレンダー閲覧、自分に割り当てられたタスクの完了報告

## 未確定事項(設計書からの引き継ぎ)

- `cleaning_tasks.status='completed'` の更新は今回、担当スタッフ本人または管理者が
  カレンダー上の「完了報告」ボタンから行える形で実装しました(要件確定後に調整可能)。
- beds24からの読み取り(Claude in Chrome)自体は本アプリの範囲外です。読み取った内容を
  `POST /api/reservations/upsert`(または複数件まとめて送る `/upsert-batch`)へ送る連携部分は
  別途Claude Code側で実装してください。手順書とスクリプトを `docs/beds24-sync-guide.md` /
  `scripts/sync-reservations.sh` に用意しています(ローカルのClaude Code + Claude in Chromeで
  実行する想定。クラウド版のCleanSchedule自体はbeds24へアクセスできません)。
