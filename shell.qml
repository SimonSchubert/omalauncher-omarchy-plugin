// Widgets in a window of its own, outside Omarchy's shell (on Omarchy the
// plugin puts it in a bar panel instead):
//
//   quickshell -p shell.qml
//
// or `omarchy-widgets`, which raises the running one instead of starting a
// second. The window opens at startup and closing it ends the process: a
// window that is gone with its widgets' commands still running is a battery
// bug.
import QtQuick
import Quickshell
import Quickshell.Io

ShellRoot {
  id: root

  FloatingWindow {
    id: window
    visible: false
    title: "Widgets"
    color: app.ui.bg
    implicitWidth: 1280
    implicitHeight: 820
    minimumSize: Qt.size(560, 420)

    onVisibleChanged: {
      if (!visible && app.opened) app.close()
      if (visible) Qt.callLater(function() { app.keyTarget.forceActiveFocus() })
    }

    App {
      id: app
      anchors.fill: parent
      onClosed: { window.visible = false; quit.start() }
    }
  }

  function open() {
    window.visible = true
    app.open()
  }

  Component.onCompleted: open()

  // The board's layout is written as it changes; a moment lets the last
  // write reach the disk.
  Timer {
    id: quit
    interval: 500
    onTriggered: Qt.quit()
  }

  IpcHandler {
    target: "app"
    function open(): string { root.open(); return "ok" }
    function close(): string { app.close(); return "ok" }
    function toggle(): string { if (app.opened) app.close(); else root.open(); return "ok" }
    function tab(name: string): string { app.setTab(name); return "ok" }
    function store(id: string): string { root.open(); app.showStorePage(id); return "ok" }
  }
}
