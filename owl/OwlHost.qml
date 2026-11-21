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

  // How many times a second an animated widget draws. The launcher draws at the display's rate; on a
  // phone that is a core's worth of JavaScript for one busy Canvas, so a shell picks what it can carry.
  property real frameRate: 30

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

  // The MPRIS player android.media reads and media(...) steers: the first that plays, else the first.
  function mprisPlayer() {
    var players = Mpris.players ? Mpris.players.values : []
    for (var i = 0; i < players.length; i++) if (players[i].isPlaying) return players[i]
    return players.length ? players[0] : null
  }

  // android.media: {playing, title, artist, album, app}, from the first MPRIS
  // player, and (owl 23) whether it can be moved to a point in the track, its
  // speed, and its own buttons, which MPRIS has none of. A shell with its own
  // music service can bind this instead.
  property var media: {
    var p = root.mprisPlayer()
    if (!p) return { playing: false, title: null, artist: null, album: null, app: null, canSeek: false, speed: null, actions: [] }
    return {
      playing: !!p.isPlaying,
      title: p.trackTitle || null,
      artist: p.trackArtist || null,
      album: p.trackAlbum || null,
      app: p.identity || null,
      canSeek: !!p.canSeek,
      speed: p.rate > 0 ? p.rate : null,
      actions: []
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
    case "media":
      if (s(0) === "action") return widget.report("media(\"action\", ...) presses one of an Android player's own buttons, which this shell does not have")
      return root.mediaAction(s(0), a.length > 1 ? a[1] : null)
    // Only media has a stream here (owl 13): a desktop has no ringer, and its notifications and alarms play
    // at the one volume.
    case "volume":
      if (a.length > 1 && s(1) !== "media")
        return widget.report("volume(..., \"" + s(1) + "\") sets a phone's " + s(1) + " volume, which this shell does not have")
      // owl 25: nothing here to ask for; the output's battery stays unread and not allowed.
      if (s(0) === "request")
        return widget.report("volume(\"request\") asks for Bluetooth to read a headset's battery, which this shell does not have")
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
    case "pickImages":
      return widget.report("pickImages() pastes photos picked on the phone, which this shell does not have")
    // Only start and toggle would listen; stop and cancel have nothing to turn off.
    case "speech":
      return s(0) === "start" || s(0) === "toggle" ? widget.report("speech(...) dictates through the phone's speech recognizer, which this shell does not have") : undefined
    // owl 18: a Browser here is a link to its page, with no history to go back in or page to reload.
    case "web":
      return
    // Nothing here to ask for, and no AirPods link; what a widget reads stays not allowed, so asking says why.
    case "location":
      return widget.report("location(\"request\") asks for the phone's location, which this shell does not have")
    case "calendar":
      return widget.report("calendar(\"" + s(0) + "\") " + (s(0) === "open" ? "opens the phone's calendar app" : "asks to read the phone's calendars") + ", which this shell does not have")
    case "airpods":
      return s(0) === "request" ? widget.report("airpods(\"request\") asks for Bluetooth to link to AirPods, which this shell does not have") : undefined
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

  // media("seek", seconds) from the track's start and media("speed", 1.5) (owl 23) go to the player too.
  function mediaAction(op, value) {
    var player = { toggle: "play-pause", play: "play", pause: "pause", next: "next", previous: "previous" }[op]
    if (player) return Quickshell.execDetached(["playerctl", player])
    var v = parseFloat(value)
    if (isNaN(v) || !isFinite(v)) return
    if (op === "seek") Quickshell.execDetached(["playerctl", "position", String(Math.max(0, v))])
    else if (op === "speed" && v > 0) {
      var p = root.mprisPlayer()
      if (p) p.rate = v
    }
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

  // Web files the widgets fetch (OwlWidget.fetchFile): a few at once for all
  // of them, as Qt's network queue did, the rest waiting their turn, so a
  // gallery of a thousand pictures doesn't start a thousand curls.
  readonly property int maxFetching: 4
  property int fetching: 0
  property var fetchQueue: []

  // start() runs when there's room; it calls fetched() once it's done.
  function queueFetch(owner, start, first) {
    var f = { owner: owner, start: start }
    if (first) root.fetchQueue.unshift(f)
    else root.fetchQueue.push(f)
    root.nextFetch()
  }

  function fetched() {
    root.fetching--
    root.nextFetch()
  }

  function nextFetch() {
    while (root.fetching < root.maxFetching && root.fetchQueue.length) {
      root.fetching++
      root.fetchQueue.shift().start()
    }
  }

  // A widget that's gone takes what it was still waiting for with it.
  function dropFetches(owner) {
    root.fetchQueue = root.fetchQueue.filter(function(f) { return f.owner !== owner })
  }
}
