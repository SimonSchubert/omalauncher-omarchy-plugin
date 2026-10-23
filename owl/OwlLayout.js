.pragma library

// How an OWL node sits in its parent, and how a Canvas's display list is
// painted. Kept out of the QML so the rules are in one place: the launcher's
// renderer is not in owl.jar, so these follow docs/LANGUAGE.md of the
// widgets repo --
//
//   A Text without width, weight or fill takes the full width.
//   Canvas and Shader fill the space unless sized. Ring is 64 dp unless sized.
//   weight is a share of the space left in a Row or Column.
//
// -- and, where the doc is silent, what the published widgets are drawn for.

// Compose's rules, as the launcher's renderer (omarchy-proot
// widgets/render/Render.kt) applies them: a node wraps its content unless it
// fills. Text without width, weight or fill is fillMaxWidth; Progress,
// Sparkline and Grid take the width; Canvas, Shader and Terminal take all
// the space. A Row, Column or Box is as wide as a child that fills makes it,
// and only that wide otherwise -- so `justify: end` in a Row of Buttons does
// nothing, as on the launcher.
var SIZING = ["width", "height", "size", "fill", "weight"]

function num(v, fallback) {
  return typeof v === "number" && isFinite(v) ? v : fallback
}

function sized(p) {
  for (var i = 0; i < SIZING.length; i++) if (p[SIZING[i]] !== undefined && p[SIZING[i]] !== null) return true
  return false
}

// `padding: 8`, `[h, v]` or `[l, t, r, b]` as [l, t, r, b].
function padding(v) {
  if (typeof v === "number") return [v, v, v, v]
  if (Array.isArray(v)) {
    if (v.length === 2) return [num(v[0], 0), num(v[1], 0), num(v[0], 0), num(v[1], 0)]
    if (v.length === 4) return [num(v[0], 0), num(v[1], 0), num(v[2], 0), num(v[3], 0)]
  }
  return [0, 0, 0, 0]
}

// Width and height a node asked for in dp, or -1.
function fixedWidth(p) { return num(p.width, num(p.size, -1)) }
function fixedHeight(p) { return num(p.height, num(p.size, -1)) }

// Whether `node` reaches for all the width ("w") or height ("h") it is given.
// `hug` is set for the children of a Row or Flow in a file of owl 10 or later,
// where a Text is as wide as its text, and for those of a Column that hugs.
function wants(node, axis, hug) {
  if (!node) return false
  var p = node.p || {}
  if (p.fill === true || p.fill === (axis === "w" ? "width" : "height")) return true
  if (fixedWidth(p) >= 0 && axis === "w") return false
  if (fixedHeight(p) >= 0 && axis === "h") return false
  var k = node.kind
  if (k === "Canvas" || k === "Shader" || k === "Terminal") return !sized(p)
  if (axis === "h") {
    if (k === "Column" || k === "Row" || k === "Box" || k === "Flow")
      return (node.c || []).some(function(c) {
        return (k === "Column" && num((c.p || {}).weight, 0) > 0) || wants(c, "h")
      })
    return false
  }
  if (k === "Text") return p.weight === undefined && !hug
  if (k === "Progress" || k === "Sparkline" || k === "Grid" || k === "Slider" || k === "Input") return !sized(p)
  // A Popup's menu is in a window of its own: the layout it's in doesn't hold it.
  if (k === "Popup") return false
  if (k === "Row" || k === "Column" || k === "Box" || k === "Flow") {
    var inner = k === "Row" || k === "Flow" ? hugs(node) : columnHugs(node, hug)
    return (node.c || []).some(function(c) {
      return (k === "Row" && num((c.p || {}).weight, 0) > 0) || wants(c, "w", inner)
    })
  }
  return false
}

// The level the node's file declared, which Owl.js's render stamps on each node.
function hugs(node) { return !!node && node.level >= 10 }

// Since owl 11 a Column in a Row or Flow without width, weight or fill is as
// wide as its content: its Texts are as wide as their text, as they are in the
// Row, and so is a Column like it inside. `hug` is whether its parent passes
// that on: a Row or Flow, or a Column that hugs. A lazy Column fills.
function columnHugs(node, hug) {
  if (!hug || !node || node.kind !== "Column" || node.level < 11) return false
  var p = node.p || {}
  return !sized(p) && p.lazy !== true
}

// What a child is handed as its `hug`, by a parent of `parentKind` that was
// handed `parentHug` itself.
function hugFor(child, parentKind, parentNode, parentHug) {
  if (parentKind === "Row" || parentKind === "Flow") return hugs(child)
  return parentKind === "Column" && columnHugs(parentNode, parentHug)
}

