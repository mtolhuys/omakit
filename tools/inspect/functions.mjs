// Function sites: every named function (declared, assigned as an arrow, or
// a method), QML handler, shell function and Python def, with its length
// in lines, its deepest nesting and its branch count. Size is the one
// thing a person asks about a tree that regular expressions can answer
// without a parser: where does the logic pile up.
// The numbers are counts over the text; the threshold they are compared
// with is measured over listed trees (M12), never chosen.

import { blankComments, closingBracket, lineOf } from "./text.mjs"

const JS_BRANCH = /\b(?:if|else if|for|while|do|switch|case|catch)\b|&&|\|\||\?[^.:]/g
const SHELL_OPEN = /^\s*(?:if|for|while|until|case|select)\b/
const SHELL_CLOSE = /^\s*(?:fi|done|esac)\b/
const SHELL_BRANCH = /\b(?:if|elif|for|while|until|case)\b|\|\||&&|^\s*[^)]*\)\s*(?!\s*$)/
// A guard, not a branch: `||` or `&&` followed by one flow word (`return`,
// `exit`, `continue`, `break`, `true`, `false`, `:`) with an optional
// status, and nothing else on the line, as in `[[ -f $x ]] || return 1`.
// JavaScript has no such idiom, so shell alone is exempted.
const SHELL_GUARD = /^(.*?)\s*(?:\|\||&&)\s*(?:return|exit|continue|break|true|false|:)(?:\s+(?:\$\??|\d+))?\s*;?\s*$/
// The quotes around the delimiter are gone by the time this is read, so `<<'PY'` and `<<PY` look alike.
const HEREDOC = /<<-?\s*([A-Za-z_]\w*)/
const PY_BRANCH = /^\s*(?:if|elif|for|while|except|with)\b|\band\b|\bor\b/

/**
 * Deepest brace nesting inside a body, relative to the body itself. A `{`
 * that opens a literal is not a level: an object or array literal spread
 * over lines (`return {`, `foo({`, `x = {`, `[{`, `? {`, `a || {`) and an
 * inline arrow body (`=> {`) are values, not control flow. The test is the
 * last non-space text before the brace, so this is a regular-expression
 * heuristic, not a parser: it aims at an object literal not counting as
 * nesting, and a `{` after `)` or `else` or on a line of its own counts.
 */
