#!/usr/bin/bash
# The lab suite for the Store block: every hostile condition the contract
# refuses, planted in a throwaway HOME, and the block run against it in a
# separate quickshell instance (systemd-run --user --scope -p MemoryMax=768M,
# setsid when the user manager is not reachable), never in omarchy-shell.
# Per scenario the driver prepares HOME, starts the harness with that HOME,
# waits for its results, then records what the filesystem looks like
# afterwards; tests/lab/store/report.py asserts the states and those facts.
#
#   bash tests/lab/store/suite.sh [out-dir]       default /tmp/omakit-storelab
#   RUNLAB_BLOCKS=<dir>                           the blocks/ directory to test
set -u
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd -- "$here/../../.." && pwd)"
blocks="${RUNLAB_BLOCKS:-$repo/blocks}"
out="${1:-/tmp/omakit-storelab}"
scenarios=(plain symlink-directory symlink-parent symlink-file swap oversized group-writable foreign-owner invalid crash concurrent outside-home)
plugin=lab.store.fixture

for tool in /usr/bin/python3 /usr/bin/quickshell; do [[ -x $tool ]] || { echo "not ok - $tool is missing" >&2; exit 1; }; done
[[ -n ${WAYLAND_DISPLAY:-} ]] || { echo "not ok - no WAYLAND_DISPLAY" >&2; exit 1; }
rm -rf "$out" && mkdir -p "$out/runs" "$out/harness/omakit" "$out/homes" || exit 1
cp "$here/harness/shell.qml" "$out/harness/" && cp "$blocks"/run/Run.qml "$blocks"/run/run-supervisor.py "$blocks"/store/Store.qml "$blocks"/store/store-helper.py "$out/harness/omakit/" || exit 1
scope_ok=0; systemd-run --user --scope --quiet -p MemoryMax=768M -- /usr/bin/true >/dev/null 2>&1 && scope_ok=1
sudo_ok=0; sudo -n /usr/bin/chown --version >/dev/null 2>&1 && sudo_ok=1
echo "# scope: $([[ $scope_ok == 1 ]] && echo systemd-run || echo setsid); sudo for the foreign owner: $([[ $sudo_ok == 1 ]] && echo yes || echo no)"

count_ev() { grep -o 'STORELAB {.*}' "$log" | grep -c "\"ev\":\"$1\""; }
waitev() { local n=0; while [[ $(count_ev "$1") -lt 1 ]]; do sleep 0.05; n=$((n+1)); [[ $n -gt $(( $2 * 20 )) ]] && return 1; done; return 0; }

prepare() {
  # A fresh HOME, 0700, with the state and cache bases; the victim outside it.
  local scen=$1 home=$2 dir=$2/.local/state/$plugin
  mkdir -m 0700 "$home" && mkdir -p -m 0700 "$home/.local" "$home/.local/state" "$home/.cache" || return 1
  mkdir -p "$out/victims" && printf 'untouched\n' > "$out/victims/$scen"
  case $scen in
    symlink-directory) ln -s "$out/victims" "$dir" ;;
    symlink-parent) rm -rf "$home/.local/state" && ln -s "$out/victims" "$home/.local/state" ;;
    symlink-file) mkdir -m 0700 "$dir" && ln -s "$out/victims/$scen" "$dir/memory.json" ;;
    swap) mkdir -m 0700 "$dir" && printf '{"version":1,"themes":{}}\n' > "$dir/memory.json" ;;
    oversized) mkdir -p -m 0700 "$home/.cache/$plugin" && /usr/bin/head -c 2097152 /dev/zero | tr '\0' 'x' > "$home/.cache/$plugin/catalog.json" ;;
    group-writable) mkdir -m 0700 "$dir" && printf '{"version":1,"themes":{}}\n' > "$dir/memory.json" && chmod 0660 "$dir/memory.json" ;;
    foreign-owner) mkdir -m 0700 "$dir" && printf '{"version":1,"themes":{}}\n' > "$dir/memory.json" && { [[ $sudo_ok == 0 ]] || sudo -n chown root "$dir/memory.json"; } ;;
    invalid) mkdir -m 0700 "$dir" && printf '{"version":"one","themes":{}}\n' > "$dir/memory.json" ;;
    crash) mkdir -m 0700 "$dir" && printf '{"version":1,"themes":{}}\n' > "$dir/memory.json" \
      && printf '{"version":9' > "$dir/.store-99999-0123456789abcdef.tmp" && touch -d '-1 hour' "$dir/.store-99999-0123456789abcdef.tmp" \
      && printf '{"version":9' > "$dir/.store-99998-fedcba9876543210.tmp" ;;
  esac
}

