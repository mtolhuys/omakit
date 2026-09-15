import QtQuick
import Quickshell.Io

Item {
  id: root
  property string usage: ""

  Process {
    id: usageProcess
    command: ["/usr/bin/sh", "-c", "/usr/bin/df -h / | /usr/bin/head -c 4096"]
    running: true
    stdout: StdioCollector {
      onStreamFinished: root.usage = this.text
    }
  }

  Timer {
    id: usageDeadline
    interval: 8000
    running: usageProcess.running
    onTriggered: usageProcess.kill()
  }

  Timer {
    id: usagePoll
    interval: 30000
    repeat: true
    running: true
    onTriggered: usageProcess.running = true
  }

  Text {
    text: root.usage
    textFormat: Text.PlainText
  }
}
