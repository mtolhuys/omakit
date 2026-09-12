// The wordmark, and the one place decoration is allowed.
//
// It is drawn on the front door only: `omakit`, `omakit help`, `omakit doctor`
// and `omakit setup`. Never in `submit`, `watch` or `verify` output, because
// that output gets pasted into issues and read by agents, and a banner there
// costs a reader lines and costs a submission credibility.
//
// Two more gates. It draws only when stdout is a terminal, so `omakit help |
// less` and `omakit help --agent` stay plain text. And OMAKIT_NO_BANNER turns
// it off for a person who wants none of it. NO_COLOR does what it says and no
// more: the wordmark is still drawn, in the terminal's own foreground, because
// a person who turned colour off did not ask for a different program. The
// same words arrive either way; a piped run gets them without the wordmark.
//
// Every front-door command animates it, and the animation is on a budget: the
// whole scan is MOTION.bannerBudgetMs, about a quarter of a second, so the
// first line of help is on the screen before a person has finished looking at
// the wordmark. The first version of this took 1.4 seconds, which is long
// enough to be in the way of someone who only wanted to read the flags. The
// schedule below is derived from the budget rather than from taste, so the
// wordmark can grow a letter without the scan growing a delay.
//
// How `oma` and `kit` are told apart, and why it is not by colour.
//
// The measured problem: on Omarchy's Matte Black theme every ANSI hue resolves
// to nearly the same grey, so a wordmark whose two halves differ in tint
// renders as one flat word, and bold does not rescue it, because a block glyph
// has no stroke for a bold face to thicken and most terminals no longer
// brighten bold text. What a monochrome terminal does still draw is ink. So
// the two halves differ in density: `oma`, the ecosystem's prefix, is drawn in
// the dark shade (▓), and `kit`, this tool's own name, in the full block (█).
// The prefix recedes into texture and the name stands solid, on any theme, and
// under NO_COLOR, where there is no escape sequence at all. The tint is still
// applied on top when colour is on, cyan on the prefix and the foreground on
// the name, so a colour theme gets both cues and a monochrome one gets the one
// it can show.
//
// The trade-off is the shade glyph itself: ▓ is a pattern, and a pattern only
// reads as a letter when adjacent cells tile without a seam. Every monospace
// font ships it as a tiling glyph, and docs/media/render.py measures the
// rendered wordmark and refuses to produce a GIF in which the shaded rows do
// not join.
//
// The animation is the tool's own motif rather than an ornament: the same
// scanner that sweeps the progress line during a baseline run sweeps across the
// name. Nothing here imitates anyone else's logo, character or product; the
// letters come from the small font below, so renaming the tool is a change to
// one string and not a redrawing job.

import { code, colourEnabled, DENSITY, motionEnabled, MOTION, rule as floorRule } from "./style.mjs"
import { effectAvailable, playEffect } from "./effect.mjs"

const ESC = "\u001b["
const RESET = `${ESC}0m`
// The tints, applied only when colour is on. The head of the scanner is the
// one bright thing, the typeable role's tint in bold, the same tint the progress
// line's head moves; the prefix takes that tint too; the name keeps the
// terminal's foreground.
const TINT = Object.freeze({
  head: `${ESC}${code("typeable.bold")}m`,
  prefix: `${ESC}${code("typeable")}m`,
  suffix: `${ESC}${code("prose")}m`,
})

// A five-row pixel font, "#" lit and " " blank, one blank column between
// letters. Only the letters the name needs are defined; adding one is adding one
// entry of five equal-length strings.
export const GLYPHS = Object.freeze({
  a: [" ## ", "#  #", "####", "#  #", "#  #"],
  c: [" ###", "#   ", "#   ", "#   ", " ###"],
  // Three wide with bars, not a single stroke: a one-column i is ambiguous next
  // to a k, and the wordmark reads as capitals anyway.
  i: ["###", " # ", " # ", " # ", "###"],
  k: ["#  #", "# # ", "##  ", "# # ", "#  #"],
  m: ["#   #", "## ##", "# # #", "#   #", "#   #"],
  n: ["#  #", "## #", "# ##", "#  #", "#  #"],
  o: [" ## ", "#  #", "#  #", "#  #", " ## "],
  s: [" ###", "#   ", " ## ", "   #", "### "],
  t: ["###", " # ", " # ", " # ", " # "],
})

export const GLYPH_ROWS = 5

/** How many leading letters are the prefix: drawn in the shade, and tinted cyan when colour is on. */
export const PREFIX_LETTERS = 3

/** The two densities: the prefix is texture, the name is solid. */
export const INK = Object.freeze({ prefix: DENSITY.dark, suffix: DENSITY.full, head: DENSITY.full })

/**
 * Lay a word out as five rows plus the column span of each letter.
 * Throws on a letter the font does not have, rather than dropping it silently.
 */
