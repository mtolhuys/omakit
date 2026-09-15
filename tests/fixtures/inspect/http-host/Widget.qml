import QtQuick
import Quickshell.Io

Item {
  id: root
  property string feed: ""

  Process {
    id: fetchFeed
    command: ["/usr/bin/curl", "-q", "-fsS", "--max-time", "5", "--max-filesize", "65536", "http://updates.example.com/feed"]
    stdout: StdioCollector {
      onStreamFinished: root.feed = this.text
    }
  }

  Timer {
    id: fetchDeadline
    interval: 8000
    running: fetchFeed.running
    onTriggered: fetchFeed.kill()
  }

  Component.onCompleted: fetchFeed.running = true
}
