// The text primitives every extractor shares: line numbers, brace-delimited
// blocks, a property's raw value inside a block, string and array literals,
// and the crude shell word split. All of it is regular expressions and
// bracket counting over raw text, with no parser behind it, which is why
// every row the extractors produce is labelled observed and never claimed
// as complete.

/** 1-based line number of a character offset. */
export function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1
  return line
}

/**
 * QML and JavaScript comments replaced by spaces, so a `Process {` in a
 * comment is not a process and every offset still maps to its line.
 */
export function blankComments(text) {
  let out = ""
  let i = 0
  let quote = null
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (quote) {
      out += ch
      if (ch === "\\" && i + 1 < text.length) {
        out += next
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i += 1
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch
      out += ch
      i += 1
      continue
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") {
        out += " "
        i += 1
      }
      continue
    }
    if (ch === "/" && next === "*") {
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        out += text[i] === "\n" ? "\n" : " "
        i += 1
      }
      out += "  "
      i += 2
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/** The offset of the bracket that closes the one at `open`, strings skipped; -1 when unbalanced. */
export function closingBracket(text, open) {
  const pairs = { "{": "}", "[": "]", "(": ")" }
  const close = pairs[text[open]]
  let depth = 0
  let quote = null
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === "\\") i += 1
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch
    else if (ch === text[open]) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Every `Name {` block in a text: where it starts, its body, its line and its
 * `id:`. `Name` is matched as a whole word, so `Process {` is found and
 * `SubProcess {` is not. The text is expected to have its comments blanked.
 */
export function blocks(text, name) {
  const found = []
  const pattern = new RegExp(`(?<![\\w.])${name}\\s*\\{`, "g")
  for (const match of text.matchAll(pattern)) {
    const open = match.index + match[0].length - 1
    const end = closingBracket(text, open)
    if (end < 0) continue
    const body = text.slice(open + 1, end)
    found.push({ name, start: match.index, open, end, line: lineOf(text, match.index), body, id: idOf(body) })
  }
  return found
}

/** The `id:` of a block body, at any depth zero position. */
export function idOf(body) {
  const value = propertyValue(body, "id")
  return value && /^[A-Za-z_]\w*$/.test(value.text) ? value.text : null
}

/**
 * The raw value of `name:` at depth zero of a block body: from the colon to
 * the end of the line, or to the bracket that closes a value opening with
 * `[`, `{` or `(`, so a multi-line array is one value. `null` when the
 * property is not declared at that depth.
 * @returns {{ text: string, offset: number }|null} offset is into `body`
 */
export function propertyValue(body, name) {
  const pattern = new RegExp(`(?<![\\w.])${name}\\s*:(?!=)`, "g")
  for (const match of body.matchAll(pattern)) {
    if (depthAt(body, match.index) !== 0) continue
    // `property int name: value` declares; `name: value` binds. Both are
    // the value of the property, so both are read.
    let start = match.index + match[0].length
    while (start < body.length && (body[start] === " " || body[start] === "\t")) start += 1
    const first = body[start]
    if (first === "[" || first === "{" || first === "(") {
      const end = closingBracket(body, start)
      if (end > 0) return { text: body.slice(start, end + 1), offset: start }
    }
    // The value runs to the end of the line, or to a `;` outside quotes
    // and brackets, since QML allows `id: a; interval: 1000` on one line.
    let end = start
    let quote = null
    let depth = 0
    while (end < body.length && body[end] !== "\n") {
      const ch = body[end]
      if (quote) {
        if (ch === "\\") end += 1
        else if (ch === quote) quote = null
      } else if (ch === '"' || ch === "'" || ch === "`") quote = ch
      else if (ch === "(" || ch === "[" || ch === "{") depth += 1
      else if (ch === ")" || ch === "]" || ch === "}") depth -= 1
      else if (ch === ";" && depth === 0) break
      end += 1
    }
    return { text: body.slice(start, end).trim(), offset: start }
  }
  return null
}

/**
 * The inner text of every `$(...)` and backtick substitution in a shell
 * line, so `t=$(mktemp)` is read as running `mktemp`. Nested substitutions
 * are returned from the outside in.
 */
export function shellSubstitutions(line) {
  const out = []
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === "$" && line[i + 1] === "(") {
      const end = closingBracket(line, i + 1)
      if (end > 0) {
        out.push(line.slice(i + 2, end))
        continue
      }
    }
    if (line[i] === "`") {
      const end = line.indexOf("`", i + 1)
      if (end > 0) {
        out.push(line.slice(i + 1, end))
        i = end
      }
    }
  }
  return out
}

