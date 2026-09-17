import QtQuick
import "omakit"

Item {
  id: root
  property int opened: 0

  Store {
    id: memory
    pluginId: "fixture.store-block"
    name: "memory.json"
    schema: ({ type: "object", required: ["opened"], properties: { opened: { type: "integer", minimum: 0 } }, additionalProperties: false })
    onFinished: result => {
      if (result.op === "read" && result.state === "ok") root.opened = result.value.opened
    }
  }

  Component.onCompleted: memory.read()

  Text {
    text: "opened " + root.opened + " times"
    textFormat: Text.PlainText
  }
}
