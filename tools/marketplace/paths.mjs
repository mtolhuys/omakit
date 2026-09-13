import { homedir } from "node:os"
import { join, resolve } from "node:path"

/** Omakit's user-writable cache, following XDG with the usual ~/.cache fallback. */
export function omakitCacheDir(name = "", env = process.env) {
  const base = env.XDG_CACHE_HOME
    ? resolve(env.XDG_CACHE_HOME)
    : join(env.HOME || homedir(), ".cache")
  return join(base, "omakit", name)
}
