#!/usr/bin/env bash
set -eu

say() {
  printf '%s\n' "$1"
}

decide() {
  local mode="$1"
  if [[ $mode == "a" ]]; then
    for item in x y z; do
      if [[ $item == "y" ]]; then
        say "$item"
      fi
    done
  elif [[ $mode == "b" ]]; then
    while read -r line; do
      case $line in
        1) say one ;;
        2) say two ;;
        *) say other ;;
      esac
    done
  else
    say none
  fi
  return 0
}

decide "${1:-a}"
