.pragma library

// OWL, the widget language of omarchy-widgets
// (https://github.com/SimonSchubert/omarchy-widgets), so the widgets written
// for the Android launcher draw on this phone's Home unchanged.
//
// The language has one reference implementation: the `owl` module of the
// launcher, shipped as tools/owl.jar in the widgets repo. This file is a port
// of it -- lexer, parser, compiler and builtins -- and the rules below follow
// that code rather than docs/LANGUAGE.md, which trails it (owl 5's screen { },
// http(...), android.system and `persist` are in the jar and not the doc).
// test/owl-test.sh evaluates every published widget with both and compares.
//
// What the jar does NOT contain is the launcher's renderer, so the runtime
// half -- Instance, at the bottom -- is ours: it keeps the sources' values,
// states and lets, and turns the compiled tree into plain objects that
// OwlNode.qml draws. Nothing here touches QML, so the same file runs under
// node for the tests.
//
// Values are plain JS: null, numbers, strings, booleans, arrays for lists and
// Maps for objects (a Map keeps "2024" in the order it came in, which a JS
// object would not). Colors, gradients and functions are the three classes
// below.

// ------------------------------------------------------------------ values

function Col(theme, argb, alpha) {
  this.theme = theme
  this.argb = argb >>> 0
  this.alpha = alpha === undefined ? 1 : alpha
}

function Gradient(radial, coords, colors) {
  this.radial = radial
  this.coords = coords
  this.colors = colors
}

function Fn(arity, call) {
  this.arity = arity
  this.call = call
}

// A placeholder a theme name carries until a host resolves it, as in the jar.
var THEME_GREY = 0xFF888888

function CompileError(message, pos) {
  this.message = message
  this.pos = pos
}

function WidgetError(message) {
  this.message = message
}

function isObj(v) { return v instanceof Map }

function truthy(v) {
  if (v === null || v === undefined) return false
  if (typeof v === "number") return v !== 0 && v === v
  if (typeof v === "string") return v.length > 0
  if (typeof v === "boolean") return v
  if (Array.isArray(v)) return v.length > 0
  if (v instanceof Map) return v.size > 0
  return true
}

var NUMBER_TEXT = /^[+-]?(NaN|Infinity|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)[fFdD]?$/

// ValueKt.num: what a value is as a number, or null. Command output is text,
// so "81" and "81%" are numbers.
function num(v) {
  if (typeof v === "number") return v
  if (typeof v === "string") {
    var t = v.trim()
    if (t.charAt(t.length - 1) === "%") t = t.slice(0, -1).trim()
    if (!NUMBER_TEXT.test(t)) return null
    return parseFloat(t.replace(/[fFdD]$/, ""))
  }
  if (typeof v === "boolean") return v ? 1 : 0
  return null
}

// Java's Double.toString, which is what a number prints as in the launcher:
// 3 not 3.0, but 0.5, and 1.5E7 past ten million.
function numText(x) {
  if (x !== x) return "NaN"
  if (x === Infinity) return "Infinity"
  if (x === -Infinity) return "-Infinity"
  if (x === Math.round(x) && Math.abs(x) < 1e15) return String(x === 0 ? 0 : x)
  var a = Math.abs(x)
  if (a >= 1e-3 && a < 1e7) {
    var s = String(x)
    return s.indexOf(".") < 0 && s.indexOf("e") < 0 ? s + ".0" : s
  }
  var parts = x.toExponential().split("e")
  var m = parts[0].indexOf(".") < 0 ? parts[0] + ".0" : parts[0]
  return m + "E" + (parts[1].charAt(0) === "+" ? parts[1].slice(1) : parts[1])
}

// Java's Float.toString, for the numbers the jar keeps as floats: always a
// fraction (3.0), and the fewest digits (two at least) that still read back as
// the same float, so 28.9f prints 28.9 and not the double it widens to,
// 28.899999618530273. A tie between two such decimals goes to the even digit,
// so it rounds the float's exact value; QML has no BigInt, hence the digit array.
function floatText(x) {
  var f = Math.fround(x)
  if (f !== f || f === Infinity || f === -Infinity) return numText(f)
  if (f === 0) return 1 / f < 0 ? "-0.0" : "0.0"
  var m = Math.abs(f), e = 0
  while (m !== Math.floor(m)) { m *= 2; e-- }
  while (m > 16777216 && m % 2 === 0) { m /= 2; e++ }
  var ds = [], i, carry
  for (; m > 0; m = Math.floor(m / 10)) ds.push(m % 10)
  for (var k = 0; k < Math.abs(e); k++) {
    carry = 0
    for (i = 0; i < ds.length; i++) {
      var v = ds[i] * (e < 0 ? 5 : 2) + carry
      ds[i] = v % 10
      carry = Math.floor(v / 10)
    }
    if (carry) ds.push(carry)
  }
  var all = ds.reverse().join("")
  var exp = all.length - 1 + Math.min(e, 0)
  for (var p = 2; p <= 9; p++) {
    var c = all.slice(0, p), rest = all.slice(p)
    while (c.length < p) c += "0"
    var r0 = rest.charAt(0)
    var up = r0 > "5" || r0 === "5" && (/[1-9]/.test(rest.slice(1)) || +c.charAt(p - 1) % 2 === 1)
    var cexp = exp
    if (up) {
      var n = c.split("")
      for (i = p - 1; i >= 0 && n[i] === "9"; i--) n[i] = "0"
      if (i < 0) { n.unshift("1"); n.pop(); cexp++ } else n[i] = String(+n[i] + 1)
      c = n.join("")
    }
    if (Math.fround(Number((f < 0 ? "-" : "") + c.charAt(0) + "." + c.slice(1) + "e" + cexp)) === f) break
  }
  c = c.replace(/0+$/, "") || "0"
  var sign = f < 0 ? "-" : ""
  if (cexp >= -3 && cexp < 7) {
    if (cexp < 0) return sign + "0." + "000".slice(0, -cexp - 1) + c
    while (c.length <= cexp + 1) c += "0"
    return sign + c.slice(0, cexp + 1) + "." + c.slice(cexp + 1)
  }
  return sign + c.charAt(0) + "." + (c.slice(1) || "0") + "E" + cexp
}

function hex8(n) {
  var s = (n >>> 0).toString(16)
  while (s.length < 8) s = "0" + s
  return "#" + s
}

// Value.toString in the jar.
function show(v) {
  if (v === null || v === undefined) return "null"
  if (typeof v === "number") return numText(v)
  if (typeof v === "string") return v
  if (typeof v === "boolean") return v ? "true" : "false"
  if (Array.isArray(v)) return "[" + v.map(show).join(", ") + "]"
  if (v instanceof Map) {
    var out = []
    v.forEach(function(value, key) { out.push(key + ": " + show(value)) })
    return "{" + out.join(", ") + "}"
  }
  if (v instanceof Col) return v.theme !== null ? v.theme : hex8(v.argb)
  if (v instanceof Fn) return "<fn>"
  if (v instanceof Gradient)
    return "Gradient(radial=" + v.radial + ", coords=[" + v.coords.map(floatText).join(", ")
      + "], colors=[" + v.colors.map(show).join(", ") + "])"
  return String(v)
}

// ValueKt.text: how a value reads on screen. null is an ellipsis, meaning
// "not loaded yet", and command output loses its trailing newline.
function text(v) {
  if (v === null || v === undefined) return "…"
  if (typeof v === "string") return v.replace(/\s+$/, "").replace(/^[\n\r]+/, "")
  return show(v)
}

function equals(a, b) {
  if (a === b) return typeof a !== "number" || a === a
  if (typeof a === "number" && typeof b === "number") return a !== a && b !== b
  if (a === null || b === null || a === undefined || b === undefined) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (var i = 0; i < a.length; i++) if (!equals(a[i], b[i])) return false
    return true
  }
  if (a instanceof Map) {
    if (!(b instanceof Map) || a.size !== b.size) return false
    var same = true
    a.forEach(function(value, key) {
      if (same && (!b.has(key) || !equals(value, b.get(key)))) same = false
    })
    return same
  }
  if (a instanceof Col)
    return b instanceof Col && a.theme === b.theme && a.argb === b.argb && Math.fround(a.alpha) === Math.fround(b.alpha)
  if (a instanceof Gradient)
    return b instanceof Gradient && a.radial === b.radial && equals(a.coords, b.coords) && equals(a.colors, b.colors)
  return false
}

// `==`: equal values, and a number equals the text of itself.
function looseEquals(a, b) {
  if (equals(a, b)) return true
  if ((typeof a === "number" && typeof b === "string") || (typeof a === "string" && typeof b === "number")) {
    var x = num(a), y = num(b)
    return x !== null && y !== null && x === y
  }
  return false
}

function parseHex(hex) {
  var h = hex.charAt(0) === "#" ? hex.slice(1) : hex
  if (!/^[0-9A-Fa-f]*$/.test(h)) return null
  var rgba
  if (h.length === 3) rgba = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2) + "ff"
  else if (h.length === 6) rgba = h + "ff"
  else if (h.length === 8) rgba = h
  else return null
  var n = parseInt(rgba, 16)
  return (((n & 0xFF) << 24) | ((n >>> 8) & 0xFFFFFF)) >>> 0
}

// JSON in, values out. Objects become Maps so their keys keep file order.
function fromJson(j) {
  if (j === null || j === undefined) return null
  if (Array.isArray(j)) return j.map(fromJson)
  if (typeof j === "object") {
    var m = new Map()
    var keys = Object.keys(j)
    for (var i = 0; i < keys.length; i++) m.set(keys[i], fromJson(j[keys[i]]))
    return m
  }
  return j
}

// Map keys "1" and "10" would come back from JSON.parse in numeric order, not
// file order, so a reviver cannot be used: this walks the text itself.
function parseJson(textIn) {
  var s = String(textIn)
  var i = 0
  function fail(msg) { throw new WidgetError("bad JSON: " + msg) }
  function ws() { while (i < s.length && /\s/.test(s.charAt(i))) i++ }
  function value() {
    ws()
    var c = s.charAt(i)
    if (c === "{") {
      i++
      var m = new Map()
      ws()
      if (s.charAt(i) === "}") { i++; return m }
      for (;;) {
        ws()
        if (s.charAt(i) !== "\"") fail("expected a key")
        var k = str()
        ws()
        if (s.charAt(i) !== ":") fail("expected ':'")
        i++
        m.set(k, value())
        ws()
        if (s.charAt(i) === ",") { i++; continue }
        if (s.charAt(i) === "}") { i++; return m }
        fail("expected ',' or '}'")
      }
    }
    if (c === "[") {
      i++
      var l = []
      ws()
      if (s.charAt(i) === "]") { i++; return l }
      for (;;) {
        l.push(value())
        ws()
        if (s.charAt(i) === ",") { i++; continue }
        if (s.charAt(i) === "]") { i++; return l }
        fail("expected ',' or ']'")
      }
    }
    if (c === "\"") return str()
    if (s.substr(i, 4) === "true") { i += 4; return true }
    if (s.substr(i, 5) === "false") { i += 5; return false }
    if (s.substr(i, 4) === "null") { i += 4; return null }
    var mm = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i))
    if (!mm) fail("unexpected '" + c + "'")
    i += mm[0].length
    return parseFloat(mm[0])
  }
  function str() {
    i++
    var out = ""
    while (i < s.length) {
      var c = s.charAt(i)
      if (c === "\"") { i++; return out }
      if (c === "\\") {
        var e = s.charAt(i + 1)
        if (e === "u") { out += String.fromCharCode(parseInt(s.substr(i + 2, 4), 16)); i += 6; continue }
        out += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e === "b" ? "\b" : e === "f" ? "\f" : e
        i += 2
        continue
      }
      out += c
      i++
    }
    fail("unterminated string")
  }
  var v = value()
  ws()
  if (i < s.length) fail("trailing text")
  return v
}

function parseOrText(t) {
  try { return parseJson(String(t).trim()) } catch (e) { return t }
}

// Values out to JSON, for persisted state.
function toJson(v) {
  if (v === null || v === undefined) return null
  if (Array.isArray(v)) return v.map(toJson)
  if (v instanceof Map) {
    var o = {}
    v.forEach(function(value, key) { o[key] = toJson(value) })
    return o
  }
  if (typeof v === "number") return isFinite(v) ? v : null
  if (typeof v === "string" || typeof v === "boolean") return v
  return show(v)
}

// ------------------------------------------------------------------- lexer

var T_IDENT = "ident", T_NUM = "num", T_STR = "str", T_PUNCT = "punct", T_EOF = "eof"
var TWO = ["==", "!=", "<=", ">=", "&&", "||", "??", "=>"]
var ONE = "{}()[],;:.?=<>+-*/%!"

function isDigit(c) { return c >= "0" && c <= "9" }
function isLetter(c) {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c > "\u007f" && c.toUpperCase() !== c.toLowerCase())
}
function isLetterOrDigit(c) { return isLetter(c) || isDigit(c) }
function isSpace(c) { return c === " " || c === "\t" || c === "\r" || c === "\n" || c === "\f" || c === "\u000b" || c === " " }

function token(type, textIn, pos, nl, extra) {
  var t = { type: type, text: textIn, pos: pos, nl: nl, num: 0, pair: null, parts: [] }
  if (extra) for (var k in extra) t[k] = extra[k]
  return t
}

function trimIndent(s) {
  var lines = s.split("\n")
  if (lines.length && lines[0].trim() === "") lines.shift()
  if (lines.length && lines[lines.length - 1].trim() === "") lines.pop()
  var indent = Infinity
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") continue
    var n = 0
    while (n < lines[i].length && isSpace(lines[i].charAt(n))) n++
    indent = Math.min(indent, n)
  }
  if (indent === Infinity) indent = 0
  return lines.map(function(l) { return l.trim() === "" ? "" : l.slice(indent) }).join("\n")
}

