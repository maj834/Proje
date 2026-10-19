#!/bin/bash
# Bulut oturumu: Koloni (Godot) icin Godot 4.4.1 ve gdtoolkit kurar, projeyi ice aktarir.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

GODOT_VERSION="4.4.1-stable"
GODOT_DIR="$HOME/.local/godot"
GODOT_BIN="$GODOT_DIR/Godot_v${GODOT_VERSION}_linux.x86_64"

if [ ! -x "$GODOT_BIN" ]; then
  mkdir -p "$GODOT_DIR"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/godot.zip" \
    "https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}/Godot_v${GODOT_VERSION}_linux.x86_64.zip"
  unzip -oq "$tmp/godot.zip" -d "$GODOT_DIR"
  rm -rf "$tmp"
fi
ln -sf "$GODOT_BIN" "$GODOT_DIR/godot"

if ! command -v gdlint >/dev/null 2>&1; then
  python3 -m pip install -q "gdtoolkit==4.*"
fi

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export GODOT=\"$GODOT_BIN\"" >> "$CLAUDE_ENV_FILE"
  echo "export PATH=\"$GODOT_DIR:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

# Ilk ice aktarma (.godot/ onbellegi); hata oturumu durdurmasin.
"$GODOT_BIN" --headless --path "$CLAUDE_PROJECT_DIR/koloni" --import >/dev/null 2>&1 || true
