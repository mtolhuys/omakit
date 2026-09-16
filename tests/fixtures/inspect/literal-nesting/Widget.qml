import QtQuick

Item {
  id: root

  function describe(state) {
    const row = {
      name: state.name,
      tags: [
        { key: "kind", value: state.kind },
        { key: "size", value: state.size },
      ],
    }
    if (state.hidden) {
      row.hidden = true
    }
    return row
  }

  function pairs(items) {
    return items.map((item) => ({
      id: item.id,
      label: item.label,
    }))
  }
}
