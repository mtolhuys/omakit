// Colour, only when a person is looking.
//
// The primary user of this tool is a coding agent reading piped output, and
// escape sequences in a pipe are noise it has to strip. So colour is applied
// only when stdout is a terminal, and never when NO_COLOR or a dumb TERM says
// otherwise. `FORCE_COLOR` turns it on anyway, which is what the GIF recording
// in docs/media/ uses.

const SGR = {
  reset: 0,
  bold: 1,
  dim: 2,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  cyan: 36,
  grey: 90,
}

export function colourEnabled(stream = process.stdout, env = process.env) {
  if (env.FORCE_COLOR && env.FORCE_COLOR !== "0") return true
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false
  if (env.TERM === "dumb") return false
  return Boolean(stream && stream.isTTY)
}

/**
 * @param {boolean} enabled
 * @returns {(name: string, text: string) => string}
 */
export function styler(enabled) {
  if (!enabled) return (_name, text) => String(text)
  return (name, text) => {
    const codes = String(name)
      .split(".")
      .map((part) => SGR[part])
      .filter((code) => code !== undefined)
    if (!codes.length) return String(text)
    return `[${codes.join(";")}m${text}[0m`
  }
}

/** Strip every SGR sequence, so a width calculation counts characters a person sees. */
export function plain(text) {
  return String(text).replace(/\[[0-9;]*m/g, "")
}
