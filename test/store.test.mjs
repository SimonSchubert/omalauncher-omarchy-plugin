// node --test test/ -- Store.js, QML's `.pragma library` JavaScript, loaded as a plain script.

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const source = readFileSync(new URL("../Store.js", import.meta.url), "utf8").replace(/^\.pragma library\s*/, "")
const S = new Function(source + "\nreturn { parse, compareVersions, status, supported, preview, filter, tabs, tabLabel, isNew }")()

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

test("a widget above the runtime's owl level is neither installed nor an update", () => {
  const next = { ...entry, owl: 26 }
  assert.equal(S.supported(entry, 25), true)
  assert.equal(S.supported({ ...entry, owl: 25 }, 25), true)
  assert.equal(S.supported(next, 25), false)
  assert.equal(S.status(next, null, 25), "newer")
  assert.equal(S.status(next, { version: "1.1", commands: ["date"] }, 25), "newer")
  assert.equal(S.status(next, { version: "1.2", commands: ["date"] }, 25), "installed")
  assert.equal(S.status(next, null, 26), "install")
  assert.equal(S.status(next, null), "install")
})

test("preview prefers the theme's screenshot", () => {
  const e = { preview: "p.png", themes: { nord: "nord.webp" } }
  assert.equal(S.preview(e, "nord"), "nord.webp")
  assert.equal(S.preview(e, "gruvbox"), "p.png")
  assert.equal(S.preview({}, "nord"), "")
})

const ws = [
  entry,
  { id: "b/news", name: "hacker-news", author: "b", description: "Headlines", category: "news", version: "1.0", added: "2026-11-20" },
  { id: "c/x", name: "x", author: "c", version: "2.0", added: "2026-11-21" },
  { id: "d/feed", name: "feed", author: "d", category: "news", version: "1.0", added: "2026-11-18" },
  { id: "e/zoo", name: "zoo", author: "e", category: "brand-new", version: "1.0" },
  { id: "f/odd", name: "odd", author: "f", category: "other", version: "1.0" },
]
const records = { "a/clock": { version: "1.1", commands: ["date"], requires: { pacman: ["coreutils"] } }, "c/x": { version: "2.0" } }

test("new is the day it was added and the two after, in UTC", () => {
  assert.equal(S.isNew("2026-11-21", "2026-11-21"), true)
  assert.equal(S.isNew("2026-11-19", "2026-11-21"), true)
  assert.equal(S.isNew("2026-11-18", "2026-11-21"), false)
  assert.equal(S.isNew("2026-11-22", "2026-11-21"), false)
  assert.equal(S.isNew(undefined, "2026-11-21"), false)
  assert.equal(S.isNew("yesterday", "2026-11-21"), false)
})

test("tabs are the phone's: all, new, categories by size, other, installed", () => {
  const tabs = S.tabs(ws, records, 25, "2026-11-21")
  assert.deepEqual(tabs.map((t) => [t.name, t.count]), [["all", 6], ["new", 2], ["news", 2], ["time", 1], ["brand-new", 1], ["other", 1], ["installed", 2]])
  assert.equal(tabs.at(-1).updates, 1)
  assert.deepEqual(tabs.map(S.tabLabel), ["all 6", "new 2", "news 2", "time 1", "brand-new 1", "other 1", "installed 2 · 1↑"])
  // new and installed are there when empty; other only when something has no category.
  assert.deepEqual(S.tabs([entry], {}, 25, "2026-11-21").map(S.tabLabel), ["all 1", "new 0", "time 1", "installed 0"])
  // An update this runtime can't run isn't counted.
  assert.equal(S.tabs([{ ...entry, owl: 26 }], records, 25, "2026-11-21").at(-1).updates, 0)
})

test("the catalog doesn't decide how many tabs there are, or how long one's name is", () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ ...entry, id: "a/w" + i, category: "c" + i }))
  const tabs = S.tabs(many, {}, 25, "2026-11-21")
  // all, new, 32 categories, installed.
  assert.equal(tabs.length, 35)
  assert.equal(tabs[0].count, 100)
  const long = S.tabs([{ ...entry, category: "x".repeat(25) }], {}, 25, "2026-11-21")
  assert.deepEqual(long.map(S.tabLabel), ["all 1", "new 0", "other 1", "installed 0"])
})

test("filter narrows to a tab and a search", () => {
  const ids = (q, tab) => S.filter(ws, q, tab, records, "2026-11-21").map((w) => w.id)
  assert.deepEqual(ids("", "all"), ws.map((w) => w.id))
  assert.deepEqual(ids("head", "all"), ["b/news"])
  assert.deepEqual(ids("hacker news", "all"), ["b/news"])
  assert.deepEqual(ids("news", "all"), ["b/news", "d/feed"])
  assert.deepEqual(ids("", "news"), ["b/news", "d/feed"])
  assert.deepEqual(ids("feed", "news"), ["d/feed"])
  assert.deepEqual(ids("", "other"), ["c/x"])
  assert.deepEqual(ids("", "brand-new"), ["e/zoo"])
  assert.deepEqual(ids("", "installed"), ["a/clock", "c/x"])
  assert.deepEqual(ids("", "new"), ["c/x", "b/news"])
})
