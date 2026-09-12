// A deliberately small YAML reader for GitHub issue-form documents.
//
// Omakit has zero runtime dependencies, and the one YAML document it must read
// is the pinned marketplace issue form. That form uses a narrow subset: block
// maps, block sequences, plain and quoted scalars, and one literal block
// scalar. This parser accepts exactly that subset and throws on anything it
// does not understand, so an unreadable form is a loud failure instead of a
// silently wrong submission body.
//
// Not supported on purpose: flow collections, anchors, aliases, tags,
// multi-document streams, folded scalars with chomping indicators other than
// the two below. If the marketplace ever needs them, this file fails and the
// pin update is the moment to notice.

export class YamlError extends Error {
  constructor(message, line) {
    super(line === undefined ? message : `${message} (line ${line + 1})`)
    this.name = "YamlError"
    this.code = "form-unreadable"
    this.line = line
  }
}

const KEY = /^([A-Za-z0-9_][A-Za-z0-9_.\- ]*?)\s*:(?:\s+(.*))?$/
const ITEM = /^-(\s+|$)/

function isBlank(line) {
  return line.trim() === ""
}

function isComment(line) {
  return /^\s*#/.test(line)
}

function indentOf(line) {
  return line.length - line.replace(/^ +/, "").length
}

function skip(lines, i) {
  while (i < lines.length && (isBlank(lines[i]) || isComment(lines[i]))) i += 1
  return i
}

export function parseScalar(token) {
  const text = String(token).trim()
  if (text === "" || text === "~" || text === "null") return text === "" ? "" : null
  if (text === "true") return true
  if (text === "false") return false
  if (/^-?\d+$/.test(text)) return Number(text)
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'")
  }
  return text
}

function readBlockScalar(lines, i, parentIndent, chomp) {
  const out = []
  let base = null
  while (i < lines.length) {
    if (isBlank(lines[i])) {
      out.push("")
      i += 1
      continue
    }
    const indent = indentOf(lines[i])
    if (indent <= parentIndent) break
    if (base === null) base = indent
    out.push(lines[i].slice(Math.min(base, indent)))
    i += 1
  }
  while (out.length && out.at(-1) === "") out.pop()
  const text = out.join("\n")
  return [chomp === "strip" ? text : `${text}\n`, i]
}

function parseNode(lines, i, minIndent) {
  i = skip(lines, i)
  if (i >= lines.length) return [null, i]
  const indent = indentOf(lines[i])
  if (indent < minIndent) return [null, i]
  const body = lines[i].slice(indent)
  if (ITEM.test(body)) return parseSequence(lines, i, indent)
  if (KEY.test(body)) return parseMap(lines, i, indent)
  throw new YamlError(`unsupported YAML construct: ${body.slice(0, 40)}`, i)
}

function parseSequence(lines, start, indent) {
  const out = []
  let i = start
  for (;;) {
    i = skip(lines, i)
    if (i >= lines.length || indentOf(lines[i]) !== indent) break
    const body = lines[i].slice(indent)
    if (!ITEM.test(body)) break
    const rest = body.replace(ITEM, "")
    if (rest === "") {
      const [value, next] = parseNode(lines, i + 1, indent + 1)
      out.push(value)
      i = next
      continue
    }
    if (KEY.test(rest)) {
      // An inline first key: re-present the line at the item's own indentation
      // so the map parser sees a normal block map. Index arithmetic holds
      // because entry 0 of the view stands for line i.
      const itemIndent = indent + (body.length - rest.length)
      const view = [" ".repeat(itemIndent) + rest, ...lines.slice(i + 1)]
      const [value, consumed] = parseMap(view, 0, itemIndent)
      out.push(value)
      i += consumed
      continue
    }
    out.push(parseScalar(rest))
    i += 1
  }
  return [out, i]
}

function parseMap(lines, start, indent) {
  const out = {}
  let i = start
  for (;;) {
    i = skip(lines, i)
    if (i >= lines.length || indentOf(lines[i]) !== indent) break
    const body = lines[i].slice(indent)
    const match = body.match(KEY)
    if (!match) break
    const key = match[1].trim()
    if (Object.hasOwn(out, key)) throw new YamlError(`duplicate key "${key}"`, i)
    const inline = match[2] === undefined ? "" : match[2].trim()
    if (inline === "|" || inline === "|-") {
      const [value, next] = readBlockScalar(lines, i + 1, indent, inline === "|-" ? "strip" : "clip")
      out[key] = value
      i = next
      continue
    }
    if (inline === "") {
      const [value, next] = parseNode(lines, i + 1, indent + 1)
      out[key] = value
      i = next
      continue
    }
    out[key] = parseScalar(inline)
    i += 1
  }
  return [out, i]
}

/** Parse one YAML document in the issue-form subset described above. */
export function parseYaml(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n")
  const [value, next] = parseNode(lines, 0, 0)
  const tail = skip(lines, next)
  if (tail < lines.length) throw new YamlError(`unparsed trailing content: ${lines[tail].slice(0, 40)}`, tail)
  return value
}
