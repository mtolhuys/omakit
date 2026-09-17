// Which files of the tree a `Run {` site starts: the site's argv[0]
// resolved through the text to a path, never guessed from a base name. A
// path resolves when the text shows it: a string literal, a `+` chain of
// literals, `Qt.resolvedUrl("...")` (relative to the QML file) and
// `Quickshell.env("X")`; an identifier through its `const`, `let`, `var`
// or assignment in the enclosing text, a `property` binding, or the value
// a parent QML file binds when it instantiates the component; a call to a
// function the same file defines, through its return expression with the
// arguments in place of its parameters; `a ? b : c` through `b`, `a || b`
// through `a`, and `String()`, `decodeURIComponent()`, `.replace()`,
// `.trim()`, `.toString()` through their receiver. Anything else, a
// value from a JavaScript module included, is unresolved, and a helper
// whose path is unresolved is not read as started through Run. Measured
// before this: the rule matched a helper by base name in any string
// literal of the QML, so the plugin's own copy of a script Omarchy starts
// from its own tree read as Run-started.

import { basename, blankComments, closingBracket, propertyValue, blocks, stringLiteral } from "./text.mjs"

const DEPTH = 12
const TREE = "@/"

/** Split an expression at a top-level operator, ignoring strings and brackets. */
function splitTop(text, operator) {
  const parts = []
  let depth = 0
  let quote = null
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]
    if (quote) {
      if (ch === "\\") index += 1
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch
    else if ("([{".includes(ch)) depth += 1
    else if (")]}".includes(ch)) depth -= 1
    else if (depth === 0 && text.startsWith(operator, index) && (operator !== "?" || text[index + 1] !== "?") && (operator !== "+" || text[index + 1] !== "+")) {
      parts.push(text.slice(start, index))
      index += operator.length - 1
      start = index + 1
    }
  }
  parts.push(text.slice(start))
  return parts.map((part) => part.trim())
}

/** A normalised tree-relative path from a directory and a relative reference. */
function joinTree(dir, relative) {
  const segments = []
  for (const part of `${dir}/${relative}`.split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") segments.pop()
    else segments.push(part)
  }
  return segments.join("/")
}

/** The definition of a function named `name` in `text`: its parameters and body. */
function functionIn(text, name) {
  const match = new RegExp(`(?<![\\w.])function\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`).exec(text)
  if (!match) return null
  const open = match.index + match[0].length - 1
  const end = closingBracket(text, open)
  if (end < 0) return null
  return { params: match[1].split(",").map((part) => part.trim()).filter(Boolean), body: text.slice(open + 1, end) }
}

/**
 * The assignment or declaration of `name` in `text`: the first one, or,
 * given a site offset `at`, the last one before the site (else the first
 * after it: a property declared below its use), as expression text.
 */