one() {
  local scen=$1 home=$out/homes/$scen tag=$1
  log=$out/runs/$tag.log; local meta=$out/runs/$tag.meta
  : > "$log"; : > "$meta"
  prepare "$scen" "$home" || { echo "prepare failed" >>"$meta"; return 1; }
  echo "victim_dir_before=$(ls -A "$out/victims" | wc -l)" >>"$meta"
  # The session's own XDG bases point into the real HOME; the instance gets
  # the throwaway one and the defaults below it, unless the scenario sets one.
  local -a env=(-u XDG_STATE_HOME -u XDG_CACHE_HOME STORELAB_SCENARIO="$scen" HOME="$home")
  [[ $scen == outside-home ]] && env+=(XDG_STATE_HOME="$out/victims")
  [[ $scen == foreign-owner && $sudo_ok == 0 ]] && echo "foreign_owner=not-simulated" >>"$meta"
  [[ $scen == foreign-owner && $sudo_ok == 1 ]] && echo "foreign_owner=root" >>"$meta"
  local unit=storelab-$tag-$$
  if [[ $scope_ok == 1 ]]; then
    systemd-run --user --scope --quiet -p MemoryMax=768M --unit="$unit" -- /usr/bin/env "${env[@]}" /usr/bin/quickshell -p "$out/harness" >"$log" 2>&1 &
  else
    /usr/bin/setsid /usr/bin/env "${env[@]}" /usr/bin/quickshell -p "$out/harness" >"$log" 2>&1 < /dev/null &
  fi
  local runner=$! swapper=""
  waitev ready 30 || { echo "no ready line" >>"$meta"; kill -KILL -- -"$runner" 2>/dev/null; systemctl --user stop "$unit.scope" 2>/dev/null; return 1; }
  if [[ $scen == swap ]]; then
    # A hostile neighbour swaps the file between a regular file and a link to the victim while the block reads and writes.
    ( local d=$home/.local/state/$plugin; while [[ -d $d ]]; do ln -sfn "$out/victims/swap" "$d/memory.json.lnk" && mv -T "$d/memory.json.lnk" "$d/memory.json" 2>/dev/null; printf '{"version":1,"themes":{}}\n' > "$d/memory.json.new" && mv -T "$d/memory.json.new" "$d/memory.json" 2>/dev/null; done ) &
    swapper=$!
  fi
  waitev all-done 120 || echo "no all-done within 120 s" >>"$meta"
  [[ -n $swapper ]] && { kill "$swapper" 2>/dev/null; wait "$swapper" 2>/dev/null; }
  sleep 1
  local dir=$home/.local/state/$plugin
  { echo "victim=$(cat "$out/victims/$scen" 2>/dev/null)"
    echo "victim_dir_after=$(ls -A "$out/victims" | wc -l)"
    [[ -e $dir ]] && echo "dir_mode=$(stat -c %a "$dir")" && echo "dir_type=$(stat -c %F "$dir")"
    [[ -e $dir/memory.json ]] && echo "file_mode=$(stat -c %a "$dir/memory.json")" && echo "file_type=$(stat -c %F "$dir/memory.json")" && echo "file_content=$(tr -d '\n ' < "$dir/memory.json" | head -c 200)"
    [[ -d $dir ]] && echo "staging_left=$(ls -A "$dir" | grep -c '^\.store-')" && echo "entries=$(ls -A "$dir" | tr '\n' ' ')"
  } >>"$meta" 2>/dev/null
  if [[ $scope_ok == 1 ]]; then systemctl --user stop "$unit.scope" 2>/dev/null; else kill -KILL -- -"$runner" 2>/dev/null; fi
  wait "$runner" 2>/dev/null
  [[ $scen == foreign-owner && $sudo_ok == 1 ]] && sudo -n chown "$(id -u)" "$dir/memory.json" 2>/dev/null
  return 0
}

for scen in "${scenarios[@]}"; do
  one "$scen" || echo "not ok - $scen did not run" >&2
  echo "# done $scen $(grep -o '"state":"[a-z-]*"' "$out/runs/$scen.log" | sort | uniq -c | tr '\n' ' ')"
done
/usr/bin/python3 "$here/report.py" "$out" "$blocks"
