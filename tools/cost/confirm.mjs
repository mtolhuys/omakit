// The one question `omakit cost` asks: may it restart the shell that many
// times. Asked at a terminal only, on stderr so stdout stays the report;
// anywhere else, a pipe, an agent, --json, the answer has to arrive as
// --yes, and cli.mjs refuses with a usage error when it does not. Nothing
// typed here is written anywhere.

import { createInterface } from "node:readline"
import { action, colourEnabled, styler } from "../marketplace/style.mjs"

/**
 * @param {{ input?: NodeJS.ReadStream, output?: NodeJS.WriteStream, colour?: boolean, question: string }} options
 * @returns {Promise<boolean>} true only for `y` or `yes`, in any case; the end of stdin is no
 */
export function askYes({ input = process.stdin, output = process.stderr, colour = colourEnabled(output), question }) {
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
    output.write(`${action(`${question} [y/N]:`, c, { indent: 0 })[0]} `)
  })
}
