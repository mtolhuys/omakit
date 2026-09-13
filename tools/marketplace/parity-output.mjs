import { accessSync, constants, existsSync } from "node:fs"
import { join, resolve } from "node:path"

export class ParityOutputError extends Error {
  constructor(message) {
    super(message)
    this.name = "ParityOutputError"
    this.code = "parity-output-required"
    this.remedy = "omakit parity --out <file>"
  }
}

/** Resolve parity evidence before any fetch, refusing a packaged read-only default. */
export function parityOutput({ repoRoot, out = null }) {
  if (out) return resolve(out)
  const evidenceRoot = join(resolve(repoRoot), "docs/evidence")
  if (!existsSync(evidenceRoot)) {
    throw new ParityOutputError(`this install has no source-tree evidence directory at ${evidenceRoot}; pass --out <file> for the parity evidence.`)
  }
  try {
    accessSync(evidenceRoot, constants.W_OK)
  } catch {
    throw new ParityOutputError(`the measured evidence directory is not writable at ${evidenceRoot}; pass --out <file> for the parity evidence.`)
  }
  return join(evidenceRoot, "parity")
}
