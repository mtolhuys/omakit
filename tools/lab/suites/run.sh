#!/usr/bin/bash
# The Run block's suite in the guest: tests/lab/run/suite.sh, the same file
# that runs on the desktop, staged with the block files and run inside the
# graphical session, its document copied back. What it proves that the
# desktop run cannot: the block runs on a stock install, where
# /usr/bin/python3 is a dependency of desktop packages and not an Omarchy
# choice (docs/BLOCKS_SPIKE.md), in the session of a shell nobody
# customised. The guest's shell is never restarted and never loads the
# harness: every scenario is its own quickshell instance.
#
# Runs through tools/lab/harness.sh, which defines the helpers used here.

omakit_lab_suite() {
  local runs="${1:-1}" status

  log "Checking the stock guest for the block's plumbing"
  ssh_guest "test -x /usr/bin/python3 && test -x /usr/bin/quickshell && test -x /usr/bin/setsid && test -x /usr/bin/kill" || { echo "the guest lacks python3, quickshell, setsid or kill under /usr/bin" >&2; return 1; }
  ssh_guest "/usr/bin/python3 --version; pacman -Q python quickshell util-linux; pacman -Qi python | grep '^Required By'" > "$RUN_DIR/guest-plumbing.txt" 2>&1 || true
  log "$(head -n 4 "$RUN_DIR/guest-plumbing.txt" | tr '\n' ';')"

  log "Staging the suite and the block files in the guest"
  ssh_guest "rm -rf /tmp/omakit-runlab-src" || return 1
  stage_paths "$OMAKIT_DIR" /tmp/omakit-runlab-src tests/lab/run blocks/run || return 1

  log "Running the Run lab suite in the guest session ($runs run per scenario)"
  guest_job runlab 900 "bash /tmp/omakit-runlab-src/tests/lab/run/suite.sh /tmp/omakit-runlab $runs" || return 1
  guest_file /tmp/omakit-runlab/runlab.json runlab.json || true
  ssh_guest "cd /tmp/omakit-runlab && tar -cf - runs" > "$RUN_DIR/runlab-runs.tar" 2>/dev/null || true
  status=$(guest_job_status runlab)
  [[ $status == 0 ]] || { echo "the Run lab suite exited $status in the guest" >&2; tail -n 30 "$RUN_DIR/runlab.log" >&2; return 1; }
  guest_shell_healthy || return 1
  capture_console "success-runlab-01-done"
  grep '^ok - ' "$RUN_DIR/runlab.log"
  printf 'ok - the Run block ran its lab scenarios on the stock guest, the shell untouched; document at %s\n' "$RUN_DIR/runlab.json"
}
