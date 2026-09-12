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
//   green    it passed, it is fine, nothing to do; and the name of an
//            environment variable, which is a setting in the same register
//   red      it failed, and it is blocking
//   yellow   your attention: an advisory failure, a path at fault, a placeholder
//            you are meant to replace
//   cyan     something you type or run, and the one action that fixes things
//   bold     a name: a check id, a heading, a commit you should read
//   grey     punctuation and grouping only: brackets, separators, a rule
//   default  the sentence itself
//
// A sentence a person has to read is never grey and never dim. Omarchy ships
// deliberately low-contrast themes (Matte Black among them) where grey on
// near-black is a line nobody can see, and the fix is not a brighter grey, it is
// not dimming prose in the first place. Emphasis inside a sentence comes from
// bold, or from tinting the one word you could type.
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

/**
 * Prose is prose: it keeps the terminal's own foreground colour, because a
 * sentence a person has to read is not context to be dimmed. Only what they
 * could type is tinted, and a name in `backticks` is exactly that.
 *
 * The backticks themselves are dropped: they are markup for a reader of the
 * source, and a terminal that can colour the word does not need them.
 */
export function paintProse(line, c) {
  return String(line)
    .split(/`([^`]+)`/)
    .map((part, index) => (index % 2 ? c("cyan", part) : c("default", part)))
    .join("")
}

/** Strip every SGR sequence, so a width calculation counts characters a person sees. */
export function plain(text) {
  return String(text).replace(/\u001b\[[0-9;]*m/g, "")
}
