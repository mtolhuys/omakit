import QtQuick
import Quickshell.Io

Item {
  id: root

  Process {
    id: fortune
    command: ["/usr/bin/timeout", "5", "/usr/bin/fortune", "-s"]
    running: true
    stdout: StdioCollector {
      id: fortuneOutput
    }
  }

  Text {
    id: label
    text: fortuneOutput.text
  }
}
