// Function sites: every named function, QML handler, shell function and
// Python def, with its length in lines, its deepest nesting and its branch
// count. Size is the one thing a person asks about a tree that regular
// expressions can answer without a parser: where does the logic pile up.
// The numbers are counts over the text; the threshold they are compared
// with is measured over listed trees (M12), never chosen.

import { blankComments, closingBracket, lineOf } from "./text.mjs"

const JS_BRANCH = /\b(?:if|else if|for|while|do|switch|case|catch)\b|&&|\|\||\?[^.:]/g
const SHELL_OPEN = /^\s*(?:if|for|while|until|case|select)\b/
const SHELL_CLOSE = /^\s*(?:fi|done|esac)\b/
const SHELL_BRANCH = /\b(?:if|elif|for|while|until|case)\b|\|\||&&|^\s*[^)]*\)\s*(?!\s*$)/
const PY_BRANCH = /^\s*(?:if|elif|for|while|except|with)\b|\band\b|\bor\b/

/** Deepest brace nesting inside a body, relative to the body itself. */
function braceDepth(body) {
  let depth = 0
  let deepest = 0
  let quote = null
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]
    if (quote) {
      if (ch === "\\") i += 1
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch
    else if (ch === "{") {
      depth += 1
      if (depth > deepest) deepest = depth
    } else if (ch === "}") depth -= 1
  }
  return deepest
}

function jsFunctions(file) {
  const text = blankComments(file.text)
  const rows = []
  // `function name(` and, in QML, `onSomething: {` handlers with a body block.
  const pattern = /(?<![\w.])function\s+([A-Za-z_$][\w$]*)\s*\(|(?<![\w.])(on[A-Z]\w*)\s*:\s*(?=\{)/g
  for (const match of text.matchAll(pattern)) {
    const open = text.indexOf("{", match.index + match[0].length - (match[2] ? 0 : 0))
    if (open < 0) continue
    const end = closingBracket(text, open)
    if (end < 0) continue
    const body = text.slice(open + 1, end)
    const start = lineOf(text, match.index)
    rows.push({
      file: file.path,
      line: start,
      name: match[1] || match[2],
      kind: match[1] ? "function" : "handler",
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
    for (let at = index + 1; at < lines.length; at += 1) {
      const line = lines[at]
      if (!line.trim()) continue
      const indent = line.match(/^\s*/)[0].length
      if (indent <= base) break
      const level = Math.floor((indent - base) / 4)
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
