// `omakit cost` without a shell: a fake /proc tree and stub Omarchy commands
// first on PATH, so every code path that restarts a shell on a real machine
// runs here against a directory, and the desktop is never restarted by a
// test. What is proven: the confirmation text and its counts, the refusals
// (locked, disabled, a bar, unknown), the backup and its restore on a normal
// exit, on a thrown error and on SIGINT, the md5 equality, the shell.json
// transform, median and spread, the within-noise verdict, children
// attribution, and that every produced document follows docs/COST.md.
import test from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { buildDocument, CostError, DEFAULTS, RESTART_SECONDS, measureCost, planCost, readmeSentence, restartTiming, summaryOf } from "../../tools/cost/audit.mjs"
import { COMMANDS, commandLine, run } from "../../tools/cost/commands.mjs"
import { backupConfig, configPaths, md5, restoreConfig, verifyRestore, without } from "../../tools/cost/config.mjs"
import { validateCostDocument } from "../../tools/cost/contract.mjs"
import { ARG0_CHARS, childTicks, cpuTicks, descendants, pssKb, rssKb } from "../../tools/cost/proc.mjs"
import { figure, median, spread, stats, tickPercent, verdict } from "../../tools/cost/stats.mjs"
import { renderCost, renderPlan, rowState } from "../../tools/cost/report.mjs"
import { ARROW, DENSITY, GUTTER, LABEL, overflows, plain, STEP } from "../../tools/marketplace/style.mjs"
import { REPO_ROOT } from "./helpers.mjs"

const SHELL_PID = 4100
const CHILD_PID = 4242

const INSTALLED = [
  { id: "omarchy.bar", name: "Bar", kinds: ["bar"], enabled: true, firstParty: true },
  { id: "omarchy.clock", name: "Clock", kinds: ["bar-widget"], enabled: true, firstParty: true },
  { id: "fixture.clean", name: "Fixture: clean", kinds: ["bar-widget"], enabled: true, firstParty: false },
  { id: "fixture.poller", name: "Fixture: poller", kinds: ["service"], enabled: true, firstParty: false },
  { id: "fixture.off", name: "Fixture: disabled", kinds: ["panel"], enabled: false, firstParty: false },
  { id: "fixture.whole-bar", name: "Fixture: a bar", kinds: ["bar"], enabled: false, firstParty: false },
]

const EFFECTIVE = {
  version: 1,
  bar: { position: "top", layout: { left: [{ id: "omarchy.menu" }, { id: "fixture.clean" }], center: [{ id: "omarchy.clock", format: "HH:mm" }], right: [{ id: "omarchy.power" }] } },
  plugins: [{ id: "fixture.poller", every: 5 }, { id: "fixture.off" }],
  disabledPlugins: ["omarchy.image-picker"],
}

/** The file the user has: hand-written, not the effective document, so a restore that re-serialised it would be caught. */
const USER_SHELL_JSON = '{\n  "version": 1,\n  // a comment the shell tolerates and jq would not\n  "bar": { "layout": { "left": [ { "id": "fixture.clean" } ] } },\n  "plugins": [ { "id": "fixture.poller", "every": 5 } ]\n}\n'

function stat(pid, comm, ppid, { utime = 100, stime = 50, cutime = 7, cstime = 3 } = {}) {
  // Fields 1 to 17 of /proc/<pid>/stat, then filler: the reader counts from
  // the closing parenthesis, so a space in comm must not break it.
  return `${pid} (${comm}) S ${ppid} 1 1 0 -1 4194560 100 0 0 0 ${utime} ${stime} ${cutime} ${cstime} 20 0 1 0 1000 1000000 500 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n`
}

/** A fake /proc: the shell, an unrelated process, and (when `child`) one descendant of the shell. */
function writeProc(root, { shellRssKb = 500_000, shellPssKb = 470_000, child = false } = {}) {
  mkdirSync(join(root, String(SHELL_PID)), { recursive: true })
  writeFileSync(join(root, String(SHELL_PID), "stat"), stat(SHELL_PID, "quickshell", 1))
  writeFileSync(join(root, String(SHELL_PID), "status"), `Name:\tquickshell\nVmRSS:\t  ${shellRssKb} kB\nVmSwap:\t0 kB\n`)
  writeFileSync(join(root, String(SHELL_PID), "smaps_rollup"), `00400000-7fff ---p 00000000 00:00 0    [rollup]\nRss:  ${shellRssKb} kB\nPss:  ${shellPssKb} kB\nPss_Anon: 1 kB\n`)
  writeFileSync(join(root, String(SHELL_PID), "cmdline"), "quickshell\0-n\0-p\0/x/shell\0")
  mkdirSync(join(root, "1"), { recursive: true })
  writeFileSync(join(root, "1", "stat"), stat(1, "systemd", 0))
  mkdirSync(join(root, "77"), { recursive: true })
  writeFileSync(join(root, "77", "stat"), stat(77, "spaced name here", 1))
  writeFileSync(join(root, "77", "cmdline"), "unrelated\0")
  writeFileSync(join(root, "not-a-pid"), "")
  if (child) {
    mkdirSync(join(root, String(CHILD_PID)), { recursive: true })
    writeFileSync(join(root, String(CHILD_PID), "stat"), stat(CHILD_PID, "inotifywait", SHELL_PID, { utime: 2, stime: 1 }))
    writeFileSync(join(root, String(CHILD_PID), "status"), "Name:\tinotifywait\nVmRSS:\t  4096 kB\n")
    writeFileSync(join(root, String(CHILD_PID), "cmdline"), `inotifywait\0-m\0${"x".repeat(200)}\0/tmp\0`)
  }
}

/**
 * A machine in a directory: HOME with a shell.json, an OMARCHY_PATH with a
 * shell, a /proc, and the Omarchy commands as stubs first on PATH. The
 * restart stub records every restart with the md5 of shell.json at that
 * moment, and rebuilds /proc from the configuration it finds: the child
 * exists only while fixture.poller is configured, which is what attribution
 * has to see.
 */