/** Bracket depth at an offset, strings skipped. */
export function depthAt(text, at) {
  let depth = 0
  let quote = null
  for (let i = 0; i < at; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === "\\") i += 1
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch
    else if (ch === "{" || ch === "[" || ch === "(") depth += 1
    else if (ch === "}" || ch === "]" || ch === ")") depth -= 1
  }
  return depth
}

/**
 * A string literal's value, or null when the text is not one literal: a
 * quoted string, or a template literal with no `${`. Escapes are unescaped
 * the JavaScript way for the common cases.
 */
export function stringLiteral(text) {
  const t = String(text).trim()
  const match = t.match(/^(["'`])((?:\\.|(?!\1)[^\\])*)\1$/s)
  if (!match) return null
  if (match[1] === "`" && match[2].includes("${")) return null
  return match[2].replace(/\\(.)/g, (_, ch) => ({ n: "\n", t: "\t", r: "\r" }[ch] ?? ch))
}

/**
 * The elements of an array literal `[a, b, c]`, each with its source text
 * and its literal value when it is one. Commas inside strings and nested
 * brackets are not separators. `null` when the text is not an array literal.
 */
export function arrayLiteral(text) {
  const t = String(text).trim()
  if (!t.startsWith("[") || closingBracket(t, 0) !== t.length - 1) return null
  const inner = t.slice(1, -1)
  const elements = []
  let depth = 0
  let quote = null
  let current = ""
  const flush = () => {
    const source = current.trim()
    if (source) elements.push({ text: source, literal: stringLiteral(source) })
    current = ""
  }
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]
    if (quote) {
      current += ch
      if (ch === "\\" && i + 1 < inner.length) {
        current += inner[i + 1]
        i += 1
      } else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch
    else if (ch === "[" || ch === "{" || ch === "(") depth += 1
    else if (ch === "]" || ch === "}" || ch === ")") depth -= 1
    else if (ch === "," && depth === 0) {
      flush()
      continue
    }
    current += ch
  }
  flush()
  return elements
}

/**
 * A shell line split into words the way a reader would: quotes keep a word
 * whole and are dropped, a backslash escapes the next character, and the
 * split is on whitespace. No expansion, no globbing: `$HOME/x` stays the
 * text `$HOME/x`.
 */
export function shellWords(text) {
  const words = []
  let current = ""
  let quote = null
  let started = false
  let depth = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = null
      else if (ch === "\\" && quote === '"' && i + 1 < text.length) {
        current += text[i + 1]
        i += 1
      } else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      started = true
      continue
    }
    if (ch === "\\" && i + 1 < text.length) {
      current += text[i + 1]
      started = true
      i += 1
      continue
    }
    // A `$(...)` or `(...)` is one word however many spaces it holds: the
    // assignment `x=$(curl -fsS "$url")` is one assignment, and its command
    // is read from the substitution on its own.
    if (ch === "(") depth += 1
    else if (ch === ")" && depth > 0) depth -= 1
    if (depth === 0 && /\s/.test(ch)) {
      if (started) words.push(current)
      current = ""
      started = false
      continue
    }
    current += ch
    started = true
  }
  if (started) words.push(current)
  return words
}

/**
 * A shell line cut at its unquoted `|`, `;`, `&&` and `||`, each piece with
 * the operator that led into it. `2>&1` and `>&2` are not operators.
 * @returns {Array<{ text: string, operator: string|null }>}
 */
export function shellSegments(line) {
  const segments = []
  let current = ""
  let quote = null
  let operator = null
  let depth = 0
  const push = (next) => {
    if (current.trim()) segments.push({ text: current.trim(), operator })
    current = ""
    operator = next
  }
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    const next = line[i + 1]
    if (quote) {
      current += ch
      if (ch === "\\" && i + 1 < line.length) {
        current += next
        i += 1
      } else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === "\\" && i + 1 < line.length) {
      current += ch + next
      i += 1
      continue
    }
    // Inside `$(...)` or a subshell the operators belong to the inner
    // command line, which is read on its own through shellPieces.
    if (ch === "(") depth += 1
    else if (ch === ")" && depth > 0) depth -= 1
    if (depth > 0) {
      current += ch
      continue
    }
    if (ch === "&" && next === "&") {
      push("&&")
      i += 1
      continue
    }
    if (ch === "|" && next === "|") {
      push("||")
      i += 1
      continue
    }
    if (ch === "|" && next !== "&") {
      push("|")
      continue
    }
    if (ch === "|" && next === "&") {
      push("|&")
      i += 1
      continue
    }
    if (ch === ";" && next === ";") {
      push(";")
      i += 1
      continue
    }
    if (ch === ";" || ch === "\n") {
      push(";")
      continue
    }
    current += ch
  }
  push(null)
  return segments
}