function lex(src, start, end) {
  var i = start === undefined ? 0 : start
  var stop = end === undefined ? src.length : end
  var out = []
  var nl = false

  function add(t) { out.push(t); nl = false }

  function skipSpace() {
    while (i < stop) {
      var c = src.charAt(i)
      if (c === "\n") { nl = true; i++ }
      else if (isSpace(c)) i++
      else if (src.substr(i, 2) === "//") { while (i < stop && src.charAt(i) !== "\n") i++ }
      else if (src.substr(i, 2) === "/*") {
        var close = src.indexOf("*/", i + 2)
        if (close < 0 || close >= stop) throw new CompileError("unterminated comment", i)
        if (src.slice(i, close).indexOf("\n") >= 0) nl = true
        i = close + 2
      } else return
    }
  }

  function digits() {
    var s = i
    while (i < stop && (isDigit(src.charAt(i)) || src.charAt(i) === "_")) i++
    if (i < stop && src.charAt(i) === "." && isDigit(src.charAt(i + 1))) {
      i++
      while (i < stop && isDigit(src.charAt(i))) i++
    }
    return parseFloat(src.slice(s, i).replace(/_/g, ""))
  }

  function number() {
    var s = i
    if (src.substr(i, 2) === "0x") {
      i += 2
      var hs = i
      while (i < stop && isLetterOrDigit(src.charAt(i))) i++
      var h = src.slice(hs, i)
      if (!/^[0-9a-fA-F]+$/.test(h)) throw new CompileError("bad hex number", s)
      add(token(T_NUM, src.slice(s, i), s, nl, { num: parseInt(h, 16) }))
      return
    }
    var v = digits()
    if (i + 1 < stop && src.charAt(i) === "x" && isDigit(src.charAt(i + 1))) {
      i++
      var w = digits()
      add(token(T_NUM, src.slice(s, i), s, nl, { num: v, pair: [v, w] }))
      return
    }
    var us = i
    while (i < stop && isLetter(src.charAt(i))) i++
    var unit = src.slice(us, i)
    if (unit === "h") v *= 3600
    else if (unit === "m" || unit === "min") v *= 60
    else if (unit === "ms") v /= 1000
    else if (unit !== "" && unit !== "s" && unit !== "dp" && unit !== "px" && unit !== "deg")
      throw new CompileError("unknown unit '" + unit + "'", us)
    add(token(T_NUM, src.slice(s, i), s, nl, { num: v }))
  }

  function escape() {
    var e = src.charAt(i + 1)
    if (i + 1 >= src.length) throw new CompileError("unterminated string", i)
    i += 2
    return e === "0" ? "\u0000" : e === "e" ? "\u001b" : e === "n" ? "\n" : e === "r" ? "\r" : e === "t" ? "\t" : e
  }

  function matchBrace(from) {
    var depth = 0
    for (var j = from; j < stop; j++) {
      var c = src.charAt(j)
      if (c === "\n") throw new CompileError("unterminated ${", from - 2)
      if (c === "\"" || c === "'") {
        var q = c
        j++
        for (; j < stop && src.charAt(j) !== q; j++) if (src.charAt(j) === "\\") j++
      } else if (c === "{") depth++
      else if (c === "}") {
        if (depth === 0) return j
        depth--
      }
    }
    throw new CompileError("unterminated ${", from - 2)
  }

  function string() {
    var s = i
    i++
    var parts = []
    var buf = ""
    while (i < stop && src.charAt(i) !== "\n") {
      var c = src.charAt(i)
      if (c === "\"") {
        i++
        if (buf.length > 0 || parts.length === 0) parts.push({ lit: buf })
        add(token(T_STR, src.slice(s, i), s, nl, { parts: parts }))
        return
      }
      if (c === "\\") { buf += escape(); continue }
      if (c === "$" && src.charAt(i + 1) === "{") {
        if (buf.length > 0) { parts.push({ lit: buf }); buf = "" }
        var codeStart = i + 2
        i = matchBrace(i + 2)
        parts.push({ code: [codeStart, i] })
        i++
        continue
      }
      buf += c
      i++
    }
    throw new CompileError("unterminated string", s)
  }

  function singleQuoted() {
    var s = i
    i++
    var buf = ""
    while (i < stop) {
      var c = src.charAt(i)
      if (c === "'") {
        i++
        add(token(T_STR, src.slice(s, i), s, nl, { parts: [{ lit: buf }] }))
        return
      }
      if (c === "\\" && (src.charAt(i + 1) === "'" || src.charAt(i + 1) === "\\")) {
        buf += src.charAt(i + 1)
        i += 2
        continue
      }
      buf += c
      i++
    }
    throw new CompileError("unterminated string", s)
  }

  function rawString() {
    var s = i
    var close = src.indexOf("\"\"\"", i + 3)
    if (close < 0 || close >= stop) throw new CompileError("unterminated \"\"\" string", s)
    var body = trimIndent(src.slice(i + 3, close))
    if (body.charAt(0) === "\n") body = body.slice(1)
    i = close + 3
    add(token(T_STR, src.slice(s, i), s, nl, { parts: [{ lit: body }] }))
  }

  for (;;) {
    skipSpace()
    if (i >= stop) {
      out.push(token(T_EOF, "", stop, true))
      return out
    }
    var s = i
    var c = src.charAt(i)
    if (isLetter(c) || c === "_") {
      while (i < stop && (isLetterOrDigit(src.charAt(i)) || src.charAt(i) === "_")) i++
      add(token(T_IDENT, src.slice(s, i), s, nl))
    } else if (isDigit(c)) {
      number()
    } else if (c === "#") {
      i++
      while (i < stop && isLetterOrDigit(src.charAt(i))) i++
      if (parseHex(src.slice(s, i)) === null) throw new CompileError("bad color '" + src.slice(s, i) + "'", s)
      add(token(T_NUM, src.slice(s, i), s, nl))
    } else if (c === "\"" && src.substr(i, 3) === "\"\"\"") {
      rawString()
    } else if (c === "\"") {
      string()
    } else if (c === "'") {
      singleQuoted()
    } else {
      var two = i + 1 < stop ? src.substr(i, 2) : ""
      var p = TWO.indexOf(two) >= 0 ? two : c
      if (p.length === 1 && ONE.indexOf(c) < 0) throw new CompileError("unexpected character '" + c + "'", i)
      i += p.length
      add(token(T_PUNCT, p, s, nl))
    }
  }
}

// ------------------------------------------------------------------ parser

var BLOCK_DECLS = ["meta", "requires"]
var DECLS = ["source", "state", "let", "asset", "component", "meta", "requires"]
var TRIGGERS = ["every", "at", "when", "on"]
var LEVELS = [["??"], ["||"], ["&&"], ["==", "!="], ["<", "<=", ">", ">="], ["+", "-"], ["*", "/", "%"]]

function Parser(src, tokens) {
  this.src = src
  this.tokens = tokens
  this.p = 0
}

Parser.prototype = {
  t: function() { return this.tokens[this.p] },
  peek: function(n) { return this.tokens[Math.min(this.p + (n === undefined ? 1 : n), this.tokens.length - 1)] },
  next: function() { return this.tokens[this.p++] },
  isP: function(tok, s) { return tok.type === T_PUNCT && tok.text === s },
  isId: function(tok, w) { return tok.type === T_IDENT && tok.text === w },
  desc: function(tok) { return tok.type === T_EOF ? "end of file" : tok.type === T_STR ? "string" : "'" + tok.text + "'" },
  fail: function(msg, at) { throw new CompileError(msg, (at || this.t()).pos) },
  expect: function(type) {
    if (this.t().type !== type) this.fail("expected " + (type === T_EOF ? "eof" : type) + ", found " + this.desc(this.t()))
  },
  punct: function(s) {
    if (!this.isP(this.t(), s)) this.fail("expected '" + s + "', found " + this.desc(this.t()))
    return this.next()
  },
  accept: function(s) {
    if (this.isP(this.t(), s)) { this.p++; return true }
    return false
  },
  persist: function() {
    if (this.isId(this.t(), "persist") && !this.t().nl) { this.p++; return true }
    return false
  },
  ident: function(what) {
    if (this.t().type !== T_IDENT) this.fail("expected " + (what || "a name") + ", found " + this.desc(this.t()))
    return this.next().text
  },

  widget: function() {
    if (!this.isId(this.t(), "widget")) this.fail("a widget file starts with: widget \"name\" {")
    this.next()
    var name = this.t().type === T_STR ? this.literalString(this.next()) : null
    this.punct("{")
    var body = this.body(true)
    this.punct("}")
    this.expect(T_EOF)
    return { name: name, body: body }
  },

  literalString: function(tok) {
    if (tok.parts.length === 1 && tok.parts[0].lit !== undefined) return tok.parts[0].lit
    this.fail("expected a plain string", tok)
  },

  body: function(top) {
    var b = { props: [], handlers: [], animations: [], items: [], decls: [] }
    while (!this.isP(this.t(), "}") && this.t().type !== T_EOF) {
      if (this.accept(";")) continue
      var start = this.t()
      if (start.type !== T_IDENT) this.fail("expected a property, node or declaration, found " + this.desc(start))
      var word = start.text
      var after = this.peek()
      if (TRIGGERS.indexOf(word) >= 0 && !this.isP(after, ":") && !this.isP(after, "{")) {
        if (!top) this.fail("'" + word + "' is only allowed at the top of the widget")
        this.next()
        var e = this.expr()
        if (!this.isP(this.t(), "{")) this.fail("expected '{' with the statements to run: " + word + " ... { ... }")
        b.decls.push({ kind: "trigger", trigger: word, expr: e, stmts: this.handler(), pos: start.pos })
      } else if (word === "if") {
        b.items.push(this.ifItem())
      } else if (word === "for") {
        b.items.push(this.forItem())
      } else if (word === "animate" && after.type === T_IDENT) {
        this.next()
        var an = this.ident("property to animate")
        this.punct(":")
        b.animations.push({ name: an, value: this.expr(), pos: start.pos })
      } else if (word === "let" && !top && after.type === T_IDENT) {
        this.next()
        var ln = this.ident()
        this.punct("=")
        b.items.push({ kind: "let", name: ln, value: this.expr(), pos: start.pos })
      } else if (DECLS.indexOf(word) >= 0 && (after.type === T_IDENT || (BLOCK_DECLS.indexOf(word) >= 0 && this.isP(after, "{")))) {
        if (!top) this.fail("'" + word + "' is only allowed at the top of the widget")
        b.decls.push(this.decl())
      } else if (this.isP(after, ":")) {
        this.next()
        this.next()
        if (word.length > 2 && word.slice(0, 2) === "on" && word.charAt(2) >= "A" && word.charAt(2) <= "Z")
          b.handlers.push({ name: word, stmts: this.handler(), pos: start.pos })
        else
          b.props.push({ name: word, value: this.expr(), pos: start.pos })
      } else if (this.isP(after, "{")) {
        this.next()
        this.next()
        var nb = this.body(false)
        this.punct("}")
        b.items.push({ kind: "node", type: word, body: nb, pos: start.pos })
      } else {
        if (!this.isP(after, "(") || after.nl) this.fail("expected ':' or '{' after '" + word + "'", after)
        var call = this.primary()
        if (call.k !== "call") this.fail("expected a call", start)
        var cb = null
        if (this.isP(this.t(), "{") && !this.t().nl) {
          this.next()
          cb = this.body(false)
          this.punct("}")
        }
        b.items.push({ kind: "call", call: call, body: cb, pos: start.pos })
      }
    }
    return b
  },

  ifItem: function() {
    var pos = this.next().pos
    var cond = this.expr()
    this.punct("{")
    var then = this.body(false)
    this.punct("}")
    var orElse = null
    if (this.isId(this.t(), "else")) {
      this.next()
      if (this.isId(this.t(), "if")) {
        orElse = { props: [], handlers: [], animations: [], items: [this.ifItem()], decls: [] }
      } else {
        this.punct("{")
        orElse = this.body(false)
        this.punct("}")
      }
    }
    return { kind: "if", cond: cond, then: then, orElse: orElse, pos: pos }
  },

  forItem: function() {
    var pos = this.next().pos
    var name = this.ident("loop variable")
    var index = this.accept(",") ? this.ident("index variable") : null
    if (!this.isId(this.t(), "in")) this.fail("expected 'in'")
    this.next()
    var list = this.expr()
    var key = null
    if (this.isId(this.t(), "key")) {
      this.next()
      key = this.expr()
    }
    this.punct("{")
    var b = this.body(false)
    this.punct("}")
    return { kind: "for", name: name, index: index, list: list, key: key, body: b, pos: pos }
  },

  decl: function() {
    var kw = this.next()
    if (BLOCK_DECLS.indexOf(kw.text) >= 0) {
      this.punct("{")
      var fields = []
      while (!this.isP(this.t(), "}")) {
        if (this.accept(";") || this.accept(",")) continue
        var pos = this.t().pos
        var fname = this.ident(kw.text + " field")
        this.punct(":")
        fields.push({ name: fname, value: this.expr(), pos: pos })
      }
      this.punct("}")
      return { kind: kw.text, fields: fields, pos: kw.pos }
    }
    var name = this.ident()
    if (kw.text === "component") {
      if (!(name.charAt(0) >= "A" && name.charAt(0) <= "Z")) this.fail("component names start with a capital letter", kw)
      var params = []
      if (this.accept("(")) {
        while (!this.isP(this.t(), ")")) {
          params.push([this.ident("parameter"), this.accept("=") ? this.expr() : null])
          if (!this.accept(",")) break
        }
        this.punct(")")
      }
      this.punct("{")
      var cbody = this.body(false)
      this.punct("}")
      return { kind: "component", name: name, params: params, body: cbody, pos: kw.pos }
    }
    this.punct("=")
    if (kw.text === "let") return { kind: "let", name: name, value: this.expr(), pos: kw.pos, persist: this.persist() }
    if (kw.text === "state") return { kind: "state", name: name, init: this.expr(), pos: kw.pos, persist: this.persist() }
    if (kw.text === "asset") {
      if (!this.isId(this.t(), "base64")) this.fail("expected base64\"...\"")
      this.next()
      this.expect(T_STR)
      return { kind: "asset", name: name, base64: this.literalString(this.next()).replace(/\s/g, ""), pos: kw.pos }
    }
    var e = this.expr()
    var d = { kind: "source", name: name, expr: e, every: null, json: false, timeout: null, pos: kw.pos, status: false, optional: false }
    while (this.t().type === T_IDENT && !this.t().nl) {
      var w = this.t().text
      if (w === "timeout") { this.next(); d.timeout = this.unary() }
      else if (w === "status") { this.next(); d.status = true }
      else if (w === "optional") { this.next(); d.optional = true }
      else if (w === "json") { this.next(); d.json = true }
      else if (w === "every") { this.next(); d.every = this.unary() }
      else break
    }
    return d
  },

  handler: function() {
    if (!this.isP(this.t(), "{")) return [this.stmt()]
    this.next()
    var out = []
    while (!this.isP(this.t(), "}")) {
      if (this.accept(";")) continue
      out.push(this.stmt())
    }
    this.punct("}")
    return out
  },

  stmt: function() {
    var start = this.t()
    if (start.type === T_IDENT && this.isP(this.peek(), "=")) {
      this.next()
      this.next()
      return { kind: "assign", name: start.text, value: this.expr(), pos: start.pos }
    }
    var e = this.expr()
    if (e.k !== "call") this.fail("expected an assignment (x = ...) or an action like run(\"...\")", start)
    return { kind: "do", call: e, pos: start.pos }
  },

  expr: function() {
    var c = this.binary(0)
    if (this.isP(this.t(), "?")) {
      var q = this.next()
      var a = this.expr()
      this.punct(":")
      return { k: "cond", c: c, a: a, b: this.expr(), pos: q.pos }
    }
    return c
  },

  binary: function(level) {
    if (level === LEVELS.length) return this.unary()
    var left = this.binary(level + 1)
    while (this.t().type === T_PUNCT && LEVELS[level].indexOf(this.t().text) >= 0) {
      var op = this.next()
      left = { k: "bin", op: op.text, a: left, b: this.binary(level + 1), pos: op.pos }
    }
    return left
  },

  unary: function() {
    if (this.isP(this.t(), "!") || this.isP(this.t(), "-")) {
      var op = this.next()
      return { k: "unary", op: op.text, e: this.unary(), pos: op.pos }
    }
    return this.postfix(this.primary())
  },

  postfix: function(e) {
    for (;;) {
      if (this.isP(this.t(), ".")) {
        this.next()
        var open = this.t()
        var name = this.t().type === T_NUM ? this.next().text : this.ident("field name")
        if (this.isP(this.t(), "(") && !this.t().nl) {
          var a = this.args()
          e = { k: "call", name: name, args: [e].concat(a[0]), named: a[1], pos: open.pos }
        } else {
          e = { k: "member", e: e, name: name, pos: open.pos }
        }
      } else if (this.isP(this.t(), "[") && !this.t().nl) {
        var br = this.next()
        var idx = this.expr()
        this.punct("]")
        e = { k: "index", e: e, i: idx, pos: br.pos }
      } else return e
    }
  },

  args: function() {
    this.punct("(")
    var args = [], named = []
    while (!this.isP(this.t(), ")")) {
      if (this.t().type === T_IDENT && this.isP(this.peek(), ":")) {
        var n = this.next().text
        this.next()
        named.push([n, this.expr()])
      } else {
        if (named.length) this.fail("positional arguments go before named ones")
        args.push(this.expr())
      }
      if (!this.accept(",")) break
    }
    this.punct(")")
    return [args, named]
  },

  isLambdaAhead: function() {
    if (this.t().type === T_IDENT) return this.isP(this.peek(), "=>")
    if (!this.isP(this.t(), "(")) return false
    for (var n = 1; ; n++) {
      var tok = this.peek(n)
      if (this.isP(tok, ")")) return this.isP(this.peek(n + 1), "=>")
      if (tok.type !== T_IDENT && !this.isP(tok, ",")) return false
    }
  },

  primary: function() {
    var tok = this.t()
    if (this.isLambdaAhead()) {
      var params = []
      if (!this.accept("(")) params.push(this.ident())
      else {
        while (!this.isP(this.t(), ")")) {
          params.push(this.ident("parameter"))
          if (!this.accept(",")) break
        }
        this.punct(")")
      }
      this.punct("=>")
      return { k: "lambda", params: params, body: this.expr(), pos: tok.pos }
    }
    if (tok.type === T_IDENT) {
      this.next()
      if (tok.text === "null") return { k: "lit", v: null, pos: tok.pos }
      if (tok.text === "true") return { k: "lit", v: true, pos: tok.pos }
      if (tok.text === "false") return { k: "lit", v: false, pos: tok.pos }
      if (this.isP(this.t(), "(") && !this.t().nl) {
        var a = this.args()
        return { k: "call", name: tok.text, args: a[0], named: a[1], pos: tok.pos }
      }
      return { k: "name", name: tok.text, pos: tok.pos }
    }
    if (tok.type === T_STR) {
      this.next()
      return this.stringExpr(tok)
    }
    if (tok.type === T_NUM) {
      this.next()
      if (tok.text.charAt(0) === "#") return { k: "lit", v: new Col(null, parseHex(tok.text), 1), pos: tok.pos }
      if (tok.pair) return { k: "lit", v: [tok.pair[0], tok.pair[1]], pos: tok.pos }
      return { k: "lit", v: tok.num, pos: tok.pos }
    }
    if (tok.type === T_PUNCT) {
      if (tok.text === "(") {
        this.next()
        var inner = this.expr()
        this.punct(")")
        return inner
      }
      if (tok.text === "[") {
        this.next()
        var items = []
        while (!this.isP(this.t(), "]")) {
          items.push(this.expr())
          if (!this.accept(",")) break
        }
        this.punct("]")
        return { k: "list", items: items, pos: tok.pos }
      }
      if (tok.text === "{") {
        this.next()
        var entries = []
        while (!this.isP(this.t(), "}")) {
          var key
          if (this.t().type === T_IDENT) key = this.next().text
          else if (this.t().type === T_STR) key = this.literalString(this.next())
          else this.fail("expected a key")
          this.punct(":")
          entries.push([key, this.expr()])
          if (!this.accept(",")) this.accept(";")
        }
        this.punct("}")
        return { k: "map", entries: entries, pos: tok.pos }
      }
    }
    if (tok.type === T_EOF) this.fail("expected a value, found end of file")
    this.fail("expected a value, found " + this.desc(tok))
  },

  stringExpr: function(tok) {
    if (tok.parts.length === 1 && tok.parts[0].lit !== undefined) return { k: "lit", v: tok.parts[0].lit, pos: tok.pos }
    var self = this
    var parts = tok.parts.map(function(part) {
      if (part.lit !== undefined) return { k: "lit", v: part.lit, pos: tok.pos }
      var sub = new Parser(self.src, lex(self.src, part.code[0], part.code[1]))
      var e = sub.expr()
      sub.expect(T_EOF)
      return e
    })
    return { k: "interp", parts: parts, pos: tok.pos }
  }
}

