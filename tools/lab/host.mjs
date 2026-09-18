// What the host has and what it lacks, each with its measured reason.
//
// Read-only: every probe is a stat, a read of /proc, or a `--version`.
// Nothing here installs anything (packaging/LAB_PLAN.md: lab-only host
// capabilities are preflighted and reported, never installed). Measured
// before this (docs/history/2026-09-18-lab-inventory.md P10, P20): the
// upstream harness ran `omarchy-pkg-add` for six packages at the top of
// every invocation, and the old doctor refused on the first missing thing
// without saying what it cost.

import { accessSync, constants, existsSync, readFileSync, statSync, statfsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { cpus } from "node:os"
import { dirname } from "node:path"
import { labPin } from "./pin.mjs"

export const OVMF_CODE = "/usr/share/edk2/x64/OVMF_CODE.4m.fd"
export const OVMF_VARS_TEMPLATE = "/usr/share/edk2/x64/OVMF_VARS.4m.fd"

/** The commands a run needs, and what each is for. `--version` is the whole question asked of any of them here. */
export const RUN_COMMANDS = Object.freeze([
  Object.freeze({ command: "qemu-system-x86_64", package: "qemu-full", why: "boots the guest" }),
  Object.freeze({ command: "qemu-img", package: "qemu-full", why: "creates the per-run overlay and inspects disks" }),
  Object.freeze({ command: "ssh", versionArgs: ["-V"], package: "openssh", why: "runs the suite in the guest" }),
])

/** What base preparation needs beyond a run: the toolchain's console driver reads the installer's screen. */
export const BUILD_COMMANDS = Object.freeze([
  Object.freeze({ command: "socat", versionArgs: ["-V"], package: "socat", why: "the toolchain's QMP transport" }),
  Object.freeze({ command: "magick", package: "imagemagick", why: "the toolchain's screendump conversion" }),
  Object.freeze({ command: "tesseract", package: "tesseract, tesseract-data-eng", why: "the toolchain reads the installer's screens" }),
  // `-l -f /dev/null` is a read that fails; a bare `ssh-keygen` starts
  // generating a key at ~/.ssh/id_ed25519 (measured: it printed
  // "Generating public/private ed25519 key pair." under this probe).
  Object.freeze({ command: "ssh-keygen", versionArgs: ["-l", "-f", "/dev/null"], package: "openssh", why: "the guest's lab key" }),
  Object.freeze({ command: "python3", package: "python", why: "the toolchain's one-file bootstrap server" }),
])

/** What acquisition needs: the signature check. */
export const VERIFY_COMMANDS = Object.freeze([
  Object.freeze({ command: "gpg", package: "gnupg", why: "verifies the release signature against the packaged key" }),
])

/**
 * Whether a command is on PATH, and the first line it prints for its
 * version. Presence is what matters and is read from the spawn itself: a
 * command that is there answers, whatever its exit status (`ssh -V` prints
 * on stderr, `ssh-keygen` has no version flag and prints usage with exit
 * 1), and one that is not is ENOENT.
 */
function versionOf(entry, run = spawnSync) {
  const result = run(entry.command, [...(entry.versionArgs || ["--version"])], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 4000 })
  if (result.error?.code === "ENOENT") return null
  const line = `${result.stdout || ""}\n${result.stderr || ""}`.split("\n").map((l) => l.trim()).find(Boolean)
  return line || `${entry.command} is on PATH`
}

/** One line per command: present with its first version line, or missing with the package that provides it. */
export function probeCommands(list, { run } = {}) {
  return list.map((entry) => {
    const version = versionOf(entry, run)
    return {
      name: entry.command,
      state: version ? "ok" : "missing",
      reason: version ? version : `${entry.command} is not on PATH (${entry.why})`,
      remedy: version ? null : `sudo pacman -S --needed ${entry.package}`,
    }
  })
}

