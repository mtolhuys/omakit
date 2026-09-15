// Write sites: a `FileView {` with a path and a write adapter or a write
// call in QML; a redirect, `tee`, `cp`, `mv`, `mkdir`, `mktemp`, `install`
// or `touch` in shell; `writeFile` and its variants in JavaScript; `open()`
// for writing in Python. Each row says whether the path's literal prefix,
// after the `$HOME`, `~` and `XDG_*` idioms are expanded, falls under a
// directory the plugin controls, and which mode the file shows for it.

import { basename, blankComments, blocks, closingBracket, lineOf, propertyValue, blankShellExpressions, shellLogicalLines, shellPieces, shellWords, stringLiteral, withoutRedirections } from "./text.mjs"

/** The directories a plugin controls, by the names the contract lists. */
export const CONTROLLED = Object.freeze(["$XDG_STATE_HOME", "$XDG_CACHE_HOME", "$XDG_RUNTIME_DIR"])
export const SHARED_TEMP = Object.freeze(["/tmp", "/var/tmp", "/dev/shm"])
const DEVICES = new Set(["/dev/null", "/dev/stderr", "/dev/stdout", "/dev/tty"])

/**
 * A path's literal prefix in canonical form: `~` and `$HOME` idioms,
 * `${X}` and `Quickshell.env("X")` all read as `$X`, and the three
 * dot-directories under the home read as the XDG names they default to.
 * A JavaScript expression that is a `+` chain of string literals and
 * `Quickshell.env()` calls is joined; any other expression is returned as
 * `null`, which the classification reads as unknown.
 */
