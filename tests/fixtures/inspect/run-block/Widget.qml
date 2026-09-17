import QtQuick
import "omakit"

Item {
  id: root
  property string usage: ""

  Run {
    id: usageRun
    command: ["/usr/bin/df", "-h", "/"]
    deadlineMs: 8000
    onFinished: result => root.usage = result.state === "ok" ? result.stdout : result.state
  }

  Timer {
    id: usagePoll
    interval: 30000
    repeat: true
    running: true
    triggeredOnStart: true
    onTriggered: usageRun.start()
  }

  Text {
    text: root.usage
    textFormat: Text.PlainText
  }
}
