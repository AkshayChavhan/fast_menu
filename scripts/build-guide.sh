#!/usr/bin/env bash
# Render the guide book (docs/user-guide/index.html) to a PDF with headless
# Chrome. Usage: scripts/build-guide.sh [output.pdf]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-docs/user-guide/fast_menu-guide-book.pdf}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$OUT" "file://$PWD/docs/user-guide/index.html" 2>/dev/null
echo "wrote $OUT"
