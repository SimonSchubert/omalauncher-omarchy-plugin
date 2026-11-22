// An OWL Shader: its AGSL translated to GLSL (OwlAgsl.js), compiled with
// Qt's qsb (qt6-shadertools) into the shell's cache, and run by a
// ShaderEffect made for its uniforms. Until that's done, or when it can't be
// (no qsb, code this shell can't translate, loops too heavy), it shows
// `fallback`, as a phone without AGSL does.
//
// A shader that reads `time` is drawn again every frame, through the widget's
// frame clock; any other only when its uniforms or size change.

import QtQuick
import Quickshell
import Quickshell.Io
import "OwlAgsl.js" as Agsl

Item {
  id: root

  property var node: null
  property var widget: null
  readonly property var p: root.node && root.node.p ? root.node.p : ({})

  // Fills the space unless sized; OwlLayout.place() gives it that space.
  implicitWidth: 0
  implicitHeight: 0

  readonly property string code: root.p.code ? String(root.p.code) : ""
  readonly property var tr: Agsl.translate(root.code)
  readonly property string cacheDir: (Quickshell.env("XDG_CACHE_HOME") || Quickshell.env("HOME") + "/.cache") + "/owl/shaders"
  property var effect: null

  Rectangle {
    anchors.fill: parent
    visible: !root.effect
    color: root.p.fallback || (root.widget ? root.widget.ink("surface") : "transparent")
  }

  onTrChanged: root.build()
  Component.onCompleted: root.build()
  Component.onDestruction: {
    root.count(false)
    root.dropEffect()
  }

  function dropEffect(): void {
    if (root.effect) {
      root.effect.destroy()
      root.effect = null
    }
  }

  function report(message: string): void {
    if (root.widget) root.widget.report("Shader: " + message)
  }

  // Compiles the code, unless the cache has it; the effect is made once it's there.
  function build(): void {
    root.dropEffect()
    compiler.running = false
    if (!root.code) return
    if (root.tr.problem) {
      root.report(root.tr.problem)
      return
    }
    compiler.file = root.cacheDir + "/" + Qt.md5(root.tr.glsl)
    compiler.command = ["bash", "-c", compiler.script, "owl-shader", compiler.file].concat(root.pieces(root.tr.glsl))
    compiler.running = true
  }

  // A file per shader, named by its GLSL: compiled once, by whichever widget
  // gets there first. The GLSL comes as arguments, in pieces under the 128 kB
  // one argument may be (a uniform array of thousands makes long code).
  Process {
    id: compiler
    property string file: ""
    readonly property string script: [
      'f=$1',
      'shift',
      '[[ $f == /* ]] || exit 1',
      'if [[ -s $f.qsb ]]; then echo ok; exit; fi',
      'q=$(command -v qsb || echo /usr/lib/qt6/bin/qsb)',
      '[[ -x $q ]] || { echo "needs qsb, from the qt6-shadertools package"; exit 1; }',
      'mkdir -p "${f%/*}"',
      'printf %s "$@" >"$f.$$.frag"',
      'if out=$("$q" --glsl "100 es,120,150,330,300 es" -o "$f.$$.qsb" "$f.$$.frag" 2>&1); then',
      '  mv -f "$f.$$.qsb" "$f.qsb"; rm -f "$f.$$.frag"; echo ok',
      'else',
      '  rm -f "$f.$$.qsb" "$f.$$.frag"',
      '  printf "%s\\n" "$out" | grep -m1 -i error || printf "%s\\n" "$out" | head -1',
      '  exit 1',
      'fi'].join("\n")
    stdout: StdioCollector {
      onStreamFinished: {
        var said = text.trim()
        if (said === "ok") root.makeEffect("file://" + compiler.file + ".qsb")
        else if (said) root.report("this shell couldn't compile it: " + said)
      }
    }
  }

  function pieces(text: string): var {
    var out = []
    for (var i = 0; i < text.length; i += 60000) out.push(text.slice(i, i + 60000))
    return out
  }

  function makeEffect(url: string): void {
    root.dropEffect()
    try {
      root.effect = Qt.createQmlObject(Agsl.effectQml(root.tr), root, "owl-shader")
    } catch (e) {
      root.report(String(e))
      return
    }
    // One that doesn't read time is kept in a layer, drawn again only when its uniforms or size change: otherwise
    // every frame of anything on the board, an animated widget beside it, ran it over every pixel again.
    root.effect.layer.enabled = !root.tr.readsTime
    root.effect.fragmentShader = url
    root.update()
  }

  // Counted as a canvas that draws time, so the widget's frame clock runs for it.
  readonly property bool drawsTime: !!root.effect && root.tr.readsTime === true
  property bool counted: false
  onDrawsTimeChanged: root.count(root.drawsTime)
  function count(on: bool): void {
    if (!root.widget || on === root.counted) return
    root.counted = on
    root.widget.timeCanvases += on ? 1 : -1
  }

  readonly property var deps: [root.p.uniforms, root.width, root.height,
    root.drawsTime && root.widget ? root.widget.frame : 0,
    root.widget ? root.widget.filesLoaded : 0]
  onDepsChanged: root.update()

  function update(): void {
    var e = root.effect
    if (!e) return
    // Pixels, as on the phone: what a shader that draws in pixels expects.
    var dpr = root.Window.window ? root.Window.window.devicePixelRatio : 1
    var t = root.widget && root.widget.instance ? root.widget.instance.time : 0
    e.owl_s = Qt.vector4d(root.width * dpr, root.height * dpr, t || 0, 0)
    var slots = Agsl.pack(root.tr, root.p.uniforms)
    for (var s = 0; s < slots.length; s++)
      e["owl_u" + s] = Qt.vector4d(slots[s][0], slots[s][1], slots[s][2], slots[s][3])
    var u = root.p.uniforms || {}
    root.tr.images.forEach(function(im) {
      var src = u[im.name]
      e[im.glsl + "_url"] = src && root.widget ? root.widget.localUrl(String(src)) : ""
    })
  }
}
