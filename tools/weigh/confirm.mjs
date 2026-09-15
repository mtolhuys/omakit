// The one question `omakit weigh` asks: may it restart the shell that many
// times. Asked at a terminal only, on stderr so stdout stays the report;
// anywhere else, a pipe, an agent, --json, the answer has to arrive as
// --yes, and cli.mjs refuses with a usage error when it does not. Nothing
// typed here is written anywhere.

import { createInterface } from "node:readline"
import { action, colourEnabled, COLUMNS, styler } from "../marketplace/style.mjs"

/**
 * The question as it is written to the terminal: the arrow line, wrapped
 * at the contract width like every other action, with `[y/N]:` at the end
 * of the last line, and no newline after it, so the cursor waits there.
 * Measured on 0.2.1: the question grew a clause about --runs, wrapped to
 * two lines, and only the first was written, so a person saw "for a" and
 * no prompt, pressed Enter to see the rest, and the empty line was No.
 *
 * @param {string} question
 * @param {(name: string, text: string) => string} c
 * @param {{ width?: number }} [options]
 * @returns {string} every line, joined, ending in `[y/N]: `
 */
export function renderQuestion(question, c, { width = COLUMNS } = {}) {
  return `${action(`${question} [y/N]:`, c, { indent: 0, width }).join("\n")} `
}

/**
 * @param {{ input?: NodeJS.ReadStream, output?: NodeJS.WriteStream, colour?: boolean, question: string, width?: number }} options
 * @returns {Promise<boolean>} true only for `y` or `yes`, in any case; an empty line and the end of stdin are no
 */
export function askYes({ input = process.stdin, output = process.stderr, colour = colourEnabled(output), question, width = COLUMNS }) {
  const c = styler(colour)
  return new Promise((resolve) => {
    const rl = createInterface({ input, terminal: false })
    let answered = false
    const settle = (value) => {
      if (answered) return
      answered = true
      rl.close()
      resolve(value)
    }
    rl.on("line", (line) => settle(/^y(?:es)?$/i.test(line.trim())))
    rl.on("close", () => {
      if (!answered) output.write("\n")
      settle(false)
    })
    output.write(renderQuestion(question, c, { width }))
  })
}