export function wordmarkLayout(word) {
  const letters = [...String(word).toLowerCase()]
  const missing = letters.filter((letter) => !GLYPHS[letter])
  if (missing.length) {
    throw new Error(`banner: no glyph for ${[...new Set(missing)].join(", ")}; add it to GLYPHS`)
  }
  const rows = []
  for (let row = 0; row < GLYPH_ROWS; row += 1) {
    rows.push(letters.map((letter) => GLYPHS[letter][row]).join(" "))
  }
  const spans = []
  let column = 0
  for (const [index, letter] of letters.entries()) {
    const width = GLYPHS[letter][0].length
    spans.push({ letter, index, from: column, to: column + width - 1 })
    column += width + 1
  }
  return { rows, spans, width: rows[0].length }
}

/** Kept for the simple case: just the five rows. */
export function wordmarkRows(word) {
  return wordmarkLayout(word).rows
}

/**
 * The whole animation, in milliseconds, stated once in style.mjs beside every
 * other budget. Not a taste parameter: `help` exists to put text on the
 * screen, so the scan has to be over before it is in the way. A quarter of a
 * second is about one glance.
 */
export const BUDGET_MS = MOTION.bannerBudgetMs

// How many columns the head jumps per frame. Two for the reveal keeps the sweep
// continuous, because the head is two columns wide; three for the return pass
// is a highlight travelling over letters that are already drawn, where a gap
// costs nothing.
const REVEAL_STRIDE = 2
const SHINE_STRIDE = 3

/**
 * Frames are spaced to fit the budget, not the other way round, so a longer
 * name means a quicker step rather than a longer wait.
 *
 * @param {number} width
 * @param {number} [budget]
 */
export function schedule(width, budget = BUDGET_MS) {
  const stride = REVEAL_STRIDE
  const shineStride = SHINE_STRIDE
  const frames = Math.floor(width / stride) + 1 + Math.ceil(width / shineStride) + 1
  const delay = Math.max(4, Math.floor(budget / frames))
  return { stride, shineStride, delay, frames, total: frames * delay }
}

/**
 * Is there room on screen for the wordmark and the text that follows it?
 *
 * The scan is only worth running when the answer is yes. A terminal that has to
 * scroll takes the wordmark off the top of the screen the moment the next lines
 * arrive, so animating into it spends a quarter of a second on something nobody
 * ever sees, and a redraw that races a scroll is what strands a row of an
 * earlier frame above the letters.
 *
 * @param {string} following the text that will be printed under the wordmark
 * @param {{ rows?: number }} [stream]
 */
export function fitsOnScreen(following, stream = process.stdout) {
  const rows = Number.isFinite(stream?.rows) && stream.rows > 0 ? stream.rows : 0
  if (!rows) return false
  // The five glyph rows, the rule, the tagline, the blank line after it, and
  // the prompt line that was already on screen before any of this.
  return rows >= GLYPH_ROWS + 4 + String(following).split("\n").length
}

export function bannerEnabled(stream = process.stdout, env = process.env) {
  if (env.OMAKIT_NO_BANNER) return false
  return motionEnabled(stream, env)
}

function isPrefix(spans, column) {
  const span = spans.find((entry) => column >= entry.from && column <= entry.to)
  return Boolean(span) && span.index < PREFIX_LETTERS
}

/**
 * One frame of the scan.
 *
 * `band` is where the bright head sits. `revealed` is how far the wordmark has
 * been drawn at all; columns beyond it are blank. The reveal pass moves both
 * together; the shine pass afterwards moves the band across a wordmark that is
 * already complete.
 *
 * With `colour` off no escape is written at all: the head is a full block over
 * the shaded prefix, which is still visible as a change in density, and over
 * the solid name it is simply the name.
 */
export function frame(layout, band, revealed = band, { colour = true } = {}) {
  const { rows, spans, width } = layout
  return rows.map((row) => {
    let out = ""
    let tint = ""
    for (let column = 0; column < width; column += 1) {
      // Unrevealed columns, and blanks inside revealed ones, are plain spaces.
      // A colour code is only ever emitted for a block that is actually drawn,
      // so a frame carries no escape it does not use.
      const lit = column <= revealed && row[column] === "#"
      if (!lit) {
        if (tint) { out += RESET; tint = "" }
        out += " "
        continue
      }
      const atHead = column >= band - 1 && column <= band
      const prefix = isPrefix(spans, column)
      const wanted = colour ? (atHead ? TINT.head : prefix ? TINT.prefix : TINT.suffix) : ""
      if (tint !== wanted) { out += wanted; tint = wanted }
      out += atHead ? INK.head : prefix ? INK.prefix : INK.suffix
    }
    return tint ? out + RESET : out
  })
}

/**
 * @param {{ word?: string, tagline?: string, stream?: NodeJS.WriteStream,
 *           enabled?: boolean, animate?: boolean, shines?: number,
 *           effect?: boolean, env?: NodeJS.ProcessEnv }} [options]
 *   `effect: true` runs the wordmark through `ttfx` when it is there (see
 *   effect.mjs); `setup` passes it, nothing else does.
 */
