// Tab completion that actually works, proven with stub shells: a `bash`, a
// `zsh` and a `fish` first on PATH that answer the probe the way a real
// shell would, from a control file, so every state the setup step handles
// is exercised without a real rc file being touched. Measured before this
// (docs/MEASUREMENTS.md M8): setup reported the script installed and never
// asked a shell whether it loaded.
import test from "node:test"
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { Writable } from "node:stream"
import {
  appendLoaderBlock, completionStatus, completionWorks, installedCompletion, loaderBlock, loaderBlockPresent, PROBES, RC_MARKER,
  staleCompletionNotice, verifyCompletion,
} from "../../tools/marketplace/completion-check.mjs"
import { installCompletion, parseCompletionHeader, renderCompletion } from "../../tools/marketplace/completion.mjs"
import { submissionContract } from "../../tools/marketplace/form.mjs"
import { requirePin } from "../../tools/marketplace/pin.mjs"
import { completionStep } from "../../tools/marketplace/setup.mjs"
import { ARROW, DENSITY, plain } from "../../tools/marketplace/style.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

requirePinForTests()
const contract = await submissionContract({ repoRoot: REPO_ROOT })
const pin = requirePin(REPO_ROOT).identity.commit
const VERSION = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version

/**
 * A home with stub shells. The control file says what a new shell reports:
 * `loader` is "yes", "no", or "rc" (yes only when the marked block is in
 * the rc file, which is what the real block does); `spec` is what the
 * loader finds once asked, "lazy" when the script exists, "none" otherwise.
 */
function machine({ shell = "bash", loader = "yes", spec = "lazy" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "omakit-completion-"))
  const home = join(root, "home")
  const bin = join(root, "bin")
  const tools = join(root, "coreutils")
  const control = join(root, "control")
  for (const dir of [home, bin, tools]) mkdirSync(dir, { recursive: true })
  for (const name of ["cat", "cut", "grep", "head", "tail"]) symlinkSync(`/usr/bin/${name}`, join(tools, name))
  writeFileSync(control, `${loader}\n${spec}\n`)
  const rc = { bash: join(home, ".bashrc"), zsh: join(home, ".zshrc"), fish: join(home, ".config/fish/config.fish") }[shell]
  const script = {
    bash: join(home, ".local/share/bash-completion/completions/omakit"),
    zsh: join(home, ".zfunc/_omakit"),
    fish: join(home, ".config/fish/completions/omakit.fish"),
  }[shell]
  const stub = [
    "#!/bin/bash",
    `loader=$(cut -d' ' -f1 <<<"$(head -1 ${control})")`,
    `spec=$(tail -1 ${control})`,
    `if [[ $loader == rc ]]; then if grep -q '^${RC_MARKER}$' "${rc}" 2>/dev/null; then loader=yes; else loader=no; fi; fi`,
    'echo "loader=$loader"',
    `if [[ $loader == yes && $spec == lazy && -f "${script}" ]]; then echo spec=lazy; else echo spec=none; fi`,
  ].join("\n")
  for (const name of ["bash", "zsh", "fish"]) {
    writeFileSync(join(bin, name), `${stub}\n`)
    chmodSync(join(bin, name), 0o755)
  }
  const env = { PATH: `${bin}:${tools}`, HOME: home, SHELL: `/usr/bin/${shell}`, XDG_STATE_HOME: join(home, "state") }
  return { root, home, bin, env, control, rc, script, set: (l, s = "lazy") => writeFileSync(control, `${l}\n${s}\n`) }
}

