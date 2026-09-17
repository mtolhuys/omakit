// Process sites: every `Process {` block in QML (its `command:` inside the
// block or assigned to its id elsewhere in the file), every `Run {` block
// where the tree carries the omakit run block unmodified (its deadline and
// caps are the block's, docs/BLOCKS.md), every
// `Quickshell.execDetached([...])`, and every command line of a shell
// script. Each row carries the argv the text shows, whether a deadline is
// observed for it, what collects its output and whether a producer-side
// cap is observed in the argv. A command that is not one literal array or
// string is `argvForm: "computed"` with `argv: null`, never a guess.

import { arrayLiteral, basename, blankComments, blocks, closingBracket, lineOf, propertyValue, blankShellExpressions, shellLogicalLines, shellPieces, shellWords, stringLiteral, withoutRedirections } from "./text.mjs"

/** Shells whose `-c` turns the next element into a script the extraction does not follow. */
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "fish", "ksh"])

/**
 * Wrappers that run the word after them: the tool a host or a pattern is
 * attributed to is the first argv word that is not one of these, with the
 * wrapper's own options skipped. `timeout` is also the deadline the argv
 * carries.
 */
const WRAPPERS = new Set(["sudo", "doas", "pkexec", "env", "nohup", "nice", "ionice", "command", "exec", "timeout", "stdbuf", "chronic"])

/**
 * Shell builtins and keywords that start no process. A line whose command
 * is one of these is not a process site; `eval` is kept because it is the
 * one builtin that runs computed text.
 */
const BUILTINS = new Set([
  "cd", "set", "export", "local", "declare", "readonly", "typeset", "unset", "shift", "return", "exit", "break", "continue",
  "echo", "printf", "read", "source", ".", "trap", "true", "false", ":", "test", "[", "[[", "wait", "umask", "alias", "unalias",
  "pushd", "popd", "let", "type", "hash", "builtin", "getopts", "ulimit", "times", "jobs", "fg", "bg", "kill", "help", "exec",
])
const KEYWORDS = new Set(["if", "then", "else", "elif", "fi", "do", "done", "while", "until", "for", "in", "case", "esac", "select", "function", "time", "!", "{", "}", "(", ")", "coproc"])

/** The first argv word that is a tool, wrappers and their options skipped, with its index. */
export function toolOf(argv) {
  let index = 0
  while (index < argv.length) {
    const word = basename(argv[index])
    if (!WRAPPERS.has(word)) break
    index += 1
    if (word === "env") while (index < argv.length && (/^[A-Za-z_]\w*=/.test(argv[index]) || argv[index].startsWith("-"))) index += 1
    else if (word === "timeout") {
      while (index < argv.length && argv[index].startsWith("-")) index += /^(?:-s|-k|--signal|--kill-after)$/.test(argv[index]) ? 2 : 1
      if (index < argv.length && /^\d/.test(argv[index])) index += 1
    } else while (index < argv.length && argv[index].startsWith("-")) index += 1
  }
  return index < argv.length ? { tool: argv[index], index } : { tool: null, index: -1 }
}

/** The `timeout` duration in an argv, in milliseconds, or null: `timeout 5`, `timeout 2m`, `timeout -k 1 5s`. */
export function timeoutMs(argv) {
  const at = argv.findIndex((word) => basename(word) === "timeout")
  if (at < 0) return null
  let index = at + 1
  while (index < argv.length && argv[index].startsWith("-")) index += /^(?:-s|-k|--signal|--kill-after)$/.test(argv[index]) ? 2 : 1
  const match = String(argv[index] || "").match(/^(\d+(?:\.\d+)?)([smhd]?)$/)
  if (!match) return null
  const unit = { "": 1000, s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]]
  return Math.round(Number(match[1]) * unit)
}