export async function banner(options = {}) {
  const stream = options.stream || process.stdout
  const enabled = options.enabled ?? bannerEnabled(stream)
  const colour = options.colour ?? colourEnabled(stream)
  const word = options.word || "omakit"
  const layout = wordmarkLayout(word)
  const { width } = layout
  // The rule and the tagline sit under the wordmark and are still meant to be
  // read, so neither is dim: on a low-contrast theme grey-on-near-black is a
  // decoration nobody can see. The rule takes the prefix tint, the tagline the
  // foreground.
  const c = (name, text) => (colour ? `${ESC}${name}m${text}${RESET}` : text)
  const rule = floorRule((_name, text) => c(code("typeable"), text), { width })
  const tagline = options.tagline ? c(code("prose"), options.tagline) : null

  // Nothing at all when it is not a terminal. There is no plain-text substitute
  // to print: `help` and `setup` already say the name and what it does in words,
  // and a piped run should differ from a watched one only in decoration.
  if (!enabled) return

  // A five-row animation redrawn with cursor-up needs five rows that stay put.
  // In a terminal with no room the screen scrolls under the animation, the
  // cursor-up lands a line off, and a row from an earlier frame is left stranded
  // above the wordmark. Rather than animate into that, draw it at once.
  const rowsAvailable = Number.isFinite(stream.rows) ? stream.rows : Infinity
  const animate = options.animate !== false && rowsAvailable >= GLYPH_ROWS + 4

  const { stride, shineStride, delay } = schedule(width, options.budgetMs)
  const paint = (lines) => lines.map((line) => `${ESC}2K${line}`).join("\n")
  // A frame is written without a trailing newline, and the cursor walks back up
  // four rows and to column 0. That is not a detail: a newline written while the
  // cursor is on the last row of the screen scrolls the screen, so a frame that
  // ends in one scrolls once per frame when the prompt happens to sit at the
  // bottom, which it usually does. Twenty-six of those leave the partial frames
  // in the scrollback and a stray row of one of them directly above the
  // wordmark. Ending inside the block instead means the screen scrolls exactly
  // once, for the very first frame, before any cursor-up is issued.
  const redraw = (lines) => stream.write(`${paint(lines)}${ESC}${GLYPH_ROWS - 1}A\r`)
  const finish = (lines) => stream.write(`${paint(lines)}\n`)

  const draw = (band, revealed, tinted = colour) => frame(layout, band, revealed, { colour: tinted })

  // The text effect, where asked for and where `ttfx` is there. It draws the
  // plain glyphs, whose density split is in the characters, and leaves the
  // cursor hidden on the line under them; omakit walks back up over the five
  // rows and paints the finished wordmark in its own tints. Absent, the scan
  // below runs exactly as it would have, byte for byte.
  const env = options.env || process.env
  const played = animate && options.effect && effectAvailable(env)
    ? await playEffect(draw(-2, width + 2, false), stream, { env })
    : "absent"
  // The one return pass over the finished wordmark, the front door's shine,
  // on the scan's own schedule. Two looked better and cost twice the budget,
  // and the budget is the point.
  const step = async (band, revealed, delay) => {
    await new Promise((resolve) => setTimeout(resolve, delay))
    redraw(draw(band, revealed))
  }
  const shine = async () => {
    const shines = options.shines ?? 1
    for (let pass = 0; pass < shines; pass += 1) {
      const forward = pass % 2 === 1
      for (let step_ = 0; step_ <= Math.ceil(width / shineStride); step_ += 1) {
        const offset = step_ * shineStride
        await step(forward ? offset : width - offset, width + 2, delay)
      }
    }
  }

  if (played === "played") {
    // Back up over the effect's plain rows, paint the wordmark in omakit's
    // tints, and end it the way the front door ends: with the shine.
    stream.write(`${ESC}${GLYPH_ROWS}A`)
    redraw(draw(-2, width + 2))
    await shine()
    finish(draw(-2, width + 2))
    stream.write(`${ESC}?25h`)
  } else if (played === "broken") {
    // Something reached the screen and then the effect failed. The cursor is
    // somewhere inside the rows, so the honest thing is to leave what is
    // there, show the cursor, start a fresh line and draw the wordmark once.
    stream.write(`${ESC}?25h\n`)
    finish(draw(-2, width + 2))
  } else if (!animate) {
    finish(draw(-2, width + 2))
  } else {
    // Claim the five rows first, so whatever scrolling has to happen happens
    // here, before a single cursor-up is issued and while the geometry can
    // still shift harmlessly.
    redraw(draw(-2, -2))
    for (let band = 0; band <= width; band += stride) await step(band, band, delay)
    await shine()
    finish(draw(-2, width + 2))
  }
  stream.write(`${rule}\n`)
  if (tagline) stream.write(`${tagline}\n`)
  stream.write("\n")
}
