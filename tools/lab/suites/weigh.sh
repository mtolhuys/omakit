#!/usr/bin/bash
# `omakit weigh` against a real shell, in the guest, never on a desktop:
# the command restarts a shell, and the lab is the only shell that is
# anyone's to restart unasked.
#
#   omakit_lab_suite <mode> <runs> <plugins-dir> [listed-id...]
#
# `smoke` proves what no unit test can, in about a minute after the guest
# is up: a real shell restarts on a written configuration, the real /proc
# is read (a Pss, ticks that move), the document follows the contract,
# shell.json comes back byte for byte, and an interrupt mid-measurement
# restores it and exits 130. Two fixtures at one run, a 2 s settle and a
# 3 s window, three restarts, then a second measurement interrupted.
# `evidence` is the five-run gate over the four fixtures and the three
# listed plugins, forty restarts at the default 30 s settle and 15 s
# window, about forty minutes, and the only mode whose document belongs
# under docs/evidence/weigh/. The listed plugins come staged from the
# lab's plugin cache, fetched once by `omakit lab setup --plugins` at the
# exact commit the pinned catalog records as validated; this suite fetches
# nothing.
#
# Runs through tools/lab/harness.sh, which defines the helpers used here.

omakit_lab_suite() {
  local mode="$1" runs="$2" plugins_dir="$3"
  shift 3
  local -a reals=("$@") fixtures timing ids
  local fixtures_dir="$OMAKIT_DIR/tests/fixtures/weigh"
  local name real real_dir md5_before md5_after count restarts status ids_json
  # Node in the guest comes through mise, the way a stock Omarchy has it.
  local guest_path='PATH=$HOME/.local/share/mise/shims:$PATH'

  if [[ $mode == evidence ]]; then
    fixtures=(clean timer-180ms poller idle-panel)
    timing=()
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

  # One detached measurement in the guest: the shell it restarts is the
  # session's, so it must not hang off the ssh call.
  guest_weigh() {
    local tag="$1" limit="$2"; shift 2
    guest_job "weigh-$tag" "$limit" "$guest_path node /tmp/omakit/bin/omakit weigh $* --yes --out /tmp/omakit-weigh-$tag.json" || return 1
    guest_file "/tmp/omakit-weigh-$tag.json" "omakit-weigh-$tag.json" || true
  }
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
  ssh_guest "rm -rf /tmp/omakit" || return 1
  stage_paths "$OMAKIT_DIR" /tmp/omakit bin tools package.json || return 1
  for name in "${fixtures[@]}"; do stage_plugin "$fixtures_dir/$name" "/tmp/omakit-fixtures/$name" || return 1; done
  for real in "${reals[@]}"; do
    real_dir="$plugins_dir/$real"
    log "$real at $(git -C "$real_dir" rev-parse HEAD), the commit the pinned catalog lists as validated"
    stage_plugin "$real_dir" "/tmp/omakit-real/$real" || return 1
  done
  for name in "${fixtures[@]}"; do ssh_session "omarchy-plugin-add /tmp/omakit-fixtures/$name --enable --yes" || return 1; done
  for real in "${reals[@]}"; do ssh_session "omarchy-plugin-add /tmp/omakit-real/$real --enable --yes" || return 1; done
  wait_for_guest_state "the $count plugins are installed and enabled" 60 ssh_session \
    "omarchy-plugin-list --json | jq -e --argjson want '$ids_json' '
       . as \$list | all(\$want[]; . as \$id | any(\$list[]; .id == \$id and .enabled == true))'" || return 1
  capture_console "success-weigh-01-installed"

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
    status=$(guest_job_status weigh-evidence)
    # The shell's own journal over the run, for C2: a rescan or a bar rebuild between two levels.
    ssh_session "journalctl --user -t omarchy-shell --no-pager -o short-iso --since '-2 hours'" > "$RUN_DIR/omarchy-shell.journal" 2>/dev/null || true
    ssh_session "ls \$XDG_RUNTIME_DIR/omarchy/plugin-runtime/" > "$RUN_DIR/plugin-runtime-generations.txt" 2>/dev/null || true
    cat "$RUN_DIR/weigh-evidence.log" > "$RUN_DIR/omakit-weigh.log" && cat "$RUN_DIR/omakit-weigh-evidence.json" > "$RUN_DIR/omakit-weigh.json" || return 1
  else
    log "Running omakit weigh --all --runs 1 --settle 2 --window 3 in the guest ($restarts restarts)"
    guest_weigh smoke 300 --all --runs 1 "${timing[@]}" || return 1
    status=$(guest_job_status weigh-smoke)
    cat "$RUN_DIR/weigh-smoke.log" > "$RUN_DIR/omakit-weigh.log" && cat "$RUN_DIR/omakit-weigh-smoke.json" > "$RUN_DIR/omakit-weigh.json" || return 1
  fi
  [[ $status == 0 ]] || { echo "omakit weigh exited $status" >&2; tail -n 40 "$RUN_DIR/omakit-weigh.log" >&2; return 1; }
  assert_restored "the measurement" || return 1
  capture_console "success-weigh-02-restored"

  # The document follows the contract, on the host, with the tool's own validator.
  node "$OMAKIT_DIR/tools/weigh/contract.mjs" "$RUN_DIR/omakit-weigh.json" || return 1

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
      and .config.md5Before == $before and .config.md5After == $before' "$RUN_DIR/omakit-weigh.json" || {
      jq -c '{failedRuns, config, plugins: [.plugins[] | {id, runsCompleted}]}' "$RUN_DIR/omakit-weigh.json" >&2
      return 1
    }
    grep -q "^▒ WEIGHED" "$RUN_DIR/omakit-weigh.log" || { echo "a one-run measurement does not close with the question mark" >&2; return 1; }

    # The recovery path, against the real shell: a measurement interrupted
    # inside its settle restores shell.json, restarts the shell once more,
    # removes the backup and exits 130 (docs/WEIGH.md, the shell.json
    # mutation). The signal goes to the recorded pid, the way Ctrl-C would
    # reach the command at a terminal. `set -m` because a background job
    # under a non-interactive bash inherits SIGINT ignored (measured: a
    # `kill -INT` to such a job did nothing).
    log "Interrupting a second measurement inside its settle"
    ssh_session "rm -f /tmp/omakit-weigh-interrupted.done /tmp/omakit-weigh-interrupted.log /tmp/omakit-weigh-interrupted.json /tmp/omakit-weigh-interrupted.pid; \
      setsid bash -c 'set -m; $guest_path node /tmp/omakit/bin/omakit weigh fixture.clean --runs 2 --settle 8 --window 5 --yes --out /tmp/omakit-weigh-interrupted.json \
        > /tmp/omakit-weigh-interrupted.log 2>&1 & echo \$! > /tmp/omakit-weigh-interrupted.pid; wait \$!; echo \$? > /tmp/omakit-weigh-interrupted.done' >/dev/null 2>&1 < /dev/null &" || return 1
    wait_for_guest_state "the interrupted measurement has backed shell.json up" 60 ssh_guest "grep -q 'backed up to' /tmp/omakit-weigh-interrupted.log" || return 1
    # The first restart takes about a second in the guest and the settle is
    # 8 s, so five seconds after the backup line the run is inside its
    # settle, or still waiting for the shell; both paths restore.
    sleep 5
    ssh_guest "kill -INT \$(cat /tmp/omakit-weigh-interrupted.pid)" || { echo "no measurement to interrupt" >&2; return 1; }
    wait_for_guest_state "the interrupted measurement has exited" 120 ssh_guest "test -f /tmp/omakit-weigh-interrupted.done" || {
      ssh_guest "tail -n 40 /tmp/omakit-weigh-interrupted.log" || true
      return 1
    }
    guest_file /tmp/omakit-weigh-interrupted.log omakit-weigh-interrupted.log || true
    status=$(ssh_guest "cat /tmp/omakit-weigh-interrupted.done")
    [[ $status == 130 ]] || { echo "the interrupted measurement exited $status, not 130" >&2; tail -n 40 "$RUN_DIR/omakit-weigh-interrupted.log" >&2; return 1; }
    grep -q "interrupted: restoring shell.json before exiting" "$RUN_DIR/omakit-weigh-interrupted.log" || { echo "the interrupt was not announced" >&2; return 1; }
    grep -q "restored and verified" "$RUN_DIR/omakit-weigh-interrupted.log" || { echo "the restore after the interrupt did not verify" >&2; return 1; }
    grep -q "NOT WEIGHED  interrupted before the measurement completed" "$RUN_DIR/omakit-weigh-interrupted.log" || { echo "the interrupt did not close as NOT WEIGHED" >&2; return 1; }
    ssh_guest "test ! -f /tmp/omakit-weigh-interrupted.json" || { echo "an interrupted measurement wrote a document" >&2; return 1; }
    assert_restored "the interrupt" || return 1
    capture_console "success-weigh-03-interrupt-restored"
    guest_shell_healthy || return 1
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
      and (.plugins | length) == $count' "$RUN_DIR/omakit-weigh.json" || {
    jq -c '.noiseFloor' "$RUN_DIR/omakit-weigh.json" >&2
    jq -c '.plugins[] | {id, runsCompleted, shellPssMb, shellCpuPercent, verdict}' "$RUN_DIR/omakit-weigh.json" >&2
    return 1
  }
  grep -Eq "^▁ ok +fixture\.clean " "$RUN_DIR/omakit-weigh.log" || { echo "the report does not mark fixture.clean ok" >&2; return 1; }
  grep -A1 -E "ok +fixture\.clean " "$RUN_DIR/omakit-weigh.log" | grep -q "no measurable CPU" || { echo "the report does not say no measurable CPU for fixture.clean" >&2; return 1; }
  grep -q "^memory        within the shell's own startup variance" "$RUN_DIR/omakit-weigh.log" || { echo "the header does not label memory as the shell's" >&2; return 1; }
  grep -q "^for the README" "$RUN_DIR/omakit-weigh.log" || { echo "no README sentence" >&2; return 1; }

  jq -r '.noiseFloor | "noise floor: Pss \(.pssMb) MB and VmRSS \(.rssMb) MB at the end of the window, Pss \(.pssMbSettled) MB at the settle, CPU \(.cpuPercent)%"' "$RUN_DIR/omakit-weigh.json"
  jq -r '.plugins[] | [.id, (.shellPssMb.median * 100 | round / 100), (.shellPssMb.spread * 100 | round / 100), (.shellCpuPercent.median * 100 | round / 100), (.shellCpuPercent.spread * 100 | round / 100), (.childRssMb.median * 100 | round / 100), (.childCpuPercent.median * 100 | round / 100), .childSpawns.median, .verdict.summary] | @tsv' "$RUN_DIR/omakit-weigh.json"
  guest_shell_healthy || return 1
  printf 'ok - omakit weigh measured %d plugins over %d runs each, told the 180 ms timer from the clean fixture, said within noise in words, restored shell.json byte for byte, and the document follows docs/WEIGH.md\n' "$count" "$runs"
}