/** Whether a joined argv shows a producer-side cap, and which. */
function capIn(argv) {
  if (!argv) return { observed: false, via: null }
  const joined = argv.join(" ")
  if (argv.some((word) => word.startsWith("--max-filesize"))) return { observed: true, via: "--max-filesize" }
  if (/(?:^|[\s|/])head\s+(?:-\S+\s+)*-c\b/.test(joined) || argv.some((word, index) => basename(word) === "head" && argv[index + 1] === "-c")) return { observed: true, via: "head -c" }
  if (argv.some((word) => basename(word) === "timeout")) return { observed: true, via: "timeout" }
  return { observed: false, via: null }
}

function isShellWrapper(argv) {
  if (!argv || argv.length < 2) return false
  const { tool, index } = toolOf(argv)
  if (!tool) return false
  if (basename(tool) === "eval") return true
  // `-c` alone or inside a cluster: `sh -lc`, `bash -ec`.
  return SHELLS.has(basename(tool)) && /^-[a-z]*c[a-z]*$/.test(argv[index + 1] || "")
}

/** The argv an expression resolves to, or the computed form. */
function resolveCommand(valueText) {
  const elements = arrayLiteral(valueText)
  if (elements) {
    const expressions = elements.map((element, index) => (element.literal === null ? { index, text: element.text } : null)).filter(Boolean)
    return { argv: elements.map((element) => element.literal ?? element.text), argvForm: "array", expressions }
  }
  const literal = stringLiteral(valueText)
  if (literal !== null) {
    const words = shellWords(literal)
    return { argv: words, argvForm: "string", expressions: [] }
  }
  return { argv: null, argvForm: "computed", expressions: [], text: valueText.trim() }
}

/** The value assigned to `<id>.command =` somewhere in the text, with its offset. */
function assignedCommand(text, id) {
  if (!id) return null
  const pattern = new RegExp(`(?<![\\w.])${id}\\.command\\s*=(?!=)\\s*`, "g")
  const match = pattern.exec(text)
  if (!match) return null
  const start = match.index + match[0].length
  if (text[start] === "[") {
    const end = closingBracket(text, start)
    if (end > 0) return { text: text.slice(start, end + 1), offset: match.index }
  }
  let end = text.indexOf("\n", start)
  if (end < 0) end = text.length
  return { text: text.slice(start, end).replace(/;\s*$/, ""), offset: match.index }
}

/** Whether a handler body stops the process with the given id. */
function stops(body, id) {
  if (!id) return false
  return new RegExp(`(?<![\\w.])${id}\\.(?:kill\\s*\\(|signal\\s*\\(|running\\s*=\\s*false)`).test(body)
}

function numeric(valueText) {
  return valueText !== undefined && valueText !== null && /^\d+$/.test(String(valueText).trim()) ? Number(valueText) : null
}

/** The deadline the file shows for a process: a killing Timer, `timeout` in argv, or a destruction handler. */
function deadlineFor(text, id, argv) {
  for (const timer of blocks(text, "Timer")) {
    const handler = propertyValue(timer.body, "onTriggered")
    if (handler && stops(handler.text, id)) {
      return { observed: true, via: "timer-kill", ms: numeric(propertyValue(timer.body, "interval")?.text) }
    }
  }
  const ms = argv ? timeoutMs(argv) : null
  if (argv && argv.some((word) => basename(word) === "timeout")) return { observed: true, via: "timeout-argv", ms }
  const destruction = text.match(/Component\.onDestruction\s*:/)
  if (destruction) {
    const start = destruction.index + destruction[0].length
    const trimmed = text.slice(start).replace(/^\s+/, "")
    const at = start + (text.slice(start).length - trimmed.length)
    const end = text[at] === "{" ? closingBracket(text, at) : text.indexOf("\n", at)
    if (end > 0 && stops(text.slice(at, end + 1), id)) return { observed: true, via: "destruction", ms: null }
  }
  return { observed: false, via: null, ms: null }
}