function parse(src) {
  return new Parser(src, lex(src)).widget()
}

// ----------------------------------------------------------------- builtins

var THEME = ["accent", "background", "foreground", "muted", "surface", "border", "red", "green", "yellow",
  "blue", "magenta", "cyan", "orange", "purple", "brown", "white", "black", "bright_red", "bright_green",
  "bright_yellow", "bright_blue", "bright_magenta", "bright_cyan", "bright_foreground", "dark_foreground",
  "lighter_background", "dark_background", "selection", "cursor"]
for (var ci = 0; ci <= 15; ci++) THEME.push("color" + ci)

var CONSTANTS = { pi: Math.PI, transparent: new Col(null, 0, 1) }

var ACTIONS = {
  terminal: [1, 2], app: [1, 1], run: [1, 1], url: [1, 1], launcher: [1, 1], refresh: [0, 1],
  media: [1, 1], androidApp: [1, 1], copy: [1, 1], notify: [1, 2], volume: [1, 1],
  notification: [2, 2], screen: [0, 0], close: [0, 0], torch: [1, 1], share: [1, 1], haptic: [0, 0]
}

function Args(args, host) {
  this.args = args
  this.host = host
  this.size = args.length
}

Args.prototype = {
  get: function(i) { return i >= 0 && i < this.args.length && this.args[i] !== undefined ? this.args[i] : null },
  num: function(i, def) {
    if (def === undefined) {
      var n = num(this.get(i))
      return n === null ? 0 : n
    }
    if (i >= this.args.length) return def
    var m = num(this.get(i))
    return m === null ? def : m
  },
  int: function(i, def) {
    if (i >= this.args.length) return def
    var n = num(this.get(i))
    return n === null ? def : toInt(n)
  },
  str: function(i) {
    var v = this.get(i)
    return v === null ? "" : show(v)
  },
  list: function(i) { return asList(this.get(i)) },
  fn: function(i) {
    var v = this.get(i)
    if (!(v instanceof Fn)) throw new WidgetError("argument " + (i + 1) + " must be a function like x => x.name")
    return v
  },
  tick: function(n) { if (this.host && this.host.budget) this.host.budget.tick(n) }
}

function asList(v) {
  if (Array.isArray(v)) return v
  if (v instanceof Map) {
    var out = []
    v.forEach(function(value) { out.push(value) })
    return out
  }
  return v === null || v === undefined ? [] : [v]
}

// Kotlin's Double.toInt: truncates, NaN is 0, and it saturates at Int's range.
function toInt(x) {
  if (x !== x) return 0
  if (x >= 2147483647) return 2147483647
  if (x <= -2147483648) return -2147483648
  return x < 0 ? Math.ceil(x) : Math.floor(x)
}

function toLong(x) {
  if (x !== x) return 0
  return x < 0 ? Math.ceil(x) : Math.floor(x)
}

// Kotlin's roundToLong: half rounds up (towards positive infinity).
function roundHalfUp(x) { return Math.floor(x + 0.5) }

function lst(items) { return items.length > 1000 ? items.slice(0, 1000) : items }

function compare(a, b) {
  var x = num(a), y = num(b)
  if (x !== null && y !== null) return x < y ? -1 : x > y ? 1 : 0
  var s = show(a), t = show(b)
  return s < t ? -1 : s > t ? 1 : 0
}

function stableSort(items, cmp) {
  var tagged = items.map(function(v, i) { return [v, i] })
  tagged.sort(function(p, q) { return cmp(p[0], q[0]) || p[1] - q[1] })
  return tagged.map(function(p) { return p[0] })
}

function uniq(items) {
  var out = []
  for (var i = 0; i < items.length; i++) {
    var seen = false
    for (var j = 0; j < out.length; j++) if (equals(out[j], items[i])) { seen = true; break }
    if (!seen) out.push(items[i])
  }
  return out
}

function indexIn(items, v) {
  for (var i = 0; i < items.length; i++) if (equals(items[i], v)) return i
  return -1
}

function clampNum(x, lo, hi) {
  if (hi < lo) hi = lo
  return x < lo ? lo : x > hi ? hi : x
}

function withAlpha(argb, alpha) {
  if (alpha >= 1) return argb >>> 0
  return ((Math.floor(((argb >>> 24) & 0xFF) * Math.fround(alpha)) << 24) | (argb & 0xFFFFFF)) >>> 0
}

// A value as a color, theme names still unresolved.
function color(v) {
  if (v instanceof Col) return v
  if (typeof v === "string") {
    if (v.charAt(0) === "#") {
      var n = parseHex(v)
      return n === null ? null : new Col(null, n, 1)
    }
    return THEME.indexOf(v) >= 0 ? new Col(v, THEME_GREY, 1) : null
  }
  return null
}

// A value as an ARGB int, theme names resolved by the host.
function argb(v, host) {
  if (v instanceof Col) {
    var base = v.theme !== null && host ? host.theme(v.theme) : null
    return withAlpha(base === null || base === undefined ? v.argb : base, v.alpha)
  }
  if (typeof v === "string") {
    if (v.charAt(0) === "#") return parseHex(v)
    var t = host ? host.theme(v) : null
    return t === undefined ? null : t
  }
  return null
}

function rgbChannel(x) { return Math.floor(clampNum(x, 0, 255) + 0.5) }

function rgb(r, g, b, a) {
  return new Col(null, ((rgbChannel(a * 255) << 24) | (rgbChannel(r) << 16) | (rgbChannel(g) << 8) | rgbChannel(b)) >>> 0, 1)
}

function hsl(h, s, l, a) {
  var hh = ((h % 360) + 360) % 360 / 60
  var c = (1 - Math.abs(2 * l - 1)) * s
  var x = c * (1 - Math.abs(hh % 2 - 1))
  var sector = toInt(hh)
  var t = sector === 0 ? [c, x, 0] : sector === 1 ? [x, c, 0] : sector === 2 ? [0, c, x]
    : sector === 3 ? [0, x, c] : sector === 4 ? [x, 0, c] : [c, 0, x]
  var m = l - c / 2
  return rgb((t[0] + m) * 255, (t[1] + m) * 255, (t[2] + m) * 255, a)
}

function gradient(radial, a, coords) {
  var colors = []
  a.list(coords).forEach(function(v) {
    var c = color(v)
    if (c !== null) colors.push(c)
  })
  if (colors.length < 2) throw new WidgetError("a gradient needs at least two colors")
  var cs = []
  for (var i = 0; i < coords; i++) cs.push(Math.fround(a.num(i)))
  return new Gradient(radial, cs, colors)
}

var regexCache = {}
function regex(p) {
  if (!regexCache.hasOwnProperty(p)) regexCache[p] = new RegExp(p)
  return regexCache[p]
}

function groups(m) {
  if (m.length > 1) {
    var out = []
    for (var i = 1; i < m.length; i++) out.push(m[i] === undefined ? "" : m[i])
    return out
  }
  return m[0]
}

// The first day of the week, as JS counts days (0 is Sunday), for the
// localized day-of-week letters `e` and `c`. The launcher takes it from the
// phone's locale; Monday is what the published calendar widget is drawn for.
var weekStart = 1
function setWeekStart(day) { weekStart = day }

var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"]

function zpad(n, w) {
  var s = String(n)
  while (s.length < w) s = "0" + s
  return s
}

// java.time's DateTimeFormatter, for the letters a widget would use. The
// launcher formats in the phone's locale; this phone's shell is English.
function fmtTime(seconds, pattern) {
  var d = new Date(Math.floor(seconds * 1000))
  var out = ""
  var i = 0
  while (i < pattern.length) {
    var c = pattern.charAt(i)
    if (c === "'") {
      var close = pattern.indexOf("'", i + 1)
      if (close < 0) throw new WidgetError("bad time pattern")
      out += close === i + 1 ? "'" : pattern.slice(i + 1, close)
      i = close + 1
      continue
    }
    if (!/[A-Za-z]/.test(c)) { out += c; i++; continue }
    var n = 1
    while (pattern.charAt(i + n) === c) n++
    i += n
    var h = d.getHours()
    if (c === "y" || c === "u") out += n === 2 ? zpad(d.getFullYear() % 100, 2) : zpad(d.getFullYear(), n)
    else if (c === "M" || c === "L") out += n >= 4 ? MONTHS[d.getMonth()] : n === 3 ? MONTHS[d.getMonth()].slice(0, 3) : zpad(d.getMonth() + 1, n)
    else if (c === "d") out += zpad(d.getDate(), n)
    else if (c === "E") out += n === 5 ? DAYS[d.getDay()].charAt(0) : n === 4 ? DAYS[d.getDay()] : DAYS[d.getDay()].slice(0, 3)
    else if (c === "e" || c === "c") out += n >= 4 ? DAYS[d.getDay()] : n === 3 ? DAYS[d.getDay()].slice(0, 3) : String((d.getDay() - weekStart + 7) % 7 + 1)
    else if (c === "H") out += zpad(h, n)
    else if (c === "k") out += zpad(h === 0 ? 24 : h, n)
    else if (c === "h") out += zpad(h % 12 === 0 ? 12 : h % 12, n)
    else if (c === "K") out += zpad(h % 12, n)
    else if (c === "m") out += zpad(d.getMinutes(), n)
    else if (c === "s") out += zpad(d.getSeconds(), n)
    else if (c === "S") out += zpad(d.getMilliseconds(), 3).slice(0, n)
    else if (c === "a") out += h < 12 ? "AM" : "PM"
    else if (c === "D") {
      var start = new Date(d.getFullYear(), 0, 1)
      out += zpad(Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - start) / 86400000) + 1, n)
    } else if (c === "Q" || c === "q") out += String(Math.floor(d.getMonth() / 3) + 1)
    else if (c === "Z" || c === "x" || c === "X") {
      var off = -d.getTimezoneOffset()
      var sign = off < 0 ? "-" : "+"
      off = Math.abs(off)
      out += sign + zpad(Math.floor(off / 60), 2) + (n >= 3 || c === "Z" ? (c === "Z" && n < 4 ? "" : ":") : "") + zpad(off % 60, 2)
    } else throw new WidgetError("bad time pattern")
  }
  return out
}

function weatherIcon(code, night) {
  switch (code) {
  case 113: return night ? "" : ""
  case 116: return night ? "" : ""
  case 143: case 248: case 260: return night ? "" : ""
  case 176: case 263: case 353: return night ? "" : ""
  case 179: case 227: case 230: case 323: case 326: case 368: return night ? "" : ""
  case 182: case 185: case 281: case 284: case 311: case 314: case 317: case 320: case 350: case 362:
  case 365: case 374: case 377: return ""
  case 200: case 386: case 389: case 392: case 395: return ""
  case 266: case 293: case 296: case 299: case 302: case 305: case 308: case 356: case 359: return ""
  case 329: case 332: case 335: case 338: case 371: return ""
  default: return ""
  }
}

// String.format("%.Nf", x) in Locale.ROOT. Java rounds the number's
// shortest decimal form half up -- 1.005 is "1.01" -- where toFixed rounds
// its binary value, 1.00499..., to "1.00". So this rounds the digits.
function fixed(x, digits) {
  if (x !== x) return "NaN"
  if (!isFinite(x)) return x > 0 ? "Infinity" : "-Infinity"
  var d = clampNum(digits, 0, 10)
  var negative = x < 0 || (x === 0 && 1 / x < 0)
  var t = plainDecimal(Math.abs(x))
  var dot = t.indexOf(".")
  var whole = dot < 0 ? t : t.slice(0, dot)
  var frac = dot < 0 ? "" : t.slice(dot + 1)
  while (frac.length < d + 1) frac += "0"
  var keep = whole + frac.slice(0, d)
  if (frac.charAt(d) >= "5") {
    var ds = keep.split("")
    var i = ds.length - 1
    while (i >= 0) {
      if (ds[i] === "9") { ds[i] = "0"; i-- }
      else { ds[i] = String.fromCharCode(ds[i].charCodeAt(0) + 1); break }
    }
    keep = (i < 0 ? "1" : "") + ds.join("")
  }
  var w = keep.slice(0, keep.length - d)
  return (negative ? "-" : "") + (w === "" ? "0" : w) + (d > 0 ? "." + keep.slice(keep.length - d) : "")
}

// A non-negative number's shortest decimal digits, never in exponent form.
function plainDecimal(x) {
  var s = String(x)
  var e = s.indexOf("e")
  if (e < 0) return s
  var mant = s.slice(0, e).replace(".", "")
  var exp = parseInt(s.slice(e + 1), 10)
  var point = (s.indexOf(".") < 0 ? s.slice(0, e).length : s.indexOf(".")) + exp
  if (point <= 0) {
    var zeros = ""
    for (var i = 0; i < -point; i++) zeros += "0"
    return "0." + zeros + mant
  }
  while (mant.length < point) mant += "0"
  return mant.slice(0, point) + (point < mant.length ? "." + mant.slice(point) : "")
}

