#!/bin/bash

# The lab gate for `omakit weigh`, run by the Omarchy plugin lab in a
# disposable guest against the stock pin. The one command, from the omakit
# checkout on the host:
#
#   bash tests/lab/weigh.sh              # smoke: the maintainer's check, a minute of measurement
#   bash tests/lab/weigh.sh evidence     # the five-run gate that docs/evidence/weigh/ carries
#   bash tests/lab/weigh.sh preflight    # the host-side checks alone, in seconds
#
# Two modes, because a maintainer's question and an evidence run are not the
# same job. `smoke` proves in the guest what no unit test can: a real shell
# restarts on a written configuration, the real /proc is read (a Pss, ticks
# that move), the document follows the contract, shell.json comes back byte
# for byte, and an interrupt mid-measurement restores it and exits 130. It
# weighs two fixtures at one run, a 2 s settle and a 3 s window, three
# restarts, then interrupts a second measurement: about a minute after the
# guest is up, and the guest's boot is the whole cost. `evidence` is the
# five-run gate over the four fixtures and three listed plugins, forty
# restarts at the default 30 s settle and 15 s window, about forty minutes,
# and the only mode whose document belongs under docs/evidence/weigh/.
# Measured before this: the one mode was the forty-minute gate, run to answer
# a question the smoke answers in a minute.
#
# The preflight happens before any guest boots, because a guest takes minutes
# to boot and the run forty restarts, and a missing tool or checkout found
# after that is an hour lost: it checks node, git, jq and ssh, the omakit pin,
# the four fixtures, the lab checkout (a sibling named `plugin-lab`, or
# `$OMAKIT_LAB_ROOT`), and it fetches the three listed plugins below at the
# exact commit the pinned catalog records as validated, read-only, into
# `$XDG_CACHE_HOME/omakit/lab/<id>/`, once. Measured before this: the gate
# staged those plugins from `~/.config/omarchy/plugins/`, the desktop's own
# installed set, which moves as plugins are added and removed, and a run
# booted the guest and then stopped on a checkout the desktop no longer had.
#
# The evidence gate stages omakit (bin/, tools/, package.json), the four
# fixtures under tests/fixtures/weigh/ and the three listed plugins from that
# cache, installs and enables the seven plugins, runs `omakit weigh --all
# --runs 5 --yes` (the default window and settle; `OMAKIT_LAB_RUNS` sets the
# run count, for a shorter iteration) inside the guest session, and asserts:
# the 180 ms timer fixture is above noise on CPU; the clean fixture is within
# noise and the report says so in words; shell.json is byte-identical before
# and after and no backup is left; the document follows docs/WEIGH.md
# (tools/weigh/contract.mjs). The document and the log are copied next to
# host-test.log in the run directory; the document is what docs/evidence/weigh/
# carries and docs/MEASUREMENTS.md C1 cites.
#
# The desktop is never where this runs: the command restarts a shell forty
# times, and the lab is the only shell that is anyone's to restart unasked.
# Nothing here reads or writes the desktop's plugin directory.

# The three listed plugins the gate weighs beside the fixtures, by id. Which
# repository each is and which commit is validated are the pinned catalog's
# to say (site/catalog.json at the marketplace pin), never written here.
OMAKIT_LAB_REALS=(io.github.calebhat.weather omaplug io.github.pablo-merino.altswitch)
OMAKIT_LAB_FIXTURES=(clean timer-180ms poller idle-panel)
OMAKIT_LAB_RUNS="${OMAKIT_LAB_RUNS:-5}"
OMAKIT_LAB_MODE="${OMAKIT_LAB_MODE:-smoke}"

omakit_lab_dir() { cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd; }
omakit_lab_cache() { printf '%s\n' "${XDG_CACHE_HOME:-$HOME/.cache}/omakit/lab"; }
omakit_lab_pin() { printf '%s\n' "${XDG_CACHE_HOME:-$HOME/.cache}/omakit/marketplace"; }
omakit_lab_root() {
  if [[ -n ${OMAKIT_LAB_ROOT:-} ]]; then printf '%s\n' "$OMAKIT_LAB_ROOT"; else printf '%s\n' "$(omakit_lab_dir)/../plugin-lab"; fi
}

