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
// The animation is the tool's own motif rather than an ornament: the same
// scanner that sweeps the progress line during a baseline run sweeps across the
// name, lighting it as it passes. Nothing here imitates anyone else's logo,
// character or product; the letters are generated from the small font below, so
// renaming the tool is a change to one string and not a redrawing job.

const ESC = "\u001b["
const RESET = `${ESC}0m`
const HEAD = `${ESC}96m`
const LIT = `${ESC}36m`
const FLOOR = `${ESC}90m`

const BLOCK = "\u2588"
const RULE = "\u2581"

// A five-row pixel font, "#" lit and " " blank, one blank column between
// letters. Only the letters the name needs are defined; adding one is adding one
// entry of five equal-length strings.
export const GLYPHS = Object.freeze({
  a: [" ## ", "#  #", "####", "#  #", "#  #"],
  c: [" ###", "#   ", "#   ", "#   ", " ###"],
  i: ["#", "#", "#", "#", "#"],
  k: ["#  #", "# # ", "##  ", "# # ", "#  #"],
  m: ["#   #", "## ##", "# # #", "#   #", "#   #"],
  n: ["#  #", "## #", "# ##", "#  #", "#  #"],
  o: [" ## ", "#  #", "#  #", "#  #", " ## "],
  s: [" ###", "#   ", " ## ", "   #", "### "],
  t: ["###", " # ", " # ", " # ", " # "],
})

export const GLYPH_ROWS = 5

/**
 * Lay a word out as five rows of "#" and " ".
 * Throws on a letter the font does not have, rather than dropping it silently.
 */
export function wordmarkRows(word) {
  const letters = [...String(word).toLowerCase()]
  const missing = letters.filter((letter) => !GLYPHS[letter])
  if (missing.length) {
    throw new Error(`banner: no glyph for ${[...new Set(missing)].join(", ")}; add it to GLYPHS`)
  }
  const rows = []
  for (let row = 0; row < GLYPH_ROWS; row += 1) {
    rows.push(letters.map((letter) => GLYPHS[letter][row]).join(" "))
  }
  return rows
}

export function bannerEnabled(stream = process.stdout, env = process.env) {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false
  if (env.TERM === "dumb") return false
  if (env.OMAKIT_NO_BANNER) return false
  return Boolean(stream && stream.isTTY)
}

/**
 * One frame of the scan: columns left of the head are lit, the head is bright,
 * columns right of it are not yet revealed. `head` beyond the width returns the
 * finished wordmark.
 */
export function frame(rows, head) {
  const width = Math.max(...rows.map((row) => row.length))
  return rows.map((row) => {
    let out = ""
    let tint = ""
    for (let column = 0; column < width; column += 1) {
      // Unrevealed columns, and blanks inside revealed ones, are plain spaces.
      // A colour code is only ever emitted for a block that is actually drawn,
      // so a frame carries no escape it does not use.
      const lit = column <= head && row[column] === "#"
      if (!lit) {
        if (tint) { out += RESET; tint = "" }
        out += " "
        continue
      }
      const wanted = column >= head - 1 ? HEAD : LIT
      if (tint !== wanted) { out += wanted; tint = wanted }
      out += BLOCK
    }
    return tint ? out + RESET : out
  })
}

/**
 * @param {{ word?: string, tagline?: string, stream?: NodeJS.WriteStream,
 *           enabled?: boolean, animate?: boolean }} [options]
 */
export async function banner(options = {}) {
  const stream = options.stream || process.stdout
  const enabled = options.enabled ?? bannerEnabled(stream)
  const word = options.word || "omakit"
  const rows = wordmarkRows(word)
  const width = Math.max(...rows.map((row) => row.length))
  const rule = FLOOR + RULE.repeat(width) + RESET
  const tagline = options.tagline ? `${FLOOR}${options.tagline}${RESET}` : null

  // Nothing at all when it is not a terminal. There is no plain-text substitute
  // to print: `help` and `setup` already say the name and what it does in words,
  // and a piped run should differ from a watched one only in decoration.
  if (!enabled) return

  const write = (lines) => stream.write(`${lines.join("\n")}\n`)
  const up = () => stream.write(`${ESC}${GLYPH_ROWS}A`)

  if (options.animate === false) {
    write(frame(rows, width + 2))
  } else {
    for (let head = 0; head <= width + 1; head += 1) {
      write(frame(rows, head))
      if (head <= width) {
        await new Promise((resolve) => setTimeout(resolve, 22))
        up()
      }
    }
  }
  stream.write(`${rule}\n`)
  if (tagline) stream.write(`${tagline}\n`)
  stream.write("\n")
}