function padStr(s, w, c) {
  var pad = ""
  var n = Math.abs(w) - s.length
  for (var i = 0; i < n; i++) pad += c
  return w >= 0 ? pad + s : s + pad
}

function linesOf(s) { return s.split(/\r\n|\n|\r/) }

function splitStr(s, sep) {
  if (sep === "") {
    var out = [""]
    for (var i = 0; i < s.length; i++) out.push(s.charAt(i))
    out.push("")
    return out
  }
  return s.split(sep)
}

function strict(f) { return function(a) { return a.get(0) === null ? null : f(a) } }
function math(f) { return { min: 1, max: 1, pure: true, impl: strict(function(a) { return f(a.num(0)) }) } }
function B(min, max, impl, pure) { return { min: min, max: max, pure: pure === undefined ? true : pure, impl: impl } }

function callFn(f, args) { return f.call(args) }

var BUILTINS = {
  min: B(1, 16, function(a) {
    if (a.size === 1) {
      var ns = a.list(0).map(num).filter(function(n) { return n !== null })
      return ns.length ? ns.reduce(function(p, q) { return Math.min(p, q) }) : null
    }
    return a.args.map(function(v) { var n = num(v); return n === null ? Number.MAX_VALUE : n })
      .reduce(function(p, q) { return Math.min(p, q) })
  }),
  max: B(1, 16, function(a) {
    if (a.size === 1) {
      var ns = a.list(0).map(num).filter(function(n) { return n !== null })
      return ns.length ? ns.reduce(function(p, q) { return Math.max(p, q) }) : null
    }
    return a.args.map(function(v) { var n = num(v); return n === null ? -Number.MAX_VALUE : n })
      .reduce(function(p, q) { return Math.max(p, q) })
  }),
  clamp: B(3, 3, function(a) { return clampNum(a.num(0), a.num(1), a.num(2)) }),
  lerp: B(3, 3, function(a) { return a.num(0) + (a.num(1) - a.num(0)) * a.num(2) }),
  round: B(1, 2, strict(function(a) {
    var p = Math.pow(10, a.int(1, 0))
    return roundHalfUp(a.num(0) * p) / p
  })),
  floor: math(Math.floor), ceil: math(Math.ceil), abs: math(Math.abs), sqrt: math(Math.sqrt),
  sin: math(Math.sin), cos: math(Math.cos), tan: math(Math.tan),
  rad: math(function(x) { return x / 180 * Math.PI }), deg: math(function(x) { return x * 180 / Math.PI }),
  sign: math(function(x) { return x !== x ? x : x > 0 ? 1 : x < 0 ? -1 : x }),
  pow: B(2, 2, strict(function(a) { return Math.pow(a.num(0), a.num(1)) })),
  atan2: B(2, 2, function(a) { return Math.atan2(a.num(0), a.num(1)) }),
  num: B(1, 2, function(a) {
    var n = num(a.get(0))
    return n !== null ? n : a.size > 1 ? a.get(1) : null
  }),
  int: B(1, 1, strict(function(a) {
    var n = num(a.get(0))
    return n === null ? null : toLong(n)
  })),
  str: B(1, 1, function(a) { return a.str(0) }),
  len: B(1, 1, function(a) {
    var v = a.get(0)
    return Array.isArray(v) ? v.length : v instanceof Map ? v.size : typeof v === "string" ? v.length : 0
  }),
  trim: B(1, 1, function(a) { return a.str(0).trim() }),
  upper: B(1, 1, function(a) { return a.str(0).toUpperCase() }),
  lower: B(1, 1, function(a) { return a.str(0).toLowerCase() }),
  lines: B(1, 1, function(a) { return lst(linesOf(a.str(0)).filter(function(l) { return l.trim() !== "" })) }),
  words: B(1, 1, function(a) { return lst(a.str(0).trim().split(/\s+/).filter(function(w) { return w.length > 0 })) }),
  split: B(2, 2, function(a) { return lst(splitStr(a.str(0), a.str(1))) }),
  join: B(1, 2, function(a) {
    return a.list(0).map(function(v) { return typeof v === "string" ? v : show(v) }).join(a.size > 1 ? a.str(1) : "")
  }),
  replace: B(3, 3, function(a) {
    var s = a.str(0), f = a.str(1), r = a.str(2)
    if (f === "") return splitStr(s, "").join(r)
    return s.split(f).join(r)
  }),
  // owl 6: a value as one shell word, for commands put together while the widget runs.
  sh: B(1, 1, function(a) {
    var v = a.get(0)
    return "'" + (v === null ? "" : text(v)).split("'").join("'\\''") + "'"
  }),
  startsWith: B(2, 2, function(a) { return a.str(0).indexOf(a.str(1)) === 0 }),
  endsWith: B(2, 2, function(a) {
    var s = a.str(0), e = a.str(1)
    return s.length >= e.length && s.slice(s.length - e.length) === e
  }),
  contains: B(2, 2, function(a) {
    var v = a.get(0)
    if (Array.isArray(v)) return indexIn(v, a.get(1)) >= 0
    if (v instanceof Map) return v.has(a.str(1))
    return a.str(0).indexOf(a.str(1)) >= 0
  }),
  sub: B(2, 3, function(a) {
    var s = a.str(0)
    var f = a.int(1, 0)
    var from = clampNum(f < 0 ? s.length + f : f, 0, s.length)
    var t = a.int(2, s.length)
    var to = clampNum(t < 0 ? s.length + t : t, from, s.length)
    return s.slice(from, to)
  }),
  pad: B(2, 3, strict(function(a) {
    var c = a.str(2)
    return padStr(a.str(0), a.int(1, 0), c.length ? c.charAt(0) : " ")
  })),
  fixed: B(2, 2, strict(function(a) { return fixed(a.num(0), a.int(1, 0)) })),
  fmtBytes: B(1, 1, strict(function(a) {
    var v = a.num(0)
    var units = ["B", "K", "M", "G", "T", "P"]
    var unit = 0
    while (Math.abs(v) >= 1024 && unit < units.length - 1) { v /= 1024; unit++ }
    return unit === 0 ? numText(toLong(v)) + "B" : fixed(v, v < 10 ? 1 : 0) + units[unit]
  })),
  fmtDuration: B(1, 1, strict(function(a) {
    var s = Math.max(toLong(a.num(0)), 0)
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60)
    return d > 0 ? d + "d " + h + "h" : h > 0 ? h + "h " + m + "m" : m > 0 ? m + "m " + s % 60 + "s" : s + "s"
  })),
  fmtTime: B(2, 2, strict(function(a) {
    try { return fmtTime(a.num(0), a.str(1)) } catch (e) { throw new WidgetError("bad time pattern '" + a.str(1) + "'") }
  })),
  weatherIcon: B(1, 2, function(a) { return weatherIcon(a.int(0, 0), truthy(a.get(1))) }),
  match: B(2, 2, function(a) {
    var m = regex(a.str(1)).exec(a.str(0))
    return m ? (m.length > 1 ? lst(groups(m)) : m[0]) : null
  }),
  matchAll: B(2, 2, function(a) {
    var re = new RegExp(regex(a.str(1)).source, "g")
    var s = a.str(0)
    var out = []
    var m
    while (out.length < 1000 && (m = re.exec(s)) !== null) {
      out.push(groups(m))
      if (m[0] === "") re.lastIndex++
    }
    return out
  }),
  parseJson: B(1, 1, function(a) { return parseOrText(a.str(0)) }),
  range: B(1, 3, function(a) {
    var from = a.size === 1 ? 0 : a.num(0)
    var to = a.size === 1 ? a.num(0) : a.num(1)
    var step = a.num(2, 1)
    if (step === 0) step = 1
    var out = []
    for (var x = from; ((step > 0 && x < to) || (step < 0 && x > to)) && out.length < 1000; x += step) out.push(x)
    return out
  }),
  map: B(2, 2, function(a) {
    var f = a.fn(1), l = a.list(0)
    a.tick(l.length)
    return lst(l.map(function(v, i) { return callFn(f, [v, i]) }))
  }),
  filter: B(2, 2, function(a) {
    var f = a.fn(1), l = a.list(0)
    a.tick(l.length)
    return lst(l.filter(function(v, i) { return truthy(callFn(f, [v, i])) }))
  }),
  find: B(2, 2, function(a) {
    var f = a.fn(1), l = a.list(0)
    for (var i = 0; i < l.length; i++) if (truthy(callFn(f, [l[i]]))) return l[i]
    return null
  }),
  any: B(2, 2, function(a) {
    var f = a.fn(1), l = a.list(0)
    for (var i = 0; i < l.length; i++) if (truthy(callFn(f, [l[i]]))) return true
    return false
  }),
  all: B(2, 2, function(a) {
    var f = a.fn(1), l = a.list(0)
    for (var i = 0; i < l.length; i++) if (!truthy(callFn(f, [l[i]]))) return false
    return true
  }),
  count: B(1, 2, function(a) {
    if (a.size > 1) {
      var f = a.fn(1)
      return a.list(0).filter(function(v) { return truthy(callFn(f, [v])) }).length
    }
    return a.list(0).length
  }),
  sum: B(1, 2, function(a) {
    var f = a.size > 1 ? a.fn(1) : null
    return a.list(0).reduce(function(acc, v) {
      var n = num(f ? callFn(f, [v]) : v)
      return acc + (n === null ? 0 : n)
    }, 0)
  }),
  avg: B(1, 2, function(a) {
    var l = a.list(0)
    var f = a.size > 1 ? a.fn(1) : null
    if (!l.length) return null
    return l.reduce(function(acc, v) {
      var n = num(f ? callFn(f, [v]) : v)
      return acc + (n === null ? 0 : n)
    }, 0) / l.length
  }),
  sort: B(1, 1, function(a) { return lst(stableSort(a.list(0), compare)) }),
  sortBy: B(2, 2, function(a) {
    var f = a.fn(1), l = a.list(0)
    a.tick(l.length * 4)
    var keyed = l.map(function(v) { return [v, callFn(f, [v])] })
    return lst(stableSort(keyed, function(p, q) { return compare(p[1], q[1]) }).map(function(p) { return p[0] }))
  }),
  reverse: B(1, 1, function(a) { return lst(a.list(0).slice().reverse()) }),
  take: B(2, 2, function(a) {
    var k = Math.max(a.int(1, 0), 0)
    return typeof a.get(0) === "string" ? a.str(0).slice(0, k) : lst(a.list(0).slice(0, k))
  }),
  drop: B(2, 2, function(a) {
    var k = Math.max(a.int(1, 0), 0)
    return typeof a.get(0) === "string" ? a.str(0).slice(k) : lst(a.list(0).slice(k))
  }),
  first: B(1, 1, function(a) { var l = a.list(0); return l.length ? l[0] : null }),
  last: B(1, 1, function(a) { var l = a.list(0); return l.length ? l[l.length - 1] : null }),
  indexOf: B(2, 2, function(a) { return indexIn(a.list(0), a.get(1)) }),
  unique: B(1, 1, function(a) { return lst(uniq(a.list(0))) }),
  flatten: B(1, 1, function(a) {
    var out = []
    a.list(0).forEach(function(v) { if (Array.isArray(v)) out.push.apply(out, v); else out.push(v) })
    return lst(out)
  }),
  keys: B(1, 1, function(a) {
    var v = a.get(0)
    if (!(v instanceof Map)) return []
    var out = []
    v.forEach(function(value, key) { out.push(key) })
    return lst(out)
  }),
  values: B(1, 1, function(a) {
    var v = a.get(0)
    return v instanceof Map ? lst(asList(v)) : []
  }),
  entries: B(1, 1, function(a) {
    var v = a.get(0)
    if (!(v instanceof Map)) return []
    var out = []
    v.forEach(function(value, key) { out.push(new Map([["key", key], ["value", value]])) })
    return lst(out)
  }),
  get: B(2, 3, function(a) {
    var v = member(a.get(0), a.str(1))
    return v !== null ? v : a.get(2)
  }),
  rgb: B(3, 4, function(a) { return rgb(a.num(0), a.num(1), a.num(2), a.num(3, 1)) }),
  hsl: B(3, 4, function(a) { return hsl(a.num(0), a.num(1), a.num(2), a.num(3, 1)) }),
  alpha: B(2, 2, function(a) {
    var c = color(a.get(0))
    if (c === null) throw new WidgetError("alpha() needs a color")
    return new Col(c.theme, c.argb, Math.fround(c.alpha * Math.fround(clampNum(Math.fround(a.num(1)), 0, 1))))
  }),
  mix: B(3, 3, function(a) {
    var x = argb(a.get(0), a.host)
    if (x === null) throw new WidgetError("mix() needs colors")
    var y = argb(a.get(1), a.host)
    if (y === null) throw new WidgetError("mix() needs colors")
    var t = clampNum(a.num(2), 0, 1)
    var out = 0
    for (var shift = 24; shift >= 0; shift -= 8) {
      out |= Math.floor(((x >>> shift) & 0xFF) * (1 - t) + ((y >>> shift) & 0xFF) * t + 0.5) << shift
    }
    return new Col(null, out >>> 0, 1)
  }, false),
  spring: B(0, 2, function(a) {
    return new Map([["type", "spring"], ["damping", a.num(0, 0.6)], ["stiffness", a.num(1, 300)]])
  }),
  tween: B(0, 2, function(a) {
    return new Map([["type", "tween"], ["duration", a.num(0, 0.3)], ["easing", a.size > 1 ? a.str(1) : "ease"]])
  }),
  linear: B(5, 5, function(a) { return gradient(false, a, 4) }),
  radial: B(4, 4, function(a) { return gradient(true, a, 3) })
}

function member(v, name) {
  if (v instanceof Map) {
    var f = v.get(name)
    return f === undefined ? null : f
  }
  if (Array.isArray(v)) {
    if (/^-?\d+$/.test(name)) {
      var i = parseInt(name, 10)
      var it = v[i < 0 ? v.length + i : i]
      if (it !== undefined) return it
    }
    return name === "length" ? v.length : null
  }
  if (typeof v === "string") return name === "length" ? v.length : null
  return null
}

function index(v, i) {
  if (Array.isArray(v)) {
    var n = num(i)
    if (n === null) return null
    var k = toInt(n)
    var it = v[k < 0 ? v.length + k : k]
    return it === undefined ? null : it
  }
  if (v instanceof Map) {
    var f = v.get(show(i))
    return f === undefined ? null : f
  }
  if (typeof v === "string") {
    var m = num(i)
    if (m === null) return null
    var j = toInt(m)
    var c = v.charAt(j < 0 ? v.length + j : j)
    return c === "" || (j < 0 ? v.length + j : j) < 0 ? null : c
  }
  return null
}

function arith(f) {
  return function(a, b) {
    if (typeof a === "number" && typeof b === "number") return f(a, b)
    var x = num(a), y = num(b)
    return x === null || y === null ? null : f(x, y)
  }
}

function cmp(test) {
  return function(a, b) {
    if (typeof a === "number" && typeof b === "number") return test(a < b ? -1 : a > b ? 1 : a === b ? 0 : (a !== a ? (b !== b ? 0 : 1) : -1))
    if (a === null || b === null) return false
    return test(compare(a, b))
  }
}

var OPERATORS = {
  "+": function(a, b) {
    if (typeof a === "number" && typeof b === "number") return a + b
    if (Array.isArray(a) && Array.isArray(b)) return lst(a.concat(b))
    // Strings join as written ("- " + x keeps its space); only other values are formatted.
    if (typeof a === "string" || typeof b === "string")
      return (typeof a === "string" ? a : text(a)) + (typeof b === "string" ? b : text(b))
    var x = num(a), y = num(b)
    return x !== null && y !== null ? x + y : null
  },
  "-": arith(function(x, y) { return x - y }),
  "*": arith(function(x, y) { return x * y }),
  "/": arith(function(x, y) { return y === 0 ? 0 : x / y }),
  "%": arith(function(x, y) { return y === 0 ? 0 : ((x % y) + y) % y }),
  "==": function(a, b) { return looseEquals(a, b) },
  "!=": function(a, b) { return !looseEquals(a, b) },
  "<": cmp(function(c) { return c < 0 }),
  "<=": cmp(function(c) { return c <= 0 }),
  ">": cmp(function(c) { return c > 0 }),
  ">=": cmp(function(c) { return c >= 0 })
}