const LITERAL_BEFORE = /(?:[(,:=[?]|\breturn|=>|\|\||&&)\s*$/

function braceDepth(body) {
  let depth = 0
  let deepest = 0
  let quote = null
  const literal = []
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]
    if (quote) {
      if (ch === "\\") i += 1
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch
    else if (ch === "{") {
      const isLiteral = LITERAL_BEFORE.test(body.slice(Math.max(0, i - 12), i))
      literal.push(isLiteral)
      if (isLiteral) continue
      depth += 1
      if (depth > deepest) deepest = depth
    } else if (ch === "}") {
      if (!literal.pop()) depth -= 1
    }
  }
  return deepest
}

/** Words that stand before `(...) {` without naming a method. */
const NOT_A_METHOD = new Set(["if", "for", "while", "switch", "catch", "with", "function", "return", "else", "do", "try"])

function jsFunctions(file) {
  const text = blankComments(file.text)
  const rows = []
  // Four shapes, each followed by a body block: `function name(`; in QML,
  // `onSomething: {` handlers; a named arrow function, `const load = (rows)
  // => {` or `this.load = rows => {` on a property; and method shorthand,
  // `load(rows) {` at the start of a line inside an object literal or a
  // class. An anonymous callback (`(x) => {`, `function (x) {`) has no name
  // and is not counted; the method shape excludes the keywords that stand
  // before `(...) {` (`if`, `for`, `while`, `switch`, `catch`).
  const pattern = new RegExp([
    /(?<![\w.])function\s+([A-Za-z_$][\w$]*)\s*\(/.source,
    /(?<![\w.])(on[A-Z]\w*)\s*:\s*(?=\{)/.source,
    /(?<![\w$])([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^()\n]*\)|[A-Za-z_$][\w$]*)\s*=>[ \t]*(?=\{)/.source,
    /^[ \t]*(?:(?:async|static)\s+)*([A-Za-z_$][\w$]*)[ \t]*\([^()\n]*\)[ \t]*(?=\{)/.source,
  ].join("|"), "gm")
  for (const match of text.matchAll(pattern)) {
    if (match[4] && NOT_A_METHOD.has(match[4])) continue
    const open = text.indexOf("{", match.index + match[0].length)
    if (open < 0) continue
    const end = closingBracket(text, open)
    if (end < 0) continue
    const body = text.slice(open + 1, end)
    const start = lineOf(text, match.index + match[0].length - match[0].trimStart().length)
    rows.push({
      file: file.path,
      line: start,
      name: match[1] || match[2] || match[3] || match[4],
      kind: match[2] ? "handler" : "function",
      lines: lineOf(text, end) - start + 1,
      depth: braceDepth(body),
      branches: (body.match(JS_BRANCH) || []).length,
    })
  }
  return rows
}

/**
 * One shell line read left to right: the code before a `#` that starts a
 * comment, with the quoted text kept and the quote marks dropped, and the
 * quote it leaves open at its end, if any. A `'` inside double quotes
 * ("Okomart's") and a `#` inside quotes (`*'#'*`) are text, a backslash
 * escapes outside quotes and inside double quotes, and inside single
 * quotes nothing does. Starting inside a quote from the line above means
 * the line is the rest of that string.
 * @returns {{ code: string, open: "'" | '"' | null }}
 */
function scanShellLine(line, open) {
  let quote = open
  let code = ""
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quote === "'") {
      if (ch === "'") quote = null
      else code += ch
      continue
    }
    if (ch === "\\") {
      i += 1
      code += ch + (line[i] ?? "")
      continue
    }
    if (quote === '"') {
      if (ch === '"') quote = null
      else code += ch
      continue
    }
    if (ch === "#" && (i === 0 || /[\s;(&|]/.test(line[i - 1]))) break
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    code += ch
  }
  return { code, open: quote }
}

/** The code with any guard tail removed, so what is left is what SHELL_BRANCH reads. */
function withoutGuards(code) {
  // Peel guards from the end: `a || b && return` is one guard over a real `||`.
  let guard = code.match(SHELL_GUARD)
  while (guard) {
    code = guard[1]
    guard = code.match(SHELL_GUARD)
  }
  return code
}

function shellFunctions(file) {
  const lines = file.text.split("\n")
  const rows = []
  for (let index = 0; index < lines.length; index += 1) {
    const head = lines[index].match(/^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{?\s*$|^\s*function\s+([A-Za-z_][\w-]*)\s*\{?\s*$/)
    if (!head) continue
    const name = head[1] || head[2]
    // The body runs to the line that is only `}` at the function's own indent.
    const indent = lines[index].match(/^\s*/)[0]
    let end = index
    let depth = 0
    let deepest = 0
    let branches = 0
    // Data inside the function is not shell: the body of a heredoc up to its
    // delimiter alone on a line (leading tabs allowed after `<<-`), and a
    // quoted string that spans lines (an awk or python program in single
    // quotes, a remote command in double quotes) up to the line that closes
    // the quote. Those lines count toward the length and toward nothing
    // else; what a line holds before the quote opens is still read.
    let heredoc = null
    let open = null
    for (let at = index + 1; at < lines.length; at += 1) {
      const line = lines[at]
      if (heredoc) {
        if ((heredoc.strip ? line.replace(/^\t+/, "") : line) === heredoc.word) heredoc = null
        end = at
        continue
      }
      if (open) {
        open = scanShellLine(line, open).open
        end = at
        continue
      }
      if (line.trim() === "}" && line.startsWith(indent) && line.match(/^\s*/)[0].length === indent.length) {
        end = at
        break
      }
      const scanned = scanShellLine(line, null)
      const code = withoutGuards(scanned.code)
      open = scanned.open
      const opens = code.match(HEREDOC)
      if (opens) heredoc = { word: opens[1], strip: /<<-/.test(opens[0]) }
      if (SHELL_OPEN.test(line)) {
        depth += 1
        if (depth > deepest) deepest = depth
      }
      if (SHELL_CLOSE.test(line)) depth -= 1
      if (SHELL_BRANCH.test(code)) branches += 1
      end = at
    }
    rows.push({ file: file.path, line: index + 1, name, kind: "function", lines: end - index + 1, depth: deepest, branches })
    index = end
  }
  return rows
}

/** Opening brackets minus closing ones on a line, outside string literals and comments. */
function bracketBalance(line) {
  let balance = 0
  let quote = null
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quote) {
      if (ch === "\\") i += 1
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "#") break
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === "(" || ch === "[" || ch === "{") balance += 1
    else if (ch === ")" || ch === "]" || ch === "}") balance -= 1
  }
  return balance
}

function pythonFunctions(file) {
  const lines = file.text.split("\n")
  const rows = []
  for (let index = 0; index < lines.length; index += 1) {
    const head = lines[index].match(/^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/)
    if (!head) continue
    const base = head[1].length
    let end = index
    let deepest = 0
    let branches = 0
    // Depth is relative to the body, the way it is for a brace block: the
    // body's own indent is depth 0 and one `if` is depth 1. The unit is
    // one indentation step, read from the first body line (4 spaces by
    // PEP 8, 2 in some trees); 4 is assumed when there is no body line.
    let unit = 4
    let first = true
    // A line that starts while a bracket is open is a continuation of the
    // statement above it (the arguments of a multi-line call): it counts
    // toward the length, never toward depth, and never sets the unit. The
    // balance is over `(`, `[` and `{` minus their closers, outside string
    // literals, the way braceDepth skips quotes.
    let balance = 0
    for (let at = index + 1; at < lines.length; at += 1) {
      const line = lines[at]
      if (!line.trim()) continue
      const indent = line.match(/^\s*/)[0].length
      if (balance > 0) {
        balance = Math.max(0, balance + bracketBalance(line))
        end = at
        continue
      }
      if (indent <= base) break
      balance = Math.max(0, bracketBalance(line))
      if (first) {
        unit = indent - base
        first = false
      }
      const level = Math.max(0, Math.floor((indent - base) / unit) - 1)
      if (level > deepest) deepest = level
      if (PY_BRANCH.test(line)) branches += 1
      end = at
    }
    rows.push({ file: file.path, line: index + 1, name: head[2], kind: "function", lines: end - index + 1, depth: deepest, branches })
  }
  return rows
}

/**
 * @param {{ path: string, kind: string, text: string }} file
 * @returns {Array<{ file, line, name, kind, lines, depth, branches }>}
 */
export function extractFunctions(file) {
  if (file.kind === "qml" || file.kind === "js") return jsFunctions(file)
  if (file.kind === "shell") return shellFunctions(file)
  if (file.kind === "python") return pythonFunctions(file)
  return []
}
