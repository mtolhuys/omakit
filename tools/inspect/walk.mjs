// The installable tree of the subject, filtered to what `inspect` reads for
// facts: QML, JavaScript, shell and Python by extension, and any other blob
// that opens with a shebang or carries the executable bit. Prose is never
// read for facts (the 0.1 Passport counted a README sentence naming `curl`
// as a process); `manifest.json` is read for the id and the entry points,
// and the README only to answer whether a privileged tool the argv names
// is mentioned there, which is a question about the README, not a fact
// about the tree.
//
// Read-only, from the Git object database at the subject commit through
// tree.mjs (`git ls-tree`, `git cat-file`), so a working-tree edit that is
// not committed is not inspected and nothing in the tree is opened as a
// file.

import { isBlob, readBlob, readText, readTree } from "../marketplace/tree.mjs"

/** The extensions that name a kind outright. */
const KIND_BY_EXTENSION = Object.freeze({
  qml: "qml",
  js: "js",
  mjs: "js",
  cjs: "js",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  py: "python",
})

/** The interpreter a shebang names, as a kind; anything else is `other`. */
export function kindOfShebang(line) {
  const first = String(line || "").split("\n")[0]
  if (!first.startsWith("#!")) return null
  const words = first.slice(2).trim().split(/\s+/)
  const interpreter = (words[0] === "/usr/bin/env" ? words[1] : words[0]) || ""
  const name = interpreter.split("/").pop().replace(/\d+(?:\.\d+)*$/, "")
  if (["sh", "bash", "zsh", "fish", "dash", "ksh"].includes(name)) return "shell"
  if (name === "python") return "python"
  if (["node", "deno", "bun"].includes(name)) return "js"
  return "other"
}

/** Paths whose every segment is visible: `.git/`, `.github/` and any dot entry are out, as they are for the installable tree. */
function visible(path) {
  return !path.split("/").some((segment) => segment.startsWith("."))
}

const README = /^readme(?:\.[^/]+)?$/i
const EXECUTABLE = "100755"
const TEXT_LIMIT = 1024 * 1024

/**
 * @param {{ dir: string, commit: string, subdir?: string }} subject
 * @returns {{
 *   files: Array<{ path: string, kind: "qml"|"js"|"shell"|"python"|"other", text: string, shebang: string|null, executable: boolean }>,
 *   filesRead: { qml: number, js: number, shell: number, python: number, other: number },
 *   manifest: object|null, manifestError: string|null, readme: string|null, entries: Array,
 * }}
 */
export function walkSubject(subject) {
  const prefix = subject.subdir ? `${subject.subdir}/` : ""
  const entries = readTree(subject.dir, subject.commit)
    .filter((entry) => isBlob(entry) && entry.path.startsWith(prefix))
    .map((entry) => ({ ...entry, path: entry.path.slice(prefix.length) }))
    .filter((entry) => visible(entry.path))
  const files = []
  let manifest = null
  let manifestError = null
  let readme = null
  for (const entry of entries) {
    if (entry.path === "manifest.json") {
      try {
        manifest = JSON.parse(readText(subject.dir, entry.sha))
      } catch (error) {
        manifestError = error.message
      }
      continue
    }
    if (!entry.path.includes("/") && README.test(entry.path)) {
      readme = readText(subject.dir, entry.sha, TEXT_LIMIT)
      continue
    }
    const extension = entry.path.includes(".") ? entry.path.split(".").pop().toLowerCase() : ""
    let kind = KIND_BY_EXTENSION[extension] || null
    const executable = entry.mode === EXECUTABLE
    let shebang = null
    if (kind || executable || entry.size <= TEXT_LIMIT) {
      // A file without a naming extension is opened only far enough to see
      // whether it starts with a shebang; the whole text is read for the
      // kinds that are inspected.
      const head = readBlob(subject.dir, entry.sha).subarray(0, 256).toString("utf8")
      if (head.startsWith("#!")) shebang = head.split("\n")[0]
    }
    if (!kind && shebang) kind = kindOfShebang(shebang)
    if (!kind && executable) kind = "other"
    if (!kind) continue
    files.push({ path: entry.path, kind, text: readText(subject.dir, entry.sha, TEXT_LIMIT), shebang, executable })
  }
  const filesRead = { qml: 0, js: 0, shell: 0, python: 0, other: 0 }
  for (const file of files) filesRead[file.kind] += 1
  return { files, filesRead, manifest, manifestError, readme, entries }
}
