import QtQuick
import Quickshell.Io

Item {
  id: root
  property string city: "Utrecht"
  property string weather: ""

  Process {
    id: fetchWeather
    command: ["/usr/bin/curl", "-q", "-fsS", "--max-time", "5", "--max-filesize", "65536", "https://wttr.in/" + root.city + "?format=3"]
    stdout: StdioCollector {
      onStreamFinished: root.weather = this.text
    }
  }

  Timer {
    id: fetchDeadline
    interval: 8000
    running: fetchWeather.running
    onTriggered: fetchWeather.kill()
  }

  Component.onCompleted: fetchWeather.running = true
}