function machine({ locked = false, installed = INSTALLED, effective = EFFECTIVE, shellJson = USER_SHELL_JSON, restartFailsAt = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "omakit-cost-"))
  const home = join(root, "home")
  const bin = join(root, "bin")
  const proc = join(root, "proc")
  const omarchyPath = join(root, "omarchy")
  const state = join(root, "stub")
  for (const dir of [home, bin, proc, join(omarchyPath, "shell"), state, join(home, ".config/omarchy")]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(omarchyPath, "shell/shell.qml"), "// a shell\n")
  writeFileSync(join(omarchyPath, "version"), "4.0.0.test\n")
  if (shellJson !== null) writeFileSync(join(home, ".config/omarchy/shell.json"), shellJson, { mode: 0o600 })
  writeFileSync(join(state, "plugins.json"), JSON.stringify(installed))
  writeFileSync(join(state, "effective.json"), JSON.stringify(effective))
  writeFileSync(join(state, "catalog.json"), JSON.stringify(installed.map((plugin) => ({ id: plugin.id, sourceDir: `/plugins/${plugin.id}` }))))
  writeFileSync(join(state, "locked"), locked ? "0" : "1")
  writeFileSync(join(state, "restarts.log"), "")
  writeProc(proc, { child: true })
  const stub = (name, body) => {
    writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`)
    chmodSync(join(bin, name), 0o755)
  }
  stub("systemctl", `echo "LANG=C.UTF-8"; echo "OMARCHY_PATH=${omarchyPath}"`)
  stub("omarchy-hyprland-session-locked", `exit "$(cat ${state}/locked)"`)
  stub("omarchy-shell", `case "$2" in ping) echo ok;; listPlugins) cat ${state}/plugins.json;; listShellConfig) cat ${state}/effective.json;; *) exit 1;; esac`)
  stub("omarchy", `[[ "$1 $2 $3" == "plugin list --json" ]] || exit 1; cat ${state}/plugins.json`)
  stub("omarchy-plugin-catalog", `cat ${state}/catalog.json`)
  stub("qs", `[[ "$1" == list && "$2" == -p && "$4" == --json ]] || exit 1; echo '[{"pid": ${SHELL_PID}, "path": "'"$3"'"}]'`)
  stub("getconf", `echo 100`)
  stub("omarchy-restart-shell", [
    `config="${home}/.config/omarchy/shell.json"`,
    `n=$(wc -l < ${state}/restarts.log)`,
    `printf '%s %s\\n' "$(md5sum < "$config" | cut -d" " -f1)" "$(tr -d '\\n ' < "$config")" >> ${state}/restarts.log`,
    restartFailsAt === null ? "" : `(( n + 1 == ${restartFailsAt} )) && exit 1`,
    `if grep -q '"fixture.poller"' "$config"; then mkdir -p ${proc}/${CHILD_PID}; printf '%s\\n' "${stat(CHILD_PID, "inotifywait", SHELL_PID, { utime: 2, stime: 1 }).trimEnd()}" > ${proc}/${CHILD_PID}/stat; printf 'Name:\\tinotifywait\\nVmRSS:\\t  4096 kB\\n' > ${proc}/${CHILD_PID}/status; printf 'inotifywait\\0-m\\0/tmp\\0' > ${proc}/${CHILD_PID}/cmdline; else rm -rf ${proc}/${CHILD_PID}; fi`,
    "exit 0",
  ].join("\n"))
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, XDG_STATE_HOME: join(home, "xdg-state"), NODE_NO_WARNINGS: "1" }
  // Every restart, with the md5 of shell.json at that moment and, for a
  // measurement configuration, its parsed content; the user's own file has
  // a comment in it and parses as nothing.
  const restarts = () => readFileSync(join(state, "restarts.log"), "utf8").split("\n").filter(Boolean).map((line) => {
    const [sum, ...rest] = line.split(" ")
    let config = null
    try {
      config = JSON.parse(rest.join(" "))
    } catch {
      config = null
    }
    return { md5: sum, config }
  })
  return { root, home, bin, proc, omarchyPath, state, env, restarts, configFile: join(home, ".config/omarchy/shell.json") }
}

const FAST = { runs: 2, windowSeconds: 0.2, settleSeconds: 0 }

// --- the pieces -----------------------------------------------------------------

test("the command table is frozen, and every entry is an Omarchy command or a read of the session", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(COMMANDS).map(([name, entry]) => [name, [entry.command, ...entry.args]])), {
    sessionEnvironment: ["systemctl", "--user", "show-environment"],
    sessionLocked: ["omarchy-hyprland-session-locked"],
    ping: ["omarchy-shell", "shell", "ping"],
    listPlugins: ["omarchy", "plugin", "list", "--json"],
    listShellConfig: ["omarchy-shell", "shell", "listShellConfig"],
    catalog: ["omarchy-plugin-catalog"],
    shellPid: ["qs", "list", "-p"],
    restartShell: ["omarchy-restart-shell"],
    clockTicks: ["getconf", "CLK_TCK"],
  })
  assert.ok(Object.isFrozen(COMMANDS))
  for (const entry of Object.values(COMMANDS)) assert.ok(Object.isFrozen(entry) && Object.isFrozen(entry.args))
  assert.equal(commandLine("shellPid", ["/x/shell", "--json"]), "qs list -p /x/shell --json")
  assert.throws(() => run("kill"), /no command named kill/)
  const m = machine()
  assert.equal(run("ping", { env: m.env }).stdout.trim(), "ok")
  assert.equal(run("restartShell", { env: { ...m.env, PATH: "/nonexistent" } }).missing, true)
})

test("/proc is read by field position, past a comm with spaces, and a vanished process is skipped", () => {
  const root = mkdtempSync(join(tmpdir(), "omakit-proc-"))
  writeProc(root, { child: true })
  assert.equal(cpuTicks(root, SHELL_PID), 150)
  assert.equal(childTicks(root, SHELL_PID), 10)
  assert.equal(rssKb(root, SHELL_PID), 500_000)
  assert.equal(pssKb(root, SHELL_PID), 470_000)
  assert.equal(cpuTicks(root, 99999), null)
  assert.equal(pssKb(root, 77), null, "no smaps_rollup is null, not zero")
  const found = descendants(root, SHELL_PID)
  assert.equal(found.length, 1)
  assert.equal(found[0].pid, CHILD_PID)
  assert.equal(found[0].comm, "inotifywait")
  assert.equal(found[0].arg0, "-m")
  assert.equal(found[0].cpu, 3)
  assert.equal(found[0].rss, 4096)
  assert.ok(found[0].key.startsWith("inotifywait -m xxx"), "the key is the whole command line")
  assert.ok(found[0].key.length > ARG0_CHARS, "and is not cut")
  assert.deepEqual(descendants(root, 77), [], "a process with no descendants")
  assert.deepEqual(descendants(join(root, "missing"), 1), [], "no tree, no descendants, no throw")
})

test("the shell.json transform removes exactly the ids, keeps their neighbours' settings, and disables a first-party id by list", () => {
  const out = without(EFFECTIVE, ["fixture.clean", "omarchy.clock"], INSTALLED)
  assert.deepEqual(out.bar.layout, { left: [{ id: "omarchy.menu" }], center: [], right: [{ id: "omarchy.power" }] })
  assert.deepEqual(out.plugins, EFFECTIVE.plugins, "plugins[] untouched when no id is in it")
  assert.deepEqual(out.disabledPlugins, ["omarchy.clock", "omarchy.image-picker"])
  assert.deepEqual(EFFECTIVE.bar.layout.left, [{ id: "omarchy.menu" }, { id: "fixture.clean" }], "the input is not mutated")
  const poller = without(EFFECTIVE, ["fixture.poller"], INSTALLED)
  assert.deepEqual(poller.plugins, [{ id: "fixture.off" }])
  assert.deepEqual(poller.disabledPlugins, ["omarchy.image-picker"], "a third-party id is never put in disabledPlugins")
  const bare = without({ version: 1, disabledPlugins: ["omarchy.clock"] }, ["omarchy.clock"], INSTALLED)
  assert.deepEqual(bare, { version: 1, disabledPlugins: ["omarchy.clock"] })
  const emptied = without({ version: 1, disabledPlugins: [] }, ["fixture.clean"], INSTALLED)
  assert.equal("disabledPlugins" in emptied, false, "an empty list is removed, as jq did")
  // A bare string entry in a layout, which older configurations carry.
  assert.deepEqual(without({ bar: { layout: { left: ["a", "b"] } } }, ["a"], []).bar.layout.left, ["b"])
})

test("median, spread, stats and the verdict", () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 3, 2]), 2.5)
  assert.equal(median([]), null)
  assert.equal(spread([3, 1, 2]), 2)
  assert.equal(spread([]), null)
  assert.deepEqual(stats([2, -1, 5]), { median: 2, spread: 6, min: -1, max: 5, runs: [2, -1, 5] })
  assert.deepEqual(stats([]), { median: null, spread: null, min: null, max: null, runs: [] })
  assert.equal(verdict(0.5, 1), "within-noise")
  assert.equal(verdict(-0.5, 1), "within-noise", "a negative median is judged by magnitude")
  assert.equal(verdict(1, 1), "within-noise", "equal to the floor is within it")
  assert.equal(verdict(1.0001, 1), "above-noise", "and anything over it, with no quantum, is above")
  // The rule for CPU: above noise only when the delta exceeds the floor and
  // one clock tick over the window. Measured in the lab: one tick over a
  // 15.003 s window against a floor of one tick over a 15.005 s window is
  // the same tick, not a cost; two ticks are.
  const tick = tickPercent(100, 15)
  assert.ok(Math.abs(tick - 0.0666667) < 1e-6)
  assert.equal(verdict(-0.06666222014954999, 0.06665333422334721, tick), "within-noise")
  assert.equal(verdict(2 / 100 / 15.006 * 100 - 1 / 100 / 15.003 * 100, 0.06665333422334721, tick), "within-noise", "two ticks minus one tick is one tick")
  assert.equal(verdict(0.1333, 0.0667, tick), "above-noise", "two ticks over the floor of one")
  assert.equal(verdict(0.05, 0.01, tick), "within-noise", "over the floor but under a tick is not expressible")
  assert.equal(verdict(null, 1), "unknown")
  assert.equal(verdict(1, null), "unknown")
  assert.equal(figure(-0.001), "0", "never -0")
  assert.equal(figure(19.79296875), "19.79")
  assert.equal(figure(null), "?")
  assert.equal(summaryOf("within-noise", "within-noise"), "within noise on memory and CPU")
  assert.equal(summaryOf("within-noise", "above-noise"), "above noise on CPU, within noise on memory")
  assert.equal(summaryOf("above-noise", "within-noise"), "above noise on memory, within noise on CPU")
  assert.equal(summaryOf("above-noise", "above-noise"), "above noise on memory and CPU")
  assert.equal(summaryOf("unknown", "above-noise"), "no completed run, so nothing is claimed")
})

test("the README sentence carries the totals above noise and the floor within it", () => {
  const base = { floorMb: 3.1234, floorCpu: 0.0629, shellVersion: "4.0.0.alpha", date: "2026-09-14" }
  assert.equal(readmeSentence({ ...base, totalMb: 19.79, totalCpuPercent: 0.14, memoryVerdict: "above-noise", cpuVerdict: "above-noise" }),
    "Costs 19.8 MB and 0.1% CPU on Omarchy 4.0.0.alpha, measured with omakit cost on 2026-09-14")
  assert.equal(readmeSentence({ ...base, totalMb: -0.5, totalCpuPercent: 2.62, memoryVerdict: "within-noise", cpuVerdict: "above-noise" }),
    "Costs under 3.1 MB and 2.6% CPU on Omarchy 4.0.0.alpha, measured with omakit cost on 2026-09-14")
  assert.equal(readmeSentence({ ...base, totalMb: 0.2, totalCpuPercent: 0.01, memoryVerdict: "within-noise", cpuVerdict: "within-noise" }),
    "Costs under 3.1 MB and under 0.06% CPU on Omarchy 4.0.0.alpha, measured with omakit cost on 2026-09-14")
  assert.equal(readmeSentence({ ...base, totalMb: null, totalCpuPercent: null, memoryVerdict: "unknown", cpuVerdict: "unknown" }), null)
})

test("backup and restore are byte for byte, keep the mode, and verify by md5", () => {
  const m = machine()
  const backup = backupConfig(m.configFile, "20260914120000")
  assert.equal(backup.backupFile, `${m.configFile}.omakit-backup-20260914120000`)
  assert.equal(readFileSync(backup.backupFile, "utf8"), USER_SHELL_JSON)
  assert.equal(backup.md5Before, md5(Buffer.from(USER_SHELL_JSON)))
  assert.equal(backup.md5Before, spawnSync("md5sum", [m.configFile], { encoding: "utf8" }).stdout.split(" ")[0], "the same md5 md5sum prints")
  const mode = (path) => spawnSync("stat", ["-c", "%a", path], { encoding: "utf8" }).stdout.trim()
  assert.equal(mode(backup.backupFile), "600", "a copy of a private file is a private file")
  writeFileSync(m.configFile, "{}\n")
  restoreConfig(backup)
  assert.equal(existsSync(backup.backupFile), true, "the backup stays until the restore is verified")
  const restored = verifyRestore(backup)
  assert.deepEqual(restored, { md5After: backup.md5Before, restored: true, backupRemoved: true })
  assert.equal(readFileSync(m.configFile, "utf8"), USER_SHELL_JSON)
  assert.equal(mode(m.configFile), "600")
  assert.equal(existsSync(backup.backupFile), false, "the backup is removed after a verified restore")
  // A file that was not there is put back by removal.
  const none = machine({ shellJson: null })
  const nothing = backupConfig(none.configFile, "x")
  assert.equal(nothing.bytes, null)
  assert.equal(nothing.md5Before, null)
  assert.equal(existsSync(nothing.backupFile), false, "no bytes, no backup file")
  writeFileSync(none.configFile, "{}\n")
  restoreConfig(nothing)
  assert.equal(verifyRestore(nothing).restored, true)
  assert.equal(existsSync(none.configFile), false)
  // A verification over a file the shell rewrote keeps the backup.
  const rewritten = machine()
  const kept = backupConfig(rewritten.configFile, "x")
  restoreConfig(kept)
  writeFileSync(rewritten.configFile, `${USER_SHELL_JSON}// rewritten\n`)
  const check = verifyRestore(kept)
  assert.equal(check.restored, false)
  assert.equal(check.backupRemoved, false)
  assert.notEqual(check.md5After, kept.md5Before)
  assert.equal(existsSync(kept.backupFile), true)
})