# "<repo> <commit>" for a listed id, from the pinned catalog; exit 1 with the reason otherwise.
omakit_lab_listing() {
  node -e '
    const [file, id] = process.argv.slice(1)
    const catalog = JSON.parse(require("fs").readFileSync(file, "utf8"))
    const plugin = (catalog.plugins || []).find((entry) => entry && entry.id === id)
    const commit = plugin && plugin.listingValidatedCommit
    if (!plugin || !/^[0-9a-f]{40}$/.test(String(commit || "")) || !/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(String(plugin.repo || ""))) {
      process.stderr.write(`${id} is not listed with a validated commit and a github.com repository in the pinned catalog\n`)
      process.exit(1)
    }
    process.stdout.write(`${plugin.repo} ${commit}\n`)
  ' "$(omakit_lab_pin)/site/catalog.json" "$1"
}

# Each listed plugin at its validated commit, in the cache. Idempotent: a
# directory already at that commit and clean is left alone and costs no
# network; anything else is fetched again, depth 1, read-only.
omakit_lab_fetch_reals() {
  local real repo commit dir
  for real in "${OMAKIT_LAB_REALS[@]}"; do
    read -r repo commit < <(omakit_lab_listing "$real") || return 1
    [[ -n $commit ]] || return 1
    dir="$(omakit_lab_cache)/$real"
    if [[ -d $dir/.git ]] && [[ $(git -C "$dir" rev-parse HEAD 2>/dev/null) == "$commit" ]] && [[ -z $(git -C "$dir" status --porcelain 2>/dev/null) ]]; then
      continue
    fi
    echo "fetching $real at $commit from $repo"
    if ! { rm -rf "$dir" && mkdir -p "$dir" \
      && git init -q "$dir" \
      && git -C "$dir" remote add origin "$repo" \
      && git -C "$dir" fetch -q --depth 1 origin "$commit" \
      && git -C "$dir" checkout -q --detach "$commit"; }; then
      echo "could not fetch $real at $commit from $repo" >&2
      return 1
    fi
  done
}

# Everything the run needs, checked on the host before a guest boots.
omakit_lab_preflight() {
  local omakit_dir tool name real lab_root problems=0
  omakit_dir="$(omakit_lab_dir)"
  for tool in node git jq ssh tar; do
    command -v "$tool" >/dev/null 2>&1 || { echo "not ok - $tool is not on PATH" >&2; problems=1; }
  done
  (( problems == 0 )) || return 1
  node "$omakit_dir/bin/omakit" pin >/dev/null || { echo "not ok - the marketplace pin is not in place (omakit pin)" >&2; return 1; }
  for name in "${OMAKIT_LAB_FIXTURES[@]}"; do
    [[ -f $omakit_dir/tests/fixtures/weigh/$name/manifest.json ]] || { echo "not ok - fixture $name has no manifest under tests/fixtures/weigh/" >&2; return 1; }
  done
  case "$OMAKIT_LAB_MODE" in smoke|evidence) ;; *) echo "not ok - OMAKIT_LAB_MODE must be smoke or evidence, not '$OMAKIT_LAB_MODE'" >&2; return 1;; esac
  if [[ $OMAKIT_LAB_MODE == evidence ]]; then
    omakit_lab_fetch_reals || return 1
    for real in "${OMAKIT_LAB_REALS[@]}"; do
      [[ -f $(omakit_lab_cache)/$real/manifest.json ]] || { echo "not ok - $real has no manifest.json at its validated commit" >&2; return 1; }
    done
  fi
  lab_root="$(omakit_lab_root)"
  [[ -x $lab_root/bin/lab ]] || { echo "not ok - no plugin lab at $lab_root (set OMAKIT_LAB_ROOT)" >&2; return 1; }
  [[ $OMAKIT_LAB_RUNS =~ ^[1-9][0-9]*$ ]] || { echo "not ok - OMAKIT_LAB_RUNS must be a positive integer, not '$OMAKIT_LAB_RUNS'" >&2; return 1; }
  if [[ $OMAKIT_LAB_MODE == evidence ]]; then
    printf 'ok - preflight for the evidence gate: tools, pin, %d fixtures, %d listed plugins at their validated commits in %s, lab at %s, %s run(s)\n' \
      "${#OMAKIT_LAB_FIXTURES[@]}" "${#OMAKIT_LAB_REALS[@]}" "$(omakit_lab_cache)" "$lab_root" "$OMAKIT_LAB_RUNS"
  else
    printf 'ok - preflight for the smoke check: tools, pin, %d fixtures, lab at %s\n' "${#OMAKIT_LAB_FIXTURES[@]}" "$lab_root"
  fi
}

