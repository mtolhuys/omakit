import QtQuick
import Quickshell.Io

Item {
  id: root
  property string usage: ""

  Process {
    id: usageProcess
    command: ["/usr/bin/df", "-h", "/"]
    running: true
    stdout: StdioCollector {
      onStreamFinished: root.usage = this.text
    }
  }

  Text {
    text: root.usage
    textFormat: Text.PlainText
  }
}
