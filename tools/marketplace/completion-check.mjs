// Does tab completion actually work, and if not, what is missing.
//
// Measured on 15 September 2026 against an installed Omarchy (docs/
// MEASUREMENTS.md, M8): `omakit setup` wrote the script and reported it
// installed, and whether a new shell could complete anything was never
// checked. On a stock Omarchy it can, because `default/bash/shell` has
// sourced bash-completion since v1.2.0, but `complete -p omakit` in a fresh
// shell says "no completion specification" all the same, because
// bash-completion loads the user directory's script on the first TAB and
// not before. So the probe here does what TAB does: an interactive shell,
// the loader asked to load `omakit`, and then `complete -p`. Where the
// loader is missing (a `~/.bashrc` that no longer sources Omarchy's rc, a
// zsh without `compinit`), setup says so and asks once before it adds one
// guarded, marked block to the rc file; that block is the only thing omakit
// ever writes to an rc file, only after a yes, and it is never edited or
// removed by omakit.
//
// The probes are frozen argument lists (tests/unit/read-only.test.mjs asserts
// every spawn in this file uses them), run through the shell by name, so a
// test puts a stub shell first on PATH.

import { spawnSync } from "node:child_process"
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { completionInstall, parseCompletionHeader } from "./completion.mjs"
import { COMMANDS } from "./usage.mjs"
import { omakitStateDir } from "./paths.mjs"

/** Milliseconds an interactive shell may take to answer a probe; a hung rc file is reported, not waited for. */
export const PROBE_TIMEOUT_MS = 10_000

/**
 * The probe per shell. Each prints `loader=yes|no` and `spec=eager|lazy|none`:
 * whether the completion machinery is present in a new interactive shell,
 * and whether `omakit` has a completion spec, before or after the loader
 * has been asked for it the way TAB asks. fish has no loader to miss and
 * autoloads from its completions directory on `complete -C`.
 */
export const PROBES = Object.freeze({
  bash: Object.freeze(["-ic", [
    "declare -F _init_completion >/dev/null 2>&1 && echo loader=yes || echo loader=no",
    "if complete -p omakit >/dev/null 2>&1; then echo spec=eager",
    "else _comp_load omakit >/dev/null 2>&1 || __load_completion omakit >/dev/null 2>&1 || _completion_loader omakit >/dev/null 2>&1",
    "if complete -p omakit >/dev/null 2>&1; then echo spec=lazy; else echo spec=none; fi; fi",
  ].join("; ")]),
  zsh: Object.freeze(["-ic", [
    "(( $+functions[compdef] )) && echo loader=yes || echo loader=no",
    "if [[ -n ${_comps[omakit]-} ]]; then echo spec=eager",
    "elif (( $+functions[compdef] )) && whence -w _omakit >/dev/null 2>&1; then echo spec=lazy",
    "else echo spec=none; fi",
  ].join("; ")]),
  fish: Object.freeze(["-c", [
    "echo loader=yes",
    "complete -C 'omakit ' >/dev/null 2>&1",
    "if complete -c omakit | string match -q '*omakit*'; echo spec=lazy; else; echo spec=none; end",
  ].join("; ")]),
})

/**
 * Ask a new interactive shell whether completion works.
 *
 * @param {"bash"|"zsh"|"fish"} shell
 * @param {{ env?: NodeJS.ProcessEnv, timeoutMs?: number }} [options]
 * @returns {{ ran: boolean, loader: boolean, spec: "eager"|"lazy"|"none", reason: string|null }}
 */
