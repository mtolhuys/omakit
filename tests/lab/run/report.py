# The Run lab suite's reader: every run under <out>/runs into one document,
# <out>/runlab.json, and the gate, asserted. Every figure says how it was
# read: time to end is the harness's own clock from start() to the result
# (to the destroy event for destroy, to the last of ten results for
# concurrency); Pss is /proc/<quickshell pid>/smaps_rollup sampled every
# 100 ms by suite.sh, before = the last sample before the start event, peak
# = the maximum until the end, after = the last sample at least 1.5 s after
# the end; survivors are counted two seconds after the end by pgid and by
# the scope's cgroup; a signal to an empty group is the supervisor's
# os.killpg raising ProcessLookupError; shadow hits are the lines the
# hostile scenario's shadow tools wrote.
import hashlib
import json
import os
import platform
import re
import statistics
import sys
import time

# What each scenario must show. deadline and grace are the harness's values,
# so the bound "within deadline plus grace" is checked from them; 500 ms of
# slack covers the harness's own clock and one supervisor start.
EXPECT = {
    "producer": {"deadline": 60000, "grace": 1000, "state": "overflow"},
    "producer-stream": {"deadline": 120000, "grace": 1000, "state": "ok", "outBytes": 1073741824},
    "holder": {"deadline": 10000, "grace": 1000, "state": "ok"},
    "stubborn": {"deadline": 2000, "grace": 1000, "state": "timeout", "kill": True},
    "hostile": {"deadline": 5000, "grace": 1000, "state": "ok", "stdout": ["PATH=/usr/bin\n", "BASH_ENV=unset\n", "PYTHONPATH=unset\n"]},
    "destroy": {"deadline": 10000, "grace": 1000, "state": None},
    "cancel": {"deadline": 10000, "grace": 1000, "state": "cancelled"},
    "supersede": {"deadline": 10000, "grace": 1000, "states": ["cancelled", "ok"]},
    "shell-string": {"deadline": 5000, "grace": 1000, "state": "spawn-failed", "reason": "shell string"},
    "relative": {"deadline": 5000, "grace": 1000, "state": "spawn-failed", "reason": "not an absolute path"},
    "missing": {"deadline": 5000, "grace": 1000, "state": "spawn-failed", "reason": "No such file"},
    "controls": {"deadline": 5000, "grace": 1000, "state": "ok", "stdout": ["a[31mbcde\tf\ng\n"], "stderr": ["stderr]0;titleline\n"]},
    "concurrency": {"deadline": 30000, "grace": 1000, "state": "ok", "count": 10, "outBytes": 1048576},
    # 0.2.0: the review of 2026-09-18 (docs/evidence/blocks/2026-09-18-review.json)
    "forge": {"deadline": 5000, "grace": 1000, "state": "supervisor-lost", "reason": "detached reaper", "notStdout": ["forged"], "notPgid": 4194303},
    "orphan": {"deadline": 5000, "grace": 1000, "state": "supervisor-lost", "reason": "detached reaper"},
    "stalled-supersede": {"deadline": 2000, "grace": 500, "states": ["supervisor-lost", "ok"], "bound": 2000 + 500 + 3000 + 6000},
    "destroy-early": {"deadline": 10000, "grace": 1000, "state": None},
    "shell-string-option": {"deadline": 5000, "grace": 1000, "state": "spawn-failed", "reason": "shell string"},
    "shell-string-wrapper": {"deadline": 5000, "grace": 1000, "state": "spawn-failed", "reason": "shell string"},
}
CONTROL = re.compile("[\\x00-\\x08\\x0b-\\x1f\\x7f-\\x9f\\u061c\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]")
SLACK_MS = 500


def events(log):
    found = []
    for line in open(log, errors="replace"):
        match = re.search(r"RUNLAB (\{.*\})", line)
        if match:
            try:
                found.append(json.loads(match.group(1)))
            except ValueError:
                pass
    return found


def meta_of(path):
    lines = [line.rstrip("\n") for line in open(path)]
    pairs = dict(line.split("=", 1) for line in lines if "=" in line and not line.startswith("survivor"))
    survivors = [line for line in lines if line.startswith("survivor")]
    return pairs, survivors


def pss_of(path, start, end):
    samples = [tuple(map(int, line.split())) for line in open(path) if line.strip()]
    before = [p for t, p in samples if t < start]
    during = [p for t, p in samples if start <= t <= end + 200]
    after = [p for t, p in samples if t >= end + 1500]
    return {"before": before[-1] if before else None, "peak": max(during) if during else None, "after": after[-1] if after else None}


def read_run(runs_dir, scen, index):
    base = os.path.join(runs_dir, "%s-%d" % (scen, index))
    evs = events(base + ".log")
    start = next((e["t"] for e in evs if e.get("ev") == "start"), None)
    results = [e for e in evs if e.get("ev") == "result"]
    destroy = next((e for e in evs if e.get("ev") == "destroy"), None)
    done = next((e for e in evs if e.get("ev") == "all-finished"), None)
    pairs, survivors = meta_of(base + ".meta")
    end_wall = int(pairs.get("end_wall", start or 0))
    pss = pss_of(base + ".pss", start or 0, end_wall)
    if scen == "concurrency" and done and start:
        ms = done["t"] - start
    elif scen in ("destroy", "destroy-early") and destroy and start:
        ms = destroy["t"] - start
    else:
        ms = results[-1]["ms"] if results else None
    signals = [s for r in results for s in r.get("signals", [])]
    return {"scenario": scen, "run": index, "start": start, "ms": ms,
            "states": [r.get("state") for r in results], "results": results,
            "pssBefore": pss["before"], "pssPeak": pss["peak"], "pssAfter": pss["after"],
            "survivors": len(survivors), "survivorLines": survivors,
            "signals": ["%s@%s" % (s["sig"], s["atMs"]) for s in signals],
            "toEmptyGroup": sum(1 for s in signals if s.get("esrch")),
            "shadowHits": int(pairs.get("shadow_hits", 0)), "destroyed": destroy is not None}