// --- the plan and the confirmation ---------------------------------------------

test("the plan counts restarts as (1 + plugins) × runs and estimates from the stored timing, or the lab's before one exists", () => {
  const m = machine()
  const plan = planCost({ target: "fixture.clean", env: m.env, now: new Date("2026-09-14T19:02:25.123Z") })
  assert.deepEqual(plan.audited.map((plugin) => plugin.id), ["fixture.clean"])
  assert.equal(plan.audited[0].sourceDir, "/plugins/fixture.clean")
  assert.equal(plan.restarts, (1 + 1) * DEFAULTS.runs)
  assert.equal(plan.timing.seconds, RESTART_SECONDS)
  assert.match(plan.timing.source, /before any run on this machine; the lab measured 1 s/)
  assert.equal(plan.perRestartSeconds, 5 + DEFAULTS.settleSeconds + DEFAULTS.windowSeconds, "about a minute per restart")
  assert.equal(plan.estimatedMinutes, Math.ceil((6 * (5 + DEFAULTS.settleSeconds + DEFAULTS.windowSeconds)) / 60))
  assert.equal(plan.estimatedMinutes, 5, "six restarts for one plugin at three runs is five minutes")
  assert.equal(plan.shellVersion, "4.0.0.test")
  assert.equal(plan.omarchyPath, m.omarchyPath)
  assert.equal(plan.clockTicksPerSecond, 100)
  assert.equal(plan.started, "2026-09-14T19:02:25Z")
  assert.equal(plan.out, join(m.env.XDG_STATE_HOME, "omakit/cost/2026-09-14T190225Z.json"))
  assert.equal(plan.configFile, join(m.home, ".config/omarchy/shell.json"))
  assert.equal(plan.env.OMARCHY_PATH, m.omarchyPath, "every command sees the session's OMARCHY_PATH")
  // With a stored timing, the estimate is this machine's.
  mkdirSync(plan.stateDir, { recursive: true })
  writeFileSync(join(plan.stateDir, "timing.json"), JSON.stringify({ restartSeconds: 4, restarts: 6, measuredAt: "2026-09-14T00:00:00Z" }))
  const again = planCost({ target: "fixture.clean", env: m.env, runs: 5, windowSeconds: 2, settleSeconds: 1 })
  assert.equal(again.timing.seconds, 4)
  assert.match(again.timing.source, /measured over 6 restart/)
  assert.equal(again.restarts, 10)
  assert.equal(again.estimatedMinutes, Math.ceil((10 * (4 + 1 + 2)) / 60))
  assert.equal(restartTiming(join(m.root, "nowhere")).seconds, RESTART_SECONDS)
  // --all is every enabled third-party plugin that is not a whole bar, with the real count.
  const all = planCost({ all: true, env: m.env })
  assert.deepEqual(all.audited.map((plugin) => plugin.id), ["fixture.clean", "fixture.poller"])
  assert.equal(all.restarts, (1 + 2) * DEFAULTS.runs)
  // A directory with a manifest resolves to its id.
  const dir = join(m.root, "checkout")
  mkdirSync(dir)
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ id: "fixture.poller" }))
  assert.equal(planCost({ target: dir, env: m.env }).audited[0].id, "fixture.poller")
  // --out is honoured, absolute.
  assert.equal(planCost({ target: "fixture.clean", env: m.env, out: join(m.root, "here.json") }).out, join(m.root, "here.json"))
})

