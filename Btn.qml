import QtQuick

// The app's one button: plain, selected (a tab that is on), or primary (the
// thing to do here). In the Omarchy panel it is the shell's own bordered
// button (ui.button, as the Display panel's scale pills), so it follows the
// theme's controls; in a window of its own it draws the same look itself.
Item {
  id: root

  property var ui
  property string text: ""
  property bool selected: false
  property bool primary: false

  signal clicked()

  implicitWidth: shown.item ? shown.item.implicitWidth : 0
  implicitHeight: shown.item ? shown.item.implicitHeight : 0
  opacity: root.enabled ? 1 : 0.4

  Loader {
    id: shown
    anchors.fill: parent
    sourceComponent: root.ui && root.ui.button ? root.ui.button : own
    onLoaded: {
      var b = shown.item
      b.text = Qt.binding(function() { return root.text })
      // On, as a tab or the thing to do: filled, as the scale that is set.
      b.active = Qt.binding(function() { return root.selected || root.primary })
      if (b.foreground !== undefined)
        b.foreground = Qt.binding(function() { return root.primary ? root.ui.accent : b.restingForeground })
      b.clicked.connect(root.clicked)
    }
  }

  Component {
    id: own
    Rectangle {
      id: btn
      property string text: ""
      property bool active: false
      property color foreground: root.ui.fg
      readonly property color restingForeground: root.ui.fg
      signal clicked()

      implicitWidth: label.implicitWidth + 2 * root.ui.space
      implicitHeight: root.ui.control
      radius: root.ui.radius
      color: mouse.pressed ? root.ui.alpha(root.ui.fg, 0.24)
        : mouse.containsMouse ? root.ui.alpha(root.ui.fg, 0.12)
        : btn.active ? root.ui.alpha(root.ui.fg, 0.16) : "transparent"
      border.width: 1
      border.color: mouse.containsMouse ? root.ui.fg : root.ui.border
      scale: mouse.pressed ? 0.97 : 1

      Text {
        id: label
        anchors.centerIn: parent
        text: btn.text
        color: btn.foreground
        font.family: root.ui.font
        font.pixelSize: root.ui.fs.caption
      }

      MouseArea {
        id: mouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: btn.clicked()
      }
    }
  }
}
