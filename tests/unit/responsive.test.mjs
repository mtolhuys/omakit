import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { COLUMNS, MAX_COLUMNS, outputColumns, withOutputStream, wrap, section, plain, styler, width, overflows } from "../../tools/marketplace/style.mjs"
import { renderUsage, renderSummary } from "../../tools/marketplace/usage.mjs"
import { head, renderDoctor } from "../../tools/marketplace/report.mjs"
import { banner } from "../../tools/marketplace/banner.mjs"
import { REPO_ROOT } from "./helpers.mjs"

const words = (text) => plain(text).replace(/\s+/g, " ").trim()
const fits = (text, columns) => {
  // Exact paths, URLs and commit IDs cannot be broken to fit a tiny terminal.
  for (const line of plain(text).split("\n")) assert.ok(!overflows(line, columns), `${width(line)} > ${columns}: ${line}`)
}

test("width follows a terminal's current columns, caps wide prose and keeps pipes deterministic", () => {
  for (const columns of [20, 40, 60, 80, 100, 120, 160]) assert.equal(outputColumns({ isTTY: true, columns }), Math.min(columns, MAX_COLUMNS))
  for (const columns of [undefined, null, 0, -1, Infinity, NaN]) assert.equal(outputColumns({ isTTY: true, columns }), COLUMNS)
  assert.equal(outputColumns({ isTTY: false, columns: 160 }), COLUMNS)
  const stream = { isTTY: true, columns: 40 }
  withOutputStream(stream, () => {
    assert.equal(section("title", styler(false))[1].length, 40)
    stream.columns = 100
    assert.equal(section("title", styler(false))[1].length, 100)
    withOutputStream({ isTTY: false, columns: 160 }, () => assert.equal(outputColumns(), COLUMNS))
    assert.equal(outputColumns(), 100)
  })
  assert.equal(outputColumns(), COLUMNS)
  assert.throws(() => withOutputStream(stream, () => { throw new Error("fixture") }), /fixture/)
  assert.equal(outputColumns(), COLUMNS, "failed composition restores the destination")
})

test("help reflows paragraphs and signatures without losing syntax or changing words", () => {
  const stable = renderUsage({ stream: { isTTY: false, columns: 160 }, colour: false })
  let narrowLines
  for (const columns of [40, 60, 80, 100, 120, 160]) {
    const stream = { isTTY: true, columns }
    const off = renderUsage({ stream, colour: false })
    const on = renderUsage({ stream, colour: true })
    fits(off, Math.min(columns, MAX_COLUMNS))
    assert.equal(words(off), words(stable))
    assert.equal(plain(on), off)
    if (columns === 40) narrowLines = off.split("\n").length
    if (columns === 120) {
      assert.ok(off.split("\n").length < narrowLines)
      assert.ok(off.split("\n").some((line) => width(line) > COLUMNS), "wide terminals use space beyond eighty columns")
    }
    const summary = renderSummary({ stream, colour: false })
    fits(summary, Math.min(columns, MAX_COLUMNS))
    assert.equal(words(summary), words(renderSummary({ stream: { isTTY: false }, colour: false })))
  }
  assert.equal(renderUsage({ stream: { isTTY: false, columns: 40 }, colour: false }), stable)
})

test("reports share responsive wrapping and narrow check headers put the source on another line", () => {
  const report = { problems: 0, checks: [{ id: "fixture.check", state: "ok", detail: "A paragraph explaining the result and its evidence. ".repeat(5) }] }
  let narrow
  for (const columns of [40, 80, 120]) withOutputStream({ isTTY: true, columns }, () => {
    const text = renderDoctor(report, { colour: false })
    fits(text, columns)
    if (columns === 40) narrow = text.split("\n").length
    if (columns === 120) assert.ok(text.split("\n").length < narrow)
    const heading = head("pass", "fixture.long-check", "marketplace-pin", styler(false))
    fits(heading, columns)
    assert.equal(heading.includes("\n"), columns === 40)
  })
  withOutputStream({ isTTY: true, columns: 20 }, () => assert.match(wrap("open `https://example.com/long/path`", {})[1], /https:\/\/example\.com\/long\/path/, "exact URLs remain intact"))
})

