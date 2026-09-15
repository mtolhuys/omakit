import QtQuick
import Quickshell.Io

Item {
  id: root
  property string containers: ""

  Process {
    id: listContainers
    command: ["/usr/bin/timeout", "5", "/usr/bin/sudo", "/usr/bin/docker", "ps", "--format", "{{.Names}}"]
    running: true
    stdout: StdioCollector {
      onStreamFinished: root.containers = this.text
    }
  }

  Text {
    text: root.containers
    textFormat: Text.PlainText
  }
}
