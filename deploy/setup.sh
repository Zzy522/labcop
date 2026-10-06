#!/bin/sh
# Download a release/source checkout first; run from any working directory.
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if command -v python3 >/dev/null 2>&1; then
  exec python3 "$SCRIPT_DIR/selfhost.py" "$@"
elif command -v python >/dev/null 2>&1; then
  exec python "$SCRIPT_DIR/selfhost.py" "$@"
else
  echo '需要 Python 3.9+。安装后重试；详见 docs/self-hosting-guide.md。' >&2
  exit 1
fi
