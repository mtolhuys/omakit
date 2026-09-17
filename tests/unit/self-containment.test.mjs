// This repository's own agent and skill files live at the root of the tool and
// must never travel into a plugin tree.
//
// Three things are proven here. First, that no copying primitive exists in
// this repository, and that the one code path that writes into a plugin
// tree, `omakit add` (tools/blocks/add.mjs), writes only a shipped block's
// files under omakit/ by names the block registry holds, after checking
// those names against the agent-control list, so nothing can carry an
// instruction file along. Second, that the agent-control check would catch
// this repository's own files immediately: the check is run over this
// repository's tree and must flag them. Third, that it finds nothing under
// blocks/, the only files add can ever write.
import test from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { findAgentControl, AGENT_CONTROL_FILES } from "../../tools/marketplace/agent-control.mjs"
import { shippedBlocks } from "../../tools/blocks/registry.mjs"
import { REPO_ROOT } from "./helpers.mjs"

const SKIP = new Set([".git", ".cache", "node_modules"])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else out.push(path)
  }
  return out
}

const files = walk(REPO_ROOT).map((path) => relative(REPO_ROOT, path))
const sources = files
  .filter((path) => /\.mjs$/.test(path) && !path.startsWith("tests/"))
  .map((path) => ({ path, text: readFileSync(join(REPO_ROOT, path), "utf8") }))

test("this repository does carry agent-control files, at its own root", () => {
  const own = files.filter((path) => AGENT_CONTROL_FILES.includes(path.split("/").at(-1)) || path.startsWith("skills/"))
  assert.ok(own.length > 0, "the agent-facing files are a deliverable; they should exist")
  for (const path of own) {
    const depth = path.split("/").length
    assert.ok(
      depth === 1 || path.startsWith("skills/"),
      `${path} is an agent-control file somewhere other than the root of the tool`,
    )
  }
})

test("the agent-control check flags this repository's own files", () => {
  const entries = files.map((path) => ({ path, mode: "100644", type: "blob" }))
  const hits = findAgentControl(entries).map((hit) => hit.path)
  assert.ok(hits.includes("AGENTS.md"), "the check must see this repository's own AGENTS.md")
  assert.ok(hits.some((path) => path.startsWith("skills/")), "the check must see this repository's own skills")
})