// The QtQuick.Layouts attached values for `child` inside a `parentKind`.
// Returns {fillW, fillH, prefW, prefH, stretchW, stretchH} with sizes in dp
// (-1 is "its own size").
function place(child, parentKind, hugged) {
  var p = child && child.p ? child.p : {}
  var w = fixedWidth(p), h = fixedHeight(p)
  var weight = num(p.weight, 0)
  var hug = hugged === undefined ? (parentKind === "Row" || parentKind === "Flow") && hugs(child) : hugged
  var out = { fillW: w < 0 && wants(child, "w", hug), fillH: h < 0 && wants(child, "h"),
    prefW: w, prefH: h, stretchW: -1, stretchH: -1 }
  // Qt's stretch factors are whole numbers, and weight: 1.2 beside weight: 1
  // has to stay 6:5 -- so weights go in as hundredths.
  if (parentKind === "Row" && weight > 0) { out.fillW = true; out.stretchW = Math.round(weight * 100); if (w < 0) out.prefW = 0 }
  if (parentKind === "Column" && weight > 0) { out.fillH = true; out.stretchH = Math.round(weight * 100); if (h < 0) out.prefH = 0 }
  // What fills the rest of a Column shares it, as weight 1 would.
  if (parentKind === "Column" && weight <= 0 && out.fillH) { out.stretchH = 100; if (h < 0) out.prefH = 0 }
  if (parentKind === "Grid" && w < 0) { out.fillW = true; out.prefW = 0 }
  return out
}

// The children of a Row or Column with `justify` turned into fillers:
// [{child: i} | {filler: stretch}]. A weighted child already takes the space
// left, so justify does nothing next to one, as in Compose.
function entries(node, axis) {
  var c = node && node.c ? node.c : []
  var j = node && node.p ? node.p.justify : null
  var out = []
  var weighted = false
  for (var k = 0; k < c.length; k++) {
    var pk = c[k] && c[k].p ? c[k].p : {}
    if (num(pk.weight, 0) > 0 || pk.fill === true || pk.fill === axis) weighted = true
    if (axis === "height" && wants(c[k], "h")) weighted = true
  }
  if (weighted || !j || j === "start") {
    for (var i = 0; i < c.length; i++) out.push({ child: i })
    if (!weighted && c.length) out.push({ filler: 1, tail: true })
    return out
  }
  if (j === "end" || j === "center") out.push({ filler: 1 })
  for (var n = 0; n < c.length; n++) {
    if (n > 0 && (j === "spaceBetween" || j === "spaceAround" || j === "spaceEvenly")) out.push({ filler: j === "spaceAround" ? 2 : 1 })
    if (n === 0 && (j === "spaceAround" || j === "spaceEvenly")) out.push({ filler: 1 })
    out.push({ child: n })
  }
  if (j === "center" || j === "spaceAround" || j === "spaceEvenly") out.push({ filler: 1 })
  return out
}

// Text styles, the launcher's: [size, muted]. Everything is its Mono
// (13 sp monospace) unless `font:` says otherwise.
var STYLES = {
  huge: [44, false],
  title: [20, false],
  body: [13, false],
  small: [11, false],
  muted: [13, true],
  label: [11, true]
}

function style(name) { return STYLES[name] || STYLES.body }

// minLines (owl 11): the lines a Text is at least as tall as, never past maxLines.
function minLines(p) {
  var max = maxLines(p)
  var n = Math.floor(num(p.minLines, 1))
  return Math.max(1, max > 0 ? Math.min(n, max) : n)
}

// A Column's or Grid's children in the order they're laid out. A lazy one with
// `reverse` (owl 11) lists from its end, its first child at the bottom: a
// Column's turned around, a Grid's rows of `columns` turned around, the short
// last row on top with empty cells (null) after it.
function ordered(node) {
  var c = node && node.c ? node.c : []
  var p = node && node.p ? node.p : {}
  if (p.lazy !== true || p.reverse !== true) return c
  if (node.kind === "Column") return c.slice().reverse()
  if (node.kind !== "Grid") return c
  var cols = Math.max(1, Math.round(num(p.columns, 2)))
  var out = []
  for (var start = Math.floor((c.length - 1) / cols) * cols; start >= 0; start -= cols)
    for (var i = start; i < start + cols; i++) out.push(i < c.length ? c[i] : null)
  return out
}

// huge and title stay on one line in narrow tiles instead of breaking mid-word.
function maxLines(p) {
  var n = num(p.maxLines, 0)
  if (n > 0) return n
  return p.style === "huge" || p.style === "title" ? 1 : 0
}

// -------------------------------------------------------------- Canvas