test("the confirmation says the plugins, the restart count, the minutes, the backup and the file, within eighty columns", () => {
  const m = machine()
  const plan = planCost({ all: true, env: m.env })
  const text = renderPlan(plan, { colour: false, env: m.env }).join("\n")
  assert.match(text, /^measuring {5}fixture\.clean, fixture\.poller$/m)
  assert.match(text, /^restarts {6}9: \(1 baseline \+ 2 plugins\) × 3 runs$/m)
  assert.match(text, /^estimate {6}about 8 minutes, 50 s per restart: 5 s for the shell to come back/m)
  assert.match(text, /then the\n {14}30 s settle and the 15 s window/)
  assert.match(text, /^shell\.json {4}backed up beside itself and restored on every exit path; the md5/m)
  assert.match(text, /^writes {8}~\/xdg-state\/omakit\/cost\/\d{4}-\d{2}-\d{2}T\d{6}Z\.json$/m)
  for (const line of text.split("\n")) assert.ok(!overflows(line), `${line.length} columns: ${JSON.stringify(line)}`)
  const single = renderPlan(planCost({ target: "fixture.clean", env: m.env, runs: 1 }), { colour: false, env: m.env }).join("\n")
  assert.match(single, /^restarts {6}2: \(1 baseline \+ 1 plugin\) × 1 run$/m)
  assert.equal(plain(renderPlan(plan, { colour: true, env: m.env }).join("\n")), text, "colour changes nothing about the words")
})

test("a locked session, a disabled plugin, a whole bar, an unknown id and a missing command are each refused before anything is touched", () => {
  const codeOf = (options) => {
    try {
      planCost(options)
    } catch (error) {
      assert.ok(error instanceof CostError, `${error}`)
      return error.code
    }
    return "no error"
  }
  const locked = machine({ locked: true })
  assert.equal(codeOf({ target: "fixture.clean", env: locked.env }), "session-locked")
  const m = machine()
  assert.equal(codeOf({ target: "fixture.off", env: m.env }), "plugin-disabled")
  assert.equal(codeOf({ target: "fixture.whole-bar", env: m.env }), "plugin-is-bar")
  assert.equal(codeOf({ target: "omarchy.bar", env: m.env }), "plugin-is-bar")
  assert.equal(codeOf({ target: "nobody.nothing", env: m.env }), "plugin-unknown")
  assert.equal(codeOf({ target: join(m.root, "no-such-dir"), env: m.env }), "plugin-unknown")
  assert.equal(codeOf({ env: m.env }), "usage")
  assert.equal(codeOf({ target: "fixture.clean", env: { ...m.env, PATH: join(m.root, "nowhere") } }), "command-missing")
  const empty = machine({ installed: INSTALLED.filter((plugin) => plugin.firstParty) })
  assert.equal(codeOf({ all: true, env: empty.env }), "nothing-to-measure")
  const unpinged = machine()
  writeFileSync(join(unpinged.bin, "omarchy-shell"), "#!/bin/bash\nexit 1\n")
  assert.equal(codeOf({ target: "fixture.clean", env: unpinged.env }), "shell-not-running")
  for (const each of [locked, m, empty, unpinged]) {
    assert.deepEqual(each.restarts(), [], "no restart")
    assert.equal(readdirSync(join(each.home, ".config/omarchy")).filter((name) => name.includes("backup")).length, 0, "no backup")
  }
})

// --- the measurement, against the fake machine ------------------------------------

