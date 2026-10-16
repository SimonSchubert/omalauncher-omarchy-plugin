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
  readonly property var draw: root.node ? root.node.draw : null

  // Fills the space unless sized; OwlLayout.place() gives it that space.
  implicitWidth: 0
  implicitHeight: 0

  // The GPU path: the default Image target rasterises in software, which at
  // 60 frames a second is the whole budget of a phone CPU.
  renderTarget: Canvas.FramebufferObject
  renderStrategy: Canvas.Cooperative

  readonly property var deps: [root.draw, root.width, root.height, root.widget ? root.widget.frame : 0,
    root.widget ? root.widget.palette : null]
  onDepsChanged: root.requestPaint()

  // Images a drawing call names load asynchronously; the frame that asked
  // for one skips it and the next frame, after onImageLoaded, has it.
  readonly property var images: ({
    get: function(src) {
      var url = L.url(src, root.widget ? root.widget.home : "")
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
    if (!root.draw || width <= 0 || height <= 0) return
    ctx.scale(root.dp, root.dp)
    var ops = root.draw(width / root.dp, height / root.dp)
    L.paint(ctx, ops, { foreground: root.widget ? root.widget.ink("foreground") : "white" },
      root.widget ? root.widget.sansFamily : "sans-serif", root.images)
  }
}
