.pragma library

// The widget store's catalog, as the phone reads it (Market.kt in
// omarchy-proot): index.json from the store's GitHub Pages, and what this
// machine installed from it (installed.json, written by bin/omarchy-widgets).
// Pure functions, so test/store.test.mjs runs them under node.

// What meta { category: ... } may say, in the order the store shows them (the
// launcher's Catalog.CATEGORIES).
var CATEGORIES = ["news", "dev", "productivity", "time", "world", "sport", "finance", "media", "games", "pets", "fun", "home", "system"]

function parse(text) {
  var value = JSON.parse(text)
  if (!value || !Array.isArray(value.widgets)) throw new Error("not a store index")
  return value.widgets.filter(function (w) {
    return w && typeof w.id === "string" && /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(w.id)
  })
}

// "1.10" > "1.9"; "1.0" == "1".
function compareVersions(a, b) {
  var x = String(a || "0").split(/[.-]/), y = String(b || "0").split(/[.-]/)
  for (var i = 0; i < Math.max(x.length, y.length); i++) {
    var p = x[i] === undefined ? "0" : x[i], q = y[i] === undefined ? "0" : y[i]
    var n = parseInt(p, 10), m = parseInt(q, 10)
    if (!isNaN(n) && !isNaN(m) && n !== m) return n < m ? -1 : 1
    if (isNaN(n) || isNaN(m)) { if (p !== q) return p < q ? -1 : 1 }
  }
  return 0
}

function same(a, b) { return JSON.stringify(a || null) === JSON.stringify(b || null) }

// Whether a runtime at owl `level` runs the entry; one without owl: is level 1.
function supported(entry, level) { return !(entry.owl > level) }

// "install", "installed", "update", or "review": an update whose commands or
// packages differ from the ones approved, which the phone asks about again.
// "newer" when the entry needs a higher owl level than this runtime's `level`:
// it is neither installed nor offered as an update, as on an older launcher.
function status(entry, record, level) {
  if (record && compareVersions(entry.version, record.version) <= 0) return "installed"
  if (level !== undefined && !supported(entry, level)) return "newer"
  if (!record) return "install"
  if (!same(entry.commands || [], record.commands || []) || !same(entry.requires || {}, record.requires || {})) return "review"
  return "update"
}

// The store's screenshot in this theme when it has one.
function preview(entry, theme) {
  if (entry.themes && theme && entry.themes[theme]) return entry.themes[theme]
  return entry.preview || ""
}

// A widget is new on the day it was added and the two days after, in UTC, as
// the launcher counts it (Catalog.isNew); `today` is "YYYY-MM-DD". A missing,
// malformed or future date never is.
var NEW_DAYS = 3

function isNew(added, today) {
  var iso = /^\d{4}-\d{2}-\d{2}$/
  if (!iso.test(String(added || "")) || !iso.test(String(today || ""))) return false
  var day = Date.parse(added + "T00:00:00Z"), now = Date.parse(today + "T00:00:00Z")
  if (isNaN(day) || isNaN(now)) return false
  return day <= now && day > now - NEW_DAYS * 86400000
}

// The tab a category has: its name as the catalog writes it. An entry without
// one is under "other"; one that says "other" has no tab, as on the phone.
// A name longer than MAX_CATEGORY isn't one: the store's are a word.
var MAX_CATEGORY = 24
// The category tabs there may be, the biggest: what the catalog says decides
// how many buttons the store draws.
var MAX_CATEGORY_TABS = 32

function category(entry) {
  return typeof entry.category === "string" && entry.category && entry.category.length <= MAX_CATEGORY ? entry.category : null
}

// The store's tabs as the phone lists them (StoreScreen.kt), each { name,
// count }: all, new, the categories with the biggest first (ties in
// CATEGORIES' order, then by name; one the store added since gets a tab too),
// other for the entries without a category, and installed, which also has
// `updates`, how many of those the store has a newer version of that this
// runtime runs. new and installed are there even when empty.
function tabs(widgets, records, level, today) {
  var counts = {}, none = 0, fresh = 0, installed = 0, updates = 0
  widgets.forEach(function (w) {
    var c = category(w)
    if (c === null) none++
    else if (c !== "other") counts[c] = (counts[c] || 0) + 1
    if (isNew(w.added, today)) fresh++
    var r = records && records[w.id]
    if (r) {
      installed++
      var st = status(w, r, level)
      if (st === "update" || st === "review") updates++
    }
  })
  function known(c) { var i = CATEGORIES.indexOf(c); return i >= 0 ? i : CATEGORIES.length }
  var out = [{ name: "all", count: widgets.length }, { name: "new", count: fresh }]
  Object.keys(counts).sort(function (x, y) {
    return counts[y] - counts[x] || known(x) - known(y) || (x < y ? -1 : x > y ? 1 : 0)
  }).slice(0, MAX_CATEGORY_TABS).forEach(function (c) { out.push({ name: c, count: counts[c] }) })
  if (none > 0) out.push({ name: "other", count: none })
  out.push({ name: "installed", count: installed, updates: updates })
  return out
}

// "installed 5 · 2↑", "news 15": a tab's name, how many it holds and, on
// installed, how many have an update.
function tabLabel(tab) {
  return tab.name + " " + tab.count + (tab.updates > 0 ? " · " + tab.updates + "↑" : "")
}

// Lowercase, with - and _ as spaces, so "hacker-news" is found by "hacker news".
function words(s) { return String(s || "").toLowerCase().replace(/[-_]/g, " ") }

// Catalog order -- the store's own -- narrowed to a tab and a search, which
// looks in the name, the description, the author and the category. new is
// newest first, a day's widgets in the catalog's order.
function filter(widgets, query, tab, records, today) {
  var q = words(String(query || "").trim())
  var out = widgets.filter(function (w) {
    if (tab === "new") { if (!isNew(w.added, today)) return false }
    else if (tab === "installed") { if (!(records && records[w.id])) return false }
    else if (tab === "other") { if (category(w) !== null) return false }
    else if (tab && tab !== "all" && category(w) !== tab) return false
    if (!q) return true
    return [w.name, w.description, w.author, w.category].some(function (t) { return words(t).indexOf(q) >= 0 })
  })
  if (tab === "new") {
    out = out.map(function (w, i) { return [w, i] })
      .sort(function (x, y) { return x[0].added < y[0].added ? 1 : x[0].added > y[0].added ? -1 : x[1] - y[1] })
      .map(function (p) { return p[0] })
  }
  return out
}