test("a measurement restarts (1 + plugins) × runs + 1 times, writes the baseline without the plugin and the plus with it where it was, and restores byte for byte", async () => {
  const m = machine()
  const md5Before = md5(readFileSync(m.configFile))
  const lines = []
  const phases = []
  const plan = planCost({ target: "fixture.poller", env: m.env, ...FAST })
  const document = await measureCost(plan, { procRoot: m.proc, omakitVersion: "0.0.0-test", onLine: (line) => lines.push(line), onPhase: (text) => phases.push(text) })
  const restarts = m.restarts()
  assert.equal(restarts.length, (1 + 1) * 2 + 1, "baseline and plus per run, then the restore")
  assert.deepEqual(restarts[0].config.plugins, [{ id: "fixture.off" }], "baseline: the plugin is out of plugins[]")
  assert.deepEqual(restarts[1].config.plugins, EFFECTIVE.plugins, "plus: the plugin is back where it was, settings included")
  assert.deepEqual(restarts[1].config.bar, EFFECTIVE.bar, "and nothing else moved")
  assert.equal(restarts.at(-1).md5, md5Before, "the last restart runs the user's own file")
  assert.equal(readFileSync(m.configFile, "utf8"), USER_SHELL_JSON)
  assert.equal(md5(readFileSync(m.configFile)), md5Before)
  assert.equal(readdirSync(join(m.home, ".config/omarchy")).filter((name) => name.includes("backup")).length, 0, "the backup is gone")
  assert.equal(document.config.md5Before, md5Before)
  assert.equal(document.config.md5After, md5Before)
  assert.equal(document.config.restored, true)
  assert.equal(document.config.shellAnsweredAfterRestore, true)
  assert.match(lines[0].text, new RegExp(`backed up to .*omakit-backup-\\d{14}, md5 ${md5Before}`))
  assert.equal(lines[0].state, "info")
  // One line per configuration, so a piped log shows the run going by.
  const samplesNarrated = lines.filter((line) => /^run \d of 2, /.test(line.text))
  assert.equal(samplesNarrated.length, 4)
  assert.match(samplesNarrated[0].text, /^run 1 of 2, baseline: 459\.0 MB Pss, 0\.00% CPU, 0 child processes, ready after \d+\.\d s$/)
  assert.match(samplesNarrated[1].text, /^run 1 of 2, fixture\.poller: 459\.0 MB Pss, 0\.00% CPU, 1 child process, ready after/)
  assert.match(lines.at(-1).text, new RegExp(`restored and verified, md5 ${md5Before} \\(before: ${md5Before}\\)`))
  assert.equal(lines.at(-1).state, "pass")
  assert.ok(phases.some((text) => /run 1 of 2: baseline, restarting the shell/.test(text)))
  assert.ok(phases.some((text) => /run 2 of 2: fixture\.poller, sampling for 0\.2s/.test(text)))
  assert.equal(phases.at(-1), "restoring shell.json and restarting the shell")
  // The document.
  assert.deepEqual(validateCostDocument(document), [])
  assert.equal(document.omakit, "0.0.0-test")
  assert.equal(document.command, "cost")
  assert.deepEqual(document.audited, ["fixture.poller"])
  assert.equal(document.baseline.pssMb.runs.length, 2)
  assert.deepEqual(document.baseline.config, restarts[0].config)
  assert.equal(document.settings.runs, 2)
  assert.equal(document.settings.clockTicksPerSecond, 100)
  const row = document.plugins[0]
  assert.equal(row.id, "fixture.poller")
  assert.equal(row.name, "Fixture: poller")
  assert.deepEqual(row.kinds, ["service"])
  assert.equal(row.runsCompleted, 2)
  // The child exists only in the plus runs, so it is attributed: 4096 kB, one spawn.
  assert.equal(row.childSpawns.median, 1)
  assert.equal(row.childRssMb.median, 4)
  assert.deepEqual(row.deltas[0].children.map((child) => [child.comm, child.arg0]), [["inotifywait", "-m"]])
  assert.ok(row.runs.every((sample) => sample.children.every((child) => !("key" in child))), "the full command line never reaches the document")
  assert.ok(document.baseline.runs.every((sample) => sample.children.length === 0))
  // A static /proc: the shell's own deltas are zero, which is within a zero floor.
  assert.equal(row.shellPssMb.median, 0)
  assert.equal(row.shellCpuPercent.median, 0)
  assert.equal(document.noiseFloor.pssMb, 0)
  assert.deepEqual(row.verdict, { memory: "within-noise", cpu: "within-noise", summary: "within noise on memory and CPU" })
  assert.equal(row.readme, "Costs under 0.0 MB and under 0.00% CPU on Omarchy 4.0.0.test, measured with omakit cost on " + document.started.slice(0, 10))
  assert.match(row.origin, /smaps_rollup/)
  assert.equal(document.plugins[0].runs[0].shell.memoryAt, "window-end")
  assert.equal(document.plugins[0].runs[0].shell.pssKb, 470_000)
  assert.equal(document.plugins[0].runs[0].shell.rssKb, 500_000)
  assert.equal(document.plugins[0].runs[0].shell.pssKbSettled, 470_000)
  const trace = document.plugins[0].runs[0].shell.trace
  assert.ok(trace.length >= 1 && trace[0].t === 0 && trace[0].pssKb === 470_000, "the trace starts as the window opens")
  assert.equal(document.baseline.pssMbSettled.median, 470_000 / 1024)
  assert.equal(document.noiseFloor.pssMbSettled, 0)
  assert.equal(document.out, plan.out)
  assert.deepEqual(JSON.parse(readFileSync(plan.out, "utf8")), document, "the document on disk is the one returned")
  const timing = JSON.parse(readFileSync(join(plan.stateDir, "timing.json"), "utf8"))
  assert.equal(timing.restarts, 4, "the timing counts the measured restarts, not the restore")
  assert.ok(timing.restartSeconds >= 0)
  // Rendered, within eighty columns, ending with the README sentence and the evidence.
  const text = renderCost(document, { colour: false, env: m.env })
  for (const line of text.split("\n")) assert.ok(!overflows(line), `${line.length} columns: ${JSON.stringify(line)}`)
  assert.match(text, /^noise floor {3}0 MB and 0% CPU, the spread of 2 baseline runs; a delta inside it$/m)
  assert.match(text, /At the settle, before the window, the same runs\n {14}spread 0 MB$/m)
  assert.match(text, new RegExp(`^shell\\.json {4}md5 ${md5Before} before,\\n {${LABEL}}${md5Before} after: restored and verified,\\n {${LABEL}}backup removed$`, "m"))
  assert.match(text, new RegExp(`^${DENSITY.floor} ok {4}fixture\\.poller +\\[service\\]$`, "m"))
  assert.match(text, /^ {8}Fixture: poller: within noise on memory and CPU$/m)
  assert.match(text, /^ {8}memory {2}0 MB \(spread 0\), within noise$/m)
  assert.match(text, /^ {8}cpu {2}0% \(spread 0\), within noise$/m)
  assert.match(text, /^ {8}children {2}4 MB and 0% CPU outside the shell, 1 process per window$/m)
  const readme = text.slice(text.indexOf("for the README"))
  assert.match(readme, new RegExp(`^for the README\\n${DENSITY.floor}+\\n {${STEP}}fixture\\.poller\\n {${GUTTER}}Costs under 0\\.0 MB and under 0\\.00% CPU on Omarchy 4\\.0\\.0\\.test, measured\\n {${GUTTER}}with omakit cost on \\d{4}-\\d{2}-\\d{2}\\n {${GUTTER}}evidence {2}~/xdg-state/omakit/cost/\\d{4}-\\d{2}-\\d{2}T\\d{6}Z\\.json$`))
  assert.ok(text.endsWith(".json"), "the evidence path is the last thing printed")
  assert.equal(plain(renderCost(document, { colour: true, env: m.env })), text)
  assert.equal(rowState(row), "pass")
})

test("a restart that does not answer produces no sample, the row says how many completed, and the restore still happens", async () => {
  const m = machine({ restartFailsAt: 2 })
  const lines = []
  const plan = planCost({ target: "fixture.clean", env: m.env, ...FAST })
  const document = await measureCost(plan, { procRoot: m.proc, onLine: (line) => lines.push(line) })
  assert.deepEqual(validateCostDocument(document), [])
  assert.deepEqual(document.failedRuns, [{ label: "fixture.clean", run: 1, reason: "the shell did not answer after the restart" }])
  assert.ok(lines.some((line) => line.state === "advisory" && /run 1 of 2, fixture\.clean: the shell did not answer after the restart; no sample/.test(line.text)))
  const row = document.plugins[0]
  assert.equal(row.runsCompleted, 1)
  assert.equal(row.deltas.length, 1)
  assert.equal(row.deltas[0].run, 2)
  assert.equal(document.config.restored, true)
  assert.equal(readFileSync(m.configFile, "utf8"), USER_SHELL_JSON)
  const text = renderCost(document, { colour: false, env: m.env })
  assert.match(text, /\(1 of 2 runs completed\)/)
  assert.match(text, /^incomplete {4}run 1 of fixture\.clean: the shell did not answer after the restart$/m)
  // Every restart failing leaves a row with nothing claimed.
  const none = machine()
  writeFileSync(join(none.bin, "omarchy-restart-shell"), "#!/bin/bash\nexit 1\n")
  const empty = await measureCost(planCost({ target: "fixture.clean", env: none.env, ...FAST }), { procRoot: none.proc, onLine: () => {} })
  assert.deepEqual(validateCostDocument(empty), [])
  assert.equal(empty.plugins[0].runsCompleted, 0)
  assert.deepEqual(empty.plugins[0].verdict, { memory: "unknown", cpu: "unknown", summary: "no completed run, so nothing is claimed" })
  assert.equal(empty.plugins[0].readme, null)
  assert.equal(empty.config.shellAnsweredAfterRestore, false)
  assert.equal(readFileSync(none.configFile, "utf8"), USER_SHELL_JSON, "restored even though the shell never answered")
  const rendered = renderCost(empty, { colour: false, env: none.env })
  assert.match(rendered, new RegExp(`^${DENSITY.medium} \\? {5}fixture\\.clean`, "m"))
  assert.match(rendered, /noise floor {3}unknown: no baseline run completed/)
  assert.match(rendered, new RegExp(`${ARROW} The shell did not answer after the restore: run omarchy-restart-shell\\.`))
  assert.ok(!rendered.includes("for the README"), "no sentence for a plugin nothing was measured for")
})

