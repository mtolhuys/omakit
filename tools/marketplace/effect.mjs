// The one text effect: the wordmark through `ttfx`, where the wordmark is
// drawn (a bare `omakit` and `omakit setup`), and only into a terminal.
//
// `ttfx` (github.com/omacom/ttfx) is the Rust port of TerminalTextEffects that
// Omarchy's own screensaver draws with, so its vocabulary reads as native
// here. It is an enhancement and never a requirement: absent, unexecutable or
// over budget, the wordmark looks exactly as it does without it, and the probe is a
// spawn that fails silently, the way the `gh` credential lookup does.
//
// Colour stays omakit's. Measured before this was decided, the wordmark with
// omakit's palette escapes piped through `ttfx` in each of its
// `--existing-color-handling` modes: `ignore` paints its own truecolor
// gradient, `always` and `dynamic` honour the input tint but re-encode palette
// index 36 as the fixed truecolor 0;128;128 and drop 39, so the Omarchy theme
// no longer decides what cyan is. `--xterm-colors` is the same in 256-colour,
// which this repository bans just the same. So the effect runs with
// `--no-color`, over the glyphs alone, whose density split survives because it
// is carried by the characters, and omakit repaints the finished wordmark in
// its own tints when the effect is over.
//
// The arguments are frozen and asserted by tests/unit/read-only.test.mjs:
// stdin only, no input file, no path, one pinned effect, one seed, so the
// recorded setup.gif is reproducible.

import { spawn, spawnSync } from "node:child_process"
import { MOTION } from "./style.mjs"

export const TTFX = "ttfx"

/** The probe: does `ttfx` start and say its name. */
export const TTFX_PROBE = Object.freeze(["--version"])

/**
 * The effect. `--no-restore-cursor` leaves the cursor where an ordinary
 * program would, on the line under the wordmark, which is where the repaint
 * starts from; measured, the default leaves it on the wordmark's last row.
 */
export const TTFX_ARGS = Object.freeze([
  "--no-color",
  "--no-restore-cursor",
  "--seed", "1",
  "--frame-rate", String(MOTION.effectFrameRate),
  "expand",
])

/** Milliseconds a probe may take: `ttfx` starts in half a millisecond, so this is generous. */
const PROBE_MS = 200

/**
 * Whether `ttfx` is on PATH and runs. A spawn that fails for any reason is
 * "no", silently.
 *
 * @param {NodeJS.ProcessEnv} [env]
 */
export function effectAvailable(env = process.env) {
  try {
    const probe = spawnSync(TTFX, [...TTFX_PROBE], { encoding: "utf8", env, timeout: PROBE_MS, stdio: ["ignore", "pipe", "ignore"] })
    return probe.status === 0 && /^ttfx \d/.test(probe.stdout)
  } catch {
    return false
  }
}

/**
 * Run the effect over `rows`, relaying its frames to `stream` as they come.
 * Resolves to what happened, so the caller knows what is on the screen:
 *
 * - "played": exit 0 inside the budget; the cursor is on the line under the
 *   rows, hidden, and the rows are drawn plain
 * - "absent": nothing reached the screen; draw as if `ttfx` were not there
 * - "broken": something reached the screen and then it failed or ran out of
 *   budget; the cursor is somewhere inside the rows
 *
 * @param {string[]} rows
 * @param {{ write: (chunk: string|Buffer) => unknown }} stream
 * @param {{ budgetMs?: number, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<"played"|"absent"|"broken">}
 */
export function playEffect(rows, stream, { budgetMs = MOTION.effectBudgetMs, env = process.env } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(TTFX, [...TTFX_ARGS], { env, stdio: ["pipe", "pipe", "ignore"] })
    } catch {
      resolve("absent")
      return
    }
    let written = 0
    let settled = false
    let overBudget = false
    const settle = (outcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(outcome)
    }
    // Over budget the process is killed and the promise settles when it has
    // exited, not when its pipe closes: a child it left behind could hold the
    // pipe open. In budget it settles on `close`, after the last relayed
    // chunk, so the caller never repaints under a late frame.
    const timer = setTimeout(() => {
      overBudget = true
      child.once("exit", () => settle(written ? "broken" : "absent"))
      child.kill("SIGKILL")
    }, budgetMs)
    child.on("error", () => settle(written ? "broken" : "absent"))
    child.stdin.on("error", () => {})
    child.stdout.on("data", (chunk) => {
      written += chunk.length
      stream.write(chunk)
    })
    child.on("close", (code) => settle(code === 0 && !overBudget && written ? "played" : written ? "broken" : "absent"))
    child.stdin.end(`${rows.join("\n")}\n`)
  })
}
