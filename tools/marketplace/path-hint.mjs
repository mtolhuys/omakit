// Is `omakit` reachable as a bare command, and if not, the one line that makes
// it so, for the install that is actually here.
//
// Measured: after `npm install --global omakit` on a machine whose npm prefix
// was a directory under ~/.local/share, the command was missing, because that
// prefix's `bin` was not on PATH. `omakit setup` then printed the `ln -s` hint
// written for a clone, which points at a bin/omakit that npm did not lay out
// where the hint assumes. An npm install needs the npm prefix's `bin` on PATH,
// and the way to say that depends on the shell in $SHELL. Nothing here writes
// to an rc file: the line is printed, and adding it is the user's.

import { existsSync } from "node:fs"
import { basename, delimiter, join } from "node:path"
import { installKind, npmGlobalPrefix } from "./upgrade.mjs"

/** Is `name` reachable as a bare command, without asking a shell? */
export function onPath(name = "omakit", env = process.env) {
  return (env.PATH || "").split(delimiter).some((dir) => dir && existsSync(join(dir, name)))
}

/** The rc file each supported shell reads at start, for the person to add the line to. */
const RC = Object.freeze({ bash: "~/.bashrc", zsh: "~/.zshrc" })

/**
 * @param {{ repoRoot: string, entryPoint: string, env?: object, npmPrefix?: () => string|null }} options
 *   `npmPrefix` is injectable for tests; the default asks the npm on PATH.
 * @returns {{ kind: "git"|"npm"|"distro", reachable: boolean, reason: string|null,
 *             line: string|null, where: string|null }}
 *   `line` is the command that puts `omakit` on PATH; `where` is the rc file
 *   to keep it in, or null when the shell keeps it itself (fish) or is not
 *   one of the three with a script.
 */
export function pathHint({ repoRoot, entryPoint, env = process.env, npmPrefix = npmGlobalPrefix }) {
  const kind = installKind(repoRoot)
  if (onPath("omakit", env)) return { kind, reachable: true, reason: null, line: null, where: null }
  if (kind !== "npm") {
    return { kind, reachable: false, reason: "`omakit` is not on your PATH yet.", line: `ln -s ${entryPoint} ~/.local/bin/omakit`, where: null }
  }
  const prefix = npmPrefix()
  if (!prefix) {
    return { kind, reachable: false, reason: "`omakit` is not on your PATH yet, and no `npm` is on PATH to ask where it was installed.", line: null, where: null }
  }
  const bin = join(prefix, "bin")
  const shell = basename(env.SHELL || "")
  const line = shell === "fish" ? `fish_add_path ${bin}` : `export PATH="${bin}:$PATH"`
  return {
    kind,
    reachable: false,
    reason: `\`omakit\` is not on your PATH yet: npm installed it under ${bin}, which your shell does not search.`,
    line,
    where: RC[shell] || null,
  }
}
