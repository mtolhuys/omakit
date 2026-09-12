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
// a label naming the current phase is information. A spinner with no phase would
// be decoration, and decoration in the middle of a security-baseline preview is
// what makes a tool feel less trustworthy, not more.

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const INTERVAL = 80

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
  let frame = 0
  let timer = null

  const clear = () => stream.write("\r[2K")
  const draw = () => {
    clear()
    stream.write(`[36m${FRAMES[frame % FRAMES.length]}[0m ${label}`)
    frame += 1
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