/** /dev/kvm: a character device this user can open for reading and writing, which is what QEMU needs from it. */
export function probeKvm(path = "/dev/kvm") {
  try {
    const st = statSync(path)
    if (!st.isCharacterDevice()) return { name: "kvm", state: "missing", reason: `${path} is not a character device`, remedy: "load the kvm module for this CPU (kvm_amd or kvm_intel)" }
    accessSync(path, constants.R_OK | constants.W_OK)
    return { name: "kvm", state: "ok", reason: `${path} is a character device this user can open read-write` }
  } catch (error) {
    if (error.code === "ENOENT") return { name: "kvm", state: "missing", reason: `${path} does not exist: no KVM on this kernel, or virtualisation is off in firmware`, remedy: "enable virtualisation in firmware; a guest without KVM is not something the lab runs" }
    return { name: "kvm", state: "missing", reason: `${path} exists but this user cannot open it (${error.code})`, remedy: "sudo usermod -aG kvm $USER, then log in again" }
  }
}

/** The two firmware files QEMU boots the guest with, readable. */
export function probeOvmf(code = OVMF_CODE, vars = OVMF_VARS_TEMPLATE) {
  const missing = [code, vars].filter((file) => {
    try {
      accessSync(file, constants.R_OK)
      return false
    } catch {
      return true
    }
  })
  if (missing.length) return { name: "ovmf", state: "missing", reason: `${missing.join(" and ")} not readable`, remedy: "sudo pacman -S --needed edk2-ovmf" }
  return { name: "ovmf", state: "ok", reason: `${code} (${statSync(code).size.toLocaleString("en-US")} B) and the ${statSync(vars).size.toLocaleString("en-US")} B variables template readable` }
}

/** Free bytes on the filesystem that holds (or would hold) the lab cache, from the nearest existing ancestor. */
export function freeBytesAt(path) {
  let probe = path
  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  const fs = statfsSync(probe)
  return { path: probe, bytes: Number(fs.bavail) * Number(fs.bsize) }
}

/** MemTotal and MemAvailable from /proc/meminfo, in bytes. */
export function memoryBytes(file = "/proc/meminfo") {
  const text = readFileSync(file, "utf8")
  const read = (key) => Number(text.match(new RegExp(`^${key}:\\s+(\\d+) kB`, "m"))?.[1] || 0) * 1024
  return { total: read("MemTotal"), available: read("MemAvailable") }
}

/**
 * The host for a run: KVM, the three commands, the firmware, memory against
 * the guest's, and the CPU count the guest gets. `--json` carries the same
 * fields.
 */
export function probeRunHost({ pin = labPin(), run } = {}) {
  const memory = memoryBytes()
  const guestBytes = pin.guest.memoryMiB * 1024 * 1024
  const lines = [probeKvm(), ...probeCommands(RUN_COMMANDS, { run }), probeOvmf()]
  lines.push({
    name: "memory",
    state: memory.total >= guestBytes * 1.5 ? "ok" : "missing",
    reason: `${(memory.total / 2 ** 20).toFixed(0)} MiB total, ${(memory.available / 2 ** 20).toFixed(0)} MiB available; the guest takes ${pin.guest.memoryMiB} MiB`,
    remedy: memory.total >= guestBytes * 1.5 ? null : `the guest needs ${pin.guest.memoryMiB} MiB and the host its own; this host has less than one and a half times that`,
  })
  lines.push({ name: "cpus", state: "ok", reason: `${cpus().length} logical CPUs, and the guest gets every one, as the toolchain's -smp $(nproc) gave the reference build (32, M14)` })
  return lines
}

/**
 * The vCPU count a run gives the guest: every logical CPU, which is what
 * the toolchain's `-smp $(nproc)` gave the reference build (32, packaging/LAB_PLAN.md M4, M14). A
 * smaller number would be a guess about what a suite needs, and no run
 * has measured one.
 */
export function guestCpus() {
  return Math.max(1, cpus().length)
}
