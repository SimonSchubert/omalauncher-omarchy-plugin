pragma ComponentBehavior: Bound

// One OWL widget file, live: compiled by Owl.js, its sources run by
// OwlSource.qml, drawn by OwlNode.qml.
//
// What the launcher writes to `.errors/<file>.txt` beside the widget -- the
// compile error with a caret, then runtime problems as they happen -- this
// writes too, in the same place, because that file is what an agent writing
// a widget is told to read (docs/widgets.md).
//
// `state x = ... persist` survives in ~/.local/state/omarchy-mobile/widgets/
// <file>.json.

import QtQuick
import QtQml
import Quickshell
import Quickshell.Io
import "Owl.js" as Owl

Item {
  id: root

  // The .owl file.
  property string path: ""
  // The shell's side: fonts, actions, media. An OwlHost.
  property OwlHost host: OwlHost {}
  // name -> ARGB, from OwlTheme.
  property var palette: ({})
  // Sources run and animations play only while this is true: the board is up.
  property bool active: false
  // The tile in grid cells, and one cell's side in px.
  property int cols: 3
  property int rows: 2
  property real cell: 60
  // The board, for screenWidth/screenHeight.
  property real screenWidth: 360
  property real screenHeight: 720

  // One dp, in px. The board sets it from the cell size so a widget keeps
  // the proportions it was drawn with on the launcher's grid.
  property real dp: root.host.dp
  readonly property string home: root.host.home
  readonly property string fileName: root.path.slice(root.path.lastIndexOf("/") + 1)
  readonly property string dir: root.path.slice(0, root.path.lastIndexOf("/"))
  readonly property string stateDir: root.host.stateDir
  readonly property string sansFamily: root.host.sansFamily
  readonly property string monoFamily: root.host.monoFamily
  // The Nerd Font upstream's bar uses, which has the weather and moon glyphs
  // weatherIcon() returns.
  readonly property string iconFamily: root.host.iconFamily

  property var program: null
  property var instance: null
  property var tree: null
  property var screenTree: null
  property bool screenOpen: false
  property string error: ""
  property var problems: []
  // Bumped on every change, for bindings that re-read the instance.
  property int generation: 0
  // Bumped every animation frame.
  property int frame: 0

  readonly property string name: root.program ? root.program.name : root.fileName.replace(/\.owl$/, "")
  readonly property var size: root.program && root.program.size ? root.program.size : [3, 2]
  readonly property var minSize: root.program ? root.program.minSize : [1, 1]
  readonly property int page: root.program ? root.program.page : 1
  readonly property int order: root.program ? root.program.order : 0
  readonly property bool hasScreen: !!(root.program && root.program.screen)

  signal screenRequested()
  signal screenClosed()

  // ---------------------------------------------------------------- theme

  function ink(name) {
    var v = root.palette[name]
    return v === undefined || v === null ? "#ff888888" : Owl.hex8(v)
  }

  function alpha(c, a) {
    var q = Qt.color(c)
    return Qt.rgba(q.r, q.g, q.b, q.a * a)
  }

  onPaletteChanged: {
    if (!root.instance) return
    root.instance.invalidate()
    root.render()
  }

  // ---------------------------------------------------------------- load

  property string sourceText: ""
  property var persisted: null
  property bool stateRead: false

  FileView {
    id: sourceFile
    path: root.path
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: {
      root.sourceText = text()
      root.load()
    }
    onLoadFailed: {
      root.sourceText = ""
      root.fail("can't read " + root.path)
    }
  }

  FileView {
    id: stateFile
    path: root.fileName ? root.stateDir + "/" + root.fileName + ".json" : ""
    printErrors: false
    atomicWrites: true
    onLoaded: {
      try { root.persisted = JSON.parse(text()) } catch (e) { root.persisted = {} }
      root.stateRead = true
      root.load()
    }
    onLoadFailed: {
      root.persisted = {}
      root.stateRead = true
      root.load()
    }
  }

  function load() {
    if (!root.stateRead || root.sourceText === "") return
    var program
    try {
      program = Owl.compile(root.sourceText)
    } catch (e) {
      root.fail(Owl.formatError(root.sourceText, e))
      return
    }
    root.error = ""
    root.problems = []
    writeErrors()
    root.program = program
    root.instance = new Owl.Instance(program, root.bridge, root.persisted || {})
    root.sourceSpecs = root.instance.sources()
    root.everySpecs = root.instance.everyTriggers()
    root.render()
  }

  function fail(message) {
    root.error = message
    root.program = null
    root.instance = null
    root.sourceSpecs = []
    root.everySpecs = []
    root.tree = null
    root.screenTree = null
    writeErrors()
  }

  // ------------------------------------------------------------ the host

  // What the compiled widget calls back into (Owl.js's Instance host).
  readonly property var bridge: ({
    theme: function(name) {
      var v = root.palette[name]
      return v === undefined ? null : v
    },
    tile: function(name) {
      if (name === "linux") return true
      if (name === "cols") return root.cols
      if (name === "rows") return root.rows
      if (name === "tileWidth") return root.width / root.dp
      if (name === "tileHeight") return root.height / root.dp
      if (name === "screenWidth") return root.screenWidth / root.dp
      if (name === "screenHeight") return root.screenHeight / root.dp
      // Omarchy's corners are square.
      if (name === "corners") return 0
      return null
    },
    act: function(name, args) { root.act(name, args) },
    runInto: function(command, slot) { root.runInto(command, slot) },
    report: function(message) { root.report(message) },
    changed: function() { root.changed() }
  })

  function changed() {
    root.generation++
    savePersisted.restart()
    renderLater.restart()
  }

  // Coalesced: a handler that sets three states draws once.
  Timer {
    id: renderLater
    interval: 0
    onTriggered: root.render()
  }

  function render() {
    if (!root.instance) return
    root.tree = root.instance.render(false)
    if (root.screenOpen) root.screenTree = root.instance.render(true)
  }

  // Tile size feeds tileWidth and tileHeight, which a widget may draw from.
  onWidthChanged: if (root.instance) { root.instance.invalidate(); renderLater.restart() }
  onHeightChanged: if (root.instance) { root.instance.invalidate(); renderLater.restart() }

  // ------------------------------------------------------------ sources

  property var sourceSpecs: []

  function sourceValue(slot, value) {
    if (root.instance) root.instance.setSource(slot, value)
  }

  function sourceObject(slot, value) {
    if (root.instance) root.instance.setSource(slot, Owl.fromJson(value))
  }

  function sourceJson(slot, text) {
    if (!root.instance) return
    var v = null
    try { v = Owl.parseJson(String(text).trim()) } catch (e) { root.report("not JSON: " + String(text).slice(0, 80)) }
    root.instance.setSource(slot, v)
  }

  // A `status` source: {out, err, code, ok}, as docs/LANGUAGE.md has it. `out`
  // is parsed when the source is `json` (null when it is not JSON), `code` is
  // the exit code or the HTTP status, 124 for a timeout.
  function sourceStatus(slot, code, text, err, json, ok) {
    if (!root.instance) return
    var out = text
    if (json) {
      try { out = Owl.parseJson(String(text).trim()) } catch (e) { out = null }
    } else out = String(text).replace(/\s+$/, "")
    root.instance.setSource(slot, new Map([["out", out], ["err", String(err || "").replace(/\s+$/, "")], ["code", code], ["ok", !!ok]]))
  }

  Instantiator {
    model: root.sourceSpecs
    delegate: OwlSource {
      required property var modelData
      spec: modelData
      widget: root
    }
  }

  // ----------------------------------------------------------- triggers

  property var everySpecs: []

  Instantiator {
    model: root.everySpecs
    delegate: Timer {
      required property var modelData
      interval: modelData.seconds * 1000
      repeat: true
      running: root.active && !!root.instance
      onTriggered: if (root.instance) root.instance.fire(modelData.index)
    }
  }

  Timer {
    interval: 1000
    repeat: true
    running: root.active && !!root.instance && root.instance.hasAt()
    onTriggered: root.instance.tick(Date.now() / 1000)
  }

  // -------------------------------------------------------- animation

  // `time` is seconds since the frame clock started, like the launcher's,
  // which a widget is written to expect: it restarts when the board reopens.
  FrameAnimation {
    running: root.active && !!root.program && root.program.animated && root.visible
    onTriggered: {
      root.instance.frame(elapsedTime)
      root.frame++
      if (root.tree && root.tree.readsTime) root.render()
    }
  }

  // ------------------------------------------------------------ actions

  // run(), refresh(), screen() and close() are the widget's own; the rest
  // -- terminal, app, url, media, launcher... -- are the host's.
  function act(name, args) {
    var a = args || []
    switch (name) {
    case "run": return runAndRefresh(a[0] === undefined || a[0] === null ? "" : Owl.show(a[0]))
    case "refresh": return root.refresh()
    case "screen": return root.openScreen()
    case "close": return root.closeScreen()
    }
    root.host.act(root, name, a.map(function(v) { return v === null || v === undefined ? null : Owl.show(v) }))
  }

  function refresh() {
    var specs = root.sourceSpecs
    root.sourceSpecs = []
    root.sourceSpecs = specs
  }

  property var runs: []

  function runAndRefresh(command) {
    var p = runner.createObject(root, { command: ["bash", "-c", command], slot: -1 })
    p.running = true
  }

  function runInto(command, slot) {
    var p = runner.createObject(root, { command: ["bash", "-c", command], slot: slot })
    p.running = true
  }

  // run() and `x = run(...)`: one process each, gone when it ends. The first
  // refreshes the widget's sources after; the second sets the state.
  Component {
    id: runner
    Process {
      id: proc
      property int slot: -1
      workingDirectory: root.home || "/"
      stdout: StdioCollector {
        id: out
        onStreamFinished: {
          if (proc.slot >= 0 && root.instance) root.instance.setState(proc.slot, out.text.replace(/\s+$/, ""))
        }
      }
      onExited: {
        if (proc.slot < 0) root.refresh()
        proc.destroy(1000)
      }
    }
  }

  // ------------------------------------------------------------- screen

  function openScreen() {
    if (!root.hasScreen) return
    root.screenOpen = true
    root.screenTree = root.instance.render(true)
    root.screenRequested()
  }

  function closeScreen() {
    if (!root.screenOpen) return
    root.screenOpen = false
    root.screenTree = null
    root.screenClosed()
  }

  // --------------------------------------------------------- persistence

  Timer {
    id: savePersisted
    interval: 500
    onTriggered: {
      if (!root.instance) return
      var data = root.instance.persisted()
      if (Object.keys(data).length === 0) return
      var text = JSON.stringify(data)
      if (text === JSON.stringify(root.persisted)) return
      root.persisted = data
      ensureDir(root.stateDir, function() { stateFile.setText(text + "\n") })
    }
  }

  // -------------------------------------------------------------- errors

  function report(message) {
    var line = String(message)
    if (root.problems.indexOf(line) >= 0) return
    root.problems = root.problems.concat([line]).slice(-20)
    writeErrorsLater.restart()
  }

  Timer {
    id: writeErrorsLater
    interval: 1000
    onTriggered: writeErrors()
  }

  function writeErrors() {
    if (!root.fileName) return
    var text = root.error ? root.error + "\n" : ""
    if (root.problems.length) text += root.problems.join("\n") + "\n"
    var dir = root.dir + "/.errors"
    ensureDir(dir, function() { errorFile.setText(text) })
  }

  FileView {
    id: errorFile
    path: root.fileName ? root.dir + "/.errors/" + root.fileName.replace(/\.owl$/, "") + ".txt" : ""
    printErrors: false
    blockLoading: true
  }

  // setText() does not make directories.
  function ensureDir(path, then) {
    var p = mkdir.createObject(root, { command: ["mkdir", "-p", path] })
    p.exited.connect(function() { then(); p.destroy(1000) })
    p.running = true
  }

  Component {
    id: mkdir
    Process {}
  }
}
