#!/bin/bash
# Lint + bicim + simulasyon testleri + sahne acilis kontrolu. Kok: koloni/
set -euo pipefail
cd "$(dirname "$0")/.."
GODOT="${GODOT:-godot}"

gdformat --check scripts tests tools
gdlint scripts tests tools
"$GODOT" --headless --path . --import >/dev/null 2>&1 || true
"$GODOT" --headless --path . --script res://tests/test_sim.gd
# Ana sahne 300 kare hatasiz donmeli.
if "$GODOT" --headless --path . --quit-after 300 2>&1 | grep -E "SCRIPT ERROR|^ERROR"; then
	echo "Ana sahnede hata var" >&2
	exit 1
fi
echo "check.sh: hepsi temiz"
