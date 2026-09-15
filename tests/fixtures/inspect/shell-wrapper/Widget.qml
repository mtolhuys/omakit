import QtQuick
import Quickshell.Io

Item {
  id: root

  Process {
    id: notify
    command: ["bash", "-c", "notify-send 'fixture' \"$(date)\""]
  }

  MouseArea {
    anchors.fill: parent
    onClicked: notify.running = true
  }
}
