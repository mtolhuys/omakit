import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root

  FileView {
    id: state
    path: Quickshell.env("XDG_STATE_HOME") + "/fixture.write-state/state.json"
    adapter: JsonAdapter {
      property int clicks: 0
    }
  }

  MouseArea {
    anchors.fill: parent
    onClicked: {
      state.adapter.clicks += 1
      state.writeAdapter()
    }
  }
}