// Paints a display list from Instance.draw() onto a Context2D, in dp.
// `images` is a cache the Canvas item fills through loadImage.
function paint(ctx, ops, theme, fontFamily, images) {
  for (var i = 0; i < ops.length; i++) paintOp(ctx, ops[i], theme, fontFamily, images)
}

function rad(deg) { return (deg - 90) * Math.PI / 180 }

function style2d(ctx, paintValue, theme, geometry) {
  if (paintValue === null || paintValue === undefined) return null
  if (typeof paintValue === "string") return paintValue
  if (paintValue.gradient) {
    var g = paintValue.gradient
    var grad = g.radial
      ? ctx.createRadialGradient(g.coords[0], g.coords[1], 0, g.coords[0], g.coords[1], Math.max(g.coords[2], 0.001))
      : ctx.createLinearGradient(g.coords[0], g.coords[1], g.coords[2], g.coords[3])
    var n = g.colors.length
    for (var i = 0; i < n; i++) if (g.colors[i]) grad.addColorStop(n === 1 ? 0 : i / (n - 1), g.colors[i])
    return grad
  }
  return null
}

function shape(ctx, op, theme, trace, defaultStroke) {
  var fill = style2d(ctx, op.fill, theme)
  var stroke = style2d(ctx, op.stroke, theme)
  if (fill === null && stroke === null) {
    if (defaultStroke) stroke = style2d(ctx, op.color, theme) || theme.foreground
    else fill = style2d(ctx, op.color, theme) || theme.foreground
  }
  ctx.beginPath()
  trace()
  if (fill !== null) {
    ctx.fillStyle = fill
    ctx.fill()
  }
  if (stroke !== null) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = num(op.width, 1)
    ctx.lineCap = op.cap || "butt"
    ctx.lineJoin = op.cap === "round" ? "round" : "miter"
    ctx.stroke()
  }
}

// #aarrggbb, as Owl.js writes colors, in the #rrggbbaa CSS reads.
function cssColor(c) {
  var s = String(c)
  return /^#[0-9a-fA-F]{8}$/.test(s) ? "rgba(" + parseInt(s.substr(3, 2), 16) + "," + parseInt(s.substr(5, 2), 16) + ","
    + parseInt(s.substr(7, 2), 16) + "," + (parseInt(s.substr(1, 2), 16) / 255).toFixed(3) + ")" : s
}

// A background gradient (owl 10): its points are fractions of the node, and a
// radial one's radius a fraction of the longer side.
function backgroundGradient(ctx, g, width, height) {
  var c = g.coords
  var grad = g.radial
    ? ctx.createRadialGradient(c[0] * width, c[1] * height, 0, c[0] * width, c[1] * height, Math.max(c[2] * Math.max(width, height), 0.01))
    : ctx.createLinearGradient(c[0] * width, c[1] * height, c[2] * width, c[3] * height)
  var n = g.colors.length
  for (var i = 0; i < n; i++) if (g.colors[i]) grad.addColorStop(n === 1 ? 0 : i / (n - 1), g.colors[i])
  return grad
}

