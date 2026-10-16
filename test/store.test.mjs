// node --test test/ -- Store.js, QML's `.pragma library` JavaScript, loaded as a plain script.

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const source = readFileSync(new URL("../Store.js", import.meta.url), "utf8").replace(/^\.pragma library\s*/, "")
const S = new Function(source + "\nreturn { parse, compareVersions, status, preview, filter, categories }")()

const entry = { id: "a/clock", name: "clock", author: "a", version: "1.2", commands: ["date"], requires: { pacman: ["coreutils"] }, category: "time" }

test("parse keeps well-formed ids only", () => {
  const w = S.parse(JSON.stringify({ format: 1, widgets: [entry, { id: "../x" }, null, { id: "Up/Case" }] }))
  assert.deepEqual(w.map((e) => e.id), ["a/clock"])
  assert.throws(() => S.parse("{}"))
})

test("versions compare by number", () => {
  assert.equal(S.compareVersions("1.10", "1.9"), 1)
  assert.equal(S.compareVersions("1.0", "1"), 0)
  assert.equal(S.compareVersions("2", "10"), -1)
})

test("status tells updates that need a new look apart", () => {
  assert.equal(S.status(entry, null), "install")
  assert.equal(S.status(entry, { version: "1.2", commands: ["date"] }), "installed")
  assert.equal(S.status(entry, { version: "1.1", commands: ["date"], requires: { pacman: ["coreutils"] } }), "update")
  assert.equal(S.status(entry, { version: "1.1", commands: ["date -u"], requires: { pacman: ["coreutils"] } }), "review")
  assert.equal(S.status(entry, { version: "1.1", commands: ["date"], requires: {} }), "review")
})

test("preview prefers the theme's screenshot", () => {
  const e = { preview: "p.png", themes: { nord: "nord.webp" } }
  assert.equal(S.preview(e, "nord"), "nord.webp")
  assert.equal(S.preview(e, "gruvbox"), "p.png")
  assert.equal(S.preview({}, "nord"), "")
})

test("filter and categories", () => {
  const ws = [entry, { id: "b/news", name: "news", author: "b", description: "Headlines", category: "news" }, { id: "c/x", name: "x", author: "c" }]
  assert.deepEqual(S.filter(ws, "head", "all").map((w) => w.id), ["b/news"])
  assert.deepEqual(S.filter(ws, "", "other").map((w) => w.id), ["c/x"])
  assert.deepEqual(S.categories(ws), ["news", "time", "other"])
})
