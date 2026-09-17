// The lab harness for the Store block: a throwaway Quickshell configuration
// that loads Store (and Run, which it uses) from ./omakit, copied there by
// suite.sh from blocks/, and runs one scenario named by STORELAB_SCENARIO
// against the HOME the driver prepared, logging JSON events with a STORELAB
// prefix. Never loaded into omarchy-shell.
import QtQuick
import Quickshell
import "omakit"

ShellRoot {
    id: root
    property string scenario: Quickshell.env("STORELAB_SCENARIO")
    property string pluginId: "lab.store.fixture"
    property var results: []
    property int expected: 0
    readonly property var schema: ({ type: "object", required: ["version", "themes"], properties: { version: { type: "integer", minimum: 1 }, themes: { type: "object", maxProperties: 64 } }, additionalProperties: false })

    function log(o) { console.log("STORELAB " + JSON.stringify(o)) }
    function collect(result) {
        root.results = root.results.concat([result])
        root.log(Object.assign({ ev: "result", t: Date.now() }, result))
        if (root.results.length === root.expected) root.log({ ev: "all-done", t: Date.now() })
    }

    Store { id: state; pluginId: root.pluginId; name: "memory.json"; schema: root.schema; onFinished: function(result) { root.collect(result) } }
    Store { id: cache; pluginId: root.pluginId; name: "catalog.json"; kind: "cache"; maxBytes: 1048576; onFinished: function(result) { root.collect(result) } }
    Store { id: loose; pluginId: root.pluginId; name: "memory.json"; onFinished: function(result) { root.collect(result) } }

    property Component writerComponent: Component { Store { pluginId: root.pluginId; name: "memory.json"; schema: root.schema; onFinished: function(result) { root.collect(result) } } }

    property Timer starter: Timer {
        interval: 1500; running: true
        onTriggered: {
            root.log({ ev: "start", scenario: root.scenario, t: Date.now() })
            const value = { version: 1, themes: { a: { wallpaper: "/x" } } }
            switch (root.scenario) {
            case "plain":
                root.expected = 4; state.write(value); state.read(); state.remove(); state.read(); break
            case "symlink-directory":
            case "symlink-parent":
            case "outside-home":
            case "group-writable":
            case "foreign-owner":
                root.expected = 2; state.read(); state.write(value); break
            case "symlink-file":
                root.expected = 3; state.read(); state.write(value); state.read(); break
            case "swap":
                root.expected = 40
                for (let i = 0; i < 20; i++) { state.read(); state.write({ version: i + 1, themes: {} }) }
                break
            case "oversized":
                root.expected = 3; cache.read(); state.write({ version: 1, themes: { big: "x".repeat(70000) } }); state.read(); break
            case "invalid":
                root.expected = 2; state.read(); loose.read(); break
            case "crash":
                root.expected = 2; state.read(); state.write(value); break
            case "concurrent":
                root.expected = 10
                for (let i = 0; i < 10; i++) root.writerComponent.createObject(root).write({ version: i + 1, themes: {} })
                break
            default:
                root.log({ ev: "unknown-scenario" })
            }
        }
    }
    Component.onCompleted: log({ ev: "ready", pid: Quickshell.processId, scenario: scenario, home: Quickshell.env("HOME") })
}
