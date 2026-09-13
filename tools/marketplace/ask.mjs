// The two questions `omakit submit` asks a person at a terminal, and only
// there: the category and the tags, which are an editorial choice nobody else
// can make. Measured before this: `omakit submit <a listed plugin>` exited 2
// asking for --category and --tags, and would then have refused at
// identity.available with "nothing to submit"; and an unlisted plugin got the
// same exit 2 from a person sitting at a terminal who could simply have been
// asked. So the questions come after the registry, and only when stdin and
// stdout are both terminals and --json is absent. An agent, a pipe or --json
// gets the usage error, unchanged.
//
// The prompt goes to stderr, so stdout stays the report. The default offered
// is the marketplace's own presentation for the manifest's kinds, read from
// the pinned catalog builder (registry.mjs catalogPresentation), and offered
// only when it is on the form's list. Nothing typed here is written anywhere:
// the report ends with the command line that repeats the run without asking.

import { createInterface } from "node:readline"
import { colourEnabled, STEP, action, styler, wrap } from "./style.mjs"
import { resolveCategory, resolveTags } from "./form.mjs"

export class AskError extends Error {
  constructor(message) {
    super(message)
    this.name = "AskError"
    this.code = "usage"
  }
}

/**
 * Lines from stdin, one at a time, whether they arrive as they are typed or
 * were all there before the first question (a scripted run). readline emits
 * every buffered line at once, so they are queued rather than dropped; the
 * end of stdin answers null.
 */
function reader(input) {
  const rl = createInterface({ input, terminal: false })
  const pending = []
  const waiting = []
  let closed = false
  rl.on("line", (line) => (waiting.length ? waiting.shift()(line) : pending.push(line)))
  rl.on("close", () => {
    closed = true
    while (waiting.length) waiting.shift()(null)
  })
  return {
    next: () => (pending.length ? Promise.resolve(pending.shift()) : closed ? Promise.resolve(null) : new Promise((resolve) => waiting.push(resolve))),
    close: () => rl.close(),
  }
}

/** Ask one question until an answer resolves; `parse` returns { ok, value } or { ok: false, reason }. */
async function question(lines, output, c, { name, heading, options, defaultIndexes, parse }) {
  const step = " ".repeat(STEP)
  output.write(`${wrap(heading, {}, c).join("\n")}\n`)
  for (const [index, option] of options.entries()) {
    output.write(`${step}${c("typeable", String(index + 1).padStart(2))}  ${option}\n`)
  }
  const fallback = defaultIndexes.length ? defaultIndexes.map((index) => index + 1).join(",") : null
  const prompt = `${action(fallback ? `${name} [${fallback}]:` : `${name}:`, c, { indent: 0 })[0]} `
  for (;;) {
    output.write(prompt)
    const raw = await lines.next()
    if (raw === null) {
      output.write("\n")
      throw new AskError(`stdin ended before the ${name} was answered; pass --${name} on the command line`)
    }
    const text = raw.trim() || (fallback ?? "")
    const parsed = parse(text)
    if (parsed.ok) return parsed.value
    output.write(`${wrap(parsed.reason, {}, c).join("\n")}\n`)
  }
}

/** A comma-separated answer of numbers or names, resolved against a list. */
function pick(text, options) {
  const parts = String(text).split(",").map((part) => part.trim()).filter(Boolean)
  const chosen = []
  for (const part of parts) {
    const number = /^\d+$/.test(part) ? Number(part) : null
    const option = number !== null
      ? options[number - 1]
      : options.find((candidate) => candidate.toLowerCase() === part.toLowerCase())
    if (!option) return { ok: false, reason: `"${part}" is not a number from 1 to ${options.length}, nor one of the names.` }
    if (!chosen.includes(option)) chosen.push(option)
  }
  return { ok: true, value: chosen }
}

/**
 * @param {{ contract: object, defaults: { category: string|null, tags: string[]|null }, missing: string[],
 *           input?: NodeJS.ReadStream, output?: NodeJS.WriteStream, colour?: boolean }} options
 *   `defaults` are the marketplace's own presentation for the manifest, offered
 *   only where they are on the form's list. `missing` names which of
 *   `--category` and `--tags` to ask for.
 * @returns {Promise<{ category?: string, tags?: string[] }>}
 */
export async function askChoices({ contract, defaults, missing, input = process.stdin, output = process.stderr, colour = colourEnabled(output) }) {
  const c = styler(colour)
  const lines = reader(input)
  const answers = {}
  try {
    if (missing.includes("--category")) {
      const known = defaults.category ? resolveCategory(contract, defaults.category) : { ok: false }
      const index = known.ok ? contract.categories.indexOf(known.value) : -1
      answers.category = await question(lines, output, c, {
        name: "category",
        heading: `category: one of the form's ${contract.categories.length}${index >= 0 ? `; the marketplace's own choice for this manifest's kinds is ${known.value}` : ""}`,
        options: contract.categories,
        defaultIndexes: index >= 0 ? [index] : [],
        parse: (text) => {
          if (!text) return { ok: false, reason: `There is no default for this manifest; answer with a number from 1 to ${contract.categories.length}.` }
          const picked = pick(text, contract.categories)
          if (!picked.ok) return picked
          if (picked.value.length !== 1) return { ok: false, reason: "Exactly one category." }
          return { ok: true, value: picked.value[0] }
        },
      })
    }
    if (missing.includes("--tags")) {
      const known = defaults.tags?.length ? resolveTags(contract, defaults.tags.filter((tag) => resolveTags(contract, [tag]).ok)) : { ok: false }
      const indexes = known.ok ? known.value.map((label) => contract.tagLabels.indexOf(label)) : []
      answers.tags = await question(lines, output, c, {
        name: "tags",
        heading: `tags: 1 to ${contract.maximumTags} of the form's ${contract.tagLabels.length}, comma-separated${indexes.length ? `; the marketplace's own choice for this manifest's kinds is ${known.value.join(", ")}` : ""}`,
        options: contract.tagLabels,
        defaultIndexes: indexes,
        parse: (text) => {
          if (!text) return { ok: false, reason: `There is no default for this manifest; answer with 1 to ${contract.maximumTags} numbers, comma-separated.` }
          const picked = pick(text, contract.tagLabels)
          if (!picked.ok) return picked
          const resolved = resolveTags(contract, picked.value)
          return resolved.ok ? { ok: true, value: resolved.value } : { ok: false, reason: `${resolved.reason}.` }
        },
      })
    }
  } finally {
    lines.close()
  }
  return answers
}
