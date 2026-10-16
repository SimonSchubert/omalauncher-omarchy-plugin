import QtQuick
import QtQuick.Shapes
import qs.Commons
import qs.Ui

// The plugin's bar widget: Omalauncher's mark in the bar's color. Click opens
// the Widgets panel under it; right-click is Create, the default agent asking
// what widget to make.
BarWidget {
  id: root

  readonly property string bin: decodeURIComponent(Qt.resolvedUrl("../bin/omarchy-widgets").toString().replace(/^file:\/\//, ""))
  function quoted(s) { return "'" + s.replace(/'/g, "'\\''") + "'" }

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    target.bar = root.bar
    target.settings = root.settings
    target.anchorItem = button
    target.hostWidget = root
  }

  // What the bar's summon/hide/toggle routing and its popout coordinator ask
  // of the widget in a slot (the same contract as weather's).
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false
  function open() { if (panelLoader.item) panelLoader.item.open() }
  function close() { if (panelLoader.item) panelLoader.item.close() }
  function closeForPopoutSwitch() { if (panelLoader.item) panelLoader.item.closeForPopoutSwitch() }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()

  Loader {
    id: panelLoader
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  // Omarchy's own icon button: the same slot, centred drawing box and icon
  // size as the status icons beside it.
  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    // The panel is the detail view.
    tooltipText: ""
    onPressed: function(b) {
      if (b === Qt.RightButton) { if (root.bar) root.bar.run(root.quoted(root.bin) + " new") }
      else if (panelLoader.item) panelLoader.item.toggle()
    }

    // The launcher icon's monochrome silhouette (ic_launcher_monochrome.xml),
    // its 108-unit canvas cropped to the 48 units the mark covers, painted as
    // tall as the status glyphs at the bar's icon size.
    iconComponent: Component {
      Item {
        Shape {
          id: logo
          readonly property real mark: Style.bar.iconFont * 0.82
          readonly property color ink: button.active && button.useActiveColor ? button.activeColor : button.foreground
          // Centred, rounded up a pixel rather than down: as high as the glyphs.
          x: Math.round((parent.width - logo.mark) / 2)
          y: Math.floor((parent.height - logo.mark) / 2)
          width: logo.mark
          height: logo.mark
          preferredRendererType: Shape.CurveRenderer
          transform: Scale { xScale: logo.mark / 48; yScale: logo.mark / 48 }

          ShapePath {
            strokeColor: logo.ink
            strokeWidth: 6
            fillColor: "transparent"
            capStyle: ShapePath.RoundCap
            PathSvg { path: "M45,27V14a11,11 0 0 0-11-11H14a11,11 0 0 0-11,11V34a11,11 0 0 0 11,11H27" }
          }
          ShapePath {
            strokeColor: "transparent"
            fillColor: logo.ink
            PathSvg { path: "M37.5,35h5a2.5,2.5 0 0 1 2.5,2.5v5a2.5,2.5 0 0 1-2.5,2.5h-5a2.5,2.5 0 0 1-2.5-2.5v-5a2.5,2.5 0 0 1 2.5-2.5z" }
          }
        }
      }
    }
  }
}
