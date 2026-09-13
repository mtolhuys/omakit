// After `npm install --global omakit` the command is missing when npm's
// global bin is not on PATH. Measured: a prefix of ~/.local/share/lerd/node-global
// whose bin no shell searched, and `omakit setup` answered with the `ln -s`
// hint written for a clone. The hint has to be for the install that is here,
// said for the shell in $SHELL, and it never writes an rc file.
import test from "node:test"
import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { doctor } from "../../tools/marketplace/doctor.mjs"
import { onPath, pathHint } from "../../tools/marketplace/path-hint.mjs"
import { NPM_PREFIX_ARGS, npmGlobalPrefix } from "../../tools/marketplace/upgrade.mjs"
import { REPO_ROOT, requirePinForTests } from "./helpers.mjs"

requirePinForTests()

/**
 * An npm install the way npm lays it out under a prefix nobody's PATH
 * searches, and a fake `npm` on PATH that answers `prefix --global` with that
 * prefix and records its argv. Nothing here touches the real npm.
 */
function npmInstall() {
  const home = mkdtempSync(join(tmpdir(), "omakit-path-"))
  const prefix = join(home, ".local/share/lerd/node-global")
  const pkg = join(prefix, "lib/node_modules/omakit")
  mkdirSync(join(pkg, "bin"), { recursive: true })
  mkdirSync(join(prefix, "bin"), { recursive: true })
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "omakit", version: "0.1.2" }) + "\n")
  writeFileSync(join(pkg, "bin/omakit"), "#!/bin/sh\n")
  writeFileSync(join(prefix, "bin/omakit"), "#!/bin/sh\n")
  const fakeBin = join(home, "fake-bin")
  mkdirSync(fakeBin)
  writeFileSync(join(fakeBin, "npm"), [
    "#!/bin/sh",
    `printf '%s\\n' "$*" >> "${join(home, "npm-argv")}"`,
    `if [ "$1" = "prefix" ]; then echo "${prefix}"; exit 0; fi`,
    "exit 2",
  ].join("\n") + "\n")
  chmodSync(join(fakeBin, "npm"), 0o755)
  return {
    pkg,
    prefix,
    env: { PATH: `${fakeBin}:/usr/bin`, HOME: home },
    argv: () => { try { return readFileSync(join(home, "npm-argv"), "utf8").trim().split("\n") } catch { return [] } },
  }
}

async function withPath(path, fn) {
  const saved = process.env.PATH
  process.env.PATH = path
  try { return await fn() } finally { process.env.PATH = saved }
}

test("an npm install off PATH gets the export line for bash and zsh with the rc file named, and fish_add_path for fish", async () => {
  const fake = npmInstall()
  assert.equal(onPath("omakit", fake.env), false)
  await withPath(fake.env.PATH, async () => {
    assert.equal(npmGlobalPrefix(), fake.prefix, "read through the frozen npm prefix --global")
    assert.deepEqual(fake.argv(), [NPM_PREFIX_ARGS.join(" ")])

    const bash = pathHint({ repoRoot: fake.pkg, entryPoint: join(fake.pkg, "bin/omakit"), env: { ...fake.env, SHELL: "/bin/bash" } })
    assert.equal(bash.kind, "npm")
    assert.equal(bash.reachable, false)
    assert.equal(bash.line, `export PATH="${fake.prefix}/bin:$PATH"`)
    assert.equal(bash.where, "~/.bashrc")
    assert.match(bash.reason, new RegExp(`npm installed it under ${fake.prefix}/bin, which your shell does not search`))

    const zsh = pathHint({ repoRoot: fake.pkg, entryPoint: join(fake.pkg, "bin/omakit"), env: { ...fake.env, SHELL: "/usr/bin/zsh" } })
    assert.equal(zsh.line, bash.line)
    assert.equal(zsh.where, "~/.zshrc")

    const fish = pathHint({ repoRoot: fake.pkg, entryPoint: join(fake.pkg, "bin/omakit"), env: { ...fake.env, SHELL: "/usr/bin/fish" } })
    assert.equal(fish.line, `fish_add_path ${fake.prefix}/bin`)
    assert.equal(fish.where, null, "fish keeps the path itself")

    const unknown = pathHint({ repoRoot: fake.pkg, entryPoint: join(fake.pkg, "bin/omakit"), env: { ...fake.env, SHELL: "/bin/nu" } })
    assert.equal(unknown.line, bash.line)
    assert.equal(unknown.where, null)
  })
  assert.deepEqual(fake.argv(), [NPM_PREFIX_ARGS.join(" ")].concat(Array(4).fill(NPM_PREFIX_ARGS.join(" "))), "npm was asked its prefix and nothing else")
})

