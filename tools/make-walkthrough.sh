#!/bin/bash
# Regenerate the figures, measurements and zone charts for docs/WALKTHROUGH.md
# by running the plugin's own code on the photograph in Photoshop.
# Usage: tools/make-walkthrough.sh [image] [output dir]
# Needs macOS with Photoshop running (set PHOTOSHOP_APP for another version).
# Creates and closes only its own documents: a copy of the photograph titled as
# in tools/walkthrough.config.json, VF_WALK_RESULTS, VF_FIG_* and its sheets.
set -euo pipefail
APP="${PHOTOSHOP_APP:-Adobe Photoshop 2026}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMG="$(cd "$(dirname "${1:-$ROOT/docs/images/walkthrough/source.jpg}")" && pwd)/$(basename "${1:-source.jpg}")"
OUT="$(mkdir -p "${2:-$ROOT/docs/images/walkthrough}" && cd "${2:-$ROOT/docs/images/walkthrough}" && pwd)"
HOST="$ROOT/tools/walkthrough-host.jsx"
BUILD="$ROOT/test/.build"
mkdir -p "$BUILD"
TITLE="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["title"])' "$ROOT/tools/walkthrough.config.json")"

host() { osascript -e "tell application \"$APP\" to do javascript file (POSIX file \"$HOST\") with arguments {$1}"; }

{
  printf 'globalThis.WALK = %s;\n' "$(cat "$ROOT/tools/walkthrough.config.json")"
  cat "$ROOT/plugin/js/zones.js" "$ROOT/plugin/js/ps.js" "$ROOT/tools/walkthrough.js"
} > "$BUILD/walkthrough.psjs"

echo "Opening $(basename "$IMG")…"
if [ "$(host "\"open\", \"$IMG\", \"$TITLE\"")" = "EXISTS" ]; then
  echo "A document titled \"$TITLE\" is already open. Close or rename it, then run again."
  exit 3
fi

# From here on, documents with our names are ours. Close them however the run
# ends, then check with Photoshop that none were left behind.
CLEANED=0
cleanup() {
  [ "$CLEANED" = 1 ] && return 0
  CLEANED=1 # attempted: the exit trap shouldn't repeat it
  host "\"cleanup\", \"$TITLE\"" >/dev/null 2>&1 || true
  local left
  left="$(host "\"remaining\", \"$TITLE\"" 2>/dev/null | tr '\r' '\n' || true)"
  if [ -n "$left" ]; then
    echo "These documents are still open in Photoshop; close them without saving:" >&2
    printf '%s\n' "$left" | sed 's/^/  /' >&2
    return 1
  fi
}
trap 'cleanup || exit 4' EXIT

open -a "$APP" "$BUILD/walkthrough.psjs"

RES=""
for _ in $(seq 1 300); do
  sleep "${WALK_POLL_SECONDS:-2}"
  RES="$(host '"results"' 2>/dev/null || true)"
  [ -n "$RES" ] && break
done
if [ -z "$RES" ]; then echo "No results from Photoshop after 300 checks" >&2; exit 2; fi

printf '%s' "$RES" | python3 -c 'import json,sys; d=json.load(sys.stdin); json.dump(d, open(sys.argv[1], "w"), indent=1); print("errors:", d["errors"] or "none")' "$OUT/measurements.json"
echo "Exported $(host "\"export\", \"$OUT\"") figures to $OUT"
cleanup || exit 4
echo "Closed every document this run created."
node "$ROOT/tools/make-zone-charts.js" "$OUT/measurements.json" "$OUT"
