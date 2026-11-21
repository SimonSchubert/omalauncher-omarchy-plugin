// An OWL Canvas: asks the instance for this frame's display list and paints
// it. The drawing calls are evaluated in dp, so the context is scaled once.
//
// A widget that reads `time` repaints every frame while its board is up
// (OwlWidget's frame counter); any other repaints only when the node, the
// size or the theme changes.

import QtQuick
import "OwlLayout.js" as L

Canvas {
  id: root

  property var node: null
  property var widget: null

  readonly property real dp: root.widget ? root.widget.dp : 1
  // Read from the node when asked, not bound: a node a render kept has had its
  // drawing replaced in place (OwlWidget.share), which no binding sees.

  // Fills the space unless sized; OwlLayout.place() gives it that space.
  implicitWidth: 0
  implicitHeight: 0

  // The GPU path: the default Image target rasterises in software, which at
  // 60 frames a second is the whole budget of a phone CPU.
  // Rasterised on a thread of its own, not the GUI thread every touch and every
  // other widget waits on. Qt 6 has no FramebufferObject canvas: it was an Image.
  renderTarget: Canvas.Image
  renderStrategy: Canvas.Threaded

  // Whether the last drawing read `time`; until the first, it may have. Only
  // then does the frame clock repaint this canvas: a gradient beside an
  // animation was rasterised again every frame, for a picture that never moved.
  property bool drawsTime: true
  onDrawsTimeChanged: if (root.widget) root.widget.timeCanvases += root.drawsTime ? 1 : -1
  Component.onCompleted: if (root.widget && root.drawsTime) root.widget.timeCanvases += 1
  Component.onDestruction: if (root.widget && root.drawsTime) root.widget.timeCanvases -= 1

  readonly property var deps: [root.node, root.width, root.height,
    root.widget ? root.widget.renders : 0,
    root.widget && root.drawsTime ? root.widget.frame : 0,
    root.widget ? root.widget.palette : null, root.widget ? root.widget.fontsLoaded : 0,
    root.widget ? root.widget.filesLoaded : 0]
  onDepsChanged: root.prepare()

  // The drawing's calls, worked out when anything it may read changed, and
  // rasterised only when they differ from the last ones. Working them out is a
  // millisecond; rasterising is the expensive half, and a widget that renders
  // every second for a clock it never draws would otherwise pay it every second.
  property var ops: null
  property string opsKey: ""
  function prepare(): void {
    var draw = root.node ? root.node.draw : null
    if (!draw || width <= 0 || height <= 0) {
      if (root.ops !== null) { root.ops = null; root.opsKey = ""; root.requestPaint() }
      return
    }
    // The instance's readsTime is what render() leaves for the tree; borrowed
    // to ask the same question of this drawing, and handed back.
    var inst = root.widget ? root.widget.instance : null
    var was = inst ? inst.readsTime : false
    if (inst) inst.readsTime = false
    var ops = null
    var w = width / root.dp, h = height / root.dp
    // What the drawing reads, so a change to it draws again (OwlWidget.drawReads).
    if (inst) {
      var read = inst.reading(function () { ops = draw(w, h) })
      for (var k in read) root.widget.drawReads[k] = true
    } else {
      ops = draw(w, h)
    }
    if (inst) {
      root.drawsTime = inst.readsTime
      inst.readsTime = was
    }
    // Colours and fonts are part of the picture without being in the calls.
    var key = JSON.stringify(ops) + "|" + width + "x" + height + "|"
              + (root.widget ? JSON.stringify(root.widget.palette) + root.widget.fontsLoaded + "|" + root.widget.filesLoaded : "")
    if (key === root.opsKey) return
    root.ops = ops
    root.opsKey = key
    root.requestPaint()
  }

  // Images a drawing call names load asynchronously; the frame that asked
  // for one skips it and the next frame, after onImageLoaded, has it.
  readonly property var images: ({
    get: function(src) {
      var url = root.widget ? root.widget.localUrl(src) : ""
      if (!url) return null
      if (root.isImageLoaded(url)) return url
      if (!root.isImageLoading(url) && !root.isImageError(url)) root.loadImage(url)
      return null
    }
  })
  onImageLoaded: root.requestPaint()

  onPaint: {
    var ctx = getContext("2d")
    ctx.reset()
    if (!root.ops || width <= 0 || height <= 0) return
    ctx.scale(root.dp, root.dp)
    L.paint(ctx, root.ops, {
      foreground: root.widget ? root.widget.ink("foreground") : "white",
      font: function(name) { return root.widget ? root.widget.fontFamily(name) : "sans-serif" }
    },
      root.widget ? root.widget.sansFamily : "sans-serif", root.images)
  }
}
