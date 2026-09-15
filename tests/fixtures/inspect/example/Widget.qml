import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root
  property string status: ""
  property var cmd: ["/usr/bin/uptime"]

  Process {
    id: fetchStatus
    command: ["curl", "-fsSL", "--max-time", "5", "--max-filesize", "65536", "https://api.example.com/v1/status"]
    stdout: StdioCollector {
      onStreamFinished: root.status = this.text
    }
  }

  Process {
    id: refresh
    command: ["bash", "scripts/refresh.sh"]
    stdout: SplitParser {
      onRead: (line) => root.status = line
    }
  }

  Process {
    id: extra
    command: root.cmd
  }

  FileView {
    id: state
    path: Quickshell.env("XDG_STATE_HOME") + "/fixture.example/state.json"
    adapter: JsonAdapter {
      property int polls: 0
    }
  }

  Timer {
    id: poll
    interval: 30000
    repeat: true
    running: true
    triggeredOnStart: true
    onTriggered: {
      fetchStatus.running = true
      state.adapter.polls += 1
      state.writeAdapter()
    }
  }

  Timer {
    id: fetchDeadline
    interval: 8000
    onTriggered: fetchStatus.kill()
  }

  onVisibleChanged: if (visible) fetchDeadline.start()

  Text {
    text: root.status
    textFormat: Text.PlainText
  }
}
