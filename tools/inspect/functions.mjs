// Function sites: every named function (declared, assigned as an arrow, or
// a method), QML handler, shell function and Python def, with its length
// in lines, its deepest nesting and its branch count. Size is the one
// thing a person asks about a tree that regular expressions can answer
// without a parser: where does the logic pile up.
// The numbers are counts over the text; the threshold they are compared
// with is measured over listed trees (M12), never chosen.

import { blankComments, closingBracket, lineOf } from "./text.mjs"

const JS_BRANCH = /\b(?:if|else if|for|while|do|switch|case|catch)\b|&&|\|\||\?[^.:]/g
// A block opens with a keyword at the start of a line and closes with `fi`,
// `done` or `esac` anywhere a statement can start, so `if x; then y; fi` on
// one line nets zero and is not a level.
const SHELL_OPEN = /^\s*(?:if|for|while|until|case|select)\b/
const SHELL_CLOSE = /(?:^|[;\s])(?:fi|done|esac)\b/g
// A case arm, `pattern) command` or `(pattern) command`, is a branch: a `)`
// with text after it on a line with no `(` before it but an opening one,
// so a `$(...)` or `(( ))` in a test is not one.
const SHELL_BRANCH = /\b(?:if|elif|for|while|until|case)\b|\|\||&&|^\s*\(?[^()]*\)\s*(?!\s*$)/
// A guard, not a branch: `||` or `&&` followed by one flow word (`return`,
// `exit`, `continue`, `break`, `true`, `false`, `:`) with an optional
// status (a number, `$?` or a variable), then nothing but a `;` or the `;;`
// that ends a case arm, as in `[[ -f $x ]] || return 1`. JavaScript has no
// such idiom, so shell alone is exempted.
// Matched against the trimmed end of the code, and anchored there, so a long run of spaces costs nothing.
const SHELL_GUARD = /(?:\|\||&&)\s*(?:return|exit|continue|break|true|false|:)(?:\s+(?:\$\?|\$\{?\w+\}?|\d+))?\s*;{0,2}$/
// `<<WORD`, `<<-WORD`, `<<'WORD'`, `<<"WORD"` or `<<\WORD` outside quotes and
// outside `(( ))`; `<<<` is a here-string and `<<` in arithmetic a shift.
const HEREDOC = /^<<(-?)\s*(?:(['"])([A-Za-z_][\w.-]*)\2|\\?([A-Za-z_][\w.-]*))/
// The line that closes a shell function: `}` alone, or `}` with a comment or a redirection after it.
const SHELL_END = /^\}\s*(?:#.*|[<>&|].*)?$/
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
 * One shell line read left to right with a stack of contexts: a
 * single-quoted string, a double-quoted string, an ANSI-C `$'...'` string,
 * and, nested in a double-quoted string, `$(...)`, `${...}` and a
 * backtick substitution, which is what lets `"$(printf "it's")"` and
 * `"${x:-"it's"}"` read their inner quotes as their own. It returns the
 * code before a `#` that starts a comment, the heredoc the line opens, and
 * the contexts left open at its end. Quoted text that opens and closes on
 * the line is kept in the code with its quote marks dropped, so `<<'PY'`
 * and `<<PY` read alike; text inside a quote that spans lines is data and
 * left out, from the quote to its close, while what a substitution
 * spanning lines holds is shell and kept. A `'` inside double quotes
 * ("Okomart's") and a `#` inside quotes (`*'#'*`) are text; a backslash
 * escapes in code, inside double quotes and inside `$'...'`, and inside
 * plain single quotes nothing does. `<<` in shell, at the top or inside a
 * substitution, and outside `(( ))`, is a heredoc.
 * @param {string} line
 * @param {Array<{ kind: string, depth: number }>} open the contexts open from the line above, innermost last
 * @returns {{ code: string, open: Array<{ kind: string, depth: number }>, heredoc: { word: string, strip: boolean } | null }}
 */
function scanShellLine(line, open) {
  // `fresh` marks a context opened on this line; `since` is where in the code it began.
  const stack = open.map((entry) => ({ ...entry, fresh: false, since: 0 }))
  let code = ""
  let heredoc = null
  // Depth of `((` arithmetic on this line, inside which `<<` is a shift.
  let arith = 0
  const top = () => stack[stack.length - 1] || null
  const isCode = (kind) => kind === "code" || kind === "$(" || kind === "${" || kind === "`"
  // Text inside a string that spans lines is data; everything else is kept.
  const keep = () => {
    const inner = top()
    return !inner || isCode(inner.kind) || inner.fresh
  }
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    const context = top()
    const kind = context ? context.kind : "code"
    if (kind === "'") {
      if (ch === "'") stack.pop()
      else if (keep()) code += ch
      continue
    }
    if (ch === "\\") {
      i += 1
      if (keep()) code += ch + (line[i] ?? "")
      continue
    }
    if (kind === '"' || kind === "$'") {
      if (ch === kind[kind.length - 1]) stack.pop()
      else if (kind === '"' && ch === "$" && (line[i + 1] === "(" || line[i + 1] === "{")) {
        stack.push({ kind: `$${line[i + 1]}`, depth: 0, fresh: true, since: code.length })
        code += `$${line[i + 1]}`
        i += 1
        // `$((` under a quote is arithmetic: its `<<` is a shift.
        if (line[i] === "(" && line[i + 1] === "(") arith += 1
      } else if (kind === '"' && ch === "`") {
        stack.push({ kind: "`", depth: 0, fresh: true, since: code.length })
        code += ch
      } else if (keep()) code += ch
      continue
    }
    // Shell code: at the top, or inside a substitution under a double quote.
    if (kind === "$(" || kind === "${") {
      const [opener, closer] = kind === "$(" ? ["(", ")"] : ["{", "}"]
      if (ch === opener) context.depth += 1
      else if (ch === closer) {
        if (context.depth === 0) {
          stack.pop()
          code += ch
          continue
        }
        context.depth -= 1
      }
    } else if (kind === "`" && ch === "`") {
      stack.pop()
      code += ch
      continue
    }
    if (ch === "#" && (i === 0 || /[\s;()&|]/.test(line[i - 1]))) break
    if (ch === "'" || ch === '"') {
      stack.push({ kind: ch === "'" && line[i - 1] === "$" ? "$'" : ch, depth: 0, fresh: true, since: code.length })
      continue
    }
    if (ch === "(" && line[i + 1] === "(") arith += 1
    else if (ch === ")" && line[i + 1] === ")" && arith) arith -= 1
    if (ch === "<" && line[i + 1] === "<" && line[i - 1] !== "<" && line[i + 2] !== "<" && !heredoc && !arith) {
      const found = line.slice(i).match(HEREDOC)
      if (found) heredoc = { word: found[3] || found[4], strip: found[1] === "-" }
    }
    code += ch
  }
  // A quote opened on this line and still open at its end: the text from that quote on is data.
  const unclosed = stack.find((entry) => entry.fresh && !isCode(entry.kind))
  return { code: unclosed ? code.slice(0, unclosed.since) : code, open: stack.map(({ kind, depth }) => ({ kind, depth })), heredoc }
}

/** The code with any guard tail removed, so what is left is what SHELL_BRANCH reads. */
function withoutGuards(code) {
  // Peel guards from the end: `a || b && return` is one guard over a real `||`.
  let trimmed = code.trimEnd()
  let peeled = trimmed.replace(SHELL_GUARD, "").trimEnd()
  while (peeled !== trimmed) {
    trimmed = peeled
    peeled = trimmed.replace(SHELL_GUARD, "").trimEnd()
  }
  return trimmed
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
    // quotes, a remote command in double quotes) from the quote to the line
    // that closes it. Those lines count toward the length and toward
    // nothing else; what a line holds before the quote opens is still read.
    // Two heredocs on one line: the first is tracked, the second's body is
    // read as shell.
    let heredoc = null
    let open = []
    for (let at = index + 1; at < lines.length; at += 1) {
      const line = lines[at]
      if (heredoc) {
        if ((heredoc.strip ? line.replace(/^\t+/, "") : line) === heredoc.word) heredoc = null
        end = at
        continue
      }
      if (!open.length && SHELL_END.test(line.trim()) && line.startsWith(indent) && line.match(/^\s*/)[0].length === indent.length) {
        end = at
        break
      }
      const scanned = scanShellLine(line, open)
      // A line that starts inside a string from the line above is data up to the string's close; one that starts inside a `$(` is shell.
      const carried = open.length > 0 && !["$(", "${", "`"].includes(open[open.length - 1].kind)
      const code = withoutGuards(scanned.code)
      open = scanned.open
      heredoc = scanned.heredoc
      // A line that opens inside a string is read only after the string closes: no `if` at its start, only what the code holds.
      // The line's net: `if x; then y; fi` on one line is no level.
      const net = (!carried && SHELL_OPEN.test(line) ? 1 : 0) - (code.match(SHELL_CLOSE) || []).length
      depth += net
      if (depth > deepest) deepest = depth
      if (SHELL_BRANCH.test(code)) branches += 1
      end = at
    }
    rows.push({ file: file.path, line: index + 1, name, kind: "function", lines: end - index + 1, depth: deepest, branches })
    index = end
  }
  return rows
}

/**
 * Opening brackets minus closing ones on a line, outside string literals
 * and comments, carrying the state of a triple-quoted string across lines
 * so a bracket inside a docstring or an SQL text counts nothing; and the
 * code of the line with its strings and comment removed, so `and`, `or`
 * and `if` in prose are not branches.
 * @param {string} line
 * @param {string|null} triple the triple quote open from the line above, or null
 * @returns {{ balance: number, triple: string|null, continued: boolean, code: string }} `continued` when the line ends in a backslash outside a string
 */
function bracketBalance(line, triple) {
  let balance = 0
  let quote = triple
  let code = ""
  let i = 0
  for (; i < line.length; i += 1) {
    const ch = line[i]
    if (quote) {
      if (ch === "\\") i += 1
      else if (quote.length === 3 ? line.startsWith(quote, i) : ch === quote) {
        i += quote.length - 1
        quote = null
      }
      continue
    }
    if (ch === "#") break
    if (ch === '"' || ch === "'") {
      quote = line.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch
      i += quote.length - 1
      continue
    }
    if (ch === "(" || ch === "[" || ch === "{") balance += 1
    else if (ch === ")" || ch === "]" || ch === "}") balance -= 1
    code += ch
  }
  // A single quote never spans a line; a triple one does.
  const open = quote && quote.length === 3 ? quote : null
  return { balance, triple: open, continued: !open && /\\$/.test(code.trimEnd()), code }
}

const PY_DEF = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/
const PY_CLOSER = /^\s*[)\]}]/

