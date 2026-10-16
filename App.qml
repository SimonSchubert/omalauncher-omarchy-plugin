pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import "owl/Owl.js" as OwlJs

// Widgets: your OWL widgets on a board, and the store to get more and to
// publish yours to: the board, or the store. The Omarchy plugin hosts it in a
// bar panel (plugin/Panel.qml), shell.qml in a window of its own.
//
// Drawn in the Omarchy theme: its colors.toml, read directly, so the app
// needs Quickshell and not the Omarchy shell, and changes with the theme.
// What needs a shell -- installing from the store, publishing, sudo pacman --
// is bin/omarchy-widgets, which also works on its own in a terminal.
Item {
  id: app

  property bool opened: false
  signal closed()
  // Escape with nothing left to step back from: the panel closes on it.
  signal dismissed()

  // The board's width in grid cells: twelve in a window, the phone's six in
  // the bar panel, whose card color the app takes as its background there.
  property int columns: 12
  // Set (the bar panel), cells keep this size and the width decides the columns.
  property real cellPitch: 0
  property color background: app.ink("background")
  // The board's IPC target (see BoardView); namespaced in the shell.
  property string ipcTarget: "widgets"
  readonly property Item keyTarget: keys

  // ------------------------------------------------------------ places

  readonly property string home: Quickshell.env("HOME") || ""
  readonly property string configHome: Quickshell.env("XDG_CONFIG_HOME") || app.home + "/.config"
  readonly property string stateHome: Quickshell.env("XDG_STATE_HOME") || app.home + "/.local/state"
  readonly property string dir: (Quickshell.env("OWL_WIDGETS") || app.configHome + "/omarchy-widgets").replace(/\/+$/, "")
  readonly property string stateDir: app.stateHome + "/omarchy-widgets"
  readonly property string store: (Quickshell.env("OMARCHY_WIDGETS_STORE") || "https://simonschubert.github.io/omarchy-widgets").replace(/\/+$/, "")
  readonly property string repo: "SimonSchubert/omarchy-widgets"
  readonly property string bin: Quickshell.env("OMARCHY_WIDGETS_BIN") || app.localPath(Qt.resolvedUrl("bin/omarchy-widgets"))

  // The app's version, the plugin manifest's: widgets see it as the launcher's.
  property string version: ""
  FileView {
    path: app.localPath(Qt.resolvedUrl("manifest.json"))
    printErrors: false
    onLoaded: { try { app.version = JSON.parse(text()).version || "" } catch (e) {} }
  }

  function localPath(url) {
    var u = String(url)
    return u.indexOf("file://") === 0 ? decodeURIComponent(u.slice(7)) : u
  }
  function tilde(path) { return app.home && path.indexOf(app.home) === 0 ? "~" + path.slice(app.home.length) : path }

  // ------------------------------------------------------------ theme

  // OWL's names for the Omarchy palette, for the widgets and for the app.
  property var palette: OwlJs.themeFromToml("")
  property string themeName: ""

  FileView {
    path: app.stateHome + "/omarchy/current/theme/colors.toml"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: app.palette = OwlJs.themeFromToml(text())
  }
  FileView {
    path: app.stateHome + "/omarchy/current/theme.name"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: app.themeName = text().trim()
  }

  function ink(name) {
    var v = app.palette[name]
    return v === undefined || v === null ? "#888888" : OwlJs.hex8(v)
  }

  readonly property QtObject ui: QtObject {
    readonly property color bg: app.background
    readonly property color fg: app.ink("foreground")
    readonly property color muted: app.ink("muted")
    readonly property color accent: app.ink("accent")
    readonly property color red: app.ink("red")
    readonly property color green: app.ink("green")
    readonly property color yellow: app.ink("yellow")
    readonly property color surface: app.ink("lighter_background")
    readonly property color border: alpha(muted, 0.5)
    readonly property color onAccent: (0.2126 * accent.r + 0.7152 * accent.g + 0.0722 * accent.b) > 0.55 ? "#111111" : "#ffffff"
    // Omarchy sets the fontconfig monospace alias with `omarchy font set`.
    readonly property string font: "monospace"
    readonly property int radius: 0
    readonly property int space: 12
    readonly property int control: 28
    readonly property QtObject fs: QtObject {
      readonly property int caption: 11
      readonly property int small: 12
      readonly property int body: 13
      readonly property int title: 15
      readonly property int heading: 20
    }
    function alpha(c, a) { return Qt.rgba(c.r, c.g, c.b, a) }
  }

  // ------------------------------------------------------------ store records

  // What came from the store: { "<author/name>": { file, version, commands, requires } }.
  property var records: ({})
  FileView {
    id: recordsFile
    path: app.stateDir + "/installed.json"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: { try { app.records = JSON.parse(text()) || {} } catch (e) { app.records = {} } }
    onLoadFailed: app.records = {}
  }

  function storeIdFor(file) {
    for (var id in app.records) if (app.records[id].file === file) return id
    return ""
  }

  // ------------------------------------------------------------ commands

  // A line at the bottom of the window: what just happened, or went wrong.
  property string message: ""
  property bool messageIsError: false
  function say(text, error) {
    app.message = text
    app.messageIsError = !!error
    messageTimer.restart()
  }
  Timer { id: messageTimer; interval: 8000; onTriggered: app.message = "" }

  // Runs a command; then(code, stdout, stderr).
  function run(command, then) {
    var p = runner.createObject(app, { command: command })
    p.then = then || null
    p.running = true
  }
  Component {
    id: runner
    Process {
      id: proc
      property var then: null
      stdout: StdioCollector { id: out }
      stderr: StdioCollector { id: err }
      onExited: (code) => {
        if (proc.then) proc.then(code, out.text, err.text)
        proc.destroy(1000)
      }
    }
  }

  function openUrl(url) { Quickshell.execDetached(["xdg-open", url]) }

  // ------------------------------------------------------------ view

  property string tab: "board"

  function open() {
    app.opened = true
    // A new board gets its starter widgets first (`omarchy-widgets starter`,
    // which does nothing after the first time).
    app.run([app.bin, "starter"], function(code, out, err) {
      if (code !== 0) app.say(err.replace(/^omarchy-widgets: /, "").trim(), true)
      board.rescan()
    })
    Qt.callLater(function() { keys.forceActiveFocus() })
  }

  function close() {
    if (!app.opened) return
    app.opened = false
    app.closed()
  }

  function setTab(t) {
    app.tab = t
    if (t === "store") storeView.load(false)
    else board.rescan()
    keys.forceActiveFocus()
  }

  function showStorePage(id) {
    app.setTab("store")
    storeView.show(id)
  }

  // Escape steps back one level, from the store's catalog to the board, and
  // from the bare board out of the app.
  function back() {
    if (app.tab === "board") { if (!board.back()) app.dismissed() }
    else if (!storeView.back()) app.setTab("board")
  }

  Rectangle {
    anchors.fill: parent
    color: app.ui.bg
  }

  Item {
    id: keys
    anchors.fill: parent
    focus: true

    Keys.onPressed: function(event) {
      var ctrl = event.modifiers & Qt.ControlModifier
      if (event.key === Qt.Key_Escape) app.back()
      else if (ctrl && event.key === Qt.Key_1) app.setTab("board")
      else if (ctrl && event.key === Qt.Key_2) app.setTab("store")
      else if (app.tab === "board" && board.key(event)) {}
      else if (app.tab === "store" && storeView.key(event)) {}
      else return
      event.accepted = true
    }

    BoardView {
      id: board
      app: app
      baseColumns: app.columns
      cellPitch: app.cellPitch
      anchors { top: parent.top; left: parent.left; right: parent.right; bottom: status.top }
      visible: app.tab === "board"
      active: app.opened && app.tab === "board"
    }

    StoreView {
      id: storeView
      app: app
      anchors { top: parent.top; left: parent.left; right: parent.right; bottom: status.top }
      visible: app.tab === "store"
      onInstalled: board.rescan()
    }

    Rectangle {
      id: status
      anchors.bottom: parent.bottom
      width: parent.width
      height: app.message ? 28 : 0
      visible: height > 0
      color: app.messageIsError ? app.ui.alpha(app.ui.red, 0.16) : app.ui.surface

      Text {
        anchors.fill: parent
        anchors.leftMargin: app.ui.space
        anchors.rightMargin: app.ui.space
        verticalAlignment: Text.AlignVCenter
        text: app.message
        color: app.messageIsError ? app.ui.red : app.ui.fg
        font.family: app.ui.font
        font.pixelSize: app.ui.fs.small
        elide: Text.ElideRight
      }
    }
  }
}
