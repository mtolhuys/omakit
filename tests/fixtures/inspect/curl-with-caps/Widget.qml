import QtQuick
import Quickshell.Io

Item {
  id: root
  property string status: ""

  Process {
    id: fetchStatus
    command: ["/usr/bin/curl", "-q", "-fsS", "--max-time", "5", "--max-filesize", "65536", "https://api.example.com/v1/status"]
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