export function canonicalPath(raw) {
  let text = String(raw).trim()
  const literal = stringLiteral(text)
  if (literal !== null) text = literal
  else if (/[+]/.test(text) || /Quickshell\.env|StandardPaths/.test(text)) {
    const pieces = text.split(/\s*\+\s*/)
    const joined = pieces.map((piece) => {
      const part = stringLiteral(piece)
      if (part !== null) return part
      const env = piece.match(/^Quickshell\.env\(\s*(["'])([A-Z_][A-Z0-9_]*)\1\s*\)$/)
      if (env) return `$${env[2]}`
      return null
    })
    if (joined.some((piece) => piece === null)) return null
    text = joined.join("")
  } else if (!/^[~/$.]/.test(text) && !/^[\w.-]+(?:\/[\w.-]*)*$/.test(text)) return null
  text = text.replace(/\$\{(\w+)\}/g, "$$$1")
  if (text === "~" || text.startsWith("~/")) text = `$HOME${text.slice(1)}`
  text = text.replace(/^\$HOME\/\.local\/state(?=\/|$)/, "$XDG_STATE_HOME")
    .replace(/^\$HOME\/\.cache(?=\/|$)/, "$XDG_CACHE_HOME")
    .replace(/^\$HOME\/\.config(?=\/|$)/, "$XDG_CONFIG_HOME")
  return text
}

/**
 * Whether a canonical path is under a directory the plugin controls.
 * @returns {{ controlledDirectory: "observed"|"not-observed"|"unknown", controlledBy: string|null, temp: boolean }}
 */
export function classifyPath(path, pluginId) {
  if (path === null || path === undefined) return { controlledDirectory: "unknown", controlledBy: null, temp: false }
  for (const prefix of CONTROLLED) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return { controlledDirectory: "observed", controlledBy: prefix, temp: false }
  }
  const own = pluginId ? `$XDG_CONFIG_HOME/omarchy/plugins/${pluginId}` : null
  if (own && (path === own || path.startsWith(`${own}/`))) return { controlledDirectory: "observed", controlledBy: own, temp: false }
  for (const prefix of SHARED_TEMP) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return { controlledDirectory: "not-observed", controlledBy: null, temp: true }
  }
  if (path.startsWith("/") || path.startsWith("$HOME") || path.startsWith("$XDG_")) return { controlledDirectory: "not-observed", controlledBy: null, temp: false }
  return { controlledDirectory: "unknown", controlledBy: null, temp: false }
}

function row(file, line, rawPath, via, pluginId, mode = null) {
  const canonical = canonicalPath(rawPath)
  const classified = classifyPath(canonical, pluginId)
  return { file: file.path, line, path: String(rawPath).trim(), canonicalPath: canonical, via, ...classified, mode }
}

function qmlWrites(file, pluginId) {
  const text = blankComments(file.text)
  const rows = []
  for (const block of blocks(text, "FileView")) {
    const path = propertyValue(block.body, "path")
    if (!path) continue
    const writes = /writeAdapter|blockWrites|atomicWrites|setText\s*\(|(?<![\w.])write\s*\(/.test(block.body)
      || (block.id && new RegExp(`(?<![\\w.])${block.id}\\.(?:writeAdapter|setText|write)\\s*\\(`).test(text))
    if (!writes) continue
    rows.push(row(file, lineOf(text, block.open + 1 + path.offset), path.text, "FileView", pluginId))
  }
  rows.push(...jsWrites({ ...file, text }, pluginId, true))
  return rows
}

function jsWrites(file, pluginId, blanked = false) {
  const text = blanked ? file.text : blankComments(file.text)
  const rows = []
  for (const match of text.matchAll(/(?<![\w.])(writeFileSync|writeFile|appendFileSync|appendFile)\s*\(/g)) {
    const open = match.index + match[0].length - 1
    const end = closingBracket(text, open)
    if (end < 0) continue
    const first = text.slice(open + 1, end).split(",")[0]
    rows.push(row(file, lineOf(text, match.index), first, match[1], pluginId))
  }
  return rows
}

function pythonWrites(file, pluginId) {
  const rows = []
  const lines = file.text.split("\n")
  for (const [index, line] of lines.entries()) {
    const code = line.split("#")[0]
    for (const match of code.matchAll(/(?<![\w.])open\s*\(\s*([^,()]+)\s*,\s*(["'])([rwaxb+]+)\2/g)) {
      if (!/[wax]/.test(match[3])) continue
      rows.push(row(file, index + 1, match[1], "open", pluginId))
    }
  }
  return rows
}

/** The words that are not options, and the value of `-m`/`--mode` when one is given. */
function operands(all) {
  const words = withoutRedirections(all)
  const out = []
  let mode = null
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index]
    if (word === "-m" || word === "--mode") {
      mode = words[index + 1] ?? null
      index += 1
    } else if (word.startsWith("--mode=")) mode = word.slice("--mode=".length)
    else if (word.startsWith("-") && word !== "-") continue
    else out.push(word)
  }
  return { operands: out, mode }
}

function shellWrites(file, pluginId) {
  const rows = []
  const chmods = []
  let umask = null
  for (const { line, text } of shellLogicalLines(file.text)) {
    const trimmed = blankShellExpressions(text).trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    for (const segment of shellPieces(trimmed)) {
      const words = shellWords(segment.text)
      if (!words.length) continue
      // Redirections anywhere in the segment: `> path`, `>> path`, `>path`, `&> path`.
      for (let i = 0; i < words.length; i += 1) {
        const word = words[i]
        let target = null
        let via = null
        if (/^(?:\d*>>?|&>>?)$/.test(word) && !/^\d*>&/.test(word)) {
          target = words[i + 1]
          via = word.includes(">>") ? ">>" : ">"
          i += 1
        } else if (/^(?:\d*>>?|&>>?)[^&\s]/.test(word)) {
          target = word.replace(/^(?:\d*>>?|&>>?)/, "")
          via = word.includes(">>") ? ">>" : ">"
        }
        // A subshell's closing paren clings to the last word; a bare number
        // or operator where a path would be is a comparison the blanking
        // did not reach, not a write.
        if (target) target = target.replace(/[);]+$/, "")
        if (target && !DEVICES.has(target) && !/^&\d$/.test(target) && !/^[\d=<>!]+$/.test(target)) rows.push(row(file, line, target, via, pluginId))
      }
      const command = basename(words[0])
      if (command === "umask" && words[1]) umask = words[1]
      if (command === "chmod" && words.length >= 3) chmods.push({ mode: words[1], paths: words.slice(2) })
      if (["tee", "mkdir", "touch"].includes(command)) {
        const { operands: paths, mode } = operands(words)
        for (const path of paths) rows.push(row(file, line, path, command, pluginId, mode))
      } else if (["cp", "mv", "install", "ln"].includes(command)) {
        const { operands: paths, mode } = operands(words)
        if (paths.length >= 2) rows.push(row(file, line, paths[paths.length - 1], command, pluginId, mode))
      } else if (command === "mktemp") {
        const { operands: paths } = operands(words)
        const template = paths[0] || (words.includes("-p") ? `${words[words.indexOf("-p") + 1]}/tmp.XXXXXX` : "/tmp/tmp.XXXXXX")
        rows.push(row(file, line, template, "mktemp", pluginId, words.includes("-d") ? "0700" : "0600"))
      }
    }
  }
  for (const write of rows) {
    if (write.mode) continue
    const chmod = chmods.find((entry) => entry.paths.includes(write.path))
    if (chmod) write.mode = `chmod ${chmod.mode}`
    else if (umask) write.mode = `umask ${umask}`
  }
  return rows
}

/**
 * @param {{ path: string, kind: string, text: string }} file
 * @param {{ pluginId?: string|null }} [context]
 * @returns {Array} write rows, in file order
 */
export function extractWrites(file, { pluginId = null } = {}) {
  if (file.kind === "qml") return qmlWrites(file, pluginId)
  if (file.kind === "js") return jsWrites(file, pluginId)
  if (file.kind === "shell") return shellWrites(file, pluginId)
  if (file.kind === "python") return pythonWrites(file, pluginId)
  return []
}
