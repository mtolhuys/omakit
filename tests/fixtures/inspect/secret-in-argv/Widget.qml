import QtQuick
import Quickshell.Io

Item {
  id: root
  property string me: ""

  Process {
    id: fetchMe
    command: ["/usr/bin/curl", "-q", "-fsS", "--max-time", "5", "--max-filesize", "65536", "-H", "Authorization: Bearer fixture-token", "https://api.example.com/me"]
    stdout: StdioCollector {
      onStreamFinished: root.me = this.text
    }
  }

  Timer {
    id: fetchDeadline
    interval: 8000
    running: fetchMe.running
    onTriggered: fetchMe.kill()
  }

  Component.onCompleted: fetchMe.running = true
}
