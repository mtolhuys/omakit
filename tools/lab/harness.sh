#!/usr/bin/bash
# The one harness every suite runs through, on the host, against a guest
# that `omakit lab prove` has already booted, logged in and identified.
#
#   bash tools/lab/harness.sh <suite.sh> <run-dir> <ssh-key> <ssh-port> <qmp-socket> <repo-root> <session-preamble> <guest-user> <guest-password> [suite arguments...]
#
# Every value comes in as an argument, none from the environment: omakit
# reads no variable of its own, and the harness inherits that. The suite
# file defines `omakit_lab_suite`, which gets the suite arguments and the
# helpers below, the same six the toolchain's host tests had (log,
# ssh_guest, ssh_session, wait_for_guest_state, capture_console, RUN_DIR)
# plus the staging and detached-job helpers the three gates each wrote for
# themselves (docs/history/2026-09-18-lab-inventory.md P1). Nothing here
# reaches the host's own session: every ssh goes to 127.0.0.1 on the
# forwarded port with the lab's key, and tests/unit/lab.test.mjs reads
# this file for the words it must not contain.
set -u
set -o pipefail

LAB_SUITE_FILE=$1; RUN_DIR=$2; LAB_SSH_KEY=$3; LAB_SSH_PORT=$4; LAB_QMP_SOCKET=$5; OMAKIT_DIR=$6; LAB_SESSION_PREAMBLE=$7; GUEST_USER=$8; GUEST_PASSWORD=$9
shift 9

log() { printf '==> %s\n' "$1"; }

ssh_guest() {
  ssh -i "$LAB_SSH_KEY" -p "$LAB_SSH_PORT" \
    -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityAgent=none \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ForwardAgent=no -o ForwardX11=no -o ConnectTimeout=5 -o LogLevel=ERROR \
    "$GUEST_USER@127.0.0.1" "$@"
}

# The same command inside the session: the preamble omakit built (the
# runtime directory, the session bus, the Hyprland signature, the Wayland
# display, the Omarchy path) comes in as one argument, so bash and Node
# agree on it by construction.
ssh_session() {
  ssh_guest "$LAB_SESSION_PREAMBLE; $1" </dev/null
}

wait_for_guest_state() {
  local description="$1" timeout="$2"
  shift 2
  local deadline=$((SECONDS + timeout))
  until "$@" >/dev/null 2>&1; do
    if ((SECONDS >= deadline)); then
      printf 'not ok - %s\n' "$description" >&2
      return 1
    fi
    sleep 1
  done
  printf 'ok - %s\n' "$description"
}

# A screendump into the run directory, converted to PNG when magick is on
# PATH and left as PPM otherwise; QMP is spoken by node, never by socat.
capture_console() {
  local name="$1" shot="$RUN_DIR/$1.ppm"
  sleep 1
  node "$OMAKIT_DIR/tools/lab/qmp-cli.mjs" "$LAB_QMP_SOCKET" screendump "$shot" >/dev/null 2>&1 || return 0
  [[ -s $shot ]] || { rm -f "$shot"; return 0; }
  if command -v magick >/dev/null 2>&1; then
    magick "$shot" "$RUN_DIR/$name.png" 2>/dev/null && rm -f "$shot"
  fi
  return 0
}

# A directory into the guest, whole, under a fresh destination.
stage_tree() {
  local src="$1" dest="$2"
  shift 2
  tar -C "$src" "$@" -cf - . | ssh_guest "rm -rf $dest && mkdir -p $dest && tar -C $dest -xf -"
}

# Named paths under a source directory into the guest, under a destination.
stage_paths() {
  local src="$1" dest="$2"
  shift 2
  tar -C "$src" -cf - "$@" | ssh_guest "mkdir -p $dest && tar -C $dest -xf -"
}

# A staged tree turned into a local git repository in the guest, which is
# what omarchy-plugin-add takes.
stage_plugin() {
  stage_tree "$1" "$2" --exclude=.git --exclude=.cache --exclude=node_modules
  ssh_guest "git -C $2 init -q && git -C $2 add . && git -C $2 -c user.name=Lab -c user.email=lab@invalid commit -qm staged"
}

# One detached job in the session: a suite that restarts the shell, or
# that must outlive the ssh call, runs under setsid and reports through a
# done file; its log is copied back beside host.log when it ends.
#   guest_job <tag> <limit-seconds> <command>
guest_job() {
  local tag="$1" limit="$2" command="$3"
  ssh_session "rm -f /tmp/omakit-lab-$tag.done /tmp/omakit-lab-$tag.log; \
    setsid bash -c '$command > /tmp/omakit-lab-$tag.log 2>&1; echo \$? > /tmp/omakit-lab-$tag.done' >/dev/null 2>&1 < /dev/null &" || return 1
  wait_for_guest_state "the $tag job finished" "$limit" ssh_guest "test -f /tmp/omakit-lab-$tag.done" || {
    ssh_guest "tail -n 40 /tmp/omakit-lab-$tag.log" || true
    ssh_guest "cat /tmp/omakit-lab-$tag.log" > "$RUN_DIR/$tag.log" 2>/dev/null || true
    return 1
  }
  ssh_guest "cat /tmp/omakit-lab-$tag.log" > "$RUN_DIR/$tag.log" 2>/dev/null || true
}
guest_job_status() { ssh_guest "cat /tmp/omakit-lab-$1.done"; }

# A file out of the guest into the run directory.
guest_file() { ssh_guest "cat $1" > "$RUN_DIR/$2" 2>/dev/null; }

# The two questions every gate asks after its suite: the shell answers,
# and Hyprland reports no configuration error.
guest_shell_healthy() {
  ssh_session "omarchy-shell shell ping | grep -qx ok" || { echo "the guest's shell does not answer after the suite" >&2; return 1; }
  ssh_session "test -z \"\$(hyprctl configerrors)\"" || { echo "hyprctl reports configuration errors after the suite" >&2; return 1; }
}

# shellcheck source=/dev/null
source "$LAB_SUITE_FILE"
declare -F omakit_lab_suite >/dev/null || { echo "$LAB_SUITE_FILE must define omakit_lab_suite()" >&2; exit 2; }
omakit_lab_suite "$@"
