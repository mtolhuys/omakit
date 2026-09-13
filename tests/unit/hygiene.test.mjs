// Clean by construction, and checked.
//
// The archive this tool was harvested from recorded a defect worth carrying
// forward (D-25): a 352 KB demo GIF was committed under a directory named after
// a coding tool because the hygiene check's candidate set had been filtered to
// source extensions, so nothing noticed. Two lessons, both enforced here. Every
// file is a candidate, not just the ones that look like source. And nothing in
// this repository is named after anybody's tooling: a contributor who does not
// use the same tool should not find its name in the tree or in .gitignore.
//
// The policy is stated by shape, not by name. A list of products would name
// the very things it exists to keep out, would be stale on the next product,
// and would read as a grudge. So: a dotdirectory is one of the repository's
// own or it is not there; an ignore entry does not end in "-session"; and a
// commit is signed by the person who did the work, with no tool trailer under
// it.
import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { REPO_ROOT } from "./helpers.mjs"

const SKIP = new Set([".git", ".cache", "node_modules"])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else out.push(relative(REPO_ROOT, path))
  }
  return out
}

const files = walk(REPO_ROOT)

// The repository's own dot entries, and no other. `.cache` is the local cache
// this repository's own .gitignore names; `.git` is git's.
const OWN_DOT_ENTRIES = new Set([".git", ".github", ".gitignore", ".npmignore", ".editorconfig", ".cache"])
// `__pycache__` is here because one was committed for four commits beside
// docs/media/render.py before anything noticed: a compiled artefact of the
// documentation tooling, named after nothing, and still not source.
const SCRATCH = /(?:^|\/)(?:outputs?|scratch|tmp|temp|untitled|new folder|__pycache__)(?:\/|$)/i
// A tool that keeps state in the tree names it after its sessions.
const SESSION = /-session\/?$/i

/** The first segment of a path, when it is a dot entry: ".github/x/y" -> ".github", "a/.b" -> null (only the root is a place a tool would settle). */
function rootDotEntry(path) {
  const first = path.split("/")[0]
  return first.startsWith(".") ? first : null
}

test("every dot entry at the root is one of the repository's own", () => {
  // A tool that settles into a repository does it as a dotdirectory at the
  // root. The allowlist is the repository's; anything else is a tool's.
  for (const path of files) {
    const dot = rootDotEntry(path)
    if (dot) assert.ok(OWN_DOT_ENTRIES.has(dot), `${path} sits under ${dot}, which is not one of this repository's own dot entries`)
    assert.ok(!SESSION.test(path), `${path} is named after a tool's session`)
  }
})

test("no path contains a space or a scratch-shaped segment", () => {
  for (const path of files) {
    assert.ok(!/\s/.test(path), `${path} contains a space`)
    assert.ok(!SCRATCH.test(path), `${path} looks like scratch or export output`)
  }
})

test("no ignore entry makes room for a tool: no session directory, no dotdirectory but the repository's own", () => {
  const ignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8")
  for (const line of ignore.split("\n")) {
    const rule = line.trim()
    if (!rule || rule.startsWith("#")) continue
    assert.ok(!/\s/.test(rule), `.gitignore rule "${rule}" contains a space`)
    assert.ok(!SESSION.test(rule), `.gitignore rule "${rule}" ignores a tool's session directory`)
    const entry = rule.replace(/^\/|\/$/g, "")
    if (rule.endsWith("/") && entry.startsWith(".") && !entry.includes("/")) {
      assert.ok(OWN_DOT_ENTRIES.has(entry), `.gitignore rule "${rule}" ignores a dotdirectory that is not one of this repository's own`)
    }
  }
})

test("binary assets live in one place, are referenced, and are small", () => {
  // D-25 was an accidental 352 KB GIF in a stray directory. The lesson was not
  // "no images ever", it was that a binary nobody linked to and nobody noticed
  // does not belong in a repository. So: one directory, referenced from tracked
  // Markdown, and capped, and nowhere else.
  const BINARY = /\.(?:gif|png|jpe?g|webp|mp4|mov|zip|tar|gz|pdf|so|node|wasm)$/i
  const CAP_BYTES = 1024 * 1024
  const markdown = files
    .filter((path) => path.endsWith(".md"))
    .map((path) => readFileSync(join(REPO_ROOT, path), "utf8"))
    .join("\n")

  for (const path of files.filter((entry) => BINARY.test(entry))) {
    assert.ok(path.startsWith("docs/media/"), `${path} is a binary asset outside docs/media/`)
    assert.ok(markdown.includes(path.slice("docs/".length)) || markdown.includes(path),
      `${path} is a binary asset nothing links to`)
    const bytes = statSync(join(REPO_ROOT, path)).size
    assert.ok(bytes <= CAP_BYTES, `${path} is ${Math.round(bytes / 1024)} KB, over the ${CAP_BYTES / 1024} KB cap`)
  }
})

