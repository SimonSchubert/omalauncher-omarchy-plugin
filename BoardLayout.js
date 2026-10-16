.pragma library

// Where each widget sits on the board: pure functions over a map of
//
//   { "<file, relative to the widget folder>": { x, y, w, h, hidden? } }
//
// in grid cells. Nothing here touches QML, so test/layout.test.mjs runs it
// under node. Every function returns a new map, or null when the change does
// not fit: two tiles never overlap, and a tile never leaves the grid.

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function valid(c, columns) {
  return !!c && [c.x, c.y, c.w, c.h].every(function (n) { return typeof n === "number" && Math.floor(n) === n })
    && c.x >= 0 && c.y >= 0 && c.w >= 1 && c.h >= 1 && c.x + c.w <= columns
}

function copy(cells) {
  var out = {}
  for (var k in cells) out[k] = Object.assign({}, cells[k])
  return out
}

// Is `cell` clear of every shown tile but `self`? Only files on the board now
// count: a file that went away leaves its place behind, but not in the way.
function clear(cells, cell, self, present) {
  for (var k in cells) {
    if (k === self || cells[k].hidden) continue
    if (present && present.indexOf(k) < 0) continue
    if (overlaps(cell, cells[k])) return false
  }
  return true
}

// The first free place for a w x h tile, top row first, left to right: the
// launcher's own rule for a new widget.
function firstFit(cells, w, h, columns, self, present) {
  w = Math.min(w, columns)
  for (var y = 0; y < 1000; y++)
    for (var x = 0; x + w <= columns; x++) {
      var c = { x: x, y: y, w: w, h: h }
      if (clear(cells, c, self, present)) return c
    }
  return null
}

// Gives every file a place. `files` are the widgets in the folder, in order;
// `sizes` maps the ones compiled so far to { size: [w, h] }. A file is placed
// only once its size is known, so the board never saves a guess. A tile that
// no longer fits the grid -- the board got narrower -- moves to the first
// free place. Returns { cells, changed }.
function settle(cells, files, sizes, columns) {
  var out = copy(cells || {}), changed = false
  var placed = files.filter(function (f) { return out[f] && !out[f].hidden && valid(out[f], columns) })
  for (var i = 0; i < files.length; i++) {
    var f = files[i], c = out[f]
    if (c && (c.hidden || valid(c, columns))) continue
    var s = sizes[f]
    if (!s) continue
    var w = c ? c.w : s.size[0], h = c ? c.h : s.size[1]
    var at = firstFit(out, w, h, columns, f, placed)
    if (!at) continue
    out[f] = at
    placed.push(f)
    changed = true
  }
  return { cells: out, changed: changed }
}

function move(cells, file, x, y, columns, present) {
  var c = cells[file]
  if (!c) return null
  var next = { x: x, y: y, w: c.w, h: c.h }
  if (!valid(next, columns) || !clear(cells, next, file, present)) return null
  var out = copy(cells)
  out[file] = next
  return out
}

// `min` is the widget's minSize: it never shrinks below what its layout fits.
function resize(cells, file, w, h, min, columns, present) {
  var c = cells[file]
  if (!c) return null
  var next = { x: c.x, y: c.y, w: Math.max(w, min[0]), h: Math.max(h, min[1]) }
  if (!valid(next, columns) || !clear(cells, next, file, present)) return null
  var out = copy(cells)
  out[file] = next
  return out
}

// The cell an edge drag makes, as on the phone: `edges` is which sides move
// ({left, top, right, bottom}), `dx` and `dy` how far in cells. The opposite
// side stays put; the tile keeps the widget's minSize and stays on the grid.
function edge(c, edges, dx, dy, min, columns) {
  var l = c.x, t = c.y, r = c.x + c.w, b = c.y + c.h
  if (edges.left) l = Math.max(0, Math.min(l + dx, r - min[0]))
  if (edges.right) r = Math.min(columns, Math.max(r + dx, l + min[0]))
  if (edges.top) t = Math.max(0, Math.min(t + dy, b - min[1]))
  if (edges.bottom) b = Math.max(b + dy, t + min[1])
  return { x: l, y: t, w: r - l, h: b - t }
}

// `file` at `next`, when that is on the grid and clear of the other tiles.
function place(cells, file, next, columns, present) {
  if (!cells[file] || !valid(next, columns) || !clear(cells, next, file, present)) return null
  var out = copy(cells)
  out[file] = { x: next.x, y: next.y, w: next.w, h: next.h }
  return out
}

function hide(cells, file) {
  if (!cells[file]) return null
  var out = copy(cells)
  out[file].hidden = true
  return out
}

// Back on the board at its own size, in the first place it fits.
function show(cells, file, size, columns, present) {
  var at = firstFit(cells, size[0], size[1], columns, file, present)
  if (!at) return null
  var out = copy(cells)
  out[file] = at
  return out
}

// How many rows the shown tiles take.
function rows(cells, present) {
  var n = 0
  for (var k in cells) {
    if (cells[k].hidden || (present && present.indexOf(k) < 0)) continue
    n = Math.max(n, cells[k].y + cells[k].h)
  }
  return n
}