test("nothing in this repository writes into a plugin or subject tree", () => {
  for (const { path, text } of sources) {
    // No copying primitives at all: a tool that cannot copy cannot smuggle.
    for (const primitive of ["cpSync", "copyFileSync", "copyFile", "renameSync", "symlinkSync", "linkSync"]) {
      assert.ok(!new RegExp(`\\b${primitive}\\s*\\(`).test(text), `${path} uses ${primitive}`)
    }
    // Writes are allowed to an explicit --out path, to docs/evidence, to the
    // pinned checkout's own .git/info (the sparse-checkout file, which is how
    // the pin fetches only what omakit reads), to the live registry cache
    // beside the pin (liveCache, in registry.mjs, at the path liveCacheDir
    // names under the user cache: two data files and a stamp, never code),
    // and to the one completion script `setup` installs where the user's
    // shell loads it from (completionFile, in completion.mjs, at the path
    // completionInstall names and nowhere else). Nothing else, and never into
    // a subject.
    // The capture takes the rest of the line, because a target like
    // join(dir, ".git/info/x") contains a comma of its own.
    // `omakit weigh` is the one command that writes to the user's own machine
    // outside those: the shell configuration it measures with (configFile),
    // the byte-for-byte backup it restores from (backupFile), and the
    // per-restart timing its confirmation estimates from (timingFile). Only
    // under tools/weigh/, only to those names, and docs/WEIGH.md says what each
    // one is for.
    const weighWrites = path.startsWith("tools/weigh/") ? /^configFile,|^backupFile,|^timingFile,/ : /$^/
    // completion-check.mjs writes two things: the once-a-day stamp behind the
    // stale-completion notice (stampFile, under the state directory), and the
    // one guarded block `setup` appends to an rc file after an explicit yes
    // (rcFile, through appendFileSync, counted below).
    const completionWrites = path === "tools/marketplace/completion-check.mjs" ? /^stampFile,/ : /$^/
    // A terminal update check stores only installed/latest versions and time
    // under XDG_STATE_HOME/omakit; it never stores code or writes to a subject.
    const updateWrites = path === "tools/marketplace/update-check.mjs" ? /^updateFile,/ : /$^/
    // `omakit add` writes a shipped block's files and NOTICE under the
    // plugin's omakit/ directory (blockFile, in add.mjs, from the registry's
    // names and nowhere else), and the maintainer's stamp tool writes the
    // same names under this checkout's blocks/ (blockFile, in stamp.mjs).
    // Both are held to those names and counted below.
    const blockWrites = path === "tools/blocks/add.mjs" || path === "tools/blocks/stamp.mjs" ? /^blockFile,/ : /$^/
    for (const match of text.matchAll(/writeFileSync\(\s*(.+)$/gm)) {
      const target = match[1]
      assert.ok(
        /resolve\(out\)|outFile|join\(out|evidence|\.git\/info|^completionFile,|^join\(liveCache,/.test(target) || weighWrites.test(target) || completionWrites.test(target) || updateWrites.test(target) || blockWrites.test(target),
        `${path} writes to ${target.trim()}, which is neither --out, an evidence path, the pin's own .git/info, the live registry cache, the completion script, a block file, nor one of the three files weigh may write`,
      )
    }
    if (path === "tools/blocks/add.mjs") {
      assert.equal((text.match(/writeFileSync\(/g) || []).length, 2, "add.mjs writes a block file and the NOTICE, nothing else")
      assert.match(text, /const blockFile = target\n/, "the block file is the registry entry's target under omakit/")
      assert.match(text, /const blockFile = noticePath\n/, "and the NOTICE is the one beside it")
      assert.match(text, /findAgentControl\(/, "the names are checked against the agent-control list before a byte is written")
      assert.ok(text.indexOf("findAgentControl(") < text.indexOf("writeFileSync("), "and that check comes before the first write")
    } else if (path === "tools/blocks/stamp.mjs") {
      assert.equal((text.match(/writeFileSync\(/g) || []).length, 3, "stamp.mjs writes block files, NOTICE and history.json under blocks/, nothing else")
      assert.doesNotMatch(text, /process\.argv\[2\]|resolve\(process\.cwd|pluginDir/, "stamp.mjs takes no directory: it writes only under this checkout's blocks/")
    } else {
      assert.doesNotMatch(text, /\bblockFile\b/, `${path} writes a block file; only tools/blocks/add.mjs and stamp.mjs may`)
    }
    if (path.startsWith("tools/weigh/")) {
      // Five writes in all, each to one of the names above or to --out, and
      // the count is asserted so a sixth cannot appear unnoticed.
      const writes = (text.match(/writeFileSync\(/g) || []).length
      if (path === "tools/weigh/config.mjs") assert.equal(writes, 3, "config.mjs writes the backup and the configuration (once per run, once to restore)")
      else if (path === "tools/weigh/audit.mjs") assert.equal(writes, 2, "audit.mjs writes --out and the timing file")
      else assert.equal(writes, 0, `${path} writes a file`)
    } else {
      assert.doesNotMatch(text, /\b(?:configFile|backupFile)\b|writeFileSync\([^)]*shell\.json/, `${path} reaches the shell configuration; only tools/weigh/ may`)
    }
    if (path === "tools/marketplace/registry.mjs") {
      assert.match(text, /const liveCache = liveCacheDir\(commit, cacheRoot\)/, "the live registry cache is the path liveCacheDir names")
      assert.equal((text.match(/writeFileSync\(/g) || []).length, 2, "registry.mjs writes the data files and the stamp, nothing else")
    } else {
      assert.ok(!/join\(liveCache,/.test(text), `${path} writes into the live registry cache; only registry.mjs may`)
    }
    if (path === "tools/marketplace/completion.mjs") {
      assert.equal((text.match(/writeFileSync\(/g) || []).length, 1, "completion.mjs writes exactly one file")
      assert.match(text, /const completionFile = target\.path/, "and it is the path completionInstall names")
    }
    // The one rc-file write in the tree: the marked block, appended once,
    // only from completion-check.mjs, only to the file loaderBlock names,
    // and only after loaderBlockPresent said the marker is not there yet.
    const appends = [...text.matchAll(/appendFileSync\(\s*(.+)$/gm)].map((match) => match[1].trim())
    if (path === "tools/marketplace/completion-check.mjs") {
      assert.equal(appends.length, 1, "completion-check.mjs appends to exactly one file")
      assert.match(appends[0], /^rcFile,/, "and it is the rc file loaderBlock names")
      assert.match(text, /const rcFile = block\.file/, "the rc file is the block's")
      assert.match(text, /if \(loaderBlockPresent\(shell, env\)\) return \{ appended: false/, "the marker is looked for first")
      assert.equal((text.match(/writeFileSync\(/g) || []).length, 1, "and one write, the stamp")
    } else {
      assert.deepEqual(appends, [], `${path} appends to a file; only completion-check.mjs may, and only to an rc file after a yes`)
    }
    // And that allowance is only for the pin directory, not for any directory.
    for (const match of text.matchAll(/writeFileSync\(join\((\w+), "\.git\/info/g)) {
      assert.equal(match[1], "dir", `${path} writes a sparse-checkout file somewhere other than the pin directory`)
    }
    // And never into the subject's own directory.
    assert.doesNotMatch(text, /writeFileSync\([^)]*subject\.dir/, `${path} writes into the subject directory`)
    assert.doesNotMatch(text, /mkdirSync\([^)]*subject\.dir/, `${path} creates directories in the subject`)
  }
})

test("the command surface is exactly the documented scope", () => {
  const cli = readFileSync(join(REPO_ROOT, "tools/marketplace/cli.mjs"), "utf8")
  const commands = [...cli.matchAll(/command === "(-{0,2}[a-z][a-z-]*)"/g)].map((match) => match[1])
  assert.deepEqual(
    new Set(commands),
    new Set(["setup", "pin", "doctor", "upgrade", "marketplace-pin", "submit", "watch", "verify", "parity", "audit", "weigh", "inspect", "add", "help", "--help", "-h"]),
  )
  // doctor reports and prints. It must not be able to change anything, which is
  // the difference between it and the `upgrade` command this tool deliberately
  // does not have.
  const doctorSource = readFileSync(join(REPO_ROOT, "tools/marketplace/doctor.mjs"), "utf8")
  for (const name of ["writeFileSync", "mkdirSync", "rmSync", "ensurePin"]) {
    assert.ok(!doctorSource.includes(name), `doctor.mjs uses ${name}; it must only read`)
  }
  for (const forbidden of ["scaffold", "new", "init", "vendor", "template", "generate", "install"]) {
    assert.ok(!commands.includes(forbidden), `the CLI offers a ${forbidden} command`)
  }
})

test("no lab or conformance scope came along with the harvest", () => {
  // Three things live under tests/lab/: the scenario the plugin lab runs to
  // measure `omakit weigh` against a stock shell, because the weigh command
  // restarts a shell and the desktop is never where that is tested, and the
  // Run and Store blocks' suites (tests/lab/run/, tests/lab/store/), which
  // start their own Quickshell instances and never touch the shell.
  // Scenarios for one command and two blocks, not a conformance suite, and
  // none of them is in the package.
  for (const path of files) {
    assert.ok(!/^tools\/lab\//.test(path), `${path} is out of scope`)
    assert.ok(!/^tests\/lab\//.test(path) || path === "tests/lab/weigh.sh" || path.startsWith("tests/lab/run/") || path.startsWith("tests/lab/store/"), `${path} is out of scope`)
  }
})

test("the block files are the only thing add can write, and none of them is an agent-control file", () => {
  // AGENTS.md: a code path that writes into a plugin tree comes with the
  // test that proves no agent-control file can ride along. The names come
  // from blocks/<name>/ alone; the check runs over them here, and add.mjs
  // runs it again over the names it is about to write.
  const blocks = shippedBlocks()
  assert.ok(blocks.length > 0)
  const entries = blocks.flatMap((block) => [...block.files.map((entry) => ({ path: `omakit/${entry.file}`, type: "blob", mode: "100644" })), { path: "omakit/NOTICE", type: "blob", mode: "100644" }])
  assert.deepEqual(findAgentControl(entries), [])
  const tree = files.filter((path) => path.startsWith("blocks/")).map((path) => ({ path, type: "blob", mode: "100644" }))
  assert.deepEqual(findAgentControl(tree), [], "nothing under blocks/ is an agent-control file")
  for (const block of blocks) {
    for (const entry of block.files) {
      assert.ok(!AGENT_CONTROL_FILES.some((name) => name.toLowerCase() === entry.file.toLowerCase()), `${entry.file} is an agent-control name`)
      assert.ok(/\.(?:qml|py)$/.test(entry.file), `${entry.file}: a block file is QML or Python, never prose an agent reads`)
    }
  }
})

test("there is no build step and no runtime dependency", () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"))
  assert.equal(pkg.dependencies, undefined)
  assert.equal(pkg.devDependencies, undefined)
  assert.equal(pkg.scripts.build, undefined)
  assert.equal(pkg.type, "module")
  assert.equal(pkg.bin.omakit, "bin/omakit")
  assert.equal(pkg.engines.node, ">=22")
  assert.equal(pkg.license, "MIT")
  assert.equal(pkg.repository.url, "git+https://github.com/mtolhuys/omakit.git")
  assert.deepEqual(pkg.keywords, ["omarchy", "quattro", "plugin", "marketplace", "building-blocks", "qml", "quickshell", "preflight", "cli", "agent"])
  assert.deepEqual(pkg.files, ["bin", "tools", "skills", "blocks", "tests/parity/corpus.mjs", "tests/parity/run.mjs"])
  assert.ok(statSync(join(REPO_ROOT, "bin/omakit")).mode & 0o111, "bin/omakit must be executable")
  assert.ok(!files.includes("package-lock.json"))
})

test("omakit reads no environment variable of its own", () => {
  // README: "omakit reads no environment variable of its own". The pin follows
  // XDG_CACHE_HOME, the completion install follows XDG and $SHELL, and colour
  // follows NO_COLOR, FORCE_COLOR and TERM: every one of those is somebody
  // else's convention and every user already has it. No exemptions: until
  // 0.1.8 this test excused OMAKIT_ROOT and four PARITY_* names as an
  // internal handoff from cli.mjs to tests/parity/run.mjs, which made the
  // rule "no OMAKIT_* variable a user sets" by convention rather than the
  // rule as written. The runner now takes arguments.
  for (const { path, text } of sources) {
    for (const match of text.matchAll(/\benv\.([A-Z][A-Z0-9_]*)|process\.env\[["']([A-Z][A-Z0-9_]*)["']\]/g)) {
      const name = match[1] || match[2]
      if (name?.startsWith("OMAKIT_") || name?.startsWith("PARITY_")) assert.fail(`${path} reads ${name}: omakit has no environment variable of its own`)
    }
  }
})
