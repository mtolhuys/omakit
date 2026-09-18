#!/usr/bin/bash
# The lab suite for the Run block: the spike's scenarios made repeatable,
# on whatever machine runs it (the desktop, or the 4.0.3 guest through
# tests/lab/run/lab.sh). Never touches the running omarchy-shell: every
# scenario starts its own `quickshell -p <harness>` in a transient user
# scope (systemd-run --user --scope -p MemoryMax=768M; setsid when the
# user manager is not reachable), samples that instance's Pss from
# /proc/<pid>/smaps_rollup every 100 ms, waits for the harness's result
# lines, counts survivors two seconds later by pgid and by scope, and stops
# the scope. tests/lab/run/report.py turns the runs into one document and
# asserts the gate: every run ends within deadline plus grace, no survivor,
# no signal to an empty group, no shadow hit, the state the scenario expects.
#
#   bash tests/lab/run/suite.sh [out-dir] [runs]     default: /tmp/omakit-runlab, 1 run per scenario
#   RUNLAB_BLOCKS=<dir>                              the block files to test; default blocks/run of this checkout
set -u
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd -- "$here/../../.." && pwd)"
blocks="${RUNLAB_BLOCKS:-$repo/blocks/run}"
out="${1:-/tmp/omakit-runlab}"
runs="${2:-1}"
scenarios=(producer producer-stream holder stubborn hostile destroy cancel supersede shell-string relative missing controls concurrency forge orphan stalled-supersede destroy-early shell-string-option shell-string-wrapper)

for tool in /usr/bin/python3 /usr/bin/quickshell /usr/bin/setsid /usr/bin/kill; do
  [[ -x $tool ]] || { echo "not ok - $tool is missing" >&2; exit 1; }
done
[[ -n ${WAYLAND_DISPLAY:-} ]] || { echo "not ok - no WAYLAND_DISPLAY; quickshell needs the session" >&2; exit 1; }
[[ -f $blocks/Run.qml && -f $blocks/run-supervisor.py ]] || { echo "not ok - no block files at $blocks" >&2; exit 1; }
[[ $runs =~ ^[1-9][0-9]*$ ]] || { echo "not ok - runs must be a positive integer" >&2; exit 1; }

rm -rf "$out" && mkdir -p "$out/runs" "$out/harness/omakit" "$out/shadow/pypath" || exit 1
cp "$here/harness/shell.qml" "$out/harness/" && cp -r "$here/harness/scenarios" "$out/harness/" || exit 1
cp "$blocks/Run.qml" "$blocks/run-supervisor.py" "$out/harness/omakit/" || exit 1
# The shadow directory for the hostile scenario: copies first in PATH that
# log a hit and exec the real tool; BASH_ENV and a json.py in PYTHONPATH.
for b in kill setsid python3 bash sh head sleep env sort sed wc; do
  printf '#!/usr/bin/bash\nprintf "shadow %%s ppid=%%s\\n" "%s" "$PPID" >> %s/shadow/hits.log\nexec /usr/bin/%s "$@"\n' "$b" "$out" "$b" > "$out/shadow/$b"
  chmod +x "$out/shadow/$b"
done
printf 'printf "BASH_ENV sourced by pid=%%s\\n" "$$" >> %s/shadow/hits.log\n' "$out" > "$out/shadow/bash_env.sh"
printf 'open("%s/shadow/hits.log","a").write("PYTHONPATH json.py imported\\n")\nraise SystemExit(99)\n' "$out" > "$out/shadow/pypath/json.py"

scope_ok=0
systemd-run --user --scope --quiet -p MemoryMax=768M -- /usr/bin/true >/dev/null 2>&1 && scope_ok=1
echo "# scope: $([[ $scope_ok == 1 ]] && echo systemd-run || echo setsid)"

ev() { grep -o 'RUNLAB {.*}' "$log" | sed 's/^RUNLAB //' | grep "\"ev\":\"$1\"" | head -1; }
count_ev() { grep -o 'RUNLAB {.*}' "$log" | grep -c "\"ev\":\"$1\""; }
waitev() { local n=0; while [[ $(count_ev "$1") -lt $2 ]]; do sleep 0.05; n=$((n+1)); [[ $n -gt $(( $3 * 20 )) ]] && return 1; done; return 0; }

