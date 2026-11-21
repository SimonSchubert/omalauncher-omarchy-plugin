import QtQuick
import "owl" as Owl
import "owl/Owl.js" as OwlJs

// A widget's screen { }: the phone's full-screen view, as a card of a
// phone's width over the board.
Item {
  id: root

  property var ui
  property real dp: 1
  // The OwlWidget whose screen is up, or null.
  property var widget: null
  // Its screen tree's root node, as the board lays a tree out.
  property var node: null

  readonly property var tree: root.widget ? root.widget.screenTree : null
  // The card's size, which the widgets lay their screens out for.
  readonly property real cardWidth: card.width
  readonly property real cardHeight: card.height

  visible: !!root.widget

  Rectangle {
    anchors.fill: parent
    color: root.ui.alpha(root.ui.bg, 0.7)

    MouseArea {
      anchors.fill: parent
      onClicked: if (root.widget) root.widget.closeScreen()
    }
  }

  Rectangle {
    id: card
    anchors.centerIn: parent
    width: Math.min(root.width - 2 * root.ui.space, 412 * root.dp)
    height: root.height - 2 * root.ui.space
    color: root.tree && root.tree.background ? OwlJs.hex8(root.tree.background) : root.ui.bg
    border.width: 2
    border.color: root.ui.border

    MouseArea { anchors.fill: parent }

    Item {
      id: header
      x: 16 * root.dp
      y: 8 * root.dp
      width: card.width - 32 * root.dp
      height: root.ui.control + 8

      Btn {
        id: close
        ui: root.ui
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        text: "‹ Back"
        onClicked: if (root.widget) root.widget.closeScreen()
      }
      Label {
        ui: root.ui
        anchors.left: close.right
        anchors.leftMargin: root.ui.space
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        text: root.tree ? root.tree.title || "" : ""
        font.pixelSize: root.ui.fs.title
        elide: Text.ElideRight
      }
    }

    Item {
      anchors.fill: parent
      anchors.topMargin: header.y + header.height + 8 * root.dp
      anchors.margins: 16 * root.dp

      TapHandler {
        enabled: !!(root.tree && root.tree.onTap)
        onTapped: (p) => root.tree.onTap(p.position.x / root.dp, p.position.y / root.dp)
      }

      Owl.OwlNode {
        anchors.fill: parent
        widget: root.widget
        node: root.node
      }
    }
  }
}
