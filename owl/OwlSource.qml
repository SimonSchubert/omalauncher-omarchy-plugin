pragma ComponentBehavior: Bound

// One `source` of an OWL widget, running while its board is on screen.
//
//   cmd("...")       bash -c, every N seconds, killed at its timeout
//   stream("...")    one long-running bash -c; every line is a new value
//   http("...")      GET, every N seconds (at least 5), with optional headers
//   file("~/...")    the file's text, again whenever it changes
//   clock            Unix seconds, on the second (or minute) boundary
//   android.*        what the launcher reads from Android, read here from
//                    Linux: the battery from UPower, media and the
//                    device/system/volume/modes/network command from the OwlHost;
//                    alarm is never set, as Linux keeps no next alarm, there's
//                    no SIM, and no key bar holds a modifier
//
// `status` sources (cmd and http) get {out, err, code, ok}, as the language
// guide has it: the output, stderr, the exit code or HTTP status (124 when it
// timed out), and whether it worked -- so a widget can tell "offline" from
// "empty".

import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Services.UPower

Item {
  id: root

  required property var spec
  required property var widget

  readonly property string kind: root.spec ? root.spec.kind : ""
  readonly property bool active: !!root.widget && root.widget.active
  readonly property bool periodic: root.kind === "cmd" || root.kind === "http" || root.kind === "clock"
    || root.kind === "android.device" || root.kind === "android.system" || root.kind === "android.volume"
    || root.kind === "android.modes" || root.kind === "android.network"

  function push(value) {
    if (root.widget) root.widget.sourceValue(root.spec.slot, value)
  }

  function fire() {
    if (!root.active) return
    // Whole seconds unless the widget ticks faster than that: `now - fed`
    // and fmtTime() are written for the launcher's integer clock.
    if (root.kind === "clock")
      return root.push(Number(root.spec.every) >= 1 ? Math.round(Date.now() / 1000) : Date.now() / 1000)
    if (root.kind === "http") return root.fetch()
    if (root.kind === "cmd") return root.exec(String(root.spec.arg()))
    if (root.kind === "android.device" || root.kind === "android.system" || root.kind === "android.volume"
        || root.kind === "android.modes" || root.kind === "android.network")
      return root.exec(root.widget.host.sourceCommand(root.kind))
  }

  // The clock ticks on its own boundaries, so `every 1m` turns over with the
  // minute rather than up to 59 seconds after it.
  function nextDelay() {
    var every = Math.max(Number(root.spec.every) || 60, 0.1) * 1000
    if (root.kind !== "clock") return every
    return every - (Date.now() % every) + 5
  }

  Timer {
    id: ticker
    running: root.active && root.periodic
    interval: root.nextDelay()
    repeat: true
    triggeredOnStart: true
    onTriggered: {
      root.fire()
      if (root.kind === "clock") interval = root.nextDelay()
    }
  }

  // ---------------------------------------------------------------- cmd

  property string pendingText: ""
  property string pendingErr: ""
  property int pendingCode: 0
  property bool timedOut: false
  property bool streamDone: false
  property bool exitedDone: false

  function exec(command) {
    if (proc.running) return
    root.streamDone = false
    root.exitedDone = false
    root.timedOut = false
    proc.command = ["bash", "-c", command]
    proc.running = true
    killer.restart()
  }

  function settle() {
    if (!root.streamDone || !root.exitedDone) return
    var json = root.spec.json || root.kind.indexOf("android.") === 0
    var text = root.pendingText
    if (root.spec.status) {
      var code = root.timedOut ? 124 : root.pendingCode
      root.widget.sourceStatus(root.spec.slot, code, text, root.pendingErr, json, code === 0)
      return
    }
    if (json && root.kind.indexOf("android.") === 0) {
      root.widget.sourceJson(root.spec.slot, text)
      return
    }
    root.push(text)
  }

  Process {
    id: proc
    workingDirectory: Quickshell.env("HOME") || "/"
    stdout: StdioCollector {
      onStreamFinished: {
        root.pendingText = text
        root.streamDone = true
        root.settle()
      }
    }
    stderr: StdioCollector {
      onStreamFinished: root.pendingErr = text
    }
    onExited: (code) => {
      killer.stop()
      root.pendingCode = code
      root.exitedDone = true
      root.settle()
    }
  }

  Timer {
    id: killer
    interval: Math.max(Number(root.spec.timeout) || 10, 1) * 1000
    onTriggered: {
      if (!proc.running) return
      root.widget.report(root.spec.name + ": timed out after " + Math.round(interval / 1000) + "s")
      root.timedOut = true
      proc.running = false
    }
  }

  // --------------------------------------------------------------- http

  property var request: null

  function fetch() {
    if (root.request) return
    var url = String(root.spec.arg())
    var xhr = new XMLHttpRequest()
    root.request = xhr
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== XMLHttpRequest.DONE || root.request !== xhr) return
      root.request = null
      httpKiller.stop()
      if (root.spec.status) root.widget.sourceStatus(root.spec.slot, xhr.status, xhr.responseText, "", root.spec.json, xhr.status >= 200 && xhr.status < 300)
      else if (xhr.status >= 200 && xhr.status < 300) root.push(xhr.responseText)
      else root.widget.report(root.spec.name + ": HTTP " + xhr.status + " from " + url)
    }
    xhr.open("GET", url)
    var headers = root.spec.headers()
    for (var k in headers) xhr.setRequestHeader(k, String(headers[k]))
    xhr.send()
    httpKiller.restart()
  }

  Timer {
    id: httpKiller
    interval: Math.max(Number(root.spec.timeout) || 10, 1) * 1000
    onTriggered: {
      var xhr = root.request
      root.request = null
      if (xhr) xhr.abort()
      root.widget.report(root.spec.name + ": timed out")
      if (xhr && root.spec.status) root.widget.sourceStatus(root.spec.slot, 124, "", "", root.spec.json, false)
    }
  }

  // ------------------------------------------------------------- stream

  Process {
    id: stream
    running: root.active && root.kind === "stream" && !restart.running
    command: root.kind === "stream" ? ["bash", "-c", String(root.spec.arg())] : []
    workingDirectory: Quickshell.env("HOME") || "/"
    stdout: SplitParser {
      onRead: (line) => root.push(line)
    }
    onExited: if (root.active) restart.restart()
  }

  // A stream that ends is started again, after a pause, so a command that
  // dies on start does not spin.
  Timer {
    id: restart
    interval: 5000
  }

  // --------------------------------------------------------------- file

  FileView {
    path: {
      if (!root.active || root.kind !== "file") return ""
      void root.widget.generation
      var p = String(root.spec.arg())
      return p.indexOf("~/") === 0 ? (Quickshell.env("HOME") || "") + p.slice(1) : p
    }
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.push(text())
    onLoadFailed: root.push(null)
  }

  // ------------------------------------------------------------ android

  // The laptop's own battery: health is on it, not on UPower's display
  // device, which only adds up the charge of every battery.
  readonly property var cell: {
    if (root.kind !== "android.battery") return null
    var all = UPower.devices.values
    for (var i = 0; i < all.length; i++) if (all[i].isLaptopBattery && all[i].isPresent) return all[i]
    return null
  }
  // What UPower doesn't pass on, from the kernel's battery files.
  readonly property string cellDir: root.cell && /^[A-Za-z0-9_.-]+$/.test(root.cell.nativePath)
    ? "/sys/class/power_supply/" + root.cell.nativePath : ""
  property var cycles: null
  property var technology: null
  FileView {
    path: root.cellDir ? root.cellDir + "/cycle_count" : ""
    printErrors: false
    onLoaded: { var n = parseInt(text(), 10); root.cycles = n > 0 ? n : null }
    onLoadFailed: root.cycles = null
  }
  FileView {
    path: root.cellDir ? root.cellDir + "/technology" : ""
    printErrors: false
    onLoaded: { var t = text().trim(); root.technology = t && t !== "Unknown" ? t : null }
    onLoadFailed: root.technology = null
  }

  // UPower is what the status bar reads, so the widget and the bar agree.
  readonly property var battery: {
    if (root.kind !== "android.battery") return null
    var d = UPower.displayDevice
    if (!d || !d.isPresent) return null
    var c = root.cell
    var level = Math.round(Number(d.percentage || 0) * 100)
    var state = d.state
    var status = state === UPowerDeviceState.Charging ? "charging"
      : state === UPowerDeviceState.FullyCharged ? "full"
      : state === UPowerDeviceState.Discharging ? "discharging"
      : state === UPowerDeviceState.PendingCharge ? "not charging" : "unknown"
    return {
      level: level,
      charging: !UPower.onBattery,
      status: status,
      plugged: UPower.onBattery ? null : "ac",
      health: c && c.healthSupported ? Math.round(Number(c.healthPercentage)) + "%"
        : d.healthSupported ? Math.round(Number(d.healthPercentage)) + "%" : null,
      cycles: root.cycles,
      technology: root.technology
    }
  }
  onBatteryChanged: if (root.active && root.kind === "android.battery") root.widget.sourceObject(root.spec.slot, root.battery)

  // The host keeps media current (MPRIS by default, a shell's own music
  // service where it has one).
  readonly property var media: root.kind === "android.media" && root.widget ? root.widget.host.media : null
  onMediaChanged: if (root.active && root.kind === "android.media") root.widget.sourceObject(root.spec.slot, root.media)

  readonly property var noAlarm: ({ set: false, time: null, app: null })
  // The launcher's coding agents, for a face with its own prompt bar: none here.
  readonly property var noAgents: ({ default: null, installed: [] })
  // The launcher's app drawer (owl 11): no apps in it here, and Linux is the desktop itself.
  readonly property var noDrawer: ({ apps: [], linux: "installed", monochrome: false, work: null, updates: 0 })
  // A desktop has no mobile service (owl 13), as a Wi-Fi tablet has none, and no key bar latching modifiers (owl 12).
  readonly property var noSim: ({ available: false, present: false, carrier: null, signal: null, data: null, roaming: false })
  readonly property var noModifiers: ({ ctrl: "off", alt: "off", shift: "off" })

  // The sources that are pushed rather than polled, as they start.
  function pushNow() {
    if (!root.active) return
    if (root.kind === "android.battery") root.widget.sourceObject(root.spec.slot, root.battery)
    if (root.kind === "android.notifications") root.widget.sourceObject(root.spec.slot, [])
    // No Android apps on a desktop, and no recent strip.
    if (root.kind === "android.apps" || root.kind === "android.recent") root.widget.sourceObject(root.spec.slot, [])
    if (root.kind === "android.agents") root.widget.sourceObject(root.spec.slot, root.noAgents)
    if (root.kind === "android.drawer") root.widget.sourceObject(root.spec.slot, root.noDrawer)
    if (root.kind === "android.alarm") root.widget.sourceObject(root.spec.slot, root.noAlarm)
    if (root.kind === "android.sim") root.widget.sourceObject(root.spec.slot, root.noSim)
    if (root.kind === "android.modifiers") root.widget.sourceObject(root.spec.slot, root.noModifiers)
    if (root.kind === "android.media") root.widget.sourceObject(root.spec.slot, root.media)
  }
  onActiveChanged: root.pushNow()
  Component.onCompleted: root.pushNow()
}
