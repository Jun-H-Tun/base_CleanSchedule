#!/usr/bin/env bash
# beds24から読み取った予約情報(JSON配列)を CleanSchedule のAPIへ一括送信するスクリプト。
#
# 使い方:
#   export CLEANSCHEDULE_INGEST_KEY="<INGEST_API_KEYの値>"
#   ./scripts/sync-reservations.sh reservations.json
#
# reservations.json の中身は、以下の形式のオブジェクトを並べたJSON配列:
#   [
#     {
#       "unitName": "b1",
#       "checkoutDate": "2026-09-10",
#       "nextCheckinDate": "2026-09-10",   // 未定なら null
#       "nextGuestCount": 4,                // 未定なら null
#       "notes": "ベビーベッド"              // なければ null
#     },
#     ...
#   ]
#
# 環境変数:
#   CLEANSCHEDULE_URL          省略時は本番URL (https://cleanschedule.base-for-good-trip.workers.dev)
#   CLEANSCHEDULE_INGEST_KEY   必須。wrangler/GitHub Secretsに登録した INGEST_API_KEY と同じ値

set -euo pipefail

FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "使い方: $0 <reservations.json>" >&2
  exit 1
fi
if [ ! -f "$FILE" ]; then
  echo "エラー: ファイルが見つかりません: $FILE" >&2
  exit 1
fi

URL="${CLEANSCHEDULE_URL:-https://cleanschedule.base-for-good-trip.workers.dev}"
: "${CLEANSCHEDULE_INGEST_KEY:?CLEANSCHEDULE_INGEST_KEY環境変数を設定してください(例: export CLEANSCHEDULE_INGEST_KEY=...)}"

BODY=$(python3 -c "
import json, sys
with open(sys.argv[1], encoding='utf-8') as f:
    items = json.load(f)
if not isinstance(items, list):
    raise SystemExit('reservations.json はJSON配列である必要があります')
print(json.dumps({'items': items}, ensure_ascii=False))
" "$FILE")

echo "→ ${URL}/api/reservations/upsert-batch に $(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))))" "$FILE")件送信します..."

curl -sS -X POST "${URL}/api/reservations/upsert-batch" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: ${CLEANSCHEDULE_INGEST_KEY}" \
  -d "$BODY"
echo
