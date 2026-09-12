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
//
// It only animates where nothing is waiting on it. `omakit setup` is a first run
// that fetches 16 MB regardless, so a second of scan costs nothing. `help` and
// `doctor` draw the finished wordmark at once, because the scan is 1.4 seconds
// and both of those commands exist to put text on the screen now.

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
 * One frame of the scan.
 *
 * `band` is where the bright head sits. `revealed` is how far the wordmark has
 * been drawn at all; columns beyond it are blank. The reveal pass moves both
 * together, and the shine pass afterwards moves the band across a wordmark that
 * is already complete. Defaulting `revealed` to `band` keeps the reveal-only
 * call shape.
 */
export function frame(rows, band, revealed = band) {
  const width = Math.max(...rows.map((row) => row.length))
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
      const wanted = column >= band - 1 && column <= band ? HEAD : LIT
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
    write(frame(rows, -2, width + 2))
  } else {
    const step = async (band, revealed, delay) => {
      write(frame(rows, band, revealed))
      await new Promise((resolve) => setTimeout(resolve, delay))
      up()
    }
    // Pass one: the scanner builds the name as it crosses.
    for (let band = 0; band <= width; band += 1) await step(band, band, 22)
    // Then it passes back and forth over the finished name, which is the same
    // sweep the progress line uses while the baseline runs.
    const shines = options.shines ?? 2
    for (let pass = 0; pass < shines; pass += 1) {
      const from = pass % 2 === 0 ? width : 0
      const to = pass % 2 === 0 ? 0 : width
      const direction = from > to ? -1 : 1
      for (let band = from; band !== to + direction; band += direction) {
        await step(band, width + 2, 14)
      }
    }
    write(frame(rows, -2, width + 2))
  }
  stream.write(`${rule}\n`)
  if (tagline) stream.write(`${tagline}\n`)
  stream.write("\n")
}
