#!/usr/bin/env node
// QMP from a shell: `node tools/lab/qmp-cli.mjs <socket> screendump <file>`,
// `... status`, `... press <chord>`. The harness's capture_console is the
// one caller; it exists so a suite needs no socat.

import { press, qmpExecute, screendump } from "./qemu.mjs"

const [socket, command, argument] = process.argv.slice(2)
if (!socket || !command) {
  process.stderr.write("usage: qmp-cli.mjs <socket> screendump <file> | status | press <chord>\n")
  process.exit(2)
}
try {
  if (command === "screendump") await screendump(socket, argument)
  else if (command === "status") process.stdout.write(`${JSON.stringify(await qmpExecute(socket, "query-status"))}\n`)
  else if (command === "press") await press(socket, String(argument).split("-"))
  else throw new Error(`unknown command ${command}`)
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}