/** The words with every redirection and its target left out: `> path`, `2>&1`, `<file`, `&>log`. */
export function withoutRedirections(words) {
  const out = []
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    if (/^(?:\d*>>?|&>>?|<{1,3}|\d*<)$/.test(word)) {
      index += 1
      continue
    }
    if (/^(?:\d*>>?|&>>?|<{1,3}|\d*<)\S/.test(word)) continue
    out.push(word)
  }
  return out
}

/**
 * A shell script as logical lines, each keeping the number it started on:
 * a backslash continuation joins the next line, a quote left open joins
 * lines until it closes (a multi-line jq or awk program is one word), and
 * a here-document's body is dropped, since it is data the command reads
 * and not commands the shell runs.
 */
export function shellLogicalLines(text) {
  const out = []
  const lines = text.split("\n")
  // Open when a quote, or a `$(` or `(` outside quotes, has not closed by
  // the end of the line: the next line continues the same command.
  const unbalanced = (line) => {
    let quote = null
    let depth = 0
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (quote) {
        if (ch === "\\" && quote === '"') i += 1
        else if (ch === quote) quote = null
      } else if (ch === "\\") i += 1
      else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) break
      else if (ch === '"' || ch === "'") quote = ch
      else if (ch === "(") depth += 1
      else if (ch === ")") depth = Math.max(0, depth - 1)
    }
    return quote !== null || depth > 0
  }
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index]
    const start = index + 1
    while ((/\\$/.test(line) || unbalanced(line)) && index + 1 < lines.length) {
      index += 1
      line = /\\$/.test(line) ? `${line.slice(0, -1)} ${lines[index]}` : `${line}\n${lines[index]}`
    }
    out.push({ line: start, text: line })
    const heredoc = line.match(/<<-?\s*(["']?)([A-Za-z_][\w-]*)\1/)
    if (heredoc) {
      const stop = heredoc[2]
      while (index + 1 < lines.length && lines[index + 1].replace(/^\t+/, "") !== stop) index += 1
      index += 1
    }
  }
  return out
}

/**
 * Arithmetic and test contexts blanked to spaces, length kept: what sits
 * inside `$(( ))`, `(( ))` and `[[ ]]` is an expression, so a `>` there is
 * a comparison and a word there is not a tool.
 */
export function blankShellExpressions(line) {
  let out = line
  let from = 0
  for (;;) {
    const at = out.indexOf("((", from)
    if (at < 0) break
    const end = closingBracket(out, at)
    if (end < 0) break
    out = `${out.slice(0, at + 2)}${" ".repeat(Math.max(0, end - at - 3))}${out.slice(end - 1)}`
    from = end + 1
  }
  from = 0
  for (;;) {
    const at = out.indexOf("[[", from)
    if (at < 0) break
    const end = out.indexOf("]]", at + 2)
    if (end < 0) break
    out = `${out.slice(0, at + 2)}${" ".repeat(end - at - 2)}${out.slice(end)}`
    from = end + 2
  }
  return out
}

/**
 * Every command line inside a shell line, flattened: the line's own
 * segments, then, for each, the command lines inside its `$(...)` and
 * backtick substitutions and its `(...)` subshells, recursively, each
 * split into segments in turn. A segment that is only a subshell is
 * replaced by what runs inside it.
 * @returns {Array<{ text: string, operator: string|null }>}
 */
export function shellPieces(text, depth = 0) {
  if (depth > 8) return []
  const out = []
  for (const segment of shellSegments(text)) {
    const subshell = segment.text.startsWith("(") && closingBracket(segment.text, 0) === segment.text.length - 1
    if (subshell) {
      out.push(...shellPieces(segment.text.slice(1, -1), depth + 1).map((piece, index) => (index === 0 ? { ...piece, operator: segment.operator } : piece)))
      continue
    }
    out.push(segment)
    for (const inner of shellSubstitutions(segment.text)) out.push(...shellPieces(inner, depth + 1))
  }
  return out
}

/** The last path segment of a command word: `/usr/bin/curl` -> `curl`. */
export function basename(word) {
  return String(word).split("/").pop()
}
