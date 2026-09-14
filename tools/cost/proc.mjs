// Reading /proc, and nothing else. Every function takes the root of the
// tree, `/proc` on a real machine and a directory of fixtures in
// tests/unit/cost.test.mjs, so the sampler is tested without a shell.
//
// What is read, and from where, is the origin every figure carries:
//
//   /proc/<pid>/stat          utime+stime (the shell's own CPU), cutime+cstime
//                             (the CPU of every child it has reaped), ppid
//   /proc/<pid>/status        VmRSS
//   /proc/<pid>/smaps_rollup  Pss: a shared page counted once, divided among
//                             the processes that share it
//   /proc/<pid>/cmdline       the first argument, cut to 80 characters, and
//                             the full line as a key that never leaves the run
//
// A process that disappears between the directory listing and the read is
// skipped, not an error: a poller lives for milliseconds.

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export const PROC = "/proc"

/** How much of a child's first argument reaches the output: enough to tell `-m` from `status`, never a whole token. */
export const ARG0_CHARS = 80

/**
 * The fields of /proc/<pid>/stat this tool reads, by their 1-based position
 * in the man page: comm is field 2 and may contain spaces, so everything
 * after its closing parenthesis is split on spaces and counted from field 3.
 */
function statOf(root, pid) {
  let text
  try {
    text = readFileSync(join(root, String(pid), "stat"), "utf8")
  } catch {
    return null
  }
  const close = text.lastIndexOf(")")
  const open = text.indexOf("(")
  if (open < 0 || close < 0) return null
  const rest = text.slice(close + 2).split(" ")
  // rest[0] is field 3 (state); field n is rest[n - 3].
  const field = (n) => Number(rest[n - 3])
  return {
    pid: Number(text.slice(0, open).trim()),
    comm: text.slice(open + 1, close),
    ppid: field(4),
    utime: field(14),
    stime: field(15),
    cutime: field(16),
    cstime: field(17),
  }
}

/** utime + stime, in clock ticks, or null when the process is gone. */
export function cpuTicks(root, pid) {
  const stat = statOf(root, pid)
  return stat ? stat.utime + stat.stime : null
}

/** cutime + cstime: the CPU of every child the process has reaped, in clock ticks. */
export function childTicks(root, pid) {
  const stat = statOf(root, pid)
  return stat ? stat.cutime + stat.cstime : null
}

/** One `Key:   value kB` line out of status or smaps_rollup, in kB, or null. */
function kbField(root, pid, file, key) {
  let text
  try {
    text = readFileSync(join(root, String(pid), file), "utf8")
  } catch {
    return null
  }
  const match = text.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, "m"))
  return match ? Number(match[1]) : null
}

/** VmRSS from /proc/<pid>/status, in kB. */
export function rssKb(root, pid) {
  return kbField(root, pid, "status", "VmRSS")
}

/** Pss from /proc/<pid>/smaps_rollup, in kB; null where the kernel does not offer the file. */
export function pssKb(root, pid) {
  return kbField(root, pid, "smaps_rollup", "Pss")
}

/** The first argument and the full command line of a process, from /proc/<pid>/cmdline. */
function cmdlineOf(root, pid) {
  let text
  try {
    text = readFileSync(join(root, String(pid), "cmdline"), "utf8")
  } catch {
    return { arg0: "", key: "" }
  }
  const parts = text.split("\0").filter((part, index, all) => index < all.length - 1 || part !== "")
  return {
    arg0: (parts[1] || "").slice(0, ARG0_CHARS).replace(/\t/g, " "),
    key: parts.join(" ").replace(/\t/g, " "),
  }
}

/**
 * Every descendant of `rootPid`, one sample: pid, command name, first
 * argument, the full command line as a key, CPU ticks and VmRSS. The key
 * tells two `inotifywait -m` watchers apart during the run; it is used for
 * attribution and never written to the output.
 *
 * @param {string} root
 * @param {number} rootPid
 * @returns {{ pid: number, comm: string, arg0: string, key: string, cpu: number, rss: number }[]}
 */
export function descendants(root, rootPid) {
  const parent = new Map()
  const name = new Map()
  let entries
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    const stat = statOf(root, Number(entry))
    if (!stat) continue
    parent.set(stat.pid, stat.ppid)
    name.set(stat.pid, stat.comm)
  }
  const out = []
  for (const [pid] of parent) {
    let up = parent.get(pid)
    let depth = 0
    while (up !== undefined && up !== 0 && up !== rootPid && depth < 32) {
      up = parent.get(up)
      depth += 1
    }
    if (up !== rootPid) continue
    const { arg0, key } = cmdlineOf(root, pid)
    out.push({
      pid,
      comm: name.get(pid),
      arg0,
      key: key || name.get(pid),
      cpu: cpuTicks(root, pid) ?? 0,
      rss: rssKb(root, pid) ?? 0,
    })
  }
  return out.sort((a, b) => a.pid - b.pid)
}