test("a thrown error mid-measurement restores shell.json, and the error keeps its cause", async () => {
  // The document is written to --out after the runs and before the restore
  // is reported; a path that cannot be written throws from inside the
  // measurement, and the finally puts the file back first.
  const m = machine()
  writeFileSync(join(m.root, "a-file"), "")
  const plan = planCost({ target: "fixture.clean", env: m.env, out: join(m.root, "a-file", "under-a-file.json"), ...FAST })
  const lines = []
  await assert.rejects(measureCost(plan, { procRoot: m.proc, onLine: (line) => lines.push(line) }), /ENOTDIR|EEXIST/)
  assert.equal(readFileSync(m.configFile, "utf8"), USER_SHELL_JSON, "restored on the way out")
  assert.equal(readdirSync(join(m.home, ".config/omarchy")).filter((name) => name.includes("backup")).length, 0)
  assert.equal(m.restarts().at(-1).md5, md5(Buffer.from(USER_SHELL_JSON)))
  assert.ok(lines.some((line) => line.state === "pass" && /restored and verified/.test(line.text)))
})

test("an aborted signal stops the run at the next wait, restores, and surfaces as interrupted", async () => {
  const m = machine()
  const plan = planCost({ target: "fixture.clean", env: m.env, runs: 3, windowSeconds: 2, settleSeconds: 0 })
  const controller = new AbortController()
  const lines = []
  const pending = measureCost(plan, { procRoot: m.proc, signal: controller.signal, onLine: (line) => lines.push(line) })
  // Abort during the first window: one restart has happened.
  while (m.restarts().length < 1) await delay(20)
  await delay(100)
  controller.abort()
  await assert.rejects(pending, (error) => error instanceof CostError && error.code === "interrupted")
  assert.equal(m.restarts().length, 2, "the one measured restart, and the restore's")
  assert.equal(readFileSync(m.configFile, "utf8"), USER_SHELL_JSON)
  assert.equal(readdirSync(join(m.home, ".config/omarchy")).filter((name) => name.includes("backup")).length, 0)
  assert.ok(lines.at(-1).state === "pass" && /restored and verified/.test(lines.at(-1).text))
})

test("a restore whose md5 differs keeps the backup and says so", async () => {
  // A restart stub that appends to shell.json after it was put back: the
  // shell itself rewriting the file is exactly the case the md5 catches.
  const m = machine()
  const original = readFileSync(join(m.bin, "omarchy-restart-shell"), "utf8")
  writeFileSync(join(m.bin, "omarchy-restart-shell"), `${original.replace(/exit 0\n$/, "")}n=$(wc -l < ${m.state}/restarts.log); (( n == 3 )) && echo '// rewritten by the shell' >> "$config"; exit 0\n`)
  const plan = planCost({ target: "fixture.clean", env: m.env, runs: 1, windowSeconds: 0.2, settleSeconds: 0 })
  const lines = []
  await assert.rejects(measureCost(plan, { procRoot: m.proc, onLine: (line) => lines.push(line) }), (error) => error.code === "restore-unverified")
  const kept = readdirSync(join(m.home, ".config/omarchy")).filter((name) => name.includes("backup"))
  assert.equal(kept.length, 1, "the backup is kept")
  assert.equal(readFileSync(join(m.home, ".config/omarchy", kept[0]), "utf8"), USER_SHELL_JSON)
  assert.ok(lines.at(-1).state === "fail" && /differs from the backup after the restore/.test(lines.at(-1).text))
  const document = JSON.parse(readFileSync(plan.out, "utf8"))
  assert.equal(document.config.restored, false)
  assert.notEqual(document.config.md5After, document.config.md5Before)
  assert.deepEqual(validateCostDocument(document), [])
})

// --- the arithmetic over real-shaped samples ------------------------------------------

function sample(label, runIndex, { pssKb, rssKb, cpuTicks: ticks, children = [], reaped = 0, window = 15 }) {
  return {
    label, run: runIndex, shellPid: 1, started: "2026-09-14T00:00:00Z", ended: "2026-09-14T00:00:15Z", readyAfterSeconds: 0, windowSeconds: window,
    shell: { pssKb, rssKb, memoryAt: "window-end", pssKbSettled: pssKb - 20_480, rssKbSettled: rssKb - 20_480, trace: [{ t: 0, pssKb: pssKb - 20_480, rssKb: rssKb - 20_480 }, { t: window, pssKb, rssKb }], cpuTicksStart: 0, cpuTicksEnd: ticks, cpuSeconds: ticks / 100, cpuPercent: (ticks / 100 / window) * 100, reapedChildTicksStart: 0, reapedChildTicksEnd: reaped, reapedChildCpuSeconds: reaped / 100, reapedChildCpuPercent: (reaped / 100 / window) * 100 },
    children,
  }
}

const PLAN = { audited: [{ id: "busy", name: "Busy", kinds: ["bar-widget"], firstParty: false, sourceDir: null }, { id: "quiet", name: "Quiet", kinds: ["service"], firstParty: false, sourceDir: null }], runs: 3, windowSeconds: 15, settleSeconds: 8, readyTimeoutSeconds: 45, sampleIntervalMs: 500, clockTicksPerSecond: 100, shellVersion: "4.0.0.alpha", omarchyPath: "/usr/share/omarchy", out: "/tmp/out.json", baselineConfig: { version: 1 } }

