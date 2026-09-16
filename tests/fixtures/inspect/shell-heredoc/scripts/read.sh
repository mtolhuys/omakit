#!/usr/bin/env bash
set -euo pipefail

read_entry() {
  THEME="$1" python3 - <<'PY'
import os, sys
theme = os.environ.get("THEME", "")
if not theme:
    sys.exit(0)
for part in theme.split("/"):
    if part:
        with open(part) as handle:
            print(handle.read())
PY
}

theme_inherits() {
  local index=$1
  awk -F= '
    BEGIN { in_theme=0 }
    /^\[Icon Theme\]/ { in_theme=1; next }
    /^\[/ { in_theme=0 }
    in_theme && $1 ~ /^Inherits[[:space:]]*$/ {
      if ($2 != "") print $2
      exit
    }
  ' "$index"
}

read_entry "$1"
theme_inherits "$2"
