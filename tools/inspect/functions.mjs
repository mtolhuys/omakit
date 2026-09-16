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
    for (let at = index + 1; at < lines.length; at += 1) {
      const line = lines[at]
      if (line.trim() === "}" && line.startsWith(indent) && line.match(/^\s*/)[0].length === indent.length) {
        end = at
        break
      }
      if (SHELL_OPEN.test(line)) {
        depth += 1
        if (depth > deepest) deepest = depth
      }
      if (SHELL_CLOSE.test(line)) depth -= 1
      if (SHELL_BRANCH.test(line.split("#")[0])) branches += 1
      end = at
    }
    rows.push({ file: file.path, line: index + 1, name, kind: "function", lines: end - index + 1, depth: deepest, branches })
    index = end
  }
  return rows
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
    for (let at = index + 1; at < lines.length; at += 1) {
      const line = lines[at]
      if (!line.trim()) continue
      const indent = line.match(/^\s*/)[0].length
      if (indent <= base) break
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
