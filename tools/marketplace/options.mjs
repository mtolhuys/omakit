// Every option every command accepts, in one table, and the one parser
// that reads a command line against it.
//
// The table is the source the help signatures and the completion scripts
// are held to (tests/unit/options.test.mjs): a flag a command reads must
// be in its signature, and a flag in a signature must be one the command
// reads, so `omakit help`, tab completion and the code cannot disagree. A
// token the command does not know, an option without its value, or one
// positional more than the command takes is refused before anything runs.
// Measured before this: `omakit weigh <plugin> -n 1` ran three runs as if
// nothing had been passed, and the other commands read their flags one by
// one and ignored the rest.

/**
 * What each command accepts. `valued` options take the next token (or
 * `--name=value`); `flags` stand alone; `positionals` is how many bare
 * arguments the command takes. `--help` and `-h` are handled before any
 * command runs and are not options of one.
 */
export const ACCEPTED = Object.freeze({
  setup: Object.freeze({ valued: [], flags: ["--yes", "--completion"], positionals: 0 }),
  pin: Object.freeze({ valued: [], flags: [], positionals: 0 }),
  submit: Object.freeze({ valued: ["--category", "--tags", "--notes", "--suggest-tag", "--name", "--out"], flags: ["--offline", "--allow-dirty", "--json"], positionals: 1 }),
  watch: Object.freeze({ valued: ["--out"], flags: ["--json"], positionals: 1 }),
  verify: Object.freeze({ valued: ["--out"], flags: ["--allow-dirty", "--json"], positionals: 1 }),
  help: Object.freeze({ valued: [], flags: ["--agent"], positionals: 0 }),
  upgrade: Object.freeze({ valued: [], flags: ["--dry-run"], positionals: 0 }),
  doctor: Object.freeze({ valued: ["--out"], flags: ["--offline", "--json"], positionals: 0 }),
  parity: Object.freeze({ valued: ["--count", "--offset", "--out"], flags: [], positionals: 0 }),
  weigh: Object.freeze({ valued: ["--runs", "--window", "--settle", "--out"], flags: ["--all", "--json", "--yes"], positionals: 1 }),
})

/** The accepted options of a command in the words a refusal prints: `--runs N, --all, ...`. */
export function acceptedWords(name) {
  const spec = ACCEPTED[name]
  const value = (option) => ({ "--out": "FILE", "--runs": "N", "--count": "N", "--offset": "N", "--window": "S", "--settle": "S", "--category": "C", "--tags": "A,B" }[option] || "TEXT")
  return [...spec.valued.map((option) => `${option} ${value(option)}`), ...spec.flags].join(", ")
}

/**
 * Read a command line against a command's table. Every token is a known
 * option (valued or not), the value of a valued option, or a positional up
 * to the allowed count; the first token that is none of those is returned
 * as `offending` with a reason, so the command refuses before any preflight.
 *
 * @param {string[]} args
 * @param {{ valued: string[], flags: string[], positionals: number }} spec
 * @returns {{ offending: string|null, reason: string|null, options: Map<string, string|true>, positionals: string[] }}
 */
export function checkArgs(args, spec) {
  const options = new Map()
  const positionals = []
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    const [name, inline] = token.startsWith("--") && token.includes("=") ? [token.slice(0, token.indexOf("=")), token.slice(token.indexOf("=") + 1)] : [token, undefined]
    if (spec.valued.includes(name)) {
      const value = inline !== undefined ? inline : args[index + 1]
      if (value === undefined || (inline === undefined && value.startsWith("-"))) return { offending: token, reason: `${name} needs a value`, options, positionals }
      options.set(name, value)
      if (inline === undefined) index += 1
    } else if (spec.flags.includes(token)) {
      options.set(token, true)
    } else if (token.startsWith("-")) {
      return { offending: token, reason: `${token} is not an option this command knows`, options, positionals }
    } else if (positionals.length < spec.positionals) {
      positionals.push(token)
    } else {
      return { offending: token, reason: `${JSON.stringify(token)} is one argument more than the command takes`, options, positionals }
    }
  }
  return { offending: null, reason: null, options, positionals }
}
