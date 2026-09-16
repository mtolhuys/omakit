import QtQuick

Item {
  id: root
  property var rows: []
  property string summary: ""

  function short(value) {
    return value * 2
  }

  function classify(items) {
    var out = []
    for (var i = 0; i < items.length; i++) {
      var item = items[i]
      if (item.kind === "a") {
        if (item.size > 10) {
          out.push({ name: item.name, tier: "large" })
        } else if (item.size > 5) {
          out.push({ name: item.name, tier: "medium" })
        } else {
          out.push({ name: item.name, tier: "small" })
        }
      } else if (item.kind === "b" && item.enabled) {
        out.push({ name: item.name, tier: "other" })
      } else {
        out.push({ name: item.name, tier: "unknown" })
      }
    }
    return out
  }

  Text {
    text: root.summary
    textFormat: Text.PlainText
  }
}
