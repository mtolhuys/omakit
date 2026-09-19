// The one contract every command leaves through, stated once here and once
// in docs/COMMANDS.md, and held per command and per outcome by
// tests/unit/json-outcomes.test.mjs.
//
//   exit      0 is success; 1 is a refusal or a failure the tool means (a
//             refused submission, drift, a lab that is not ready, a plan a
//             preflight refused, an error the operating system raised); 2 is
//             a usage error, and a question a pipe could not answer; a stop
//             asked for by a signal exits with the signal's own status,
//             128 plus its number (129 SIGHUP, 130 SIGINT, 143 SIGTERM).
//   --json    exactly one document on stdout, whatever the outcome:
//             { command, ok, error, ...the command's own document }, where
//             `error` is null on success and { code, message, remedy } on
//             any other exit, `remedy` never null; the failure's sentence
//             is on stderr too, and nothing else is.
//   stdout    the command's text on exit 0; on any other exit the text (a
//             report with its verdict, or the failure block) is on stderr,
//             so stdout carries nothing a parser would mistake for a result.
//             A long-running command's live narration (weigh's restarts, the
//             lab's suite lines) is written as it happens and is not the
//             result: on stdout for a person, on stderr under --json.
//   --out     the run's document, the same JSON --json prints, written to the
//             file on every outcome, a failure included; with --json, stdout
//             then carries nothing at all, and without it the text says
//             where the file went.
//
// Measured on 2026-09-19 by an acceptance tester: seven commands shaped
// their documents seven ways, `lab prune --json` printed nothing, `watch`
// exited 2 on a verdict, `add` on EACCES carried `remedy: null`, `lab
// inspect` and `audit` wrote a failing result to stdout only, and a failed
// `lab prove --json --out` created no file (docs/evidence/ux/
// 2026-09-19-acceptance.json, finding 2). Every one of those is one place
// now, this file, and a command that does not pass through it cannot print.

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { action, colourEnabled, GUTTER, labelled, mark, styler, verdict, withOutputStream, wrap } from "./style.mjs"
import { withHomeAbbreviated } from "./paths.mjs"

export const EXIT = Object.freeze({ ok: 0, refused: 1, usage: 2 })

/** The shell's convention for a process that stopped on a signal: 128 plus the signal number. */
export const SIGNAL_EXIT = Object.freeze({ SIGHUP: 129, SIGINT: 130, SIGTERM: 143 })

export function signalExit(signal) {
  return SIGNAL_EXIT[signal] ?? SIGNAL_EXIT.SIGINT
}

/** The exit status a failure code means, the same for every command. */
export function exitFor(code, signal = null) {
  if (code === "usage" || code === "not-confirmed") return EXIT.usage
  if (code === "interrupted") return signalExit(signal)
  return EXIT.refused
}

/**
 * What to do about an error the operating system raised, by its code: the
 * one action, since a remedy is never null. Measured on 2026-09-19: `add`
 * into a read-only directory carried EACCES and `remedy: null`.
 */
export const OS_REMEDY = Object.freeze({
  EACCES: "Make the directory writable (chmod u+w <dir>), or run it in a directory you own.",
  EPERM: "Make the directory writable (chmod u+w <dir>), or run it in a directory you own.",
  EROFS: "The filesystem is read-only; copy the tree somewhere writable and run it there.",
  ENOSPC: "Free disk space, then run it again.",
  EDQUOT: "Free disk space under your quota, then run it again.",
  ENOENT: "Check the path: it does not exist.",
  ENOTDIR: "Pass a directory where one is meant; a file is in its place.",
  EISDIR: "Pass a file where one is meant; a directory is in its place.",
  EEXIST: "Move what is in the way, then run it again.",
  ENOTEMPTY: "Move what is in the way, then run it again.",
  EBUSY: "Wait for the process that holds it, then run it again.",
  EMFILE: "Close some files or raise the descriptor limit (ulimit -n), then run it again.",
  ENFILE: "Close some files or raise the descriptor limit (ulimit -n), then run it again.",
  ELOOP: "Remove the symbolic link loop in the path, then run it again.",
  ENAMETOOLONG: "Use a shorter path.",
  ETIMEDOUT: "Connect to the network, then run it again.",
  ECONNRESET: "Connect to the network, then run it again.",
  ECONNREFUSED: "Connect to the network, then run it again.",
  ENOTFOUND: "Connect to the network, then run it again.",
  EAI_AGAIN: "Connect to the network, then run it again.",
  ENETUNREACH: "Connect to the network, then run it again.",
  EHOSTUNREACH: "Connect to the network, then run it again.",
})

