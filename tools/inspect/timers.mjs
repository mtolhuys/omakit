// Timer sites: every `Timer {` block in QML with its interval, whether it
// repeats, whether it runs from the start, whether it fires on start, and
// the handler outside the block that starts it. An interval that is an
// expression is recorded as not resolvable with the expression text, never
// as a number.

import { blankComments, blocks, closingBracket, lineOf, propertyValue } from "./text.mjs"

function flag(body, name) {
  const value = propertyValue(body, name)?.text
  if (value === undefined) return false
  if (value === "true") return true
  if (value === "false") return false
  return null
}

/** The handler a `<id>.start()`, `.restart()` or `.running = true` sits in, by the nearest enclosing `onSomething:` or `function name(` above it. */
function startedBy(text, id, exclude) {
  if (!id) return null
  const pattern = new RegExp(`(?<![\\w.])${id}\\.(?:start\\s*\\(|restart\\s*\\(|running\\s*=\\s*true)`, "g")
  for (const match of text.matchAll(pattern)) {
    if (match.index >= exclude.start && match.index <= exclude.end) continue
    const before = text.slice(0, match.index)
    const handlers = [...before.matchAll(/(?<![\w.])(on[A-Z]\w*)\s*:|(?<![\w.])function\s+(\w+)\s*\(/g)]
    for (let index = handlers.length - 1; index >= 0; index -= 1) {
      const handler = handlers[index]
      // The handler encloses the call when its value block has not closed before the call.
      const colon = handler.index + handler[0].length
      const rest = text.slice(colon).replace(/^\s+/, "")
      const at = colon + (text.length - colon - rest.length)
      const end = text[at] === "{" ? closingBracket(text, at) : text.indexOf("\n", at)
      if (end >= match.index) return handler[1] || handler[2]
    }
    return "script"
  }
  return null
}

/**
 * @param {{ path: string, kind: string, text: string }} file
 * @returns {{ timers: Array, notResolvable: Array }}
 */
export function extractTimers(file) {
  if (file.kind !== "qml") return { timers: [], notResolvable: [] }
  const text = blankComments(file.text)
  const timers = []
  const notResolvable = []
  for (const block of blocks(text, "Timer")) {
    const interval = propertyValue(block.body, "interval")?.text ?? null
    const intervalMs = interval !== null && /^\d+$/.test(interval) ? Number(interval) : null
    if (interval !== null && intervalMs === null) notResolvable.push({ file: file.path, line: lineOf(text, block.open + 1 + propertyValue(block.body, "interval").offset), kind: "timer-interval", text: interval })
    timers.push({
      file: file.path,
      line: block.line,
      id: block.id,
      intervalMs,
      intervalText: intervalMs === null ? interval : null,
      repeat: flag(block.body, "repeat"),
      running: flag(block.body, "running"),
      triggeredOnStart: flag(block.body, "triggeredOnStart"),
      startedBy: startedBy(text, block.id, block),
    })
  }
  return { timers, notResolvable }
}
