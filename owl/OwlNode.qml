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
  // Whether the node it's in hands it a hug: a Row's, or a hugging Column's (OwlLayout.hugFor).
  property bool hugged: false

  readonly property var p: root.node && root.node.p ? root.node.p : ({})
  readonly property var anim: root.node && root.node.a ? root.node.a : ({})
  readonly property var handlers: root.node && root.node.h ? root.node.h : ({})
  readonly property string kind: root.node ? String(root.node.kind) : ""
  readonly property var children_: L.ordered(root.node)
  // A lazy Column or Grid scrolls (owl 11); this runtime builds all of it, as the launcher does where it can't measure one.
  readonly property bool scrolls: root.p.scroll === true || root.p.lazy === true
  // Listed from its end, it sits at the bottom and starts there, as search results above a bar do.
  readonly property bool fromEnd: root.p.lazy === true && root.p.reverse === true
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
    // animate offset (owl 13): while the node's own onDrag has the finger the offset follows it as it is; let go,
    // it eases to where onDragEnd puts it.
    Behavior on x {
      enabled: !!root.anim.offset && !dragger.active
      NumberAnimation { duration: root.ms(root.anim.offset); easing.type: root.easing(root.anim.offset) }
    }
    Behavior on y {
      enabled: !!root.anim.offset && !dragger.active
      NumberAnimation { duration: root.ms(root.anim.offset); easing.type: root.easing(root.anim.offset) }
    }
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
  // Since owl 10 a background can be a gradient, drawn behind the node; an animated one stays a color.
  readonly property var backgroundGradient: root.background && root.background.gradient && root.node
    && root.node.level >= 10 && !root.anim.background ? root.background.gradient : null
  readonly property string backgroundColor: typeof root.background === "string" ? root.background
    : root.background && root.background.gradient && !root.backgroundGradient ? (root.background.gradient.colors[0] || "transparent")
    : "transparent"

  // frost (owl 10) blurs the launcher's wallpaper behind a node; this shell has none behind its
  // widgets, so as where the launcher has no wallpaper, only the background shows.
  Canvas {
    anchors.fill: parent
    visible: !!root.backgroundGradient
    readonly property var deps: [root.backgroundGradient, width, height, root.p.radius]
    onDepsChanged: requestPaint()
    onPaint: {
      var ctx = getContext("2d")
      ctx.reset()
      var g = root.backgroundGradient
      if (!g || width <= 0 || height <= 0) return
      ctx.fillStyle = L.backgroundGradient(ctx, g, width, height)
      ctx.beginPath()
      L.roundRect(ctx, 0, 0, width, height, L.num(root.p.radius, 0) * root.dp)
      ctx.fill()
    }
  }

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
      case "Column": return root.scrolls ? scrollColumnC : columnC
      case "Row": return root.p.wrap === true ? flowC : rowC
      case "Flow": return flowC
      case "Box": return boxC
      case "Grid": return root.p.lazy === true ? scrollGridC : gridC
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
      case "Popup": return popupC
      default: return null
      }
    }
  }

  // ------------------------------------------------------------- input

  // Exclusive on press, so a tap lands on the innermost node that wants it
  // and not on every tile around it. A drag past the threshold still goes to
  // whatever drags -- a Flickable, the drawer gesture under Home.
  // One handler for both, so a long press (owl 10) isn't also a tap.
  TapHandler {
    enabled: !!root.handlers.onTap || !!root.handlers.onLongPress
    gesturePolicy: TapHandler.ReleaseWithinBounds
    onTapped: (point) => { if (root.handlers.onTap) root.handlers.onTap(point.position.x / root.dp, point.position.y / root.dp) }
    onLongPressed: if (root.handlers.onLongPress) root.handlers.onLongPress(point.position.x / root.dp, point.position.y / root.dp)
  }

  // drag: horizontal or vertical (owl 13) takes moves along it alone, so a list it's in still scrolls the other
  // way; onDragEnd gets how fast the finger was going as it let go, in dp a second.
  DragHandler {
    id: dragger
    enabled: !!root.handlers.onDrag
    target: null
    xAxis.enabled: root.p.drag !== "vertical"
    yAxis.enabled: root.p.drag !== "horizontal"
    property point last: Qt.point(0, 0)
    property vector2d speed: Qt.vector2d(0, 0)
    onActiveChanged: {
      if (active) {
        last = Qt.point(0, 0)
        speed = Qt.vector2d(0, 0)
      } else if (root.handlers.onDragEnd) {
        root.handlers.onDragEnd(xAxis.enabled ? speed.x / root.dp : 0, yAxis.enabled ? speed.y / root.dp : 0)
      }
    }
    onTranslationChanged: {
      var dx = xAxis.enabled ? (translation.x - last.x) / root.dp : 0
      var dy = yAxis.enabled ? (translation.y - last.y) / root.dp : 0
      last = Qt.point(translation.x, translation.y)
      speed = centroid.velocity
      root.handlers.onDrag(dx, dy, centroid.position.x / root.dp, centroid.position.y / root.dp)
    }
  }

  // onPress as the finger goes down, before it's a tap, and onRelease when it lifts or a scroll takes it (owl 12).
  // With repeats: true onPress runs again while it stays down, after 400 ms and then every 50 ms.
  PointHandler {
    id: presser
    enabled: !!root.handlers.onPress || !!root.handlers.onRelease
    property int repeat: 0
    onActiveChanged: {
      if (active) {
        repeat = 0
        if (root.handlers.onPress) root.handlers.onPress(point.position.x / root.dp, point.position.y / root.dp, 0)
        if (root.p.repeats === true) repeater.start()
      } else {
        repeater.stop()
        if (root.handlers.onRelease) root.handlers.onRelease()
      }
    }
  }

  Timer {
    id: repeater
    interval: 400
    repeat: true
    onRunningChanged: if (!running) interval = 400
    onTriggered: {
      interval = 50
      presser.repeat++
      if (presser.active && root.handlers.onPress)
        root.handlers.onPress(presser.point.position.x / root.dp, presser.point.position.y / root.dp, presser.repeat)
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
    readonly property string kindHere: lin.horizontal ? "Row" : "Column"
    function hugOf(c) { return L.hugFor(c, lin.kindHere, lin.owner.node, lin.owner.hugged) }
    readonly property var places: lin.kids.map(function(c) { return L.place(c, lin.kindHere, lin.hugOf(c)) })
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
          cell.item.hugged = Qt.binding(function() { return lin.hugOf(cell.child) })
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
      id: flick
      implicitWidth: inner.implicitWidth
      implicitHeight: inner.implicitHeight
      contentWidth: width
      contentHeight: inner.implicitHeight
      clip: true
      boundsBehavior: Flickable.StopAtBounds
      onContentHeightChanged: if (root.fromEnd) flick.contentY = Math.max(0, flick.contentHeight - flick.height)
      onHeightChanged: if (root.fromEnd) flick.contentY = Math.max(0, flick.contentHeight - flick.height)
      Linear {
        id: inner
        owner: root
        horizontal: false
        y: root.fromEnd ? Math.max(0, flick.height - inner.implicitHeight) : 0
        width: parent.width
        height: inner.implicitHeight
      }
    }
  }

  Component {
    id: scrollGridC
    Flickable {
      id: gridFlick
      implicitWidth: lazyGrid.implicitWidth
      implicitHeight: lazyGrid.implicitHeight
      contentWidth: width
      contentHeight: lazyGrid.implicitHeight
      clip: true
      boundsBehavior: Flickable.StopAtBounds
      onContentHeightChanged: if (root.fromEnd) gridFlick.contentY = Math.max(0, gridFlick.contentHeight - gridFlick.height)
      onHeightChanged: if (root.fromEnd) gridFlick.contentY = Math.max(0, gridFlick.contentHeight - gridFlick.height)
      GridLayout {
        id: lazyGrid
        y: root.fromEnd ? Math.max(0, gridFlick.height - lazyGrid.implicitHeight) : 0
        width: parent.width
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
            flowSlot.item.hugged = Qt.binding(function() { return L.hugFor(flowSlot.child, "Flow", root.node, root.hugged) })
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
    return root.widget.fontFamily(f === undefined || f === null ? null : String(f))
  }

  // A font weight, 100 to 900, from fontWeight or bold.
  function weightOf(w, bold) {
    if (typeof w === "number" && isFinite(w)) return Math.max(1, Math.min(1000, Math.round(w)))
    return bold === true ? Font.Bold : Font.Normal
  }

  // spans (owl 10) as rich text: each piece styled on its own, the spaces at its ends kept.
  function spansHtml(pieces) {
    var out = ""
    for (var i = 0; i < pieces.length; i++) {
      var piece = pieces[i] || {}
      var css = []
      if (piece.color) css.push("color:" + L.cssColor(piece.color))
      if (piece.fontWeight !== undefined || piece.bold !== undefined) css.push("font-weight:" + root.weightOf(piece.fontWeight, piece.bold))
      if (piece.italic !== undefined) css.push("font-style:" + (piece.italic ? "italic" : "normal"))
      if (typeof piece.fontSize === "number" && isFinite(piece.fontSize)) css.push("font-size:" + Math.max(1, Math.min(1000, piece.fontSize)) * root.dp + "px")
      if (typeof piece.letterSpacing === "number" && isFinite(piece.letterSpacing)) css.push("letter-spacing:" + Math.max(-1000, Math.min(1000, piece.letterSpacing)) * root.dp + "px")
      if (piece.font) css.push("font-family:'" + root.family(piece.font).replace(/'/g, "") + "'")
      var t = String(piece.text === undefined || piece.text === null ? "" : piece.text)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")
      out += css.length ? "<span style=\"" + css.join(";") + "\">" + t + "</span>" : t
    }
    return "<span style=\"white-space:pre-wrap\">" + out + "</span>"
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
      readonly property bool spanned: Array.isArray(root.p.spans)
      implicitWidth: label.implicitWidth
      implicitHeight: Math.max(L.minLines(root.p), label.lineCount) * textBox.line
      Text {
        id: label
        width: parent.width
        // Centred in the lines it has; a box taller for minLines keeps the text at its top.
        anchors.verticalCenter: parent.top
        anchors.verticalCenterOffset: Math.max(1, label.lineCount) * textBox.line / 2
        textFormat: textBox.spanned ? Text.RichText : Text.PlainText
        text: textBox.spanned ? root.spansHtml(root.p.spans)
          : root.p.text === undefined || root.p.text === null ? "\u2026" : String(root.p.text)
        color: root.p.color || (root.widget ? root.widget.ink(root.textStyle[1] ? "muted" : "foreground") : "white")
        font.pixelSize: Math.max(1, Math.min(1000, L.num(root.p.fontSize, root.textStyle[0])) * root.dp)
        font.weight: root.weightOf(root.p.fontWeight, root.p.bold)
        font.italic: root.p.italic === true
        font.letterSpacing: Math.max(-1000, Math.min(1000, L.num(root.p.letterSpacing, 0))) * root.dp
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
        // What a screen reader says for it (owl 11).
        Accessible.role: Accessible.Graphic
        Accessible.name: root.p.label === undefined || root.p.label === null ? "" : String(root.p.label)
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
      // underline: false (owl 10) leaves the line out, for a field in a frame of its own.
      border.width: root.p.underline === false ? 0 : Math.max(1, root.dp)
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
        // password: true (owl 12): dots for what's typed, and no suggestions that would learn it.
        echoMode: root.p.password === true ? TextInput.Password : TextInput.Normal
        inputMethodHints: root.p.password === true ? Qt.ImhSensitiveData | Qt.ImhNoPredictiveText | Qt.ImhHiddenText : Qt.ImhNone
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

  // Popup (owl 10): its children in a menu over everything else, at the start of
  // the node that holds it, below it or above with position: above, on the other
  // side when there's no room and never off the window. Framed like the launcher's
  // menus unless it has a background or border. It takes no room where it's
  // written; a press outside it or Escape runs onDismiss, which it must have.
  Component {
    id: popupC
    Item {
      id: popup
      implicitWidth: 0
      implicitHeight: 0
      readonly property Item holder: root.parent ? root.parent.parent || root.parent : root
      // The top of the window's items, where the menu goes over everything else.
      readonly property Item windowItem: {
        var it = root
        while (it && it.parent) it = it.parent
        return it === root ? null : it
      }
      readonly property bool shown: root.visible && !!popup.windowItem
      readonly property bool framed: !!root.p.background || L.num(root.p.border, 0) > 0
      function dismiss() { if (root.handlers.onDismiss) root.handlers.onDismiss() }

      Item {
        id: overlay
        parent: popup.windowItem
        visible: popup.shown
        anchors.fill: parent
        z: 10000

        // A press anywhere outside the menu dismisses it.
        MouseArea {
          anchors.fill: parent
          onPressed: popup.dismiss()
        }

        Rectangle {
          id: menu
          focus: popup.shown
          Keys.onEscapePressed: popup.dismiss()
          readonly property real pad: popup.framed ? 0 : 4 * root.dp
          // Where the holder is in the window, followed every frame while the menu shows: mapToItem
          // isn't told when a layout or a Flickable moves it.
          property point at: Qt.point(0, 0)
          FrameAnimation {
            running: popup.shown
            onTriggered: {
              var p = popup.holder.mapToItem(overlay, 0, 0)
              if (p.x !== menu.at.x || p.y !== menu.at.y) menu.at = p
            }
          }
          readonly property real down: menu.at.y + popup.holder.height
          readonly property real up: menu.at.y - menu.height
          width: menuColumn.implicitWidth + 2 * menu.pad
          height: menuColumn.implicitHeight + 2 * menu.pad
          x: Math.max(0, Math.min(menu.at.x, overlay.width - menu.width))
          y: {
            var above = root.p.position === "above"
            var y = above ? (menu.up >= 0 || menu.down + menu.height > overlay.height ? menu.up : menu.down)
              : (menu.down + menu.height <= overlay.height || menu.up < 0 ? menu.down : menu.up)
            return Math.max(0, Math.min(y, overlay.height - menu.height))
          }
          color: popup.framed ? "transparent" : (root.widget ? root.widget.ink("background") : "black")
          border.width: popup.framed ? 0 : 2 * root.dp
          border.color: root.widget ? root.widget.ink("accent") : "white"
          // Presses on the menu stay on it.
          MouseArea { anchors.fill: parent }

          Column {
            id: menuColumn
            x: menu.pad
            y: menu.pad
            spacing: L.num(root.p.gap, 4) * root.dp
            Repeater {
              model: root.children_.length
              delegate: Loader {
                id: item
                required property int index
                readonly property var child: root.children_[item.index]
                x: root.p.align === "center" ? (menuColumn.width - width) / 2 : root.p.align === "end" ? menuColumn.width - width : 0
                source: item.child ? Qt.resolvedUrl("OwlNode.qml") : ""
                onLoaded: {
                  item.item.widget = Qt.binding(function() { return root.widget })
                  item.item.node = Qt.binding(function() { return item.child })
                }
              }
            }
          }
        }
      }
    }
  }
}