/** The stream's text with every wrapped continuation joined back, so a sentence can be matched whole. */
function collect() {
  let text = ""
  const stream = new Writable({ write(chunk, _encoding, done) { text += chunk; done() } })
  stream.isTTY = false
  return { stream, text: () => plain(text).replace(/\n {8,}(?![→#\[])/g, " ") }
}

test("the probes are frozen, and a stub shell answers them", () => {
  assert.ok(Object.isFrozen(PROBES) && Object.isFrozen(PROBES.bash))
  assert.equal(PROBES.bash[0], "-ic", "bash is asked interactively, as a terminal starts it")
  assert.match(PROBES.bash[1], /_comp_load omakit/, "and the loader is asked to load omakit the way TAB does")
  assert.equal(PROBES.zsh[0], "-ic")
  assert.equal(PROBES.fish[0], "-c")
  const m = machine()
  writeFileSync(join(m.home, "unused"), "")
  mkdirSync(join(m.home, ".local/share/bash-completion/completions"), { recursive: true })
  writeFileSync(m.script, "# a script\n")
  assert.deepEqual(verifyCompletion("bash", { env: m.env }), { ran: true, loader: true, spec: "lazy", reason: null })
  m.set("no")
  assert.deepEqual(verifyCompletion("bash", { env: m.env }), { ran: true, loader: false, spec: "none", reason: null })
  assert.equal(verifyCompletion("bash", { env: { ...m.env, PATH: m.env.PATH.split(":")[1] } }).reason, "bash is not on PATH")
  assert.equal(verifyCompletion("tcsh", { env: m.env }).ran, false)
  assert.equal(completionWorks({ ran: true, loader: true, spec: "lazy" }), true)
  assert.equal(completionWorks({ ran: true, loader: true, spec: "none" }), false)
  assert.equal(completionWorks({ ran: true, loader: false, spec: "lazy" }), false)
})

test("each probe parses in its shell, where the shell is installed", (t) => {
  // Measured before this test: the bash probe had a stray `; ` before an
  // `&&`, bash refused the whole -c string, and setup reported no loader on
  // a machine that had one.
  const checks = { bash: ["bash", ["-n", "-c"]], zsh: ["zsh", ["-n", "-c"]], fish: ["fish", ["--no-execute", "-c"]] }
  for (const [shell, [program, flags]] of Object.entries(checks)) {
    if (spawnSync(program, ["--version"], { encoding: "utf8" }).error) {
      t.diagnostic(`${program} is not installed here; its probe was not parsed`)
      continue
    }
    const result = spawnSync(program, [...flags, PROBES[shell][1]], { encoding: "utf8" })
    assert.equal(result.status, 0, `${shell}: ${result.stderr}`)
  }
})

test("the header names the omakit version and the pin, and the parser reads it back from one line", () => {
  for (const shell of ["bash", "zsh", "fish"]) {
    const script = renderCompletion(shell, { contract, pin, version: "0.2.0" })
    const head = script.split("\n").slice(0, 2).join("\n")
    assert.deepEqual(parseCompletionHeader(head), { shell, version: "0.2.0", pin })
  }
  assert.deepEqual(parseCompletionHeader("# omakit completion for bash. Generated by `omakit setup` from"), { shell: "bash", version: null, pin: null }, "a script from before the version was recorded")
  const m = machine()
  assert.equal(installedCompletion(m.env), null, "no script yet")
  installCompletion({ contract, pin, version: VERSION, env: m.env })
  assert.deepEqual(installedCompletion(m.env), { path: m.script, shell: "bash", version: VERSION, pin })
})

test("loader present: the script is written and a new shell completes it, ok on the first run", async () => {
  const m = machine({ loader: "yes" })
  const out = collect()
  const result = await completionStep({ repoRoot: REPO_ROOT, pin, version: VERSION, stream: out.stream, env: m.env, yes: false })
  assert.equal(result.state, "ok")
  assert.equal(result.rcAppended, false)
  assert.match(out.text(), new RegExp(`^${DENSITY.floor} ok {4}tab completion for bash installed at ~/\\.local/share/bash-completion/completions/omakit;\\s+a new bash completes omakit on the first TAB\\.$`, "m"))
  assert.equal(existsSync(m.rc), false, "no rc file was created")
  assert.ok(!out.text().includes("exec bash"), "no new shell needed when nothing changed for the loader")
})

test("loader absent, answered no or not askable: the lines are printed and nothing is written", async () => {
  const m = machine({ loader: "rc" })
  const out = collect()
  const result = await completionStep({ repoRoot: REPO_ROOT, pin, version: VERSION, stream: out.stream, env: m.env, yes: false })
  assert.equal(result.state, "note")
  assert.equal(result.rcAppended, false)
  const text = out.text()
  assert.match(text, new RegExp(`^${DENSITY.dark} note {2}tab completion for bash installed at .*but a new bash has no completion\\s+loader: /usr/share/bash-completion/bash_completion is not sourced`, "m"))
  assert.match(text, /nothing was written\. The lines that make completions load, for ~\/\.bashrc:/)
  assert.match(text, new RegExp(`${ARROW} ${RC_MARKER}\\n\\s+${ARROW} \\[\\[ -r /usr/share/bash-completion/bash_completion \\]\\] && source\\s+/usr/share/bash-completion/bash_completion`))
  assert.equal(existsSync(m.rc), false, "nothing appended")
})

test("loader absent, answered yes: the marked block is appended once, a new shell is asked again, and ok says a new shell is needed", async () => {
  const m = machine({ loader: "rc" })
  writeFileSync(m.rc, "# my bashrc\nalias l=ls")
  const out = collect()
  const result = await completionStep({ repoRoot: REPO_ROOT, pin, version: VERSION, stream: out.stream, env: m.env, yes: true })
  assert.equal(result.state, "ok")
  assert.equal(result.rcAppended, true)
  const rc = readFileSync(m.rc, "utf8")
  assert.equal(rc, `# my bashrc\nalias l=ls\n\n${RC_MARKER}\n[[ -r /usr/share/bash-completion/bash_completion ]] && source /usr/share/bash-completion/bash_completion\n`, "appended after a newline, the file's own lines untouched")
  assert.match(out.text(), /appended to ~\/\.bashrc, marked # omakit completion; omakit never edits or removes\s+it\./)
  assert.match(out.text(), new RegExp(`^${DENSITY.floor} ok {4}tab completion for bash installed at .*a new bash completes omakit on the first TAB\\. Open terminals need a\\s+new shell: exec bash\\.`, "m"))
  // Run again: the marker is found, nothing is appended twice, and the loader is now reported present.
  const again = collect()
  const second = await completionStep({ repoRoot: REPO_ROOT, pin, version: VERSION, stream: again.stream, env: m.env, yes: true })
  assert.equal(second.state, "ok")
  assert.equal(second.rcAppended, false)
  assert.equal(readFileSync(m.rc, "utf8"), rc, "byte for byte the same rc file")
  assert.equal((rc.match(new RegExp(RC_MARKER, "g")) || []).length, 1)
  assert.ok(!again.text().includes("exec bash"))
  // And the block functions on their own: present, idempotent, never edited.
  assert.equal(loaderBlockPresent("bash", m.env), true)
  assert.deepEqual(appendLoaderBlock("bash", m.env), { appended: false, file: m.rc })
  assert.equal(loaderBlock("fish", m.env), null, "fish has no block to add")
  assert.deepEqual(loaderBlock("zsh", { HOME: "/h" }).lines, [RC_MARKER, "fpath+=~/.zfunc", "autoload -Uz compinit && compinit"])
  assert.equal(loaderBlock("zsh", { HOME: "/h", ZDOTDIR: "/z" }).file, "/z/.zshrc")
})

test("the marker already present and the loader still missing: nothing is appended and the shell is blamed, not the file", async () => {
  const m = machine({ loader: "no" })
  writeFileSync(m.rc, `${RC_MARKER}\n[[ -r /usr/share/bash-completion/bash_completion ]] && source /usr/share/bash-completion/bash_completion\n`)
  const before = readFileSync(m.rc, "utf8")
  const out = collect()
  const result = await completionStep({ repoRoot: REPO_ROOT, pin, version: VERSION, stream: out.stream, env: m.env, yes: true })
  assert.equal(result.state, "note")
  assert.equal(readFileSync(m.rc, "utf8"), before)
  assert.match(out.text(), /already carries the # omakit completion block; a new shell still reports\s+no loader, so something later in that file undoes it\./)
})

test("verify failing after the write: the block is appended, the new shell still says no, and the step is a note with the doctor as the next step", async () => {
  const m = machine({ loader: "no" })
  const out = collect()
  const result = await completionStep({ repoRoot: REPO_ROOT, pin, version: VERSION, stream: out.stream, env: m.env, yes: true })
  assert.equal(result.state, "note")
  assert.equal(result.rcAppended, true)
  assert.equal(loaderBlockPresent("bash", m.env), true)
  assert.match(out.text(), new RegExp(`^${DENSITY.dark} note {2}tab completion for bash installed at .*still has no completion loader even after the\\s+block was appended\\.`, "m"))
  assert.match(out.text(), new RegExp(`${ARROW} Open a new shell \\(exec bash\\) and run omakit doctor`))
  assert.ok(!out.text().includes(`${DENSITY.floor} ok`), "ok is never printed for a completion no new shell shows")
})

test("--completion alone never asks: the loader is named and the lines are printed", async () => {
  const m = machine({ loader: "rc" })
  const out = collect()
  const result = await completionStep({ repoRoot: REPO_ROOT, pin, version: VERSION, stream: out.stream, env: m.env, yes: true, askRc: false })
  assert.equal(result.state, "note")
  assert.equal(existsSync(m.rc), false, "yes does not count when the question is not asked")
  assert.match(out.text(), /nothing was written\. The lines that make completions load/)
})

test("doctor's omakit.completion: script, version and pin, loader and spec, and what is stale", () => {
  const m = machine({ loader: "yes" })
  assert.equal(completionStatus({ version: VERSION, pin, env: m.env }).state, "advice", "no script yet")
  assert.match(completionStatus({ version: VERSION, pin, env: m.env }).detail, /no completion script at ~\/\.local\/share/)
  installCompletion({ contract, pin, version: VERSION, env: m.env })
  const good = completionStatus({ version: VERSION, pin, env: m.env })
  assert.equal(good.state, "ok")
  assert.match(good.detail, new RegExp(`omakit ${VERSION.replace(/\\./g, "\\\\.")}, pin ${pin.slice(0, 7)}; loader active, \`complete -p omakit\` seen in a new bash after the loader was asked`))
  assert.deepEqual(good.evidence, { shell: "bash", path: m.script, present: true, version: VERSION, pin, loader: true, spec: "lazy" })
  m.set("no")
  const dead = completionStatus({ version: VERSION, pin, env: m.env })
  assert.equal(dead.state, "advice")
  assert.match(dead.detail, /a new bash has no completion loader, so the script is never read/)
  assert.equal(dead.action, "omakit setup")
  m.set("yes")
  writeFileSync(m.script, renderCompletion("bash", { contract, pin, version: "0.1.9" }))
  const stale = completionStatus({ version: VERSION, pin, env: m.env })
  assert.equal(stale.state, "advice")
  assert.match(stale.detail, new RegExp(`omakit 0\\.1\\.9, pin ${pin.slice(0, 7)}; this omakit is ${VERSION.replace(/\\./g, "\\\\.")} at pin ${pin.slice(0, 7)}, so the script is stale`))
  assert.equal(completionStatus({ version: VERSION, pin, env: { ...m.env, SHELL: "/bin/tcsh" } }).state, "info")
})

test("a script from another omakit is noticed once a day, at startup, from one line of the file", () => {
  const m = machine()
  assert.equal(staleCompletionNotice({ version: VERSION, env: m.env, today: "2026-09-15" }), null, "no script, nothing to say")
  mkdirSync(join(m.home, ".local/share/bash-completion/completions"), { recursive: true })
  writeFileSync(m.script, renderCompletion("bash", { contract, pin, version: "0.1.9" }))
  assert.equal(staleCompletionNotice({ version: VERSION, env: m.env, today: "2026-09-15" }), "tab completion is from 0.1.9; run omakit setup")
  assert.equal(staleCompletionNotice({ version: VERSION, env: m.env, today: "2026-09-15" }), null, "once that day")
  assert.equal(staleCompletionNotice({ version: VERSION, env: m.env, today: "2026-09-16" }), "tab completion is from 0.1.9; run omakit setup", "and again the next day")
  assert.equal(readFileSync(join(m.env.XDG_STATE_HOME, "omakit/completion-noticed"), "utf8"), "2026-09-16\n")
  writeFileSync(m.script, "# omakit completion for bash. Generated by `omakit setup` from\n")
  assert.equal(staleCompletionNotice({ version: VERSION, env: m.env, today: "2026-09-17" }), "tab completion is from an older omakit; run omakit setup")
  writeFileSync(m.script, renderCompletion("bash", { contract, pin, version: VERSION }))
  assert.equal(staleCompletionNotice({ version: VERSION, env: m.env, today: "2026-09-18" }), null, "current: nothing to say, and no stamp written")
  assert.equal(readFileSync(join(m.env.XDG_STATE_HOME, "omakit/completion-noticed"), "utf8"), "2026-09-17\n")
})
