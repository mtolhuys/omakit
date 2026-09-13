// The visual system, defined once. Every command draws with what is here and
// with nothing of its own; tests/unit/style.test.mjs reads every source file
// and fails if a status mark, a glyph or a column width is typed anywhere else.
// The decisions and their trade-offs are written up in docs/TUI.md.
//
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
// Colour is named by role, never by hue, at every call site: `c("typeable",
// text)`, not `c("cyan", text)`. ROLES below is the one table that says which
// palette index a role gets, and tests/unit/style.test.mjs fails on a hue
// name used anywhere else. The index for each role was chosen by measuring
// every theme installed on an Omarchy machine (32 of them, 5 light; the
// method, the table and the reasoning are in docs/PALETTE.md), against the
// worst case rather than the average:
//
//   typeable     blue (34). What you could type: a command, a flag, the remedy
//                arrow, the `omakit` word. The one role a reader most needs to
//                spot. Cyan was pixel-identical to the foreground on Matte
//                Black and unreadable in three themes; blue is at least 21
//                CIELAB units from the foreground in every chromatic theme,
//                and on Matte Black it is the theme's own amber accent.
//   placeholder  yellow (33). What you replace, in <angle brackets>, and the
//   advisory     advisory and unknown marks. Unreadable in four themes, and
//   unknown      still the least bad slot: every alternative fails more
//                themes or collapses into blue or green. The brackets and the
//                block glyph carry it where the hue does not.
//   pass         green (32). Also an environment variable name, a setting in
//   variable     the same register.
//   fail         red (31), bold. At least 28 from the foreground everywhere.
//   label        dim (2). A label beside a value, punctuation, grouping, a
//   punctuation  rule, the info mark. Grey (90) was under 3:1 in 23 of 32
//   info         themes, 1.5:1 on Matte Black; dim is the foreground scaled
//                by the terminal (measured: 0.66 in Alacritty, foot and
//                kitty, 0.74 in Ghostty) and is readable in all 32.
//   heading      bold. A heading, a name: a check id, a commit you should read.
//   name
//   prose        the foreground (39). The sentence itself.
//
// Hue is never the only carrier. Omarchy's Matte Black theme resolves every
// ANSI hue to nearly the same grey (measured: green reads orange, yellow reads
// red, cyan reads grey), and five installed themes are monochrome by design,
// so anything said by colour alone is not said there. Every distinction is
// therefore also carried by something a monochrome terminal has to honour:
// the density of a block glyph, the case of a word, the column a line starts
// in, or the blank line around a block.
//
// A sentence a person has to read is never grey and never dim. On a
// low-contrast theme grey on near-black is a line nobody can see, and the fix
// is not a brighter grey, it is not dimming prose in the first place. A label
// is one word, and it is the only thing that is ever dim. Emphasis inside a
// sentence comes from bold, or from tinting the one word you could type.
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
  magenta: 35,
  cyan: 36,
  white: 37,
  default: 39,
  grey: 90,
}

/**
 * The roles, and the SGR each resolves to. This is the only place a hue is
 * named; every call site names a role. `styler` accepts a dotted chain of
 * roles and SGR names, so "fail" is "red.bold" and "typeable.bold" is a bold
 * blue, but a source file outside this one may only use the role names.
 */
export const ROLES = Object.freeze({
  typeable: "blue",
  placeholder: "yellow",
  advisory: "yellow",
  unknown: "yellow",
  pass: "green",
  variable: "green",
  fail: "red.bold",
  label: "dim",
  punctuation: "dim",
  info: "dim",
  heading: "bold",
  name: "bold",
  prose: "default",
})

export const PALETTE = Object.freeze({ ...SGR })

/** The SGR parameter string for a role, for the two places that write an escape by hand (the wordmark, the progress line). */
export function code(role) {
  return String(role)
    .split(".")
    .flatMap((part) => (ROLES[part] || part).split("."))
    .map((part) => SGR[part])
    .filter((n) => n !== undefined)
    .join(";")
}

// --- geometry ---------------------------------------------------------------

/**
 * The width everything is composed for. Eighty columns is the contract: a
 * check's why-paragraph, a remedy, a refusal and the help all wrap inside it,
 * and tests/unit/style.test.mjs renders every report and measures. The one
 * thing exempt is the marketplace's own baseline report, which is printed
 * verbatim because rewrapping somebody else's attestation would be editing it.
 *
 * The rule is over what omakit composes, not over every word it is handed.
 * `overflows` below is the measurement, and it is the one both test files use.
 */
