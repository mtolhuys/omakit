// The progress line must be invisible to everything except a person's terminal.
import test from "node:test"
import assert from "node:assert/strict"
import { progress, progressEnabled, headAt } from "../../tools/marketplace/progress.mjs"

test("it draws only for a terminal, and never when asked not to", () => {
  assert.equal(progressEnabled({ isTTY: true }, {}), true)
  assert.equal(progressEnabled({ isTTY: false }, {}), false)
  assert.equal(progressEnabled({ isTTY: true }, { TERM: "dumb" }), false)
  assert.equal(progressEnabled({ isTTY: true }, { OMAKIT_NO_PROGRESS: "1" }), false)
  // NO_COLOR is about colour: the line still says what is happening, untinted.
  assert.equal(progressEnabled({ isTTY: true }, { NO_COLOR: "1" }), true)
})

test("without colour it still says what is happening, with no escape but the clear", () => {
  const written = []
  const p = progress({ stream: { isTTY: true, write: (s) => written.push(s) }, enabled: true, colour: false })
  p.phase("reading the installable tree")
  p.done()
  const frames = written.filter((frame) => frame.includes("█"))
  assert.ok(frames.length >= 1)
  for (const frame of frames) {
    assert.doesNotMatch(frame, /\u001b\[[0-9;]*m/, "no SGR")
    assert.ok(frame.includes("reading the installable tree"))
  }
})

test("disabled means it writes nothing at all, not even a clear", () => {
  const written = []
  const p = progress({ stream: { isTTY: false, write: (s) => written.push(s) }, enabled: false })
  p.phase("something")
  p.done()
  assert.deepEqual(written, [])
})

test("the head bounces between the ends instead of wrapping", () => {
  const positions = Array.from({ length: 19 }, (_, step) => headAt(step))
  assert.deepEqual(positions, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0])
  for (const step of [-1, 0, 1, 1000, 12345]) {
    const at = headAt(step)
    assert.ok(at >= 0 && at <= 9, `head at ${at} for step ${step} is off the track`)
  }
})

test("every frame is one line, cleared before it is redrawn, and carries the label", async () => {
  const written = []
  const p = progress({ stream: { isTTY: true, write: (s) => written.push(s) }, enabled: true })
  p.phase("reading the installable tree")
  await new Promise((resolve) => setTimeout(resolve, 250))
  p.done()

  const frames = written.filter((frame) => frame.includes("█"))
  assert.ok(frames.length >= 2, "it should have animated")
  for (const frame of frames) {
    assert.ok(frame.startsWith("\r\u001b[2K"), "each frame clears the line first")
    assert.ok(!frame.slice(3).includes("\n"), "a frame never emits a newline")
    assert.ok(frame.includes("reading the installable tree"), "the label says what is happening")
    const cells = frame.replace(/\u001b\[[0-9;]*m/g, "").replace(/^\r/, "").slice(0, 12)
    assert.equal(cells.length, 12)
    assert.equal([...cells].filter((cell) => cell === "█").length, 3)
  }
  assert.equal(written.at(-1), "\r\u001b[2K", "done() leaves the line empty")
})

test("a label never wraps: it is cut to the terminal's width", () => {
  // Measured: the pin fetch labelled itself with a repository URL and an
  // absolute path, 150 columns on a 100-column pty, and the wrapped tail was
  // left behind as a stray row because the clear only reaches one line.
  const written = []
  const p = progress({ stream: { isTTY: true, columns: 40, write: (s) => written.push(s) }, enabled: true, colour: false })
  p.phase("x".repeat(200))
  p.done()
  const frame = written.find((entry) => entry.includes("█")).replace(/^\r\u001b\[2K/, "")
  assert.ok(frame.length <= 40, `${frame.length} columns on a 40-column terminal`)
  assert.ok(frame.endsWith("\u2026"), "and says it was cut")
})
