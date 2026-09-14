// Tab completion, installed by `omakit setup`: a script derived from the
// help data and the pin's form rather than retyped.
import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { completionInstall, installCompletion, renderCompletion, subcommandsOf } from "../../tools/marketplace/completion.mjs"
import { submissionContract, tagSlug } from "../../tools/marketplace/form.mjs"
import { requirePin } from "../../tools/marketplace/pin.mjs"
import { COMMANDS, COMPLETION_SHELLS } from "../../tools/marketplace/usage.mjs"
import { DENSITY, plain } from "../../tools/marketplace/style.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

requirePinForTests()
const contract = await submissionContract({ repoRoot: REPO_ROOT })
const pin = requirePin(REPO_ROOT).identity.commit
const scripts = Object.fromEntries(COMPLETION_SHELLS.map((shell) => [shell, renderCompletion(shell, { contract, pin })]))

function run(args, env = {}) {
  const result = spawnSync(process.execPath, [join(REPO_ROOT, "bin/omakit"), ...args], {
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1", FORCE_COLOR: undefined, NO_COLOR: undefined, ...env },
  })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

test("every command, every flag, every category and tag, and the pin, in every script", () => {
  // The structural guarantee: a command added to COMMANDS cannot be missing
  // from completion, because completion is read out of COMMANDS.
  const subcommands = subcommandsOf(COMMANDS)
  assert.ok(subcommands.some((sub) => sub.name === "submit" && sub.target && sub.flags.some((f) => f.flag === "--category" && f.value === "category")))
  for (const shell of COMPLETION_SHELLS) {
    const script = scripts[shell]
    for (const command of COMMANDS) {
      const name = [].concat(command.signature)[0].match(/^omakit +([a-z-]+)/)[1]
      assert.ok(new RegExp(`\\b${name}\\b`).test(script), `${shell}: ${name} is missing`)
      for (const [flag] of [].concat(command.signature).join(" ").matchAll(/--[a-z-]+/g)) {
        assert.ok(script.includes(shell === "fish" ? `-l ${flag.slice(2)}` : flag), `${shell}: ${name} ${flag} is missing`)
      }
    }
    for (const category of contract.categories) assert.ok(script.includes(category.replace(/ /g, shell === "fish" ? "\\ " : " ")), `${shell}: category ${category}`)
    for (const label of contract.tagLabels) assert.ok(script.includes(tagSlug(label)), `${shell}: tag ${label}`)
    assert.ok(script.includes(`marketplace pin ${pin}`), `${shell}: names the pin`)
    assert.ok(script.includes("`omakit setup`"), `${shell}: says how to regenerate`)
    assert.doesNotMatch(script, /\u001b/, `${shell}: no escape`)
  }
})

test("each script parses in its shell, where the shell is installed", (t) => {
  const checks = { bash: ["bash", "-n"], zsh: ["zsh", "-n"], fish: ["fish", "--no-execute"] }
  let checked = 0
  for (const shell of COMPLETION_SHELLS) {
    const [program, flag] = checks[shell]
    if (spawnSync(program, ["--version"], { encoding: "utf8" }).error) {
      t.diagnostic(`${program} is not installed here; its script was not parsed`)
      continue
    }
    const file = join(mkdtempSync(join(tmpdir(), "omakit-completion-")), `omakit.${shell}`)
    writeFileSync(file, scripts[shell])
    const result = spawnSync(program, [flag, file], { encoding: "utf8" })
    assert.equal(result.status, 0, `${program} ${flag}: ${result.stderr}`)
    assert.equal(result.stdout + result.stderr, "", `${program} ${flag} is silent`)
    checked += 1
  }
  assert.ok(checked >= 1, "at least bash is expected here")
})

test("the bash function completes commands, flags, controlled values and directories", (t) => {
  if (spawnSync("bash", ["--version"], { encoding: "utf8" }).error) {
    t.skip("bash is not installed here")
    return
  }
  const dir = mkdtempSync(join(tmpdir(), "omakit-completion-"))
  const script = join(dir, "omakit.bash")
  writeFileSync(script, scripts.bash)
  // Drive the completion function the way readline does: COMP_WORDS and
  // COMP_CWORD set, the function called, COMPREPLY read back.
  const complete = (...words) => {
    const result = spawnSync("bash", ["-c", [
      `source "$1"; shift`,
      `COMP_WORDS=("$@"); COMP_CWORD=$(($# - 1)); COMP_LINE="$*"; COMP_POINT=\${#COMP_LINE}`,
      `_omakit; printf '%s\\n' "\${COMPREPLY[@]}"`,
    ].join("\n"), "bash", script, ...words], { encoding: "utf8", cwd: REPO_ROOT })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.split("\n").filter(Boolean)
  }
  const names = subcommandsOf(COMMANDS).map((sub) => sub.name)
  assert.deepEqual(complete("omakit", ""), names)
  assert.deepEqual(complete("omakit", "sub"), ["submit"])
  assert.deepEqual(complete("omakit", "submit", "--category", "Dev"), ["Developer\\ Tools"], "a value with a space is escaped for the shell")
  assert.deepEqual(complete("omakit", "submit", "--tags", "bar,qu"), ["bar,quickshell"], "the segment after the last comma")
  assert.deepEqual(complete("omakit", "submit", "--"), subcommandsOf(COMMANDS).find((sub) => sub.name === "submit").flags.map((f) => f.flag))
  assert.deepEqual(complete("omakit", "submit", "doc"), ["docs"], "a target is a directory")
  assert.deepEqual(complete("omakit", "doctor", "--"), ["--offline", "--json", "--out"])
})


test("setup installs the script where the shell in $SHELL loads it from, and nowhere else", () => {
  const home = mkdtempSync(join(tmpdir(), "omakit-home-"))
  assert.equal(completionInstall({ SHELL: "/bin/bash", HOME: home }).path, join(home, ".local/share/bash-completion/completions/omakit"))
  assert.equal(completionInstall({ SHELL: "/bin/bash", HOME: home, XDG_DATA_HOME: "/x" }).path, "/x/bash-completion/completions/omakit")
  assert.equal(completionInstall({ SHELL: "/usr/bin/fish", HOME: home }).path, join(home, ".config/fish/completions/omakit.fish"))
  assert.equal(completionInstall({ SHELL: "/usr/bin/zsh", HOME: home }).path, join(home, ".zfunc/_omakit"))
  assert.equal(completionInstall({ SHELL: "/usr/bin/zsh", HOME: home }).display, "~/.zfunc/_omakit")
  assert.equal(completionInstall({ SHELL: "/bin/tcsh", HOME: home }), null, "no script, no path")
  assert.equal(completionInstall({ HOME: home }), null)

  // A fresh home: the script is written, and it is the only thing written.
  const env = { SHELL: "/usr/bin/fish", HOME: home }
  const first = installCompletion({ contract, pin, env })
  assert.equal(first.state, "installed")
  const file = join(home, ".config/fish/completions/omakit.fish")
  assert.equal(readFileSync(file, "utf8"), scripts.fish)
  const files = readdirSync(home, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name)
  assert.deepEqual(files, ["omakit.fish"], "the script is the only file written")

  // Run again: nothing to do, and the file is untouched.
  assert.equal(installCompletion({ contract, pin, env }).state, "current")
  assert.equal(readFileSync(file, "utf8"), scripts.fish)

  // The pin moved: the script names the old one, so it is rewritten.
  writeFileSync(file, scripts.fish.replace(pin, "0".repeat(40)))
  assert.equal(installCompletion({ contract, pin, env }).state, "updated")
  assert.equal(readFileSync(file, "utf8"), scripts.fish)

  // A shell with no script: nothing is written, and the shell is named.
  const other = mkdtempSync(join(tmpdir(), "omakit-home-"))
  assert.deepEqual(installCompletion({ contract, pin, env: { SHELL: "/bin/tcsh", HOME: other } }), { state: "unsupported", shell: "tcsh", display: null, note: null })
  assert.deepEqual(readdirSync(other), [])
  assert.equal(installCompletion({ contract, pin, env: { HOME: other } }).shell, null)
})
