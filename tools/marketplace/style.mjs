// The palette, and why it is only sixteen colours.
//
// Every colour here is an ANSI palette index, never a 24-bit or 256-colour
// escape. That is not a limitation, it is the point: the terminal decides what
// "cyan" looks like, so an Omarchy theme, or any other theme, recolours this
// tool by changing the terminal and nothing else. A hard-coded `38;2;57;197;207`
// would look the same on every theme, which means looking wrong on most of them.
// tests/unit/style.test.mjs fails if a truecolor or 256-colour escape appears
// anywhere in the sources.
//
// What each colour means, used the same way everywhere:
//
//   green    it passed, it is fine, nothing to do
//   red      it failed, and it is blocking
//   yellow   your attention: an advisory failure, a path at fault, a placeholder
//            you are meant to replace
//   cyan     something you type or run, and the one action that fixes things
//   bold     a name: a check id, a heading, a commit you should read
//   grey     context: where a rule came from, why a check exists, what was read
//   default  the sentence itself
//
// Colour is applied only when stdout is a terminal, and never under NO_COLOR or
// a dumb TERM. The words never change: a piped run and a watched run say the
// same thing, and a test asserts that stripping the colour from one gives the
// other back character for character.

const SGR = {
  reset: 0,
  bold: 1,
  dim: 2,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  cyan: 36,
  white: 37,
  default: 39,
  grey: 90,
  brightCyan: 96,
}

export const PALETTE = Object.freeze({ ...SGR })

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
    return `\u001b[${codes.join(";")}m${text}\u001b[0m`
  }
}

/** Strip every SGR sequence, so a width calculation counts characters a person sees. */
export function plain(text) {
  return String(text).replace(/\u001b\[[0-9;]*m/g, "")
}