// ---------------------------------------------------------------- compiler

var LEVEL = 7
var MAX_NODES = 500
var MAX_SCREEN_NODES = 1000
var MAX_ASSET_BYTES = 2097152

var KINDS = {
  Column: [["gap", "align", "justify", "scroll"], "ui"],
  Row: [["gap", "align", "justify", "wrap"], "ui"],
  Flow: [["gap", "align", "justify"], "ui"],
  Box: [["align"], "ui"],
  Grid: [["columns", "gap"], "ui"],
  Text: [["text", "style", "color", "fontSize", "bold", "italic", "font", "align", "maxLines"], "none"],
  Image: [["src", "fit", "tint"], "none"],
  Button: [["text", "color"], "none"],
  Progress: [["value", "max", "color", "track"], "none"],
  Ring: [["value", "max", "color", "track", "thickness", "start", "sweep"], "none"],
  Sparkline: [["values", "min", "max", "color", "area", "thickness"], "none"],
  Canvas: [[], "draw"],
  Shader: [["code", "uniforms", "fallback"], "none"],
  Spacer: [[], "none"],
  Terminal: [["command", "fontSize"], "none"],
  Slider: [["value", "min", "max", "step", "color", "track", "live"], "none"],
  Input: [["text", "placeholder", "color", "fontSize", "clear", "focus"], "none"]
}
var KIND_NAMES = Object.keys(KINDS)
var COMMON = ["width", "height", "size", "fill", "weight", "padding", "background", "border", "borderColor",
  "radius", "opacity", "rotation", "scale", "offset", "clip", "visible"]
var ANIMATABLE = ["opacity", "rotation", "scale", "value", "color", "background"]
var ALIGN = ["start", "center", "end", "top", "bottom", "topStart", "topEnd", "bottomStart", "bottomEnd"]
var ENUMS = {
  style: ["huge", "title", "body", "small", "muted", "label"],
  align: ALIGN,
  justify: ["start", "center", "end", "spaceBetween", "spaceAround", "spaceEvenly"],
  fit: ["contain", "cover", "fill"],
  font: ["mono", "sans", "serif", "icon"],
  fill: ["width", "height"],
  cap: ["round", "butt", "square"]
}
var ENUM_WORDS = []
for (var ek in ENUMS) ENUM_WORDS = ENUM_WORDS.concat(ENUMS[ek])

var DRAW = {
  rect: [4, 4, false], circle: [3, 3, false], arc: [5, 5, false], line: [4, 4, false], path: [1, 1, false],
  text: [3, 3, false], image: [5, 5, false], translate: [2, 2, true], rotate: [1, 3, true], scale: [1, 4, true],
  clip: [4, 4, true], layer: [1, 1, true], sprite: [4, 4, false]
}
var DRAW_NAMED = ["fill", "stroke", "width", "cap", "radius", "closed", "size", "color", "align", "bold", "palette"]

var SINCE = { Terminal: 2, sprite: 3 }
;["Slider", "Input", "file", "android.notifications", "android.volume", "volume", "notification", "every", "at", "when", "on"]
  .forEach(function(k) { SINCE[k] = 4 })
;["screen", "close", "screenWidth", "screenHeight", "optional", "linux", "android.system"]
  .forEach(function(k) { SINCE[k] = 5 })
// owl 6: values in commands, quoted, and the launcher's corner style.
SINCE.sh = 6
SINCE.corners = 6
SINCE["Input.focus"] = 6
// owl 7: more of the phone: the next alarm, its modes, the torch, the share sheet, haptics.
;["android.alarm", "android.modes", "torch", "share", "haptic"].forEach(function(k) { SINCE[k] = 7 })

var MANAGERS = { pacman: /^[a-z0-9@_+][a-z0-9@._+-]*$/ }
var HANDLER_PARAMS = { onTap: ["x", "y"], onDrag: ["dx", "dy", "x", "y"], onChange: ["value"], onSubmit: ["value"] }
var HANDLER_KINDS = { onChange: ["Slider", "Input"], onSubmit: ["Input"] }
var TRIGGER_PARAMS = { on: ["value", "old"] }
var ANDROID = ["battery", "device", "media", "notifications", "volume", "system", "alarm", "modes"]
var MEDIA = ["toggle", "play", "pause", "next", "previous", "open"]
var VOLUME = ["up", "down", "mute", "unmute", "toggle"]
var TORCH = ["on", "off", "toggle"]
var NOTIFICATION = ["open", "dismiss"]
var TILE = ["cols", "rows", "tileWidth", "tileHeight", "screenWidth", "screenHeight", "corners"]
var WIDGET_PROPS = ["size", "minSize", "page", "order", "padding", "background"]

// An evaluator: `c` is set when the value is known at compile time.
function Ev(f, constant, hasConst) {
  this.f = f
  this.c = constant
  this.k = hasConst === true
}

function evOf(v) { return new Ev(function() { return v }, v, true) }
function run(ev, env) { return ev.k ? ev.c : ev.f(env) }

function Env(host, parent, slots) {
  this.host = host
  this.parent = parent
  this.slots = slots
}

function Lazy(ev) { this.ev = ev }

Env.prototype = {
  local: function(depth, i) {
    var e = this
    for (var d = 0; d < depth; d++) e = e.parent
    var v = e.slots[i]
    if (v instanceof Lazy) {
      v = run(v.ev, e)
      e.slots[i] = v
    }
    return v === undefined ? null : v
  },
  child: function(values) { return new Env(this.host, this, values) },
  lets: function(evs) { return new Env(this.host, this, evs.map(function(ev) { return new Lazy(ev) })) }
}

function Budget(limit) {
  this.limit = limit || 200000
  this.steps = 0
  this.depth = 0
}

Budget.prototype = {
  run: function(block) {
    if (this.depth++ === 0) this.steps = 0
    try { return block() } finally { this.depth-- }
  },
  tick: function(n) {
    this.steps += n === undefined ? 1 : n
    if (this.steps > this.limit) throw new WidgetError("too much work in one update (over " + this.limit + " steps)")
  }
}

var CONST_HOST = {
  budget: new Budget(200000),
  read: function() { throw new Error("const") },
  write: function() { throw new Error("const") },
  theme: function() { return null },
  time: function() { return 0 },
  tile: function() { return null },
  act: function() { throw new Error("const") }
}

function Scope(parent, names, visible) {
  this.parent = parent
  this.names = names
  this.visible = visible === undefined ? names.length : visible
}

function Compiler(ast) {
  this.ast = ast
  this.root = new Scope(null, [])
  this.globals = []
  this.slots = {}
  this.states = {}
  this.sources = {}
  this.components = {}
  this.commands = []
  this.guest = false
  this.animated = false
  this.terminal = false
  this.nodes = 0
  this.maxNodes = MAX_NODES
  this.screenAction = null
  this.needs = null
  // Whether nodes being compiled are the screen's (true) or the tile's (false); null in components.
  this.inScreen = null
}

function messageOf(e) {
  if (e instanceof CompileError || e instanceof WidgetError) return e.message
  return e && e.message ? e.message : String(e)
}