/** The remedy when no table names one: where to read and what to run. */
export const GENERAL_REMEDY = "Read the sentence above; `omakit doctor` names what this machine lacks, and docs/COMMANDS.md states the command's contract."

/**
 * The remedy for a failure, never null: the module's own, else the
 * command table's, else the operating system's by errno, else the general one.
 */
export function remedyFor(code, remedy, table = {}) {
  if (typeof remedy === "string" && remedy.trim()) return remedy
  return table[code] || OS_REMEDY[code] || GENERAL_REMEDY
}

/**
 * A message as one sentence: trimmed, ending in exactly one full stop
 * (a question or an exclamation keeps its own mark). Measured on 2026-09-19:
 * `audit` appended a full stop to a sentence that had one, "without it..".
 */
export function sentence(text) {
  const trimmed = String(text ?? "").trim().replace(/\s+$/, "")
  if (!trimmed) return ""
  if (/[?!]$/.test(trimmed)) return trimmed
  return `${trimmed.replace(/\.+$/, "")}.`
}

/**
 * The document every command prints under --json: the envelope, then the
 * command's own document. A document that is a list is carried as `rows`;
 * the three envelope keys are the envelope's, whatever a document says.
 */
export function envelope({ command, exit, error = null, document = null }) {
  const ok = exit === 0
  const body = document === null || document === undefined ? {} : Array.isArray(document) ? { rows: document } : typeof document === "object" ? document : { value: document }
  const { command: _command, ok: _ok, error: _error, ...rest } = body
  return { command, ok, error: ok ? null : error, ...rest }
}

/**
 * A failure as an error object for the envelope: the code, the sentence,
 * the remedy (never null), and anything the caller listed beside them
 * (`missing`, `usage`), in that order.
 */
export function failure({ code, message, remedy, table = {}, ...extra }) {
  return { code, message: sentence(message), remedy: remedyFor(code, remedy, table), ...extra }
}

/** The failure block for a person: `█ FAIL  code`, the sentence in the gutter, the listed items, the arrow. */
export function failureBlock(error, c, { body = () => [] } = {}) {
  const lines = [`${mark("fail", c)}${c("name", error.code)}`, ...wrap(error.message, { indent: GUTTER }, c)]
  for (const item of error.missing || []) {
    lines.push(`${" ".repeat(GUTTER)}${c("name", item.what)}`, ...labelled("costs", withHomeAbbreviated(item.cost), c))
    if (item.command) lines.push(...action(withHomeAbbreviated(item.command), c))
  }
  lines.push(...body(c))
  lines.push(...action(error.remedy, c))
  return lines
}

/** A failure in a verdict register (`█ NOT WEIGHED  sentence`, then the arrow), for the commands whose report closes on a word. */
export function verdictBlock(word, error, c) {
  return [...verdict("fail", word, error.message, c), ...action(error.remedy, c, { indent: 0 })]
}

/** The value of a valued option on a command line, `--name value` or `--name=value`. */
export function optionValue(args, name) {
  let value
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) value = args[index + 1]
    else if (args[index].startsWith(`${name}=`)) value = args[index].slice(name.length + 1)
  }
  return value
}

