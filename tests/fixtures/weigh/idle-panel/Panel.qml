import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland

Item {
  id: root
  property var shell: null
  property bool opened: false
  property int brightness: 0
  property string state: ""

  function open(payloadJson) { opened = true; refresh() }
  function close() { opened = false; retry.stop() }
  function refresh() { stateProc.running = true }
  function setBrightness(value) { brightness = value; brightnessDebounce.restart() }

  // Runs only while the panel is open: conditional, zero declared wakeups.
  Timer {
    interval: 5000
    running: root.opened
    repeat: true
    onTriggered: root.refresh()
  }

  // One-shot debounce: never a wakeup source on its own.
  Timer {
    id: brightnessDebounce
    interval: 180
    repeat: false
    onTriggered: root.setBrightness(root.brightness)
  }

  // Declared off, started from code in two places.
  Timer {
    id: retry
    interval: 1000
    repeat: true
    onTriggered: root.refresh()
  }

  Process {
    id: stateProc
    command: ["omarchy-monitor-state"]
    stdout: StdioCollector { waitForEnd: true; onStreamFinished: root.state = String(text) }
  }

  FileView {
    id: toggles
    path: Quickshell.env("HOME") + "/.local/state/omarchy/toggles"
    watchChanges: true
    onFileChanged: { reload(); retry.start() }
  }

  Connections {
    target: Hyprland
    function onRawEvent(event) { retry.running = true }
  }

  // Quickshell's clock ticks at its precision, once a minute here.
  SystemClock {
    id: clock
    precision: SystemClock.Minutes
  }
}
