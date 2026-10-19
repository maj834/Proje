#!/bin/bash
# Ekran goruntusu: ./tools/screenshot.sh [cikti.png]. Linux bulutta xvfb + yazilim GL kullanir.
set -euo pipefail
cd "$(dirname "$0")/.."
GODOT="${GODOT:-godot}"
OUT="$(realpath -m "${1:-docs/ekran.png}")"
DAY="${2:-0.42}"
EXTRA="${3:-}"
RUN=()
if [ -z "${DISPLAY:-}" ] && command -v xvfb-run >/dev/null; then
	RUN=(xvfb-run -a -s "-screen 0 1280x720x24")
fi
"${RUN[@]}" "$GODOT" --path . --rendering-driver opengl3 --script res://tools/capture.gd -- "$OUT" "$DAY" $EXTRA 2>&1 | grep -E "Kaydedildi|SCRIPT ERROR"
