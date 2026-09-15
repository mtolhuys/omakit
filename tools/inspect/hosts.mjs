// Host sites: every `http://` or `https://` literal in code or argv, with
// the host and scheme it names, the tool the literal reaches (the argv it
// sits in, or the call on its line), and the timeout and size-cap flags
// that argv shows. A host built from a variable is not a host: a literal
// whose host part holds `${...}` or stops at `://` is recorded as not
// resolvable and never guessed.

import { basename, blankComments, lineOf, shellSegments, shellWords } from "./text.mjs"
import { toolOf } from "./processes.mjs"

const URL = /https?:\/\/[^\s"'`)\]}>,;]*/g
const TIMEOUT_FLAGS = ["--max-time", "-m", "--connect-timeout", "--timeout", "-T"]
const SIZE_FLAGS = ["--max-filesize", "--quota", "-Q"]

/** Loopback, link-local and RFC 1918 literals, and the names that resolve there. */
export function privateAddress(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, "")
  if (["localhost", "0.0.0.0", "::1", "::"].includes(h)) return true
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!v4) return /^f[cd][0-9a-f]{2}:|^fe80:/.test(h)
  const [a, b] = [Number(v4[1]), Number(v4[2])]
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
}

/** The host of a URL literal, or null when the text shows an expression where the host would be. */
export function hostOf(url) {
  const rest = url.replace(/^https?:\/\//, "")
  const authority = rest.split(/[/?#]/)[0]
  if (!authority || /\$\{|\$\(|["'`+]/.test(authority)) return null
  const host = authority.includes("@") ? authority.slice(authority.lastIndexOf("@") + 1) : authority
  const bare = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]
  return bare && /^[\w.\-[\]:]+$/.test(bare) ? bare : null
}

/** The flag with its value: `--max-time 5`, `--max-time=5`, `-m5`. */
function flagValue(words, names) {
  for (const [index, word] of words.entries()) {
    for (const name of names) {
      if (word === name) return `${name} ${words[index + 1] ?? ""}`.trim()
      if (word.startsWith(`${name}=`)) return word
      if (name.length === 2 && word.startsWith(name) && word.length > 2 && /\d/.test(word[2])) return word
    }
  }
  return null
}

/** The words a URL is invoked with: a `-c` script's own words when the URL sits inside one, otherwise the argv. */
function wordsAround(process, url) {
  const argv = process.argv
  const at = argv.findIndex((word) => word.includes(url))
  if (at < 0 || !process.shellWrapper) return argv
  const script = toolOf(argv).index + 2
  if (at !== script) return argv
  // The URL is a word inside the script string: the words of its own segment.
  for (const segment of shellSegments(argv[at])) {
    if (segment.text.includes(url)) return shellWords(segment.text)
  }
  return shellWords(argv[at])
}

function caps(words, wholeArgv) {
  const joined = wholeArgv.join(" ")
  const timeout = flagValue(words, TIMEOUT_FLAGS)
    || (wholeArgv.some((word) => basename(word) === "timeout") ? `timeout ${wholeArgv[wholeArgv.findIndex((word) => basename(word) === "timeout") + 1] ?? ""}`.trim() : null)
  const head = joined.match(/(?:^|[\s|/])head\s+(?:-\S+\s+)*-c\s+(\S+)/)
  const size = flagValue(words, SIZE_FLAGS) || (head ? `head -c ${head[1]}` : null)
  return {
    timeout: { observed: Boolean(timeout), via: timeout },
    sizeCap: { observed: Boolean(size), via: size },
  }
}

/** Shell and Python comments blanked, quotes respected, line count kept. */
function blankHashComments(text) {
  return text.split("\n").map((line) => {
    let quote = null
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (quote) {
        if (ch === "\\") i += 1
        else if (ch === quote) quote = null
      } else if (ch === '"' || ch === "'") quote = ch
      else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i)
    }
    return line
  }).join("\n")
}

function callOnLine(line, text) {
  if (/(?<![\w.])fetch\s*\(/.test(line)) return "fetch"
  if (/XMLHttpRequest/.test(line) || /XMLHttpRequest/.test(text)) return "XMLHttpRequest"
  const call = line.match(/([A-Za-z_][\w.]*)\s*\([^()]*https?:\/\//)
  return call ? call[1] : null
}

/**
 * @param {{ path: string, kind: string, text: string }} file
 * @param {Array} processes the process rows of the same file
 * @returns {{ hosts: Array, notResolvable: Array }}
 */
export function extractHosts(file, processes = []) {
  const text = file.kind === "qml" || file.kind === "js" ? blankComments(file.text) : file.kind === "shell" || file.kind === "python" ? blankHashComments(file.text) : file.text
  const hosts = []
  const notResolvable = []
  for (const match of text.matchAll(URL)) {
    const url = match[0]
    const line = lineOf(text, match.index)
    const scheme = url.startsWith("https") ? "https" : "http"
    const host = hostOf(url)
    if (!host) {
      notResolvable.push({ file: file.path, line, kind: "host", text: url })
      continue
    }
    const process = processes.find((row) => row.file === file.path && Array.isArray(row.argv) && row.argv.some((word) => word.includes(url)) && (row.declaredIn !== "shell" || row.line === line))
    let tool = null
    let words = []
    let argv = []
    if (process) {
      argv = process.argv
      words = wordsAround(process, url)
      tool = toolOf(words).tool
      if (tool) tool = basename(tool)
    } else {
      const lineText = text.split("\n")[line - 1] || ""
      tool = callOnLine(lineText, text)
    }
    const { timeout, sizeCap } = caps(words, argv)
    hosts.push({
      host,
      scheme,
      file: file.path,
      line,
      tool,
      timeout,
      sizeCap,
      flags: words.filter((word) => word.startsWith("-") && word !== "-"),
      privateAddress: privateAddress(host),
    })
  }
  return { hosts, notResolvable }
}
