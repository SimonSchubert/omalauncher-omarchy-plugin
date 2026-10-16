pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import "Store.js" as Store

// The widget store: the reviewed widgets of omarchy-widgets, as the phone's
// store shows them. A widget's page lists every command it runs and every
// package it needs before Install, which is the approval; an update that
// changes them asks again. The download is checked against the reviewed
// file's SHA-256 by bin/omarchy-widgets.
Item {
  id: root

  required property var app
  readonly property var ui: root.app.ui

  signal installed()

  property var widgets: []
  property bool loading: false
  property string error: ""
  property string query: ""
  // The widget whose page is open, or null.
  property var current: null
  property bool busy: false
  // Of the current widget's packages, those not installed.
  property var missing: []

  readonly property var shown: Store.filter(root.widgets, root.query, "all")

  function load(force) {
    if (root.loading || (root.widgets.length && !force)) return
    root.loading = true
    root.error = ""
    var xhr = new XMLHttpRequest()
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== XMLHttpRequest.DONE) return
      root.loading = false
      if (xhr.status !== 200) { root.error = "Can't reach the store (" + (xhr.status || "offline") + ")"; return }
      try { root.widgets = Store.parse(xhr.responseText) } catch (e) { root.error = "The store sent something odd: " + e }
      root.showPending()
    }
    xhr.open("GET", root.app.store + "/index.json")
    xhr.send()
  }

  // A widget's page by id, once the catalog is here.
  property string pendingId: ""
  function show(id) {
    root.pendingId = id
    root.load(false)
    root.showPending()
  }
  function showPending() {
    for (var i = 0; i < root.widgets.length && root.pendingId; i++)
      if (root.widgets[i].id === root.pendingId) { root.pendingId = ""; root.openPage(root.widgets[i]) }
  }

  function statusOf(w) { return Store.status(w, root.app.records[w.id] || null) }

  function actionLabel(s) {
    return { install: "Install", installed: "Installed", update: "Update", review: "Update" }[s]
  }

  function openPage(w) {
    root.current = w
    root.missing = []
    page.contentY = 0
    root.checkPackages()
  }

  function checkPackages() {
    var w = root.current
    var pkgs = w && w.requires && w.requires.pacman ? w.requires.pacman : []
    if (!pkgs.length) return
    root.app.run(["bash", "-c", "command -v pacman >/dev/null || { printf '%s\\n' \"$@\"; exit; }; pacman -T \"$@\"; true", "missing"].concat(pkgs),
      function(code, out) {
        if (root.current === w) root.missing = out.split("\n").filter(function(l) { return l !== "" })
      })
  }

  function install() {
    var w = root.current
    if (!w || root.busy) return
    root.busy = true
    root.app.run([root.app.bin, "install", "--yes", "--sha256=" + w.sha256, w.id], function(code, out, err) {
      root.busy = false
      if (code !== 0) { root.app.say(err.trim() || "Could not install " + w.id, true); return }
      root.app.say("Installed " + w.name + ". It's on your board" + (root.missing.length ? "; it still needs " + root.missing.join(" ") : "."))
      root.installed()
    })
  }

  function uninstall() {
    var w = root.current
    if (!w || root.busy) return
    root.busy = true
    root.app.run([root.app.bin, "remove", "--yes", w.id], function(code, out, err) {
      root.busy = false
      if (code !== 0) { root.app.say(err.trim() || "Could not remove " + w.id, true); return }
      root.app.say("Removed " + w.name)
      root.installed()
    })
  }

  function installPackages() {
    var w = root.current, r = w ? root.app.records[w.id] : null
    if (!r) return
    root.app.run([root.app.bin, "packages", "--terminal", root.app.dir + "/" + r.file], function() { root.checkPackages() })
  }

  // True when it stepped back; false on the bare catalog, which the app leaves.
  function back() {
    if (root.current) root.current = null
    else if (root.query) root.query = ""
    else return false
    return true
  }

  function key(event) {
    if (event.text === "/" && !search.activeFocus) { search.forceActiveFocus(); return true }
    return false
  }

  // ------------------------------------------------------------ catalog

  // Back and the search: the catalog is one list, found by what you type.
  Item {
    id: bar
    width: parent.width
    height: 48

    Btn {
      id: back
      anchors.left: parent.left
      anchors.leftMargin: root.ui.space
      anchors.verticalCenter: parent.verticalCenter
      ui: root.ui
      text: "‹ Back"
      onClicked: root.app.setTab("board")
    }

    Rectangle {
      id: searchBox
      anchors.left: back.right
      anchors.leftMargin: 6
      anchors.right: parent.right
      anchors.rightMargin: root.ui.space
      anchors.verticalCenter: parent.verticalCenter
      height: root.ui.control
      color: "transparent"
      border.width: 1
      border.color: search.activeFocus ? root.ui.accent : root.ui.border

      TextInput {
        id: search
        anchors.fill: parent
        anchors.leftMargin: 8
        anchors.rightMargin: 8
        verticalAlignment: TextInput.AlignVCenter
        text: root.query
        onTextEdited: root.query = text
        color: root.ui.fg
        selectionColor: root.ui.accent
        font.family: root.ui.font
        font.pixelSize: root.ui.fs.small
        clip: true
        Keys.onEscapePressed: (event) => { root.query = ""; search.focus = false; event.accepted = true }
      }
      Text {
        anchors.fill: search
        verticalAlignment: Text.AlignVCenter
        visible: !search.text
        text: "Search  /"
        color: root.ui.muted
        font.family: root.ui.font
        font.pixelSize: root.ui.fs.small
      }
    }
  }

  GridView {
    id: cards
    // Cards keep 6 px each side, so the edges match the gaps between them.
    anchors { top: bar.bottom; bottom: parent.bottom; left: parent.left; right: parent.right; leftMargin: 6; rightMargin: 6 }
    readonly property int perRow: Math.max(2, Math.floor(width / 300))
    cellWidth: Math.floor(width / cards.perRow)
    // The preview at the store's 16:10, then the name, author and two lines.
    cellHeight: Math.round((cellWidth - 14) * 0.62) + 116
    clip: true
    boundsBehavior: Flickable.StopAtBounds
    model: root.shown

    delegate: Item {
      id: card
      required property var modelData
      readonly property string state_: root.statusOf(card.modelData)
      width: cards.cellWidth
      height: cards.cellHeight

      Rectangle {
        anchors.fill: parent
        anchors.margins: 6
        color: hover.containsMouse ? root.ui.alpha(root.ui.fg, 0.04) : "transparent"
        border.width: 1
        border.color: root.current && root.current.id === card.modelData.id ? root.ui.accent : root.ui.border

        Rectangle {
          id: shot
          x: 1; y: 1
          width: parent.width - 2
          height: Math.round(width * 0.62)
          color: root.ui.surface

          Image {
            anchors.fill: parent
            anchors.margins: 10
            source: Store.preview(card.modelData, root.app.themeName) ? root.app.store + "/" + Store.preview(card.modelData, root.app.themeName) : ""
            fillMode: Image.PreserveAspectFit
            asynchronous: true
            cache: true
            smooth: true
          }
        }

        Column {
          anchors { top: shot.bottom; left: parent.left; right: parent.right; margins: 12 }
          spacing: 4

          Text {
            width: parent.width
            text: card.modelData.name
            color: root.ui.fg
            font.family: root.ui.font
            font.pixelSize: root.ui.fs.title
            elide: Text.ElideRight
          }
          Item {
            width: parent.width
            height: by.implicitHeight
            Text {
              id: by
              anchors.left: parent.left
              anchors.right: badge.left
              anchors.rightMargin: 6
              text: "by " + card.modelData.author
              color: root.ui.muted
              font.family: root.ui.font
              font.pixelSize: root.ui.fs.caption
              elide: Text.ElideRight
            }
            Text {
              id: badge
              anchors.right: parent.right
              text: card.state_ === "install" ? "" : card.state_ === "installed" ? "installed" : "update"
              color: card.state_ === "installed" ? root.ui.green : root.ui.yellow
              font.family: root.ui.font
              font.pixelSize: root.ui.fs.caption
            }
          }
          Text {
            width: parent.width
            text: card.modelData.description || ""
            color: root.ui.muted
            font.family: root.ui.font
            font.pixelSize: root.ui.fs.small
            wrapMode: Text.Wrap
            maximumLineCount: 2
            elide: Text.ElideRight
          }
        }

        MouseArea {
          id: hover
          anchors.fill: parent
          hoverEnabled: true
          cursorShape: Qt.PointingHandCursor
          onClicked: root.openPage(card.modelData)
        }
      }
    }
  }

  Column {
    anchors.centerIn: cards
    spacing: root.ui.space
    visible: root.loading || !!root.error || (!root.shown.length && root.widgets.length)

    Text {
      anchors.horizontalCenter: parent.horizontalCenter
      text: root.loading ? "Loading the store…" : root.error || "Nothing matches “" + root.query + "”"
      color: root.error ? root.ui.red : root.ui.muted
      font.family: root.ui.font
      font.pixelSize: root.ui.fs.body
    }
    Btn {
      anchors.horizontalCenter: parent.horizontalCenter
      ui: root.ui
      visible: !!root.error
      text: "Try again"
      onClicked: root.load(true)
    }
  }

  // ------------------------------------------------------------ a widget's page

  Rectangle {
    anchors.fill: parent
    visible: !!root.current
    color: root.ui.alpha(root.ui.bg, 0.6)
    MouseArea { anchors.fill: parent; onClicked: root.current = null }
  }

  Rectangle {
    id: panel
    // Over the whole store, its Back exactly where the catalog's is.
    anchors.fill: parent
    visible: !!root.current
    color: root.ui.bg

    MouseArea { anchors.fill: parent }

    readonly property var w: root.current || ({})
    readonly property string state_: root.current ? root.statusOf(root.current) : "install"
    readonly property var record: root.current ? root.app.records[root.current.id] || null : null

    Item {
      id: pageBar
      width: parent.width
      height: bar.height

      Btn {
        id: closeBtn
        anchors.left: parent.left
        anchors.leftMargin: root.ui.space
        anchors.verticalCenter: parent.verticalCenter
        ui: root.ui
        text: "‹ Back"
        onClicked: root.current = null
      }
      Text {
        anchors.left: closeBtn.right
        anchors.leftMargin: root.ui.space
        anchors.right: parent.right
        anchors.rightMargin: root.ui.space
        anchors.verticalCenter: parent.verticalCenter
        text: panel.w.name || ""
        color: root.ui.fg
        font.family: root.ui.font
        font.pixelSize: root.ui.fs.heading
        elide: Text.ElideRight
      }
    }

    Flickable {
      id: page
      anchors { top: pageBar.bottom; left: parent.left; bottom: parent.bottom }
      anchors.leftMargin: root.ui.space
      anchors.topMargin: root.ui.space / 2
      anchors.bottomMargin: actions.height + root.ui.space * 2
      width: Math.min(parent.width - 2 * root.ui.space, 640)
      contentHeight: body.height
      clip: true
      boundsBehavior: Flickable.StopAtBounds

      Column {
        id: body
        width: page.width
        spacing: root.ui.space


        Text {
          width: parent.width
          text: "by " + (panel.w.author || "") + "  ·  " + (panel.w.version || "") + "  ·  " + (panel.w.license || "")
            + "  ·  " + (panel.w.size ? panel.w.size[0] + "x" + panel.w.size[1] : "") + "  ·  " + (panel.w.category || "other")
          color: root.ui.muted
          font.family: root.ui.font
          font.pixelSize: root.ui.fs.caption
          wrapMode: Text.Wrap
        }

        Rectangle {
          width: parent.width
          height: 220
          color: root.ui.surface
          Image {
            anchors.fill: parent
            anchors.margins: 12
            source: root.current && Store.preview(root.current, root.app.themeName) ? root.app.store + "/" + Store.preview(root.current, root.app.themeName) : ""
            fillMode: Image.PreserveAspectFit
            asynchronous: true
          }
        }

        Text {
          width: parent.width
          text: panel.w.description || ""
          color: root.ui.fg
          font.family: root.ui.font
          font.pixelSize: root.ui.fs.body
          wrapMode: Text.Wrap
        }

        Text {
          visible: panel.state_ === "review"
          width: parent.width
          text: "This update changes what the widget runs or needs. Read it again before you update."
          color: root.ui.yellow
          font.family: root.ui.font
          font.pixelSize: root.ui.fs.small
          wrapMode: Text.Wrap
        }

        Text {
          text: (panel.w.commands || []).length ? "It runs" : "It runs no commands"
          color: root.ui.fg
          font.family: root.ui.font
          font.pixelSize: root.ui.fs.title
        }

        Repeater {
          model: panel.w.commands || []
          delegate: Rectangle {
            required property string modelData
            width: body.width
            height: cmd.implicitHeight + 16
            color: root.ui.surface
            Text {
              id: cmd
              x: 8; y: 8
              width: parent.width - 16
              text: modelData
              color: root.ui.fg
              font.family: root.ui.font
              font.pixelSize: root.ui.fs.caption
              wrapMode: Text.WrapAnywhere
              textFormat: Text.PlainText
            }
          }
        }

        Text {
          visible: !!(panel.w.requires && panel.w.requires.pacman && panel.w.requires.pacman.length)
          width: parent.width
          text: "It needs  " + (panel.w.requires && panel.w.requires.pacman ? panel.w.requires.pacman.map(function(p) {
            return root.missing.indexOf(p) >= 0 ? p + " (not installed)" : p
          }).join("  ") : "")
          color: root.missing.length ? root.ui.yellow : root.ui.muted
          font.family: root.ui.font
          font.pixelSize: root.ui.fs.small
          wrapMode: Text.Wrap
        }

        Text {
          width: parent.width
          text: "Widgets run their commands as you, with your files and the network. Every widget in the store was reviewed, and the download is checked against the reviewed file."
          color: root.ui.muted
          font.family: root.ui.font
          font.pixelSize: root.ui.fs.caption
          wrapMode: Text.Wrap
        }
      }
    }

    Row {
      id: actions
      anchors { left: parent.left; bottom: parent.bottom; margins: root.ui.space }
      spacing: 6

      Btn {
        ui: root.ui
        visible: panel.state_ !== "installed"
        enabled: !root.busy
        primary: true
        text: root.busy ? "Installing…" : root.actionLabel(panel.state_)
        onClicked: root.install()
      }
      Btn {
        ui: root.ui
        visible: !!panel.record && root.missing.length > 0
        text: "Install packages…"
        onClicked: root.installPackages()
      }
      Btn {
        ui: root.ui
        visible: !!panel.record
        enabled: !root.busy
        text: "Remove"
        onClicked: root.uninstall()
      }
      Btn {
        ui: root.ui
        text: "Source"
        onClicked: root.app.openUrl("https://github.com/" + root.app.repo + "/tree/main/widgets/" + (panel.w.id || ""))
      }
    }
  }
}
