// node test/layout.test.mjs -- BoardLayout.js, which is QML's `.pragma
// library` JavaScript, loaded here as a plain script.

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const source = readFileSync(new URL("../BoardLayout.js", import.meta.url), "utf8").replace(/^\.pragma library\s*/, "")
const L = new Function(source + "\nreturn { overlaps, valid, settle, move, resize, hide, show, rows, firstFit, edge, place }")()

const sizes = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { size: v }]))

test("settle places new widgets first-fit, in order", () => {
  const r = L.settle({}, ["a.owl", "b.owl", "c.owl"], sizes({ "a.owl": [6, 2], "b.owl": [3, 2], "c.owl": [4, 1] }), 12)
  assert.ok(r.changed)
  assert.deepEqual(r.cells["a.owl"], { x: 0, y: 0, w: 6, h: 2 })
  assert.deepEqual(r.cells["b.owl"], { x: 6, y: 0, w: 3, h: 2 })
  assert.deepEqual(r.cells["c.owl"], { x: 0, y: 2, w: 4, h: 1 })
})

test("settle waits for a widget's size and keeps saved places", () => {
  const saved = { "b.owl": { x: 0, y: 0, w: 3, h: 2 } }
  const r = L.settle(saved, ["a.owl", "b.owl"], {}, 12)
  assert.equal(r.changed, false)
  assert.equal(r.cells["a.owl"], undefined)
  const r2 = L.settle(saved, ["a.owl", "b.owl"], sizes({ "a.owl": [3, 2] }), 12)
  assert.deepEqual(r2.cells["a.owl"], { x: 3, y: 0, w: 3, h: 2 })
  assert.deepEqual(r2.cells["b.owl"], saved["b.owl"])
})

test("settle moves a tile that no longer fits a narrower grid", () => {
  const saved = { "a.owl": { x: 10, y: 0, w: 2, h: 2 }, "b.owl": { x: 0, y: 0, w: 3, h: 2 } }
  const r = L.settle(saved, ["a.owl", "b.owl"], sizes({ "a.owl": [2, 2], "b.owl": [3, 2] }), 6)
  assert.deepEqual(r.cells["a.owl"], { x: 3, y: 0, w: 2, h: 2 })
})

test("hidden tiles stay off the board and out of the way", () => {
  const saved = { "a.owl": { x: 0, y: 0, w: 3, h: 2, hidden: true } }
  const r = L.settle(saved, ["a.owl", "b.owl"], sizes({ "a.owl": [3, 2], "b.owl": [3, 2] }), 12)
  assert.ok(r.cells["a.owl"].hidden)
  assert.deepEqual(r.cells["b.owl"], { x: 0, y: 0, w: 3, h: 2 })
})

test("a missing file's place is not in the way", () => {
  const saved = { "gone.owl": { x: 0, y: 0, w: 3, h: 2 } }
  const r = L.settle(saved, ["a.owl"], sizes({ "a.owl": [3, 2] }), 12)
  assert.deepEqual(r.cells["a.owl"], { x: 0, y: 0, w: 3, h: 2 })
  assert.ok(r.cells["gone.owl"], "kept for when it comes back")
})

test("move refuses overlaps and the edge of the grid", () => {
  const cells = { "a.owl": { x: 0, y: 0, w: 3, h: 2 }, "b.owl": { x: 3, y: 0, w: 3, h: 2 } }
  assert.equal(L.move(cells, "a.owl", 2, 0, 12), null)
  assert.equal(L.move(cells, "a.owl", 10, 0, 12), null)
  assert.equal(L.move(cells, "a.owl", -1, 0, 12), null)
  assert.deepEqual(L.move(cells, "a.owl", 6, 1, 12)["a.owl"], { x: 6, y: 1, w: 3, h: 2 })
  assert.deepEqual(cells["a.owl"], { x: 0, y: 0, w: 3, h: 2 }, "the input is not changed")
})

test("resize keeps minSize and refuses overlaps", () => {
  const cells = { "a.owl": { x: 0, y: 0, w: 3, h: 2 }, "b.owl": { x: 4, y: 0, w: 2, h: 2 } }
  assert.deepEqual(L.resize(cells, "a.owl", 1, 1, [2, 2], 12)["a.owl"], { x: 0, y: 0, w: 2, h: 2 })
  assert.deepEqual(L.resize(cells, "a.owl", 4, 3, [1, 1], 12)["a.owl"], { x: 0, y: 0, w: 4, h: 3 })
  assert.equal(L.resize(cells, "a.owl", 5, 2, [1, 1], 12), null)
})

test("show puts a hidden widget back where it fits", () => {
  const cells = { "a.owl": { x: 0, y: 0, w: 12, h: 2 }, "b.owl": { x: 0, y: 0, w: 3, h: 2, hidden: true } }
  assert.deepEqual(L.show(cells, "b.owl", [3, 2], 12)["b.owl"], { x: 0, y: 2, w: 3, h: 2 })
})

test("rows counts shown tiles of present files", () => {
  const cells = { "a.owl": { x: 0, y: 0, w: 3, h: 2 }, "b.owl": { x: 0, y: 2, w: 3, h: 3, hidden: true }, "c.owl": { x: 0, y: 4, w: 1, h: 1 } }
  assert.equal(L.rows(cells), 5)
  assert.equal(L.rows(cells, ["a.owl", "b.owl"]), 2)
})

test("an edge drag moves only that side, keeps minSize and stays on the grid", () => {
  const c = { x: 2, y: 1, w: 3, h: 2 }
  assert.deepEqual(L.edge(c, { left: true }, -1, 0, [1, 1], 6), { x: 1, y: 1, w: 4, h: 2 })
  assert.deepEqual(L.edge(c, { left: true }, 5, 0, [2, 1], 6), { x: 3, y: 1, w: 2, h: 2 })
  assert.deepEqual(L.edge(c, { left: true }, -9, 0, [1, 1], 6), { x: 0, y: 1, w: 5, h: 2 })
  assert.deepEqual(L.edge(c, { right: true }, 9, 0, [1, 1], 6), { x: 2, y: 1, w: 4, h: 2 })
  assert.deepEqual(L.edge(c, { top: true }, 0, -3, [1, 1], 6), { x: 2, y: 0, w: 3, h: 3 })
  assert.deepEqual(L.edge(c, { bottom: true }, 0, -5, [1, 2], 6), { x: 2, y: 1, w: 3, h: 2 })
  assert.deepEqual(L.edge(c, { bottom: true }, 0, 2, [1, 1], 6), { x: 2, y: 1, w: 3, h: 4 })
})

test("place refuses overlaps and the edge of the grid", () => {
  const cells = { "a.owl": { x: 0, y: 0, w: 3, h: 2 }, "b.owl": { x: 3, y: 0, w: 3, h: 2 } }
  assert.equal(L.place(cells, "a.owl", { x: 0, y: 0, w: 4, h: 2 }, 6), null)
  assert.equal(L.place(cells, "a.owl", { x: 4, y: 2, w: 3, h: 2 }, 6), null)
  assert.deepEqual(L.place(cells, "a.owl", { x: 0, y: 0, w: 3, h: 4 }, 6)["a.owl"], { x: 0, y: 0, w: 3, h: 4 })
})
