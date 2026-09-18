#!/usr/bin/bash
# The Store block's suite in the guest: tests/lab/store/suite.sh staged
# with both blocks' files and run inside the graphical session, its
# document copied back. Every hostile condition the contract refuses is
# planted in a throwaway HOME; the foreign-owner scenario needs one file
# owned by root, and the guest, being disposable, gets a sudoers drop-in
# for exactly `/usr/bin/chown`. That drop-in is written into the run's
# overlay, which dies with the run: the base is never touched, and the
# document records that the owner was simulated. The guest password is the
# harness's argument, never a literal here (docs/history/2026-09-18-lab-
# inventory.md P11).
#
# Runs through tools/lab/harness.sh, which defines the helpers used here.

omakit_lab_suite() {
  local status

  log "Checking the stock guest for the block's plumbing"
  ssh_guest "test -x /usr/bin/python3 && test -x /usr/bin/quickshell && test -x /usr/bin/setsid && test -x /usr/bin/kill" || { echo "the guest lacks python3, quickshell, setsid or kill under /usr/bin" >&2; return 1; }
  ssh_guest "/usr/bin/python3 --version; pacman -Q python quickshell util-linux; pacman -Qi python | grep '^Required By'" > "$RUN_DIR/guest-plumbing.txt" 2>&1 || true
  log "$(head -n 4 "$RUN_DIR/guest-plumbing.txt" | tr '\n' ';')"

  log "Staging the suite and the block files in the guest"
  ssh_guest "rm -rf /tmp/omakit-storelab-src" || return 1
  stage_paths "$OMAKIT_DIR" /tmp/omakit-storelab-src tests/lab/store blocks/run blocks/store || return 1

  log "Allowing chown without a password in the guest's overlay, for the foreign-owner scenario"
  printf '%s\n' "$GUEST_PASSWORD" | ssh_guest "sudo -S sh -c \"printf 'omarchy ALL=(ALL) NOPASSWD: /usr/bin/chown\\n' > /etc/sudoers.d/storelab && chmod 0440 /etc/sudoers.d/storelab\"" || return 1
  ssh_guest "sudo -n /usr/bin/chown --version >/dev/null" || { echo "chown is not passwordless in the guest" >&2; return 1; }

  log "Running the Store lab suite in the guest session"
  guest_job storelab 900 "bash /tmp/omakit-storelab-src/tests/lab/store/suite.sh /tmp/omakit-storelab" || return 1
  guest_file /tmp/omakit-storelab/storelab.json storelab.json || true
  ssh_guest "cd /tmp/omakit-storelab && tar -cf - runs" > "$RUN_DIR/storelab-runs.tar" 2>/dev/null || true
  status=$(guest_job_status storelab)
  [[ $status == 0 ]] || { echo "the Store lab suite exited $status in the guest" >&2; tail -n 30 "$RUN_DIR/storelab.log" >&2; return 1; }
  guest_shell_healthy || return 1
  capture_console "success-storelab-01-done"
  grep '^ok - ' "$RUN_DIR/storelab.log"
  printf 'ok - the Store block ran its lab scenarios on the stock guest, the foreign owner simulated with chown, the shell untouched; document at %s\n' "$RUN_DIR/storelab.json"
}