function outputOf(body, argv) {
  const collector = /(?<![\w.])StdioCollector\s*\{/.test(body) ? "StdioCollector"
    : /(?<![\w.])SplitParser\s*\{/.test(body) ? "SplitParser"
      : propertyValue(body, "stdout") ? "unknown" : "none"
  const cap = capIn(argv)
  return { collector, capObserved: cap.observed, via: cap.via }
}

function qmlRow(file, text, block, command, commandOffset) {
  const resolved = command ? resolveCommand(command.text) : { argv: null, argvForm: "computed", expressions: [], text: null }
  const id = block.id
  const running = Boolean(propertyValue(block.body, "running")?.text === "true"
    || (id && new RegExp(`(?<![\\w.])${id}\\.(?:running\\s*=\\s*true|start\\s*\\(|startDetached\\s*\\()`).test(text)))
  return {
    file: file.path,
    line: lineOf(text, commandOffset ?? block.start),
    declaredIn: "qml",
    id,
    argv: resolved.argv,
    argvForm: resolved.argvForm,
    expressions: resolved.expressions,
    commandText: resolved.argvForm === "computed" ? (resolved.text || "command not declared in the block") : null,
    running,
    detached: false,
    deadline: deadlineFor(text, id, resolved.argv),
    output: outputOf(block.body, resolved.argv),
    shellWrapper: isShellWrapper(resolved.argv),
    pipedFrom: null,
  }
}

function detachedRows(file, text) {
  const rows = []
  for (const match of text.matchAll(/(?<![\w.])(?:Quickshell\.execDetached|Process\.exec)\s*\(/g)) {
    const open = match.index + match[0].length - 1
    const end = closingBracket(text, open)
    if (end < 0) continue
    const inner = text.slice(open + 1, end).trim()
    // execDetached takes an argv array, or an object whose `command` is one.
    const value = inner.startsWith("{") ? propertyValue(inner.slice(1, -1), "command")?.text || inner : inner
    const resolved = resolveCommand(value)
    rows.push({
      file: file.path,
      line: lineOf(text, match.index),
      declaredIn: "qml",
      id: null,
      argv: resolved.argv,
      argvForm: resolved.argvForm,
      expressions: resolved.expressions,
      commandText: resolved.argvForm === "computed" ? resolved.text : null,
      running: true,
      detached: true,
      deadline: { observed: false, via: null, ms: null },
      output: { collector: "none", capObserved: false, via: null },
      shellWrapper: isShellWrapper(resolved.argv),
      pipedFrom: null,
    })
  }
  return rows
}

/**
 * A `Run {` site of the omakit run block: the deadline is the block's
 * (`deadlineMs`, default 10000), the caps are the block's (`maxBytes`),
 * and a shell string is refused unless `allowShellString: true` is on the
 * block's own line, in which case the wrapper is observed as it would be
 * on a Process.
 */
function runRow(file, text, block) {
  const inside = propertyValue(block.body, "command")
  const command = inside && !/^\[\s*\]$/.test(inside.text) ? inside : assignedCommand(text, block.id)
  const offset = inside && !/^\[\s*\]$/.test(inside.text) ? block.open + 1 + inside.offset : command ? command.offset : null
  const row = qmlRow(file, text, block, command, offset)
  const deadline = numeric(propertyValue(block.body, "deadlineMs")?.text)
  const allowShellString = propertyValue(block.body, "allowShellString")?.text === "true"
  return {
    ...row,
    running: row.running || (block.id ? new RegExp(`(?<![\\w.])${block.id}\\.start\\s*\\(`).test(text) : false),
    block: "run",
    deadline: { observed: true, via: "block-run", ms: deadline ?? 10000 },
    output: { collector: "Run", capObserved: true, via: "maxBytes" },
    shellWrapper: allowShellString ? row.shellWrapper : false,
  }
}

/** Every `Process {` block and detached exec in a QML file; `Run {` blocks too when the tree carries the run block. */
export function qmlProcesses(file, { runBlock = false } = {}) {
  const text = blankComments(file.text)
  const rows = []
  if (runBlock) for (const block of blocks(text, "Run")) rows.push(runRow(file, text, block))
  for (const block of blocks(text, "Process")) {
    const inside = propertyValue(block.body, "command")
    // `command: []` is a placeholder for a value set later: the assignment to
    // the block's id is the command, and without one the command is computed.
    if (inside && !/^\[\s*\]$/.test(inside.text)) {
      rows.push(qmlRow(file, text, block, inside, block.open + 1 + inside.offset))
      continue
    }
    const assigned = assignedCommand(text, block.id)
    if (!assigned && inside) {
      rows.push({ ...qmlRow(file, text, block, null, block.open + 1 + inside.offset), commandText: "[] (set at run time, no assignment to the id observed)" })
      continue
    }
    rows.push(qmlRow(file, text, block, assigned, assigned ? assigned.offset : null))
  }
  rows.push(...detachedRows(file, text))
  return rows.sort((a, b) => a.line - b.line)
}

/** The command words of a shell segment, leading assignments and keywords dropped; null when nothing runs. */
function commandWords(segment) {
  let words = shellWords(segment)
  // A case pattern (`*)`, `[0-9]*)`) and the blanked shells of `(( ))` and
  // `[[ ]]` run nothing; what follows a pattern on the same line does.
  if (words.length && /\)$/.test(words[0]) && !/^\$?\(/.test(words[0])) words = words.slice(1)
  words = words.filter((word) => !/^(?:\(\(\s*\)\)|\(\(|\)\)|\[\[|\]\])$/.test(word))
  while (words.length && (KEYWORDS.has(words[0]) || /^[A-Za-z_]\w*\+?=/.test(words[0]))) {
    if (words[0] === "for" || words[0] === "case" || words[0] === "select" || words[0] === "function") return null
    words = words.slice(1)
  }
  if (!words.length) return null
  if (/^[A-Za-z_]\w*\(\)$/.test(words[0])) return null
  if (BUILTINS.has(basename(words[0])) && basename(words[0]) !== "eval") return null
  return words
}

/** Every command site of a shell script, per line, pipes as separate sites. */
export function shellProcesses(file) {
  const rows = []
  for (const { line, text } of shellLogicalLines(file.text)) {
    const trimmed = blankShellExpressions(text).trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    // A command substitution runs too: `t=$(mktemp)` is a `mktemp` site.
    const segments = shellPieces(trimmed)
    const lineCap = capIn(shellWords(trimmed))
    let previous = null
    for (const segment of segments) {
      const argv = commandWords(segment.text)
      if (!argv) {
        previous = null
        continue
      }
      const stripped = withoutRedirections(argv)
      // A line that is only a redirection (`exec > log`, `> file`) runs nothing.
      if (!stripped.length) {
        previous = null
        continue
      }
      const deadlineMs = timeoutMs(stripped)
      const row = {
        file: file.path,
        line,
        declaredIn: "shell",
        id: null,
        argv: stripped,
        argvForm: "string",
        expressions: [],
        commandText: null,
        running: true,
        detached: false,
        deadline: stripped.some((word) => basename(word) === "timeout") ? { observed: true, via: "timeout-argv", ms: deadlineMs } : { observed: false, via: null, ms: null },
        output: { collector: "none", capObserved: lineCap.observed, via: lineCap.via },
        shellWrapper: isShellWrapper(stripped),
        pipedFrom: segment.operator === "|" || segment.operator === "|&" ? previous : null,
      }
      rows.push(row)
      previous = { line, argv0: stripped[0] }
    }
  }
  return rows
}

/**
 * @param {{ path: string, kind: string, text: string }} file
 * @returns {Array} process rows, in file order
 */
export function extractProcesses(file, options = {}) {
  if (file.kind === "qml") return qmlProcesses(file, options)
  if (file.kind === "shell") return shellProcesses(file)
  return []
}
