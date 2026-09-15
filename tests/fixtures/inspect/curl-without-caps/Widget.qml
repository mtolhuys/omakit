import QtQuick
import Quickshell.Io

Item {
  id: root
  property string status: ""

  Process {
    id: fetchStatus
    command: ["curl", "-fsSL", "https://api.example.com/v1/status"]
    stdout: StdioCollector {
      onStreamFinished: root.status = this.text
    }
  }

  Timer {
    id: fetchDeadline
    interval: 8000
    running: fetchStatus.running
    onTriggered: fetchStatus.kill()
  }

  Component.onCompleted: fetchStatus.running = true
}
