// OWL's `Terminal { command: ... }`: a shell in the tile.
//
// The launcher embeds a real foot window here, which it can because it is the
// compositor. Here Hyprland is, and a layer surface cannot host another
// client's window, so this is a small terminal of its own: the command (or a
// login shell) on a pseudo-terminal by way of script(1), its output as text,
// a line to type into. That carries a shell, a REPL, `tail -f`, anything that
// reads and writes lines. Anything that draws the whole screen -- vim, htop --
// wants a real terminal, and ↗ opens one with the same command.
//
// The session starts the first time the board shows it and runs while the
// shell does, as the launcher's do while their tile exists.

import QtQuick
import Quickshell
import Quickshell.Io
import "OwlLayout.js" as L

Rectangle {
  id: root

  property var node: null
  property var widget: null

  readonly property var p: root.node && root.node.p ? root.node.p : ({})
  readonly property real dp: root.widget ? root.widget.dp : 1
  readonly property string command: root.p.command ? String(root.p.command) : ""
  readonly property real fontSize: L.num(root.p.fontSize, 11) * root.dp

  color: root.widget ? root.widget.ink("dark_background") : "black"
  implicitWidth: 200 * root.dp
  implicitHeight: 120 * root.dp

  // The screen as lines, the last one still being written.
  property var lines: [""]
  readonly property int keep: 400

  FontMetrics {
    id: metrics
    font.family: root.widget ? root.widget.monoFamily : "monospace"
    font.pixelSize: root.fontSize
  }
  readonly property int columns: Math.max(20, Math.floor((root.width - 8 * root.dp) / Math.max(metrics.averageCharacterWidth, 1)))
  readonly property int rows: Math.max(4, Math.floor(output.height / Math.max(metrics.height, 1)))

  // Colour and cursor escapes are dropped rather than drawn: TERM=dumb asks
  // programs not to send them, and these are the ones that come anyway.
  function feed(data) {
    var text = String(data)
      .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
      .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "")
      .replace(/\x1b[()][0-9A-Za-z]/g, "")
      .replace(/\x1b[=>78DEHM]/g, "")
    var out = root.lines.slice()
    var line = out.pop()
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i)
      if (c === "\n") { out.push(line); line = "" }
      else if (c === "\r") { if (text.charAt(i + 1) !== "\n") line = "" }
      else if (c === "\b") line = line.slice(0, -1)
      else if (c === "\x07") continue
      else if (c >= " " || c === "\t") line += c
    }
    out.push(line)
    if (out.length > root.keep) out = out.slice(out.length - root.keep)
    root.lines = out
  }

  function send(text) {
    if (shell.running) shell.write(text)
  }

  Process {
    id: shell
    // script(1) gives the command a terminal of its own, so a shell prompts
    // and line-edits as it would in one; stty tells it the tile's size.
    command: ["script", "-qfec",
      "stty cols " + root.columns + " rows " + root.rows + " 2>/dev/null; "
        + (root.command !== "" ? root.command : "exec bash -l"),
      "/dev/null"]
    environment: ({ TERM: "dumb", PAGER: "cat", GIT_PAGER: "cat", COLUMNS: String(root.columns) })
    workingDirectory: Quickshell.env("HOME") || "/"
    stdinEnabled: true
    stdout: SplitParser {
      // No marker: every chunk as it arrives, so a prompt with no newline
      // after it shows.
      splitMarker: ""
      onRead: (data) => root.feed(data)
    }
    onExited: (code) => root.feed("\n[exited " + code + " -- tap ↻ to start again]\n")
  }

  property bool started: false
  // Not before the tile is laid out: stty tells the shell its size once, at
  // the start, and a session begun at 0x0 would format for 20 columns. A
  // tile resized later keeps the size it started with; lines still wrap.
  readonly property bool wanted: !!root.widget && root.widget.active && root.visible
    && output.width > 40 * root.dp && output.height > 30 * root.dp
  onWantedChanged: if (root.wanted && !root.started) startLater.restart()
  Component.onCompleted: if (root.wanted) startLater.restart()

  Timer {
    id: startLater
    interval: 200
    onTriggered: if (root.wanted && !root.started) root.start()
  }

  function start() {
    root.started = true
    root.lines = [""]
    shell.running = true
  }

  // ------------------------------------------------------------ output

  ListView {
    id: output
    anchors { left: parent.left; right: parent.right; top: parent.top; bottom: bar.top }
    anchors.margins: 4 * root.dp
    clip: true
    model: root.lines.length
    // Stays at the bottom, like a terminal, unless scrolled up to read.
    property bool follow: true
    onMovementEnded: output.follow = output.atYEnd
    onCountChanged: if (output.follow) Qt.callLater(output.positionViewAtEnd)
    boundsBehavior: Flickable.StopAtBounds
    delegate: Text {
      required property int index
      width: output.width
      text: root.lines[index] || " "
      color: root.widget ? root.widget.ink("foreground") : "white"
      font: metrics.font
      wrapMode: Text.WrapAnywhere
    }
    TapHandler { onTapped: field.forceActiveFocus() }
  }

  // --------------------------------------------------------------- input

  Rectangle {
    id: bar
    anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
    height: Math.max(metrics.height + 12 * root.dp, 28 * root.dp)
    color: root.widget ? root.widget.alpha(root.widget.ink("foreground"), 0.06) : "transparent"

    Row {
      id: keys
      anchors { right: parent.right; verticalCenter: parent.verticalCenter; rightMargin: 4 * root.dp }
      spacing: 2 * root.dp
      Repeater {
        // ^C interrupts, ⇥ completes, ↻ restarts an ended session, ↗ opens a real terminal.
        model: [
          { label: "^C", send: "\x03" }, { label: "⇥", send: "\t" },
          { label: shell.running ? "↗" : "↻", open: true }
        ]
        delegate: Text {
          required property var modelData
          text: modelData.label
          color: root.widget ? root.widget.ink("accent") : "white"
          font.family: root.widget ? root.widget.monoFamily : "monospace"
          font.pixelSize: root.fontSize
          leftPadding: 6 * root.dp
          rightPadding: 6 * root.dp
          topPadding: 4 * root.dp
          bottomPadding: 4 * root.dp
          TapHandler {
            onTapped: {
              if (!modelData.open) return root.send(modelData.send)
              if (!shell.running) return root.start()
              if (root.widget) root.widget.act("terminal", [root.command !== "" ? root.command : "exec bash -l"])
            }
          }
        }
      }
    }

    TextInput {
      id: field
      anchors { left: parent.left; right: keys.left; verticalCenter: parent.verticalCenter; leftMargin: 6 * root.dp }
      color: root.widget ? root.widget.ink("foreground") : "white"
      font: metrics.font
      clip: true
      // Each line goes to the session as typed with a newline, so the
      // terminal's own echo is what shows it in the output.
      onAccepted: {
        root.send(field.text + "\n")
        field.text = ""
        output.follow = true
      }
      onActiveFocusChanged: {
        if (root.widget) root.widget.host.fieldFocused(field.activeFocus)
      }
      Text {
        anchors.fill: parent
        visible: field.text === "" && !field.activeFocus
        text: "$ tap to type"
        color: root.widget ? root.widget.ink("muted") : "grey"
        font: field.font
      }
    }
  }
}