omarchy_host_test() {
  local omakit_dir fixtures_dir name real real_dir md5_before md5_after out runs ids_json count restarts mode status
  omakit_dir="$(omakit_lab_dir)"
  fixtures_dir="$omakit_dir/tests/fixtures/weigh"
  out="${RUN_DIR:-/tmp}"
  mode="$OMAKIT_LAB_MODE"
  # `timing` is the settle and window the smoke passes; the evidence gate
  # runs the defaults, so its array is empty and expands to nothing.
  local -a reals fixtures timing ids
  if [[ $mode == evidence ]]; then
    runs="$OMAKIT_LAB_RUNS"
    reals=("${OMAKIT_LAB_REALS[@]}")
    fixtures=("${OMAKIT_LAB_FIXTURES[@]}")
    timing=()
    # The listed plugins come from the cache the preflight fills; a run
    # started without the preflight fills it here, so the guest never waits
    # on the desktop's plugin directory.
    omakit_lab_fetch_reals || return 1
  else
    runs=1
    reals=()
    fixtures=(clean timer-180ms)
    timing=(--settle 2 --window 3)
  fi
  ids=("${fixtures[@]/#/fixture.}" "${reals[@]}")
  count=${#ids[@]}
  restarts=$(( (1 + count) * runs ))
  ids_json=$(jq -c -n '$ARGS.positional' --args "${ids[@]}")
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

  # One detached measurement in the guest: the shell it restarts is the
  # session's, so it must not hang off this ssh call; it reports through a
  # done file, and its log and document are copied beside host-test.log.
  guest_weigh() {
    local tag="$1" limit="$2"; shift 2
    ssh_session "rm -f /tmp/omakit-weigh-$tag.done /tmp/omakit-weigh-$tag.log /tmp/omakit-weigh-$tag.json; \
      setsid bash -c '$guest_path node /tmp/omakit/bin/omakit weigh $* --yes --out /tmp/omakit-weigh-$tag.json \
        > /tmp/omakit-weigh-$tag.log 2>&1; echo \$? > /tmp/omakit-weigh-$tag.done' >/dev/null 2>&1 < /dev/null &" || return 1
    wait_for_guest_state "omakit weigh ($tag) finished" "$limit" ssh_guest "test -f /tmp/omakit-weigh-$tag.done" || {
      ssh_guest "tail -n 60 /tmp/omakit-weigh-$tag.log" || true
      return 1
    }
    ssh_guest "cat /tmp/omakit-weigh-$tag.log" > "$out/omakit-weigh-$tag.log" 2>/dev/null || true
    ssh_guest "cat /tmp/omakit-weigh-$tag.json" > "$out/omakit-weigh-$tag.json" 2>/dev/null || true
  }
  guest_weigh_status() { ssh_guest "cat /tmp/omakit-weigh-$1.done"; }
  # shell.json is byte for byte what it was, no backup is left, the shell answers.
  assert_restored() {
    md5_after=$(ssh_session "md5sum < \"\$HOME/.config/omarchy/shell.json\"")
    log "shell.json after $1: $md5_after"
    [[ $md5_after == "$md5_before" ]] || { echo "shell.json changed ($1)" >&2; return 1; }
    ssh_session "test -z \"\$(ls \"\$HOME/.config/omarchy/\" | grep omakit-backup)\"" || { echo "a backup was left behind ($1)" >&2; return 1; }
    ssh_session "omarchy-shell shell ping | grep -qx ok" || { echo "the shell does not answer ($1)" >&2; return 1; }
  }

  log "Checking that the guest has node"
  ssh_session "$guest_path node --version" || { echo "no node in the guest (mise shims)" >&2; return 1; }

  log "Staging omakit, the ${#fixtures[@]} fixtures and ${#reals[@]} listed plugins in the guest"
  ssh_guest "rm -rf /tmp/omakit && mkdir -p /tmp/omakit" || return 1
  tar -C "$omakit_dir" -cf - bin tools package.json | ssh_guest "tar -C /tmp/omakit -xf -" || return 1
  for name in "${fixtures[@]}"; do stage_plugin "$fixtures_dir/$name" "/tmp/omakit-fixtures/$name" || return 1; done
  for real in "${reals[@]}"; do
    real_dir="$(omakit_lab_cache)/$real"
    log "$real at $(git -C "$real_dir" rev-parse HEAD), the commit the pinned catalog lists as validated"
    stage_plugin "$real_dir" "/tmp/omakit-real/$real" || return 1
  done
  for name in "${fixtures[@]}"; do ssh_session "omarchy-plugin-add /tmp/omakit-fixtures/$name --enable --yes" || return 1; done
  for real in "${reals[@]}"; do ssh_session "omarchy-plugin-add /tmp/omakit-real/$real --enable --yes" || return 1; done
  wait_for_guest_state "the $count plugins are installed and enabled" 60 ssh_session \
    "omarchy-plugin-list --json | jq -e --argjson want '$ids_json' '
       . as \$list | all(\$want[]; . as \$id | any(\$list[]; .id == \$id and .enabled == true))'" || return 1
  capture_console "success-omakit-weigh-01-installed"

  md5_before=$(ssh_session "md5sum < \"\$HOME/.config/omarchy/shell.json\"")
  [[ -n $md5_before ]] || return 1
  log "shell.json before: $md5_before"

  # The plan, refused: without --yes in a pipe the command prints the count
  # and touches nothing. Exit 2 is the expected outcome.
  ssh_session "$guest_path node /tmp/omakit/bin/omakit weigh --all --runs $runs ${timing[*]} </dev/null; test \$? -eq 2" || { echo "the unconfirmed run did not refuse with exit 2" >&2; return 1; }
  [[ $(ssh_session "md5sum < \"\$HOME/.config/omarchy/shell.json\"") == "$md5_before" ]] || { echo "the refused run touched shell.json" >&2; return 1; }

  if [[ $mode == evidence ]]; then
    log "Running omakit weigh --all --runs $runs in the guest ($restarts restarts, the default 30 s settle and 15 s window)"
    guest_weigh evidence 3600 --all --runs "$runs" || return 1
    status=$(guest_weigh_status evidence)
    # The shell's own journal over the run, for C2: a rescan or a bar rebuild
    # ("Handler was registered but will not be used") between two levels.
    ssh_session "journalctl --user -t omarchy-shell --no-pager -o short-iso --since '-2 hours'" > "$out/omarchy-shell.journal" 2>/dev/null || true
    ssh_session "ls \$XDG_RUNTIME_DIR/omarchy/plugin-runtime/" > "$out/plugin-runtime-generations.txt" 2>/dev/null || true
    cp "$out/omakit-weigh-evidence.log" "$out/omakit-weigh.log" && cp "$out/omakit-weigh-evidence.json" "$out/omakit-weigh.json" || return 1
  else
    log "Running omakit weigh --all --runs 1 --settle 2 --window 3 in the guest ($restarts restarts)"
    guest_weigh smoke 300 --all --runs 1 "${timing[@]}" || return 1
    status=$(guest_weigh_status smoke)
    cp "$out/omakit-weigh-smoke.log" "$out/omakit-weigh.log" && cp "$out/omakit-weigh-smoke.json" "$out/omakit-weigh.json" || return 1
  fi
  [[ $status == 0 ]] || { echo "omakit weigh exited $status" >&2; tail -n 40 "$out/omakit-weigh.log" >&2; return 1; }
  assert_restored "the measurement" || return 1
  capture_console "success-omakit-weigh-02-restored"

  # The document follows the contract, on the host, with the tool's own validator.
  node "$omakit_dir/tools/weigh/contract.mjs" "$out/omakit-weigh.json" || return 1

  if [[ $mode == smoke ]]; then
    # Every configuration produced a sample from the real /proc: a Pss and a
    # VmRSS in kB, ticks that did not go backwards, and a trace; nothing
    # failed and nothing was read as zero in a gone shell's place.
    jq -e --arg before "${md5_before%% *}" --argjson count "$count" '
      (.failedRuns | length) == 0
      and (.plugins | length) == $count
      and all(.plugins[]; .runsCompleted == 1)
      and ([.baseline.runs[], .plugins[].runs[]] | length) == ($count + 1)
      and all([.baseline.runs[], .plugins[].runs[]][];
            (.shell.pssKb | type) == "number" and .shell.pssKb > 0
            and (.shell.rssKb | type) == "number" and .shell.rssKb > 0
            and .shell.cpuTicksEnd >= .shell.cpuTicksStart
            and (.shell.trace | length) >= 2
            and .readyAfterSeconds >= 0)
      and .config.restored == true
      and .config.md5Before == $before and .config.md5After == $before' "$out/omakit-weigh.json" || {
      jq -c '{failedRuns, config, plugins: [.plugins[] | {id, runsCompleted}]}' "$out/omakit-weigh.json" >&2
      return 1
    }
    grep -q "^▒ WEIGHED" "$out/omakit-weigh.log" || { echo "a one-run measurement does not close with the question mark" >&2; return 1; }

    # The recovery path, against the real shell: a measurement interrupted
    # inside its settle restores shell.json, restarts the shell once more,
    # removes the backup and exits 130 (docs/WEIGH.md, the shell.json mutation).
    log "Interrupting a second measurement inside its settle"
    # The signal goes to the recorded pid, the way Ctrl-C would reach the
    # command at a terminal; never to a pattern, which would also match the
    # remote shell sending it. `set -m` because a background job under a
    # non-interactive bash inherits SIGINT ignored (measured: a `kill -INT`
    # to such a job did nothing); with job control on it keeps the default.
    ssh_session "rm -f /tmp/omakit-weigh-interrupted.done /tmp/omakit-weigh-interrupted.log /tmp/omakit-weigh-interrupted.json /tmp/omakit-weigh-interrupted.pid; \
      setsid bash -c 'set -m; $guest_path node /tmp/omakit/bin/omakit weigh fixture.clean --runs 2 --settle 8 --window 5 --yes --out /tmp/omakit-weigh-interrupted.json \
        > /tmp/omakit-weigh-interrupted.log 2>&1 & echo \$! > /tmp/omakit-weigh-interrupted.pid; wait \$!; echo \$? > /tmp/omakit-weigh-interrupted.done' >/dev/null 2>&1 < /dev/null &" || return 1
    wait_for_guest_state "the interrupted measurement has backed shell.json up" 60 ssh_guest "grep -q 'backed up to' /tmp/omakit-weigh-interrupted.log" || return 1
    # The first restart takes about a second in the guest and the settle is
    # 8 s, so five seconds after the backup line the run is inside its settle
    # (or, on a slow restart, still waiting for the shell): either is a wait
    # the abort ends, and both paths restore.
    sleep 5
    ssh_guest "kill -INT \$(cat /tmp/omakit-weigh-interrupted.pid)" || { echo "no measurement to interrupt" >&2; return 1; }
    wait_for_guest_state "the interrupted measurement has exited" 120 ssh_guest "test -f /tmp/omakit-weigh-interrupted.done" || {
      ssh_guest "tail -n 40 /tmp/omakit-weigh-interrupted.log" || true
      return 1
    }
    ssh_guest "cat /tmp/omakit-weigh-interrupted.log" > "$out/omakit-weigh-interrupted.log" 2>/dev/null || true
    status=$(ssh_guest "cat /tmp/omakit-weigh-interrupted.done")
    [[ $status == 130 ]] || { echo "the interrupted measurement exited $status, not 130" >&2; tail -n 40 "$out/omakit-weigh-interrupted.log" >&2; return 1; }
    grep -q "interrupted: restoring shell.json before exiting" "$out/omakit-weigh-interrupted.log" || { echo "the interrupt was not announced" >&2; return 1; }
    grep -q "restored and verified" "$out/omakit-weigh-interrupted.log" || { echo "the restore after the interrupt did not verify" >&2; return 1; }
    grep -q "NOT WEIGHED  interrupted before the measurement completed" "$out/omakit-weigh-interrupted.log" || { echo "the interrupt did not close as NOT WEIGHED" >&2; return 1; }
    ssh_guest "test ! -f /tmp/omakit-weigh-interrupted.json" || { echo "an interrupted measurement wrote a document" >&2; return 1; }
    assert_restored "the interrupt" || return 1
    capture_console "success-omakit-weigh-03-interrupt-restored"
    ssh_session "test -z \"\$(hyprctl configerrors)\"" || return 1
    printf 'ok - omakit weigh smoke: %d measured restarts and a restore weighed two fixtures from the real /proc and put shell.json back byte for byte, the document follows docs/WEIGH.md, and an interrupted measurement restored it and exited 130\n' "$restarts"
    return 0
  fi

  # The acceptance line: the busy fixture is above noise on CPU; the clean
  # fixture is within noise on both and the report says so in words; every
  # plugin completed every run; the md5s in the document match the guest's.
  jq -e --arg before "${md5_before%% *}" --argjson runs "$runs" --argjson count "$count" '
    (.plugins[] | select(.id == "fixture.clean")) as $clean
    | (.plugins[] | select(.id == "fixture.timer-180ms")) as $busy
    | all(.plugins[]; .runsCompleted == $runs)
      and $busy.verdict.cpu == "above-noise"
      and $clean.verdict.cpu == "within-noise"
      and $clean.verdict.memory == "within-noise"
      and $clean.verdict.summary == "no measurable CPU"
      and .config.restored == true
      and .config.md5Before == $before and .config.md5After == $before
      and (.plugins | length) == $count' "$out/omakit-weigh.json" || {
    jq -c '.noiseFloor' "$out/omakit-weigh.json" >&2
    jq -c '.plugins[] | {id, runsCompleted, shellPssMb, shellCpuPercent, verdict}' "$out/omakit-weigh.json" >&2
    return 1
  }
  grep -Eq "^▁ ok +fixture\.clean " "$out/omakit-weigh.log" || { echo "the report does not mark fixture.clean ok" >&2; return 1; }
  grep -A1 -E "ok +fixture\.clean " "$out/omakit-weigh.log" | grep -q "no measurable CPU" || { echo "the report does not say no measurable CPU for fixture.clean" >&2; return 1; }
  grep -q "^memory        within the shell's own startup variance" "$out/omakit-weigh.log" || { echo "the header does not label memory as the shell's" >&2; return 1; }
  grep -q "^for the README" "$out/omakit-weigh.log" || { echo "no README sentence" >&2; return 1; }

  jq -r '.noiseFloor | "noise floor: Pss \(.pssMb) MB and VmRSS \(.rssMb) MB at the end of the window, Pss \(.pssMbSettled) MB at the settle, CPU \(.cpuPercent)%"' "$out/omakit-weigh.json"
  jq -r '.plugins[] | [.id, (.shellPssMb.median * 100 | round / 100), (.shellPssMb.spread * 100 | round / 100), (.shellCpuPercent.median * 100 | round / 100), (.shellCpuPercent.spread * 100 | round / 100), (.childRssMb.median * 100 | round / 100), (.childCpuPercent.median * 100 | round / 100), .childSpawns.median, .verdict.summary] | @tsv' "$out/omakit-weigh.json"
  ssh_session "test -z \"\$(hyprctl configerrors)\"" || return 1
  printf 'ok - omakit weigh measured %d plugins over %d runs each, told the 180 ms timer from the clean fixture, said within noise in words, restored shell.json byte for byte, and the document follows docs/WEIGH.md\n' "$count" "$runs"
}

# Run directly: the preflight on the host, then the gate in the guest through
# the lab. Sourced by the lab's harness, this file only defines the functions.
if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  case "${1:-smoke}" in
    preflight)
      omakit_lab_preflight
      ;;
    smoke|evidence)
      export OMAKIT_LAB_MODE="$1"
      omakit_lab_preflight || exit 1
      exec "$(omakit_lab_root)/bin/lab" plugin "$(cd -- "$(dirname -- "$0")" && pwd)/$(basename -- "$0")"
      ;;
    *)
      echo "usage: bash tests/lab/weigh.sh [smoke|evidence|preflight]" >&2
      exit 2
      ;;
  esac
fi
