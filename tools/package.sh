#!/bin/bash
# Package the plugin as a .ccx (a zip with manifest.json at its root).
# Double-click the result to install it through Creative Cloud.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['version'])" "$ROOT/plugin/manifest.json")"
mkdir -p "$ROOT/dist"
OUT="$ROOT/dist/visualize-first-$VERSION.ccx"
rm -f "$OUT"
(cd "$ROOT/plugin" && zip -qr -X "$OUT" manifest.json index.html js icons)
echo "$OUT"
