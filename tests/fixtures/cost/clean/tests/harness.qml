import QtQuick

// A test harness that ships with the plugin. The shell never loads it, so
// its timer must not count.
Item {
  Timer { interval: 10; repeat: true; running: true }
}
