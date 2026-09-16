import QtQuick
import "Model.js" as Model

Item {
  id: root
  property var rows: Model.load([])
}