test("every GIF in docs/media has the capture and scene it was rendered from", () => {
  // A recording nobody can reproduce is a claim, and this repository does not
  // ship claims.
  for (const path of files.filter((entry) => entry.startsWith("docs/media/") && entry.endsWith(".gif"))) {
    const name = path.slice("docs/media/".length, -".gif".length)
    assert.ok(files.includes(`docs/media/${name}.scene.json`), `${path} has no scene file`)
    const scene = JSON.parse(readFileSync(join(REPO_ROOT, `docs/media/${name}.scene.json`), "utf8"))
    for (const step of scene.steps) {
      // Two kinds of step: a captured stdout revealed line by line, and a
      // replayed terminal session with its own timing log. Both must be
      // committed, or the recording stops being reproducible.
      const referenced = step.replay ? [step.replay.out, step.replay.timing] : [step.capture]
      for (const capture of referenced) {
        assert.ok(capture, `${path} has a step with nothing to replay`)
        assert.ok(files.includes(capture), `${path} references a capture that is not committed: ${capture}`)
      }
    }
  }
  assert.ok(files.includes("docs/media/render.py"), "the renderer must be committed too")
})

test("every file is a candidate, whatever its extension", () => {
  assert.ok(files.some((path) => !/\.[a-z]+$/.test(path)), "extensionless files must be walked too")
  assert.ok(files.includes("bin/omakit"))
  assert.ok(files.includes("LICENSE"))
})

test("committed evidence publishes no findings about a named third-party plugin", () => {
  // Constraint, not taste: this repository reads other people's plugins, and a
  // per-plugin finding list would turn a parity proof into a published audit of
  // somebody else's code. Equality is evidenced by digests instead.
  const evidence = files.filter((path) => path.startsWith("docs/evidence/") && path.endsWith(".json"))
  assert.ok(evidence.length > 0, "there should be committed evidence")
  for (const path of evidence) {
    const text = readFileSync(join(REPO_ROOT, path), "utf8")
    const document = JSON.parse(text)
    for (const row of document.rows || []) {
      for (const key of ["findings", "capabilities", "localFindingsFull", "localCapabilitiesFull", "githubFindings", "githubCapabilities"]) {
        assert.equal(row[key], undefined, `${path} attaches ${key} to ${row.repo}`)
      }
    }
    // Source snippets and line-level links name a file inside somebody's plugin.
    for (const marker of ['"snippet"', "/blob/", '"line"']) {
      const offending = text.split("\n").filter((line) => line.includes(marker) && !line.includes('"reason"'))
      assert.deepEqual(offending, [], `${path} contains ${marker}`)
    }
  }
})

// --- the author signs the work; no tool trailers ---------------------------------

