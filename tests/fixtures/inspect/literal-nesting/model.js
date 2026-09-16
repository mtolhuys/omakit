.pragma library

function settings(defaults) {
  var result = {
    interval: defaults.interval || {
      seconds: 5,
      jitter: 0,
    },
    colours: defaults.colours || [
      "red",
      "green",
    ],
  }
  if (defaults.frozen) {
    Object.freeze(result)
  }
  return result
}
