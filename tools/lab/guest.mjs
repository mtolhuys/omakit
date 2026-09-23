// Talking to the guest: SSH with the lab's own key to 127.0.0.1 and
// nowhere else, the session established the way a person logs in (the
// password typed at SDDM through the virtual keyboard until a Hyprland
// owned by the user exists), and the identity read from inside.
//
// The SSH argument list is pure and tests/unit/lab.test.mjs reads it: the
// key is the base's, the host is the loopback address, BatchMode, no
// agent, no forwarding of any kind, no known-hosts entry written into the
// user's file (the guest's host key is new with every base and the
// connection is to a port QEMU forwards on the loopback interface).

import { spawnSync } from "node:child_process"

export const GUEST_HOST = "127.0.0.1"

/** @param {{ key: string, port: number, user: string }} guest */
export function sshArgs({ key, port, user }) {
  return [
    "-i", key,
    "-p", String(port),
    "-o", "BatchMode=yes",
    "-o", "IdentitiesOnly=yes",
    "-o", "IdentityAgent=none",
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "ForwardAgent=no",
    "-o", "ForwardX11=no",
    "-o", "ConnectTimeout=5",
    "-o", "LogLevel=ERROR",
    `${user}@${GUEST_HOST}`,
  ]
}

/**
 * The environment a command needs to reach the running session from an
 * SSH login, as the toolchain's `ssh_session` set it: the runtime
 * directory, the session bus, the Hyprland signature, the Wayland display,
 * and the Omarchy path from /etc/omarchy.conf when there is one (a
 * dev-linked guest names its checkout there).
 */
export const SESSION_PREAMBLE = [
  "export XDG_RUNTIME_DIR=/run/user/$(id -u)",
  "export DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME_DIR/bus",
  "export LANG=$(systemctl --user show-environment | sed -n 's/^LANG=//p' | head -1)",
  "export LANG=${LANG:-C.UTF-8}",
  "export HYPRLAND_INSTANCE_SIGNATURE=$(ls -t $XDG_RUNTIME_DIR/hypr | head -1)",
  "export WAYLAND_DISPLAY=$(find $XDG_RUNTIME_DIR -maxdepth 1 -name 'wayland-*' ! -name '*.lock' -printf '%f\\n' | head -1)",
  "[[ ! -f /etc/omarchy.conf ]] || source /etc/omarchy.conf",
  "export OMARCHY_PATH=${OMARCHY_PATH:-/usr/share/omarchy}",
  "export PATH=$OMARCHY_PATH/bin:$PATH",
].join("; ")

/** Run one command in the guest; stdout captured, status returned, never a throw. */
export function sshGuest(guest, command, { input = "", timeoutMs = 120000 } = {}) {
  const result = spawnSync("ssh", [...sshArgs(guest), command], { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], timeout: timeoutMs })
  return { status: result.status ?? 255, stdout: result.stdout || "", stderr: result.stderr || "", error: result.error || null }
}

/** The same, inside the session's environment. */
export function sshSession(guest, command, options) {
  return sshGuest(guest, `${SESSION_PREAMBLE}; ${command}`, options)
}

/** One wait, shared by every lab module that polls. */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Wait until `ssh true` answers, polling every 5 s like the toolchain; `alive()` says whether the VM is still there. */
export async function waitForSsh(guest, { timeoutSeconds, alive, onPhase = () => {} }) {
  const started = Date.now()
  for (;;) {
    if (sshGuest(guest, "true", { timeoutMs: 10000 }).status === 0) return Math.round((Date.now() - started) / 1000)
    if (alive && !(await alive())) throw Object.assign(new Error("the guest exited while the lab waited for SSH"), { code: "guest-exited" })
    const waited = (Date.now() - started) / 1000
    if (waited >= timeoutSeconds) throw Object.assign(new Error(`no SSH answer from the guest after ${timeoutSeconds} s`), { code: "guest-timeout" })
    onPhase(`waiting for the guest's SSH (${Math.round(waited)} s)`)
    await sleep(5000)
  }
}

