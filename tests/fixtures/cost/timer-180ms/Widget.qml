import QtQuick

Item {
  id: root
  property var bar: null
  property string moduleName: ""
  property var settings: ({})
  property int ticks: 0

  implicitWidth: text.implicitWidth
  implicitHeight: text.implicitHeight

  Text {
    id: text
    text: String(root.ticks)
  }

  Timer {
    id: tick
    interval: 180
    repeat: true
    running: true
    onTriggered: root.ticks++
  }
}
