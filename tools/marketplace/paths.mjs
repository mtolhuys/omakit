import { homedir } from "node:os"
import { join, resolve } from "node:path"

/** Omakit's user-writable cache, following XDG with the usual ~/.cache fallback. */
export function omakitCacheDir(name = "", env = process.env) {
  const base = env.XDG_CACHE_HOME
    ? resolve(env.XDG_CACHE_HOME)
    : join(env.HOME || homedir(), ".cache")
  return join(base, "omakit", name)
}

/**
 * Omakit's user-writable state, following XDG with the usual ~/.local/state
 * fallback: where `omakit weigh` keeps its documents and its per-restart
 * timing. State, not cache, because a measurement is not something to
 * fetch again.
 */
export function omakitStateDir(name = "", env = process.env) {
  const base = env.XDG_STATE_HOME
    ? resolve(env.XDG_STATE_HOME)
    : join(env.HOME || homedir(), ".local/state")
  return join(base, "omakit", name)
}

/**
 * Text for a person, with every path under the home directory written the
 * way a shell would take it: `~/.cache/omakit/marketplace`. Only `$HOME`
 * counts, because `~` is what the shell expands to `$HOME` and nothing else;
 * with it unset, or for a path outside it, the text is returned as it came.
 * Human output only: `--json` keeps every path absolute, so this is applied
 * where text is rendered, never where a result is built.
 */
export function withHomeAbbreviated(text, env = process.env) {
  const home = String(env.HOME || "").replace(/\/+$/, "")
  if (!home || !home.startsWith("/")) return String(text)
  // The home directory where a path starts: at the start of the text or after
  // the characters a path follows in prose or a command, and followed by a
  // separator or the end, so /tmp/home/me/x and /home/meh/x are left alone.
  const literal = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return String(text).replace(new RegExp(`(^|[\\s"'(=:])${literal}(?=/|$|[\\s"'),:])`, "g"), "$1~")
}
