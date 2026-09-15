import QtQuick
import Quickshell.Io

Item {
  id: root
  property var cmd: ["/usr/bin/uptime"]

  Process {
    id: proc
    command: root.cmd
    running: true
  }
}
