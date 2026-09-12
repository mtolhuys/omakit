// A progress line, on stderr, only when a person is looking.
//
// Three rules, and they are the whole design.
//
// It writes to stderr, never stdout. An agent piping `omakit submit` gets the
// same bytes it always got; the recordings in docs/media/ capture stdout and are
// unaffected. Nothing downstream has to strip anything.
//
// It only draws when stderr is a terminal, and it respects NO_COLOR and a dumb
// TERM like every other piece of presentation here.
//
// It says what is happening, not that something is happening. The one genuinely
// slow step is the official baseline reading a repository snapshot blob by blob;
// a label naming the current phase is information. A sweep with no phase would
// be decoration, and decoration in the middle of a security-baseline preview is
// what makes a tool feel less trustworthy, not more.

// A scanner sweeping back and forth over a fixed track: a three-cell head
// moving across twelve cells, with the rest of the track drawn as a dim floor
// so the motion reads as direction instead of blinking.
const TRACK = 12
const HEAD = 3
const INTERVAL = 70

const ESC = "\u001b["
const CYAN = `${ESC}36m`
const GREY = `${ESC}90m`
const RESET = `${ESC}0m`
const CLEAR_LINE = `\r${ESC}2K`

/** Which cells the head covers at this step, bouncing rather than wrapping. */
export function headAt(step, track = TRACK, head = HEAD) {
  const span = (track - head) * 2
  const at = ((step % span) + span) % span
  return at <= track - head ? at : span - at
}

export function progressEnabled(stream = process.stderr, env = process.env) {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false
  if (env.TERM === "dumb") return false
  if (env.OMAKIT_NO_PROGRESS) return false
  return Boolean(stream && stream.isTTY)
}

/**
 * @param {{ stream?: NodeJS.WriteStream, enabled?: boolean }} [options]
 * @returns {{ phase: (label: string) => void, done: () => void }}
 */
export function progress(options = {}) {
  const stream = options.stream || process.stderr
  const enabled = options.enabled ?? progressEnabled(stream)
  if (!enabled) return { phase: () => {}, done: () => {} }

  let label = ""
  let step = 0
  let timer = null

  const clear = () => stream.write(CLEAR_LINE)
  const draw = () => {
    const start = headAt(step)
    let track = ""
    for (let cell = 0; cell < TRACK; cell += 1) {
      track += cell >= start && cell < start + HEAD
        ? `${CYAN}\u2588${RESET}`
        : `${GREY}\u2581${RESET}`
    }
    // One write per frame, clear included: two writes can flicker on a slow
    // terminal, and a partially drawn frame is worse than no animation.
    stream.write(`${CLEAR_LINE}${track} ${label}`)
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