test("the document's arithmetic: median of per-run deltas, the baseline spread as the floor, children by command line", () => {
  const child = (key, cpuFirst, cpuLast) => ({ pid: 9, comm: key.split(" ")[0], arg0: key.split(" ")[1] || "", key, firstSeen: 0, lastSeen: 14.5, cpuFirst, cpuLast, rssLast: 2048, samples: 30 })
  const samples = [
    sample("baseline", 1, { pssKb: 470_000, rssKb: 500_000, cpuTicks: 3, children: [child("inotifywait -m /a", 0, 0)] }),
    sample("baseline", 2, { pssKb: 472_048, rssKb: 502_048, cpuTicks: 3, children: [child("inotifywait -m /a", 0, 0)] }),
    sample("baseline", 3, { pssKb: 471_000, rssKb: 501_000, cpuTicks: 2, children: [child("inotifywait -m /a", 0, 0)] }),
    sample("busy", 1, { pssKb: 480_240, rssKb: 512_000, cpuTicks: 42, children: [child("inotifywait -m /a", 0, 0), child("inotifywait -m /b", 0, 15)], reaped: 3 }),
    sample("busy", 2, { pssKb: 482_288, rssKb: 514_048, cpuTicks: 41, children: [child("inotifywait -m /a", 0, 0), child("inotifywait -m /b", 0, 15)], reaped: 3 }),
    sample("busy", 3, { pssKb: 479_192, rssKb: 511_000, cpuTicks: 43, children: [child("inotifywait -m /a", 0, 0), child("inotifywait -m /b", 0, 15)], reaped: 3 }),
    sample("quiet", 1, { pssKb: 470_512, rssKb: 500_512, cpuTicks: 3, children: [child("inotifywait -m /a", 0, 0)] }),
    sample("quiet", 2, { pssKb: 471_024, rssKb: 501_024, cpuTicks: 3, children: [child("inotifywait -m /a", 0, 0)] }),
    { label: "quiet", run: 3, failed: "no shell pid" },
  ]
  const document = buildDocument(PLAN, samples, { started: "2026-09-14T00:00:00Z", ended: "2026-09-14T00:10:00Z", config: { path: "/h/shell.json", backup: "/h/shell.json.omakit-backup-1", md5Before: "a".repeat(32), md5After: "a".repeat(32), restored: true, shellAnsweredAfterRestore: true }, host: "test", omakitVersion: "0.1.9" })
  assert.deepEqual(validateCostDocument(document), [])
  assert.equal(document.baseline.pssMb.median, 471_000 / 1024)
  assert.equal(document.noiseFloor.pssMb, 2048 / 1024, "the baseline Pss spread: 2 MB")
  assert.equal(document.noiseFloor.rssMb, 2)
  assert.equal(document.noiseFloor.pssMbSettled, 2)
  assert.equal(document.baseline.pssMbSettled.median, 471_000 / 1024 - 20)
  const near = (actual, expected, what) => assert.ok(Math.abs(actual - expected) < 1e-9, `${what}: ${actual} is not ${expected}`)
  near(document.noiseFloor.cpuPercent, (1 / 100 / 15) * 100, "the CPU floor")
  assert.deepEqual(document.failedRuns, [{ label: "quiet", run: 3, reason: "no shell pid" }])
  const [busy, quiet] = document.plugins
  assert.equal(busy.id, "busy", "sorted by total MB, descending")
  assert.deepEqual(busy.shellPssMbSettled.runs, busy.shellPssMb.runs, "a constant offset leaves the deltas alone")
  assert.deepEqual(busy.shellPssMb.runs, [10_240 / 1024, 10_240 / 1024, 8192 / 1024])
  assert.equal(busy.shellPssMb.median, 10)
  assert.equal(busy.shellPssMb.spread, 2)
  near(busy.shellCpuPercent.median, (39 / 100 / 15) * 100, "the median of 39, 38 and 41 ticks over 15 s")
  near(busy.shellCpuPercent.spread, (3 / 100 / 15) * 100, "the spread of those")
  assert.equal(busy.childSpawns.median, 1, "the watcher on /b is the plugin's; the one on /a is the baseline's")
  assert.equal(busy.childRssMb.median, 2)
  near(busy.childCpuPercent.median, (15 / 100 / 15) * 100 + (3 / 100 / 15) * 100, "the child's own ticks plus the reaped-child delta")
  assert.deepEqual(busy.deltas[0].children, [{ comm: "inotifywait", arg0: "-m", rssKb: 2048, cpuSeconds: 0.15, firstSeen: 0, lastSeen: 14.5 }])
  assert.equal(busy.totalMb, 12)
  assert.deepEqual(busy.verdict, { memory: "above-noise", cpu: "above-noise", summary: "above noise on memory and CPU" })
  assert.equal(busy.withinNoise.pss, false)
  assert.equal(busy.withinNoise.ownPss, false)
  assert.ok(Math.abs(busy.withinNoise.cpuTickPercent - tickPercent(100, 15)) < 1e-12)
  near(busy.totalCpuPercent, 3.8, "2.6% in the shell and 1.2% outside it")
  assert.equal(busy.readme, "Costs 12.0 MB and 3.8% CPU on Omarchy 4.0.0.alpha, measured with omakit cost on 2026-09-14")
  assert.equal(quiet.runsCompleted, 2)
  assert.equal(quiet.shellPssMb.median, ((512 / 1024) + (-1024 / 1024)) / 2, "run 1: +0.5 MB, run 2: -1 MB; the median of two is their mean")
  assert.deepEqual(quiet.verdict, { memory: "within-noise", cpu: "within-noise", summary: "within noise on memory and CPU" })
  assert.equal(quiet.withinNoise.pss, true)
  assert.equal(quiet.readme, "Costs under 2.0 MB and under 0.07% CPU on Omarchy 4.0.0.alpha, measured with omakit cost on 2026-09-14")
  assert.equal(rowState(busy), "advisory")
  assert.equal(rowState(quiet), "pass")
  const text = renderCost(document, { colour: false, env: { HOME: "/h" } })
  assert.match(text, new RegExp(`^${DENSITY.dark} note {2}busy +\\[bar-widget\\]$`, "m"))
  assert.match(text, /^ {8}Busy: above noise on memory and CPU$/m)
  assert.match(text, /^ {8}memory {2}10 MB \(spread 2\)$/m)
  assert.match(text, /^ {8}cpu {2}2\.6% \(spread 0\.2\)$/m)
  assert.match(text, /^ {8}children {2}2 MB and 1\.2% CPU outside the shell, 1 process per window$/m)
  assert.match(text, /^ {8}Quiet: within noise on memory and CPU \(2 of 3 runs completed\)$/m)
  assert.match(text, /^noise floor {3}2 MB and 0\.07% CPU, the spread of 3 baseline runs; a delta inside$/m)
  assert.match(text, /the same\n {14}runs spread 2 MB$/m)
  assert.match(text, /^baseline {6}460 MB Pss and 0\.2% CPU, the median of 3 runs without the 2\n {14}plugins$/m)
  assert.match(text, /^incomplete {4}run 3 of quiet: no shell pid$/m)
  for (const line of text.split("\n")) assert.ok(!overflows(line), `${line.length} columns: ${JSON.stringify(line)}`)
  // Every line starts on the indent scale.
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    const column = line.length - line.trimStart().length
    assert.ok([0, STEP, GUTTER, GUTTER + STEP, LABEL].includes(column), `column ${column} is not on the scale: ${JSON.stringify(line)}`)
  }
})

test("the contract refuses what it should", () => {
  const document = buildDocument(PLAN, [sample("baseline", 1, { pssKb: 1024, rssKb: 1024, cpuTicks: 1 }), sample("busy", 1, { pssKb: 2048, rssKb: 2048, cpuTicks: 1 }), sample("quiet", 1, { pssKb: 1024, rssKb: 1024, cpuTicks: 1 })], { started: "2026-09-14T00:00:00Z", ended: "2026-09-14T00:01:00Z", config: { path: "p", backup: "b", md5Before: "a".repeat(32), md5After: "a".repeat(32), restored: true }, host: "h", omakitVersion: "v" })
  assert.deepEqual(validateCostDocument(document), [])
  const broken = structuredClone(document)
  broken.plugins[0].runs[0].children.push({ pid: 1, comm: "x", arg0: "y", key: "secret token", firstSeen: 0, lastSeen: 0, cpuFirst: 0, cpuLast: 0, rssLast: 0, samples: 1 })
  broken.config.restored = false
  broken.noiseFloor.pssMb = 99
  broken.plugins[1].readme = "It is cheap"
  const problems = validateCostDocument(broken)
  assert.ok(problems.some((problem) => /plugins\[0\]\.verdict\.memory is above-noise; the median and the floor say within-noise/.test(problem)), problems.join("\n"))
  assert.ok(problems.some((problem) => /carries the full command line/.test(problem)))
  assert.ok(problems.some((problem) => /config\.restored disagrees with the two md5s/.test(problem)))
  assert.ok(problems.some((problem) => /noiseFloor\.pssMb is not the baseline Pss spread/.test(problem)))
  assert.ok(problems.some((problem) => /plugins\[1\]\.readme is not the README sentence/.test(problem)))
  assert.deepEqual(validateCostDocument(null), ["the document is not an object"])
  assert.ok(validateCostDocument({}).length > 10)
  const check = spawnSync(process.execPath, [join(REPO_ROOT, "tools/cost/contract.mjs"), join(REPO_ROOT, "package.json")], { encoding: "utf8" })
  assert.equal(check.status, 1)
  assert.match(check.stdout, /problem\(s\)/)
})

