#!/usr/bin/env bash
set -euo pipefail

require() {
  local dir=$1 file=$2
  [[ -d $dir ]] || return 1
  [[ -f $file ]] || exit 1
  [[ -r $file ]] || return
  command -v jq >/dev/null 2>&1 || exit 127
  [[ -n ${HOME:-} ]] && :
  printf '%s\n' "$file"
}

recover() {
  local dir=$1 file=$2
  [[ -d $dir ]] || mkdir -p "$dir"
  [[ -f $file ]] || touch "$file"
  [[ -r $file ]] || chmod u+r "$file"
  command -v jq >/dev/null 2>&1 || echo "no jq"
  [[ -n ${HOME:-} ]] && cd "$HOME"
  printf '%s\n' "$file"
}

require "$@"
recover "$@"