/**
 * How a command ends: one call that writes the document, the text and the
 * file the contract above names, and sets the exit status.
 *
 * @param {{ command: string, args: string[], exit: number, document?: object|any[]|null,
 *           error?: { code: string, message: string, remedy: string }|null,
 *           human?: ((colour: boolean) => string)|string|null,
 *           render?: ((error: object, c: Function) => string[])|null,
 *           stdout?: NodeJS.WriteStream, stderr?: NodeJS.WriteStream }} outcome
 *   `human` is the command's text for a person (a report, or nothing when
 *   the failure block is all there is); `render` draws a failure in the
 *   command's own register instead of the block. An `error` is required
 *   when `exit` is not 0.
 * @returns {number} the exit status, also set on process.exitCode
 */
export function conclude({ command, args, exit, document = null, error = null, human = null, render = null, stdout = process.stdout, stderr = process.stderr }) {
  const json = args.includes("--json")
  const out = optionValue(args, "--out")
  if (exit !== 0 && !error) throw new Error(`outcome: exit ${exit} for ${command} without an error to report`)
  let doc = envelope({ command, exit, error, document })
  let written = false
  if (out) {
    try {
      mkdirSync(dirname(resolve(out)), { recursive: true })
      writeFileSync(resolve(out), `${JSON.stringify(doc, null, 2)}\n`)
      written = true
    } catch (problem) {
      // A file that could not be written is a failure of the run, reported
      // like any other and carried in the document that reaches stdout.
      exit = EXIT.refused
      error = failure({ code: problem.code || "out-unwritable", message: `--out ${resolve(out)} could not be written: ${problem.message}` })
      doc = envelope({ command, exit, error, document })
    }
  }
  if (json) {
    // The document goes to the file when there is one; with no file to go
    // to (none asked for, or one that could not be written) it is on stdout.
    if (!written) stdout.write(`${JSON.stringify(doc, null, 2)}\n`)
    if (exit !== 0) {
      const c = styler(colourEnabled(stderr))
      const lines = withOutputStream(stderr, () => (render ? render(error, c) : failureBlock(error, c)))
      stderr.write(`${lines.join("\n")}\n`)
    }
  } else {
    const stream = exit === 0 ? stdout : stderr
    const colour = colourEnabled(stream)
    const c = styler(colour)
    const pieces = []
    if (human !== null && human !== undefined) pieces.push(withOutputStream(stream, () => (typeof human === "function" ? human(colour) : String(human))))
    else if (exit !== 0) pieces.push(withOutputStream(stream, () => (render ? render(error, c) : failureBlock(error, c))).join("\n"))
    if (written) pieces.push(`${mark("pass", c)}wrote ${withHomeAbbreviated(resolve(out))}`)
    const text = pieces.filter((piece) => piece !== "").join("\n")
    if (text) stream.write(text.endsWith("\n") ? text : `${text}\n`)
  }
  process.exitCode = exit
  return exit
}

/**
 * How a failure state leaves: not through `process.exit()` in the middle
 * of a write. A write to a pipe is asynchronous on some platforms, and an
 * exit right behind it drops the bytes (measured on 2026-09-19 by a first
 * user whose `omakit audit --wat` came back with exit 2 and an empty
 * stderr). So a failure throws this, the dispatcher catches it, waits for
 * both streams to drain, and exits with the code.
 */
export class Exit extends Error {
  constructor(exit) {
    super(`exit ${exit}`)
    this.exit = exit
  }
}

/** Both streams flushed, then the exit; a closed pipe on either is not an error worth a trace. */
export async function leave(exit) {
  for (const stream of [process.stdout, process.stderr]) {
    await new Promise((resolveDrain) => {
      if (stream.destroyed || stream.writableEnded) return resolveDrain()
      stream.write("", () => resolveDrain())
    }).catch(() => {})
  }
  process.exit(exit)
}
