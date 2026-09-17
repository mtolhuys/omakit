// The lab harness: a throwaway Quickshell configuration that loads the Run
// block from ./omakit (copied there by suite.sh from blocks/run/) and runs
// one scenario named by RUNLAB_SCENARIO, logging JSON events with a RUNLAB
// prefix for the driver to read. Never loaded into omarchy-shell.
import QtQuick
import Quickshell
import "omakit"

ShellRoot {
    id: root
    property string scenario: Quickshell.env("RUNLAB_SCENARIO")
    property string base: Quickshell.env("RUNLAB_BASE")
    property int keep: Number(Quickshell.env("RUNLAB_KEEP") || 65536)
    property var table: ({
        "producer":        { command: ["/usr/bin/head", "-c", "1073741824", "/dev/zero"], deadlineMs: 60000, graceMs: 1000, maxBytes: 1048576 },
        "producer-stream": { command: ["/usr/bin/head", "-c", "1073741824", "/dev/zero"], deadlineMs: 120000, graceMs: 1000, maxBytes: 2147483647 },
        "holder":          { command: ["/usr/bin/bash", base + "/scenarios/holder.sh"], deadlineMs: 10000, graceMs: 1000, maxBytes: 65536 },
        "stubborn":        { command: ["/usr/bin/bash", base + "/scenarios/stubborn.sh"], deadlineMs: 2000, graceMs: 1000, maxBytes: 65536 },
        "hostile":         { command: ["/usr/bin/bash", base + "/scenarios/envprobe.sh"], deadlineMs: 5000, graceMs: 1000, maxBytes: 65536 },
        "destroy":         { command: ["/usr/bin/bash", base + "/scenarios/tree.sh"], deadlineMs: 10000, graceMs: 1000, maxBytes: 65536, destroyAfterMs: 500 },
        "cancel":          { command: ["/usr/bin/bash", base + "/scenarios/tree.sh"], deadlineMs: 10000, graceMs: 1000, maxBytes: 65536, cancelAfterMs: 500 },
        "supersede":       { command: ["/usr/bin/bash", base + "/scenarios/tree.sh"], deadlineMs: 10000, graceMs: 1000, maxBytes: 65536, supersedeAfterMs: 500 },
        "shell-string":    { command: ["/usr/bin/bash", "-c", "echo never"], deadlineMs: 5000, graceMs: 1000, maxBytes: 65536 },
        "relative":        { command: ["bash", base + "/scenarios/envprobe.sh"], deadlineMs: 5000, graceMs: 1000, maxBytes: 65536 },
        "missing":         { command: ["/usr/bin/no-such-program-runlab"], deadlineMs: 5000, graceMs: 1000, maxBytes: 65536 },
        "controls":        { command: ["/usr/bin/bash", base + "/scenarios/controls.sh"], deadlineMs: 5000, graceMs: 1000, maxBytes: 65536 },
        "concurrency":     { command: ["/usr/bin/head", "-c", "1048576", "/dev/zero"], deadlineMs: 30000, graceMs: 1000, maxBytes: 2097152, count: 10 }
    })
    property var runs: []
    property int finishedCount: 0

    function log(o) { console.log("RUNLAB " + JSON.stringify(o)) }

    property Component runComponent: Component { Run {} }

    function create(spec, index) {
        const object = root.runComponent.createObject(root, { command: spec.command, deadlineMs: spec.deadlineMs, graceMs: spec.graceMs, maxBytes: spec.maxBytes, keepBytes: root.keep })
        object.finished.connect(result => { result.ev = "result"; result.index = index; root.finishedCount += 1; root.log(result); if (root.finishedCount === (spec.count || 1)) root.log({ ev: "all-finished", t: Date.now() }) })
        return object
    }

    property Timer starter: Timer {
        interval: 3000; running: true
        onTriggered: {
            const spec = root.table[root.scenario]
            const count = spec.count || 1
            const objects = []
            for (let index = 0; index < count; index += 1) objects.push(root.create(spec, index))
            root.runs = objects
            root.log({ ev: "start", scenario: root.scenario, count: count, t: Date.now() })
            for (const object of objects) object.start()
            if (spec.destroyAfterMs) { root.later.mode = "destroy"; root.later.interval = spec.destroyAfterMs; root.later.start() }
            if (spec.cancelAfterMs) { root.later.mode = "cancel"; root.later.interval = spec.cancelAfterMs; root.later.start() }
            if (spec.supersedeAfterMs) { root.later.mode = "supersede"; root.later.interval = spec.supersedeAfterMs; root.later.start() }
        }
    }
    property Timer later: Timer {
        property string mode: ""
        onTriggered: {
            const object = root.runs[0]
            root.log({ ev: mode, pgid: object._pgid, t: Date.now() })
            if (mode === "destroy") { object.destroy(); root.runs = [] }
            else if (mode === "cancel") object.cancel()
            else if (mode === "supersede") { object.command = ["/usr/bin/bash", root.base + "/scenarios/envprobe.sh"]; object.start() }
        }
    }

    Component.onCompleted: log({ ev: "ready", pid: Quickshell.processId, scenario: scenario })
}
