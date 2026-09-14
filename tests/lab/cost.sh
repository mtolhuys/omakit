#!/bin/bash

# The lab gate for `omakit cost`, run by the Omarchy plugin lab in a
# disposable guest against the stock pin:
#
#   cd ~/Projects/omarchy/plugin-lab && ./bin/lab plugin /path/to/omakit/tests/lab/cost.sh
#
# Stages omakit (bin/, tools/, package.json), the four fixtures under
# tests/fixtures/cost/ and three real third-party plugins from checkouts on
# the host, installs and enables the seven plugins, runs
# `omakit cost --all --runs 5 --yes` (the default window and settle) inside
# the guest session, and asserts:
# the 180 ms timer fixture is above noise on CPU; the clean fixture is within
# noise and the report says so in words; shell.json is byte-identical before
# and after and no backup is left; the document follows docs/COST.md
# (tools/cost/contract.mjs). The document and the log are copied next to
# host-test.log in the run directory; the document is what docs/evidence/cost/
# carries and docs/MEASUREMENTS.md C1 cites.
#
# The desktop is never where this runs: the command restarts a shell forty
# times, and the lab is the only shell that is anyone's to restart unasked.

omarchy_host_test() {
  local omakit_dir fixtures_dir name real real_dir md5_before md5_after out
  omakit_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
  fixtures_dir="$omakit_dir/tests/fixtures/cost"
  out="${RUN_DIR:-/tmp}"
  local -a reals=(io.github.calebhat.weather bjarneo.workspace-layout omaplug)
  local -a fixtures=(clean timer-180ms poller idle-panel)
  # Node in the guest comes through mise, the way a stock Omarchy has it.
  local guest_path='PATH=$HOME/.local/share/mise/shims:$PATH'

  stage() {
    local src="$1" dest="$2"
    tar -C "$src" --exclude=.git --exclude=.cache --exclude=node_modules -cf - . | ssh_guest "rm -rf $dest && mkdir -p $dest && tar -C $dest -xf -"
  }
  stage_plugin() {
    stage "$1" "$2"
    ssh_guest "git -C $2 init -q && git -C $2 add . && git -C $2 -c user.name=Lab -c user.email=lab@invalid commit -qm staged"
  }

  log "Checking that the guest has node"
  ssh_session "$guest_path node --version" || { echo "no node in the guest (mise shims)" >&2; return 1; }

  log "Staging omakit, the four fixtures and three third-party plugins in the guest"
  ssh_guest "rm -rf /tmp/omakit && mkdir -p /tmp/omakit" || return 1
  tar -C "$omakit_dir" -cf - bin tools package.json | ssh_guest "tar -C /tmp/omakit -xf -" || return 1
  for name in "${fixtures[@]}"; do stage_plugin "$fixtures_dir/$name" "/tmp/omakit-fixtures/$name" || return 1; done
  for real in "${reals[@]}"; do
    real_dir="$HOME/.config/omarchy/plugins/$real"
    [[ -d $real_dir ]] || { echo "missing checkout on the host: $real_dir" >&2; return 1; }
    stage_plugin "$real_dir" "/tmp/omakit-real/$real" || return 1
  done
  for name in "${fixtures[@]}"; do ssh_session "omarchy-plugin-add /tmp/omakit-fixtures/$name --enable --yes" || return 1; done
  for real in "${reals[@]}"; do ssh_session "omarchy-plugin-add /tmp/omakit-real/$real --enable --yes" || return 1; done
  wait_for_guest_state "the seven plugins are installed and enabled" 60 ssh_session \
    "omarchy-plugin-list --json | jq -e '
       [\"fixture.clean\", \"fixture.timer-180ms\", \"fixture.poller\", \"fixture.idle-panel\",
        \"io.github.calebhat.weather\", \"bjarneo.workspace-layout\", \"omaplug\"] as \$want
       | . as \$list | all(\$want[]; . as \$id | any(\$list[]; .id == \$id and .enabled == true))'" || return 1
  capture_console "success-omakit-cost-01-installed"

  md5_before=$(ssh_session "md5sum < \"\$HOME/.config/omarchy/shell.json\"")
  [[ -n $md5_before ]] || return 1
  log "shell.json before: $md5_before"

  # The plan, refused: without --yes in a pipe the command prints the count
  # and touches nothing. Exit 2 is the expected outcome.
  ssh_session "$guest_path node /tmp/omakit/bin/omakit cost --all --runs 5 </dev/null; test \$? -eq 2" || { echo "the unconfirmed run did not refuse with exit 2" >&2; return 1; }
  [[ $(ssh_session "md5sum < \"\$HOME/.config/omarchy/shell.json\"") == "$md5_before" ]] || { echo "the refused run touched shell.json" >&2; return 1; }

  # The measurement restarts the shell, so it runs detached from this ssh
  # call and reports through a done file.
  log "Running omakit cost --all --runs 5 in the guest (40 restarts, the default 30 s settle and 15 s window)"
  ssh_session "rm -f /tmp/omakit-cost.done /tmp/omakit-cost.log /tmp/omakit-cost.json; \
    setsid bash -c '$guest_path node /tmp/omakit/bin/omakit cost --all --runs 5 --yes --out /tmp/omakit-cost.json \
      > /tmp/omakit-cost.log 2>&1; echo \$? > /tmp/omakit-cost.done' >/dev/null 2>&1 < /dev/null &" || return 1
  wait_for_guest_state "omakit cost finished" 3600 ssh_guest "test -f /tmp/omakit-cost.done" || {
    ssh_guest "tail -n 60 /tmp/omakit-cost.log" || true
    return 1
  }
  ssh_guest "cat /tmp/omakit-cost.log" > "$out/omakit-cost.log" 2>/dev/null || true
  ssh_guest "cat /tmp/omakit-cost.json" > "$out/omakit-cost.json" || return 1
  [[ $(ssh_guest "cat /tmp/omakit-cost.done") == 0 ]] || { echo "omakit cost exited non-zero" >&2; tail -n 40 "$out/omakit-cost.log" >&2; return 1; }

  md5_after=$(ssh_session "md5sum < \"\$HOME/.config/omarchy/shell.json\"")
  log "shell.json after: $md5_after"
  [[ $md5_after == "$md5_before" ]] || { echo "shell.json changed" >&2; return 1; }
  ssh_session "test -z \"\$(ls \"\$HOME/.config/omarchy/\" | grep omakit-backup)\"" || { echo "a backup was left behind" >&2; return 1; }
  ssh_session "omarchy-shell shell ping | grep -qx ok" || return 1
  capture_console "success-omakit-cost-02-restored"

  # The document follows the contract, on the host, with the tool's own validator.
  node "$omakit_dir/tools/cost/contract.mjs" "$out/omakit-cost.json" || return 1

  # The acceptance line: the busy fixture is above noise on CPU; the clean
  # fixture is within noise on both and the report says so in words; every
  # plugin completed five runs; the md5s in the document match the guest's.
  jq -e --arg before "${md5_before%% *}" '
    (.plugins[] | select(.id == "fixture.clean")) as $clean
    | (.plugins[] | select(.id == "fixture.timer-180ms")) as $busy
    | all(.plugins[]; .runsCompleted == 5)
      and $busy.verdict.cpu == "above-noise"
      and $clean.verdict.cpu == "within-noise"
      and $clean.verdict.memory == "within-noise"
      and $clean.verdict.summary == "no measurable CPU"
      and .config.restored == true
      and .config.md5Before == $before and .config.md5After == $before
      and (.plugins | length) == 7' "$out/omakit-cost.json" || {
    jq -c '.noiseFloor' "$out/omakit-cost.json" >&2
    jq -c '.plugins[] | {id, runsCompleted, shellPssMb, shellCpuPercent, verdict}' "$out/omakit-cost.json" >&2
    return 1
  }
  grep -Eq "^▁ ok +fixture\.clean " "$out/omakit-cost.log" || { echo "the report does not mark fixture.clean ok" >&2; return 1; }
  grep -A1 -E "ok +fixture\.clean " "$out/omakit-cost.log" | grep -q "no measurable CPU" || { echo "the report does not say no measurable CPU for fixture.clean" >&2; return 1; }
  grep -q "^memory        within the shell's own startup variance" "$out/omakit-cost.log" || { echo "the header does not label memory as the shell's" >&2; return 1; }
  grep -q "^for the README" "$out/omakit-cost.log" || { echo "no README sentence" >&2; return 1; }

  jq -r '.noiseFloor | "noise floor: Pss \(.pssMb) MB and VmRSS \(.rssMb) MB at the end of the window, Pss \(.pssMbSettled) MB at the settle, CPU \(.cpuPercent)%"' "$out/omakit-cost.json"
  jq -r '.plugins[] | [.id, (.shellPssMb.median * 100 | round / 100), (.shellPssMb.spread * 100 | round / 100), (.shellCpuPercent.median * 100 | round / 100), (.shellCpuPercent.spread * 100 | round / 100), (.childRssMb.median * 100 | round / 100), (.childCpuPercent.median * 100 | round / 100), .childSpawns.median, .verdict.summary] | @tsv' "$out/omakit-cost.json"
  ssh_session "test -z \"\$(hyprctl configerrors)\"" || return 1
  printf 'ok - omakit cost measured seven plugins over five runs each, told the 180 ms timer from the clean fixture, said within noise in words, restored shell.json byte for byte, and the document follows docs/COST.md\n'
}
