// The agent-control check.
//
// Measured reason (docs/MEASUREMENTS.md M3): 103 marketplace issues mention
// agent-control files. The maintainer treats an instruction file inside an
// installed plugin as a prompt-injection surface and blocks listing on it; in a
// 328-comment sample of his review writing, 24 comments are about exactly this.
// It is not detected by the marketplace's automated baseline, so an author
// learns about it only from a human review round, which is the most expensive
// round there is.
//
// This is an Omakit check, derived from public issue text, not a marketplace
// rule. The verdict field says so, and the wording never reuses the
// marketplace's outcome vocabulary.

import { isBlob } from "./tree.mjs"

// Names an agent reads as instructions when the plugin is installed.
export const AGENT_CONTROL_FILES = Object.freeze(["AGENTS.md", "CLAUDE.md", "SKILL.md", ".mcp.json"])
export const AGENT_CONTROL_DIRECTORIES = Object.freeze([".claude", ".codex"])
export const INSTRUCTION_DIRECTORY = "skills"
export const INSTRUCTION_EXTENSIONS = Object.freeze([".md", ".markdown", ".mdc"])

export const REMEDY = Object.freeze([
  "Move the guidance to a non-agent filename such as DEVELOPMENT.md.",
  "Untrack the originals (git rm --cached) so they leave the installable tree, and add them to .gitignore.",
  "Keep a recursive release check so they cannot return.",
])

function basename(path) {
  const slash = path.lastIndexOf("/")
  return slash === -1 ? path : path.slice(slash + 1)
}

function segments(path) {
  return path.split("/")
}

/**
 * Find every agent-control file anywhere in the tree.
 *
 * Matching is case-insensitive on the basename: agents read `agents.md` as
 * readily as `AGENTS.md`, so a lowercase copy is the same injection surface.
 *
 * @param {Array<{ path: string, mode: string, type: string }>} entries
 * @returns {Array<{ path: string, reason: string }>}
 */
export function findAgentControl(entries) {
  const files = new Set(AGENT_CONTROL_FILES.map((name) => name.toLowerCase()))
  const directories = new Set(AGENT_CONTROL_DIRECTORIES.map((name) => name.toLowerCase()))
  const hits = []
  for (const entry of entries) {
    if (!isBlob(entry)) continue
    const parts = segments(entry.path)
    const name = basename(entry.path).toLowerCase()
    const directory = parts.slice(0, -1).find((part) => directories.has(part.toLowerCase()))
    if (directory) {
      hits.push({ path: entry.path, reason: `inside an agent-control directory (${directory}/)` })
      continue
    }
    if (files.has(name)) {
      hits.push({ path: entry.path, reason: `agent-control file (${basename(entry.path)})` })
      continue
    }
    const inSkills = parts.slice(0, -1).some((part) => part.toLowerCase() === INSTRUCTION_DIRECTORY)
    if (inSkills && INSTRUCTION_EXTENSIONS.some((extension) => name.endsWith(extension))) {
      hits.push({ path: entry.path, reason: `instruction file inside a ${INSTRUCTION_DIRECTORY}/ directory` })
    }
  }
  // Codepoint order, not locale order: the output is read and compared by
  // agents and tests, so it must not depend on the machine's locale data.
  return hits.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}
