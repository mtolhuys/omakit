export const REVIEW_CASES = [
  { name: "manual queue", manual: true, count: 0, capabilities: ["privilege", "installer"], verdict: "fail" },
  { name: "manual queue, again", manual: true, count: 2, capabilities: ["installer"], verdict: "fail" },
  { name: "automated", manual: false, count: 0, capabilities: [], verdict: "pass" },
]

export const DOCUMENTATION_DIFFS = [
  { docsOnly: true, files: [{ filename: "README.md" }, { filename: "docs/usage.txt" }, { filename: "LICENSE" }, { filename: "images/badge.svg" }] },
  { docsOnly: true, files: [{ filename: "docs/new.md", previous_filename: "README.md", status: "renamed" }] },
  { docsOnly: false, files: [{ filename: "README.md" }, { filename: "Widget.qml" }] },
  { docsOnly: false, files: [{ filename: "package.json" }] },
  { docsOnly: false, files: [{ filename: "image-cache/state.json" }] },
  { docsOnly: false, files: [{ filename: "docs/new.md", previous_filename: "install.sh", status: "renamed" }] },
  { docsOnly: false, files: [{ filename: "install.sh", previous_filename: "docs/script.sh", status: "renamed" }] },
  { docsOnly: false, files: [] },
]
