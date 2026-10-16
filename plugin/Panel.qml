import QtQuick
import Quickshell.Io
import qs.Commons
import qs.Ui
import ".."

// The Widgets board in a bar panel, as weather's card hangs off its pill: the
// phone's six columns, the store a click away, in the shell's popup card.
// The app exists only while the panel is open, so no widget's sources run,
// and nothing of it stays in the shell, once it closes.
Panel {
  id: root
  moduleName: "io.github.simonschubert.omalauncher"
  ipcTarget: "io.github.simonschubert.omalauncher"

  property var anchorItem: null
  // The bar knows the widget in its slot, not this panel (see weather's).
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root

  // What shell.qml's "app" target does for the window: show the store, or a
  // widget's page in it.
  IpcHandler {
    target: "io.github.simonschubert.omalauncher.app"
    function tab(name: string): string { root.open(); Qt.callLater(function() { if (app.item) app.item.setTab(name) }); return "ok" }
    function store(id: string): string { root.open(); Qt.callLater(function() { if (app.item) app.item.showStorePage(id) }); return "ok" }
  }

  // The size, in the settings' units (Style.space scales them): the saved
  // settings, or what a drag of the panel's edge has made it since.
  readonly property real unit: Style.space(100) / 100
  // The card's border, left and right, which the board sits inside.
  readonly property real inset: Border.left(panel.borderSpec) + Border.right(panel.borderSpec)
  // A cell: the phone's six columns across the default 480, whatever the
  // panel's width, which only decides how many fit.
  readonly property real cellPitch: (Style.space(480) - root.inset) / (6 + 6 / 69)
  // The width, in the settings' units, that n columns fill exactly, with
  // edges as wide as the gaps between tiles.
  function widthFor(n) { return ((n + 6 / 69) * root.cellPitch + root.inset) / root.unit }
  property real dragWidth: 0
  property real dragHeight: 0
  readonly property real wantWidth: root.dragWidth || Number(root.setting("width", 480)) || 480
  readonly property real wantHeight: root.dragHeight || Number(root.setting("height", 680)) || 680

  // Saves a dragged size as the plugin's settings, where `omarchy bar set`
  // keeps them (shell.json), so it stays across restarts.
  function saveSize() {
    if (!root.bar) return
    var w = Math.round(root.dragWidth), h = Math.round(root.dragHeight)
    root.bar.run("omarchy bar set io.github.simonschubert.omalauncher width " + w + " && omarchy bar set io.github.simonschubert.omalauncher height " + h)
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: app.item ? app.item.keyTarget : null
    // The board keeps its own edges, a tile gap wide.
    padding: 0
    // Its size is the plugin's settings (manifest.json), within the screen.
    contentWidth: panel.fittedContentWidth(Style.space(root.wantWidth))
    contentHeight: panel.fittedContentHeight(Style.space(root.wantHeight))

    Loader {
      id: app
      anchors.fill: parent
      active: root.opened
      sourceComponent: App {
        cellPitch: root.cellPitch
        background: Color.popups.background
        ipcTarget: "io.github.simonschubert.omalauncher.board"
        onDismissed: root.close()
      }
      onLoaded: item.open()
    }

    // Drag the left edge for the width, the bottom for the height, or the
    // corner between them for both: the panel hangs from the bar under its
    // icon, so those are the sides that move.
    Repeater {
      model: [{ w: true, h: false }, { w: false, h: true }, { w: true, h: true }]
      delegate: MouseArea {
        id: grip
        required property var modelData
        // Mostly outside the card, so the tiles and buttons at its edges
        // keep their clicks.
        readonly property int out: 10
        readonly property int inside: 4
        x: -grip.out
        y: grip.modelData.h ? parent.height - grip.inside : 0
        width: grip.modelData.w ? grip.out + grip.inside : parent.width + grip.out
        height: grip.modelData.h ? grip.out + grip.inside : parent.height
        z: grip.modelData.w && grip.modelData.h ? 11 : 10
        hoverEnabled: true
        cursorShape: grip.modelData.w && grip.modelData.h ? Qt.SizeBDiagCursor : grip.modelData.w ? Qt.SizeHorCursor : Qt.SizeVerCursor
        property point from
        property real fromW
        property real fromH
        onPressed: (m) => {
          // The panel is a full-screen surface, so its coordinates stay put
          // while the card moves and grows.
          from = mapToItem(null, m.x, m.y)
          fromW = root.wantWidth
          fromH = root.wantHeight
        }
        onPositionChanged: (m) => {
          if (!pressed) return
          var p = mapToItem(null, m.x, m.y)
          // The width snaps to whole columns, so tiles keep their size and the
          // edges stay a gap wide.
          if (grip.modelData.w) {
            var want = Math.max(360, Math.min(1200, fromW - (p.x - from.x) / root.unit))
            var n = Math.max(2, Math.round((want * root.unit - root.inset) / root.cellPitch - 6 / 69))
            root.dragWidth = root.widthFor(n)
          } else root.dragWidth = fromW
          if (grip.modelData.h) root.dragHeight = Math.max(360, Math.min(1400, fromH + (p.y - from.y) / root.unit))
          else root.dragHeight = fromH
        }
        onReleased: if (root.dragWidth) root.saveSize()
      }
    }
  }
}