// --- the entry point ---------------------------------------------------------------------

function omakit(args, env, { input } = {}) {
  const result = spawnSync(process.execPath, [join(REPO_ROOT, "bin/omakit"), ...args], {
    encoding: "utf8",
    env: { ...env, FORCE_COLOR: undefined, NO_COLOR: undefined },
    input,
  })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

test("in a pipe, without --yes, the plan is printed and the run is refused with exit 2, and nothing was touched", () => {
  const m = machine()
  const result = omakit(["cost", "fixture.clean"], m.env)
  assert.equal(result.code, 2)
  assert.match(result.out, /^measuring {5}fixture\.clean$/m)
  assert.match(result.out, /^restarts {6}6: \(1 baseline \+ 1 plugin\) × 3 runs$/m)
  assert.match(result.err, /not-confirmed/)
  assert.match(result.err, /restarts the shell 6 times/)
  assert.match(result.err, new RegExp(`${ARROW} Run it again and answer y, or pass --yes`))
  assert.deepEqual(m.restarts(), [])
  assert.equal(readFileSync(m.configFile, "utf8"), USER_SHELL_JSON)
  // --json without --yes: the same refusal, and nothing on stdout at all.
  const json = omakit(["cost", "fixture.clean", "--json"], m.env)
  assert.equal(json.code, 2)
  assert.equal(json.out, "")
  assert.match(json.err, /not-confirmed/)
  // A refusal from the plan is one failure state in the usual register.
  const locked = machine({ locked: true })
  const refused = omakit(["cost", "fixture.clean", "--yes"], locked.env)
  assert.equal(refused.code, 1)
  assert.match(refused.err, /session-locked/)
  assert.match(refused.err, /the same\s+check omarchy-restart-shell makes/)
  assert.equal(refused.out, "")
  const usage = omakit(["cost"], m.env)
  assert.equal(usage.code, 2)
  assert.match(usage.err, /cost needs a plugin/)
  const bad = omakit(["cost", "fixture.clean", "--window", "0"], m.env)
  assert.equal(bad.code, 2)
  assert.match(bad.err, /--window needs an integer of at least 1/)
})

test("--yes --json puts the document alone on stdout, the narration on stderr, and the same document in --out", () => {
  const m = machine()
  const out = join(m.root, "doc.json")
  const result = omakit(["cost", "fixture.poller", "--yes", "--json", "--runs", "1", "--window", "1", "--settle", "0", "--out", out], m.env)
  assert.equal(result.code, 0, result.err)
  const document = JSON.parse(result.out)
  assert.deepEqual(validateCostDocument(document), [])
  assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), document)
  assert.equal(document.omakit, JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version)
  assert.equal(document.out, out)
  assert.match(result.err, /^measuring {5}fixture\.poller$/m, "the plan is on stderr under --json")
  assert.match(result.err, /backed up to/)
  assert.match(result.err, /restored and verified/)
  assert.doesNotMatch(result.err, /\u001b/, "no escape on a piped stderr")
  assert.equal(readFileSync(m.configFile, "utf8"), USER_SHELL_JSON)
  assert.equal(m.restarts().length, 3)
  // For a person: the plan, the narration and the report on stdout, in order.
  const human = omakit(["cost", "fixture.poller", "--yes", "--runs", "1", "--window", "1", "--settle", "0"], m.env)
  assert.equal(human.code, 0, human.err)
  assert.equal(human.err, "", "nothing on a piped stderr on success")
  const at = (pattern) => human.out.search(pattern)
  assert.ok(at(/^measuring/m) < at(/backed up to/) && at(/backed up to/) < at(/restored and verified/) && at(/restored and verified/) < at(/^noise floor/m) && at(/^noise floor/m) < at(/^for the README$/m), human.out)
  assert.match(human.out, /^ {8}Costs under 0\.0 MB and under 0\.00% CPU on Omarchy 4\.0\.0\.test, measured\n {8}with omakit cost on \d{4}-\d{2}-\d{2}$/m)
  for (const line of human.out.split("\n")) assert.ok(!overflows(line), `${line.length} columns: ${JSON.stringify(line)}`)
  assert.doesNotMatch(human.out, /\u001b/)
})

test("SIGINT during a window restores shell.json, restarts the shell once more, removes the backup, and exits 130", async () => {
  const m = machine()
  const child = spawn(process.execPath, [join(REPO_ROOT, "bin/omakit"), "cost", "fixture.clean", "--yes", "--runs", "3", "--window", "5", "--settle", "0"], {
    env: { ...m.env, FORCE_COLOR: undefined, NO_COLOR: undefined },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let out = ""
  let err = ""
  child.stdout.on("data", (chunk) => { out += chunk })
  child.stderr.on("data", (chunk) => { err += chunk })
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })))
  const deadline = Date.now() + 20_000
  while (m.restarts().length < 1 && Date.now() < deadline) await delay(50)
  await delay(300)
  child.kill("SIGINT")
  const { code, signal } = await exited
  assert.equal(signal, null, "the process exited on its own, after the restore")
  assert.equal(code, 130)
  assert.equal(m.restarts().length, 2, "one measured restart, then the restore's")
  assert.equal(m.restarts().at(-1).md5, md5(Buffer.from(USER_SHELL_JSON)))
  assert.equal(readFileSync(m.configFile, "utf8"), USER_SHELL_JSON)
  assert.equal(readdirSync(join(m.home, ".config/omarchy")).filter((name) => name.includes("backup")).length, 0)
  assert.match(out, /interrupted: restoring shell\.json before exiting/)
  assert.match(out, /restored and verified/)
  assert.match(err, /interrupted/)
  assert.match(err, /shell\.json was restored/)
})

test("help, the front door and completion know cost; the skills print the cost skill", () => {
  const help = omakit(["help"], process.env)
  assert.match(help.out, /omakit cost <plugin-id-or-dir> \[--runs <n>\] \[--window <s>\] \[--settle <s>\]/)
  assert.match(help.out, /omakit cost --all/)
  assert.match(omakit([], { ...process.env, TERM: "dumb" }).out, /omakit cost <plugin-id-or-dir>/)
  const agent = omakit(["help", "--agent"], process.env)
  assert.match(agent.out, /name: omarchy-plugin-cost/)
  assert.match(agent.out, /restarts the shell/)
})

test("the pin is untouched by cost: nothing under tools/cost names the marketplace, the cache or a network host", () => {
  for (const name of readdirSync(join(REPO_ROOT, "tools/cost"))) {
    const text = readFileSync(join(REPO_ROOT, "tools/cost", name), "utf8")
    assert.doesNotMatch(text, /marketplace(?!\/(?:style|report|paths)\.mjs)/i, `${name} names the marketplace`)
    assert.doesNotMatch(text, /https?:\/\//, `${name} names a host`)
    assert.doesNotMatch(text, /omakitCacheDir|\.cache/, `${name} reaches the cache`)
  }
  assert.equal(configPaths({ HOME: "/h" }).file, "/h/.config/omarchy/shell.json")
})