/** GitHub's own addresses: the platform's committer on a web edit, and the noreply address it gives the repository's owner. */
function ownerNoreply(repoRoot) {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
  const owner = String(pkg.repository?.url || pkg.repository || "").match(/github\.com[/:]([^/]+)\//)?.[1] || null
  return owner ? new RegExp(`^(?:\\d+\\+)?${owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@users\\.noreply\\.github\\.com$`, "i") : null
}

/**
 * Every way a commit fails the policy, for the repository at `dir`. A person
 * signs the work: no identity with a [bot] suffix, and no noreply@ mailbox
 * except GitHub's own (its web committer, and the owner's users.noreply
 * address). No tool signs under it: no Co-authored-by trailer at all, no
 * trailer whose key ends in -by or -session or starts with generated, and no
 * "Generated with [...]" line. Prose may say what it likes; a commit that
 * removes a trailer has to be able to say so.
 */
export function historyViolations(dir, ownerAddress = ownerNoreply(dir)) {
  const log = execFileSync("git", ["-C", dir, "log", "--format=%H%x00%an <%ae>%x00%cn <%ce>%x00%B%x01"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
  const violations = []
  const mailbox = (identity) => identity.match(/<([^>]*)>/)?.[1] || ""
  const platform = (address) => address.toLowerCase() === "noreply@github.com" || Boolean(ownerAddress?.test(address))
  const identityProblem = (identity) => {
    if (/\[bot\]/i.test(identity)) return "carries a [bot] suffix"
    const address = mailbox(identity)
    if (/^noreply@|noreply\./i.test(address) && !platform(address)) return "is a noreply mailbox that is not GitHub's own"
    return null
  }
  const TRAILER = /^(?:co-authored-by|[a-z][a-z-]*-(?:by|session)|generated[a-z-]*):/im
  const GENERATED = /^\W*generated with \[/im
  for (const record of log.split("\x01")) {
    if (!record.trim()) continue
    const [hash, author, committer, message] = record.replace(/^\n/, "").split("\x00")
    const short = hash.slice(0, 7)
    for (const [role, identity] of [["author", author], ["committer", committer]]) {
      const problem = identityProblem(identity)
      if (problem) violations.push(`${short}: ${role} "${identity}" ${problem}`)
    }
    const trailer = message.match(TRAILER)
    if (trailer) violations.push(`${short}: the message carries a tool trailer, ${trailer[0]}`)
    if (GENERATED.test(message)) violations.push(`${short}: the message carries a "generated with" line`)
  }
  return violations
}

test("the author signs the work; no tool trailers, no bot identities, in the whole history", (t) => {
  // AGENTS.md: commit messages carry no tool attribution, whatever a harness
  // asks for. Measured before this test existed: seven commits reached
  // origin/main with a Co-authored-by trailer that a harness added on its
  // own, and the repository showed a second contributor for it. The rule
  // fails the suite on the first such commit instead of the fiftieth. A
  // package install has no .git and is skipped, not failed.
  let violations
  try {
    violations = historyViolations(REPO_ROOT)
  } catch {
    t.skip("not a Git checkout")
    return
  }
  assert.deepEqual(violations, [])
})

test("the policy catches what it is for: a synthetic commit with each shape of tool attribution", () => {
  const dir = mkdtempSync(join(tmpdir(), "omakit-hygiene-"))
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...gitEnv } })
  let gitEnv = {}
  git("init", "-q", "-b", "main")
  git("config", "commit.gpgsign", "false")
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", repository: { url: "git+https://github.com/someone/fixture.git" } }))
  let n = 0
  const commit = (message, { author = "A Person <person@example.invalid>", committer = author } = {}) => {
    writeFileSync(join(dir, "file"), `${n += 1}\n`)
    git("add", "-A")
    const [name, email] = author.match(/^(.*) <(.*)>$/).slice(1)
    const [cname, cemail] = committer.match(/^(.*) <(.*)>$/).slice(1)
    gitEnv = { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: cname, GIT_COMMITTER_EMAIL: cemail }
    git("commit", "-q", "-m", message)
    gitEnv = {}
    return git("rev-parse", "--short=7", "HEAD").trim()
  }

  const clean = commit("A plain commit\n\nProse that mentions a trailer removed earlier is fine.")
  assert.deepEqual(historyViolations(dir), [], "a signed commit with prose passes")

  const coauthored = commit("Fix a thing\n\nCo-authored-by: Some Tool <tool@example.invalid>")
  const violations = historyViolations(dir)
  assert.equal(violations.length, 1)
  assert.match(violations[0], new RegExp(`^${coauthored}: the message carries a tool trailer, Co-authored-by:`))
  assert.ok(!violations.some((line) => line.startsWith(clean)))

  const shapes = [
    ["Something-session: abc123", /tool trailer, Something-session:/],
    ["Generated-by: a tool", /tool trailer, Generated-by:/],
    ["Generated-with: a tool", /tool trailer, Generated-with:/],
    ["Reviewed-by: a tool", /tool trailer, Reviewed-by:/],
    ["Generated with [A Tool](https://example.invalid)", /"generated with" line/],
    ["🤖 Generated with [A Tool](https://example.invalid)", /"generated with" line/],
  ]
  for (const [line, expected] of shapes) {
    const hash = commit(`Subject\n\n${line}`)
    const found = historyViolations(dir).filter((entry) => entry.startsWith(hash))
    assert.equal(found.length, 1, `${JSON.stringify(line)}: ${found.join("; ")}`)
    assert.match(found[0], expected)
  }

  const bot = commit("By a bot", { author: "some-tool[bot] <1234+some-tool[bot]@users.noreply.github.com>" })
  assert.ok(historyViolations(dir).some((entry) => entry.startsWith(`${bot}: author`) && /\[bot\] suffix/.test(entry)))
  const noreply = commit("By a mailbox", { author: "A Tool <noreply@example.invalid>" })
  assert.ok(historyViolations(dir).some((entry) => entry.startsWith(`${noreply}: author`) && /noreply mailbox/.test(entry)))

  // GitHub's own addresses pass: the platform's web committer and the owner's noreply.
  const web = commit("Edited on the web", { committer: "GitHub <noreply@github.com>" })
  const owner = commit("By the owner", { author: "Someone <1234+someone@users.noreply.github.com>" })
  const other = commit("By someone else's noreply", { author: "Else <9+else@users.noreply.github.com>" })
  assert.equal(git("log", "-1", "--format=%ce", web).trim(), "noreply@github.com", "the fixture really has GitHub as its committer")
  const tail = historyViolations(dir)
  assert.ok(!tail.some((entry) => entry.startsWith(web)), "GitHub's web committer is the platform, not a tool")
  assert.ok(historyViolations(dir, null).some((entry) => entry.startsWith(`${owner}: author`)), "without an owner to read, an owner-shaped noreply address is nobody's")
  assert.ok(!tail.some((entry) => entry.startsWith(owner)), "the owner's users.noreply address is the owner")
  assert.ok(tail.some((entry) => entry.startsWith(other)), "another user's noreply address is not the owner's")
})