test("a clone off PATH keeps the symlink hint, a reachable command needs none, and no npm means no line", () => {
  const off = pathHint({ repoRoot: REPO_ROOT, entryPoint: "/opt/omakit/bin/omakit", env: { PATH: "/usr/bin", SHELL: "/bin/zsh" } })
  assert.equal(off.kind, "git")
  assert.equal(off.line, "ln -s /opt/omakit/bin/omakit ~/.local/bin/omakit")
  assert.equal(off.where, null)

  const fake = npmInstall()
  const found = pathHint({ repoRoot: fake.pkg, entryPoint: join(fake.pkg, "bin/omakit"), env: { PATH: `${fake.prefix}/bin`, SHELL: "/bin/zsh" }, npmPrefix: () => { throw new Error("must not ask") } })
  assert.deepEqual(found, { kind: "npm", reachable: true, reason: null, line: null, where: null })

  const none = pathHint({ repoRoot: fake.pkg, entryPoint: join(fake.pkg, "bin/omakit"), env: { PATH: "/usr/bin", SHELL: "/bin/zsh" }, npmPrefix: () => null })
  assert.equal(none.line, null)
  assert.match(none.reason, /no `npm` is on PATH/)
})

test("doctor reports omakit.path: ok when reachable, advice with the line when not", async () => {
  const fake = npmInstall()
  const off = await doctor({ repoRoot: fake.pkg, offline: true, env: { ...fake.env, SHELL: "/bin/zsh" }, npmPrefix: () => fake.prefix })
  const check = off.checks.find((entry) => entry.id === "omakit.path")
  assert.equal(check.state, "advice")
  assert.match(check.detail, /not on your PATH yet: npm installed it under .*\/bin, which your shell does not search\. Keep the line below in ~\/\.zshrc\.$/)
  assert.equal(check.action, `export PATH="${fake.prefix}/bin:$PATH"`)
  assert.equal(off.problems, 0, "advice, not a problem: the tool runs, the shell just cannot find it")

  const on = await doctor({ repoRoot: fake.pkg, offline: true, env: { ...fake.env, PATH: `${fake.prefix}/bin`, SHELL: "/bin/zsh" }, npmPrefix: () => { throw new Error("must not ask") } })
  const reachable = on.checks.find((entry) => entry.id === "omakit.path")
  assert.equal(reachable.state, "ok")
  assert.match(reachable.detail, /reachable as a command from PATH \(npm install\)/)
  assert.equal(reachable.action, null)
})

test("setup takes its hint from path-hint.mjs and nothing writes an rc file", () => {
  const setup = readFileSync(join(REPO_ROOT, "tools/marketplace/setup.mjs"), "utf8")
  assert.match(setup, /import \{ pathHint \} from "\.\/path-hint\.mjs"/)
  assert.doesNotMatch(setup, /ln -s/, "the clone hint has one home")
  for (const name of ["path-hint.mjs", "setup.mjs", "doctor.mjs"]) {
    const text = readFileSync(join(REPO_ROOT, "tools/marketplace", name), "utf8")
    assert.doesNotMatch(text, /writeFileSync|appendFileSync|createWriteStream|openSync/, `${name} writes a file`)
  }
})
