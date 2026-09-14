import QtQuick
import Quickshell
import Quickshell.Io

QtObject {
  id: root
  property string loadavg: ""
  property string helperPath: Quickshell.env("HOME") + "/.config/omarchy/plugins/fixture.poller/bin/helper"

  // A poller: the timer restarts the process every 5 seconds (60 * 1000 / 12).
  property Timer poll: Timer {
    interval: 60 * 1000 / 12
    repeat: true
    running: true
    triggeredOnStart: true
    onTriggered: reader.running = true
  }

  property Process reader: Process {
    id: reader
    command: ["cat", "/proc/loadavg"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.loadavg = String(text).trim()
    }
  }

  // Long-lived: a watcher that stays up for the life of the service.
  property Process watcher: Process {
    id: watcher
    command: [
      "inotifywait", "-m", "-q",
      "-e", "close_write",
      "/tmp"
    ]
    running: true
    stdout: SplitParser { onRead: function(line) { root.loadavg = line } }
  }

  // Dynamic: the executable is built from the plugin's own directory.
  property Process helper: Process { id: helper; command: [root.helperPath, "status"]; running: true }

  function refresh() {
    helper.command = [root.helperPath, "refresh", "--now"]
    helper.running = true
    Quickshell.execDetached(["notify-send", "fixture", "refreshed"])
  }

  Component.onCompleted: Quickshell.execDetached([root.helperPath, "hello"])
}