function roundRect(ctx, x, y, w, h, r) {
  if (w < 0) { x += w; w = -w }
  if (h < 0) { y += h; h = -h }
  r = Math.max(0, Math.min(r, w / 2, h / 2))
  if (r <= 0) { ctx.rect(x, y, w, h); return }
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

function paintOp(ctx, op, theme, fontFamily, images) {
  var a = op.args
  function n(i) { return num(a[i], 0) }
  switch (op.op) {
  case "rect":
    shape(ctx, op, theme, function() { roundRect(ctx, n(0), n(1), n(2), n(3), num(op.radius, 0)) })
    return
  case "circle":
    shape(ctx, op, theme, function() { ctx.arc(n(0), n(1), Math.max(n(2), 0), 0, Math.PI * 2, false) })
    return
  case "arc":
    var filledArc = op.fill !== undefined && op.fill !== null || (op.stroke === undefined || op.stroke === null)
    shape(ctx, op, theme, function() {
      var start = rad(n(3)), end = rad(n(3) + n(4))
      if (op.fill !== undefined && op.fill !== null || (op.stroke === undefined || op.stroke === null)) ctx.moveTo(n(0), n(1))
      ctx.arc(n(0), n(1), Math.max(n(2), 0), start, end, n(4) < 0)
      if (filledArc && (op.stroke === undefined || op.stroke === null)) ctx.closePath()
    })
    return
  case "line":
    var lineOp = { stroke: op.stroke || op.color || op.fill || null, width: op.width, cap: op.cap }
    shape(ctx, lineOp, theme, function() { ctx.moveTo(n(0), n(1)); ctx.lineTo(n(2), n(3)) }, true)
    return
  case "path":
    var pts = op.points || []
    if (!pts.length) return
    shape(ctx, op, theme, function() {
      ctx.moveTo(pts[0][0], pts[0][1])
      for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1])
      if (op.closed) ctx.closePath()
    })
    return
  case "text":
    var size = num(op.size, 12)
    ctx.textBaseline = "middle"
    var base = style2d(ctx, op.color || op.fill, theme) || theme.foreground
    // Since owl 10 a font, weight and slant of its own, and its text in spans, each styled on its own.
    // Context2D has no letter spacing, so letterSpacing is left out here.
    var pieces = op.spans || [{ text: op.text }]
    var fonts = pieces.map(function(piece) { return canvasFont(op, piece, size, theme, fontFamily) })
    var widths = pieces.map(function(piece, i) { ctx.font = fonts[i]; return ctx.measureText(piece.text).width })
    var total = widths.reduce(function(x, y) { return x + y }, 0)
    var x = n(1) - (op.align === "center" ? total / 2 : op.align === "end" ? total : 0)
    ctx.textAlign = "left"
    for (var t = 0; t < pieces.length; t++) {
      ctx.font = fonts[t]
      ctx.fillStyle = pieces[t].color || base
      ctx.fillText(pieces[t].text, x, n(2))
      x += widths[t]
    }
    return
  case "image":
    var img = images ? images.get(op.src) : null
    if (img) ctx.drawImage(img, n(1), n(2), n(3), n(4))
    return
  case "translate":
    group(ctx, op, theme, fontFamily, images, function() { ctx.translate(n(0), n(1)) })
    return
  case "rotate":
    group(ctx, op, theme, fontFamily, images, function() {
      var cx = n(1), cy = n(2)
      ctx.translate(cx, cy)
      ctx.rotate(n(0) * Math.PI / 180)
      ctx.translate(-cx, -cy)
    })
    return
  case "scale":
    group(ctx, op, theme, fontFamily, images, function() {
      var sx = n(0), sy = a.length > 1 ? n(1) : sx, cx = n(2), cy = n(3)
      ctx.translate(cx, cy)
      ctx.scale(sx, sy)
      ctx.translate(-cx, -cy)
    })
    return
  case "clip":
    group(ctx, op, theme, fontFamily, images, function() {
      ctx.beginPath()
      ctx.rect(n(0), n(1), n(2), n(3))
      ctx.clip()
    })
    return
  case "layer":
    group(ctx, op, theme, fontFamily, images, function() {
      ctx.globalAlpha = ctx.globalAlpha * Math.max(0, Math.min(1, num(a[0], 1)))
    })
    return
  }
}

// A Context2D font for a text(...) call's piece: the piece's own style over the call's.
function canvasFont(op, piece, size, theme, fontFamily) {
  var name = piece.font !== undefined && piece.font !== null ? piece.font : op.font
  var family = name !== undefined && name !== null && theme.font ? theme.font(name) : fontFamily
  var weight = num(piece.fontWeight, num(op.fontWeight, (piece.bold !== undefined ? piece.bold : op.bold) ? 700 : 400))
  var italic = piece.italic !== undefined ? piece.italic : op.italic
  return (italic ? "italic " : "") + Math.round(Math.max(1, Math.min(1000, weight))) + " " + num(piece.fontSize, size) + "px \"" + family + "\""
}

function group(ctx, op, theme, fontFamily, images, setup) {
  ctx.save()
  setup()
  paint(ctx, op.ops || [], theme, fontFamily, images)
  ctx.restore()
}

// Every image a display list draws, so the Canvas can load them first.
function imageSources(ops, out) {
  out = out || []
  for (var i = 0; i < ops.length; i++) {
    if (ops[i].op === "image" && ops[i].src && out.indexOf(ops[i].src) < 0) out.push(ops[i].src)
    if (ops[i].ops) imageSources(ops[i].ops, out)
  }
  return out
}

// A path a widget names, as a URL: "~/pics/a.png", "/usr/...", an asset's
// data: URL, or a web address.
function url(src, home) {
  if (!src) return ""
  var s = String(src)
  // An Android app's icon (owl 7): there are no Android apps here, so nothing is drawn.
  if (s.indexOf("app:") === 0) return ""
  // Any app's icon by its android.recent key (owl 10): there is no recent strip here either.
  if (s.indexOf("icon:") === 0) return ""
  if (s.indexOf("~/") === 0) return "file://" + home + s.slice(1)
  if (s.charAt(0) === "/") return "file://" + s
  return s
}