export function verifyCompletion(shell, { env = process.env, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const probe = PROBES[shell]
  if (!probe) return { ran: false, loader: false, spec: "none", reason: `no probe for ${shell}` }
  const result = spawnSync(shell, [...probe], { encoding: "utf8", env, timeout: timeoutMs, stdio: ["ignore", "pipe", "ignore"] })
  if (result.error) {
    return { ran: false, loader: false, spec: "none", reason: result.error.code === "ENOENT" ? `${shell} is not on PATH` : result.error.code === "ETIMEDOUT" ? `${shell} did not answer within ${timeoutMs / 1000} s` : String(result.error.message) }
  }
  const out = result.stdout || ""
  const loader = /^loader=yes$/m.test(out)
  const spec = out.match(/^spec=(eager|lazy|none)$/m)?.[1] || "none"
  return { ran: true, loader, spec, reason: null }
}

/** The marker every block starts with; its presence is what makes a second run append nothing. */
export const RC_MARKER = "# omakit completion"

/**
 * The guarded lines that make completion load, per shell, and the rc file
 * they belong in: bash sources the system bash-completion if it is there;
 * zsh puts `~/.zfunc` on fpath and runs compinit. fish needs nothing.
 *
 * @returns {{ file: string, display: string, lines: string[] } | null}
 */
export function loaderBlock(shell, env = process.env) {
  const home = env.HOME || ""
  if (shell === "bash") {
    return {
      file: join(home, ".bashrc"),
      display: "~/.bashrc",
      lines: [RC_MARKER, "[[ -r /usr/share/bash-completion/bash_completion ]] && source /usr/share/bash-completion/bash_completion"],
    }
  }
  if (shell === "zsh") {
    const dir = env.ZDOTDIR || home
    return {
      file: join(dir, ".zshrc"),
      display: env.ZDOTDIR ? `${env.ZDOTDIR}/.zshrc` : "~/.zshrc",
      lines: [RC_MARKER, "fpath+=~/.zfunc", "autoload -Uz compinit && compinit"],
    }
  }
  return null
}

/** Is the marked block already in the rc file. */
export function loaderBlockPresent(shell, env = process.env) {
  const block = loaderBlock(shell, env)
  if (!block) return false
  try {
    return readFileSync(block.file, "utf8").split("\n").some((line) => line.trim() === RC_MARKER)
  } catch {
    return false
  }
}

/**
 * Append the marked block to the rc file, once. The only write omakit ever
 * makes to an rc file, and only after `setup` was answered yes: the marker
 * is looked for first, and a file that has it is left exactly as it is.
 *
 * @returns {{ appended: boolean, file: string }}
 */
export function appendLoaderBlock(shell, env = process.env) {
  const block = loaderBlock(shell, env)
  if (!block) throw new Error(`completion: no loader block for ${shell}`)
  if (loaderBlockPresent(shell, env)) return { appended: false, file: block.file }
  let existing = ""
  try {
    existing = readFileSync(block.file, "utf8")
  } catch {
    existing = ""
  }
  mkdirSync(dirname(block.file), { recursive: true })
  const rcFile = block.file
  appendFileSync(rcFile, `${existing && !existing.endsWith("\n") ? "\n" : ""}${existing ? "\n" : ""}${block.lines.join("\n")}\n`)
  return { appended: true, file: block.file }
}

/**
 * The installed script's header, read cheaply: one stat, one read of the
 * first 200 bytes. Null when there is no script for the shell in $SHELL.
 *
 * @returns {{ path: string, shell: string, version: string|null, pin: string|null } | null}
 */
export function installedCompletion(env = process.env) {
  const target = completionInstall(env)
  if (!target) return null
  let head = ""
  try {
    statSync(target.path)
    const fd = openSync(target.path, "r")
    try {
      const buffer = Buffer.alloc(200)
      const read = readSync(fd, buffer, 0, 200, 0)
      head = buffer.toString("utf8", 0, read)
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
  return { path: target.path, shell: target.shell, ...parseCompletionHeader(head) }
}

/**
 * Everything `omakit doctor` says under `omakit.completion`: the script,
 * its version and pin against this omakit's, the loader, and the spec in a
 * new shell.
 *
 * @param {{ version: string, pin: string, env?: NodeJS.ProcessEnv }} options
 */
/** The subcommands of COMMANDS a script text does not name as a word; a script from another surface lacks some. */
export function subcommandsMissingFrom(text, commands = COMMANDS) {
  // The names from the signatures alone: subcommandsOf() also lists the
  // shipped blocks for `add`, which reads blocks/, and doctor may run from
  // a tree without it (tests copy bin, tools and package.json alone).
  const names = commands.map((command) => [].concat(command.signature)[0].match(/^omakit +([a-z][a-z-]*)/)?.[1]).filter(Boolean)
  return names.filter((name) => !new RegExp(`(?<![A-Za-z0-9_-])${name}(?![A-Za-z0-9_-])`).test(text))
}

function readScript(path) {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return ""
  }
}

export function completionStatus({ version, pin, env = process.env, commands = COMMANDS }) {
  const shell = basename(env.SHELL || "")
  const target = completionInstall(env)
  if (!target) return { state: "info", shell: shell || null, detail: shell ? `no completion script for ${shell}; there is one for bash, zsh and fish` : "$SHELL is not set, so no completion script is installed", action: null, evidence: { shell: shell || null } }
  const installed = installedCompletion(env)
  const evidence = { shell: target.shell, path: target.path, present: Boolean(installed), version: installed?.version ?? null, pin: installed?.pin ?? null, loader: null, spec: null }
  if (!installed) return { state: "advice", shell: target.shell, detail: `no completion script at ${target.display}`, action: "omakit setup", evidence }
  const probe = verifyCompletion(target.shell, { env })
  evidence.loader = probe.ran ? probe.loader : null
  evidence.spec = probe.ran ? probe.spec : null
  const identity = `${target.display}, omakit ${installed.version || "unknown"}, pin ${installed.pin ? installed.pin.slice(0, 7) : "unknown"}`
  if (installed.version !== version || installed.pin !== pin) {
    return { state: "advice", shell: target.shell, detail: `${identity}; this omakit is ${version} at pin ${pin.slice(0, 7)}, so the script is stale`, action: "omakit setup", evidence }
  }
  // The script's content against the current command surface, not its
  // header alone: measured on 2026-09-19 by a first user whose installed
  // script named this version and pin and lacked `add` and `lab`, after a
  // setup that could not replace it (EROFS); doctor called it healthy
  // (docs/evidence/ux/2026-09-19-first-user-test.json, finding 8).
  const missing = subcommandsMissingFrom(readScript(target.path), commands)
  evidence.missingSubcommands = missing
  if (missing.length) return { state: "advice", shell: target.shell, detail: `${identity}; the script does not complete ${missing.join(", ")}, so it is from another command surface`, action: "omakit setup", evidence }
  if (!probe.ran) return { state: "unknown", shell: target.shell, detail: `${identity}; a new ${target.shell} could not be asked: ${probe.reason}`, action: null, evidence }
  if (!probe.loader) return { state: "advice", shell: target.shell, detail: `${identity}; a new ${target.shell} has no completion loader, so the script is never read`, action: "omakit setup", evidence }
  if (probe.spec === "none") return { state: "advice", shell: target.shell, detail: `${identity}; the loader is there but a new ${target.shell} does not load the script`, action: "omakit setup", evidence }
  return { state: "ok", shell: target.shell, detail: `${identity}; loader active, \`complete -p omakit\` seen in a new ${target.shell}${probe.spec === "lazy" ? " after the loader was asked, the way TAB asks" : ""}`, action: null, evidence }
}

/**
 * At startup, once a day: is the installed script from another omakit. One
 * stat and one short read, no pin read, and a stamp file so the line is
 * printed once per day and not once per command.
 *
 * @param {{ version: string, env?: NodeJS.ProcessEnv, today?: string }} options
 * @returns {string|null} the line to print, or null
 */
export function staleCompletionNotice({ version, env = process.env, today = new Date().toISOString().slice(0, 10) }) {
  const installed = installedCompletion(env)
  if (!installed || installed.version === version) return null
  const stampFile = join(omakitStateDir("", env), "completion-noticed")
  try {
    if (readFileSync(stampFile, "utf8").trim() === today) return null
  } catch {
    // No stamp yet: the first notice.
  }
  try {
    mkdirSync(dirname(stampFile), { recursive: true })
    writeFileSync(stampFile, `${today}\n`)
  } catch {
    // A stamp that cannot be written costs one line a command, nothing else.
  }
  return `tab completion is from ${installed.version || "an older omakit"}; run omakit setup`
}

/** Whether a probe result means completion works: a spec seen, eagerly or after the loader was asked. */
export function completionWorks(probe) {
  return probe.ran && probe.loader && probe.spec !== "none"
}
