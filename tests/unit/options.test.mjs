// The help signatures, the completion scripts and the code read the same
// option table. A flag a command accepts appears in its signature in
// COMMANDS, and a flag in a signature is one the command accepts, so
// `omakit help` and tab completion can never disagree with what the parser
// takes. Measured before this test: weigh's signature and its parser were
// kept in step by hand, and the other commands had no table at all.
import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { ACCEPTED, acceptedWords, checkArgs } from "../../tools/marketplace/options.mjs"
import { subcommandsOf } from "../../tools/marketplace/completion.mjs"
import { COMMANDS } from "../../tools/marketplace/usage.mjs"
import { REPO_ROOT } from "./helpers.mjs"

const signatures = Object.fromEntries(subcommandsOf(COMMANDS).map((command) => [command.name, command]))

test("every command in the help has a table, and every table has a command in the help", () => {
  assert.deepEqual(Object.keys(ACCEPTED).sort(), Object.keys(signatures).sort())
})

test("every option a command accepts is in its signature, and every option in its signature is accepted", () => {
  for (const [name, spec] of Object.entries(ACCEPTED)) {
    const accepted = [...spec.valued, ...spec.flags].sort()
    const signed = signatures[name].flags.map((flag) => flag.flag).sort()
    assert.deepEqual(signed, accepted, `${name}: the signature says [${signed}], the parser takes [${accepted}]`)
    // A valued option shows a placeholder in the signature; a flag shows none.
    for (const { flag, value } of signatures[name].flags) {
      assert.equal(Boolean(value), spec.valued.includes(flag), `${name} ${flag}: ${value ? "takes a value in the signature" : "takes none in the signature"} but the parser ${spec.valued.includes(flag) ? "wants one" : "takes none"}`)
    }
    // A positional in the signature (`<target>`, `<issue-url>`) is one the parser takes, and none otherwise.
    const signature = [].concat(COMMANDS.find((command) => [].concat(command.signature)[0].startsWith(`omakit ${name}`)).signature).join(" ")
    assert.equal(spec.positionals > 0, /^omakit \w+ <[^>]+>/.test(signature), `${name}: positionals`)
  }
})

test("the parser refuses what the table does not name, and reads what it does", () => {
  const weigh = checkArgs(["fixture.clean", "--runs=2", "--yes"], ACCEPTED.weigh)
  assert.equal(weigh.offending, null)
  assert.deepEqual([...weigh.options], [["--runs", "2"], ["--yes", true]])
  assert.deepEqual(weigh.positionals, ["fixture.clean"])
  assert.equal(checkArgs(["-n", "1"], ACCEPTED.weigh).offending, "-n")
  assert.equal(checkArgs(["--runs"], ACCEPTED.weigh).reason, "--runs needs a value")
  assert.equal(checkArgs(["a", "b"], ACCEPTED.weigh).reason, '"b" is one argument more than the command takes')
  assert.equal(checkArgs(["--offline", "--json", "--out", "f"], ACCEPTED.doctor).offending, null)
  assert.equal(checkArgs(["x"], ACCEPTED.doctor).reason, '"x" is one argument more than the command takes')
  assert.equal(checkArgs(["--agent"], ACCEPTED.help).offending, null)
  assert.equal(checkArgs([], ACCEPTED.pin).offending, null)
  assert.equal(acceptedWords("weigh"), "--runs N, --window S, --settle S, --out FILE, --all, --json, --yes")
  assert.equal(acceptedWords("pin"), "")
})

test("the entry point refuses an unknown option for every command, before anything runs", () => {
  const run = (args) => spawnSync(process.execPath, [join(REPO_ROOT, "bin/omakit"), ...args], { encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" } })
  for (const name of Object.keys(ACCEPTED)) {
    const result = run([name, "--no-such-option"])
    assert.equal(result.status, 2, `${name}: exit 2`)
    assert.match(result.stderr, /--no-such-option is not an option this command knows/, name)
    assert.equal(result.stdout, "", `${name}: nothing on stdout`)
  }
  assert.match(run(["pin", "--x"]).stderr, /omakit pin takes no options/)
  assert.match(run(["doctor", "--x"]).stderr.replace(/\n +/g, " "), /Accepted: --out FILE, --offline, --json\./)
})
