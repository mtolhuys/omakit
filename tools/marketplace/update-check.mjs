// A passive npm-version notice. Only metadata and a throttle stamp are stored;
// nothing is installed or executed. Explicit doctor checks bypass this throttle.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { compareVersions, registryLatest, upgradeCommand } from "./upgrade.mjs"

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
export const UPDATE_RETRY_INTERVAL_MS = 60 * 60 * 1000
export const UPDATE_CHECK_TIMEOUT_MS = 1000

export function updateCheckEnabled({ command, args = [], stdinTTY, stdoutTTY, stderrTTY, env = process.env }) {
  return Boolean(stdinTTY && stdoutTTY && stderrTTY)
    && !env.DISABLE_UPDATE_NOTIFIER && !env.CI
    && !args.some((arg) => arg === "--offline" || arg === "--json" || arg === "--agent" || arg === "--out" || arg.startsWith("--out="))
    && (command === undefined || ["watch", "submit", "verify", "audit", "weigh"].includes(command))
    && !args.includes("--help") && !args.includes("-h")
}

/** At most one registry read and one notice per successful day (failure retries after an hour). */
export async function updateNotice({ repoRoot, version, name = "omakit", env = process.env, now = Date.now(), latest = registryLatest, timeoutMs = UPDATE_CHECK_TIMEOUT_MS }) {
  if (compareVersions(version, version) === null) return null
  const updateFile = join(env.XDG_STATE_HOME || join(homedir(), ".local/state"), "omakit", "update-check.json")
  try {
    const cached = JSON.parse(readFileSync(updateFile, "utf8"))
    const age = now - cached.checkedAt
    const validMetadata = cached.latest === null || compareVersions(cached.latest, cached.latest) !== null
    if (cached.installed === version && cached.name === name && validMetadata && Number.isFinite(age) && age >= 0
      && age < (cached.latest ? UPDATE_CHECK_INTERVAL_MS : UPDATE_RETRY_INTERVAL_MS)) return null
  } catch { /* Missing or malformed state triggers a fresh bounded read. */ }
  const controller = new AbortController()
  let timer
  let published
  try {
    published = await Promise.race([
      Promise.resolve().then(() => latest(name, { signal: controller.signal })).catch(() => ({ version: null })),
      new Promise((resolve) => { timer = setTimeout(() => { controller.abort(); resolve({ version: null }) }, timeoutMs) }),
    ])
  } finally { clearTimeout(timer) }
  const newest = compareVersions(published?.version, published?.version) === null ? null : published.version
  try {
    mkdirSync(dirname(updateFile), { recursive: true })
    writeFileSync(updateFile, `${JSON.stringify({ name, installed: version, latest: newest, checkedAt: now })}\n`, { mode: 0o600 })
  } catch { /* An unwritable state directory must not break the user's command. */ }
  return newest && compareVersions(newest, version) > 0
    ? `Omakit ${newest} is available (installed ${version}). Run \`${upgradeCommand(repoRoot, name)}\`.`
    : null
}
