#!/usr/bin/bash

# The Store block's lab gate in the disposable 4.0.3 guest, through the
# Omarchy plugin lab (a sibling checkout named `plugin-lab`, or
# $OMAKIT_LAB_ROOT). One command, from the omakit checkout on the host:
#
#   bash tests/lab/store/lab.sh              # boot the guest, run the suite there, copy the document back
#   bash tests/lab/store/lab.sh preflight    # the host-side checks alone
#
# What it proves that the desktop run cannot: the block runs on a stock
# install, where /usr/bin/python3 is a dependency of desktop packages and
# not an Omarchy choice (docs/BLOCKS_SPIKE.md), in the session of a shell
# nobody customised. The suite itself is tests/lab/store/suite.sh, the same
# file that runs on the desktop; here it is staged into the guest with the
# block files and run inside the graphical session, and its document is
# copied beside host-test.log. The guest's shell is never restarted and
# never loads the harness: every scenario is its own quickshell instance.

omakit_storelab_dir() { cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd; }
omakit_storelab_root() {
  if [[ -n ${OMAKIT_LAB_ROOT:-} ]]; then printf '%s\n' "$OMAKIT_LAB_ROOT"; else printf '%s\n' "$(omakit_storelab_dir)/../plugin-lab"; fi
}

omakit_storelab_preflight() {
  local dir lab_root tool
  dir="$(omakit_storelab_dir)"
  for tool in node git jq ssh tar; do
    command -v "$tool" >/dev/null 2>&1 || { echo "not ok - $tool is not on PATH" >&2; return 1; }
  done
  node "$dir/tools/blocks/stamp.mjs" --check >/dev/null || { echo "not ok - a block header is stale (node tools/blocks/stamp.mjs)" >&2; return 1; }
  [[ -f $dir/tests/lab/store/suite.sh && -f $dir/tests/lab/store/report.py && -f $dir/tests/lab/store/harness/shell.qml ]] || { echo "not ok - the suite is incomplete" >&2; return 1; }
  lab_root="$(omakit_storelab_root)"
  [[ -x $lab_root/bin/lab ]] || { echo "not ok - no plugin lab at $lab_root (set OMAKIT_LAB_ROOT)" >&2; return 1; }
  printf 'ok - preflight for the Store lab gate: tools, stamped block headers, the suite, lab at %s\n' "$lab_root"
}

omarchy_host_test() {
  local dir out status
  dir="$(omakit_storelab_dir)"
  out="${RUN_DIR:-/tmp}"

  log "Checking the stock guest for the block's plumbing"
  ssh_guest "test -x /usr/bin/python3 && test -x /usr/bin/quickshell && test -x /usr/bin/setsid && test -x /usr/bin/kill" || { echo "the guest lacks python3, quickshell, setsid or kill under /usr/bin" >&2; return 1; }
  ssh_guest "/usr/bin/python3 --version; pacman -Q python quickshell util-linux; pacman -Qi python | grep '^Required By'" > "$out/storelab-guest-plumbing.txt" 2>&1 || true
  log "$(head -n 4 "$out/storelab-guest-plumbing.txt" | tr '\n' ';')"

  log "Staging the suite and the block files in the guest"
  ssh_guest "rm -rf /tmp/omakit-storelab-src && mkdir -p /tmp/omakit-storelab-src/tests/lab/store /tmp/omakit-storelab-src/blocks" || return 1
  tar -C "$dir" -cf - tests/lab/store blocks/run blocks/store | ssh_guest "tar -C /tmp/omakit-storelab-src -xf -" || return 1

  # The foreign-owner scenario needs one chown as root; the guest is
  # disposable, so it gets a sudoers drop-in for that one command.
  log "Allowing chown without a password in the guest, for the foreign-owner scenario"
  ssh_guest "printf '%s\n' omarchy | sudo -S sh -c \"printf 'omarchy ALL=(ALL) NOPASSWD: /usr/bin/chown\\n' > /etc/sudoers.d/storelab && chmod 0440 /etc/sudoers.d/storelab\"" || return 1
  ssh_guest "sudo -n /usr/bin/chown --version >/dev/null" || { echo "chown is not passwordless in the guest" >&2; return 1; }

  log "Running the Run lab suite in the guest session "
  ssh_session "rm -f /tmp/omakit-storelab.done; setsid bash -c 'bash /tmp/omakit-storelab-src/tests/lab/store/suite.sh /tmp/omakit-storelab > /tmp/omakit-storelab.log 2>&1; echo \$? > /tmp/omakit-storelab.done' >/dev/null 2>&1 < /dev/null &" || return 1
  wait_for_guest_state "the Run lab suite finished" 900 ssh_guest "test -f /tmp/omakit-storelab.done" || {
    ssh_guest "tail -n 40 /tmp/omakit-storelab.log" || true
    return 1
  }
  ssh_guest "cat /tmp/omakit-storelab.log" > "$out/storelab.log" 2>/dev/null || true
  ssh_guest "cat /tmp/omakit-storelab/storelab.json" > "$out/storelab.json" 2>/dev/null || true
  ssh_guest "cd /tmp/omakit-storelab && tar -cf - runs" > "$out/storelab-runs.tar" 2>/dev/null || true
  status=$(ssh_guest "cat /tmp/omakit-storelab.done")
  [[ $status == 0 ]] || { echo "the Run lab suite exited $status in the guest" >&2; tail -n 30 "$out/storelab.log" >&2; return 1; }
  jq -e '.ok == true and (.scenarios | length) == 12 and any(.scenarios[]; .scenario == "foreign-owner" and .skipped == null)' "$out/storelab.json" >/dev/null || { echo "the document does not say ok over 12 scenarios with the foreign owner simulated" >&2; return 1; }
  ssh_session "omarchy-shell shell ping | grep -qx ok" || { echo "the guest's shell does not answer after the suite" >&2; return 1; }
  ssh_session "test -z \"\$(hyprctl configerrors)\"" || return 1
  capture_console "success-omakit-storelab-01-done"
  grep '^ok - ' "$out/storelab.log"
  printf 'ok - the Store block passed all 12 lab scenarios on the stock guest, the foreign owner simulated with chown, the shell untouched; document at %s\n' "$out/storelab.json"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  case "${1:-run}" in
    preflight) omakit_storelab_preflight ;;
    run)
      omakit_storelab_preflight || exit 1
      exec "$(omakit_storelab_root)/bin/lab" plugin "$(cd -- "$(dirname -- "$0")" && pwd)/$(basename -- "$0")"
      ;;
    *) echo "usage: bash tests/lab/store/lab.sh [run|preflight]" >&2; exit 2 ;;
  esac
fi
