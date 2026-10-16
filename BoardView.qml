pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import "owl" as Owl
import "owl/Owl.js" as OwlJs
import "BoardLayout.js" as Layout

// Your widgets, live, on the Android launcher's grid: a 69 dp cell and a 6 dp
// gap, so a 3x2 tile has the proportions it has on the phone, in twelve
// columns instead of six. Every *.owl in the widget folder is on it; saving
// one redraws it, and a widget that does not compile shows why in its tile.
// Right-click or hold a widget to arrange the board, edit a widget or publish
// it to the store.
Item {
  id: root

  required property var app
  // Sources run and animations play only while this is true.
  property bool active: false

  property bool editing: false
  property string selected: ""
  // The OwlWidget whose screen { } is up, or null.
  property var screenWidget: null

  readonly property var ui: root.app.ui
  readonly property string dir: root.app.dir

  property var files: []
  property var cells: ({})
  property bool layoutRead: false
  property bool scanned: false

  // ------------------------------------------------------------ geometry

  // The board's edges are a gap wide, the same as between tiles: n cells and
  // one gap fill the width, the gap being 6/69 of a cell.
  //
  // With a `cellPitch` (the bar panel), cells keep that size and the width
  // decides how many columns there are: a bigger panel has room for more.
  // Without one (the window), `baseColumns` stretch to fill it.
  property int baseColumns: 12
  property real cellPitch: 0
  readonly property int columns: root.cellPitch > 0
    ? Math.max(2, Math.floor((root.width - 6 / 69 * root.cellPitch) / root.cellPitch + 0.05))
    : root.baseColumns
  readonly property real pitch: root.cellPitch > 0 ? root.cellPitch
    : Math.max(40, Math.min(120, root.width / (root.columns + 6 / 69)))
  readonly property real dp: root.pitch / 69
  readonly property real gap: 6 * root.dp
  // From the side to the first tile: the gap, or more where the cells reached
  // their largest and the grid sits centred.
  readonly property real margin: Math.round((root.width - root.gridWidth) / 2)
  readonly property int usedRows: Layout.rows(root.cells, root.files)
  readonly property int shownRows: Math.max(2, root.usedRows + (root.editing ? 2 : 0))
  readonly property real gridWidth: root.columns * root.pitch - root.gap
  readonly property real gridHeight: root.shownRows * root.pitch - root.gap

  // ------------------------------------------------------------ the host

  Owl.OwlHost {
    id: host
    monoFamily: root.ui.font
    // Omarchy's fonts are Nerd Fonts, which carry weatherIcon()'s glyphs.
    iconFamily: root.ui.font
    stateDir: root.app.stateDir
    launcherVersion: root.app.version

    function act(widget, name, args) {
      var a = args || []
      function s(i) { return a[i] === undefined || a[i] === null ? "" : String(a[i]) }
      switch (name) {
      case "terminal":
        // Omarchy's terminal when there is one, any other otherwise.
        return Quickshell.execDetached(["bash", "-c",
          "if command -v omarchy-launch-tui >/dev/null; then exec omarchy-launch-tui --app-id=org.omarchy.widgets bash -c \"$1; exec bash\"; " +
          "else exec xdg-terminal-exec bash -c \"$1; exec bash\"; fi", "terminal", s(0)])
      case "launcher":
        var route = { themes: "theme", drawer: "apps" }[s(0)]
        if (route) return Quickshell.execDetached(["bash", "-c", "command -v omarchy-menu >/dev/null && exec omarchy-menu summon \"$1\"", "launcher", route])
        return widget.report("launcher(\"" + s(0) + "\") opens a screen of the Android launcher's that the desktop has no counterpart for")
      }
      host.defaultAct(widget, name, a)
    }
  }

  // ------------------------------------------------------------ files

  function rescan() { scan.running = true }

  // Every *.owl in the folder, a level or two down as well, so a checkout of
  // the store (widgets/<author>/<name>/widget.owl) works as it is.
  Process {
    id: scan
    command: ["bash", "-c", "mkdir -p \"$1\" && cd \"$1\" && find -L . -maxdepth 3 -name '*.owl' -not -path '*/.*' | sed 's|^\\./||' | sort", "scan", root.dir]
    stdout: StdioCollector {
      onStreamFinished: {
        var next = text.split("\n").filter(function(l) { return l !== "" })
        if (JSON.stringify(next) !== JSON.stringify(root.files)) root.files = next
        root.scanned = true
        settleLater.restart()
      }
    }
  }

  // ------------------------------------------------------------ layout

  // Each width keeps its own arrangement: twelve columns in board.json, n in
  // board-n.json. One not made yet starts from the arrangement before it, so
  // widening the panel moves nothing, and narrowing it moves only what no
  // longer fits; going back finds the old one as it was.
  readonly property string layoutPath: root.app.stateDir + (root.columns === 12 ? "/board.json" : "/board-" + root.columns + ".json")
  property bool stateDirMade: false
  property var lastCells: ({})
  onLayoutPathChanged: if (root.stateDirMade && root.width > 0) {
    root.lastCells = root.cells
    layoutFile.path = root.layoutPath
  }

  Process {
    running: true
    command: ["mkdir", "-p", root.app.stateDir]
    onExited: { root.stateDirMade = true; layoutFile.path = root.layoutPath }
  }

  FileView {
    id: layoutFile
    printErrors: false
    atomicWrites: true
    onLoaded: {
      var value = null
      try { value = JSON.parse(text()) } catch (e) {}
      root.cells = value && typeof value === "object" && !Array.isArray(value) ? value : {}
      root.layoutRead = true
      settleLater.restart()
    }
    onLoadFailed: {
      root.cells = root.lastCells || {}
      root.layoutRead = true
      settleLater.restart()
    }
  }

  function save(next) {
    root.cells = next
    if (layoutFile.path) layoutFile.setText(JSON.stringify(next, null, 2) + "\n")
  }

  // New widgets take the first free place once they have compiled and their
  // size is known; a widget that fails to compile gets the default 3x2.
  Timer {
    id: settleLater
    interval: 50
    onTriggered: {
      if (!root.layoutRead) return
      var sizes = {}
      for (var i = 0; i < tiles.count; i++) {
        var t = tiles.itemAt(i)
        if (t && (t.owl.program || t.owl.error)) sizes[t.file] = { size: t.owl.size }
      }
      var r = Layout.settle(root.cells, root.files, sizes, root.columns)
      if (r.changed) root.save(r.cells)
    }
  }

  function tileFor(file) {
    for (var i = 0; i < tiles.count; i++) {
      var t = tiles.itemAt(i)
      if (t && t.file === file) return t
    }
    return null
  }

  function moveTo(file, x, y) {
    var next = Layout.move(root.cells, file, x, y, root.columns, root.files)
    if (next) root.save(next)
    return !!next
  }

  function resizeTo(file, w, h) {
    var t = root.tileFor(file)
    var next = Layout.resize(root.cells, file, w, h, t ? t.owl.minSize : [1, 1], root.columns, root.files)
    if (next) root.save(next)
    return !!next
  }

  function placeAt(file, cell) {
    var next = Layout.place(root.cells, file, cell, root.columns, root.files)
    if (next) root.save(next)
    return !!next
  }

  // A tile being dragged or resized: the action bar waits until it's let go.
  // A drag whose release never came can't leave it on past the selection.
  property bool holding: false
  onSelectedChanged: root.holding = false
  onEditingChanged: root.holding = false

  function hideTile(file) {
    var next = Layout.hide(root.cells, file)
    if (!next) return
    root.save(next)
    root.selected = ""
  }

  function showTile(file) {
    var t = root.tileFor(file)
    var next = Layout.show(root.cells, file, t ? t.owl.size : [3, 2], root.columns, root.files)
    if (!next) return
    root.save(next)
    root.selected = file
  }

  function arrange(file) {
    if (root.screenWidget) return
    root.editing = true
    root.selected = file || ""
  }

  function finishEditing() {
    root.editing = false
    root.selected = ""
  }

  readonly property var hiddenFiles: root.files.filter(function(f) { return root.cells[f] && root.cells[f].hidden })

  function title(file) {
    var t = root.tileFor(file)
    if (t && t.owl.program) return t.owl.name
    var parts = file.replace(/\.owl$/, "").split("/")
    return parts[parts.length - 1] === "widget" && parts.length > 1 ? parts[parts.length - 2] : parts[parts.length - 1]
  }

  // A tree with several top-level nodes lays out as the launcher does: a Column.
  function rootNode(tree) {
    if (!tree) return null
    return tree.children.length === 1 ? tree.children[0] : { kind: "Column", p: { gap: 0 }, h: {}, a: {}, c: tree.children }
  }

  // ------------------------------------------------------------ actions

  readonly property string selectedPath: root.selected ? root.dir + "/" + root.selected : ""
  // A widget installed from the store: removed through it, not published again.
  readonly property string selectedStoreId: root.selected ? root.app.storeIdFor(root.selected) : ""

  // A new widget: the default agent in a terminal, or a template in the editor
  // (`omarchy-widgets new`); the board picks the file up as it is saved.
  function create() {
    root.app.run([root.app.bin, "new"], function(code, out, err) {
      if (code !== 0) root.app.say(err.trim() || "Could not create a widget", true)
      else root.app.say(out.trim())
      root.rescan()
    })
  }

  // Edit, publish and check hand the widget to your agent, as the phone does
  // (`omarchy-widgets edit|publish|check`), and say what they opened.
  function withAgent(command) {
    if (!root.selectedPath) return
    root.app.run([root.app.bin, command, root.selectedPath], function(code, out, err) {
      if (code !== 0) root.app.say(err.replace(/^omarchy-widgets: /, "").trim(), true)
      else if (out.trim()) root.app.say(out.trim())
    })
  }
  function edit() { root.withAgent("edit") }
  function check() { root.withAgent("check") }
  function publish() { if (!root.selectedStoreId) root.withAgent("publish") }

  // Sharing: the selected widget as a link and a QR code to scan with the
  // phone's camera, which opens it in the launcher (see `omarchy-widgets share`).
  property var sharing: null   // { name, link, png, error }
  property int shareCount: 0

  function share() {
    if (!root.selectedPath) return
    var name = root.title(root.selected)
    var png = root.app.stateDir + "/share-" + (++root.shareCount) + ".png"
    root.sharing = { name: name, link: "", png: "", error: "" }
    // Earlier codes go: only the one on screen is kept.
    root.app.run(["bash", "-c", "rm -f \"$1\"/share-*.png; exec \"$2\" share --png=\"$3\" \"$4\"", "share",
                  root.app.stateDir, root.app.bin, png, root.selectedPath], function(code, out, err) {
      if (!root.sharing || root.sharing.name !== name) return
      root.sharing = code === 0
        ? { name: name, link: out.trim(), png: "file://" + png, error: "" }
        : { name: name, link: "", png: "", error: err.replace(/^omarchy-widgets: /, "").trim() || "Could not make a QR code" }
    })
  }

  function uninstall() {
    var id = root.selectedStoreId
    if (!id) return
    root.app.run([root.app.bin, "remove", "--yes", id], function(code, out, err) {
      if (code === 0) root.app.say("Removed " + id)
      else root.app.say(err.trim() || "Could not remove " + id, true)
      root.selected = ""
      root.rescan()
    })
  }

  // Escape: the QR code, a widget's screen, then arranging. False when there
  // was nothing to step back from.
  function back() {
    if (root.sharing) root.sharing = null
    else if (root.screenWidget) root.screenWidget.closeScreen()
    else if (root.editing) root.finishEditing()
    else return false
    return true
  }

  // Keys while arranging; true when used.
  function key(event) {
    if (!root.editing) return false
    var shift = event.modifiers & Qt.ShiftModifier
    if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) { root.finishEditing(); return true }
    if (event.key === Qt.Key_Tab) {
      var shown = root.files.filter(function(f) { return root.cells[f] && !root.cells[f].hidden })
      if (shown.length) root.selected = shown[(shown.indexOf(root.selected) + 1) % shown.length]
      return true
    }
    if (!root.selected) return false
    if (event.key === Qt.Key_Delete || event.key === Qt.Key_Backspace) { root.hideTile(root.selected); return true }
    var dx = event.key === Qt.Key_Left ? -1 : event.key === Qt.Key_Right ? 1 : 0
    var dy = event.key === Qt.Key_Up ? -1 : event.key === Qt.Key_Down ? 1 : 0
    if (!dx && !dy) return false
    var c = root.cells[root.selected]
    if (shift) root.resizeTo(root.selected, c.w + dx, c.h + dy)
    else root.moveTo(root.selected, c.x + dx, c.y + dy)
    return true
  }

  // ------------------------------------------------------------ IPC

  IpcHandler {
    target: root.app.ipcTarget
    function reload(): string { root.rescan(); return "ok" }
    function arrange(file: string): string { root.arrange(file); return "ok" }
    function share(file: string): string { root.arrange(file); root.share(); return "ok" }
    function screen(file: string): string { var t = root.tileFor(file); if (t) t.owl.openScreen(); return t ? "ok" : "no such widget" }
    function list(): string {
      var out = []
      for (var i = 0; i < tiles.count; i++) {
        var t = tiles.itemAt(i)
        if (t) out.push({ file: t.file, name: t.owl.name, cell: root.cells[t.file] || null, error: t.owl.error || null })
      }
      return JSON.stringify(out)
    }
  }

  // ------------------------------------------------------------ board

  MouseArea {
    anchors.fill: parent
    // A click beside the tiles finishes arranging, as a tap outside does on the phone.
    onClicked: if (root.editing) root.finishEditing()
  }

  Flickable {
    id: board
    anchors { top: parent.top; bottom: footer.top; left: parent.left; right: parent.right }
    contentWidth: width
    contentHeight: root.gridHeight + 2 * root.gap
    clip: true
    interactive: !root.editing
    boundsBehavior: Flickable.StopAtBounds

    Item {
      id: grid
      x: root.margin
      y: Math.round(root.gap)
      width: root.gridWidth
      height: root.gridHeight

      // The grid's cells while arranging, as the phone shows them.
      Repeater {
        model: root.editing ? root.columns * root.shownRows : 0
        delegate: Rectangle {
          required property int index
          x: (index % root.columns) * root.pitch
          y: Math.floor(index / root.columns) * root.pitch
          width: root.pitch - root.gap
          height: root.pitch - root.gap
          color: "transparent"
          border.width: 1
          border.color: root.ui.alpha(root.ui.muted, 0.35)
        }
      }

      // Where the tile being dragged would land.
      Rectangle {
        id: ghost
        property var cell: null
        property bool fits: false
        visible: !!ghost.cell
        x: ghost.cell ? ghost.cell.x * root.pitch : 0
        y: ghost.cell ? ghost.cell.y * root.pitch : 0
        width: ghost.cell ? ghost.cell.w * root.pitch - root.gap : 0
        height: ghost.cell ? ghost.cell.h * root.pitch - root.gap : 0
        color: root.ui.alpha(ghost.fits ? root.ui.accent : root.ui.red, 0.12)
        border.width: Math.max(1, 2 * root.dp)
        border.color: ghost.fits ? root.ui.accent : root.ui.red
      }

      // The edge being dragged, right under the pointer: only this outline
      // moves while resizing, and the widget takes its new size on release,
      // so the edge never lags behind a widget laying itself out again.
      Rectangle {
        id: outline
        property rect r: Qt.rect(0, 0, 0, 0)
        visible: outline.r.width > 0
        x: outline.r.x
        y: outline.r.y
        width: outline.r.width
        height: outline.r.height
        z: 5
        color: "transparent"
        border.width: Math.max(2, 3 * root.dp)
        border.color: root.ui.accent
      }

      Repeater {
        id: tiles
        model: root.files

        delegate: Item {
          id: tile
          required property string modelData
          readonly property string file: modelData
          readonly property alias owl: widget
          readonly property var cell: root.cells[tile.file] || null
          readonly property bool placed: !!tile.cell && !tile.cell.hidden
          readonly property bool isSelected: root.editing && root.selected === tile.file
          // While dragging: how far the pointer has moved the tile or its corner.
          property point moved: Qt.point(0, 0)
          property point grown: Qt.point(0, 0)

          visible: tile.placed
          x: (tile.cell ? tile.cell.x * root.pitch : 0) + tile.moved.x
          y: (tile.cell ? tile.cell.y * root.pitch : 0) + tile.moved.y
          width: Math.max(root.pitch - root.gap, (tile.cell ? tile.cell.w * root.pitch - root.gap : 0) + tile.grown.x)
          height: Math.max(root.pitch - root.gap, (tile.cell ? tile.cell.h * root.pitch - root.gap : 0) + tile.grown.y)
          z: tile.moved.x || tile.moved.y || tile.grown.x || tile.grown.y ? 2 : tile.isSelected ? 1 : 0

          Rectangle {
            anchors.fill: parent
            color: widget.tree && widget.tree.background ? OwlJs.hex8(widget.tree.background) : widget.ink("background")
          }

          Owl.OwlWidget {
            id: widget
            anchors.fill: parent
            anchors.margins: (widget.program ? widget.program.padding : 12) * root.dp
            path: root.dir + "/" + tile.file
            host: host
            palette: root.app.palette
            active: root.active && tile.placed
            cols: tile.cell ? tile.cell.w : widget.size[0]
            rows: tile.cell ? tile.cell.h : widget.size[1]
            dp: root.dp
            screenWidth: screenCard.width
            screenHeight: screenCard.height
            onProgramChanged: settleLater.restart()
            onErrorChanged: settleLater.restart()
            onScreenRequested: root.screenWidget = widget
            onScreenClosed: if (root.screenWidget === widget) root.screenWidget = null
          }

          TapHandler {
            enabled: !root.editing && !!(widget.tree && widget.tree.onTap)
            onTapped: (p) => widget.tree.onTap((p.position.x - widget.x) / widget.dp, (p.position.y - widget.y) / widget.dp)
          }

          Owl.OwlNode {
            anchors.fill: widget
            visible: !widget.error && !!widget.tree
            enabled: !root.editing
            widget: widget
            node: root.rootNode(widget.tree)
          }

          Text {
            anchors.fill: widget
            visible: !!widget.error
            text: widget.error
            color: widget.ink("red")
            font.family: root.ui.font
            font.pixelSize: Math.max(9, 10 * root.dp)
            wrapMode: Text.Wrap
            elide: Text.ElideRight
          }

          // The launcher's frame: square, 2 dp, the theme's muted color.
          Rectangle {
            anchors.fill: parent
            color: "transparent"
            border.width: tile.isSelected ? Math.max(2, 3 * root.dp) : Math.max(1, 2 * root.dp)
            border.color: tile.isSelected ? root.ui.accent : widget.ink("muted")
          }

          // Hold or right-click to arrange, as on the phone's home screen.
          TapHandler {
            enabled: !root.editing
            onLongPressed: root.arrange(tile.file)
          }
          TapHandler {
            acceptedButtons: Qt.RightButton
            onTapped: root.arrange(tile.file)
          }

          // Arranging: the whole tile drags; nothing inside it is live.
          MouseArea {
            anchors.fill: parent
            visible: root.editing
            cursorShape: pressed ? Qt.ClosedHandCursor : Qt.OpenHandCursor
            property point pressedAt
            onPressed: (m) => { pressedAt = mapToItem(grid, m.x, m.y); root.selected = tile.file; root.holding = true }
            onPositionChanged: (m) => {
              var p = mapToItem(grid, m.x, m.y)
              tile.moved = Qt.point(p.x - pressedAt.x, p.y - pressedAt.y)
              ghost.cell = { x: Math.round(tile.cell.x + tile.moved.x / root.pitch), y: Math.round(tile.cell.y + tile.moved.y / root.pitch), w: tile.cell.w, h: tile.cell.h }
              ghost.fits = !!Layout.move(root.cells, tile.file, ghost.cell.x, ghost.cell.y, root.columns, root.files)
            }
            onReleased: {
              if (ghost.cell && ghost.fits) root.moveTo(tile.file, ghost.cell.x, ghost.cell.y)
              tile.moved = Qt.point(0, 0)
              ghost.cell = null
              root.holding = false
            }
            onCanceled: { tile.moved = Qt.point(0, 0); ghost.cell = null; root.holding = false }
          }

          // The selected tile resizes from any edge, in whole cells, as on the
          // phone: a handle in the middle of each side, the whole side to grab.
          Repeater {
            model: tile.isSelected ? ["left", "top", "right", "bottom"] : []
            delegate: Item {
              id: side
              required property string modelData
              readonly property bool across: side.modelData === "left" || side.modelData === "right"
              readonly property real grab: 8
              x: side.modelData === "left" ? -grab : side.modelData === "right" ? tile.width - grab : 0
              y: side.modelData === "top" ? -grab : side.modelData === "bottom" ? tile.height - grab : 0
              width: side.across ? 2 * grab : tile.width
              height: side.across ? tile.height : 2 * grab
              z: 3

              Rectangle {
                anchors.centerIn: parent
                visible: !root.holding
                width: Math.max(12, 14 * root.dp)
                height: width
                radius: width / 2
                color: root.ui.accent
                border.width: 2
                border.color: root.ui.bg
              }

              MouseArea {
                anchors.fill: parent
                cursorShape: side.across ? Qt.SizeHorCursor : Qt.SizeVerCursor
                property point pressedAt
                onPressed: (m) => { pressedAt = mapToItem(grid, m.x, m.y); root.holding = true }
                onPositionChanged: (m) => {
                  var p = mapToItem(grid, m.x, m.y)
                  var dx = side.across ? p.x - pressedAt.x : 0, dy = side.across ? 0 : p.y - pressedAt.y
                  var e = {}
                  e[side.modelData] = true
                  // The outline: the tile's edges, the dragged one at the pointer,
                  // never smaller than minSize nor off the grid.
                  var c = tile.cell, min = widget.minSize
                  var l = c.x * root.pitch, t = c.y * root.pitch
                  var r = l + c.w * root.pitch - root.gap, b = t + c.h * root.pitch - root.gap
                  if (e.left) l = Math.max(0, Math.min(l + dx, r - (min[0] * root.pitch - root.gap)))
                  if (e.right) r = Math.min(root.gridWidth, Math.max(r + dx, l + min[0] * root.pitch - root.gap))
                  if (e.top) t = Math.max(0, Math.min(t + dy, b - (min[1] * root.pitch - root.gap)))
                  if (e.bottom) b = Math.max(b + dy, t + min[1] * root.pitch - root.gap)
                  outline.r = Qt.rect(l, t, r - l, b - t)
                  ghost.cell = Layout.edge(c, e, Math.round(dx / root.pitch), Math.round(dy / root.pitch), min, root.columns)
                  ghost.fits = !!Layout.place(root.cells, tile.file, ghost.cell, root.columns, root.files)
                }
                function done() {
                  outline.r = Qt.rect(0, 0, 0, 0)
                  ghost.cell = null
                  root.holding = false
                }
                onReleased: {
                  if (ghost.cell && ghost.fits) root.placeAt(tile.file, ghost.cell)
                  done()
                }
                onCanceled: done()
              }
            }
          }
        }
      }

      // What the selected tile can do, next to it, as on the phone: above
      // it, or below where there's no room; hidden while it's held.
      Rectangle {
        id: actionBar
        readonly property var t: root.editing && root.selected && !root.holding ? root.tileFor(root.selected) : null
        visible: !!actionBar.t
        z: 4
        width: tileActions.implicitWidth + 12
        height: tileActions.implicitHeight + 12
        x: actionBar.t ? Math.max(0, Math.min(actionBar.t.x, root.gridWidth - width)) : 0
        y: actionBar.t ? (actionBar.t.y - height - 6 >= 0 ? actionBar.t.y - height - 6 : actionBar.t.y + actionBar.t.height + 6) : 0
        color: root.ui.bg
        border.width: 1
        border.color: root.ui.accent

        Row {
          id: tileActions
          anchors.centerIn: parent
          spacing: 6
          Btn { ui: root.ui; text: "Edit"; onClicked: root.edit() }
          Btn { ui: root.ui; text: "Share"; onClicked: root.share() }
          Btn { ui: root.ui; visible: root.selectedStoreId !== ""; text: "Uninstall"; onClicked: root.uninstall() }
          Btn { ui: root.ui; visible: root.selectedStoreId === ""; text: "Take off"; onClicked: root.hideTile(root.selected) }
        }
      }
    }

    Column {
      anchors.centerIn: parent
      width: Math.min(parent.width - 2 * root.ui.space, 560)
      spacing: root.ui.space
      visible: root.scanned && root.files.length === 0

      Text {
        width: parent.width
        text: "No widgets yet"
        color: root.ui.fg
        font.family: root.ui.font
        font.pixelSize: root.ui.fs.heading
        horizontalAlignment: Text.AlignHCenter
      }
      Text {
        width: parent.width
        text: "Get reviewed ones from the store, or write your own: a widget is one .owl file in "
          + root.app.tilde(root.dir) + ", and it shows up here as you save it."
        color: root.ui.muted
        font.family: root.ui.font
        font.pixelSize: root.ui.fs.body
        horizontalAlignment: Text.AlignHCenter
        wrapMode: Text.Wrap
      }
      Row {
        anchors.horizontalCenter: parent.horizontalCenter
        spacing: 6
        Btn { ui: root.ui; text: "Open the store"; primary: true; onClicked: root.app.setTab("store") }
        Btn { ui: root.ui; text: "The widget language"; onClicked: root.app.openUrl("https://github.com/" + root.app.repo + "/blob/main/docs/LANGUAGE.md") }
      }
    }
  }

  // ------------------------------------------------------------ footer

  // What the board can do now; while arranging, what the selected widget can.
  Rectangle {
    id: footer
    anchors.bottom: parent.bottom
    width: parent.width
    height: 44
    color: root.ui.bg

    Rectangle { width: parent.width; height: 1; color: root.ui.border }

    Row {
      id: storeCreate
      anchors.left: parent.left
      anchors.leftMargin: root.margin
      anchors.verticalCenter: parent.verticalCenter
      spacing: 6
      visible: !root.editing

      Btn { ui: root.ui; text: "Store"; onClicked: root.app.setTab("store") }
      Btn { ui: root.ui; text: "Create"; onClicked: root.create() }
    }

    Text {
      anchors.left: storeCreate.visible ? storeCreate.right : parent.left
      anchors.leftMargin: storeCreate.visible ? root.ui.space : root.margin
      anchors.right: actions.left
      anchors.rightMargin: root.ui.space
      anchors.verticalCenter: parent.verticalCenter
      text: root.editing
        ? "Drag a tile to move it, an edge to resize it. Click beside the tiles when you're done."
        : "Right-click or hold a widget to arrange, edit, share or publish it."
      color: root.ui.muted
      font.family: root.ui.font
      font.pixelSize: root.ui.fs.caption
      elide: Text.ElideRight
    }

    Row {
      id: actions
      anchors.right: parent.right
      anchors.rightMargin: root.margin
      anchors.verticalCenter: parent.verticalCenter
      spacing: 6

      Repeater {
        model: root.editing ? root.hiddenFiles : []
        delegate: Btn {
          required property string modelData
          ui: root.ui
          text: "+ " + root.title(modelData)
          onClicked: root.showTile(modelData)
        }
      }
    }
  }

  // ------------------------------------------------------------ screen

  // A widget's screen { }: the phone's full-screen view, as a card of a
  // phone's width over the board.
  Rectangle {
    anchors.fill: parent
    visible: !!root.screenWidget
    color: root.ui.alpha(root.ui.bg, 0.7)

    MouseArea {
      anchors.fill: parent
      onClicked: if (root.screenWidget) root.screenWidget.closeScreen()
    }
  }

  Rectangle {
    id: screenCard
    anchors.centerIn: parent
    visible: !!root.screenWidget
    width: Math.min(root.width - 2 * root.ui.space, 412 * root.dp)
    height: root.height - 2 * root.ui.space
    color: root.screenWidget && root.screenWidget.screenTree && root.screenWidget.screenTree.background
      ? OwlJs.hex8(root.screenWidget.screenTree.background) : root.ui.bg
    border.width: 2
    border.color: root.ui.border

    MouseArea { anchors.fill: parent }

    Item {
      id: screenHeader
      x: 16 * root.dp
      y: 8 * root.dp
      width: screenCard.width - 32 * root.dp
      height: root.ui.control + 8

      Btn {
        id: closeScreen
        ui: root.ui
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        text: "‹ Back"
        onClicked: if (root.screenWidget) root.screenWidget.closeScreen()
      }
      Text {
        anchors.left: closeScreen.right
        anchors.leftMargin: root.ui.space
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        text: root.screenWidget && root.screenWidget.screenTree ? root.screenWidget.screenTree.title || "" : ""
        color: root.ui.fg
        font.family: root.ui.font
        font.pixelSize: root.ui.fs.title
        elide: Text.ElideRight
      }
    }

    Item {
      anchors.fill: parent
      anchors.topMargin: screenHeader.y + screenHeader.height + 8 * root.dp
      anchors.margins: 16 * root.dp

      TapHandler {
        enabled: !!(root.screenWidget && root.screenWidget.screenTree && root.screenWidget.screenTree.onTap)
        onTapped: (p) => root.screenWidget.screenTree.onTap(p.position.x / root.dp, p.position.y / root.dp)
      }

      Owl.OwlNode {
        anchors.fill: parent
        widget: root.screenWidget
        node: root.screenWidget ? root.rootNode(root.screenWidget.screenTree) : null
      }
    }
  }

  // ------------------------------------------------------------ share

  Rectangle {
    anchors.fill: parent
    visible: !!root.sharing
    color: root.ui.alpha(root.ui.bg, 0.7)
    MouseArea { anchors.fill: parent; onClicked: root.sharing = null }
  }

  Rectangle {
    anchors.centerIn: parent
    visible: !!root.sharing
    width: shareCode.width + 4 * root.ui.space
    height: shareBody.implicitHeight + 2 * root.ui.space * 2
    color: root.ui.bg
    border.width: 2
    border.color: root.ui.border

    MouseArea { anchors.fill: parent }

    Column {
      id: shareBody
      anchors.fill: parent
      anchors.margins: root.ui.space * 2
      spacing: root.ui.space

      Text {
        width: parent.width
        text: root.sharing ? "Share " + root.sharing.name : ""
        color: root.ui.fg
        font.family: root.ui.font
        font.pixelSize: root.ui.fs.title
      }

      // Black on white whatever the theme: what phone cameras read best.
      Rectangle {
        id: shareCode
        visible: !!(root.sharing && root.sharing.png)
        anchors.horizontalCenter: parent.horizontalCenter
        // As large as fits: a long widget makes a dense code.
        width: Math.max(160, Math.min(480, root.height - 360, root.width - 6 * root.ui.space))
        height: width
        color: "white"
        Image {
          anchors.fill: parent
          anchors.margins: 8
          source: root.sharing ? root.sharing.png : ""
          fillMode: Image.PreserveAspectFit
          smooth: false
          cache: false
        }
      }

      Text {
        width: parent.width
        visible: !!root.sharing && !root.sharing.png && !root.sharing.error
        text: "Making the code…"
        color: root.ui.muted
        font.family: root.ui.font
        font.pixelSize: root.ui.fs.small
      }

      Text {
        width: parent.width
        visible: !!(root.sharing && root.sharing.error)
        text: root.sharing ? root.sharing.error : ""
        color: root.ui.red
        font.family: root.ui.font
        font.pixelSize: root.ui.fs.small
        wrapMode: Text.Wrap
      }

      Text {
        width: parent.width
        visible: !!(root.sharing && root.sharing.png)
        text: "Scan it with the phone's camera: it opens in Omalauncher, which shows everything the widget runs before adding it. The whole widget is in the code; nothing is uploaded."
        color: root.ui.muted
        font.family: root.ui.font
        font.pixelSize: root.ui.fs.small
        wrapMode: Text.Wrap
      }

      Row {
        spacing: 6
        Btn {
          ui: root.ui
          visible: !!(root.sharing && root.sharing.link)
          text: "Copy link"
          onClicked: {
            Quickshell.execDetached(["wl-copy", "--", root.sharing.link])
            root.app.say("Copied the link to " + root.sharing.name)
          }
        }
        Btn { ui: root.ui; text: "Check for secrets"; onClicked: { root.sharing = null; root.check() } }
      }

      // For everyone, as the phone's Share has it: your own widgets only.
      Column {
        width: parent.width
        spacing: root.ui.space / 2
        visible: !root.selectedStoreId

        Rectangle { width: parent.width; height: 1; color: root.ui.border }
        Text {
          text: "in the store"
          color: root.ui.accent
          font.family: root.ui.font
          font.pixelSize: root.ui.fs.title
        }
        Text {
          width: parent.width
          text: "Your agent forks the store and opens a pull request; a maintainer reviews it."
          color: root.ui.muted
          font.family: root.ui.font
          font.pixelSize: root.ui.fs.small
          wrapMode: Text.Wrap
        }
        Btn { ui: root.ui; primary: true; text: "Publish with your agent"; onClicked: { root.sharing = null; root.publish() } }
      }

      Btn { ui: root.ui; text: "Close"; onClicked: root.sharing = null }
    }
  }
}

