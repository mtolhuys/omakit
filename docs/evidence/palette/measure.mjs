#!/usr/bin/env node
// Measure every installed Omarchy theme's terminal palette, so the role each
// ANSI index plays in omakit is chosen by worst-case distinctness across
// themes rather than by taste. Documentation tooling, not part of omakit; it
// runs on an Omarchy machine and reads the theme directories. The result is
// written up in docs/PALETTE.md, and the raw numbers beside this script.
//
//   node docs/evidence/palette/measure.mjs            # markdown on stdout
//   node docs/evidence/palette/measure.mjs --json     # the raw numbers
//
// The palette is resolved the way Omarchy resolves it at theme-set time:
// `omarchy-theme-color --file <colors.toml> --all` applies the same alias and
// fallback cascade the terminal templates are filled from, so color0..color15,
// background and foreground here are what alacritty.toml, foot.ini,
// ghostty.conf and kitty.conf receive. A theme with no colors.toml (manga, on
// this machine) has its palette read straight out of its alacritty.toml,
// which is the file omarchy-theme-set derives that theme's colors.toml from,
// so the sixteen slots are the same values either way.
//
// Nothing measured here reaches the terminal. omakit emits palette indices
// only; the measurement decides which index a role gets, and the theme keeps
// deciding what that index looks like.

import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

const THEME_DIRS = [join(homedir(), ".config/omarchy/themes"), "/usr/share/omarchy/themes"]

/** SGR code for each palette slot omakit may use, and the key it resolves to. */
export const SLOTS = [
  ...Array.from({ length: 8 }, (_, i) => ({ sgr: 30 + i, key: `color${i}` })),
  { sgr: 39, key: "foreground" },
  ...Array.from({ length: 8 }, (_, i) => ({ sgr: 90 + i, key: `color${8 + i}` })),
]

// Thresholds, stated once. A text run against the background needs WCAG
// contrast 3:1 to be readable at all (the floor WCAG sets for large text and
// interface parts) and 4.5:1 to read as body text. Two text runs read as
// different colours when their CIELAB distance is about 20 or more; below 10
// they are the same colour to a glance. CIE76 (Euclidean CIELAB) is used,
// which overstates differences in saturated blues and understates them in
// greys; both errors are on the safe side for the question asked here.
export const READABLE = 3
export const BODY = 4.5
export const DISTINCT = 20
export const SAME = 10

function hexToRgb(hex) {
  const h = hex.replace("#", "")
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
}

function linear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(rgb) {
  const [r, g, b] = rgb.map(linear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

function lab(hex) {
  const [r, g, b] = hexToRgb(hex).map(linear)
  // sRGB D65 to XYZ, then to CIELAB against the D65 white.
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 1.0
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

export function deltaE(a, b) {
  const [l1, a1, b1] = lab(a)
  const [l2, a2, b2] = lab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

function resolve(colorsToml) {
  const out = execFileSync("omarchy-theme-color", ["--file", colorsToml, "--all"], { encoding: "utf8" })
  const map = {}
  for (const line of out.split("\n")) {
    const [key, value] = line.split("\t")
    if (key && value) map[key] = value.trim().toLowerCase()
  }
  return map
}

/** The sixteen slots, background and foreground, out of an alacritty.toml. */
function fromAlacritty(text) {
  const map = {}
  let section = ""
  const names = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"]
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, (m, offset) => (raw.slice(0, offset).includes('"') ? m : "")).trim()
    const head = line.match(/^\[(.+)\]$/)
    if (head) { section = head[1]; continue }
    const kv = line.match(/^(\w+)\s*=\s*"(#[0-9a-fA-F]{6})"/)
    if (!kv) continue
    const [, key, value] = kv
    if (section === "colors.primary") map[key] = value.toLowerCase()
    else if (section === "colors.normal" && names.includes(key)) map[`color${names.indexOf(key)}`] = value.toLowerCase()
    else if (section === "colors.bright" && names.includes(key)) map[`color${8 + names.indexOf(key)}`] = value.toLowerCase()
  }
  // The terminal template fills white and bright white from the foreground,
  // whatever the file's own white was, so the slots report what the terminal
  // receives.
  map.color7 = map.foreground
  map.color15 = map.foreground
  const light = contrast(map.background, "#000000") > contrast(map.background, "#ffffff")
  map.mode = light ? "light" : "dark"
  return map
}

export function themes() {
  const found = []
  for (const dir of THEME_DIRS) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry)
      const colors = join(path, "colors.toml")
      let map
      if (existsSync(colors)) map = resolve(colors)
      else if (existsSync(join(path, "alacritty.toml"))) map = fromAlacritty(readFileSync(join(path, "alacritty.toml"), "utf8"))
      else continue
      const palette = Object.fromEntries(SLOTS.map(({ sgr, key }) => [sgr, map[key]]))
      found.push({
        name: basename(entry),
        source: dir.startsWith(homedir()) ? "user" : "system",
        mode: map.mode || "dark",
        background: map.background,
        foreground: map.foreground,
        palette,
      })
    }
  }
  return found
}