function assignmentIn(text, name, at = undefined) {
  const patterns = [
    new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*([^\\n;]+)`, "g"),
    new RegExp(`(?<![\\w.])(?:readonly\\s+)?property\\s+(?:string|var)\\s+${name}\\s*:\\s*([^\\n]+)`, "g"),
    new RegExp(`(?<![\\w.])${name}\\s*=(?!=)\\s*([^\\n;]+)`, "g"),
  ]
  const found = patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => ({ index: match.index, text: match[1].trim() })))
  if (!found.length) return null
  const first = found.sort((a, b) => a.index - b.index)[0]
  if (at === undefined) return first.text
  const before = found.filter((entry) => entry.index < at).sort((a, b) => b.index - a.index)
  return (before[0] || first).text
}

/** The value a parent QML file binds to `name` on an instance of `component`, with the file it sits in. */
function parentBinding(name, component, files) {
  for (const file of files) {
    if (file.kind !== "qml") continue
    for (const block of blocks(file.text, component)) {
      const value = propertyValue(block.body, name)
      if (value && value.text.trim() !== '""') return { text: value.text.trim(), file }
    }
  }
  return null
}

function resolveCall(callee, inner, scope) {
  const args = splitTop(inner, ",")
  if (callee === "Qt.resolvedUrl") {
    const literal = stringLiteral(args[0] || "")
    return literal === null ? null : `${TREE}${joinTree(scope.file.path.split("/").slice(0, -1).join("/"), literal)}`
  }
  if (callee === "Quickshell.env") {
    const literal = stringLiteral(args[0] || "")
    return literal === null ? null : `$${literal}`
  }
  if (["String", "decodeURIComponent", "encodeURIComponent"].includes(callee)) return resolve(args[0] || "", scope)
  const name = callee.split(".").pop()
  const fn = functionIn(scope.text, name) || functionIn(scope.file.text, name)
  if (!fn) return null
  const params = {}
  fn.params.forEach((param, index) => { params[param] = { text: args[index] || '""', scope } })
  const inner_scope = { ...scope, text: fn.body, params, depth: scope.depth + 1 }
  for (const expression of returnsIn(fn.body)) {
    const value = resolve(expression, inner_scope)
    if (value !== null) return value
  }
  return null
}

/** Every `return` expression of a body, cut at a newline, a `;` or the `}` that closes an enclosing block. */
function returnsIn(body) {
  const found = []
  for (const match of body.matchAll(/(?<![\w.])return\s+/g)) {
    let depth = 0
    let quote = null
    let end = body.length
    for (let index = match.index + match[0].length; index < body.length; index += 1) {
      const ch = body[index]
      if (quote) {
        if (ch === "\\") index += 1
        else if (ch === quote) quote = null
        continue
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch
      else if ("([{".includes(ch)) depth += 1
      else if (")]}".includes(ch)) { if (depth === 0) { end = index; break } depth -= 1 }
      else if ((ch === "\n" || ch === ";") && depth === 0) { end = index; break }
    }
    found.push(body.slice(match.index + match[0].length, end).trim())
  }
  return found
}

function resolveIdentifier(name, scope) {
  if (scope.params[name]) return resolve(scope.params[name].text, scope.params[name].scope)
  const inner = scope.text === scope.file.text ? null : assignmentIn(scope.text, name)
  if (inner !== null && inner !== '""' && inner !== "''") return resolve(inner, { ...scope, depth: scope.depth + 1 })
  const outer = assignmentIn(scope.file.text, name, scope.at)
  if (outer !== null && outer !== '""' && outer !== "''") return resolve(outer, { ...scope, text: scope.file.text, params: {}, depth: scope.depth + 1 })
  const component = basename(scope.file.path).replace(/\.qml$/, "")
  const bound = parentBinding(name, component, scope.files)
  if (!bound) return null
  return resolve(bound.text, { file: bound.file, files: scope.files, text: bound.file.text, params: {}, depth: scope.depth + 1, at: Infinity })
}

/**
 * @returns {string|null} a value: `@/tree/path` for a path under the tree, `$NAME...` for one built on an environment variable, a plain string for a literal; null when the text does not show it
 */
export function resolve(text, scope) {
  const expr = String(text || "").trim().replace(/;$/, "")
  if (!expr || scope.depth > DEPTH) return null
  const literal = stringLiteral(expr)
  if (literal !== null) return literal
  const ternary = splitTop(expr, "?")
  if (ternary.length > 1) return resolve(splitTop(ternary.slice(1).join("?"), ":")[0], scope)
  const either = splitTop(expr, "||")
  if (either.length > 1) return resolve(either[0], scope)
  const chain = splitTop(expr, "+")
  if (chain.length > 1) {
    const parts = chain.map((part) => resolve(part, scope))
    return parts.some((part) => part === null) ? null : parts.join("")
  }
  if (expr.startsWith("(") && closingBracket(expr, 0) === expr.length - 1) return resolve(expr.slice(1, -1), scope)
  const method = expr.match(/^(.+)\.(?:replace|trim|toString|toLowerCase|normalize)\s*\(/)
  if (method && closingBracket(expr, expr.lastIndexOf("(", method[1].length + method[0].length)) === expr.length - 1) return resolve(method[1], scope)
  const call = expr.match(/^([\w.]+)\s*\(/)
  if (call && closingBracket(expr, call[0].length - 1) === expr.length - 1) return resolveCall(call[1], expr.slice(call[0].length, -1), scope)
  if (expr === "Quickshell.shellDir") return "$QUICKSHELL_SHELL_DIR"
  const identifier = expr.match(/^(?:root\.|this\.|[a-z][\w]*\.)?([A-Za-z_]\w*)$/)
  if (identifier) return resolveIdentifier(identifier[1], scope)
  return null
}

/**
 * The tree files the QML starts through Run: for every Run site of every
 * QML file, argv[0] resolved through the text; only a value under the
 * tree that names a file of the tree counts. Sites whose argv[0] the text
 * does not show resolve to nothing and mark nothing.
 *
 * @param {Array<{ path: string, kind: string, text: string }>} files
 * @param {Array} processes the process rows, Run sites carrying block: "run"
 * @returns {{ helpers: Set<string>, resolved: Map<string, string|null> }} helper paths, and per Run site (file:line) what argv[0] resolved to
 */
export function runStartedHelpers(files, processes) {
  const helpers = new Set()
  const resolved = new Map()
  const paths = new Set(files.map((file) => file.path))
  // Comments are blanked first, as every extractor does: an apostrophe in
  // a comment would otherwise open a string for the bracket matcher.
  const blanked = files.map((file) => (file.kind === "qml" ? { ...file, text: blankComments(file.text) } : file))
  for (const row of processes) {
    if (row.declaredIn !== "qml" || row.block !== "run") continue
    const file = blanked.find((entry) => entry.path === row.file)
    const first = Array.isArray(row.argv) ? row.argv[0] : null
    const at = file ? file.text.split("\n").slice(0, row.line).join("\n").length : 0
    const value = file && first ? resolve(first, { file, files: blanked, text: file.text, params: {}, depth: 0, at }) : null
    const path = value && value.startsWith(TREE) ? joinTree("", value.slice(TREE.length)) : null
    resolved.set(`${row.file}:${row.line}`, path ? `${TREE}${path}` : value)
    if (path && paths.has(path)) helpers.add(path)
  }
  return { helpers, resolved }
}
