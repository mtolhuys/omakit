// The wordmark, and the one place decoration is allowed.
//
// It is drawn on the front door only: `omakit`, `omakit help` and `omakit setup`.
// Never in `submit`, `watch` or `verify` output, because that output gets pasted
// into issues and read by agents, and a banner there costs a reader lines and
// costs a submission credibility.
//
// Two more gates. It draws only when stdout is a terminal, so `omakit help |
// less` and `omakit help --agent` stay plain text. And it respects NO_COLOR and
// a dumb TERM like everything else here.
//
// Only `omakit setup` animates it. `help` and `doctor` draw the finished
// wordmark at once, because the scan takes about 1.4 seconds and both of those
// commands exist to put text on the screen now.
//
// `oma` and `kit` are tinted differently on purpose: the prefix is the
// ecosystem's, the suffix is this tool's. Both tints are ANSI palette entries,
// so an Omarchy theme decides what they actually look like.
//
// The animation is the tool's own motif rather than an ornament: the same
// scanner that sweeps the progress line during a baseline run sweeps across the
// name. Nothing here imitates anyone else's logo, character or product; the
// letters come from the small font below, so renaming the tool is a change to
// one string and not a redrawing job.

const ESC = "\u001b["
const RESET = `${ESC}0m`
const HEAD = `${ESC}96m`
const PREFIX = `${ESC}36m`
const SUFFIX = `${ESC}39m`
const FLOOR = `${ESC}90m`

const BLOCK = "\u2588"
const RULE = "\u2581"

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

/** How many leading letters take the prefix tint. */
export const PREFIX_LETTERS = 3

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

export function bannerEnabled(stream = process.stdout, env = process.env) {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false
  if (env.TERM === "dumb") return false
  if (env.OMAKIT_NO_BANNER) return false
  return Boolean(stream && stream.isTTY)
}

function tintFor(spans, column) {
  const span = spans.find((entry) => column >= entry.from && column <= entry.to)
  if (!span) return SUFFIX
  return span.index < PREFIX_LETTERS ? PREFIX : SUFFIX
}

/**
 * One frame of the scan.
 *
 * `band` is where the bright head sits. `revealed` is how far the wordmark has
 * been drawn at all; columns beyond it are blank. The reveal pass moves both
 * together; the shine pass afterwards moves the band across a wordmark that is
 * already complete.
 */
export function frame(layout, band, revealed = band) {
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
      const wanted = column >= band - 1 && column <= band ? HEAD : tintFor(spans, column)
      if (tint !== wanted) { out += wanted; tint = wanted }
      out += BLOCK
    }
    return tint ? out + RESET : out
  })
}

/**
 * @param {{ word?: string, tagline?: string, stream?: NodeJS.WriteStream,
 *           enabled?: boolean, animate?: boolean, shines?: number }} [options]
 */
export async function banner(options = {}) {
  const stream = options.stream || process.stdout
  const enabled = options.enabled ?? bannerEnabled(stream)
  const word = options.word || "omakit"
  const layout = wordmarkLayout(word)
  const { width } = layout
  const rule = FLOOR + RULE.repeat(width) + RESET
  const tagline = options.tagline ? `${FLOOR}${options.tagline}${RESET}` : null

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

  const paint = (lines) => lines.map((line) => `${ESC}2K${line}`)
  const write = (lines) => stream.write(`${paint(lines).join("\n")}\n`)
  const up = () => stream.write(`${ESC}${GLYPH_ROWS}A`)

  if (!animate) {
    write(frame(layout, -2, width + 2))
  } else {
    // Claim the five rows first, so any scrolling happens before a single
    // cursor-up is issued and the geometry cannot shift mid-animation.
    write(frame(layout, -2, -2))
    up()
    const step = async (band, revealed, delay) => {
      write(frame(layout, band, revealed))
      await new Promise((resolve) => setTimeout(resolve, delay))
      up()
    }
    for (let band = 0; band <= width; band += 1) await step(band, band, 22)
    const shines = options.shines ?? 2
    for (let pass = 0; pass < shines; pass += 1) {
      const from = pass % 2 === 0 ? width : 0
      const to = pass % 2 === 0 ? 0 : width
      const direction = from > to ? -1 : 1
      for (let band = from; band !== to + direction; band += direction) {
        await step(band, width + 2, 14)
      }
    }
    write(frame(layout, -2, width + 2))
  }
  stream.write(`${rule}\n`)
  if (tagline) stream.write(`${tagline}\n`)
  stream.write("\n")
}
