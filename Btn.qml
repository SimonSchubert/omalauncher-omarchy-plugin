import QtQuick

// The app's one button: plain, selected (a tab that is on), or primary (the
// thing to do here).
Rectangle {
  id: root

  property var ui
  property string text: ""
  property bool selected: false
  property bool primary: false

  signal clicked()

  implicitWidth: label.implicitWidth + 2 * root.ui.space
  implicitHeight: root.ui.control
  radius: root.ui.radius
  opacity: root.enabled ? 1 : 0.4
  color: root.primary ? (mouse.containsMouse ? Qt.lighter(root.ui.accent, 1.1) : root.ui.accent)
    : root.selected ? root.ui.alpha(root.ui.accent, 0.16)
    : mouse.containsMouse ? root.ui.alpha(root.ui.fg, 0.08) : "transparent"
  border.width: 1
  border.color: root.primary || root.selected ? root.ui.accent : root.ui.border

  Text {
    id: label
    anchors.centerIn: parent
    text: root.text
    color: root.primary ? root.ui.onAccent : root.selected ? root.ui.accent : root.ui.fg
    font.family: root.ui.font
    font.pixelSize: root.ui.fs.small
  }

  MouseArea {
    id: mouse
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onClicked: root.clicked()
  }
}