function pythonFunctions(file) {
  const lines = file.text.split("\n")
  const rows = []
  // Whether each line starts inside a triple-quoted string, over the whole
  // file, so a `def` quoted in a docstring's example is not a function.
  const quoted = new Array(lines.length)
  let moduleTriple = null
  for (let at = 0; at < lines.length; at += 1) {
    quoted[at] = moduleTriple !== null
    moduleTriple = bracketBalance(lines[at], moduleTriple).triple
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (quoted[index]) continue
    const head = lines[index].match(PY_DEF)
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
    // A line that starts while a bracket is open, inside a triple-quoted
    // string, or after a line ending in a backslash is a continuation of
    // the statement above it (the arguments of a multi-line call, a
    // docstring, a split condition): it counts toward the length and the
    // branches, never toward depth, and never sets the unit. The def's own
    // parameter list, when it spans lines, is a continuation of the def.
    // The balance is over `(`, `[` and `{` minus their closers, outside
    // string literals, the way braceDepth skips quotes. A miscount cannot
    // run past the function: a bracket or backslash continuation ends at
    // the first line at the def's indent or shallower that is not a
    // closing bracket, whatever the balance says; a triple-quoted string
    // runs to its close, since an SQL or help text inside it may sit at
    // column 0.
    let state = bracketBalance(lines[index], null)
    let balance = Math.max(0, state.balance)
    let triple = state.triple
    let continued = state.continued
    for (let at = index + 1; at < lines.length; at += 1) {
      const line = lines[at]
      if (!line.trim()) continue
      const indent = line.match(/^\s*/)[0].length
      const continuation = balance > 0 || triple !== null || continued
      if (continuation && triple === null && indent <= base && !PY_CLOSER.test(line)) break
      state = bracketBalance(line, triple)
      if (continuation) {
        balance = Math.max(0, balance + state.balance)
        triple = state.triple
        continued = state.continued
        if (PY_BRANCH.test(state.code)) branches += 1
        end = at
        continue
      }
      if (indent <= base) break
      balance = Math.max(0, state.balance)
      triple = state.triple
      continued = state.continued
      if (first) {
        unit = indent - base
        first = false
      }
      const level = Math.max(0, Math.floor((indent - base) / unit) - 1)
      if (level > deepest) deepest = level
      if (PY_BRANCH.test(state.code)) branches += 1
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
