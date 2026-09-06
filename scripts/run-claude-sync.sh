#!/usr/bin/env bash
# beds24の読み取り→CleanScheduleへの反映を、ローカルのClaude Codeに依頼する。
# Terminal.appから(mac-daily-reminder.sh経由、または手動で)直接実行する想定。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
claude "$(cat scripts/daily-sync-prompt.txt)"