Compiler.prototype = {
  fail: function(msg, pos) { throw new CompileError(msg, pos) },

  since: function(feature, pos) {
    var v = SINCE[feature]
    if (v !== undefined && v > (this.needs ? this.needs[0] : 1)) this.needs = [v, feature, pos]
  },

  program: function() {
    var self = this
    var body = this.ast.body
    var metaFields = []
    body.decls.forEach(function(d) { if (d.kind === "meta") metaFields = metaFields.concat(d.fields) })
    var levelField = null
    for (var i = 0; i < metaFields.length; i++) if (metaFields[i].name === "owl") { levelField = metaFields[i]; break }
    var level = 1
    if (levelField) {
      var lv = num(this.constant(levelField.value, "meta values"))
      if (lv === null) this.fail("owl: takes a number, like owl: 1", levelField.pos)
      level = toInt(lv)
    }
    if (level > LEVEL)
      this.fail("this widget needs owl " + level + "; the launcher supports up to " + LEVEL + ", so update the launcher", levelField.pos)
    if (body.animations.length) this.fail("animate belongs inside a node", body.animations[0].pos)
    body.handlers.forEach(function(h) {
      if (h.name !== "onTap") self.fail("a widget only takes onTap at the top level", h.pos)
    })
    body.decls.forEach(function(d) {
      if (d.kind !== "meta" && d.kind !== "trigger" && d.kind !== "requires" && self.slots.hasOwnProperty(d.name))
        self.fail("'" + d.name + "' is already declared", d.pos)
      if (d.kind === "source") { self.reserve(d.name, d.pos); self.sources[d.name] = true }
      else if (d.kind === "state") { self.reserve(d.name, d.pos); self.states[d.name] = true }
      else if (d.kind === "asset") self.reserve(d.name, d.pos)
    })
    body.decls.forEach(function(d) {
      if (d.kind === "source") self.globals[self.slots[d.name]] = self.source(d)
      else if (d.kind === "state")
        self.globals[self.slots[d.name]] = { type: "state", name: d.name, init: self.ex(d.init, self.root), persist: d.persist }
      else if (d.kind === "asset") self.globals[self.slots[d.name]] = self.asset(d)
      else if (d.kind === "let") {
        var g = self.let(d)
        self.reserve(d.name, d.pos)
        self.globals[self.slots[d.name]] = g
      } else if (d.kind === "component") {
        if (self.components.hasOwnProperty(d.name) || KINDS.hasOwnProperty(d.name))
          self.fail("'" + d.name + "' is already a node", d.pos)
        self.components[d.name] = self.component(d)
      }
    })
    var triggers = body.decls.filter(function(d) { return d.kind === "trigger" }).map(function(d) { return self.trigger(d) })
    var props = {}
    body.props.forEach(function(p) {
      props[p.name] = p
      if (WIDGET_PROPS.indexOf(p.name) < 0)
        self.fail("unknown widget property '" + p.name + "' (" + WIDGET_PROPS.join(", ") + ")", p.pos)
    })
    var meta = {}
    metaFields.forEach(function(f) { meta[f.name] = self.constant(f.value, "meta values") })
    var reqFields = []
    body.decls.forEach(function(d) { if (d.kind === "requires") reqFields = reqFields.concat(d.fields) })
    var requires = this.requires(reqFields)
    var screens = body.items.filter(function(it) { return it.kind === "node" && it.type === "screen" })
    if (screens.length > 1) this.fail("a widget has one screen { }", screens[1].pos)
    this.inScreen = false
    var rootNodes = this.items(body.items.filter(function(it) { return screens.indexOf(it) < 0 }), this.root, "ui")
    if (!rootNodes.length) this.fail("a widget needs at least one node, like Text { text: \"hi\" }", 0)
    var tileNodes = this.nodes
    var screen = screens.length ? this.screen(screens[0]) : null
    var onTap = body.handlers.length ? this.handler(body.handlers[0], this.root) : null
    if (screen === null && this.screenAction !== null)
      this.fail("screen() and close() need a screen { } block in the widget", this.screenAction)
    if (this.needs && level < this.needs[0])
      this.fail(this.needs[1] + " needs owl " + this.needs[0] + ": add meta { owl: " + this.needs[0] + " }", this.needs[2])
    var padding = 12
    if (props.padding) {
      var pv = num(this.constant(props.padding.value, "padding"))
      if (pv !== null) padding = pv
    }
    return {
      name: this.ast.name === null ? "widget" : this.ast.name,
      meta: meta,
      level: level,
      size: props.size ? this.cells(props.size) : null,
      minSize: props.minSize ? this.cells(props.minSize) : [1, 1],
      page: props.page ? Math.max(this.constInt(props.page), 1) : 1,
      order: props.order ? this.constInt(props.order) : 0,
      padding: padding,
      background: props.background ? this.ex(props.background.value, this.root) : null,
      globals: this.globals,
      root: rootNodes,
      screen: screen ? screen[0] : null,
      screenTitle: screen ? screen[1] : null,
      onTap: onTap,
      triggers: triggers,
      commands: this.commands,
      requires: requires,
      needsLinux: this.guest || Object.keys(requires).length > 0,
      animated: this.animated,
      terminal: this.terminal,
      nodeCount: tileNodes
    }
  },

  screen: function(n) {
    var self = this
    this.since("screen", n.pos)
    var body = n.body
    body.props.forEach(function(p) {
      if (p.name !== "title") self.fail("a screen only takes title (its nodes go inside it)", p.pos)
    })
    if (body.handlers.length) this.fail("handlers go on the nodes inside a screen", body.handlers[0].pos)
    if (body.animations.length) this.fail("animate belongs inside a node", body.animations[0].pos)
    this.nodes = 0
    this.maxNodes = MAX_SCREEN_NODES
    this.inScreen = true
    var tree = this.items(body.items, this.root, "ui")
    if (!tree.length) this.fail("a screen needs at least one node", n.pos)
    return [tree, body.props.length ? this.ex(body.props[0].value, this.root) : null]
  },

  reserve: function(name, pos) {
    if (THEME.indexOf(name) >= 0 || CONSTANTS.hasOwnProperty(name) || name === "time")
      this.fail("'" + name + "' is a built-in name", pos)
    this.slots[name] = this.globals.length
    this.globals.push(null)
    return this.globals.length - 1
  },

  constant: function(e, what) {
    var ev = this.ex(e, this.root)
    if (!ev.k) this.fail(what + " must be constant", e.pos)
    return ev.c
  },

  constInt: function(p) {
    var d = num(this.constant(p.value, p.name))
    if (d === null) this.fail(p.name + " must be a number", p.pos)
    return toInt(d)
  },

  cells: function(p) {
    var v = this.constant(p.value, p.name)
    var w = Array.isArray(v) && v.length > 0 ? num(v[0]) : null
    var h = Array.isArray(v) && v.length > 1 ? num(v[1]) : null
    if (!Array.isArray(v) || v.length !== 2 || w === null || h === null)
      this.fail(p.name + " is columns x rows, like 3x2", p.pos)
    return [Math.max(toInt(w), 1), Math.max(toInt(h), 1)]
  },

  source: function(d) {
    var e = d.expr
    var isCall = e.k === "call"
    if (d.status && !(isCall && (e.name === "cmd" || e.name === "http")))
      this.fail("status only works on cmd(...) and http(...)", d.pos)
    if (d.optional) {
      if (!isCall || ["cmd", "stream", "file"].indexOf(e.name) < 0)
        this.fail("optional only works on cmd(...), stream(...) and file(...), which need Linux", d.pos)
      this.since("optional", d.pos)
    }
    var listed = d.optional ? "if Linux is installed: " : ""
    var every = d.every ? num(this.constant(d.every, "every")) : null
    var timeout = 10
    if (d.timeout) {
      var tv = num(this.constant(d.timeout, "timeout"))
      if (tv !== null) timeout = toInt(tv)
    }
    var src = { type: "source", name: d.name, kind: null, arg: null, every: 0, json: d.json,
      timeout: clampNum(timeout, 1, 300), status: d.status, headers: null, optional: d.optional }
    if (isCall && e.name === "http") {
      if (e.args.length < 1 || e.args.length > 2 || e.named.length)
        this.fail("http(\"https://...\") takes a URL and optionally a map of headers", e.pos)
      var url = this.ex(e.args[0], this.root)
      if (url.k && typeof url.c === "string" && url.c.indexOf("https://") !== 0 && url.c.indexOf("http://") !== 0)
        this.fail("http takes an http:// or https:// URL", e.args[0].pos)
      this.commands.push("http GET " + (url.k && typeof url.c === "string" ? url.c : "(a URL built from widget values)"))
      src.kind = "http"
      src.arg = url
      src.every = Math.max(every === null ? 60 : every, 5)
      src.headers = e.args.length > 1 ? this.ex(e.args[1], this.root) : null
      return src
    }
    if (isCall && (e.name === "cmd" || e.name === "stream")) {
      if (e.args.length !== 1 || e.named.length) this.fail(e.name + "(\"command\") takes one command", e.pos)
      var arg = this.ex(e.args[0], this.root)
      this.commands.push(listed + (arg.k && typeof arg.c === "string" ? arg.c : e.name + "(…) built from widget values"))
      if (!d.optional) this.guest = true
      src.kind = e.name
      src.arg = arg
      src.every = Math.max(every === null ? 60 : every, 1)
      return src
    }
    if (isCall && e.name === "file") {
      if (e.args.length !== 1 || e.named.length) this.fail("file(\"~/path\") takes one path", e.pos)
      if (d.every || d.timeout) this.fail("file(...) updates when the file changes; it takes no every or timeout", d.pos)
      var path = this.ex(e.args[0], this.root)
      if (path.k && typeof path.c === "string" && path.c.charAt(0) !== "/" && path.c.indexOf("~/") !== 0)
        this.fail("file takes a path starting with / or ~/", e.args[0].pos)
      this.commands.push(listed + "read file " + (path.k && typeof path.c === "string" ? path.c : "(a path built from widget values)"))
      this.since("file", e.pos)
      if (!d.optional) this.guest = true
      src.kind = "file"
      src.arg = path
      src.timeout = 0
      return src
    }
    if (e.k === "name" && e.name === "clock") {
      src.kind = "clock"
      src.every = Math.max(every === null ? 1 : every, 0.1)
      src.timeout = 0
      return src
    }
    if (e.k === "member" && e.e.k === "name" && e.e.name === "android") {
      if (ANDROID.indexOf(e.name) < 0)
        this.fail("unknown android source '" + e.name + "' (" + ANDROID.join(", ") + ")", e.pos)
      this.since("android." + e.name, e.pos)
      if (e.name === "notifications") this.commands.push("read Android notifications (apps, titles and text)")
      src.kind = "android." + e.name
      src.every = Math.max(every === null ? 60 : every, 1)
      src.timeout = 0
      src.json = false
      return src
    }
    this.fail("a source is cmd(\"...\"), stream(\"...\"), http(\"...\"), file(\"...\"), clock, or android." + ANDROID.join("/"), e.pos)
  },

  requires: function(fields) {
    var self = this
    var out = {}
    fields.forEach(function(f) {
      var valid = MANAGERS[f.name]
      if (!valid) self.fail("unknown package manager '" + f.name + "' (" + Object.keys(MANAGERS).join(", ") + ")", f.pos)
      var v = self.constant(f.value, "requires")
      var names
      if (typeof v === "string") names = [v]
      else if (Array.isArray(v)) names = v.map(function(it) {
        if (typeof it !== "string") self.fail("package names are strings, like \"jq\"", f.value.pos)
        return it
      })
      else self.fail(f.name + " takes a list of package names, like [\"jq\", \"curl\"]", f.value.pos)
      names.forEach(function(n) {
        if (!valid.test(n)) self.fail("'" + n + "' isn't a valid " + f.name + " package name", f.value.pos)
      })
      var list = out[f.name] || (out[f.name] = [])
      names.forEach(function(n) { if (list.indexOf(n) < 0) list.push(n) })
    })
    return out
  },

  asset: function(d) {
    var b = d.base64
    var body = b.replace(/=+$/, "")
    if (!/^[A-Za-z0-9+\/]*={0,2}$/.test(b) || body.length % 4 === 1)
      this.fail("asset '" + d.name + "' isn't valid base64", d.pos)
    if (Math.floor(body.length * 3 / 4) > MAX_ASSET_BYTES) this.fail("asset '" + d.name + "' is over 2 MB", d.pos)
    return { type: "asset", name: d.name, base64: b }
  },

  let: function(d) {
    var v = d.value
    if (v.k === "call" && (v.name === "history" || v.name === "prev")) {
      var of = v.args[0]
      if (!of) this.fail(v.name + "(value) needs a value", v.pos)
      if (v.name === "history") {
        var keep = 60
        if (v.args[1]) {
          var kv = num(this.constant(v.args[1], "history length"))
          if (kv !== null) keep = toInt(kv)
        }
        return { type: "sampled", name: d.name, of: this.ex(of, this.root), keep: clampNum(keep, 2, 1000), prev: false, persist: d.persist }
      }
      if (d.persist) this.fail("only history(...) and state persist; prev(...) refills from the next sample", d.pos)
      return { type: "sampled", name: d.name, of: this.ex(of, this.root), keep: 2, prev: true, persist: false }
    }
    if (d.persist) this.fail("a let is recomputed from what it reads; persist a state or a history(...) instead", d.pos)
    return { type: "let", name: d.name, value: this.ex(v, this.root) }
  },

  trigger: function(d) {
    this.since(d.trigger, d.pos)
    var expr
    if (d.trigger === "every") {
      var s = num(this.constant(d.expr, "every"))
      if (s === null) this.fail("every takes an interval, like every 10s { ... }", d.expr.pos)
      if (s < 1) this.fail("every runs at most once a second", d.expr.pos)
      expr = evOf(s)
    } else {
      expr = this.ex(d.expr, this.root)
      if (expr.k) this.fail(d.trigger + " needs a value that changes, like a state or a source", d.expr.pos)
    }
    return {
      kind: d.trigger,
      expr: expr,
      action: this.handler({ name: d.trigger, stmts: d.stmts, pos: d.pos }, this.root, TRIGGER_PARAMS[d.trigger] || []),
      pos: d.pos
    }
  },

  component: function(d) {
    var self = this
    var body = d.body
    if (body.props.length || body.handlers.length)
      this.fail("a component's body holds nodes; put properties on a node inside it", d.pos)
    var names = d.params.map(function(p) { return p[0] })
    var scope = new Scope(this.root, names)
    var defaults = d.params.map(function(p) { return p[1] ? self.ex(p[1], self.root) : null })
    return { params: names, defaults: defaults, body: this.items(body.items, scope, "ui") }
  },

  items: function(list, scope, mode) {
    var self = this
    var lets = list.filter(function(it) { return it.kind === "let" })
    if (!lets.length) return list.map(function(it) { return self.item(it, scope, mode) })
    var frame = new Scope(scope, lets.map(function(l) { return l.name }), 0)
    var values = lets.map(function(l) {
      var ev = self.ex(l.value, frame)
      frame.visible++
      return ev
    })
    var rest = list.filter(function(it) { return it.kind !== "let" }).map(function(it) { return self.item(it, frame, mode) })
    return [{ t: "lets", values: values, children: rest, pos: lets[0].pos }]
  },

  noProps: function(body, where) {
    if (body.props.length) this.fail("properties can't go inside " + where + "; use cond ? a : b on the property instead", body.props[0].pos)
    if (body.handlers.length) this.fail("handlers can't go inside " + where, body.handlers[0].pos)
    if (body.animations.length) this.fail("animate can't go inside " + where, body.animations[0].pos)
    if (body.decls.length) this.fail("declarations belong at the top of the widget", body.decls[0].pos)
  },

  item: function(it, scope, mode) {
    if (it.kind === "if") {
      this.noProps(it.then, "if")
      if (it.orElse) this.noProps(it.orElse, "else")
      var cond = this.ex(it.cond, scope)
      var then = this.items(it.then.items, scope, mode)
      var orElse = it.orElse ? this.items(it.orElse.items, scope, mode) : []
      return { t: "if", cond: cond, then: then, orElse: orElse, pos: it.pos }
    }
    if (it.kind === "for") {
      this.noProps(it.body, "for")
      var list = this.ex(it.list, scope)
      var inner = new Scope(scope, [it.name, it.index === null ? "\u0000index" : it.index])
      var key = it.key ? this.ex(it.key, inner) : null
      return { t: "for", list: list, key: key, body: this.items(it.body.items, inner, mode), pos: it.pos }
    }
    if (it.kind === "call") {
      if (mode !== "draw") this.fail(it.call.name + "(...) draws, so it goes inside a Canvas", it.pos)
      return this.draw(it, scope)
    }
    if (it.kind === "node") {
      if (mode === "draw") this.fail("a Canvas holds drawing calls like circle(...), not nodes", it.pos)
      return this.element(it, scope)
    }
    throw new Error("lets are gathered by items()")
  },

  draw: function(it, scope) {
    var self = this
    var c = it.call
    var op = DRAW[c.name]
    if (!op) this.fail("unknown drawing call '" + c.name + "' (" + Object.keys(DRAW).join(", ") + ")", c.pos)
    if (c.args.length < op[0] || c.args.length > op[1])
      this.fail(c.name + " takes " + op[0] + (op[1] !== op[0] ? "-" + op[1] : "") + " values", c.pos)
    if (op[2] && it.body === null) this.fail(c.name + "(...) wraps drawing calls: " + c.name + "(...) { ... }", c.pos)
    if (!op[2] && it.body !== null) this.fail(c.name + "(...) takes no { } body", c.pos)
    c.named.forEach(function(n) {
      if (DRAW_NAMED.indexOf(n[0]) < 0) self.fail("unknown option '" + n[0] + "' (" + DRAW_NAMED.join(", ") + ")", n[1].pos)
    })
    this.since(c.name, c.pos)
    this.nodes++
    var args = c.args.map(function(a) { return self.ex(a, scope) })
    var named = {}
    c.named.forEach(function(n) {
      named[n[0]] = self.enumOrNull(n[0], n[1], scope) || self.ex(n[1], scope)
    })
    var children = null
    if (it.body) {
      this.noProps(it.body, c.name)
      children = this.items(it.body.items, scope, "draw")
    }
    return { t: "draw", op: c.name, args: args, named: named, children: children, pos: it.pos }
  },

  element: function(n, scope) {
    var self = this
    this.nodes++
    if (this.nodes > this.maxNodes)
      this.fail("more than " + this.maxNodes + " nodes; " + (this.maxNodes === MAX_NODES ? "widgets" : "screens") + " should stay small", n.pos)
    if (n.type === "screen") this.fail("screen { } goes at the top of the widget, next to its nodes", n.pos)
    var body = n.body
    if (body.decls.length) this.fail("declarations belong at the top of the widget", body.decls[0].pos)
    if (this.components.hasOwnProperty(n.type)) return this.use(n, this.components[n.type], scope)
    var kind = KINDS[n.type]
    if (!kind) this.fail("unknown node '" + n.type + "' (" + KIND_NAMES.concat(Object.keys(this.components)).join(", ") + ")", n.pos)
    var props = {}
    body.props.forEach(function(p) {
      if (kind[0].indexOf(p.name) < 0 && COMMON.indexOf(p.name) < 0)
        self.fail(n.type + " has no property '" + p.name + "' (" + kind[0].concat(COMMON).join(", ") + ")", p.pos)
      if (props.hasOwnProperty(p.name)) self.fail("'" + p.name + "' is set twice", p.pos)
      // On a tile it would raise the keyboard whenever its page shows.
      if (p.name === "focus" && self.inScreen === false) self.fail("focus only works in a screen { }", p.pos)
      self.since(n.type + "." + p.name, p.pos)
      props[p.name] = self.prop(p, scope)
    })
    var handlers = {}
    body.handlers.forEach(function(h) {
      if (!HANDLER_PARAMS.hasOwnProperty(h.name))
        self.fail("unknown handler '" + h.name + "' (" + Object.keys(HANDLER_PARAMS).join(", ") + ")", h.pos)
      var kinds = HANDLER_KINDS[h.name]
      if (kinds && kinds.indexOf(n.type) < 0) self.fail(h.name + " only works on " + kinds.join(" and "), h.pos)
      handlers[h.name] = self.handler(h, scope)
    })
    var animations = {}
    body.animations.forEach(function(a) {
      if (ANIMATABLE.indexOf(a.name) < 0) self.fail("'" + a.name + "' can't animate (" + ANIMATABLE.join(", ") + ")", a.pos)
      animations[a.name] = self.ex(a.value, scope)
    })
    this.since(n.type, n.pos)
    if (n.type === "Terminal") {
      this.terminal = true
      var command = props.command
      this.commands.push(!command ? "a terminal running the login shell"
        : command.k && typeof command.c === "string" ? command.c : "Terminal command built from widget values")
      this.guest = true
    }
    if (n.type === "Shader") this.animated = true
    if (kind[1] === "none" && body.items.length) this.fail(n.type + " can't hold other nodes", body.items[0].pos)
    var children = kind[1] === "none" ? []
      : kind[1] === "ui" ? this.items(body.items, scope, "ui")
      : this.items(body.items, new Scope(scope, ["width", "height"]), "draw")
    return { t: "el", kind: n.type, props: props, handlers: handlers, animations: animations, children: children, pos: n.pos }
  },

  use: function(n, c, scope) {
    var self = this
    var body = n.body
    if (body.items.length) this.fail(n.type + " takes no child nodes", body.items[0].pos)
    if (body.handlers.length || body.animations.length) this.fail("put handlers and animate inside the component", n.pos)
    var given = {}
    body.props.forEach(function(p) {
      given[p.name] = p
      if (c.params.indexOf(p.name) < 0 && COMMON.indexOf(p.name) < 0)
        self.fail(n.type + " has no parameter '" + p.name + "' (" + c.params.join(", ") + ")", p.pos)
    })
    var args = c.params.map(function(name, i) {
      if (given.hasOwnProperty(name)) return self.ex(given[name].value, scope)
      if (c.defaults[i] === null) self.fail(n.type + " needs '" + name + "'", n.pos)
      return c.defaults[i]
    })
    var wrapper = {}
    body.props.forEach(function(p) {
      if (c.params.indexOf(p.name) < 0) wrapper[p.name] = self.prop(p, scope)
    })
    return { t: "use", component: n.type, args: args, wrapper: wrapper, body: c.body, pos: n.pos }
  },

  enumOrNull: function(name, e, scope) {
    var options = ENUMS[name]
    if (!options) return null
    if (e.k === "name" && options.indexOf(e.name) >= 0 && this.lookup(e.name, scope) === null) return evOf(e.name)
    return null
  },

  prop: function(p, scope) { return this.enumOrNull(p.name, p.value, scope) || this.ex(p.value, scope) },

  handler: function(h, scope, paramsIn) {
    var self = this
    var params = paramsIn || HANDLER_PARAMS[h.name] || []
    var inner = new Scope(scope, params)
    var stmts = h.stmts.map(function(s) {
      if (s.kind === "assign") {
        var slot = self.slots.hasOwnProperty(s.name) ? self.slots[s.name] : null
        if (slot === null || !self.states.hasOwnProperty(s.name))
          self.fail(slot === null ? "unknown state '" + s.name + "'; declare it with: state " + s.name + " = ..."
            : "'" + s.name + "' isn't a state and can't be assigned", s.pos)
        var call = s.value.k === "call" ? s.value : null
        if (call && call.name === "run") {
          if (call.args.length !== 1 || call.named.length) self.fail("run takes one command", call.pos)
          var command = self.ex(call.args[0], inner)
          self.commands.push(command.k && typeof command.c === "string" ? command.c : "run(…) built from widget values")
          self.guest = true
          return function(env) { env.host.runInto(show(run(command, env)), slot) }
        }
        var v = self.ex(s.value, inner)
        return function(env) { env.host.write(slot, run(v, env)) }
      }
      var c = s.call
      var arity = ACTIONS[c.name]
      if (!arity) self.fail("'" + c.name + "' isn't an action (" + Object.keys(ACTIONS).join(", ") + ")", c.pos)
      if (c.args.length < arity[0] || c.args.length > arity[1])
        self.fail(c.name + " takes " + arity[0] + "-" + arity[1] + " values", c.pos)
      var args = c.args.map(function(a) { return self.ex(a, inner) })
      var first = args.length && args[0].k && typeof args[0].c === "string" ? args[0].c : null
      if (c.name === "media" && first !== null && MEDIA.indexOf(first) < 0) self.fail("media takes " + MEDIA.join(", "), c.pos)
      if (c.name === "volume" && first !== null && VOLUME.indexOf(first) < 0 && num(first) === null)
        self.fail("volume takes a level in percent, or " + VOLUME.join(", "), c.pos)
      if (c.name === "torch" && first !== null && TORCH.indexOf(first) < 0)
        self.fail("torch takes true, false, " + TORCH.join(", "), c.pos)
      if (c.name === "notification" && first !== null && NOTIFICATION.indexOf(first) < 0)
        self.fail("notification takes " + NOTIFICATION.join(", ") + " and a notification's key", c.pos)
      self.since(c.name, c.pos)
      if ((c.name === "screen" || c.name === "close") && self.screenAction === null) self.screenAction = c.pos
      if (c.name === "run" || c.name === "terminal" || c.name === "app") {
        self.commands.push(first !== null ? first : c.name + "(…) built from widget values")
        if (c.name === "run") self.guest = true
      }
      var name = c.name
      return function(env) { env.host.act(name, args.map(function(a) { return run(a, env) })) }
    })
    var hname = h.name
    return {
      params: params,
      run: function(env, values) {
        var e = params.length ? env.child(params.map(function(p, i) { return i < values.length ? values[i] : null })) : env
        try {
          env.host.budget.run(function() { stmts.forEach(function(s) { s(e) }) })
        } catch (x) {
          env.host.report(hname + ": " + messageOf(x))
        }
      }
    }
  },

  lookup: function(name, scope) {
    var depth = 0
    for (var s = scope; s !== null; s = s.parent) {
      var i = s.names.slice(0, s.visible).lastIndexOf(name)
      if (i >= 0) return { local: true, depth: depth, index: i }
      depth++
    }
    if (this.slots.hasOwnProperty(name)) return { local: false, slot: this.slots[name] }
    return null
  },

  fold: function(inputs, f) {
    for (var i = 0; i < inputs.length; i++) if (!inputs[i].k) return new Ev(f)
    try {
      return evOf(f(new Env(CONST_HOST, null, [])))
    } catch (e) {
      return new Ev(f)
    }
  },

  ex: function(e, s) {
    var self = this
    switch (e.k) {
    case "lit": return evOf(e.v)
    case "name": return this.name(e, s)
    case "interp": {
      var parts = e.parts.map(function(p) { return self.ex(p, s) })
      var literal = e.parts.map(function(p) { return p.k === "lit" && typeof p.v === "string" })
      return this.fold(parts, function(env) {
        var out = ""
        for (var i = 0; i < parts.length; i++) {
          var v = run(parts[i], env)
          out += literal[i] ? show(v) : text(v)
        }
        return out
      })
    }
    case "list": {
      var items = e.items.map(function(it) { return self.ex(it, s) })
      return this.fold(items, function(env) { return items.map(function(it) { return run(it, env) }) })
    }
    case "map": {
      var keys = e.entries.map(function(en) { return en[0] })
      var vals = e.entries.map(function(en) { return self.ex(en[1], s) })
      return this.fold(vals, function(env) {
        var m = new Map()
        for (var i = 0; i < keys.length; i++) m.set(keys[i], run(vals[i], env))
        return m
      })
    }
    case "unary": {
      var a = this.ex(e.e, s)
      if (e.op === "!") return this.fold([a], function(env) { return !truthy(run(a, env)) })
      return this.fold([a], function(env) {
        var n = num(run(a, env))
        return n === null ? null : -n
      })
    }
    case "bin": {
      var x = this.ex(e.a, s)
      var y = this.ex(e.b, s)
      if (e.op === "&&") return this.fold([x, y], function(env) { var v = run(x, env); return !truthy(v) ? v : run(y, env) })
      if (e.op === "||") return this.fold([x, y], function(env) { var v = run(x, env); return truthy(v) ? v : run(y, env) })
      if (e.op === "??") return this.fold([x, y], function(env) { var v = run(x, env); return v !== null ? v : run(y, env) })
      var op = OPERATORS[e.op]
      return this.fold([x, y], function(env) { return op(run(x, env), run(y, env)) })
    }
    case "cond": {
      var c = this.ex(e.c, s)
      var p = this.ex(e.a, s)
      var q = this.ex(e.b, s)
      if (c.k) return truthy(c.c) ? p : q
      return new Ev(function(env) { return truthy(run(c, env)) ? run(p, env) : run(q, env) })
    }
    case "member": {
      var o = this.ex(e.e, s)
      var name = e.name
      return this.fold([o], function(env) { return member(run(o, env), name) })
    }
    case "index": {
      var oo = this.ex(e.e, s)
      var ii = this.ex(e.i, s)
      return this.fold([oo, ii], function(env) { return index(run(oo, env), run(ii, env)) })
    }
    case "call": return this.call(e, s)
    case "lambda": {
      var inner = new Scope(s, e.params)
      var body = this.ex(e.body, inner)
      var n = e.params.length
      return new Ev(function(env) {
        return new Fn(n, function(args) {
          env.host.budget.tick(1)
          var slots = []
          for (var i = 0; i < n; i++) slots.push(i < args.length ? args[i] : null)
          return run(body, new Env(env.host, env, slots))
        })
      })
    }
    }
    throw new Error("unknown expression " + e.k)
  },

  name: function(e, s) {
    var ref = this.lookup(e.name, s)
    if (ref !== null && ref.local) {
      var depth = ref.depth, i = ref.index
      return new Ev(function(env) { return env.local(depth, i) })
    }
    if (ref !== null) {
      var slot = ref.slot
      return new Ev(function(env) { return env.host.read(slot) })
    }
    if (CONSTANTS.hasOwnProperty(e.name)) return evOf(CONSTANTS[e.name])
    if (THEME.indexOf(e.name) >= 0) return evOf(new Col(e.name, THEME_GREY, 1))
    if (e.name === "time") {
      this.animated = true
      return new Ev(function(env) { return env.host.time() })
    }
    if (TILE.indexOf(e.name) >= 0 || e.name === "linux") {
      this.since(e.name, e.pos)
      var tn = e.name
      return new Ev(function(env) { return env.host.tile(tn) })
    }
    if (ENUM_WORDS.indexOf(e.name) >= 0) this.fail("'" + e.name + "' isn't a value here", e.pos)
    this.fail("unknown name '" + e.name + "'", e.pos)
  },

  call: function(e, s) {
    var self = this
    if (ACTIONS.hasOwnProperty(e.name)) this.fail(e.name + "(...) is an action; use it in a handler like onTap", e.pos)
    if (e.name === "history" || e.name === "prev")
      this.fail(e.name + "(...) keeps samples over time, so it only works as: let x = " + e.name + "(...)", e.pos)
    if (["cmd", "stream", "http", "file"].indexOf(e.name) >= 0)
      this.fail(e.name + "(...) is a source: source x = " + e.name + "(\"...\")", e.pos)
    var b = BUILTINS.hasOwnProperty(e.name) ? BUILTINS[e.name] : null
    if (!b) this.fail("unknown function '" + e.name + "'", e.pos)
    this.since(e.name, e.pos)
    if (e.named.length) this.fail(e.name + " takes no named arguments", e.named[0][1].pos)
    if (e.args.length < b.min || e.args.length > b.max)
      this.fail(e.name + " takes " + (b.min === b.max ? String(b.min) : b.min + "-" + b.max) + " arguments, not " + e.args.length, e.pos)
    var args = e.args.map(function(a) { return self.ex(a, s) })
    var impl = b.impl
    var name = e.name
    var f = function(env) {
      env.host.budget.tick(1)
      var values = []
      for (var i = 0; i < args.length; i++) values.push(run(args[i], env))
      try {
        return impl(new Args(values, env.host))
      } catch (x) {
        if (x instanceof WidgetError) throw x
        throw new WidgetError(name + ": " + messageOf(x))
      }
    }
    if (b.pure) {
      var allConst = true
      for (var i = 0; i < args.length; i++) if (!args[i].k) { allConst = false; break }
      if (allConst) {
        try {
          return evOf(f(new Env(CONST_HOST, null, [])))
        } catch (x) {
          this.fail(messageOf(x) || "can't evaluate", e.pos)
        }
      }
    }
    return new Ev(f)
  }
}

