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
import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { findAgentControl, AGENT_CONTROL_FILES } from "../../tools/marketplace/agent-control.mjs"
import { shippedBlocks } from "../../tools/blocks/registry.mjs"
import { REPO_ROOT, repositoryFiles } from "./helpers.mjs"

const files = repositoryFiles()
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
    // The one exception is the lab's own root (tools/lab/paths.mjs): a
    // verified ISO is renamed from its .part name and a staged base is
    // promoted with one rename, both to a target built by inLab, which
    // refuses a path outside the lab cache; and a stream copy into the lab
    // (copyIntoLab) is the only way bytes enter it. Counted below.
    for (const primitive of ["cpSync", "copyFileSync", "copyFile", "renameSync", "symlinkSync", "linkSync"]) {
      if (path === "tools/lab/paths.mjs" && primitive === "renameSync") continue
      assert.ok(!new RegExp(`\\b${primitive}\\s*\\(`).test(text), `${path} uses ${primitive}`)
    }
    if (path === "tools/lab/paths.mjs") {
      assert.equal((text.match(/renameSync\(/g) || []).length, 1, "paths.mjs renames in one place")
      assert.match(text, /const to = inLab\(root, relative\)\n[\s\S]*?renameSync\(from, to\)/, "and the target is inLab's")
      assert.match(text, /createWriteStream\(to, \{ mode: 0o600, flags: "wx" \}\)/, "the stream copy never overwrites")
    } else if (path === "tools/lab/setup.mjs") {
      assert.equal((text.match(/createWriteStream\(/g) || []).length, 1, "setup.mjs streams one thing: the download, to its .part file")
      assert.match(text, /const part = `\$\{to\}\.part`[\s\S]*?createWriteStream\(part, /, "and only there")
    } else {
      assert.doesNotMatch(text, /createWriteStream\(|\bpipeline\(/, `${path} streams bytes to disk; only tools/lab/paths.mjs (copyIntoLab) and setup.mjs (the .part download) may`)
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
    // The release tool writes one file, the commit record under this
    // checkout's tools/blocks/ (commitFile, in record-commit.mjs), run by
    // the workflow before npm pack and never at install time.
    const commitWrites = path === "tools/blocks/record-commit.mjs" ? /^commitFile,/ : /$^/
    // The lab writes under its own two roots only: every target is built
    // by inLab (tools/lab/paths.mjs), which throws for a path outside the
    // lab cache or state, or is a descriptor opened on such a path
    // (writeJson's fd, a run's host log, a build's log). tests/unit/lab.test.mjs
    // proves the guard; this holds every write to it.
    const labWrites = path.startsWith("tools/lab/") ? /^inLab\(|^fd,|^hostLog,|^log,/ : /$^/
    for (const match of text.matchAll(/writeFileSync\(\s*(.+)$/gm)) {
      const target = match[1]
      assert.ok(
        /resolve\(out\)|outFile|join\(out|evidence|\.git\/info|^completionFile,|^join\(liveCache,/.test(target) || weighWrites.test(target) || completionWrites.test(target) || updateWrites.test(target) || blockWrites.test(target) || commitWrites.test(target) || labWrites.test(target),
        `${path} writes to ${target.trim()}, which is neither --out, an evidence path, the pin's own .git/info, the live registry cache, the completion script, a block file, a lab path, nor one of the three files weigh may write`,
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
    } else if (path === "tools/blocks/record-commit.mjs") {
      assert.equal((text.match(/writeFileSync\(/g) || []).length, 1, "record-commit.mjs writes the commit record and nothing else")
      assert.match(text, /const commitFile = file\n/, "and the record is tools/blocks/commit.json in the tree it was given")
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
    new Set(["setup", "pin", "doctor", "upgrade", "marketplace-pin", "submit", "watch", "verify", "parity", "audit", "weigh", "inspect", "add", "lab", "help", "--help", "-h"]),
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

test("the lab ships the ability to acquire a lab, and never an image", () => {
  // packaging/LAB_PLAN.md, the central boundary: omakit may carry
  // orchestration code, a reviewed release pin, the Omarchy public signing
  // key and text fixtures, and never an ISO, a disk image, firmware
  // variables, an overlay, or a compressed or renamed form of one. The
  // tree is walked, not the package list, and every file is sniffed for a
  // disk-image or archive signature rather than trusted by its name.
  const IMAGE_NAMES = /\.(?:iso|qcow2?|img|raw|vmdk|vdi|ova|ovf|fd|tar|tgz|zip|xz|gz|zst|7z)$/i
  const SIGNATURES = [
    ["QFI\u00fb", "qcow"], ["KDMV", "vmdk"], ["<<< Oracle VM VirtualBox Disk Image", "vdi"], ["CD001", "iso9660"],
    ["\u001f\u008b", "gzip"], ["\u00fd7zXZ", "xz"], ["PK\u0003\u0004", "zip"], ["7z\u00bc\u00af", "7z"], ["\u0028\u00b5\u002f\u00fd", "zstd"], ["ustar", "tar"],
  ]
  for (const path of files) {
    assert.ok(!IMAGE_NAMES.test(path), `${path} is an image or archive by name`)
    const st = statSync(join(REPO_ROOT, path))
    if (st.size > 1024 * 1024) assert.fail(`${path} is ${st.size} bytes; nothing in this tree is a megabyte`)
    const head = readFileSync(join(REPO_ROOT, path)).subarray(0, 40000).toString("latin1")
    for (const [magic, kind] of SIGNATURES) {
      const at = head.indexOf(magic)
      // A signature at an offset where the format keeps it (qcow at 0, CD001 at 32769, tar's ustar at 257, the rest at 0).
      const positions = kind === "iso9660" ? [32769] : kind === "tar" ? [257] : [0]
      assert.ok(!positions.includes(at), `${path} carries a ${kind} signature`)
    }
  }
  // The lab's own tree: orchestration, the pin, the key, a patch, bash. Nothing else.
  const lab = files.filter((path) => path.startsWith("tools/lab/"))
  for (const path of lab) assert.match(path, /\.(?:mjs|sh|json|gpg|patch)$/, `${path} is not code, a pin, a key or a patch`)
  assert.ok(lab.includes("tools/lab/pin.json") && lab.includes("tools/lab/omarchy.gpg"))
  // And no lifecycle hook can acquire anything at install time.
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"))
  for (const hook of ["preinstall", "install", "postinstall", "prepare", "prepack", "postpack", "prepublish", "prepublishOnly"]) {
    assert.equal(pkg.scripts?.[hook], undefined, `package.json has a ${hook} script`)
  }
  // The in-guest suites stay with the tests: three directories and nothing else under tests/lab/.
  for (const path of files) {
    assert.ok(!/^tests\/lab\//.test(path) || path.startsWith("tests/lab/run/") || path.startsWith("tests/lab/store/"), `${path} is out of scope`)
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
