# The Store lab suite's reader: every scenario's results under <out>/runs
# into <out>/storelab.json, and the gate, asserted. A result is the state
# the block reported for one operation; the facts after the run come from
# suite.sh's stat of the throwaway HOME (the victim file's content, the
# directory and file modes, the staging files left). Every expectation
# below names the contract line it holds (docs/BLOCKS.md, Store).
import hashlib
import json
import os
import re
import sys
import time

MIB = 1048576

# Per scenario: the states expected in order (None: any of a set), and
# the facts. `victim` untouched means the planted link led nowhere.
EXPECT = {
    "plain": {"states": ["ok", "ok", "ok", "missing"], "file_mode": None, "dir_mode": "700", "written_mode": "600"},
    "symlink-directory": {"states": ["refused", "refused"], "reason": "symbolic link", "victim": "untouched", "victim_dir_unchanged": True},
    "symlink-parent": {"states": ["refused", "refused"], "reason": "symbolic link", "victim": "untouched"},
    "symlink-file": {"states": ["refused", "ok", "ok"], "reason": "symbolic link", "victim": "untouched", "file_type": "regular file"},
    "swap": {"any_of": {"ok", "missing", "refused", "invalid"}, "count": 40, "victim": "untouched"},
    "oversized": {"multiset": ["overflow", "overflow", "missing"], "reason": "over"},
    "group-writable": {"states": ["refused", "ok"], "reason": "writable by the group", "written_mode": "600"},
    "foreign-owner": {"states": ["refused", "ok"], "reason": "not owned", "simulated_only": True, "written_mode": "600"},
    "invalid": {"states": ["invalid", "ok"], "reason": "is not an integer"},
    "crash": {"states": ["ok", "ok"], "staging_left": 1, "file_content": '{"themes":{"a":{"wallpaper":"/x"}},"version":1}'},
    "concurrent": {"any_of": {"ok"}, "count": 10, "staging_left": 0, "content_one_of": ['{"themes":{},"version":%d}' % i for i in range(1, 11)]},
    "outside-home": {"states": ["refused", "refused"], "reason": "not inside HOME", "victim_dir_unchanged": True},
}


def events(log):
    found = []
    for line in open(log, errors="replace"):
        match = re.search(r"STORELAB (\{.*\})", line)
        if match:
            try:
                found.append(json.loads(match.group(1)))
            except ValueError:
                pass
    return found


def meta_of(path):
    return dict(line.rstrip("\n").split("=", 1) for line in open(path) if "=" in line)


def check_states(results, want, problems):
    states = [r.get("state") for r in results]
    if "states" in want and states != want["states"]:
        problems.append("states %s, expected %s" % (states, want["states"]))
    if "multiset" in want and sorted(states) != sorted(want["multiset"]):
        problems.append("states %s, expected %s in any order (two queues)" % (states, want["multiset"]))
    if "any_of" in want:
        if len(states) != want["count"]:
            problems.append("%d results, expected %d" % (len(states), want["count"]))
        bad = [s for s in states if s not in want["any_of"]]
        if bad:
            problems.append("states outside %s: %s" % (sorted(want["any_of"]), bad))
    if "reason" in want:
        reasons = [r.get("reason", "") for r in results if r.get("state") not in ("ok", "missing")]
        if not reasons or not all(want["reason"] in reason for reason in reasons):
            problems.append("reasons %s do not all say %r" % (reasons, want["reason"]))


def check_facts(meta, want, problems):
    for key in ("victim", "dir_mode", "file_type"):
        if key in want and meta.get(key) != want[key]:
            problems.append("%s is %r, expected %r" % (key, meta.get(key), want[key]))
    if want.get("victim_dir_unchanged") and meta.get("victim_dir_before") != meta.get("victim_dir_after"):
        problems.append("the victim directory went from %s to %s entries: something landed there" % (meta.get("victim_dir_before"), meta.get("victim_dir_after")))
    if "written_mode" in want and meta.get("file_mode") not in (None, want["written_mode"]):
        problems.append("the written file's mode is %s, expected %s" % (meta.get("file_mode"), want["written_mode"]))
    if "staging_left" in want and int(meta.get("staging_left", -1)) != want["staging_left"]:
        problems.append("%s staging files left, expected %d" % (meta.get("staging_left"), want["staging_left"]))
    if "file_content" in want and meta.get("file_content") != want["file_content"]:
        problems.append("file content %r, expected %r" % (meta.get("file_content"), want["file_content"]))
    if "content_one_of" in want and meta.get("file_content") not in want["content_one_of"]:
        problems.append("file content %r is not one whole write" % meta.get("file_content"))


def check(scen, results, meta):
    want = EXPECT[scen]
    if want.get("simulated_only") and meta.get("foreign_owner") == "not-simulated":
        return [], "not simulated here: no sudo for a foreign owner; the mode check stands in (group-writable)"
    problems = []
    check_states(results, want, problems)
    check_facts(meta, want, problems)
    return problems, None


def main(out, blocks):
    runs_dir = os.path.join(out, "runs")
    rows = []
    for name in sorted(EXPECT):
        log = os.path.join(runs_dir, name + ".log")
        if not os.path.exists(log):
            rows.append({"scenario": name, "problems": ["no log"], "results": [], "meta": {}})
            continue
        evs = events(log)
        results = [e for e in evs if e.get("ev") == "result"]
        start = next((e["t"] for e in evs if e.get("ev") == "start"), None)
        meta = meta_of(os.path.join(runs_dir, name + ".meta"))
        problems, skipped = check(name, results, meta)
        # ms: the harness's clock from the scenario's start to each result.
        timed = [{k: v for k, v in r.items() if k not in ("value", "t")} | {"ms": (r["t"] - start) if start and "t" in r else None} for r in results]
        rows.append({"scenario": name, "results": timed, "msToLast": (results[-1]["t"] - start) if results and start and "t" in results[-1] else None, "meta": meta, "problems": problems, "skipped": skipped})
    failed = [r["scenario"] for r in rows if r["problems"]]
    document = {"id": "storelab", "measured": time.strftime("%Y-%m-%d"), "kernel": os.uname().release,
                "blocks": {name: hashlib.sha256(open(os.path.join(blocks, name), "rb").read()).hexdigest() for name in ("store/Store.qml", "store/store-helper.py", "run/Run.qml", "run/run-supervisor.py")},
                "method": open(__file__).read().split("import hashlib")[0].replace("# ", "").replace("#", "").strip(),
                "scenarios": rows, "ok": not failed}
    with open(os.path.join(out, "storelab.json"), "w") as handle:
        json.dump(document, handle, indent=1)
    for row in rows:
        states = [r.get("state") for r in row["results"]]
        summary = ", ".join("%s x%d" % (s, states.count(s)) for s in dict.fromkeys(states)) if states else "no result"
        note = row.get("skipped") or ("; ".join(row["problems"]) if row["problems"] else "")
        print("%s - %s: %s, %s ms to the last result%s" % ("not ok" if row["problems"] else "ok", row["scenario"], summary, row["msToLast"], " (" + note + ")" if note else ""))
    print("%s - Store lab suite: %d scenarios, document at %s" % ("not ok" if failed else "ok", len(rows), os.path.join(out, "storelab.json")))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