/**
 * A theme is monochrome by design when fewer than half of the fifteen pairs
 * among its six hues (31..36) are DISTINCT: most of what is said by hue is
 * not said there, whatever index a role gets, and the tool's second carriers
 * (glyph density, case, column, air) are what remain. Such themes are
 * measured and listed, and excluded from the pairwise question, which they
 * would answer "nothing" for. Measured: manga has 0 distinct hue pairs,
 * vantablack and white 1, lumon 5, felix 6; every other installed theme has
 * 8 or more.
 */
export function monochrome(theme) {
  const hues = [31, 32, 33, 34, 35, 36]
  let distinct = 0
  for (let i = 0; i < hues.length; i += 1) {
    for (let j = i + 1; j < hues.length; j += 1) {
      if (deltaE(theme.palette[hues[i]], theme.palette[hues[j]]) >= DISTINCT) distinct += 1
    }
  }
  return distinct < 8
}

/**
 * `dim` (SGR 2) is not a palette slot: the terminal derives it from the
 * foreground. Measured on this machine by screenshotting a dim run beside a
 * plain one in all four terminals: Alacritty, foot and kitty scale the
 * foreground by 0.66 in sRGB, Ghostty by 0.74. The lower factor is used here,
 * so the prediction is the darker of the two on a dark theme and the lighter
 * on a light one, which is the worse case for reading in both.
 */
export const DIM_FACTOR = 0.66

export function dimmed(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => Math.round(c * 255 * DIM_FACTOR))
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

export function measure(list = themes()) {
  return list.map((theme) => {
    const vsBackground = {}
    for (const { sgr } of SLOTS) vsBackground[sgr] = Number(contrast(theme.palette[sgr], theme.background).toFixed(2))
    vsBackground.dim = Number(contrast(dimmed(theme.foreground), theme.background).toFixed(2))
    vsBackground.dimVsForeground = Number(deltaE(dimmed(theme.foreground), theme.foreground).toFixed(1))
    const pairs = {}
    for (let i = 0; i < SLOTS.length; i += 1) {
      for (let j = i + 1; j < SLOTS.length; j += 1) {
        const a = SLOTS[i].sgr
        const b = SLOTS[j].sgr
        pairs[`${a}-${b}`] = Number(deltaE(theme.palette[a], theme.palette[b]).toFixed(1))
      }
    }
    return { ...theme, monochrome: monochrome(theme), vsBackground, pairs }
  })
}

const label = (sgr) => (sgr === 39 ? "fg" : String(sgr))

