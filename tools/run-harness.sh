#!/bin/bash
# Run the Photoshop integration harness and print its results.
# Usage: tools/run-harness.sh ["Adobe Photoshop 2026"]
# Needs Photoshop running. Closes only the documents the harness created.
set -euo pipefail
APP="${1:-Adobe Photoshop 2026}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/test/.build"
mkdir -p "$OUT"
cat "$ROOT/plugin/js/zones.js" "$ROOT/plugin/js/ps.js" "$ROOT/test/ps-harness.js" > "$OUT/harness.psjs"

ps() { osascript -e "tell application \"$APP\" to do javascript \"$1\""; }

# Close leftovers from an earlier run.
ps "for (var i = app.documents.length - 1; i >= 0; i--) { var n = app.documents[i].name; if (/^VF_HARNESS|^Opportunities — VF_HARNESS/.test(n)) app.documents[i].close(SaveOptions.DONOTSAVECHANGES); } 'ok'" >/dev/null

open -a "$APP" "$OUT/harness.psjs"

FIND="var r = ''; for (var i = 0; i < app.documents.length; i++) if (app.documents[i].name == 'VF_HARNESS_RESULTS') r = app.documents[i].info.caption; r"
for _ in $(seq 1 90); do
  sleep 2
  RES="$(ps "$FIND" 2>/dev/null || true)"
  if [ -n "$RES" ]; then break; fi
done

ps "for (var i = app.documents.length - 1; i >= 0; i--) { var n = app.documents[i].name; if (/^VF_HARNESS|^Opportunities — VF_HARNESS/.test(n)) app.documents[i].close(SaveOptions.DONOTSAVECHANGES); } 'ok'" >/dev/null

if [ -z "${RES:-}" ]; then echo "No results after 180 s"; exit 2; fi
echo "$RES" | tr '\r' '\n'
echo "$RES" | tr '\r' '\n' | grep -q '^SUMMARY .* 0 failed' 
