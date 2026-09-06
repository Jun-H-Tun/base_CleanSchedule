# beds24 → CleanSchedule 連携手順(Claude in Chrome + ローカルClaude Code)

このアプリ自体(Cloudflare上のCleanSchedule)は beds24 にはアクセスできません。
「Claude in Chromeでbeds24を読み取り → ローカルのClaude CodeがAPIへ送信する」流れは、
**あなたのPC上**で完結させます(クラウド版のClaude Codeセッションでは実行できません)。

## 前提条件

- あなたのPCに Claude in Chrome がセットアップ済み、beds24 にログイン済み
- あなたのPCに Claude Code(CLI)がセットアップ済み、かつ `python3` と `curl` が使える
- `INGEST_API_KEY` の値を控えている(GitHub Secretsに登録したものと同じ値。Cloudflare側にも
  `.github/workflows/deploy.yml` 経由で自動同期済み)

## 手順

### 1. このリポジトリをローカルにclone(まだの場合)

```bash
git clone https://github.com/Jun-H-Tun/base_CleanSchedule.git
cd base_CleanSchedule
```

### 2. INGEST_API_KEY を環境変数に設定

```bash
export CLEANSCHEDULE_INGEST_KEY="<GitHub Secretsに登録したINGEST_API_KEYの値>"
```

(ターミナルを開き直すたびに設定し直したくない場合は `~/.zshrc` などに追記してください)

### 3. ローカルのClaude Codeに、まとめて依頼する

ローカルのClaude Codeに、次のようなプロンプトを渡してください(コピペでOK):

> Claude in Chromeでbeds24の予約カレンダー画面を確認し、表示されている予約それぞれについて
> 以下の情報を抽出してください。
> - unitName: 物件名(b1〜b9)
> - checkoutDate: チェックアウト日(YYYY-MM-DD)
> - nextCheckinDate: 次の予約のチェックイン日(YYYY-MM-DD、未定ならnull)
> - nextGuestCount: 次の予約の人数(未定ならnull)
> - notes: 備考欄の内容そのまま(なければnull)
>
> 抽出できたら、それらをJSON配列として `reservations.json` というファイルに保存してください。
> 保存できたら `./scripts/sync-reservations.sh reservations.json` を実行してCleanScheduleへ反映してください。

ローカルのClaude Codeは、Claude in Chromeの読み取り結果を受け取り→JSONファイル作成→
`scripts/sync-reservations.sh` の実行、まで一気通貫でやってくれます。

### 4. 反映結果の確認

スクリプトを実行すると `{"ok":true,"count":N}` のようなレスポンスが返ります。
`N` が想定した件数と一致しているか確認してください。

その後、CleanScheduleのカレンダー画面(管理者ログイン)を開き、該当日に予約が反映されているか、
「この月を自動割り振り」ボタンで清掃タスクが割り振られるかを確認してください。

## トラブルシューティング

| 症状 | 原因・対処 |
|---|---|
| `401` または `認証が必要です` | `CLEANSCHEDULE_INGEST_KEY` が未設定、または値が違う。GitHub Secretsの値と一致しているか確認 |
| `不明なユニットです: xxx` | `unitName` が `b1`〜`b9` の表記と一致していない(全角/半角、大文字小文字など) |
| 日付が反映されない/ズレる | `checkoutDate` / `nextCheckinDate` が `YYYY-MM-DD` 形式になっているか確認 |
| 件数が0件 | `reservations.json` が配列 `[...]` になっているか(オブジェクト1件だけを渡していないか)確認 |

## 毎日決まった時刻に「半自動」で実行する(macOS)

手順3を毎回手打ちするのではなく、決まった時刻に**通知(確認ダイアログ)を出して、
クリックしたら実行する**という半自動化ができます。フルの無人自動化(確認なしで実行)は
誤動作のリスクがあるため、あえて「人がクリックする1手間」を残した安全側の構成です。

用意しているファイル:

- `scripts/daily-sync-prompt.txt` — Claude Codeに渡すプロンプト本文(手順3と同じ内容)
- `scripts/run-claude-sync.sh` — 上記プロンプトでClaude Codeを起動するスクリプト
- `scripts/mac-daily-reminder.sh` — 確認ダイアログを出し、「実行する」が押されたら
  Terminal.appで `run-claude-sync.sh` を開くスクリプト
- `scripts/com.cleanschedule.dailyreminder.plist.example` — 上記を毎日決まった時刻に
  起動するための launchd 設定テンプレート

### セットアップ

1. `CLEANSCHEDULE_INGEST_KEY` を `~/.zshrc`(または `~/.bash_profile`)に追記して、
   新しいターミナルでも自動で読み込まれるようにしておく:
   ```bash
   echo 'export CLEANSCHEDULE_INGEST_KEY="<INGEST_API_KEYの値>"' >> ~/.zshrc
   ```
2. リポジトリのフルパスを確認:
   ```bash
   cd base_CleanSchedule && pwd
   ```
3. plistテンプレートをコピーして、パスと時刻を書き換える:
   ```bash
   cp scripts/com.cleanschedule.dailyreminder.plist.example \
      ~/Library/LaunchAgents/com.cleanschedule.dailyreminder.plist
   # ~/Library/LaunchAgents/com.cleanschedule.dailyreminder.plist を開き、
   # /REPLACE/ME/base_CleanSchedule を手順2で確認した実際のパスに書き換える
   # (時刻を変えたい場合は Hour / Minute も編集)
   ```
4. 登録して有効化:
   ```bash
   launchctl load -w ~/Library/LaunchAgents/com.cleanschedule.dailyreminder.plist
   ```
5. うまく動くか、その場ですぐテストしたい場合:
   ```bash
   launchctl start com.cleanschedule.dailyreminder
   ```
   設定した時刻を待たずにダイアログが出るはずです。

### 動作の流れ

1. 設定した時刻にダイアログ「beds24の予約データをCleanScheduleに同期しますか?」が表示される
   (120秒操作がなければ自動的に「あとで」扱いでスキップ)
2. 「実行する」を押すとTerminal.appが開き、`run-claude-sync.sh` が起動する
3. ローカルのClaude Codeが `daily-sync-prompt.txt` の内容に従って、
   Claude in Chromeでbeds24を読み取り→`reservations.json`保存→`sync-reservations.sh`実行、
   まで進める(このとき実際のコマンド実行前には普段通りの権限確認が入ります)

ログは `/tmp/cleanschedule-sync.log`(ダイアログの応答)、
`/tmp/cleanschedule-dailyreminder.{out,err}.log`(launchd自体のログ)に出力されます。

### 停止・変更したいとき

```bash
launchctl unload ~/Library/LaunchAgents/com.cleanschedule.dailyreminder.plist
```

時刻を変えたい場合は plist を編集後、unload → load し直してください。

> **注意**: `mac-daily-reminder.sh` のダイアログ表示・Terminal起動まわりの AppleScript は
> macOSのバージョンによって挙動が微妙に異なることがあります。一度 `launchctl start` で
> 手動テストして、期待通りダイアログが出てTerminalが開くか確認してから運用してください。

## 単発で1件だけ手動登録したい場合

`scripts/sync-reservations.sh` を使わず、直接curlで1件だけ送ることもできます:

```bash
curl -X POST https://cleanschedule.base-for-good-trip.workers.dev/api/reservations/upsert \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $CLEANSCHEDULE_INGEST_KEY" \
  -d '{
    "unitName": "b1",
    "checkoutDate": "2026-09-10",
    "nextCheckinDate": "2026-09-10",
    "nextGuestCount": 4,
    "notes": "ベビーベッド"
  }'
```