export function report(measured) {
  const lines = []
  const dark = measured.filter((t) => t.mode !== "light").length
  const light = measured.length - dark
  lines.push(`Measured ${measured.length} installed themes (${dark} dark, ${light} light) on ${new Date().toISOString().slice(0, 10)}.`)
  lines.push("")

  // 1. Readability against the background, per theme, per slot.
  lines.push("### Contrast against the theme's background (WCAG ratio)")
  lines.push("")
  lines.push(`Below ${READABLE}:1 a run is not readable and is marked \`!\`; below ${BODY}:1 it is not body text and is marked \`~\`.`)
  lines.push("")
  lines.push(`| theme | mode | ${SLOTS.map(({ sgr }) => label(sgr)).join(" | ")} |`)
  lines.push(`| --- | --- | ${SLOTS.map(() => "---:").join(" | ")} |`)
  for (const t of measured) {
    const cells = SLOTS.map(({ sgr }) => {
      const v = t.vsBackground[sgr]
      return `${v.toFixed(1)}${v < READABLE ? " !" : v < BODY ? " ~" : ""}`
    })
    lines.push(`| ${t.name} | ${t.mode} | ${cells.join(" | ")} |`)
  }
  lines.push("")

  // 2. Which slots are readable in every theme.
  const readableEverywhere = SLOTS.filter(({ sgr }) => measured.every((t) => t.vsBackground[sgr] >= READABLE)).map(({ sgr }) => label(sgr))
  const bodyEverywhere = SLOTS.filter(({ sgr }) => measured.every((t) => t.vsBackground[sgr] >= BODY)).map(({ sgr }) => label(sgr))
  lines.push(`Readable (${READABLE}:1) in every theme: ${readableEverywhere.join(", ") || "none"}.`)
  lines.push(`Body text (${BODY}:1) in every theme: ${bodyEverywhere.join(", ") || "none"}.`)
  lines.push("")
  const dimWorst = measured.reduce((w, t) => (t.vsBackground.dim < w.vsBackground.dim ? t : w))
  const dimSame = measured.filter((t) => t.vsBackground.dimVsForeground < DISTINCT).map((t) => `${t.name} (${t.vsBackground.dimVsForeground.toFixed(0)})`)
  lines.push(`\`dim\` (the foreground scaled by ${DIM_FACTOR}, the factor Alacritty, foot and kitty use; Ghostty uses 0.74) against the background: worst ${dimWorst.vsBackground.dim.toFixed(1)}:1 in ${dimWorst.name}; readable in ${measured.filter((t) => t.vsBackground.dim >= READABLE).length} of ${measured.length} themes, body text in ${measured.filter((t) => t.vsBackground.dim >= BODY).length}. Distinct from the foreground (${DISTINCT}+) in ${measured.length - dimSame.length} of ${measured.length}; not in ${dimSame.join(", ") || "none"}, where a label reads as plain text and its column is what marks it.`)
  lines.push("")
  for (const { sgr } of SLOTS) {
    const failing = measured.filter((t) => t.vsBackground[sgr] < READABLE).map((t) => `${t.name} (${t.vsBackground[sgr].toFixed(1)})`)
    if (failing.length) lines.push(`- ${label(sgr)} is unreadable in ${failing.join(", ")}.`)
  }
  lines.push("")

  // 3. Pair distinctness, over the chromatic themes: a monochrome theme
  //    answers "nothing" for every pair by design.
  const mono = measured.filter((t) => t.monochrome)
  const chromatic = measured.filter((t) => !t.monochrome)
  lines.push("### Themes that are monochrome by design")
  lines.push("")
  lines.push(`A theme in which fewer than half of the fifteen pairs among its six hues (31 to 36) are ${DISTINCT} CIELAB units apart says little by hue, whatever index a role gets: ${mono.map((t) => t.name).join(", ") || "none"}. They are measured above and left out of the pairwise question below, which they would answer "nothing" for; on them the tool's second carriers (glyph density, case, column, air) are the whole message.`)
  lines.push("")
  lines.push(`### Distance between slots (CIELAB, worst chromatic theme)`)
  lines.push("")
  lines.push(`For each pair, the smallest distance over the ${chromatic.length} chromatic themes. Under ${SAME} the two are the same colour there (\`!\`); under ${DISTINCT} they are hard to tell apart (\`~\`).`)
  lines.push("")
  const candidates = SLOTS.filter(({ sgr }) => sgr !== 30 && sgr !== 40)
  lines.push(`| | ${candidates.map(({ sgr }) => label(sgr)).join(" | ")} |`)
  lines.push(`| --- | ${candidates.map(() => "---").join(" | ")} |`)
  for (const a of candidates) {
    const cells = candidates.map((b) => {
      if (a.sgr === b.sgr) return "·"
      const key = a.sgr < b.sgr ? `${a.sgr}-${b.sgr}` : `${b.sgr}-${a.sgr}`
      let worst = null
      for (const t of chromatic) {
        const v = t.pairs[key]
        if (worst === null || v < worst.v) worst = { v, theme: t.name }
      }
      return `${worst.v.toFixed(0)}${worst.v < SAME ? " !" : worst.v < DISTINCT ? " ~" : ""}`
    })
    lines.push(`| **${label(a.sgr)}** | ${cells.join(" | ")} |`)
  }
  lines.push("")

  // 4. The answer: pairs distinct in every chromatic theme, and where the
  //    others collapse.
  lines.push("### Which pairs hold in every chromatic theme")
  lines.push("")
  const collapses = []
  const holds = []
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i].sgr
      const b = candidates[j].sgr
      const key = `${a}-${b}`
      const bad = chromatic.filter((t) => t.pairs[key] < DISTINCT).map((t) => `${t.name} (${t.pairs[key].toFixed(0)})`)
      if (bad.length) collapses.push({ pair: `${label(a)}/${label(b)}`, bad })
      else holds.push(`${label(a)}/${label(b)}`)
    }
  }
  lines.push(`Distinct (${DISTINCT}+) in every chromatic theme: ${holds.join(", ") || "none"}.`)
  lines.push("")
  lines.push("Pairs that collapse, and where:")
  lines.push("")
  for (const { pair, bad } of collapses.sort((x, y) => y.bad.length - x.bad.length)) {
    lines.push(`- ${pair}: ${bad.length} theme${bad.length === 1 ? "" : "s"}, ${bad.join(", ")}`)
  }
  return lines.join("\n")
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const measured = measure()
  if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(measured, null, 2)}\n`)
  else process.stdout.write(`${report(measured)}\n`)
}
