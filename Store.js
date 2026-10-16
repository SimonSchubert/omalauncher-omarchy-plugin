.pragma library

// The widget store's catalog, as the phone reads it (Market.kt in
// omarchy-proot): index.json from the store's GitHub Pages, and what this
// machine installed from it (installed.json, written by bin/omarchy-widgets).
// Pure functions, so test/store.test.mjs runs them under node.

var CATEGORIES = ["news", "dev", "productivity", "time", "world", "fun", "home", "system"]

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

// "install", "installed", "update", or "review": an update whose commands or
// packages differ from the ones approved, which the phone asks about again.
function status(entry, record) {
  if (!record) return "install"
  if (compareVersions(entry.version, record.version) <= 0) return "installed"
  if (!same(entry.commands || [], record.commands || []) || !same(entry.requires || {}, record.requires || {})) return "review"
  return "update"
}

// The store's screenshot in this theme when it has one.
function preview(entry, theme) {
  if (entry.themes && theme && entry.themes[theme]) return entry.themes[theme]
  return entry.preview || ""
}

function category(entry) {
  return CATEGORIES.indexOf(entry.category) >= 0 ? entry.category : "other"
}

// Catalog order -- the store's own -- filtered by a search and a category.
function filter(widgets, query, cat) {
  var q = String(query || "").toLowerCase().trim()
  return widgets.filter(function (w) {
    if (cat && cat !== "all" && category(w) !== cat) return false
    if (!q) return true
    return (w.name + " " + w.author + " " + (w.description || "")).toLowerCase().indexOf(q) >= 0
  })
}

// The categories that have widgets, in the store's order, "other" last.
function categories(widgets) {
  var seen = {}
  widgets.forEach(function (w) { seen[category(w)] = true })
  return CATEGORIES.concat(["other"]).filter(function (c) { return seen[c] })
}
