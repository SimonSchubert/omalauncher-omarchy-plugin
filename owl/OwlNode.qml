pragma ComponentBehavior: Bound

// One node of an OWL widget, drawn from the plain object Owl.js's
// Instance.render() hands out: {kind, p: properties, h: handlers, a:
// animations, c: children, draw: (w, h) => display list}.
//
// Children are a Repeater over a COUNT, not over the array, so a source that
// updates a widget's text hands every delegate a new object and rebuilds
// nothing; delegates are made and destroyed only when a list changes length.
// A child whose kind changes in place (an `if` flipping a Text for a Row)
// swaps its content Loader, not its slot.
//
// Children load OwlNode.qml by URL because a component may not contain itself.

import QtQuick
import QtQuick.Layouts
import QtQuick.Effects
import "OwlLayout.js" as L

Item {
  id: root

  property var node: null
  // The OwlWidget this node belongs to: dp, the theme, fonts, the frame clock.
  property var widget: null

  readonly property var p: root.node && root.node.p ? root.node.p : ({})
  readonly property var anim: root.node && root.node.a ? root.node.a : ({})
  readonly property var handlers: root.node && root.node.h ? root.node.h : ({})
  readonly property string kind: root.node ? String(root.node.kind) : ""
  readonly property var children_: root.node && root.node.c ? root.node.c : []
  readonly property real dp: root.widget ? root.widget.dp : 1
  readonly property var pad: L.padding(root.p.padding)
  readonly property real fixedW: L.fixedWidth(root.p)
  readonly property real fixedH: L.fixedHeight(root.p)

  implicitWidth: root.fixedW >= 0 ? root.fixedW * root.dp
    : body.implicitWidth + (root.pad[0] + root.pad[2]) * root.dp
  implicitHeight: root.fixedH >= 0 ? root.fixedH * root.dp
    : body.implicitHeight + (root.pad[1] + root.pad[3]) * root.dp

  visible: root.p.visible === undefined || root.p.visible === null || root.p.visible === true
  opacity: L.num(root.p.opacity, 1)
  rotation: L.num(root.p.rotation, 0)
  scale: L.num(root.p.scale, 1)
  clip: root.p.clip === true
  transform: Translate {
    x: Array.isArray(root.p.offset) ? L.num(root.p.offset[0], 0) * root.dp : 0
    y: Array.isArray(root.p.offset) ? L.num(root.p.offset[1], 0) * root.dp : 0
  }

  function ms(a) {
    if (!a) return 0
    if (a.type === "tween") return Math.max(0, L.num(a.duration, 0.3)) * 1000
    // A spring settles in roughly 4 / (damping * sqrt(stiffness)) seconds.
    return Math.min(1200, Math.max(120, 4000 / (Math.max(L.num(a.damping, 0.6), 0.05) * Math.sqrt(Math.max(L.num(a.stiffness, 300), 1)))))
  }
  function easing(a) {
    if (!a || a.type !== "tween") return Easing.OutBack
    return a.easing === "linear" ? Easing.Linear : a.easing === "in" ? Easing.InCubic
      : a.easing === "out" ? Easing.OutCubic : Easing.InOutCubic
  }

  Behavior on opacity {
    enabled: !!root.anim.opacity
    NumberAnimation { duration: root.ms(root.anim.opacity); easing.type: root.easing(root.anim.opacity) }
  }
  Behavior on rotation {
    enabled: !!root.anim.rotation
    NumberAnimation { duration: root.ms(root.anim.rotation); easing.type: root.easing(root.anim.rotation) }
  }
  Behavior on scale {
    enabled: !!root.anim.scale
    NumberAnimation { duration: root.ms(root.anim.scale); easing.type: root.easing(root.anim.scale) }
  }

  // ------------------------------------------------------------ decoration

  readonly property var background: root.p.background
  readonly property string backgroundColor: typeof root.background === "string" ? root.background
    : root.background && root.background.gradient ? (root.background.gradient.colors[0] || "transparent")
    : "transparent"

  Rectangle {
    anchors.fill: parent
    visible: root.background || L.num(root.p.border, 0) > 0
    color: root.backgroundColor
    radius: L.num(root.p.radius, 0) * root.dp
    border.width: L.num(root.p.border, 0) * root.dp
    border.color: root.p.borderColor || (root.widget ? root.widget.ink("border") : "grey")
    Behavior on color {
      enabled: !!root.anim.background
      ColorAnimation { duration: root.ms(root.anim.background) }
    }
  }

  // ------------------------------------------------------------- content

  Loader {
    id: body
    anchors {
      fill: parent
      leftMargin: root.pad[0] * root.dp
      topMargin: root.pad[1] * root.dp
      rightMargin: root.pad[2] * root.dp
      bottomMargin: root.pad[3] * root.dp
    }
    sourceComponent: {
      switch (root.kind) {
      case "Column": return root.p.scroll === true ? scrollColumnC : columnC
      case "Row": return root.p.wrap === true ? flowC : rowC
      case "Flow": return flowC
      case "Box": return boxC
      case "Grid": return gridC
      case "Text": return textC
      case "Button": return buttonC
      case "Progress": return progressC
      case "Ring": return ringC
      case "Sparkline": return sparklineC
      case "Image": return imageC
      case "Canvas": return canvasC
      case "Shader": return shaderC
      case "Terminal": return terminalC
      case "Slider": return sliderC
      case "Input": return inputC
      default: return null
      }
    }
  }

  // ------------------------------------------------------------- input

  // Exclusive on press, so a tap lands on the innermost node that wants it
  // and not on every tile around it. A drag past the threshold still goes to
  // whatever drags -- a Flickable, the drawer gesture under Home.
  TapHandler {
    enabled: !!root.handlers.onTap
    gesturePolicy: TapHandler.ReleaseWithinBounds
    onTapped: (point) => root.handlers.onTap(point.position.x / root.dp, point.position.y / root.dp)
  }

  DragHandler {
    enabled: !!root.handlers.onDrag
    target: null
    property point last: Qt.point(0, 0)
    onActiveChanged: if (active) last = Qt.point(0, 0)
    onTranslationChanged: {
      var dx = (translation.x - last.x) / root.dp
      var dy = (translation.y - last.y) / root.dp
      last = Qt.point(translation.x, translation.y)
      root.handlers.onDrag(dx, dy, centroid.position.x / root.dp, centroid.position.y / root.dp)
    }
  }

  // --------------------------------------------------------- containers

  // One child slot in a Row, Column or Grid: either a filler that `justify`
  // asked for, or the child itself, carrying the Layout values it gets from
  // OwlLayout.place().
  component Slot: Loader {
    id: slot
    required property int index
    // The OwlNode the slot is in: an inline component cannot see this
    // file's ids, so it is handed its owner.
    required property Item owner
    property string parentKind: ""
    property var entries: null
    readonly property var entry: slot.entries ? slot.entries[slot.index] : { child: slot.index }
    readonly property var child: slot.owner && slot.entry && slot.entry.child !== undefined ? slot.owner.children_[slot.entry.child] || null : null
    readonly property var place: L.place(slot.child, slot.parentKind)
    readonly property bool filler: !!slot.entry && slot.entry.filler !== undefined
    readonly property bool horizontal: slot.parentKind === "Row"
    readonly property real dp: slot.owner ? slot.owner.dp : 1

    Layout.fillWidth: slot.filler ? slot.horizontal : slot.place.fillW
    Layout.fillHeight: slot.filler ? !slot.horizontal : slot.place.fillH
    Layout.preferredWidth: slot.filler ? 0 : slot.place.prefW >= 0 ? slot.place.prefW * slot.dp : -1
    Layout.preferredHeight: slot.filler ? 0 : slot.place.prefH >= 0 ? slot.place.prefH * slot.dp : -1
    Layout.minimumWidth: slot.place.prefW >= 0 && !slot.place.fillW ? slot.place.prefW * slot.dp : 0
    Layout.minimumHeight: slot.place.prefH >= 0 && !slot.place.fillH ? slot.place.prefH * slot.dp : 0
    Layout.alignment: slot.owner ? slot.owner.alignmentFor(slot.parentKind) : Qt.AlignLeft | Qt.AlignTop
    // From the node's own `visible:`, never from slot.item.visible: an item's
    // visible is also false while an ancestor is hidden, so copying it would
    // hide the slot for good the first time the board hid its grid.
    visible: slot.filler || !slot.child || !slot.child.p
      || slot.child.p.visible === undefined || slot.child.p.visible === null || slot.child.p.visible === true

    source: slot.child ? Qt.resolvedUrl("OwlNode.qml") : ""
    onLoaded: {
      slot.item.widget = Qt.binding(function() { return slot.owner ? slot.owner.widget : null })
      slot.item.node = Qt.binding(function() { return slot.child })
    }
  }

  // Where a Box puts a child along one axis, given the space it leaves:
  // topStart, top, topEnd, start, center, end, bottomStart, bottom, bottomEnd.
  function boxOffset(align, horizontal, room) {
    var a = String(align || "topStart")
    if (horizontal) {
      if (a === "end" || /End$/.test(a)) return room
      if (a === "start" || /Start$/.test(a)) return 0
      return room / 2
    }
    if (/^top/.test(a)) return 0
    if (/^bottom/.test(a)) return room
    return room / 2
  }

  function alignmentFor(parentKind) {
    var a = root.p.align
    if (parentKind === "Row")
      return a === "top" || a === "start" ? Qt.AlignTop : a === "bottom" || a === "end" ? Qt.AlignBottom : Qt.AlignVCenter
    if (parentKind === "Column")
      return a === "center" ? Qt.AlignHCenter : a === "end" ? Qt.AlignRight : Qt.AlignLeft
    return Qt.AlignLeft | Qt.AlignTop
  }


  // Row and Column, laid out as Compose does it rather than by
  // QtQuick.Layouts, whose stretch factors do not share space by weight:
  // the unweighted children first, in order, each given what is left (a
  // child that fills -- an unsized Text -- takes all of it); then the
  // weighted ones share the rest by weight; then justify and align place
  // them. Widths and heights are separate bindings, so a Text that wraps
  // taller as it gets narrower does not feed back into its own width.
  component Linear: Item {
    id: lin
    required property Item owner
    property bool horizontal: false
    readonly property real dp: lin.owner.dp
    readonly property var kids: lin.owner.children_
    readonly property var p: lin.owner.p
    readonly property real gap: L.num(lin.p.gap, lin.horizontal ? 8 : 4) * lin.dp
    readonly property var places: lin.kids.map(function(c) { return L.place(c, lin.horizontal ? "Row" : "Column") })
    readonly property var none: ({ fillW: false, fillH: false, prefW: -1, prefH: -1, stretchW: -1, stretchH: -1 })
    // A list that changed length is read here before `places` catches up.
    function placeOf(i) { return lin.places[i] || lin.none }

    function shown(i) {
      var c = lin.kids[i]
      var v = c && c.p ? c.p.visible : undefined
      return v === undefined || v === null || v === true
    }
    function natural(i, mainAxis) {
      var it = rep.itemAt(i)
      var pl = lin.placeOf(i)
      if (lin.horizontal === mainAxis) return pl.prefW >= 0 ? pl.prefW * lin.dp : it ? it.implicitWidth : 0
      return pl.prefH >= 0 ? pl.prefH * lin.dp : it ? it.implicitHeight : 0
    }
    function weightOf(i) {
      var pl = lin.placeOf(i)
      return Math.max(lin.horizontal ? pl.stretchW : pl.stretchH, 0) / 100
    }

    // Across the axis: a Row's heights or a Column's widths.
    readonly property var cross: {
      void rep.count
      var room = lin.horizontal ? lin.height : lin.width
      var out = []
      for (var i = 0; i < lin.kids.length; i++) {
        var pl = lin.placeOf(i)
        var fill = lin.horizontal ? pl.fillH : pl.fillW
        var own = lin.horizontal ? pl.prefH : pl.prefW
        out.push(!lin.shown(i) ? 0 : own >= 0 ? own * lin.dp : fill ? room : Math.min(lin.natural(i, false), room))
      }
      return out
    }

    // Along it, in measure order.
    readonly property var main: {
      void rep.count
      var room = (lin.horizontal ? lin.width : lin.height)
      var n = 0
      for (var k = 0; k < lin.kids.length; k++) if (lin.shown(k)) n++
      var left = room - lin.gap * Math.max(n - 1, 0)
      var out = [], total = 0
      for (var i = 0; i < lin.kids.length; i++) {
        out.push(0)
        if (!lin.shown(i)) continue
        var w = lin.weightOf(i)
        if (w > 0) { total += w; continue }
        var pl = lin.placeOf(i)
        var fill = lin.horizontal ? pl.fillW : pl.fillH
        var own = lin.horizontal ? pl.prefW : pl.prefH
        var size = own >= 0 ? own * lin.dp : fill ? Math.max(left, 0) : Math.min(lin.natural(i, true), Math.max(left, 0))
        out[i] = size
        left -= size
      }
      for (var j = 0; j < lin.kids.length; j++)
        if (lin.shown(j) && lin.weightOf(j) > 0) out[j] = Math.max(left, 0) * lin.weightOf(j) / total
      return out
    }

    // Where each goes along the axis: justify, when nothing is weighted.
    readonly property var offsets: {
      var room = lin.horizontal ? lin.width : lin.height
      var n = 0, used = 0, weighted = false
      for (var i = 0; i < lin.kids.length; i++) {
        if (!lin.shown(i)) continue
        n++
        used += lin.main[i]
        if (lin.weightOf(i) > 0) weighted = true
      }
      var j = weighted ? "start" : String(lin.p.justify || "start")
      var free = Math.max(room - used - (j.indexOf("space") === 0 ? 0 : lin.gap * Math.max(n - 1, 0)), 0)
      var at = j === "end" ? free : j === "center" ? free / 2 : j === "spaceAround" ? free / n / 2 : j === "spaceEvenly" ? free / (n + 1) : 0
      var step = j === "spaceBetween" ? (n > 1 ? free / (n - 1) : 0) : j === "spaceAround" ? free / n : j === "spaceEvenly" ? free / (n + 1) : lin.gap
      var out = []
      for (var k = 0; k < lin.kids.length; k++) {
        out.push(at)
        if (lin.shown(k)) at += lin.main[k] + step
      }
      return out
    }

    function crossOffset(i) {
      var room = lin.horizontal ? lin.height : lin.width
      var size = lin.cross[i] || 0
      var a = lin.p.align
      if (lin.horizontal)
        return a === "top" || a === "start" ? 0 : a === "bottom" || a === "end" ? room - size : (room - size) / 2
      return a === "center" ? (room - size) / 2 : a === "end" ? room - size : 0
    }

    implicitWidth: {
      void rep.count
      var sum = 0, max = 0, n = 0
      for (var i = 0; i < lin.kids.length; i++) {
        if (!lin.shown(i)) continue
        n++
        var w = lin.horizontal && lin.weightOf(i) > 0 ? 0 : lin.natural(i, lin.horizontal)
        if (lin.horizontal) sum += w
        else max = Math.max(max, lin.natural(i, false))
      }
      return lin.horizontal ? sum + lin.gap * Math.max(n - 1, 0) : max
    }
    implicitHeight: {
      void rep.count
      var sum = 0, max = 0, n = 0
      for (var i = 0; i < lin.kids.length; i++) {
        if (!lin.shown(i)) continue
        n++
        if (lin.horizontal) {
          var it = rep.itemAt(i)
          var pl = lin.placeOf(i)
          max = Math.max(max, pl.prefH >= 0 ? pl.prefH * lin.dp : it ? it.implicitHeight : 0)
        } else sum += lin.weightOf(i) > 0 ? 0 : lin.natural(i, true)
      }
      return lin.horizontal ? max : sum + lin.gap * Math.max(n - 1, 0)
    }

    Repeater {
      id: rep
      model: lin.kids.length
      delegate: Loader {
        id: cell
        required property int index
        readonly property var child: lin.kids[cell.index] || null
        visible: lin.shown(cell.index)
        x: lin.horizontal ? (lin.offsets[cell.index] || 0) : lin.crossOffset(cell.index)
        y: lin.horizontal ? lin.crossOffset(cell.index) : (lin.offsets[cell.index] || 0)
        width: lin.horizontal ? (lin.main[cell.index] || 0) : (lin.cross[cell.index] || 0)
        height: lin.horizontal ? (lin.cross[cell.index] || 0) : (lin.main[cell.index] || 0)
        source: cell.child ? Qt.resolvedUrl("OwlNode.qml") : ""
        onLoaded: {
          cell.item.widget = Qt.binding(function() { return lin.owner.widget })
          cell.item.node = Qt.binding(function() { return cell.child })
        }
      }
    }
  }

  Component {
    id: columnC
    Linear { owner: root; horizontal: false }
  }

  Component {
    id: scrollColumnC
    Flickable {
      implicitWidth: inner.implicitWidth
      implicitHeight: inner.implicitHeight
      contentWidth: width
      contentHeight: inner.implicitHeight
      clip: true
      boundsBehavior: Flickable.StopAtBounds
      Linear {
        id: inner
        owner: root
        horizontal: false
        width: parent.width
        height: inner.implicitHeight
      }
    }
  }

  Component {
    id: rowC
    Linear { owner: root; horizontal: true }
  }

  Component {
    id: gridC
    GridLayout {
      columns: Math.max(1, Math.round(L.num(root.p.columns, 2)))
      columnSpacing: L.num(root.p.gap, 6) * root.dp
      rowSpacing: L.num(root.p.gap, 6) * root.dp
      uniformCellWidths: true
      Repeater {
        model: root.children_.length
        delegate: Slot { owner: root; parentKind: "Grid" }
      }
    }
  }

  Component {
    id: flowC
    Flow {
      spacing: L.num(root.p.gap, 8) * root.dp
      Repeater {
        model: root.children_.length
        delegate: Loader {
          id: flowSlot
          required property int index
          readonly property var child: root.children_[flowSlot.index]
          source: flowSlot.child ? Qt.resolvedUrl("OwlNode.qml") : ""
          onLoaded: {
            flowSlot.item.widget = Qt.binding(function() { return root.widget })
            flowSlot.item.node = Qt.binding(function() { return flowSlot.child })
          }
        }
      }
    }
  }

  Component {
    id: boxC
    Item {
      id: boxItem
      implicitWidth: { var w = 0; for (var i = 0; i < boxRepeater.count; i++) { var it = boxRepeater.itemAt(i); if (it) w = Math.max(w, it.implicitWidth) } return w }
      implicitHeight: { var h = 0; for (var i = 0; i < boxRepeater.count; i++) { var it = boxRepeater.itemAt(i); if (it) h = Math.max(h, it.implicitHeight) } return h }
      Repeater {
        id: boxRepeater
        model: root.children_.length
        delegate: Loader {
          id: boxSlot
          required property int index
          readonly property var child: root.children_[boxSlot.index]
          // A component used with weight: or padding: is wrapped in a Box
          // that only carries those; what it wraps fills it.
          readonly property var place: root.node && root.node.wrapper
            ? { fillW: true, fillH: true } : L.place(boxSlot.child, "Box")
          readonly property string align: root.p.align || "topStart"
          width: boxSlot.place.fillW ? boxItem.width : Math.min(boxSlot.implicitWidth, boxItem.width)
          height: boxSlot.place.fillH ? boxItem.height : Math.min(boxSlot.implicitHeight, boxItem.height)
          x: root.boxOffset(boxSlot.align, true, boxItem.width - boxSlot.width)
          y: root.boxOffset(boxSlot.align, false, boxItem.height - boxSlot.height)
          source: boxSlot.child ? Qt.resolvedUrl("OwlNode.qml") : ""
          onLoaded: {
            boxSlot.item.widget = Qt.binding(function() { return root.widget })
            boxSlot.item.node = Qt.binding(function() { return boxSlot.child })
          }
        }
      }
    }
  }

  // --------------------------------------------------------------- leaves

  readonly property var textStyle: L.style(root.p.style)
  function family(f) {
    if (!root.widget) return ""
    return f === "sans" ? root.widget.sansFamily : f === "serif" ? "serif"
      : f === "icon" ? root.widget.iconFamily : root.widget.monoFamily
  }

  Component {
    id: textC
    // Sized as the launcher's lines are: Android's system monospace spaces
    // lines about 1.17 em apart against this font's 1.32, and a Qt Text keeps
    // its font's own height on a single line whatever lineHeight says. So the
    // box is lines x 1.17 em, and the glyphs sit centred in each line.
    Item {
      id: textBox
      readonly property real line: label.font.pixelSize * 1.17
      implicitWidth: label.implicitWidth
      implicitHeight: Math.max(1, label.lineCount) * textBox.line
      Text {
        id: label
        width: parent.width
        anchors.verticalCenter: parent.verticalCenter
        text: root.p.text === undefined || root.p.text === null ? "\u2026" : String(root.p.text)
        color: root.p.color || (root.widget ? root.widget.ink(root.textStyle[1] ? "muted" : "foreground") : "white")
        font.pixelSize: Math.max(1, L.num(root.p.fontSize, root.textStyle[0]) * root.dp)
        font.weight: root.p.bold === true ? Font.Bold : Font.Normal
        font.italic: root.p.italic === true
        font.family: root.family(root.p.font)
        lineHeightMode: Text.FixedHeight
        lineHeight: textBox.line
        horizontalAlignment: root.p.align === "center" ? Text.AlignHCenter
          : root.p.align === "end" ? Text.AlignRight : Text.AlignLeft
        wrapMode: L.maxLines(root.p) === 1 ? Text.NoWrap : Text.Wrap
        maximumLineCount: L.maxLines(root.p) > 0 ? L.maxLines(root.p) : 100000
        elide: L.maxLines(root.p) > 0 ? Text.ElideRight : Text.ElideNone
        Behavior on color {
          enabled: !!root.anim.color
          ColorAnimation { duration: root.ms(root.anim.color) }
        }
      }
    }
  }

  Component {
    id: buttonC
    Item {
      implicitWidth: label.implicitWidth + 20 * root.dp
      implicitHeight: label.implicitHeight + 12 * root.dp
      Rectangle {
        anchors.fill: parent
        // The launcher's corners follow its style, and Omarchy's is square.
        radius: L.num(root.p.radius, 0) * root.dp
        color: "transparent"
        border.width: Math.max(1, root.dp)
        border.color: label.color
      }
      Text {
        id: label
        anchors.centerIn: parent
        text: root.p.text === undefined || root.p.text === null ? "…" : String(root.p.text)
        color: root.p.color || (root.widget ? root.widget.ink("accent") : "white")
        font.pixelSize: 13 * root.dp
        font.family: root.family("mono")
      }
    }
  }

  readonly property real progressValue: Math.max(0, Math.min(1, L.num(root.p.value, 0) / Math.max(L.num(root.p.max, root.kind === "Ring" ? 1 : 100), 1e-9)))
  property real shownValue: root.progressValue
  Behavior on shownValue {
    enabled: !!root.anim.value
    NumberAnimation { duration: root.ms(root.anim.value); easing.type: root.easing(root.anim.value) }
  }

  Component {
    id: progressC
    Item {
      implicitWidth: 60 * root.dp
      implicitHeight: 8 * root.dp
      Rectangle {
        anchors.fill: parent
        color: root.p.track || (root.widget ? root.widget.ink("surface") : "grey")
      }
      Rectangle {
        width: parent.width * root.shownValue
        height: parent.height
        color: root.p.color || (root.widget ? root.widget.ink("accent") : "white")
      }
    }
  }

  Component {
    id: ringC
    Canvas {
      implicitWidth: 64 * root.dp
      implicitHeight: 64 * root.dp
      readonly property var deps: [root.shownValue, root.p.color, root.p.track, root.p.thickness, root.p.start, root.p.sweep, width, height]
      onDepsChanged: requestPaint()
      onPaint: {
        var ctx = getContext("2d")
        ctx.reset()
        var t = L.num(root.p.thickness, 6) * root.dp
        var r = Math.min(width, height) / 2 - t / 2
        var start = L.num(root.p.start, 0), sweep = L.num(root.p.sweep, 360)
        var a0 = (start - 90) * Math.PI / 180
        ctx.lineWidth = t
        ctx.lineCap = "round"
        ctx.strokeStyle = root.p.track || (root.widget ? root.widget.ink("surface") : "grey")
        ctx.beginPath()
        ctx.arc(width / 2, height / 2, r, a0, a0 + sweep * Math.PI / 180, false)
        ctx.stroke()
        if (root.shownValue > 0) {
          ctx.strokeStyle = root.p.color || (root.widget ? root.widget.ink("accent") : "white")
          ctx.beginPath()
          ctx.arc(width / 2, height / 2, r, a0, a0 + sweep * root.shownValue * Math.PI / 180, false)
          ctx.stroke()
        }
      }
    }
  }

  Component {
    id: sparklineC
    Canvas {
      implicitWidth: 80 * root.dp
      implicitHeight: 48 * root.dp
      readonly property var deps: [root.p.values, root.p.min, root.p.max, root.p.color, root.p.area, root.p.thickness, width, height]
      onDepsChanged: requestPaint()
      onPaint: {
        var ctx = getContext("2d")
        ctx.reset()
        var values = Array.isArray(root.p.values) ? root.p.values : []
        var pts = []
        var lo = L.num(root.p.min, 0)
        var hi = root.p.max
        if (typeof hi !== "number") {
          // Auto-scaled lines get headroom so the peak is not glued to the top.
          var peak = -Infinity
          values.forEach(function(v) { if (typeof v === "number") peak = Math.max(peak, v) })
          hi = Math.max(lo + (peak - lo) * 1.15, lo + 1)
        }
        if (!isFinite(hi) || hi <= lo) hi = lo + 1
        var n = values.length
        for (var i = 0; i < n; i++) {
          if (typeof values[i] !== "number") continue
          pts.push([n > 1 ? i / (n - 1) * width : width / 2, height - (values[i] - lo) / (hi - lo) * height])
        }
        if (pts.length < 2) return
        var line = root.p.color || (root.widget ? root.widget.ink("accent") : "white")
        var t = L.num(root.p.thickness, 2) * root.dp
        if (root.p.area) {
          ctx.beginPath()
          ctx.moveTo(pts[0][0], height)
          pts.forEach(function(q) { ctx.lineTo(q[0], q[1]) })
          ctx.lineTo(pts[pts.length - 1][0], height)
          ctx.closePath()
          ctx.fillStyle = typeof root.p.area === "string" ? root.p.area : (root.widget ? root.widget.alpha(line, 0.2) : line)
          ctx.fill()
        }
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        pts.forEach(function(q) { ctx.lineTo(q[0], q[1]) })
        ctx.lineWidth = t
        ctx.lineJoin = "round"
        ctx.lineCap = "round"
        ctx.strokeStyle = line
        ctx.stroke()
      }
    }
  }

  Component {
    id: imageC
    Item {
      implicitWidth: img.status === Image.Ready ? img.implicitWidth : 0
      // Taller as it gets wider, at the picture's own aspect, so a full-width
      // image in a Column is not squashed into its file's pixel height.
      implicitHeight: img.status === Image.Ready && img.implicitWidth > 0
        ? (width > 0 ? width : img.implicitWidth) * img.implicitHeight / img.implicitWidth : 0
      Image {
        id: img
        anchors.fill: parent
        source: L.url(root.p.src, root.widget ? root.widget.home : "")
        asynchronous: true
        smooth: true
        mipmap: true
        fillMode: root.p.fit === "cover" ? Image.PreserveAspectCrop
          : root.p.fit === "fill" ? Image.Stretch : Image.PreserveAspectFit
        visible: !root.p.tint
      }
      MultiEffect {
        anchors.fill: img
        source: img
        visible: !!root.p.tint
        colorization: 1
        colorizationColor: root.p.tint || "white"
      }
    }
  }

  Component {
    id: canvasC
    OwlCanvas {
      node: root.node
      widget: root.widget
    }
  }

  // AGSL does not run here: Qt wants its shaders compiled ahead of time, and
  // the language allows for this -- older Android phones show `fallback` too.
  Component {
    id: shaderC
    Rectangle {
      color: root.p.fallback || (root.widget ? root.widget.ink("surface") : "transparent")
    }
  }

  Component {
    id: terminalC
    OwlTerminal {
      node: root.node
      widget: root.widget
    }
  }

  Component {
    id: sliderC
    Item {
      id: sliderItem
      implicitWidth: 120 * root.dp
      implicitHeight: 28 * root.dp
      readonly property real lo: L.num(root.p.min, 0)
      readonly property real hi: Math.max(L.num(root.p.max, 100), lo + 1e-9)
      property real dragged: NaN
      readonly property real value: isNaN(dragged) ? L.num(root.p.value, lo) : dragged
      readonly property real fraction: Math.max(0, Math.min(1, (value - lo) / (hi - lo)))
      function at(x) {
        var v = lo + Math.max(0, Math.min(1, x / width)) * (hi - lo)
        var step = L.num(root.p.step, 0)
        if (step > 0) v = lo + Math.round((v - lo) / step) * step
        return Math.max(lo, Math.min(hi, v))
      }
      Rectangle {
        anchors.verticalCenter: parent.verticalCenter
        width: parent.width
        height: 4 * root.dp
        radius: height / 2
        color: root.p.track || (root.widget ? root.widget.alpha(root.widget.ink("foreground"), 0.15) : "grey")
      }
      Rectangle {
        anchors.verticalCenter: parent.verticalCenter
        width: parent.width * sliderItem.fraction
        height: 4 * root.dp
        radius: height / 2
        color: root.p.color || (root.widget ? root.widget.ink("accent") : "white")
      }
      Rectangle {
        x: parent.width * sliderItem.fraction - width / 2
        anchors.verticalCenter: parent.verticalCenter
        width: 16 * root.dp
        height: width
        radius: width / 2
        color: root.p.color || (root.widget ? root.widget.ink("accent") : "white")
      }
      MouseArea {
        anchors.fill: parent
        preventStealing: true
        onPressed: (mouse) => { sliderItem.dragged = sliderItem.at(mouse.x); if (root.p.live === true && root.handlers.onChange) root.handlers.onChange(sliderItem.dragged) }
        onPositionChanged: (mouse) => { sliderItem.dragged = sliderItem.at(mouse.x); if (root.p.live === true && root.handlers.onChange) root.handlers.onChange(sliderItem.dragged) }
        onReleased: {
          var v = sliderItem.dragged
          if (root.handlers.onChange) root.handlers.onChange(v)
          sliderItem.dragged = NaN
        }
      }
    }
  }

  Component {
    id: inputC
    Rectangle {
      implicitWidth: 120 * root.dp
      implicitHeight: field.implicitHeight + 12 * root.dp
      radius: 6 * root.dp
      color: "transparent"
      border.width: Math.max(1, root.dp)
      border.color: root.widget ? root.widget.alpha(root.widget.ink("foreground"), field.activeFocus ? 0.5 : 0.2) : "grey"
      TextInput {
        id: field
        anchors.fill: parent
        anchors.margins: 6 * root.dp
        verticalAlignment: TextInput.AlignVCenter
        color: root.p.color || (root.widget ? root.widget.ink("foreground") : "white")
        font.pixelSize: L.num(root.p.fontSize, 14) * root.dp
        font.family: root.family("sans")
        clip: true
        text: root.p.text === undefined || root.p.text === null || root.p.text === "…" ? "" : String(root.p.text)
        onTextEdited: if (root.handlers.onChange) root.handlers.onChange(field.text)
        Component.onCompleted: if (root.p.focus === true) forceActiveFocus()
        onAccepted: {
          if (root.handlers.onSubmit) root.handlers.onSubmit(field.text)
          if (root.p.clear === true) field.text = ""
        }
        Text {
          anchors.fill: parent
          verticalAlignment: Text.AlignVCenter
          visible: field.text === ""
          text: root.p.placeholder || ""
          color: root.widget ? root.widget.ink("muted") : "grey"
          font: field.font
        }
      }
    }
  }
}