export const COLUMNS = 80

/**
 * The indent scale, in columns. Three stops, and every line in the tool starts
 * at one of them:
 *
 *   0        a status line, a key, a heading, a verdict
 *   GUTTER   the body of a check: its detail, its paths, its remedy, its reason
 *   LABEL    the value beside a key, and a continuation of that value
 *
 * GUTTER is the width of a status mark plus two spaces, so a check body sits
 * exactly under the check's name. LABEL is the width of the longest key the
 * tool prints ("current HEAD") plus two spaces, so every key/value line in
 * every command aligns to the same column. Both are asserted, not assumed.
 */
export const GUTTER = 8
export const LABEL = 14

/** The indent unit under a heading: a command listed in the help, a note under a step. */
export const STEP = 2

// --- the block ramp -----------------------------------------------------------

/**
 * One family of glyphs, used for everything that is not a letter. The wordmark,
 * the progress track, the rule under a heading and the status marks all come
 * from this ramp, so the tool has one motif rather than a collection of icons.
 *
 * Density is the carrier that survives a monochrome theme. A full block next to
 * a floor line is a difference in ink, not in hue, and ink is the one thing
 * every terminal draws.
 */
export const DENSITY = Object.freeze({
  full: "█", // █  the heaviest mark: a blocking failure, the scanner's head, the tool's own name
  dark: "▓", // ▓  an advisory: heavy, but not solid
  medium: "▒", // ▒  unknown: neither here nor there
  light: "░", // ░  information: present, weightless
  floor: "▁", // ▁  settled: a pass, a rule, the track the scanner runs on
  ceiling: "▔", // ▔  skipped: the floor's own ink, never landed, because a flag said not to look
})

/** The glyph that starts the one line that fixes things. */
export const ARROW = "→"

// --- the status vocabulary ---------------------------------------------------

/**
 * Six states, and only six. Each has one glyph, one word and one tint, and
 * every command prints them through `mark()` below. `pass` and `fail` are
 * verdicts; `advisory` is a failure that does not block; `info` is a fact with
 * no verdict; `unknown` is a check that could not be made; `skipped` is a
 * check that was not made because a flag said not to (`--offline`).
 *
 * The glyph is the density ramp read as severity: the more ink, the more it
 * matters. The word is the same thing in letters, and its case carries it too:
 * FAIL is the only upper-case mark, so it is the one the eye lands on in a
 * column of lower-case ones, with or without colour.
 *
 * `skipped` and `unknown` are one family: neither has a verdict, both wear the
 * same tint, and only the glyph and the word tell them apart. Measured on
 * 0.1.6: `--offline` drew the skipped validation-commit check as `▁ ok`, and
 * `--json` said `"verdict": "pass"`, for a comparison that never happened. The
 * skipped mark is the floor's ink at the ceiling: the same weight as a pass,
 * visibly not landed on one, on a theme that shows no hue.
 */
export const STATUS = Object.freeze({
  pass: Object.freeze({ glyph: DENSITY.floor, word: "ok", tint: "pass" }),
  fail: Object.freeze({ glyph: DENSITY.full, word: "FAIL", tint: "fail" }),
  advisory: Object.freeze({ glyph: DENSITY.dark, word: "note", tint: "advisory" }),
  info: Object.freeze({ glyph: DENSITY.light, word: "info", tint: "info" }),
  unknown: Object.freeze({ glyph: DENSITY.medium, word: "?", tint: "unknown" }),
  skipped: Object.freeze({ glyph: DENSITY.ceiling, word: "skip", tint: "unknown" }),
})

/** The width of the widest mark, "█ FAIL"; every mark is padded to it so the names beside them align. */
export const MARK_WIDTH = Math.max(...Object.values(STATUS).map((s) => `${s.glyph} ${s.word}`.length))

// --- motion ------------------------------------------------------------------

/**
 * Every animation has a stated budget. The wordmark scan is over in one glance,
 * because what follows it is the point and the scan has to be finished before
 * it is in the way; the first version took 1.4 seconds. The
 * progress line has no duration of its own, it lasts as long as the work does,
 * so its budget is a frame rate: one redraw per 70ms is smooth on a terminal
 * and cheap on a pty.
 *
 * The one text effect, `ttfx` over the wordmark, has a frame
 * rate the arguments are frozen to and a budget that is a hard timeout, after
 * which the process is killed and the wordmark is drawn at once. Measured on
 * this machine, the pinned effect at 60 frames a second: 42 frames, 713ms on a
 * pipe and 720ms on a pty, so the budget is twice that. It plays where the
 * wordmark is drawn, a bare `omakit` and `setup`; without `ttfx` the 220ms
 * scan runs there instead.
 */
