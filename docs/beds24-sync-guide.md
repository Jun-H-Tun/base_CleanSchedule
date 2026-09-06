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
