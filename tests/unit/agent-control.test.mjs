// The agent-control refusal: recursive, case-insensitive on the basename, and
// blind to symlinks because the marketplace's own scope skips mode 120000.
import test from "node:test"
import assert from "node:assert/strict"
import { findAgentControl } from "../../tools/marketplace/agent-control.mjs"

const blob = (path, mode = "100644") => ({ path, mode, type: "blob" })

test("every named file is found at any depth", () => {
  const hits = findAgentControl([
    blob("AGENTS.md"),
    blob("deep/nested/CLAUDE.md"),
    blob("skills/publish/SKILL.md"),
    blob(".mcp.json"),
    blob("a/b/.mcp.json"),
  ]).map((hit) => hit.path)
  assert.deepEqual(hits, [".mcp.json", "AGENTS.md", "a/b/.mcp.json", "deep/nested/CLAUDE.md", "skills/publish/SKILL.md"])
  // Codepoint order, so the list does not shift with the machine's locale.
  assert.deepEqual([...hits].sort(), hits)
})

test("agent-control directories are found at any depth", () => {
  const hits = findAgentControl([
    blob(".claude/settings.json"),
    blob("src/.codex/prompt.txt"),
    blob("src/.codex/nested/more.txt"),
  ]).map((hit) => hit.path)
  assert.deepEqual(hits, [".claude/settings.json", "src/.codex/nested/more.txt", "src/.codex/prompt.txt"])
})

test("a skills directory only trips on instruction files", () => {
  const hits = findAgentControl([
    blob("skills/notes.md"),
    blob("skills/guide.markdown"),
    blob("skills/logo.png"),
    blob("skills/helper.sh"),
  ]).map((hit) => hit.path)
  assert.deepEqual(hits, ["skills/guide.markdown", "skills/notes.md"])
})

test("lowercase copies are the same injection surface", () => {
  assert.equal(findAgentControl([blob("agents.md")]).length, 1)
  assert.equal(findAgentControl([blob("vendor/Claude.MD")]).length, 1)
})

test("symlinks are not files in the installable tree", () => {
  assert.deepEqual(findAgentControl([blob("AGENTS.md", "120000")]), [])
})

test("an ordinary plugin tree is clean", () => {
  assert.deepEqual(findAgentControl([blob("manifest.json"), blob("README.md"), blob("LICENSE"), blob("Widget.qml")]), [])
})