function compile(src) {
  return new Compiler(parse(src)).program()
}

// Line and column of a compile error, with the line and a caret, as the
// launcher writes it to .errors/<file>.txt.
function formatError(src, e) {
  if (!(e instanceof CompileError)) return messageOf(e)
  var line = 1, col = 1
  for (var i = 0; i < Math.min(e.pos, src.length); i++) {
    if (src.charAt(i) === "\n") { line++; col = 1 } else col++
  }
  var lines = src.split("\n")
  var at = line - 1 < lines.length ? lines[line - 1].replace(/\s+$/, "") : ""
  var caret = ""
  for (var j = 0; j < col - 1; j++) caret += " "
  return line + ":" + col + ": " + e.message + "\n  " + at + "\n  " + caret + "^"
}

// ------------------------------------------------------------------ runtime
//
// One live widget. The host (OwlWidget.qml, or a test) supplies:
//
//   theme(name)       ARGB of a theme color, or null
//   tile(name)        cols, rows, tileWidth, tileHeight, screenWidth,
//                     screenHeight and linux
//   act(name, args)   terminal(), url(), run() and the rest
//   runInto(cmd, slot) runs a command and later calls setState(slot, output)
//   report(message)   a runtime error, for the widget's error log
//   changed()         something a render reads has changed
//
// and drives the instance with setSource(), frame() and the handlers that
// render() hands out.

function Instance(program, host, persisted) {
  var self = this
  this.program = program
  this.host = host
  this.values = []
  this.letCache = []
  this.letTime = []
  this.sampled = []
  this.time = 0
  this.tracking = []
  this.readsTime = false
  this.triggerLast = []
  this.firing = 0
  this.budget = new Budget(200000)
  this.drawBudget = new Budget(200000)
  this.hostBridge = this.bridge(this.budget)
  this.drawBridge = this.bridge(this.drawBudget)
  this.env = new Env(this.hostBridge, null, [])
  var saved = persisted || {}
  program.globals.forEach(function(g, slot) {
    self.values[slot] = null
    self.letCache[slot] = undefined
    if (g.type === "state") {
      if (g.persist && saved.hasOwnProperty(g.name)) self.values[slot] = fromJson(saved[g.name])
      else self.values[slot] = self.guard("state " + g.name, function() { return run(g.init, self.env) }, null)
    } else if (g.type === "sampled") {
      self.sampled[slot] = g.persist && Array.isArray(saved[g.name]) ? saved[g.name].map(fromJson) : []
    } else if (g.type === "asset") {
      self.values[slot] = "data:" + assetType(g.base64) + ";base64," + g.base64
    }
  })
  this.triggerLast = program.triggers.map(function(t) {
    return t.kind === "every" ? null : self.guard(t.kind, function() { return run(t.expr, self.env) }, null)
  })
}

function assetType(b64) {
  if (b64.indexOf("iVBOR") === 0) return "image/png"
  if (b64.indexOf("/9j/") === 0) return "image/jpeg"
  if (b64.indexOf("R0lG") === 0) return "image/gif"
  if (b64.indexOf("UklGR") === 0) return "image/webp"
  if (b64.indexOf("PHN2") === 0 || b64.indexOf("PD94") === 0) return "image/svg+xml"
  return "application/octet-stream"
}

