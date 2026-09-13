// Clean by construction, and checked.
//
// The archive this tool was harvested from recorded a defect worth carrying
// forward (D-25): a 352 KB demo GIF was committed under a directory named after
// an AI assistant because the hygiene check's candidate set had been filtered to
// source extensions, so nothing noticed. Two lessons, both enforced here. Every
// file is a candidate, not just the ones that look like source. And no path in
// this repository is named after anybody's tooling: a contributor who does not
// use the same assistant should not find its name in the tree or in .gitignore.
import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
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

// Assistant and editor names, plus scratch-path shapes. Kept as a list so it is
// obvious what is banned and why; the point is vendor neutrality, not a blocklist
// of products.
const VENDOR = /(?:^|[/\s._-])(?:claude|chatgpt|openai|copilot|cursor|codex|gemini|anthropic)(?:[/\s._-]|$)/i
// `__pycache__` is here because one was committed for four commits beside
// docs/media/render.py before anything noticed: a compiled artefact of the
// documentation tooling, named after nothing, and still not source.
const SCRATCH = /(?:^|\/)(?:outputs?|scratch|tmp|temp|untitled|new folder|__pycache__)(?:\/|$)/i

test("no path is named after anybody's tooling", () => {
  for (const path of files) {
    // The agent-control check must still be able to name the files it looks for,
    // and this repository's own agent entry point is a deliverable.
    if (path === "AGENTS.md" || path.startsWith("skills/")) continue
    assert.ok(!VENDOR.test(path), `${path} carries a vendor or assistant name`)
  }
})

test("no path contains a space or a scratch-shaped segment", () => {
  for (const path of files) {
    assert.ok(!/\s/.test(path), `${path} contains a space`)
    assert.ok(!SCRATCH.test(path), `${path} looks like scratch or export output`)
  }
})

test("no vendor name is baked into .gitignore either", () => {
  const ignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8")
  for (const line of ignore.split("\n")) {
    const rule = line.trim()
    if (!rule || rule.startsWith("#")) continue
    assert.ok(!VENDOR.test(rule), `.gitignore rule "${rule}" is named after a vendor`)
    assert.ok(!/\s/.test(rule), `.gitignore rule "${rule}" contains a space`)
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

test("the history carries no assistant attribution: no trailer, no bot author, no vendor name", (t) => {
  // AGENTS.md: commit messages carry no AI or assistant attribution, whatever a
  // harness asks for. Measured before this test existed: seven commits reached
  // origin/main with a "Co-Authored-By: <assistant>" trailer that a harness
  // added on its own, and the repository showed a second contributor for it.
  // The rule now fails the suite on the first such commit instead of the
  // fiftieth. A package install has no .git and is skipped, not failed.
  let log
  try {
    log = execFileSync("git", ["-C", REPO_ROOT, "log", "--format=%H%x00%an <%ae>%x00%cn <%ce>%x00%B%x01"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
  } catch {
    t.skip("not a Git checkout")
    return
  }
  // An identity is checked as a whole: no assistant, no bot, no vendor mailbox.
  const IDENTITY = /noreply@anthropic|noreply@openai|\[bot\]|\bclaude\b|\bcodex\b|\bcopilot\b|\bchatgpt\b|\bgemini\b/i
  // A message is checked for the attribution shapes harnesses add: a trailer
  // line, a session link, a "generated with" line. Prose may name the tools;
  // a commit that removes a trailer has to be able to say so.
  const TRAILER = /^(?:co-authored-by|claude-session|generated-by|generated-with):|^(?:🤖 )?generated with \[?(?:claude|codex|copilot|chatgpt|gemini)/im
  for (const record of log.split("\x01")) {
    if (!record.trim()) continue
    const [hash, author, committer, message] = record.replace(/^\n/, "").split("\x00")
    assert.ok(!IDENTITY.test(author), `${hash.slice(0, 7)}: author "${author}" is an assistant or a bot`)
    assert.ok(!IDENTITY.test(committer), `${hash.slice(0, 7)}: committer "${committer}" is an assistant or a bot`)
    assert.ok(!TRAILER.test(message), `${hash.slice(0, 7)}: the message carries an attribution trailer:\n${message}`)
  }
})