def check_states(row, want, problems):
    if "states" in want:
        if row["states"] != want["states"]:
            problems.append("states %s, expected %s" % (row["states"], want["states"]))
        return
    count = want.get("count", 1)
    if want["state"] is None:
        if row["states"]:
            problems.append("a result after destruction: %s" % row["states"])
        return
    if row["states"] != [want["state"]] * count:
        problems.append("states %s, expected %s x%d" % (row["states"], want["state"], count))


def check_results(row, want, problems):
    for result in row["results"]:
        if "outBytes" in want and result.get("outBytes") != want["outBytes"]:
            problems.append("outBytes %s, expected %s" % (result.get("outBytes"), want["outBytes"]))
        if "reason" in want and want["reason"] not in str(result.get("reason", "")):
            problems.append("reason %r does not say %r" % (result.get("reason"), want["reason"]))
        for piece in want.get("notStdout", []):
            if piece in str(result.get("stdout", "")):
                problems.append("stdout carries the forged %r" % piece)
        if "notPgid" in want and result.get("pgid") == want["notPgid"]:
            problems.append("pgid is the forged %d" % want["notPgid"])
        for key in ("stdout", "stderr"):
            text = result.get(key, "")
            if CONTROL.search(text):
                problems.append("%s carries a control character" % key)
            for piece in want.get(key, []):
                if piece not in text:
                    problems.append("%s lacks %r" % (key, piece))
        if result.get("survivors", 0):
            problems.append("the supervisor reported %d survivors" % result["survivors"])
    if want.get("kill") and not any(s.startswith("KILL@") for s in row["signals"]):
        problems.append("no KILL was sent")


def check(row):
    want = EXPECT[row["scenario"]]
    problems = []
    if row["start"] is None:
        return ["no start event"]
    check_states(row, want, problems)
    check_results(row, want, problems)
    bound = want.get("bound", want["deadline"] + want["grace"]) + SLACK_MS
    if row["ms"] is None:
        problems.append("no end")
    elif row["ms"] > bound:
        problems.append("ended at %d ms, over deadline plus grace (%d)" % (row["ms"], bound))
    if row["survivors"]:
        problems.append("%d survivor(s): %s" % (row["survivors"], "; ".join(row["survivorLines"])))
    if row["toEmptyGroup"]:
        problems.append("%d signal(s) to an empty group" % row["toEmptyGroup"])
    if row["shadowHits"]:
        problems.append("%d shadow hit(s)" % row["shadowHits"])
    if row["scenario"] in ("destroy", "destroy-early") and not row["destroyed"]:
        problems.append("no destroy event")
    return problems


def rng(values):
    values = [v for v in values if v is not None]
    if not values:
        return None
    return {"median": statistics.median(values), "min": min(values), "max": max(values), "n": len(values)}


def summarise(rows):
    out = {}
    for scen in EXPECT:
        mine = [r for r in rows if r["scenario"] == scen]
        if not mine:
            continue
        out[scen] = {"runs": len(mine), "ms": rng([r["ms"] for r in mine]),
                     "pssPeakMinusBeforeKb": rng([r["pssPeak"] - r["pssBefore"] for r in mine if r["pssPeak"] and r["pssBefore"]]),
                     "pssAfterMinusBeforeKb": rng([r["pssAfter"] - r["pssBefore"] for r in mine if r["pssAfter"] and r["pssBefore"]]),
                     "survivors": sum(r["survivors"] for r in mine), "toEmptyGroup": sum(r["toEmptyGroup"] for r in mine),
                     "shadowHits": sum(r["shadowHits"] for r in mine), "problems": [p for r in mine for p in r["problems"]]}
    return out


def sha256(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def main(out, blocks):
    runs_dir = os.path.join(out, "runs")
    names = sorted(f[:-4] for f in os.listdir(runs_dir) if f.endswith(".log"))
    rows = []
    for name in names:
        scen, index = name.rsplit("-", 1)
        row = read_run(runs_dir, scen, int(index))
        row["problems"] = check(row)
        rows.append(row)
    summary = summarise(rows)
    failed = [scen for scen, entry in summary.items() if entry["problems"]]
    document = {"id": "runlab", "measured": time.strftime("%Y-%m-%d"), "host": platform.node(), "kernel": platform.release(),
                "blocks": {name: sha256(os.path.join(blocks, name)) for name in ("Run.qml", "run-supervisor.py")},
                "method": open(__file__).read().split("import hashlib")[0].replace("# ", "").replace("#", "").strip(),
                "runs": [{k: v for k, v in r.items() if k != "results"} for r in rows], "summary": summary, "ok": not failed}
    with open(os.path.join(out, "runlab.json"), "w") as handle:
        json.dump(document, handle, indent=1)
    for scen, entry in summary.items():
        ms = entry["ms"] or {}
        print("%s - %s: %d run(s), end %s ms (%s-%s), Pss after-before %s kB, survivors %d, to empty group %d, shadow hits %d%s" % (
            "not ok" if entry["problems"] else "ok", scen, entry["runs"], ms.get("median"), ms.get("min"), ms.get("max"),
            (entry["pssAfterMinusBeforeKb"] or {}).get("median"), entry["survivors"], entry["toEmptyGroup"], entry["shadowHits"],
            "; " + "; ".join(entry["problems"]) if entry["problems"] else ""))
    print("%s - Run lab suite: %d scenarios, %d runs, document at %s" % ("not ok" if failed else "ok", len(summary), len(rows), os.path.join(out, "runlab.json")))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
