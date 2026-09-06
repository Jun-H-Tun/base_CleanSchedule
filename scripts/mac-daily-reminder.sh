#!/usr/bin/env bash
# 毎日決まった時刻にmacOSのlaunchdから起動される「半自動」リマインダー。
#
# 動作:
#   1. ダイアログを表示して「実行する/あとで」を確認(120秒で自動的に「あとで」扱い)
#   2. 「実行する」が押されたら、Terminal.appを開いて run-claude-sync.sh を実行する
#
# run-claude-sync.sh が起動するClaude Codeは通常通りの権限確認モードで動くため
# (--dangerously-skip-permissions は使わない)、実際のコマンド実行前には普段通りの
# 確認が入ります。安全側の「半自動」構成です。
#
# セットアップ手順は docs/beds24-sync-guide.md を参照してください。

set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="/tmp/cleanschedule-sync.log"
RUN_SCRIPT="$REPO_DIR/scripts/run-claude-sync.sh"

BUTTON=$(osascript \
  -e 'display dialog "beds24の予約データをCleanScheduleに同期しますか?" with title "CleanSchedule 日次同期" buttons {"あとで", "実行する"} default button "実行する" giving up after 120' \
  -e 'button returned of result' 2>/dev/null || echo "あとで")

if [ "$BUTTON" != "実行する" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S'): スキップされました(未応答またはキャンセル)" >> "$LOG_FILE"
  exit 0
fi

echo "$(date '+%Y-%m-%d %H:%M:%S'): 実行開始" >> "$LOG_FILE"

# Terminal.appに渡すのはスクリプトのパスのみ(引用符のネストを避けるため)。
osascript -e "tell application \"Terminal\" to activate" \
          -e "tell application \"Terminal\" to do script (quoted form of \"$RUN_SCRIPT\")"