Instance.prototype = {
  // The Host the compiled closures see.
  bridge: function(budget) {
    var self = this
    return {
      budget: budget,
      read: function(slot) { return self.read(slot) },
      write: function(slot, v) { self.write(slot, v) },
      theme: function(name) { return self.host.theme(name) },
      time: function() {
        self.markTime()
        return self.time
      },
      tile: function(name) {
        var v = self.host.tile(name)
        return name === "linux" ? v !== false : v === undefined ? null : v
      },
      act: function(name, args) { self.host.act(name, args) },
      runInto: function(cmd, slot) { self.host.runInto(cmd, slot) },
      report: function(msg) { self.host.report(msg) }
    }
  },

  guard: function(what, f, fallback) {
    try {
      return this.budget.run(f)
    } catch (e) {
      this.host.report(what + ": " + messageOf(e))
      return fallback
    }
  },

  markTime: function() {
    this.readsTime = true
    for (var i = 0; i < this.tracking.length; i++) this.tracking[i].time = true
  },

  read: function(slot) {
    var g = this.program.globals[slot]
    if (g.type === "let") {
      var cached = this.letCache[slot]
      if (cached !== undefined) {
        if (this.letTime[slot]) this.markTime()
        return cached
      }
      var frame = { time: false }
      this.tracking.push(frame)
      var v
      try {
        v = run(g.value, this.env)
      } finally {
        this.tracking.pop()
      }
      this.letCache[slot] = v
      this.letTime[slot] = frame.time
      if (frame.time) this.markTime()
      return v
    }
    if (g.type === "sampled") {
      var samples = this.sampled[slot]
      if (g.prev) return samples.length >= 2 ? samples[samples.length - 2] : null
      return samples.slice()
    }
    var value = this.values[slot]
    return value === undefined ? null : value
  },

  invalidate: function() {
    for (var i = 0; i < this.letCache.length; i++) this.letCache[i] = undefined
  },

  write: function(slot, v) {
    if (equals(this.values[slot], v)) return
    this.values[slot] = v
    this.invalidate()
    this.changed()
  },

  // A state set from outside: run() finishing, a Slider moving.
  setState: function(slot, v) { this.write(slot, v) },

  // A source produced a value. `raw` is text for cmd, stream, http and file
  // sources and a value already for clock and the android.* ones.
  setSource: function(slot, raw) {
    var g = this.program.globals[slot]
    var v = raw
    if (typeof raw === "string") {
      v = raw.replace(/\s+$/, "")
      if (g.json) {
        try {
          v = parseJson(raw.trim())
        } catch (e) {
          this.host.report(g.name + ": not JSON: " + messageOf(e))
          v = null
        }
      }
    }
    this.values[slot] = v
    this.invalidate()
    this.sample()
    this.changed()
  },

  sample: function() {
    var self = this
    this.program.globals.forEach(function(g, slot) {
      if (g.type !== "sampled") return
      var v = self.guard(g.name, function() { return run(g.of, self.env) }, null)
      var samples = self.sampled[slot]
      samples.push(v)
      if (samples.length > g.keep) samples.splice(0, samples.length - g.keep)
    })
    this.invalidate()
  },

  // A frame of an animated widget: `time` moved, so whatever read it is stale.
  frame: function(seconds) {
    this.time = seconds
    for (var i = 0; i < this.letCache.length; i++) if (this.letTime[i]) this.letCache[i] = undefined
  },

  changed: function() {
    this.checkTriggers()
    if (this.host.changed) this.host.changed()
  },

  checkTriggers: function() {
    var self = this
    if (this.firing > 4) return
    this.firing++
    try {
      this.program.triggers.forEach(function(t, i) {
        if (t.kind !== "on" && t.kind !== "when") return
        var v = self.guard(t.kind, function() { return run(t.expr, self.env) }, null)
        var old = self.triggerLast[i]
        self.triggerLast[i] = v
        if (t.kind === "on" && !equals(v, old)) t.action.run(self.env, [v, old])
        if (t.kind === "when" && truthy(v) && !truthy(old)) t.action.run(self.env, [])
      })
    } finally {
      this.firing--
    }
  },

  // `every 10s { }` and `at ... { }`, which the host times.
  fire: function(i) {
    var t = this.program.triggers[i]
    t.action.run(this.env, [])
  },

  // `at` triggers name a time of day ("07:30") or a Unix time. The host calls
  // this once a minute with the wall clock; each fires as the clock passes it.
  tick: function(nowSeconds) {
    var self = this
    this.program.triggers.forEach(function(t, i) {
      if (t.kind !== "at") return
      var v = self.guard("at", function() { return run(t.expr, self.env) }, null)
      var due = null
      if (typeof v === "number") due = v
      else if (typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v.trim())) {
        var hm = v.trim().split(":")
        var d = new Date(nowSeconds * 1000)
        d.setHours(parseInt(hm[0], 10), parseInt(hm[1], 10), 0, 0)
        due = d.getTime() / 1000
      }
      var last = self.triggerLast[i]
      self.triggerLast[i] = nowSeconds
      if (due !== null && last !== null && last < due && nowSeconds >= due) t.action.run(self.env, [])
    })
  },

  persisted: function() {
    var self = this
    var out = {}
    this.program.globals.forEach(function(g, slot) {
      if (g.type === "state" && g.persist) out[g.name] = toJson(self.values[slot])
      if (g.type === "sampled" && g.persist) out[g.name] = self.sampled[slot].map(toJson)
    })
    return out
  },

  // The sources a host has to run, with what they need to run them.
  sources: function() {
    var self = this
    var out = []
    this.program.globals.forEach(function(g, slot) {
      if (g.type !== "source") return
      out.push({
        slot: slot, name: g.name, kind: g.kind, every: g.every, json: g.json, timeout: g.timeout,
        status: g.status, optional: g.optional,
        // The command, URL or path, which may read state.
        arg: function() { return g.arg ? self.guard(g.name, function() { return show(run(g.arg, self.env)) }, "") : "" },
        headers: function() {
          if (!g.headers) return {}
          var h = self.guard(g.name, function() { return run(g.headers, self.env) }, null)
          return h instanceof Map ? toJson(h) : {}
        }
      })
    })
    return out
  },

  everyTriggers: function() {
    var out = []
    this.program.triggers.forEach(function(t, i) { if (t.kind === "every") out.push({ index: i, seconds: t.expr.c }) })
    return out
  },

  hasAt: function() {
    return this.program.triggers.some(function(t) { return t.kind === "at" })
  },

  color: function(v) {
    var n = argb(v, this.hostBridge)
    return n === null ? null : hex8(n)
  },

  // The tile, as plain objects for OwlNode.qml. Handlers come back as
  // closures that run against this instance.
  render: function(screen) {
    var self = this
    this.readsTime = false
    var out = []
    var nodes = screen ? this.program.screen : this.program.root
    this.guard("render", function() { self.nodes(nodes || [], self.env, out) }, null)
    var result = {
      children: out,
      readsTime: this.readsTime,
      padding: this.program.padding,
      background: this.program.background ? this.prop("background", this.program.background, this.env) : null,
      onTap: this.program.onTap ? this.handlerFor(this.program.onTap, this.env) : null
    }
    if (screen) result.title = this.program.screenTitle ? text(this.evalSafe(this.program.screenTitle, this.env)) : this.program.name
    return result
  },

  evalSafe: function(ev, env) {
    try {
      return run(ev, env)
    } catch (e) {
      this.host.report(messageOf(e))
      return null
    }
  },

  handlerFor: function(action, env) {
    var self = this
    return function() {
      var values = Array.prototype.slice.call(arguments)
      action.run(env, values)
    }
  },

  nodes: function(list, env, out) {
    for (var i = 0; i < list.length; i++) this.node(list[i], env, out)
  },

  node: function(n, env, out) {
    var self = this
    if (n.t === "lets") return this.nodes(n.children, env.lets(n.values), out)
    if (n.t === "if") return this.nodes(truthy(this.evalSafe(n.cond, env)) ? n.then : n.orElse, env, out)
    if (n.t === "for") {
      var items = asList(this.evalSafe(n.list, env))
      for (var i = 0; i < items.length && i < 1000; i++) this.nodes(n.body, env.child([items[i], i]), out)
      return
    }
    if (n.t === "use") {
      var args = n.args.map(function(a) { return self.evalSafe(a, env) })
      var inner = new Env(env.host, new Env(env.host, null, []), args)
      var wrapped = Object.keys(n.wrapper).length > 0
      if (!wrapped) return this.nodes(n.body, inner, out)
      var children = []
      this.nodes(n.body, inner, children)
      var p = {}
      for (var k in n.wrapper) p[k] = this.prop(k, n.wrapper[k], env)
      out.push({ kind: "Box", p: p, h: {}, a: {}, c: children, wrapper: true })
      return
    }
    if (n.t === "el") {
      var props = {}
      for (var name in n.props) props[name] = this.prop(name, n.props[name], env)
      var handlers = {}
      for (var h in n.handlers) handlers[h] = this.handlerFor(n.handlers[h], env)
      var anim = {}
      for (var a in n.animations) anim[a] = plain(this.evalSafe(n.animations[a], env))
      var node = { kind: n.kind, p: props, h: handlers, a: anim, c: [] }
      if (n.kind === "Canvas") {
        var drawn = n.children
        node.draw = function(width, height) { return self.draw(drawn, env, width, height) }
      } else {
        this.nodes(n.children, env, node.c)
      }
      out.push(node)
    }
  },

  // A property, ready to draw: colors as #aarrggbb strings, text as it reads.
  prop: function(name, ev, env) {
    var v = this.evalSafe(ev, env)
    if (COLOR_PROPS.indexOf(name) >= 0) {
      if (v instanceof Gradient) return { gradient: this.gradient(v) }
      return this.color(v)
    }
    if (name === "area" && typeof v !== "boolean") return v === null ? false : this.color(v)
    if (name === "text") return text(v)
    if (name === "placeholder") return v === null ? "" : text(v)
    if (name === "uniforms") {
      var u = {}
      var self = this
      if (v instanceof Map) v.forEach(function(value, key) { u[key] = self.uniform(value) })
      return u
    }
    return plain(v)
  },

  uniform: function(v) {
    if (v instanceof Col || (typeof v === "string" && color(v) !== null)) {
      var n = argb(v, this.hostBridge)
      return n === null ? null : [((n >>> 16) & 255) / 255, ((n >>> 8) & 255) / 255, (n & 255) / 255, ((n >>> 24) & 255) / 255]
    }
    return plain(v)
  },

  gradient: function(g) {
    var self = this
    return { radial: g.radial, coords: g.coords.slice(), colors: g.colors.map(function(c) { return self.color(c) }) }
  },

  // A Canvas's drawing calls for one frame, as a flat display list with groups
  // nested: [{op: "rect", x, y, w, h, fill: "#..."}, {op: "rotate", ..., ops: [...]}].
  draw: function(list, env, width, height) {
    var self = this
    var out = []
    var count = { n: 0 }
    try {
      // The widget's lets a frame reads first are worked out on the instance's
      // budget, not the draw's. A draw starts that budget again, as a render
      // does: a widget whose tree never reads `time` is never rendered again,
      // so without this its lets' steps added up frame after frame until every
      // frame failed (the koi pond went blank after four seconds).
      this.budget.run(function() {
        self.drawBudget.run(function() {
          self.drawList(list, new Env(self.drawBridge, env, [width, height]), out, count)
        })
      })
    } catch (e) {
      this.host.report("Canvas: " + messageOf(e))
    }
    return out
  },

  drawList: function(list, env, out, count) {
    for (var i = 0; i < list.length; i++) {
      var n = list[i]
      if (n.t === "lets") this.drawList(n.children, envLets(env, n.values), out, count)
      else if (n.t === "if") this.drawList(truthy(run(n.cond, env)) ? n.then : n.orElse, env, out, count)
      else if (n.t === "for") {
        var items = asList(run(n.list, env))
        for (var j = 0; j < items.length && j < 1000; j++)
          this.drawList(n.body, new Env(env.host, env, [items[j], j]), out, count)
      } else if (n.t === "draw") this.drawOp(n, env, out, count)
    }
  },

  drawOp: function(n, env, out, count) {
    if (++count.n > 2000) throw new WidgetError("more than 2000 drawing calls in one frame")
    var args = []
    for (var i = 0; i < n.args.length; i++) args.push(run(n.args[i], env))
    var named = {}
    for (var k in n.named) named[k] = run(n.named[k], env)
    var op = { op: n.op, args: args.map(function(a) { return num(a) }) }
    var self = this
    function paint(v) {
      if (v === null || v === undefined) return null
      if (v instanceof Gradient) return { gradient: self.gradient(v) }
      return self.color(v)
    }
    if (named.fill !== undefined) op.fill = paint(named.fill)
    if (named.stroke !== undefined) op.stroke = paint(named.stroke)
    if (named.color !== undefined) op.color = paint(named.color)
    if (named.width !== undefined) op.width = num(named.width)
    if (named.cap !== undefined) op.cap = show(named.cap)
    if (named.radius !== undefined) op.radius = num(named.radius)
    if (named.closed !== undefined) op.closed = truthy(named.closed)
    if (named.size !== undefined) op.size = num(named.size)
    if (named.align !== undefined) op.align = show(named.align)
    if (named.bold !== undefined) op.bold = truthy(named.bold)
    if (n.op === "path") {
      op.points = asList(args[0]).map(function(p) {
        if (Array.isArray(p)) return [num(p[0]) || 0, num(p[1]) || 0]
        if (p instanceof Map) return [num(p.get("x")) || 0, num(p.get("y")) || 0]
        return [0, 0]
      })
      op.args = []
    } else if (n.op === "text") {
      op.text = text(args[0])
      op.args = [null, num(args[1]), num(args[2])]
    } else if (n.op === "image") {
      op.src = args[0] === null ? "" : show(args[0])
    } else if (n.op === "sprite") {
      // sprite(rows, x, y, pixel, palette: {letter: color}): runs of one letter
      // become one rect, as the launcher's Sprite does.
      var palette = named.palette instanceof Map ? named.palette : new Map()
      var rows = Array.isArray(args[0]) ? args[0].map(text)
        : typeof args[0] === "string" ? trimRows(args[0]) : []
      var x0 = num(args[1]) || 0, y0 = num(args[2]) || 0, px = num(args[3]) || 1
      var fallback = op.fill || op.color || null
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r]
        var c = 0
        while (c < row.length) {
          var ch = row.charAt(c)
          var e = c + 1
          while (e < row.length && row.charAt(e) === ch) e++
          if (ch !== "." && ch !== " ") {
            var pc = palette.has(ch) ? this.color(palette.get(ch)) : fallback
            out.push({ op: "rect", args: [x0 + c * px, y0 + r * px, (e - c) * px, px], fill: pc })
          }
          c = e
        }
      }
      return
    }
    if (n.children) {
      op.ops = []
      this.drawList(n.children, env, op.ops, count)
    }
    out.push(op)
  }
}

function trimRows(s) {
  var rows = linesOf(s).map(function(l) { return l.trim() })
  while (rows.length && rows[0] === "") rows.shift()
  while (rows.length && rows[rows.length - 1] === "") rows.pop()
  return rows
}

function envLets(env, evs) { return env.lets(evs) }

var COLOR_PROPS = ["color", "background", "borderColor", "track", "tint", "fallback"]

// A value for QML: Maps become objects, colors their #aarrggbb text.
function plain(v) {
  if (v === null || v === undefined) return null
  if (Array.isArray(v)) return v.map(plain)
  if (v instanceof Map) {
    var o = {}
    v.forEach(function(value, key) { o[key] = plain(value) })
    return o
  }
  if (v instanceof Col) return v.theme !== null ? v.theme : hex8(v.argb)
  if (v instanceof Fn) return null
  return v
}

// ------------------------------------------------------------------- theme

// A theme's colors.toml, as name -> ARGB, with every name OWL knows. The
// terminal palette follows Omarchy's kitty.conf.tpl; the few names Omarchy
// themes do not carry are derived from the ones they do.
function themeFromToml(raw) {
  var named = {}
  String(raw || "").split("\n").forEach(function(line) {
    var m = /^\s*([A-Za-z0-9_-]+)\s*=\s*["']?(#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?)/.exec(line)
    if (m) named[m[1]] = parseHex(m[2])
  })
  function pick() {
    for (var i = 0; i < arguments.length; i++) if (named[arguments[i]] !== undefined) return named[arguments[i]]
    return null
  }
  var t = {}
  t.background = pick("background", "color0")
  t.foreground = pick("foreground", "color7")
  if (t.background === null) t.background = parseHex("#101315")
  if (t.foreground === null) t.foreground = parseHex("#cacccc")
  t.accent = pick("accent", "blue", "color4")
  if (t.accent === null) t.accent = t.foreground
  t.muted = pick("muted", "color8", "dark_foreground")
  if (t.muted === null) t.muted = t.foreground
  var hues = ["red", "green", "yellow", "blue", "magenta", "cyan"]
  hues.forEach(function(h, i) {
    t[h] = pick(h, "color" + (i + 1))
    t["bright_" + h] = pick("bright_" + h, "color" + (i + 9), h, "color" + (i + 1))
  })
  hues.forEach(function(h) { if (t[h] === null) t[h] = t.foreground })
  hues.forEach(function(h) { if (t["bright_" + h] === null) t["bright_" + h] = t[h] })
  t.orange = pick("orange")
  if (t.orange === null) t.orange = mixArgb(t.red, t.yellow, 0.5)
  t.brown = pick("brown")
  if (t.brown === null) t.brown = mixArgb(t.orange, t.background, 0.5)
  t.purple = pick("purple", "magenta")
  if (t.purple === null) t.purple = t.magenta
  t.bright_foreground = pick("bright_foreground", "color15", "light_foreground", "foreground")
  t.dark_foreground = pick("dark_foreground")
  if (t.dark_foreground === null) t.dark_foreground = mixArgb(t.foreground, t.background, 0.4)
  t.lighter_background = pick("lighter_background")
  if (t.lighter_background === null) t.lighter_background = mixArgb(t.background, t.foreground, 0.08)
  t.dark_background = pick("dark_background")
  if (t.dark_background === null) t.dark_background = mixArgb(t.background, 0xFF000000, 0.25)
  t.selection = pick("selection", "selection_background")
  if (t.selection === null) t.selection = mixArgb(t.background, t.accent, 0.3)
  t.cursor = pick("cursor") !== null ? pick("cursor") : t.bright_foreground
  t.surface = t.lighter_background
  t.border = pick("border")
  if (t.border === null) t.border = mixArgb(t.background, t.foreground, 0.2)
  t.white = pick("white") !== null ? pick("white") : t.bright_foreground
  t.black = pick("black") !== null ? pick("black") : t.dark_background
  var terminal = ["background", "red", "green", "yellow", "blue", "magenta", "cyan", "foreground",
    "muted", "bright_red", "bright_green", "bright_yellow", "bright_blue", "bright_magenta", "bright_cyan", "bright_foreground"]
  for (var c = 0; c <= 15; c++) {
    var own = pick("color" + c)
    t["color" + c] = own !== null ? own : t[terminal[c]]
  }
  return t
}

function mixArgb(x, y, t) {
  var out = 0
  for (var shift = 24; shift >= 0; shift -= 8)
    out |= Math.floor(((x >>> shift) & 0xFF) * (1 - t) + ((y >>> shift) & 0xFF) * t + 0.5) << shift
  return out >>> 0
}

// ----------------------------------------------------------------- exports

// QML's JS engine has no `module`; node does, and the tests use it.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    compile: compile, parse: parse, lex: lex, formatError: formatError, Instance: Instance,
    CompileError: CompileError, WidgetError: WidgetError, Col: Col, Gradient: Gradient, Fn: Fn,
    show: show, text: text, num: num, parseJson: parseJson, toJson: toJson, fromJson: fromJson,
    themeFromToml: themeFromToml, setWeekStart: setWeekStart, hex8: hex8, argb: argb, fmtTime: fmtTime, fixed: fixed, numText: numText,
    run: run, Env: Env
  }
}
