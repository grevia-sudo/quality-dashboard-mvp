#!/usr/bin/env bash
set -euo pipefail

cd /home/ubuntu/quality-dashboard-mvp

PLAN_PATH="${1:-tmp/purchase-sheet-plan.json}"
SUMMARY_PATH="${2:-tmp/purchase-sheet-apply-summary.json}"
APPEND_PAYLOAD="tmp/purchase-sheet-append-payload.json"
UPDATE_PAYLOAD="tmp/purchase-sheet-update-payload.json"

node scripts/build-purchase-sheet-batch-payloads.mjs "$PLAN_PATH" "$APPEND_PAYLOAD" "$UPDATE_PAYLOAD"

if [[ "$(cat "$APPEND_PAYLOAD")" != '{
  "values": []
}' ]]; then
  gws sheets spreadsheets values append \
    --params "{\"spreadsheetId\":\"15uKVOc13iVhs2ffT9FWgKti47s38Hl_Zyjht6o7HU_Y\",\"range\":\"採購單!A:H\",\"valueInputOption\":\"USER_ENTERED\"}" \
    --json "$(cat "$APPEND_PAYLOAD")" \
    --format json >/dev/null
fi

if [[ "$(cat "$UPDATE_PAYLOAD")" != '{
  "valueInputOption": "USER_ENTERED",
  "data": []
}' ]]; then
  gws sheets spreadsheets values batchUpdate \
    --params "{\"spreadsheetId\":\"15uKVOc13iVhs2ffT9FWgKti47s38Hl_Zyjht6o7HU_Y\"}" \
    --json "$(cat "$UPDATE_PAYLOAD")" \
    --format json >/dev/null
fi

node scripts/finalize-purchase-sheet-sync.mjs "$PLAN_PATH" "$SUMMARY_PATH"