/** Only a Hyprland owned by the guest user proves the session: SDDM runs a compositor of its own as sddm. */
export function sessionStarted(guest) {
  return sshGuest(guest, "pgrep -u $(id -u) -x Hyprland >/dev/null", { timeoutMs: 10000 }).status === 0
}

/**
 * Log in at SDDM the way a person does: the password field is focused
 * for the remembered user, so type the password and Enter, wait ten
 * seconds, look for Hyprland, repeat. Measured by the toolchain: a login
 * takes one or two rounds after first boot.
 */
export async function establishSession({ guest, socket, password, typeText, press, timeoutSeconds = 300, onPhase = () => {} }) {
  const started = Date.now()
  let rounds = 0
  while (!sessionStarted(guest)) {
    if ((Date.now() - started) / 1000 >= timeoutSeconds) throw Object.assign(new Error(`no Hyprland session owned by ${guest.user} after ${timeoutSeconds} s`), { code: "session-timeout" })
    rounds += 1
    onPhase(`logging in at the greeter (round ${rounds})`)
    await typeText(socket, password)
    await press(socket, ["ret"])
    await sleep(10000)
  }
  return { rounds, seconds: Math.round((Date.now() - started) / 1000) }
}

/** `hyprctl -j layers` says whether a namespace is on screen; used to wait for the startup notifications to go. */
export function layerPresent(guest, namespace) {
  return sshSession(guest, `hyprctl -j layers | jq -e --arg namespace '${namespace}' '[.. | objects | select(.namespace? == $namespace)] | length > 0'`).status === 0
}

/**
 * The startup notifications a fresh base shows, dismissed so a suite's
 * screen is deterministic; a notification the suite raises later is its
 * own. Ported from the toolchain's clear_startup_notifications.
 */
export async function clearStartupNotifications(guest, { onPhase = () => {} } = {}) {
  onPhase("waiting for the notification service")
  const deadline = Date.now() + 15000
  while (sshSession(guest, "omarchy-shell notifications ping >/dev/null").status !== 0) {
    if (Date.now() > deadline) return { cleared: false, reason: "the notification service did not answer within 15 s" }
    await sleep(1000)
  }
  sshSession(guest, "omarchy-shell notifications dismissAll >/dev/null")
  const gone = Date.now() + 15000
  while (layerPresent(guest, "omarchy-notifications")) {
    if (Date.now() > gone) return { cleared: false, reason: "the notification layer stayed on screen for 15 s after dismissAll" }
    await sleep(1000)
  }
  return { cleared: true, reason: null }
}

/**
 * Who the guest is, read from inside before any suite runs: the installed
 * omarchy package, the kernel, and whether the session is running from
 * the package or from a linked checkout (`OMARCHY_PATH` in
 * /etc/omarchy.conf; a dev-linked guest names `.local/share/omarchy`).
 * This is the line the old gates never wrote (docs/history/2026-09-18-lab-
 * inventory.md P8), and docs/LAB.md's run identity requires.
 */
export function guestIdentity(guest) {
  const read = (command) => sshGuest(guest, command).stdout.trim()
  const omarchyPackage = read("pacman -Q omarchy 2>/dev/null")
  const version = omarchyPackage.split(/\s+/)[1] || null
  const conf = read("cat /etc/omarchy.conf 2>/dev/null")
  const omarchyPath = conf.match(/^OMARCHY_PATH=(.+)$/m)?.[1]?.replace(/^["']|["']$/g, "") || null
  const linked = Boolean(omarchyPath && !/^\/usr\/share\/omarchy\/?$/.test(omarchyPath))
  return {
    omarchyPackage: omarchyPackage || null,
    version,
    kernel: read("uname -r") || null,
    hostname: read("cat /etc/hostname") || null,
    omarchyPath,
    linked,
    testedSource: linked ? `linked checkout at ${omarchyPath}` : (omarchyPackage ? `installed package ${omarchyPackage}` : "unknown"),
  }
}
