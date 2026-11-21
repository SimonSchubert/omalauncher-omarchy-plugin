import QtQuick

// Sharing a widget: its QR code to scan with the phone's camera, the link,
// and, for your own widgets, the way into the store. What the buttons do is
// the board's.
Item {
  id: root

  property var ui
  // { name, link, png, error }: png and link come once the code is made; null
  // when nothing is being shared.
  property var sharing: null
  // Your own widget, not one from the store: it can be published.
  property bool own: true

  signal dismissed()
  signal copyLink()
  signal checkSecrets()
  signal publish()

  visible: !!root.sharing

  Rectangle {
    anchors.fill: parent
    color: root.ui.alpha(root.ui.bg, 0.7)
    MouseArea { anchors.fill: parent; onClicked: root.dismissed() }
  }

  Rectangle {
    anchors.centerIn: parent
    width: code.width + 4 * root.ui.space
    height: body.implicitHeight + 2 * root.ui.space * 2
    color: root.ui.bg
    border.width: 2
    border.color: root.ui.border

    MouseArea { anchors.fill: parent }

    Column {
      id: body
      anchors.fill: parent
      anchors.margins: root.ui.space * 2
      spacing: root.ui.space

      Label {
        ui: root.ui
        width: parent.width
        text: root.sharing ? "Share " + root.sharing.name : ""
        font.pixelSize: root.ui.fs.title
      }

      // Black on white whatever the theme: what phone cameras read best.
      Rectangle {
        id: code
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

      Label {
        ui: root.ui
        width: parent.width
        visible: !!root.sharing && !root.sharing.png && !root.sharing.error
        text: "Making the code…"
        color: root.ui.muted
      }

      Label {
        ui: root.ui
        width: parent.width
        visible: !!(root.sharing && root.sharing.error)
        text: root.sharing ? root.sharing.error : ""
        color: root.ui.red
        wrapMode: Text.Wrap
      }

      Label {
        ui: root.ui
        width: parent.width
        visible: !!(root.sharing && root.sharing.png)
        text: "Scan it with the phone's camera: it opens in Omalauncher, which shows everything the widget runs before adding it. The whole widget is in the code; nothing is uploaded."
        color: root.ui.muted
        wrapMode: Text.Wrap
      }

      Row {
        spacing: 6
        Btn {
          ui: root.ui
          visible: !!(root.sharing && root.sharing.link)
          text: "Copy link"
          onClicked: root.copyLink()
        }
        Btn { ui: root.ui; text: "Check for secrets"; onClicked: root.checkSecrets() }
      }

      // For everyone, as the phone's Share has it: your own widgets only.
      Column {
        width: parent.width
        spacing: root.ui.space / 2
        visible: root.own

        Rectangle { width: parent.width; height: 1; color: root.ui.border }
        Label {
          ui: root.ui
          text: "in the store"
          color: root.ui.accent
          font.pixelSize: root.ui.fs.title
        }
        Label {
          ui: root.ui
          width: parent.width
          text: "Your agent forks the store and opens a pull request; a maintainer reviews it."
          color: root.ui.muted
          wrapMode: Text.Wrap
        }
        Btn { ui: root.ui; primary: true; text: "Publish with your agent"; onClicked: root.publish() }
      }

      Btn { ui: root.ui; text: "Close"; onClicked: root.dismissed() }
    }
  }
}
