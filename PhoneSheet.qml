import QtQuick
import Quickshell.Io

// Your phones: linking Omalauncher on one (a QR code to scan with its camera,
// the code it shows to compare, then waiting until it answers), and, for each
// linked one, what syncs with it and a way to unlink it. Several phones can be
// linked, and a phone to several computers. The commands are
// `omarchy-widgets phone invite|wait|info|sync|unlink`, --phone=<id> for one.
Item {
  id: root

  required property var app
  readonly property var ui: root.app.ui
  property bool open: false
  // The linked phones ([{ id, name, host, port }]); the board reads them for
  // "Send to devices" and "Sync with devices".
  property var phones: []
  // Per phone id: what syncs with it, as its settings say ({ theme, background,
  // widgets }); whether it answers now; whether its widget list is open.
  property var syncs: ({})
  property var statuses: ({})
  property var expanded: ({})
  // "" | "inviting" | "waiting" | "linked" | "failed"
  property string step: ""
  property string png: ""
  property string code: ""
  property string error: ""
  property string linkedName: ""
  property int codes: 0
  // This computer's widget files (the board's), and how one is called on it.
  property var files: []
  property var titleOf: function(f) { return f.replace(/\.owl$/, "") }
  // "app", "face", "widget"...: what a file is, "" when it hasn't compiled (or isn't here).
  property var kindOf: function(f) { return "" }

  signal dismissed()

  visible: root.open

  function put(map, key, value) { var m = Object.assign({}, map); m[key] = value; return m }

  function refresh() {
    root.app.runBin(["phone", "info"], function(ok, out) {
      var list = []
      try { list = ok ? JSON.parse(out) : [] } catch (e) {}
      root.phones = Array.isArray(list) ? list : []
      // The board's "Sync with devices" reads which widgets are.
      root.phones.forEach(function(p) { root.loadSync(p.id) })
    })
  }
  Component.onCompleted: root.refresh()

  function show() {
    root.open = true
    root.error = ""
    root.step = ""
    root.refresh()
    root.phones.forEach(function(p) { root.check(p) })
  }
  function close() {
    waiter.running = false
    root.step = ""
    root.open = false
    root.dismissed()
  }

  // A phone keeps these, so its settings and this sheet always agree.
  function loadSync(id, args) {
    root.app.runBin(["phone", "--phone=" + id, "sync"].concat(args || []), function(ok, out, error) {
      var v = null
      try { v = ok ? JSON.parse(out) : null } catch (e) {}
      if (v) root.syncs = root.put(root.syncs, id, v)
      else if (args) root.app.say(error || "Could not change it on the device", true)
    })
  }
  function setSync(id, what, on) {
    var s = root.syncs[id]
    if (s) { var v = Object.assign({}, s); v[what] = on; root.syncs = root.put(root.syncs, id, v) }
    root.loadSync(id, [what, on ? "on" : "off"])
  }

  // A widget (its file name) synced with this phone, or with any.
  function syncedWith(id, file) { var s = root.syncs[id]; return !!(s && s.widgets && s.widgets.indexOf(file) >= 0) }
  function isSynced(file) { return root.phones.some(function(p) { return root.syncedWith(p.id, file) }) }

  // With one phone (id), or with every phone (id null): the board's "Sync with devices".
  function setWidgetSync(id, file, on) {
    var args = ["phone"].concat(id ? ["--phone=" + id] : [], ["sync", "widget", file, on ? "on" : "off"])
    root.app.runBin(args, function(ok, out, error) {
      out.split("\n").forEach(function(line) {
        var v = null
        try { v = JSON.parse(line) } catch (e) {}
        if (v && v.phone) root.syncs = root.put(root.syncs, v.phone, v)
      })
      var where = id ? root.nameOf(id) : root.phones.length === 1 ? root.phones[0].name : "your devices"
      root.app.say(ok ? (on ? "Syncing " : "Stopped syncing ") + root.titleOf(file) + " with " + where
                      : error || "Could not change it on the device", !ok)
    })
  }

  function nameOf(id) {
    for (var i = 0; i < root.phones.length; i++) if (root.phones[i].id === id) return root.phones[i].name
    return "the device"
  }

  // Whether a phone answers now.
  function check(p) {
    root.statuses = root.put(root.statuses, p.id, "Looking for it…")
    root.app.runBin(["phone", "--phone=" + p.id], function(ok, out, error) {
      root.statuses = root.put(root.statuses, p.id, ok ? out.replace(/^[^:]*: /, "") : error)
    })
  }

  function link() {
    waiter.running = false
    var png = root.app.stateDir + "/phone-code-" + (++root.codes) + ".png"
    root.step = "inviting"
    root.error = ""
    root.app.run(["bash", "-c", "rm -f \"$1\"/phone-code-*.png; exec \"$2\" phone invite --png=\"$3\"", "invite",
                  root.app.stateDir, root.app.bin, png], function(code, out, err) {
      if (root.step !== "inviting") return
      var invite = null
      try { invite = code === 0 ? JSON.parse(out) : null } catch (e) {}
      if (!invite) {
        root.step = "failed"
        root.error = root.app.errorText(err) || "Could not make a code"
        return
      }
      root.png = "file://" + png
      root.code = invite.code
      root.step = "waiting"
      waiter.running = true
    })
  }

  Process {
    id: waiter
    command: [root.app.bin, "phone", "wait"]
    stdout: StdioCollector { id: waitOut }
    stderr: StdioCollector { id: waitErr }
    onExited: (code) => {
      if (root.step !== "waiting") return
      if (code === 0) {
        root.step = "linked"
        root.linkedName = waitOut.text.replace(/^(Connected|Linked) /, "").trim()
        root.refresh()
        root.app.say("Connected " + root.linkedName)
      } else {
        root.step = "failed"
        root.error = root.app.errorText(waitErr.text) || "The device didn't answer"
      }
    }
  }

  function unlink(p) {
    root.app.runBin(["phone", "unlink", p.id], function(ok, out, error) {
      root.app.say(ok ? out : error, !ok)
      root.refresh()
    })
  }

  Rectangle {
    anchors.fill: parent
    color: root.ui.alpha(root.ui.bg, 0.7)
    MouseArea { anchors.fill: parent; onClicked: root.close() }
  }

  Rectangle {
    anchors.centerIn: parent
    width: Math.min(parent.width - 2 * root.ui.space, 460)
    height: Math.min(parent.height - 2 * root.ui.space, body.implicitHeight + 4 * root.ui.space)
    color: root.ui.bg
    border.width: 2
    border.color: root.ui.border

    MouseArea { anchors.fill: parent }

    // Several phones, each with a widget list, can be taller than the panel: it scrolls.
    Flickable {
      anchors.fill: parent
      anchors.margins: root.ui.space * 2
      contentHeight: body.implicitHeight
      clip: true
      boundsBehavior: Flickable.StopAtBounds

      Column {
        id: body
        width: parent.width
        spacing: root.ui.space

        Label {
          ui: root.ui
          width: parent.width
          text: root.step !== "" || !root.phones.length ? "Connect a device" : "Connected devices"
          font.pixelSize: root.ui.fs.title
        }

        // ---- each linked phone
        Repeater {
          model: root.step === "" ? root.phones : []
          delegate: Column {
            id: phone
            required property var modelData
            readonly property var sync: root.syncs[phone.modelData.id] || null
            readonly property bool showWidgets: !!root.expanded[phone.modelData.id]
            width: body.width
            spacing: root.ui.space / 2

            Rectangle { width: parent.width; height: 1; color: root.ui.border }
            Row {
              width: parent.width
              spacing: 6
              Label {
                ui: root.ui
                width: parent.width - unlinkBtn.width - 6
                anchors.verticalCenter: parent.verticalCenter
                text: phone.modelData.name
                color: root.ui.accent
                elide: Text.ElideRight
              }
              Btn { id: unlinkBtn; ui: root.ui; text: "Disconnect"; onClicked: root.unlink(phone.modelData) }
            }
            Label {
              ui: root.ui
              width: parent.width
              text: root.statuses[phone.modelData.id] || ""
              color: root.ui.muted
              wrapMode: Text.Wrap
            }
            // Both ways, within the same theme for the background; the phone shows the same switches.
            Repeater {
              model: [{ key: "theme", label: "Theme" }, { key: "background", label: "Background" }]
              delegate: Row {
                id: syncRow
                required property var modelData
                readonly property bool on: !!(phone.sync && phone.sync[syncRow.modelData.key])
                spacing: 6
                visible: !!phone.sync
                Label { ui: root.ui; width: 120; anchors.verticalCenter: parent.verticalCenter; text: syncRow.modelData.label }
                Btn { ui: root.ui; primary: syncRow.on; text: "Sync"; onClicked: if (!syncRow.on) root.setSync(phone.modelData.id, syncRow.modelData.key, true) }
                Btn { ui: root.ui; primary: !syncRow.on; text: "Off"; onClicked: if (syncRow.on) root.setSync(phone.modelData.id, syncRow.modelData.key, false) }
              }
            }
            // Which widgets sync with this phone, files and values, ticked here or on it.
            Row {
              spacing: 6
              visible: !!phone.sync
              Label { ui: root.ui; width: 120; anchors.verticalCenter: parent.verticalCenter; text: "Widgets" }
              Btn {
                ui: root.ui
                text: (phone.sync && phone.sync.widgets ? phone.sync.widgets.length : 0) + " synced " + (phone.showWidgets ? "▴" : "▾")
                onClicked: root.expanded = root.put(root.expanded, phone.modelData.id, !phone.showWidgets)
              }
            }
            Repeater {
              // Here and on the phone: one synced from it that hasn't arrived yet is listed too.
              model: {
                if (!phone.showWidgets || !phone.sync) return []
                var all = (root.files || []).slice()
                ;(phone.sync.widgets || []).forEach(function(f) { if (all.indexOf(f) < 0) all.push(f) })
                // By the name shown, whatever its case.
                return all.sort(function(a, b) { return root.titleOf(a).toLowerCase().localeCompare(root.titleOf(b).toLowerCase()) })
              }
              delegate: Rectangle {
                id: choice
                required property string modelData
                readonly property bool on: root.syncedWith(phone.modelData.id, choice.modelData)
                width: phone.width
                height: 26
                color: hover.hovered ? root.ui.surface : "transparent"
                HoverHandler { id: hover }
                Label {
                  ui: root.ui
                  anchors.verticalCenter: parent.verticalCenter
                  text: (choice.on ? "[x] " : "[ ] ") + root.titleOf(choice.modelData)
                    + (root.kindOf(choice.modelData) === "app" ? "  [app]" : root.kindOf(choice.modelData) === "face" ? "  [face]" : "")
                  color: choice.on ? root.ui.accent : root.ui.fg
                }
                MouseArea { anchors.fill: parent; onClicked: root.setWidgetSync(phone.modelData.id, choice.modelData, !choice.on) }
              }
            }
          }
        }

        Label {
          ui: root.ui
          width: parent.width
          visible: root.step === "" && root.phones.length > 0
          text: "Synced both ways: change it here or on a device and the others follow; the background within the same theme; a widget's file and what it keeps. Each device's settings, connected devices, show the same choices."
          color: root.ui.muted
          wrapMode: Text.Wrap
        }

        // ---- linking one (another)
        Label {
          ui: root.ui
          width: parent.width
          visible: root.phones.length === 0 && root.step === ""
          text: "A device with Omalauncher, Linux installed and on this network: its widgets, theme and background stay the same as here. A connected device can change another's widgets, theme and background, nothing else."
          color: root.ui.muted
          wrapMode: Text.Wrap
        }
        Btn {
          ui: root.ui
          visible: root.step === ""
          primary: root.phones.length === 0
          text: "Connect a device"
          onClicked: root.link()
        }

        Label {
          ui: root.ui
          width: parent.width
          visible: root.step === "inviting"
          text: "Making the code…"
          color: root.ui.muted
        }
        // Black on white whatever the theme: what phone cameras read best.
        Rectangle {
          visible: root.step === "waiting"
          anchors.horizontalCenter: parent.horizontalCenter
          width: Math.max(160, Math.min(320, root.height - 320))
          height: width
          color: "white"
          Image {
            anchors.fill: parent
            anchors.margins: 8
            source: root.step === "waiting" ? root.png : ""
            fillMode: Image.PreserveAspectFit
            smooth: false
            cache: false
          }
        }
        Label {
          ui: root.ui
          width: parent.width
          visible: root.step === "waiting"
          text: "Scan it with the device's camera. Omalauncher opens and asks; connect only if it shows"
          color: root.ui.muted
          wrapMode: Text.Wrap
        }
        Label {
          ui: root.ui
          visible: root.step === "waiting"
          anchors.horizontalCenter: parent.horizontalCenter
          text: root.code
          color: root.ui.accent
          font.pixelSize: root.ui.fs.heading
        }
        Label {
          ui: root.ui
          width: parent.width
          visible: root.step === "waiting"
          text: "Waiting for the device…"
          color: root.ui.muted
        }
        Label {
          ui: root.ui
          width: parent.width
          visible: root.step === "linked"
          text: "Connected " + (root.linkedName || "the device") + "."
          color: root.ui.green
          wrapMode: Text.Wrap
        }
        Btn { ui: root.ui; visible: root.step === "linked"; text: "Done"; onClicked: root.step = "" }
        Label {
          ui: root.ui
          width: parent.width
          visible: root.step === "failed"
          text: root.error
          color: root.ui.red
          wrapMode: Text.Wrap
        }
        Btn { ui: root.ui; visible: root.step === "failed"; text: "Try again"; onClicked: root.link() }

        Btn { ui: root.ui; text: "Close"; onClicked: root.close() }
      }
    }
  }
}
