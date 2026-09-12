import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { marketplacePinDir } from "../../tools/marketplace/pin.mjs"

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url))

export function requirePinForTests() {
  const dir = marketplacePinDir(REPO_ROOT)
  if (!existsSync(join(dir, "scripts/security-baseline-policy.mjs"))) {
    throw new Error(`no pinned marketplace checkout at ${dir}. Run ./bin/omakit pin first.`)
  }
  return dir
}
