// What an OWL widget needs from the shell it runs in, with defaults that
// work in any Quickshell session. A shell that knows better -- its own fonts,
// its own way to start an app, its own music service -- subclasses this and
// overrides what it has to:
//
//   OwlHost {
//     sansFamily: "Inter"
//     function act(widget, name, args) {
//       if (name === "launcher") return openMyLauncher(args[0])
//       return defaultAct(widget, name, args)
//     }
//   }
//
// and hands it to every OwlWidget as `host`.

import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Services.Mpris
import "Owl.js" as Owl

QtObject {
  id: root

  // One OWL dp, in px. A board usually sets OwlWidget.dp from its cell size
  // instead, so widgets keep the launcher's proportions.
  property real dp: 1

  property string sansFamily: "sans-serif"
  property string monoFamily: "monospace"
  // A Nerd Font: weatherIcon() and widgets' `font: icon` draw from it.
  property string iconFamily: "Symbols Nerd Font"

  // The board's gaps and tile borders in dp, and its tiles' glass, for a widget that frames its own cards
  // like the board's tiles (gapsIn, gapsOut, borderWidth: owl 12; tileOpacity, tileFrost: owl 13). Omarchy's
  // Hyprland gaps and borders by default.
  property real gapsIn: 5
  property real gapsOut: 10
  property real borderWidth: 2
  property real tileOpacity: 1
  property real tileFrost: 0

  readonly property string home: Quickshell.env("HOME") || ""
  // Where `state ... persist` and `history(...) persist` are kept.
  property string stateDir: (Quickshell.env("XDG_STATE_HOME") || root.home + "/.local/state") + "/owl"

  // The command that answers android.device, android.system, android.volume,
  // android.modes and android.network as JSON. The bundled owl-source reads them
  // from Linux.
  property string sourceScript: {
    var u = String(Qt.resolvedUrl("owl-source"))
    return u.indexOf("file://") === 0 ? decodeURIComponent(u.slice(7)) : u
  }
  // The host app's version, which android.system answers as `launcher`.
  property string launcherVersion: ""
  function sourceCommand(kind) {
    var env = /^[0-9A-Za-z.+~-]+$/.test(root.launcherVersion) ? "OWL_LAUNCHER_VERSION=" + root.launcherVersion + " " : ""
    return env + "bash '" + root.sourceScript + "' " + kind.replace(/^android\./, "")
  }

  // android.media: {playing, title, artist, album, app}, from the first MPRIS
  // player. A shell with its own music service can bind this instead.
  property var media: {
    var players = Mpris.players ? Mpris.players.values : []
    var p = null
    for (var i = 0; i < players.length; i++) if (players[i].isPlaying) { p = players[i]; break }
    if (!p && players.length) p = players[0]
    if (!p) return { playing: false, title: null, artist: null, album: null, app: null }
    return {
      playing: !!p.isPlaying,
      title: p.trackTitle || null,
      artist: p.trackArtist || null,
      album: p.trackAlbum || null,
      app: p.identity || null
    }
  }

  // Time zones by name for fmtTime and parseTime (owl 9): QML's JavaScript has
  // no Intl, so Owl.js reads the zone's file from the system's tz database.
  property string zoneDir: "/usr/share/zoneinfo"
  function readZone(name) {
    var f = zoneFile.createObject(root, { path: root.zoneDir + "/" + name })
    try {
      var data = f.data()
      return data && data.byteLength ? new Uint8Array(data) : null
    } finally {
      f.destroy()
    }
  }
  property Component zoneFile: Component {
    FileView { blockLoading: true; printErrors: false }
  }
  Component.onCompleted: Owl.setZoneReader(root.readZone)

  // A widget's text field took or lost focus: a phone raises its keyboard.
  function fieldFocused(focused) {}

  // The actions a widget's handlers call, but run(), refresh(), screen() and
  // close(), which the widget does itself. Return nothing.
  function act(widget, name, args) { root.defaultAct(widget, name, args) }

  function defaultAct(widget, name, args) {
    var a = args || []
    function s(i) { return a[i] === undefined || a[i] === null ? "" : String(a[i]) }
    switch (name) {
    case "terminal": return root.launch(["xdg-terminal-exec", "bash", "-c", s(0) + "; exec bash"])
    case "app": return root.launch(["bash", "-c", s(0)])
    case "url": return Quickshell.execDetached(["xdg-open", s(0)])
    case "copy": return Quickshell.execDetached(["wl-copy", "--", s(0)])
    case "notify": return Quickshell.execDetached(["notify-send", "--", s(0), s(1)])
    case "media": return root.mediaAction(s(0))
    // Only media has a stream here (owl 13): a desktop has no ringer, and its notifications and alarms play
    // at the one volume.
    case "volume":
      if (a.length > 1 && s(1) !== "media")
        return widget.report("volume(..., \"" + s(1) + "\") sets a phone's " + s(1) + " volume, which this shell does not have")
      return root.volume(s(0))
    // Do Not Disturb is mako's do-not-disturb mode, as Omarchy toggles it (owl 13).
    case "dnd": return root.dnd(s(0))
    case "settings":
      return widget.report("settings(\"" + s(0) + "\") opens Android's settings panels, which this shell does not have")
    // The keys of the soft keyboard's bar, for the Linux window being typed in (owl 12): a desktop has a keyboard.
    case "pressKey":
    case "typeText":
    case "latch":
      return widget.report(name + "(...) types into the window under the on-screen keyboard, which this shell does not have")
    case "launcher":
      return widget.report("launcher(\"" + s(0) + "\") opens the Android launcher's own screens; this shell has none")
    // No share sheet here: the text goes to the clipboard, which is where it would end up.
    case "share":
      Quickshell.execDetached(["wl-copy", "--", s(0)])
      return Quickshell.execDetached(["notify-send", "--", "copied", s(0)])
    // No torch and no haptics on a desktop; a widget's button just does nothing.
    case "torch":
    case "haptic":
      return
    case "androidApp":
    case "notification":
      return widget.report(name + "() opens Android apps and notifications, which this shell does not have")
    // The launcher's drawer and its coding agents (owl 10); a shell that has them overrides act().
    case "open":
      return widget.report("open(\"" + s(0) + "\") opens an app or agent from the launcher's drawer, which this shell does not have")
    case "ask":
      return widget.report("ask(...) sends a prompt to the launcher's coding agent, which this shell does not have")
    // The drawer's long-press menu and the work profile (owl 11).
    case "appAction":
      return widget.report("appAction(\"" + s(0) + "\", ...) acts on an app in the launcher's drawer, which this shell does not have")
    case "workApps":
      return widget.report("workApps(...) pauses an Android work profile, which this shell does not have")
    }
  }

  // Starts something with a window of its own. A phone puts it on a fresh
  // workspace first; on a desktop it just starts.
  function launch(command) { Quickshell.execDetached(command) }

  function mediaAction(op) {
    var player = { toggle: "play-pause", play: "play", pause: "pause", next: "next", previous: "previous" }[op]
    if (player) Quickshell.execDetached(["playerctl", player])
  }

  function dnd(v) {
    var on = v === "true" || v === "on" || v === "priority" || v === "alarms" || v === "none"
    if (v === "toggle") Quickshell.execDetached(["makoctl", "mode", "-t", "do-not-disturb"])
    else if (on) Quickshell.execDetached(["makoctl", "mode", "-a", "do-not-disturb"])
    else if (v === "false" || v === "off" || v === "all") Quickshell.execDetached(["makoctl", "mode", "-r", "do-not-disturb"])
  }

  function volume(v) {
    var sink = "@DEFAULT_AUDIO_SINK@"
    if (v === "up") Quickshell.execDetached(["wpctl", "set-volume", "-l", "1", sink, "5%+"])
    else if (v === "down") Quickshell.execDetached(["wpctl", "set-volume", sink, "5%-"])
    else if (v === "mute") Quickshell.execDetached(["wpctl", "set-mute", sink, "1"])
    else if (v === "unmute") Quickshell.execDetached(["wpctl", "set-mute", sink, "0"])
    else if (v === "toggle") Quickshell.execDetached(["wpctl", "set-mute", sink, "toggle"])
    else if (!isNaN(parseFloat(v))) Quickshell.execDetached(["wpctl", "set-volume", sink, String(Math.max(0, Math.min(100, parseFloat(v))) / 100)])
  }
}