one() {
  local scen=$1 index=$2 tag=$1-$2
  log=$out/runs/$tag.log; local pss=$out/runs/$tag.pss meta=$out/runs/$tag.meta
  : > "$out/shadow/hits.log"; : > "$log"; : > "$pss"; : > "$meta"
  local -a env=(RUNLAB_SCENARIO="$scen" RUNLAB_BASE="$out/harness" RUNLAB_KEEP="${RUNLAB_KEEP:-65536}")
  [[ $scen == hostile ]] && env+=(PATH="$out/shadow:$PATH" BASH_ENV="$out/shadow/bash_env.sh" PYTHONPATH="$out/shadow/pypath")
  local unit=runlab-$tag-$$
  if [[ $scope_ok == 1 ]]; then
    systemd-run --user --scope --quiet -p MemoryMax=768M --unit="$unit" -- /usr/bin/env "${env[@]}" /usr/bin/quickshell -p "$out/harness" >"$log" 2>&1 &
  else
    /usr/bin/setsid /usr/bin/env "${env[@]}" /usr/bin/quickshell -p "$out/harness" >"$log" 2>&1 < /dev/null &
  fi
  local runner=$!
  waitev ready 1 30 || { echo "no ready line" >>"$meta"; kill -KILL -- -"$runner" 2>/dev/null; systemctl --user stop "$unit.scope" 2>/dev/null; return 1; }
  local qspid; qspid=$(ev ready | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["pid"])')
  local cg; cg=$(cut -d: -f3 /proc/$qspid/cgroup 2>/dev/null)
  printf 'qspid=%s\nunit=%s\ncgroup=%s\n' "$qspid" "$unit" "$cg" >>"$meta"
  ( while [[ -r /proc/$qspid/smaps_rollup ]]; do
      p=$(awk '/^Pss:/{print $2}' /proc/$qspid/smaps_rollup 2>/dev/null) || break
      printf '%s %s\n' "$(date +%s%3N)" "$p" >>"$pss"; sleep 0.1; done ) &
  local sampler=$!
  local want=1 limit=200
  [[ $scen == concurrency ]] && want=10
  [[ $scen == supersede || $scen == stalled-supersede ]] && want=2
  if [[ $scen == destroy || $scen == destroy-early ]]; then waitev destroy 1 30 || echo "no destroy line" >>"$meta"; else waitev result "$want" "$limit" || echo "no result within $limit s" >>"$meta"; fi
  echo "end_wall=$(date +%s%3N)" >>"$meta"
  sleep 2
  local pgids; pgids=$(grep -o 'RUNLAB {.*}' "$log" | sed 's/^RUNLAB //' | /usr/bin/python3 -c '
import json,sys
seen=set()
for line in sys.stdin:
    try: o=json.loads(line)
    except Exception: continue
    if o.get("pgid"): seen.add(o["pgid"])
print(" ".join(str(p) for p in sorted(seen)))')
  echo "pgids=$pgids" >>"$meta"
  for g in $pgids; do ps -eo pid=,pgid=,stat=,comm= | awk -v g="$g" '$2==g' | sed 's/^/survivor-by-pgid: /' >>"$meta"; done
  if [[ -n $cg && -r /sys/fs/cgroup$cg/cgroup.procs ]]; then
    for p in $(cat /sys/fs/cgroup$cg/cgroup.procs); do [[ $p == "$qspid" ]] && continue; echo "survivor-in-scope: $p $(cat /proc/$p/comm 2>/dev/null)" >>"$meta"; done
  fi
  echo "shadow_hits=$(grep -c . "$out/shadow/hits.log")" >>"$meta"
  cp "$out/shadow/hits.log" "$out/runs/$tag.hits"
  kill "$sampler" 2>/dev/null; wait "$sampler" 2>/dev/null
  if [[ $scope_ok == 1 ]]; then systemctl --user stop "$unit.scope" 2>/dev/null; else kill -KILL -- -"$runner" 2>/dev/null; fi
  wait "$runner" 2>/dev/null
  echo "stopped=$(date +%s%3N)" >>"$meta"
}

for index in $(seq 1 "$runs"); do
  for scen in "${scenarios[@]}"; do
    one "$scen" "$index" || { echo "not ok - $scen run $index did not produce a ready line" >&2; }
    echo "# done $scen $index $(grep -o '"state":"[a-z-]*"' "$out/runs/$scen-$index.log" | head -3 | tr '\n' ' ')"
  done
done

/usr/bin/python3 "$here/report.py" "$out" "$blocks"
