// The one text effect: `ttfx` over the wordmark, where it is drawn, and never a
// requirement. A fake `ttfx` on PATH makes every outcome deterministic; the
// real one, where it is installed, has its budget measured.
import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { banner, frame, GLYPH_ROWS, schedule, wordmarkLayout } from "../../tools/marketplace/banner.mjs"
import { effectAvailable, playEffect, TTFX_ARGS, TTFX_PROBE } from "../../tools/marketplace/effect.mjs"
import { code, MOTION, plain } from "../../tools/marketplace/style.mjs"
import { REPO_ROOT } from "./helpers.mjs"

const ESC = "\u001b["

/** A PATH with one `ttfx` on it, a shell script that behaves as `body` says. */
function fakeTtfx(body) {
  const dir = mkdtempSync(join(tmpdir(), "omakit-ttfx-"))
  writeFileSync(join(dir, "ttfx"), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "ttfx 0.0.0-fake"; exit 0; fi\n${body}\n`)
  chmodSync(join(dir, "ttfx"), 0o755)
  return { PATH: `${dir}:${process.env.PATH}`, HOME: process.env.HOME }
}

const NO_TTFX = { PATH: mkdtempSync(join(tmpdir(), "omakit-empty-path-")), HOME: process.env.HOME }

/** A stream that remembers, with the rows a terminal would have. */
function capture() {
  const chunks = []
  return {
    columns: 100,
    rows: 40,
    isTTY: true,
    write: (chunk) => { chunks.push(String(chunk)); return true },
    get text() { return chunks.join("") },
  }
}

const layout = wordmarkLayout("omakit")
const rows = frame(layout, -2, layout.width + 2, { colour: false })

test("without ttfx, the banner is byte for byte what it was", async () => {
  assert.equal(effectAvailable(NO_TTFX), false)
  const plainRun = capture()
  await banner({ stream: plainRun, tagline: "t", enabled: true, colour: true, env: NO_TTFX })
  const asked = capture()
  await banner({ stream: asked, tagline: "t", enabled: true, colour: true, effect: true, env: NO_TTFX })
  assert.equal(asked.text, plainRun.text)
  assert.ok(asked.text.includes(`${ESC}${GLYPH_ROWS - 1}A`), "the scan ran")
})

test("a played effect is relayed, then the wordmark is repainted in omakit's tints over it", async () => {
  // The fake draws what ttfx draws at the end: five rows and the cursor left
  // on the line under them, hidden.
  const env = fakeTtfx(`printf '${ESC}?25l'; sed 's/^/FX:/'`)
  assert.equal(effectAvailable(env), true)
  const relayed = capture()
  assert.equal(await playEffect(rows, relayed, { env }), "played")
  assert.equal(relayed.text, `${ESC}?25l${rows.map((row) => `FX:${row}`).join("\n")}\n`, "stdin in, stdout relayed, nothing else")

  const stream = capture()
  await banner({ stream, tagline: "t", enabled: true, colour: true, effect: true, env })
  const text = stream.text
  const effectEnd = text.indexOf(`FX:${rows[GLYPH_ROWS - 1]}\n`) + `FX:${rows[GLYPH_ROWS - 1]}\n`.length
  assert.ok(effectEnd > 0, "the effect's frames came first")
  assert.ok(text.slice(effectEnd).startsWith(`${ESC}${GLYPH_ROWS}A`), "then a walk back up over the five rows")
  assert.ok(text.includes(`${ESC}?25h`), "the cursor is shown again")
  assert.ok(text.includes(`${ESC}${code("typeable")}m`), "the prefix tint is omakit's own")
  assert.doesNotMatch(text, /\[38;[25];/, "no truecolor and no 256-colour anywhere")
  // What follows the walk up is the finished wordmark in omakit's tints, then
  // the scan's own shine pass over it, frame for frame, then
  // the finished wordmark, the rule and the tagline exactly as the scan paints
  // them, plus the one escape that shows the cursor again.
  const up = `${ESC}${GLYPH_ROWS - 1}A\r`
  const finished = frame(layout, -2, layout.width + 2, { colour: true }).map((row) => `${ESC}2K${row}`).join("\n")
  const control = capture()
  await banner({ stream: control, tagline: "t", enabled: true, colour: true, env: NO_TTFX })
  const frames = control.text.split(up)
  const { shineStride } = schedule(layout.width)
  const shineFrames = Math.ceil(layout.width / shineStride) + 1
  const shine = frames.slice(-1 - shineFrames, -1)
  const after = frames.at(-1).slice(`${finished}\n`.length)
  assert.equal(shine.length, shineFrames)
  assert.notEqual(shine[0], finished, "the shine starts with the head on the wordmark")
  assert.equal(text.slice(effectEnd), `${ESC}${GLYPH_ROWS}A${finished}${up}${shine.join(up)}${up}${finished}\n${ESC}?25h${after}`)
})

test("a ttfx that fails, hangs or prints nothing never leaves the tool worse than without it", async () => {
  // Prints nothing and fails: as if absent.
  assert.equal(await playEffect(rows, capture(), { env: fakeTtfx("exit 3") }), "absent")
  // Prints something and then fails: the screen is touched, and the banner
  // shows the cursor, starts a fresh line and draws the wordmark once.
  const broken = fakeTtfx("echo partial; exit 3")
  assert.equal(await playEffect(rows, capture(), { env: broken }), "broken")
  const stream = capture()
  await banner({ stream, tagline: "t", enabled: true, colour: true, effect: true, env: broken })
  assert.ok(stream.text.startsWith(`partial\n${ESC}?25h\n`), stream.text)
  assert.ok(!stream.text.includes(`${ESC}${GLYPH_ROWS}A`), "no walk back up over rows that are not there")
  // Hangs: killed at the budget, reported as what reached the screen.
  const hung = fakeTtfx("echo started; sleep 30")
  const started = Date.now()
  assert.equal(await playEffect(rows, capture(), { env: hung, budgetMs: 150 }), "broken")
  assert.ok(Date.now() - started < 2000, "the budget is a hard stop")
  assert.equal(await playEffect(rows, capture(), { env: fakeTtfx("sleep 30"), budgetMs: 150 }), "absent")
})

test("the effect is asked for where the wordmark is drawn, and by nothing else", () => {
  const askers = []
  for (const path of readdirSync(join(REPO_ROOT, "tools/marketplace"))) {
    if (!path.endsWith(".mjs")) continue
    const text = readFileSync(join(REPO_ROOT, "tools/marketplace", path), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    if (/\beffect:\s*true\b/.test(text)) askers.push(path)
  }
  assert.deepEqual(askers.sort(), ["cli.mjs", "setup.mjs"])
})

test("with the real ttfx, the pinned effect finishes inside its stated budget", async (t) => {
  if (!effectAvailable()) {
    t.skip("ttfx is not installed here")
    return
  }
  const version = spawnSync("ttfx", [...TTFX_PROBE], { encoding: "utf8" }).stdout.trim()
  const stream = capture()
  const started = Date.now()
  const outcome = await playEffect(rows, stream)
  const took = Date.now() - started
  t.diagnostic(`${version}: ${TTFX_ARGS.join(" ")} took ${took}ms, budget ${MOTION.effectBudgetMs}ms`)
  assert.equal(outcome, "played")
  assert.ok(took < MOTION.effectBudgetMs, `${took}ms is over the ${MOTION.effectBudgetMs}ms budget`)
  assert.doesNotMatch(stream.text, /\[[0-9;]*m/, "with --no-color ttfx paints nothing")
  assert.ok(stream.text.endsWith(`${rows[GLYPH_ROWS - 1]}\n`), "it ends on the finished rows with the cursor under them")
})
