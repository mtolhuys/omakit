import QtQuick

Item {
  id: root
  property var bar: null
  property string moduleName: ""

  implicitWidth: label.implicitWidth
  implicitHeight: label.implicitHeight

  Text {
    id: label
    text: "nothing"
    textFormat: Text.PlainText
  }
}
