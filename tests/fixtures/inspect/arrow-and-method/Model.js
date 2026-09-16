.pragma library

const load = (rows) => {
  const out = []
  for (const row of rows) {
    if (row.visible) {
      out.push(row)
    }
  }
  return out
}

let count = 0
var normalise = row => {
  count += 1
  return String(row).trim()
}

const store = {
  items: [],
  add(item) {
    if (item) {
      this.items.push(item)
    }
  },
  async flush() {
    while (this.items.length) {
      this.items.pop()
    }
  },
}

store.reset = () => {
  store.items = []
}

class Cache {
  constructor(limit) {
    this.limit = limit
  }

  static of(limit) {
    return new Cache(limit)
  }

  put(key, value) {
    if (this.size() >= this.limit) {
      this.evict()
    }
    this[key] = value
  }
}

const handlers = [1, 2, 3].map(function (n) {
  return n * 2
})

const timer = setTimeout(() => {
  if (count > 3) {
    load([])
  }
}, 10)
