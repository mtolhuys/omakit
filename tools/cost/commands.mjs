// The Omarchy commands `omakit cost` runs, as a frozen table, and the one call
// site that runs them.
//
// This is the one part of omakit that changes the user's own machine: it
// restarts their shell. So what it can run is a list, not a search. Every
// entry names its binary and its arguments; `run()` is the only spawn under
// tools/cost/ (tests/unit/read-only.test.mjs holds it to that), and the only
// entry that takes an argument at run time is the shell pid lookup, which
// needs the shell's configuration directory. No `quickshell kill`, no
// `hyprctl`, no `systemctl` beyond reading the session's environment: the
// restart is `omarchy-restart-shell`, the same command a person runs, with
// its own lock check and its own readiness poll.

import { spawnSync } from "node:child_process"

export const COMMANDS = Object.freeze({
  /** The session's environment, for OMARCHY_PATH: the shell that runs, not the one on PATH. */
  sessionEnvironment: Object.freeze({ command: "systemctl", args: Object.freeze(["--user", "show-environment"]) }),
  /** Exit 0 while the compositor holds a session lock; the check `omarchy-restart-shell` makes. */
  sessionLocked: Object.freeze({ command: "omarchy-hyprland-session-locked", args: Object.freeze([]) }),
  /** Is the shell running. */
  ping: Object.freeze({ command: "omarchy-shell", args: Object.freeze(["shell", "ping"]) }),
  /** Every installed plugin with id, name, kinds, enabled and firstParty: `listPlugins` verbatim. */
  listPlugins: Object.freeze({ command: "omarchy", args: Object.freeze(["plugin", "list", "--json"]) }),
  /** The effective shell configuration, defaults filled in. */
  listShellConfig: Object.freeze({ command: "omarchy-shell", args: Object.freeze(["shell", "listShellConfig"]) }),
  /** Every manifest with its source directory, without the shell. */
  catalog: Object.freeze({ command: "omarchy-plugin-catalog", args: Object.freeze([]) }),
  /** The shell's pid: `qs list -p <shell dir> --json`, the two extra arguments passed at run time. */
  shellPid: Object.freeze({ command: "qs", args: Object.freeze(["list", "-p"]) }),
  /** The restart, and the readiness poll that comes with it. */
  restartShell: Object.freeze({ command: "omarchy-restart-shell", args: Object.freeze([]) }),
  /** Clock ticks per second, for /proc/<pid>/stat. */
  clockTicks: Object.freeze({ command: "getconf", args: Object.freeze(["CLK_TCK"]) }),
})

/**
 * Run one entry of the table. Resolves through the caller's PATH, so a test
 * puts stubs first on it; never a shell, never a string.
 *
 * @param {keyof typeof COMMANDS} name
 * @param {{ env?: NodeJS.ProcessEnv, extra?: string[], timeoutMs?: number }} [options]
 * @returns {{ ok: boolean, status: number|null, stdout: string, stderr: string, missing: boolean }}
 */
export function run(name, { env = process.env, extra = [], timeoutMs = 30_000 } = {}) {
  const entry = COMMANDS[name]
  if (!entry) throw new Error(`cost: no command named ${name}`)
  const result = spawnSync(entry.command, [...entry.args, ...extra], {
    encoding: "utf8",
    env,
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  })
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    missing: result.error?.code === "ENOENT",
  }
}

/** The command line an entry runs, for a message that names it. */
export function commandLine(name, extra = []) {
  const entry = COMMANDS[name]
  return [entry.command, ...entry.args, ...extra].join(" ")
}
