// A progress line, on stderr, only when a person is looking.
//
// Three rules, and they are the whole design.
//
// It writes to stderr, never stdout. An agent piping `omakit submit` gets the
// same bytes it always got; the recordings in docs/media/ capture stdout and are
// unaffected. Nothing downstream has to strip anything.
//
// It only draws when stderr is a terminal, and OMAKIT_NO_PROGRESS turns it off.
// NO_COLOR removes the tint and nothing else: a progress line in the
// terminal's own foreground still says what is happening, and saying what is
// happening is the point.
//
// It says what is happening, not that something is happening. The one genuinely
// slow step is the official baseline reading a repository snapshot blob by blob;
// a label naming the current phase is information. A sweep with no phase would
// be decoration, and decoration in the middle of a security-baseline preview is
// what makes a tool feel less trustworthy, not more.

import { code, colourEnabled, COLUMNS, DENSITY, motionEnabled, MOTION } from "./style.mjs"

// A scanner sweeping back and forth over a fixed track: a three-cell head
// moving across twelve cells, with the rest of the track drawn as a floor so
// the motion reads as direction instead of blinking. The head and the floor
// are the same two glyphs the wordmark ends on, so the two animations read as
// one motif.
const TRACK = 12
const HEAD = 3
const INTERVAL = MOTION.progressFrameMs

const ESC = "\u001b["
const ACCENT = `${ESC}${code("typeable")}m`
const TRACK_TINT = `${ESC}${code("punctuation")}m`
const RESET = `${ESC}0m`
const CLEAR_LINE = `\r${ESC}2K`

/** Which cells the head covers at this step, bouncing rather than wrapping. */
export function headAt(step, track = TRACK, head = HEAD) {
  const span = (track - head) * 2
  const at = ((step % span) + span) % span
  return at <= track - head ? at : span - at
}

export function progressEnabled(stream = process.stderr, env = process.env) {
  if (env.OMAKIT_NO_PROGRESS) return false
  return motionEnabled(stream, env)
}

/**
 * @param {{ stream?: NodeJS.WriteStream, enabled?: boolean, colour?: boolean }} [options]
 * @returns {{ phase: (label: string) => void, done: () => void }}
 */
export function progress(options = {}) {
  const stream = options.stream || process.stderr
  const enabled = options.enabled ?? progressEnabled(stream)
  const colour = options.colour ?? colourEnabled(stream)
  if (!enabled) return { phase: () => {}, done: () => {} }

  let label = ""
  let step = 0
  let timer = null

  const clear = () => stream.write(CLEAR_LINE)
  const draw = () => {
    const start = headAt(step)
    // Three runs, not twelve cells: the floor before the head, the head, the
    // floor after it. A frame is one write and carries at most three tints.
    const paint = (glyph, count, tint) => (count > 0 ? (colour ? `${tint}${glyph.repeat(count)}${RESET}` : glyph.repeat(count)) : "")
    const track = paint(DENSITY.floor, start, TRACK_TINT)
      + paint(DENSITY.full, HEAD, ACCENT)
      + paint(DENSITY.floor, TRACK - start - HEAD, TRACK_TINT)
    // One write per frame, clear included: two writes can flicker on a slow
    // terminal, and a partially drawn frame is worse than no animation. The
    // label is cut to the terminal's width first: a line that wraps is a line
    // the clear does not reach, and it stays behind as a stray row.
    const room = (Number.isFinite(stream.columns) && stream.columns > 0 ? stream.columns : COLUMNS) - TRACK - 2
    const shown = label.length > room ? `${label.slice(0, Math.max(0, room - 1))}\u2026` : label
    stream.write(`${CLEAR_LINE}${track} ${shown}`)
    step += 1
  }

  return {
    phase(next) {
      label = String(next)
      if (!timer) {
        timer = setInterval(draw, INTERVAL)
        timer.unref?.()
      }
      draw()
    },
    done() {
      if (timer) clearInterval(timer)
      timer = null
      clear()
    },
  }
}
