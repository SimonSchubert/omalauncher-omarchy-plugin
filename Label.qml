import QtQuick

// The app's text: the theme's font and foreground, small unless it says
// otherwise (font.pixelSize: ui.fs.title, color: ui.muted).
Text {
  id: root

  property var ui

  color: root.ui.fg
  font.family: root.ui.font
  font.pixelSize: root.ui.fs.small
}