test("a terminal narrower than the artwork gets a compact banner without cursor animation", async () => {
  const output = []
  await banner({ stream: { isTTY: true, columns: 20, rows: 40, write: (text) => output.push(text) }, enabled: true, colour: false, tagline: "the safe place to find out" })
  const text = output.join("")
  assert.match(text, /^OMAKIT\n/)
  fits(text, 20)
  assert.doesNotMatch(text, /\u001b|\u2588|\u2593/)
})

test("the actual help command respects a real pseudo-terminal's narrow and wide sizes", (t) => {
  const probe = spawnSync("script", ["--version"], { timeout: 120_000, encoding: "utf8" })
  if (!probe.stdout?.includes("util-linux")) return t.skip("util-linux script(1) is not installed here")
  const state = mkdtempSync(join(tmpdir(), "omakit-responsive-pty-"))
  const quote = (value) => `'${value.replace(/'/g, `'\\''`)}'`
  try {
    for (const columns of [40, 120]) {
      const command = `stty cols ${columns} rows 100 && exec ${quote(process.execPath)} ${quote(join(REPO_ROOT, "bin/omakit"))} help`
      const result = spawnSync("script", ["-qec", command, "/dev/null"], { encoding: "utf8", timeout: 10000, env: { ...process.env, NO_COLOR: "1", TERM: "xterm", CI: "true", XDG_STATE_HOME: state, XDG_DATA_HOME: join(state, "share"), XDG_CONFIG_HOME: join(state, "config") } })
      assert.equal(result.status, 0, result.stderr)
      const text = result.stdout.replace(/\r/g, "")
      fits(text, columns)
      assert.equal(words(text), words(renderUsage({ stream: { isTTY: false }, colour: false })))
      if (columns === 120) assert.ok(text.split("\n").some((line) => width(line) > COLUMNS))
    }
  } finally { rmSync(state, { recursive: true, force: true }) }
})

test("from a wide terminal, --out writes the document --json prints and the report keeps the stable plain pipe layout", (t) => {
  const probe = spawnSync("script", ["--version"], { timeout: 120_000, encoding: "utf8" })
  if (!probe.stdout?.includes("util-linux")) return t.skip("util-linux script(1) is not installed here")
  const state = mkdtempSync(join(tmpdir(), "omakit-responsive-file-"))
  const quote = (value) => `'${value.replace(/'/g, `'\\''`)}'`
  const env = { ...process.env, CI: "true", TERM: "xterm", XDG_STATE_HOME: state, XDG_DATA_HOME: join(state, "share"), XDG_CONFIG_HOME: join(state, "config") }
  try {
    const entry = join(REPO_ROOT, "bin/omakit")
    const file = join(state, "doctor.txt")
    const piped = spawnSync(process.execPath, [entry, "doctor", "--offline"], { encoding: "utf8", timeout: 10000, env: { ...env, NO_COLOR: "1", FORCE_COLOR: "" } })
    assert.notEqual(piped.status, null, piped.stderr)
    const json = spawnSync(process.execPath, [entry, "doctor", "--offline", "--json"], { encoding: "utf8", timeout: 10000, env: { ...env, NO_COLOR: "1", FORCE_COLOR: "" } })
    const coloredEnv = { ...env, FORCE_COLOR: "1" }
    delete coloredEnv.NO_COLOR
    const command = `stty cols 120 rows 100 && exec ${quote(process.execPath)} ${quote(entry)} doctor --offline --out ${quote(file)}`
    const result = spawnSync("script", ["-qec", command, "/dev/null"], { encoding: "utf8", timeout: 10000, env: coloredEnv })
    assert.equal(result.status, piped.status, result.stderr)
    // --out is the document, the same --json prints on a pipe, whatever the terminal's width.
    const text = readFileSync(file, "utf8")
    assert.doesNotMatch(text, /\u001b/)
    assert.equal(text, json.stdout)
    // The report on the wide terminal is the piped report, plus the line that says where the file went.
    const shown = words(result.stdout)
    assert.ok(shown.includes(words(piped.stdout)), "the report on the wide terminal says the pipe's words")
    assert.match(shown, /wrote /)
    fits(piped.stdout, COLUMNS)
  } finally { rmSync(state, { recursive: true, force: true }) }
})