export const MOTION = Object.freeze({
  bannerBudgetMs: 220,
  progressFrameMs: 70,
  effectFrameRate: 60,
  effectBudgetMs: 1500,
})

// --- enabling -----------------------------------------------------------------

export function colourEnabled(stream = process.stdout, env = process.env) {
  if (env.FORCE_COLOR && env.FORCE_COLOR !== "0") return true
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false
  if (env.TERM === "dumb") return false
  return Boolean(stream && stream.isTTY)
}

/**
 * Can this stream hold something that redraws in place? A terminal can. A pipe
 * cannot, and a dumb terminal cannot move its cursor. NO_COLOR is deliberately
 * not consulted: it turns colour off, and a wordmark drawn in the terminal's
 * own foreground or a progress line without a tint is exactly what it asks
 * for. There is no opt-out of omakit's own: the tool reads no environment
 * variable, and a pipe or TERM=dumb is how a person who wants no motion
 * says so.
 */
export function motionEnabled(stream, env = process.env) {
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
    const codes = code(name)
    if (!codes) return String(text)
    return `[${codes}m${text}[0m`
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
  // A line with nothing to type in it is written as it is: the terminal's
  // foreground needs no escape to be the foreground.
  if (!String(line).includes("`")) return String(line)
  return String(line)
    .split(/`([^`]+)`/)
    .map((part, index) => (index % 2 ? c("typeable", part) : c("prose", part)))
    .join("")
}

/** Strip every SGR sequence, so a width calculation counts characters a person sees. */
export function plain(text) {
  return String(text).replace(/\[[0-9;]*m/g, "")
}

/** Visible width of a line, escapes excluded. */
export function width(text) {
  return plain(text).length
}

/**
 * Whether a finished line breaks the eighty-column rule. This is the
 * measurement the tests make over the binary's own output, so it is defined
 * here, next to the rule, rather than in each test.
 *
 * A line is over width when it is wider than COLUMNS and omakit had a choice
 * about it. A line whose whole content, after its indent, is one word is a line
 * `wrap()` was handed a word wider than the room and put on a line of its own,
 * which is the rule: a path, a URL or a sha is never broken and never elided.
 * Measured before this was decided: `doctor` prints the pinned checkout's
 * absolute path, and from a checkout at a 91-column path the suite was red
 * while from a 60-column one it was green, so the rule depended on where the
 * repository was cloned. Eliding the path instead (`~/`, or a middle ellipsis)
 * was the other option and was rejected because stdout is an API: an agent
 * reads that line for the path, `~` is not a path it can open, and an
 * ellipsis is not a path at all. The same
 * holds for the missing-pin message, the `pin.size` remedy and the upgrade
 * refusal, all of which name a directory.
 *
 * @param {string} line one line, escapes allowed
 * @param {number} [total]
 */
export function overflows(line, total = COLUMNS) {
  const text = plain(line)
  if (text.length <= total) return false
  return /\s/.test(text.trim())
}

// --- composition ------------------------------------------------------------

/**
 * Wrap prose to the contract width, and paint it.
 *
 * `indent` is the column the text starts in and is part of the width, which is
 * the bug the earlier version had: it wrapped at 78 and then indented by 7, and
 * a check's why-paragraph reached column 85. `first` is the indent of the first
 * line when it differs, for a line whose label is already on it. A word longer
 * than the room it has (a URL, a sha) is left whole on a line of its own rather
 * than broken, because a broken URL is worse than a long one.
 *
 * A `backticked span` is one word: it is the thing you could type, it is never
 * split across lines, and `paintProse` tints it and drops the backticks. The
 * width is measured on what a person will see, so escapes and backticks cost
 * nothing.
 *
 * @param {string} text
 * @param {{ indent?: number, width?: number, first?: number }} [options]
 * @param {(name: string, text: string) => string} [c]
 * @returns {string[]} lines, indented and painted
 */
export function wrap(text, { indent = 0, width: total = COLUMNS, first = indent } = {}, c = styler(false)) {
  // A word is a run of non-spaces, or a backticked span with whatever
  // punctuation clings to it: "(`omakit pin`)." is one word.
  const words = String(text).match(/[^\s`]*`[^`]*`[^\s`]*|\S+/g) || []
  const visible = (word) => width(word.replace(/`/g, ""))
  const lines = []
  let line = ""
  let used = 0
  let room = total - first
  for (const word of words) {
    const cost = visible(word)
    if (line && used + 1 + cost > room) {
      lines.push(line)
      line = word
      used = cost
      room = total - indent
    } else {
      line = line ? `${line} ${word}` : word
      used += line === word ? cost : 1 + cost
    }
  }
  if (line) lines.push(line)
  return lines.map((entry, index) => `${" ".repeat(index === 0 ? first : indent)}${paintProse(entry, c)}`)
}

/**
 * A status mark, padded to MARK_WIDTH and followed by two spaces, so what comes
 * after it starts at GUTTER. This is the only place a status is turned into
 * characters.
 *
 * @param {"pass"|"fail"|"advisory"|"info"|"unknown"|"skipped"} state
 * @param {(name: string, text: string) => string} c
 */
export function mark(state, c) {
  const status = STATUS[state]
  if (!status) throw new Error(`style: no status named ${state}`)
  const text = `${status.glyph} ${status.word}`
  return `${c(status.tint, text)}${" ".repeat(GUTTER - text.length)}`
}

/**
 * A verdict line: the closing word of a command, in the register of the state
 * it reports. "█ REFUSED", "▁ Ready", "█ VALIDATION STALE". The word takes the tint
 * and the weight; what follows it is a sentence and keeps the foreground.
 */
export function verdict(state, word, text, c) {
  const status = STATUS[state]
  if (!status) throw new Error(`style: no status named ${state}`)
  const head = `${status.glyph} ${word}`
  const tint = (ROLES[status.tint] || status.tint).includes("bold") ? status.tint : `${status.tint}.bold`
  const lines = text ? wrap(text, { indent: head.length + 2 }, c) : []
  return lines.length ? [`${c(tint, head)}  ${lines[0].trimStart()}`, ...lines.slice(1)] : [c(tint, head)]
}

/**
 * A key/value line. The key is a label, so it is grey; the value starts at
 * LABEL and wraps under itself. A key longer than the column would break the
 * alignment, so it throws rather than shift everything below it.
 */
export function field(key, value, c, { wrapValue = true } = {}) {
  if (key.length > LABEL - 2) throw new Error(`style: key "${key}" is wider than the label column`)
  const label = `${c("label", key)}${" ".repeat(LABEL - key.length)}`
  const lines = wrapValue ? wrap(value, { indent: LABEL }, c) : [String(value)]
  return [`${label}${lines[0].trimStart()}`, ...lines.slice(1)]
}

/** A continuation of the last field's value, at the same column. */
export function continuation(value, c) {
  return wrap(value, { indent: LABEL }, c)
}

/**
 * The one line that fixes things: an arrow in the gutter, cyan text, wrapped
 * under itself. There is exactly one of these under any failure, and it is the
 * only line in the tool that starts with an arrow, so it can be found by shape.
 */
export function action(text, c, { indent = GUTTER } = {}) {
  // Painted after wrapping, and all of it cyan: the whole line is the thing
  // to do, so a backticked word inside it has nothing to stand out from.
  const lines = wrap(text, { indent: indent + 2 })
  return lines.map((line, index) => (index === 0
    ? `${" ".repeat(indent)}${c("typeable.bold", ARROW)} ${c("typeable", line.trimStart())}`
    : `${" ".repeat(indent + 2)}${c("typeable", line.trimStart())}`))
}

/**
 * A labelled body line: a short label in grey ("why"), two spaces, then prose
 * in the foreground, wrapped under the prose so the label stands alone in its
 * own column and can be skipped by a reader who has already read it once.
 */
export function labelled(label, text, c, { indent = GUTTER } = {}) {
  const gap = label.length + 2
  const lines = wrap(text, { indent: indent + gap }, c)
  return lines.map((line, index) => (index === 0
    ? `${" ".repeat(indent)}${c("label", label)}  ${line.trimStart()}`
    : line))
}

/**
 * The one separator: a heading on its own line, then a floor rule under it in
 * grey. It is the same shape the wordmark uses (the name, then its rule), so a
 * section of a report and the front door of the tool are drawn by one idea.
 */
export function section(title, c, { width: total = COLUMNS } = {}) {
  return [c("heading", title), c("punctuation", DENSITY.floor.repeat(total))]
}

/** A rule with no heading, the same floor, for a wordmark or a block that names itself. */
export function rule(c, { width: total = COLUMNS, tint = "punctuation" } = {}) {
  return c(tint, DENSITY.floor.repeat(total))
}
