import QtQuick

// Nothing here wakes up. The word "Timer" in this comment must not count,
// and neither must the string below.
Item {
  id: root
  property var bar: null
  property string moduleName: ""
  property var settings: ({})
  property string label: "Timer { interval: 1 }"

  implicitWidth: text.implicitWidth
  implicitHeight: text.implicitHeight

  Text {
    id: text
    text: "clean"
  }
}
