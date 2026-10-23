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

// The most text one value may hold, in characters: doubling a text in a reduce takes a few steps and
// gigabytes of memory.
var MAX_TEXT = 4 << 20

function checkText(length) {
  if (length > MAX_TEXT) throw new WidgetError("text over " + (MAX_TEXT >> 20) + "M characters")
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

// Kotlin's String.toDoubleOrNull: java's double syntax, with control characters and spaces around it.
function javaDouble(t) {
  t = t.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "")
  return NUMBER_TEXT.test(t) ? parseFloat(t.replace(/[fFdD]$/, "")) : null
}

// What a number prints as in the launcher, Num.toString: as JavaScript writes
// it, since owl 9 at every level -- 3 not 3.0, 1792231445.5 and not
// 1.7922314455E9, an exponent only below 1e-6 (1.5e-7) and from 1e21 (1e+21).
function numText(x) {
  return String(x === 0 ? 0 : x)
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
  // A list of itself repeated is small, but its text isn't: it stops at MAX_TEXT.
  if (Array.isArray(v)) {
    var s = "["
    for (var i = 0; i < v.length; i++) {
      if (i > 0) s += ", "
      s += show(v[i])
      checkText(s.length)
    }
    return s + "]"
  }
  if (v instanceof Map) {
    var m = "{", first = true
    v.forEach(function(value, key) {
      if (!first) m += ", "
      first = false
      m += key + ": " + show(value)
      checkText(m.length)
    })
    return m + "}"
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

// A decimal written out, times 10^exp, as java's BigDecimal.scaleByPowerOfTen(exp).stripTrailingZeros().toPlainString().
function scaledDecimal(written, exp) {
  var dot = written.indexOf(".")
  var digitsOnly = written.replace(".", "")
  var point = (dot < 0 ? written.length : dot) + exp
  while (point > digitsOnly.length) digitsOnly += "0"
  while (point < 1) { digitsOnly = "0" + digitsOnly; point++ }
  var whole = digitsOnly.slice(0, point).replace(/^0+(?=\d)/, "")
  var frac = digitsOnly.slice(point).replace(/0+$/, "")
  return frac ? whole + "." + frac : whole
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
    else if (unit !== "" && unit !== "s" && unit !== "dp" && unit !== "px" && unit !== "deg") {
      // 1e9: habit from other languages; say what to write instead.
      var em = /^[eE]([+-]?\d+)/.exec(src.slice(us))
      var exp = em ? parseInt(em[1], 10) : null
      if (exp !== null && exp >= -12 && exp <= 15)
        throw new CompileError("unknown unit '" + unit + "': numbers have no exponents, so write " + src.slice(s, us + em[0].length)
          + " as " + scaledDecimal(src.slice(s, us), exp), us)
      throw new CompileError("unknown unit '" + unit + "'", us)
    }
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
  // A trailing `secret` on the same line as a state.
  secret: function() {
    if (this.isId(this.t(), "secret") && !this.t().nl) { this.p++; return true }
    return false
  },
  ident: function(what) {
    if (this.t().type !== T_IDENT) this.fail("expected " + (what || "a name") + ", found " + this.desc(this.t()))
    return this.next().text
  },

  // What the file is, from its first word: a widget, a face (a whole home
  // page), an app, a panel or a key bar. This runtime draws widgets and faces; it
  // has no app drawer, no home screen to swipe a panel out of, and no soft keyboard
  // for the extra keys to sit over.
  widget: function() {
    var kind = ["widget", "face", "app", "panel", "keybar"].filter(function(w) { return this.isId(this.t(), w) }, this)[0]
    if (!kind) this.fail("an owl file starts with: widget \"name\" {, face \"name\" {, app \"name\" {, panel \"name\" { or keybar \"name\" {")
    if (kind === "app") this.fail("this is an app, and only the launcher has an app drawer to open it from")
    if (kind === "panel") this.fail("this is a panel, and only the launcher has the home screen and prompt bar that open it")
    if (kind === "keybar") this.fail("this is a key bar, and only the launcher has the soft keyboard it sits over")
    this.next()
    var name = this.t().type === T_STR ? this.literalString(this.next()) : null
    this.punct("{")
    var body = this.body(true)
    this.punct("}")
    this.expect(T_EOF)
    return { name: name, body: body, kind: kind }
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
        // `on x first { }`: for x's first value too.
        var first = word === "on" && this.isId(this.t(), "first")
        if (first) this.next()
        if (!this.isP(this.t(), "{")) this.fail("expected '{' with the statements to run: " + word + " ... { ... }")
        b.decls.push({ kind: "trigger", trigger: word, expr: e, stmts: this.handler(), pos: start.pos, first: first })
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
    if (kw.text === "state") {
      var init = this.expr()
      // In either order, so both together get a clear error.
      var persist = this.persist()
      var secret = this.secret()
      if (!persist) persist = this.persist()
      if (persist && secret) this.fail("a secret is kept already; it's state x = null secret, without persist")
      return { kind: "state", name: name, init: init, pos: kw.pos, persist: persist, secret: secret }
    }
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

  handler: function() { return this.isP(this.t(), "{") ? this.block() : [this.stmt()] },

  block: function() {
    this.punct("{")
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
    // A state named if or let still assigns, above.
    if (this.isId(start, "if")) {
      this.next()
      var cond = this.expr()
      if (!this.isP(this.t(), "{")) this.fail("expected '{' with the statements to run: if ... { ... }")
      var then = this.block()
      var orElse = []
      if (this.isId(this.t(), "else")) {
        this.next()
        orElse = this.isId(this.t(), "if") ? [this.stmt()] : this.block()
      }
      return { kind: "if", cond: cond, then: then, orElse: orElse, pos: start.pos }
    }
    if (this.isId(start, "let") && this.peek().type === T_IDENT && this.isP(this.peek(2), "=")) {
      this.next()
      var name = this.next().text
      this.next()
      return { kind: "let", name: name, value: this.expr(), pos: start.pos }
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
  terminal: [1, 2], app: [1, 1], run: [1, 1], post: [1, 3], url: [1, 1], launcher: [1, 1], refresh: [0, 1],
  media: [1, 1], androidApp: [1, 1], copy: [1, 1], notify: [1, 2], volume: [1, 2],
  notification: [1, 3], screen: [0, 0], close: [0, 0], torch: [1, 1], dnd: [1, 1], share: [1, 1], haptic: [0, 0], sound: [1, 1],
  open: [1, 1], ask: [1, 2], appAction: [2, 2], workApps: [1, 1], shortcuts: [1, 1],
  pressKey: [1, 1], typeText: [1, 1], latch: [1, 2], settings: [1, 1]
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

// ------------------------------------------------------------------ search
//
// AppSearch.kt: ranking for the launcher's bar, and for rank() and strongMatch(): what's typed is either an
// app to open or a prompt for an agent. Tiers are 100 apart so a usage boost (under 100) reorders within a
// tier, never across.

var EXACT = 600, PREFIX = 500, WORD_PREFIX = 400, INITIALS = 300, SUBSTRING = 200, SUBSEQUENCE = 100

// Kotlin's \p{M} and [^\p{L}\p{N}]; an engine without Unicode property escapes gets the common ranges.
var MARKS, WORD_BREAK
try {
  MARKS = new RegExp("\\p{M}+", "gu")
  WORD_BREAK = new RegExp("[^\\p{L}\\p{N}]+", "u")
} catch (e) {
  MARKS = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]+/g
  WORD_BREAK = /[^0-9A-Za-z\u00aa\u00b2\u00b3\u00b5\u00b9\u00ba\u00bc-\u00be\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02ff\u0370-\u1fff\u2070-\u209f\u2150-\u218f\u2460-\u24ff\u2c00-\ud7ff\uf900-\ufdff\ufe70-\ufefc\uff10-\uff19\uff21-\uff3a\uff41-\uff5a\uff66-\uffdc]+/
}

// Lowercase with accents stripped; lowercased first, so a mark lowercasing adds (İ's dot) goes too.
function foldAccents(s) { return s.toLowerCase().normalize("NFD").replace(MARKS, "") }

function searchWords(folded) { return folded.split(WORD_BREAK).filter(function(w) { return w.length > 0 }) }

function searchQuery(raw) {
  var t = foldAccents(raw.trim())
  return { text: t, words: searchWords(t) }
}

function matchScore(name, query) { return scoreFolded(foldAccents(name), searchQuery(query)) }

function scoreFolded(n, query) {
  var q = query.text
  if (!q.length) return 0
  if (n === q) return EXACT
  if (n.indexOf(q) === 0) return PREFIX
  var qw = query.words, nw = searchWords(n)
  if (qw.length && qw.every(function(w) { return nw.some(function(x) { return x.indexOf(w) === 0 }) })) return WORD_PREFIX
  if (qw.length === 1 && q.length >= 2 && nw.length > 1 && initialsStart(nw, q)) return INITIALS
  if (n.indexOf(q) >= 0) return SUBSTRING
  if (qw.length === 1 && isSubsequence(q, n)) return SUBSEQUENCE
  return 0
}

function initialsStart(nameWords, q) {
  if (q.length > nameWords.length) return false
  for (var i = 0; i < q.length; i++) if (nameWords[i].charAt(0) !== q.charAt(i)) return false
  return true
}

function isSubsequence(needle, hay) {
  var i = 0
  for (var k = 0; k < hay.length; k++) if (i < needle.length && hay.charAt(k) === needle.charAt(i)) i++
  return i === needle.length
}

// Enter opens the top app rather than asking the agent: a short query (two words at most, one line) that names it well.
function isStrongMatch(score, query) {
  return score >= INITIALS && query.indexOf("\n") < 0 && searchWords(foldAccents(query)).length <= 2
}

// rank() and strongMatch() read a map by its name and alias, as the bar reads apps; a text matches as it is.
function rankText(v) { return v === null || v === undefined ? null : show(v) }
function rankField(v, name) { return v instanceof Map && v.has(name) ? v.get(name) : null }
function rankName(v) { var t = rankText(v instanceof Map ? rankField(v, "name") : v); return t === null ? "" : t }
function rankAlias(v) { return rankText(rankField(v, "alias")) }

// Kotlin's compareTo on Strings: by UTF-16 units.
function unitCompare(a, b) { return a < b ? -1 : a > b ? 1 : 0 }

function rankMatches(items, query) {
  var q = searchQuery(query)
  if (!q.text.length) return []
  var hits = []
  items.forEach(function(item) {
    var n = rankName(item), folded = foldAccents(n), alias = rankAlias(item)
    var sc = Math.max(scoreFolded(folded, q), alias !== null ? scoreFolded(foldAccents(alias), q) : 0)
    if (sc <= 0) return
    var b = num(rankField(item, "score"))
    var boost = Math.min(Math.max(toInt((b === null ? 0 : b) * 10), 0), 99)
    hits.push({ item: item, order: sc + boost, length: n.length, folded: folded })
  })
  return stableSort(hits, function(x, y) {
    return y.order - x.order || x.length - y.length || unitCompare(x.folded, y.folded)
  }).map(function(h) { return h.item })
}

function lst(items) { return items.length > 1000 ? items.slice(0, 1000) : items }

// As java's Double.compareTo on x + 0.0: -0 is zero, and NaN sorts above everything, equal to itself.
function numCompare(x, y) {
  if (x < y) return -1
  if (x > y) return 1
  if (x === y) return 0
  return x !== x ? (y !== y ? 0 : 1) : -1
}

function compare(a, b) {
  var x = num(a), y = num(b)
  if (x !== null && y !== null) return numCompare(x, y)
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

// ------------------------------------------------------------ time zones
//
// fmtTime and parseTime take a zone (owl 9): a name ("Europe/Berlin") or an
// offset ("+02:00", "UTC"), as java's ZoneId.of reads them. QML's JS has no
// Intl, so a named zone is read from its TZif file in /usr/share/zoneinfo:
// its transitions, then the POSIX rule at its end for the years after them.
// A zone is {offset(ms) -> minutes east of UTC}; null is the system's.

function Zone(offset) { this.offset = offset }

var LOCAL_ZONE = new Zone(function(ms) { return -new Date(ms).getTimezoneOffset() })

function fixedZone(minutes) { return new Zone(function() { return minutes }) }

// How the bytes of a zone file are found: node reads them itself, and
// OwlHost.qml hands in a reader with setZoneReader().
var zoneReader = null
function setZoneReader(f) { zoneReader = f }
function readZoneFile(name) {
  if (zoneReader) return zoneReader(name)
  if (typeof require === "function") {
    try { return new Uint8Array(require("fs").readFileSync("/usr/share/zoneinfo/" + name)) } catch (e) { return null }
  }
  return null
}

var zoneCache = {}

function zone(v) {
  if (v === null || v === undefined || show(v) === "") return LOCAL_ZONE
  var name = show(v)
  if (zoneCache.hasOwnProperty(name)) return zoneCache[name]
  var z = parseZone(name)
  if (z === null) throw new WidgetError("unknown time zone '" + name + "'; use a name like \"Europe/Berlin\" or an offset like \"+02:00\"")
  zoneCache[name] = z
  return z
}

// ZoneOffset.of: Z, +h, +hh, +hh:mm, +hhmm, +hh:mm:ss, +hhmmss, within 18 hours. Minutes, or null.
function offsetMinutes(s) {
  if (s === "Z") return 0
  var m = /^([+-])(\d)$/.exec(s) || /^([+-])(\d{2})$/.exec(s) || /^([+-])(\d{2}):(\d{2})$/.exec(s)
    || /^([+-])(\d{2})(\d{2})$/.exec(s) || /^([+-])(\d{2}):(\d{2}):(\d{2})$/.exec(s) || /^([+-])(\d{2})(\d{2})(\d{2})$/.exec(s)
  if (!m) return null
  var h = +m[2], mi = m[3] === undefined ? 0 : +m[3], se = m[4] === undefined ? 0 : +m[4]
  if (h > 18 || mi > 59 || se > 59 || (h === 18 && (mi || se))) return null
  return (m[1] === "-" ? -1 : 1) * (h * 60 + mi + se / 60)
}

function parseZone(name) {
  var off = offsetMinutes(name)
  if (off !== null) return fixedZone(off)
  if (name === "UTC" || name === "GMT" || name === "UT") return fixedZone(0)
  var pre = /^(UTC|GMT|UT)([+-].*)$/.exec(name)
  if (pre) {
    var o = offsetMinutes(pre[2])
    return o === null ? null : fixedZone(o)
  }
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(name)) return null
  var bytes = readZoneFile(name)
  return bytes ? tzif(bytes) : null
}

// A TZif file (RFC 8536): the 64-bit transitions of version 2 and up, and the
// footer's POSIX TZ rule.
function tzif(b) {
  if (!b || b.length < 44 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== "TZif") return null
  function u32(i) { return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0 }
  function s32(i) { return u32(i) | 0 }
  function s64(i) { return s32(i) * 4294967296 + u32(i + 4) }
  function counts(at) { return { ut: u32(at + 20), std: u32(at + 24), leap: u32(at + 28), time: u32(at + 32), type: u32(at + 36), chars: u32(at + 40) } }
  var c = counts(0)
  var v2 = b[4] >= 50
  var at = 44
  var size = 4
  if (v2) {
    at += c.time * 5 + c.type * 6 + c.chars + c.leap * 8 + c.std + c.ut
    c = counts(at)
    at += 44
    size = 8
  }
  var times = [], idx = [], types = []
  for (var i = 0; i < c.time; i++) times.push(size === 8 ? s64(at + i * 8) : s32(at + i * 4))
  at += c.time * size
  for (i = 0; i < c.time; i++) idx.push(b[at + i])
  at += c.time
  for (i = 0; i < c.type; i++) types.push({ off: s32(at + i * 6) / 60, dst: b[at + i * 6 + 4] === 1 })
  at += c.type * 6 + c.chars + c.leap * (size + 4) + c.std + c.ut
  var rule = null
  if (v2 && b[at] === 10) {
    var footer = ""
    for (var j = at + 1; j < b.length && b[j] !== 10; j++) footer += String.fromCharCode(b[j])
    rule = posixRule(footer)
  }
  if (!types.length) return null
  // Before the first transition: the first standard time, as zic writes it.
  var before = types[0]
  for (i = 0; i < types.length; i++) if (!types[i].dst) { before = types[i]; break }
  return new Zone(function(ms) {
    var t = Math.floor(ms / 1000)
    if (!times.length || t < times[0]) return times.length || !rule ? before.off : rule(t)
    if (t >= times[times.length - 1] && rule) return rule(t)
    var lo = 0, hi = times.length - 1
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1
      if (times[mid] <= t) lo = mid; else hi = mid - 1
    }
    return types[idx[lo]].off
  })
}

// "CET-1CEST,M3.5.0,M10.5.0/3" as t (Unix seconds) -> minutes east of UTC.
function posixRule(s) {
  var i = 0
  function name() {
    if (s.charAt(i) === "<") { var e = s.indexOf(">", i); if (e < 0) return null; i = e + 1; return true }
    var st = i
    while (i < s.length && /[A-Za-z]/.test(s.charAt(i))) i++
    return i - st >= 3 ? true : null
  }
  // [+-]hh[:mm[:ss]] in seconds.
  function clock() {
    var m = /^([+-]?)(\d{1,3})(?::(\d{2}))?(?::(\d{2}))?/.exec(s.slice(i))
    if (!m) return null
    i += m[0].length
    return (m[1] === "-" ? -1 : 1) * (+m[2] * 3600 + (m[3] ? +m[3] * 60 : 0) + (m[4] ? +m[4] : 0))
  }
  if (!name()) return null
  var std = clock()
  if (std === null) return null
  var stdOff = -std / 60
  if (i >= s.length) return function() { return stdOff }
  if (!name()) return null
  var dstOff = stdOff + 60
  if (s.charAt(i) !== ",") {
    var d = clock()
    if (d === null) return null
    dstOff = -d / 60
  }
  function date() {
    if (s.charAt(i) !== ",") return null
    i++
    var m = /^M(\d{1,2})\.(\d)\.(\d)|^J(\d{1,3})|^(\d{1,3})/.exec(s.slice(i))
    if (!m) return null
    i += m[0].length
    var time = 7200
    if (s.charAt(i) === "/") { i++; time = clock(); if (time === null) return null }
    return { m: m[1] ? +m[1] : 0, w: m[2] ? +m[2] : 0, d: m[3] ? +m[3] : 0, julian: m[4] ? +m[4] : -1, day: m[5] ? +m[5] : -1, time: time }
  }
  var start = date(), end = date()
  if (!start || !end) return function() { return stdOff }
  // The rule's day in a year, as Unix seconds of its local midnight.
  function dayOf(r, y) {
    if (r.julian >= 0) {
      var leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
      return Date.UTC(y, 0, r.julian + (leap && r.julian >= 60 ? 1 : 0)) / 1000
    }
    if (r.day >= 0) return Date.UTC(y, 0, 1 + r.day) / 1000
    var first = new Date(Date.UTC(y, r.m - 1, 1)).getUTCDay()
    var dom = 1 + (r.d - first + 7) % 7 + (r.w - 1) * 7
    var days = new Date(Date.UTC(y, r.m, 0)).getUTCDate()
    while (dom > days) dom -= 7
    return Date.UTC(y, r.m - 1, dom) / 1000
  }
  return function(t) {
    var y = new Date(t * 1000).getUTCFullYear()
    // The year's switches: the start read in standard time, the end in summer time.
    var on = dayOf(start, y) + start.time - stdOff * 60
    var off = dayOf(end, y) + end.time - dstOff * 60
    // South of the equator summer spans the new year.
    var summer = on < off ? t >= on && t < off : t < off || t >= on
    return summer ? dstOff : stdOff
  }
}

// The epoch milliseconds of a wall-clock time in a zone, as ZonedDateTime.of
// places it: in an overlap the earlier offset, in a gap later by its length.
function zonedMs(localMs, z) {
  var before = z.offset(localMs - 86400000), after = z.offset(localMs + 86400000)
  var a = z.offset(localMs - before * 60000) === before
  var b = z.offset(localMs - after * 60000) === after
  if (a) return localMs - before * 60000
  if (b) return localMs - after * 60000
  return localMs - before * 60000
}

// A time in a zone as the fields a pattern reads.
function fieldsAt(ms, z) {
  var off = z.offset(ms)
  var d = new Date(ms + off * 60000)
  return {
    y: d.getUTCFullYear(), M: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay(), H: d.getUTCHours(),
    m: d.getUTCMinutes(), s: d.getUTCSeconds(), ms: d.getUTCMilliseconds(), off: off,
    doy: Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1
  }
}

// ------------------------------------------------------------ languages
//
// Day and month names in a language a widget names (owl 9); English
// otherwise, which is this shell's. QML has Qt.locale, node has Intl.

var namesCache = {}

function englishNames() {
  return {
    months: MONTHS, monthsShort: MONTHS.map(function(m) { return m.slice(0, 3) }),
    standalone: MONTHS, standaloneShort: MONTHS.map(function(m) { return m.slice(0, 3) }),
    days: DAYS, daysShort: DAYS.map(function(d) { return d.slice(0, 3) }), am: "AM", pm: "PM"
  }
}

function names(language) {
  if (!language) return englishNames()
  if (namesCache.hasOwnProperty(language)) return namesCache[language]
  var out = englishNames()
  try {
    if (typeof Qt !== "undefined" && Qt.locale) {
      var l = Qt.locale(language.replace(/-/g, "_"))
      var range = function(n, f) { var r = []; for (var i = 0; i < n; i++) r.push(f(i)); return r }
      // Qt counts days from Monday as 1 and Sunday as 0 or 7; months from 0.
      out = {
        months: range(12, function(i) { return l.monthName(i, 0) }),
        monthsShort: range(12, function(i) { return l.monthName(i, 1) }),
        standalone: range(12, function(i) { return l.standaloneMonthName(i, 0) }),
        standaloneShort: range(12, function(i) { return l.standaloneMonthName(i, 1) }),
        days: range(7, function(i) { return l.dayName(i, 0) }),
        daysShort: range(7, function(i) { return l.dayName(i, 1) }),
        am: l.amText || "AM", pm: l.pmText || "PM"
      }
    } else if (typeof Intl !== "undefined") {
      var part = function(opts, ms, type) {
        var ps = new Intl.DateTimeFormat(language, Object.assign({ timeZone: "UTC" }, opts)).formatToParts(new Date(ms))
        for (var i = 0; i < ps.length; i++) if (ps[i].type === type) return ps[i].value
        return ""
      }
      var month = function(i, w, alone) { return part(alone ? { month: w } : { month: w, day: "numeric" }, Date.UTC(2026, i, 15), "month") }
      // 2026-03-01 is a Sunday.
      var day = function(i, w) { return part({ weekday: w }, Date.UTC(2026, 2, 1 + i), "weekday") }
      var range2 = function(n, f) { var r = []; for (var i = 0; i < n; i++) r.push(f(i)); return r }
      out = {
        months: range2(12, function(i) { return month(i, "long", false) }),
        monthsShort: range2(12, function(i) { return month(i, "short", false) }),
        standalone: range2(12, function(i) { return month(i, "long", true) }),
        standaloneShort: range2(12, function(i) { return month(i, "short", true) }),
        days: range2(7, function(i) { return day(i, "long") }),
        daysShort: range2(7, function(i) { return day(i, "short") }),
        am: part({ hour: "numeric", hour12: true }, Date.UTC(2026, 0, 1, 9), "dayPeriod") || "AM",
        pm: part({ hour: "numeric", hour12: true }, Date.UTC(2026, 0, 1, 21), "dayPeriod") || "PM"
      }
    }
  } catch (e) {}
  namesCache[language] = out
  return out
}

// A pattern's pieces: {lit} for text, {c, n} for a run of one letter.
function patternParts(pattern) {
  var out = []
  var i = 0
  while (i < pattern.length) {
    var c = pattern.charAt(i)
    if (c === "'") {
      var close = pattern.indexOf("'", i + 1)
      if (close < 0) throw new WidgetError("bad time pattern")
      out.push({ lit: close === i + 1 ? "'" : pattern.slice(i + 1, close) })
      i = close + 1
      continue
    }
    if (!/[A-Za-z]/.test(c)) { out.push({ lit: c }); i++; continue }
    var n = 1
    while (pattern.charAt(i + n) === c) n++
    if ("yuMLdEecHkhKmsSaDQqZxX".indexOf(c) < 0) throw new WidgetError("bad time pattern")
    out.push({ c: c, n: n })
    i += n
  }
  return out
}

function offsetText(off, c, n) {
  var sign = off < 0 ? "-" : "+"
  var a = Math.abs(Math.round(off))
  var hh = zpad(Math.floor(a / 60), 2), mm = zpad(a % 60, 2)
  if (c === "X" && off === 0) return "Z"
  if (c === "X" || c === "x") {
    if (n === 1) return sign + hh + (a % 60 ? mm : "")
    if (n === 2 || n === 4) return sign + hh + mm
    return sign + hh + ":" + mm
  }
  if (n === 4) return off === 0 ? "GMT" : "GMT" + sign + hh + ":" + mm
  if (n === 5) return off === 0 ? "Z" : sign + hh + ":" + mm
  return sign + hh + mm
}

// java.time's DateTimeFormatter, for the letters a widget would use, in a
// zone and a language.
function fmtTime(seconds, pattern, z, language) {
  var f = fieldsAt(toLong(seconds * 1000), z || LOCAL_ZONE)
  var nm = names(language || "")
  var out = ""
  patternParts(pattern).forEach(function(p) {
    if (p.lit !== undefined) { out += p.lit; return }
    var c = p.c, n = p.n, h = f.H
    if (c === "y" || c === "u") out += n === 2 ? zpad(f.y % 100, 2) : zpad(f.y, n)
    else if (c === "M" || c === "L") {
      var alone = c === "L"
      out += n === 5 ? nm.standalone[f.M].charAt(0) : n === 4 ? (alone ? nm.standalone : nm.months)[f.M]
        : n === 3 ? (alone ? nm.standaloneShort : nm.monthsShort)[f.M] : zpad(f.M + 1, n)
    } else if (c === "d") out += zpad(f.d, n)
    else if (c === "E") out += n === 5 ? nm.days[f.dow].charAt(0) : n === 4 ? nm.days[f.dow] : nm.daysShort[f.dow]
    else if (c === "e" || c === "c") out += n >= 4 ? nm.days[f.dow] : n === 3 ? nm.daysShort[f.dow] : String((f.dow - weekStart + 7) % 7 + 1)
    else if (c === "H") out += zpad(h, n)
    else if (c === "k") out += zpad(h === 0 ? 24 : h, n)
    else if (c === "h") out += zpad(h % 12 === 0 ? 12 : h % 12, n)
    else if (c === "K") out += zpad(h % 12, n)
    else if (c === "m") out += zpad(f.m, n)
    else if (c === "s") out += zpad(f.s, n)
    else if (c === "S") { var frac = zpad(f.ms, 3) + "000000"; out += frac.slice(0, n) }
    else if (c === "a") out += h < 12 ? nm.am : nm.pm
    else if (c === "D") out += zpad(f.doy, n)
    else if (c === "Q" || c === "q") out += String(Math.floor(f.M / 3) + 1)
    else out += offsetText(f.off, c, n)
  })
  return out
}

// ------------------------------------------------------------ parseTime

var MONTH_INDEX = {}
MONTHS.forEach(function(m, i) { MONTH_INDEX[m.slice(0, 3).toLowerCase()] = i })

// Days in a month; the resolver java's formatters use (SMART) moves a 29th
// to 31st that isn't in the month to its last day.
function daysIn(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate() }

// Unix seconds of a wall-clock time in a zone; null if it isn't a time.
function epochOf(y, mo, d, h, mi, s, nanos, z, smart) {
  if (mo < 0 || mo > 11 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null
  if (d > daysIn(y, mo)) {
    if (!smart || d > 31) return null
    d = daysIn(y, mo)
  }
  var local = Date.UTC(y, mo, d, h, mi, s)
  // Date.UTC reads years 0-99 as 1900-1999.
  if (y >= 0 && y < 100) local = new Date(local).setUTCFullYear(y)
  return zonedMs(local, z) / 1000 + nanos / 1e9
}

var ISO_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)? ?(Z|[+-]\d{2}(?::?\d{2})?)?$/i
var BASIC_TIME = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/i
var RFC_1123 = /^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun), )?(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2})(?::(\d{2}))? (GMT|[+-]\d{4})$/i
var RFC_822_ZONES = { UT: "+0000", UTC: "+0000", Z: "+0000", EST: "-0500", EDT: "-0400", CST: "-0600", CDT: "-0500",
  MST: "-0700", MDT: "-0600", PST: "-0800", PDT: "-0700" }

// Unix seconds for a date in text: ISO 8601, iCalendar's basic form, RFC 1123,
// or what a java.time pattern describes, in English. A date without a zone is
// a time in z; a pattern without a date is today there, one without a time
// midnight. Null when it isn't one.
function parseTime(textIn, pattern, z) {
  var s = textIn.trim()
  if (pattern !== "") return parseWithPattern(s, pattern, z)
  var iso = ISO_TIME.exec(s)
  var m = iso || BASIC_TIME.exec(s)
  if (m) {
    var part = function(i) { return m[i] === undefined || m[i] === "" ? 0 : +m[i] }
    var nanos = iso && m[7] ? +(m[7] + "000000000").slice(0, 9) : 0
    // The zone is the last group in both forms.
    var offset = (m[m.length - 1] || "").toUpperCase()
    var oz = z
    if (offset !== "") {
      var om = offsetMinutes(offset)
      // An offset past ±18:00 (+99:99) isn't one: null, like any text that isn't a date.
      if (om === null) return null
      oz = fixedZone(om)
    }
    return epochOf(part(1), part(2) - 1, part(3), part(4), part(5), part(6), nanos, oz, false)
  }
  var named = s.slice(s.lastIndexOf(" ") + 1)
  var rfc = RFC_822_ZONES.hasOwnProperty(named.toUpperCase()) ? s.slice(0, s.length - named.length) + RFC_822_ZONES[named.toUpperCase()] : s
  var r = RFC_1123.exec(rfc)
  if (!r) return null
  var off = r[8].toUpperCase() === "GMT" ? 0 : offsetMinutes(r[8])
  if (off === null) return null
  var y = +r[4], mo = MONTH_INDEX[r[3].toLowerCase()], d = +r[2]
  if (d < 1 || d > 31) return null
  if (d > daysIn(y, mo)) d = daysIn(y, mo)
  // The day of the week, when given, has to be the date's.
  if (r[1] && DAYS[new Date(Date.UTC(y, mo, d)).getUTCDay()].slice(0, 3).toLowerCase() !== r[1].toLowerCase()) return null
  return epochOf(y, mo, d, +r[5], +r[6], r[7] ? +r[7] : 0, 0, fixedZone(off), true)
}

function regexQuote(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&") }

function parseWithPattern(s, pattern, z) {
  var parts
  try { parts = patternParts(pattern) } catch (e) { throw new WidgetError("bad time pattern '" + pattern + "'") }
  var nm = englishNames()
  var re = "", fields = []
  function alt(list) { return "(" + list.map(regexQuote).sort(function(a, b) { return b.length - a.length }).join("|") + ")" }
  parts.forEach(function(p) {
    if (p.lit !== undefined) { re += regexQuote(p.lit); return }
    var c = p.c, n = p.n
    var digits = n === 1 ? "(\\d{1,2})" : "(\\d{" + n + "})"
    if (c === "y" || c === "u") re += n === 2 ? "(\\d{2})" : n === 1 ? "(\\d{1,10})" : "(\\d{" + n + ",10})"
    else if (c === "M" || c === "L") re += n >= 4 ? alt(nm.months) : n === 3 ? alt(nm.monthsShort) : digits
    else if (c === "E") re += n === 4 ? alt(nm.days) : alt(nm.daysShort)
    else if (c === "a") re += "(AM|PM)"
    else if (c === "S") re += "(\\d{" + n + "})"
    else if (c === "X" || c === "x" || c === "Z") re += "(Z|[+-]\\d{2}(?::?\\d{2})?|GMT(?:[+-]\\d{2}:\\d{2})?)"
    else if ("dHkhKms".indexOf(c) >= 0) re += digits
    else if (c === "D") re += "(\\d{1,3})"
    else throw new WidgetError("bad time pattern '" + pattern + "'")
    fields.push(p)
  })
  var m = new RegExp("^" + re + "$", "i").exec(s)
  if (!m) return null
  var v = {}
  for (var i = 0; i < fields.length; i++) {
    var c = fields[i].c, n = fields[i].n, t = m[i + 1]
    var lower = t.toLowerCase()
    var find = function(list) { for (var k = 0; k < list.length; k++) if (list[k].toLowerCase() === lower) return k; return -1 }
    var value
    if (c === "y" || c === "u") value = n === 2 ? 2000 + +t : +t
    else if (c === "M" || c === "L") value = n >= 4 ? find(nm.months) : n === 3 ? find(nm.monthsShort) : +t - 1
    else if (c === "E") value = find(n === 4 ? nm.days : nm.daysShort)
    else if (c === "a") value = lower === "pm" ? 1 : 0
    else if (c === "S") value = +(t + "000000000").slice(0, 9)
    else if (c === "X" || c === "x" || c === "Z") {
      var u = t.toUpperCase()
      value = u === "GMT" || u === "Z" ? 0 : u.indexOf("GMT") === 0 ? offsetMinutes(u.slice(3)) : offsetMinutes(u)
      if (value === null) return null
      c = "zone"
    } else value = +t
    // A field given twice must say the same both times.
    if (v.hasOwnProperty(c) && v[c] !== value) return null
    v[c] = value
  }
  var tz = v.hasOwnProperty("zone") ? fixedZone(v.zone) : z
  var today = fieldsAt(Date.now(), z)
  var y, mo, d
  var year = v.hasOwnProperty("y") ? v.y : v.hasOwnProperty("u") ? v.u : null
  var month = v.hasOwnProperty("M") ? v.M : v.hasOwnProperty("L") ? v.L : null
  if (year !== null && month !== null && v.hasOwnProperty("d")) { y = year; mo = month; d = v.d }
  else if (year !== null && v.hasOwnProperty("D")) {
    y = year
    var jan = new Date(Date.UTC(y, 0, v.D))
    if (v.D < 1 || jan.getUTCFullYear() !== y) return null
    mo = jan.getUTCMonth(); d = jan.getUTCDate()
  } else if (month !== null && v.hasOwnProperty("d")) {
    // A month and day without a year: this year's, where the day has to exist.
    y = today.y; mo = month; d = v.d
    if (d < 1 || d > daysIn(y, mo)) return null
  } else { y = today.y; mo = today.M; d = today.d }
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null
  if (d > daysIn(y, mo)) d = daysIn(y, mo)
  var h = 0, mi = 0, sec = 0, nanos = 0
  if (v.hasOwnProperty("H") || v.hasOwnProperty("k") || (v.hasOwnProperty("a") && (v.hasOwnProperty("h") || v.hasOwnProperty("K")))) {
    if (v.hasOwnProperty("H")) h = v.H
    else if (v.hasOwnProperty("k")) h = v.k === 24 ? 0 : v.k
    else {
      var hour = v.hasOwnProperty("h") ? v.h : v.K
      if (v.hasOwnProperty("h") && (hour < 1 || hour > 12)) return null
      if (v.hasOwnProperty("K") && hour > 11) return null
      h = hour % 12 + 12 * v.a
    }
    mi = v.hasOwnProperty("m") ? v.m : 0
    sec = v.hasOwnProperty("s") ? v.s : 0
    nanos = v.hasOwnProperty("S") ? v.S : 0
  }
  if (v.hasOwnProperty("E") && DAYS.indexOf(DAYS[new Date(Date.UTC(y, mo, d)).getUTCDay()]) !== v.E) return null
  return epochOf(y, mo, d, h, mi, sec, nanos, tz, true)
}

// ------------------------------------------------------------ numbers

// How long ago seconds were, short: now, 5m, 3h, 2d, 6w, 1y; a time still to come is "in 5m".
function fmtAgo(seconds) {
  var s = Math.abs(seconds)
  var short
  if (s < 60) return "now"
  if (s < 3600) short = toLong(s / 60) + "m"
  else if (s < 86400) short = toLong(s / 3600) + "h"
  else if (s < 7 * 86400) short = toLong(s / 86400) + "d"
  else if (s < 365 * 86400) short = toLong(s / (7 * 86400)) + "w"
  else short = toLong(s / (365 * 86400)) + "y"
  return seconds < 0 ? "in " + short : short
}

var COMPACT_UNITS = ["", "k", "M", "B", "T"]

// x in the shell's language (English), its thousands grouped, with digits after
// the point. Compact divides by thousands into k, M, B and T, with one digit
// under 10 and none above unless digits says otherwise (a trailing .0 then
// goes); sign puts + before a number above zero.
function fmtNum(x, digits, compact, sign) {
  if (x !== x || !isFinite(x)) return numText(x)
  function digitsFor(v) { return digits !== null ? clampNum(digits, 0, 10) : compact && Math.abs(v) < 10 ? 1 : 0 }
  function shown(v, d) { var p = Math.pow(10, d); return roundHalfUp(Math.abs(v) * p) / p }
  var v = x, unit = 0, d = digitsFor(v)
  // 999.97 shows as 1000 at one digit: that's 1k.
  while (compact && unit < COMPACT_UNITS.length - 1 && shown(v, d) >= 1000) {
    v /= 1000
    unit++
    d = digitsFor(v)
  }
  // No "-0" for a number that rounds to zero.
  if (Math.abs(v) < 0.5 / Math.pow(10, d)) v = 0
  var s = fixed(v, d)
  if (!compact) s = s.replace(/^(-?)(\d+)/, function(all, minus, whole) { return minus + whole.replace(/\B(?=(\d{3})+$)/g, ",") })
  if (compact && digits === null && d > 0) s = s.replace(/0+$/, "").replace(/\.+$/, "")
  return (sign && v > 0 ? "+" : "") + s + COMPACT_UNITS[unit]
}

// Math.round as java has it, exact also where x + 0.5 would round up in floating point.
function javaRound(x) {
  var f = Math.floor(x)
  return x - f >= 0.5 ? f + 1 : f
}

// round(x, digits): from 2^52 up a double has no fraction left to round, and
// Kotlin's roundToLong would stop at Long.MAX_VALUE, so it stays as it is.
function roundTo(x, digits) {
  var p = Math.pow(10, digits)
  var v = x * p
  return v !== v ? NaN : Math.abs(v) >= 4503599627370496 ? x : javaRound(v) / p
}

// FNV-1a over the text of values, mixed to spread nearby inputs apart
// (murmur3's finish), in [0, 1): the launcher's hash, bit for bit.
function hashOf(values) {
  var h = 0x811c9dc5 | 0
  for (var i = 0; i < values.length; i++) {
    // A NUL between values: hash("ab", "c") isn't hash("a", "bc").
    if (i > 0) h = Math.imul(h, 0x01000193)
    var s = show(values[i])
    for (var k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b | 0)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35 | 0)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

// mulberry32, seeded from the seed's hash: the same seed shuffles the same way here and in the launcher.
function seeded(seed) {
  var state = (hashOf([seed]) * 4294967296) | 0
  return function() {
    state = (state + 0x6d2b79f5) | 0
    var t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t = t ^ ((t + Math.imul(t ^ (t >>> 7), t | 61)) | 0)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Fisher-Yates; next gives numbers in [0, 1).
function shuffled(items, next) {
  var out = items.slice()
  for (var i = out.length - 1; i >= 1; i--) {
    var j = toInt(next() * (i + 1))
    var t = out[i]; out[i] = out[j]; out[j] = t
  }
  return out
}

function flattenTo(items, depth) {
  if (depth <= 0) return items
  var out = []
  items.forEach(function(v) { if (Array.isArray(v)) out.push.apply(out, flattenTo(v, depth - 1)); else out.push(v) })
  return out
}

// v with key set to `to` (removed, for undefined): a list by index, from the end
// when it's negative, or a map by name. An index that isn't in it changes
// nothing; null is an empty map.
function edited(v, key, to) {
  if (Array.isArray(v)) {
    var n = num(key)
    var i = n === null ? null : toInt(n)
    if (i !== null && i < 0) i += v.length
    if (i === null || i < 0 || i >= v.length) return v
    var out = v.slice()
    if (to === undefined) out.splice(i, 1)
    else out[i] = to
    return out
  }
  if (v instanceof Map) {
    var m = new Map(v)
    if (to === undefined) m.delete(show(key)); else m.set(show(key), to)
    return m
  }
  if (v === null) return to === undefined ? null : new Map([[show(key), to]])
  return v
}

// Json.write: JSON text of numbers, text, lists and maps; null for anything else.
function jsonText(v, limit) {
  if (v === null || v === undefined) return "null"
  if (typeof v === "boolean") return v ? "true" : "false"
  if (typeof v === "number") return isFinite(v) ? numText(v) : "null"
  if (typeof v === "string") return jsonQuote(v)
  if (Array.isArray(v)) {
    var items = [], size = 0
    for (var i = 0; i < v.length; i++) {
      var t = jsonText(v[i], limit)
      if (t === null) return null
      items.push(t)
      if (limit !== undefined) { size += t.length + 1; if (size > limit) throw new WidgetError("JSON over " + (limit >> 20) + "M characters") }
    }
    return "[" + items.join(",") + "]"
  }
  if (v instanceof Map) {
    var out = [], bad = false, total = 0
    v.forEach(function(value, key) {
      var t = bad ? null : jsonText(value, limit)
      if (t === null) bad = true
      else {
        var entry = jsonQuote(key) + ":" + t
        out.push(entry)
        if (limit !== undefined) { total += entry.length + 1; if (total > limit) throw new WidgetError("JSON over " + (limit >> 20) + "M characters") }
      }
    })
    return bad ? null : "{" + out.join(",") + "}"
  }
  return null
}

function jsonQuote(s) {
  var out = "\""
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i)
    if (c === "\"") out += "\\\""
    else if (c === "\\") out += "\\\\"
    else if (c === "\n") out += "\\n"
    else if (c === "\r") out += "\\r"
    else if (c === "\t") out += "\\t"
    else if (c < " ") out += "\\u" + zpad(c.charCodeAt(0).toString(16), 4)
    else out += c
  }
  return out + "\""
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

// Text as UTF-8 bytes, as java's String.toByteArray(): a lone surrogate is "?".
function utf8Bytes(s) {
  var out = []
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i)
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xFC00) === 0xDC00) {
      c = 0x10000 + ((c - 0xD800) << 10) + (s.charCodeAt(++i) - 0xDC00)
    } else if (c >= 0xD800 && c <= 0xDFFF) c = 0x3F
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xC0 | c >> 6, 0x80 | c & 63)
    else if (c < 0x10000) out.push(0xE0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63)
    else out.push(0xF0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63)
  }
  return out
}

// UTF-8 bytes as text, a malformed sequence as U+FFFD, as java's new String(bytes, UTF_8).
function utf8Text(b) {
  var out = ""
  var i = 0
  while (i < b.length) {
    var c = b[i]
    var n = c < 0x80 ? 0 : c >= 0xC2 && c <= 0xDF ? 1 : c >= 0xE0 && c <= 0xEF ? 2 : c >= 0xF0 && c <= 0xF4 ? 3 : -1
    if (n < 0) { out += "\uFFFD"; i++; continue }
    var cp = n === 0 ? c : c & (0x3F >> n)
    var ok = 1
    for (; ok <= n; ok++) {
      var x = b[i + ok]
      // The second byte's range rules out overlong forms, surrogates and code points past U+10FFFF.
      var lo = 0x80, hi = 0xBF
      if (ok === 1) {
        if (c === 0xE0) lo = 0xA0
        else if (c === 0xED) hi = 0x9F
        else if (c === 0xF0) lo = 0x90
        else if (c === 0xF4) hi = 0x8F
      }
      if (x === undefined || x < lo || x > hi) break
      cp = cp << 6 | x & 63
    }
    if (ok <= n) { out += "\uFFFD"; i += ok; continue }
    out += String.fromCharCode.apply(null, cp >= 0x10000 ? [0xD800 + (cp - 0x10000 >> 10), 0xDC00 + (cp - 0x10000 & 1023)] : [cp])
    i += n + 1
  }
  return out
}

var BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

function toBase64(b) {
  var out = ""
  for (var i = 0; i < b.length; i += 3) {
    var n = b[i] << 16 | (i + 1 < b.length ? b[i + 1] << 8 : 0) | (i + 2 < b.length ? b[i + 2] : 0)
    out += BASE64.charAt(n >> 18 & 63) + BASE64.charAt(n >> 12 & 63)
      + (i + 1 < b.length ? BASE64.charAt(n >> 6 & 63) : "=") + (i + 2 < b.length ? BASE64.charAt(n & 63) : "=")
  }
  return out
}

// Padded base64 as bytes, as java's Base64 decoder reads it; null for anything else.
function fromBase64(s) {
  if (s.length % 4 || !/^[A-Za-z0-9+\/]*(==?)?$/.test(s)) return null
  var body = s.replace(/=+$/, "")
  if (body.length % 4 === 1) return null
  var out = []
  var bits = 0, acc = 0
  for (var i = 0; i < body.length; i++) {
    acc = acc << 6 | BASE64.indexOf(body.charAt(i))
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push(acc >> bits & 255)
    }
  }
  return out
}

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
    var r = roundTo(a.num(0), a.int(1, 0))
    if (r !== r) throw new WidgetError("round: Cannot round NaN value.")
    return r
  })),
  floor: math(Math.floor), ceil: math(Math.ceil), abs: math(Math.abs), sqrt: math(Math.sqrt),
  sin: math(Math.sin), cos: math(Math.cos), tan: math(Math.tan),
  rad: math(function(x) { return x / 180 * Math.PI }), deg: math(function(x) { return x * 180 / Math.PI }),
  sign: math(function(x) { return x !== x ? x : x > 0 ? 1 : x < 0 ? -1 : x }),
  // owl 9
  asin: math(Math.asin), acos: math(Math.acos),
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
  // owl 9: the first letter in capitals, the rest as it is.
  capitalize: B(1, 1, strict(function(a) { var s = a.str(0); return s.charAt(0).toUpperCase() + s.slice(1) })),
  lower: B(1, 1, function(a) { return a.str(0).toLowerCase() }),
  lines: B(1, 1, function(a) { return lst(linesOf(a.str(0)).filter(function(l) { return l.trim() !== "" })) }),
  words: B(1, 1, function(a) { return lst(a.str(0).trim().split(/\s+/).filter(function(w) { return w.length > 0 })) }),
  split: B(2, 2, function(a) { return lst(splitStr(a.str(0), a.str(1))) }),
  join: B(1, 2, function(a) {
    var sep = a.size > 1 ? a.str(1) : ""
    var out = ""
    a.list(0).forEach(function(v, i) {
      if (i > 0) out += sep
      out += typeof v === "string" ? v : show(v)
      checkText(out.length)
    })
    return out
  }),
  replace: B(3, 3, function(a) {
    var s = a.str(0), f = a.str(1), r = a.str(2)
    // "a" for every character of a long text multiplies it.
    if (r.length > f.length && f.length > 0) checkText(Math.floor(s.length / f.length) * r.length + s.length)
    if (f === "") return splitStr(s, "").join(r)
    return s.split(f).join(r)
  }),
  // owl 6: a value as one shell word, for commands put together while the widget runs.
  sh: B(1, 1, function(a) {
    var v = a.get(0)
    return "'" + (v === null ? "" : text(v)).split("'").join("'\\''") + "'"
  }),
  // owl 8: a value as one URL component, for http(...) URLs put together while the widget runs.
  enc: B(1, 1, function(a) {
    var v = a.get(0)
    // As java's URLEncoder, with %20 for spaces: only letters, digits and . - * _ stay as they are.
    return encodeURIComponent(v === null ? "" : text(v)).replace(/[!'()~]/g, function(c) {
      return "%" + c.charCodeAt(0).toString(16).toUpperCase()
    })
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
  // fmtTime(seconds, "HH:mm"): java.time patterns in the shell's time zone; owl 9 takes a zone and a language too.
  fmtTime: B(2, 4, strict(function(a) {
    // NaN and infinity aren't times: null, as for a value still loading, rather than 1970's midnight.
    if (!isFinite(a.num(0))) return null
    var z = zone(a.get(2))
    try { return fmtTime(a.num(0), a.str(1), z, a.str(3)) } catch (e) { throw new WidgetError("bad time pattern '" + a.str(1) + "'") }
  })),
  // owl 9: parseTime("2026-10-17T10:04:00Z") is Unix seconds, null if the text isn't a date.
  // Not folded: a time without a date is today's, and one without a zone the shell's.
  parseTime: B(1, 3, strict(function(a) { return parseTime(a.str(0), a.str(1), zone(a.get(2))) }), false),
  // owl 9: fmtAgo(t, now) is "5m", "3h", "2d"; now comes from a clock source, so it stays current.
  fmtAgo: B(2, 2, strict(function(a) { return a.get(1) === null ? null : fmtAgo(a.num(1) - a.num(0)) })),
  // owl 9: fmtNum(x, digits) or fmtNum(x, {digits, compact, sign}). Not folded: it's in the phone's language.
  fmtNum: B(1, 2, strict(function(a) {
    if (!isFinite(a.num(0))) return null
    var o = a.get(1)
    if (o instanceof Map) {
      var dg = o.has("digits") ? num(o.get("digits")) : null
      return fmtNum(a.num(0), dg === null ? null : toInt(dg), truthy(o.get("compact")), truthy(o.get("sign")))
    }
    if (o === null) return fmtNum(a.num(0), null, false, false)
    var n = num(o)
    if (n === null) throw new WidgetError("fmtNum takes a number of digits or a map like {compact: true}")
    return fmtNum(a.num(0), toInt(n), false, false)
  }), false),
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
  // owl 12: text as base64 and back; fromBase64 also reads base64url, with or without padding, and gives null
  // for anything else.
  toBase64: B(1, 1, function(a) { return toBase64(utf8Bytes(a.str(0))) }),
  fromBase64: B(1, 1, function(a) {
    var s = a.str(0).replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "")
    while (s.length % 4) s += "="
    var bytes = fromBase64(s)
    return bytes === null ? null : utf8Text(bytes)
  }),
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
  // owl 11: chunk(list, n), the list in lists of n, the last one shorter: rows of a grid built by hand.
  chunk: B(2, 2, function(a) {
    var l = a.list(0)
    a.tick(l.length)
    var n = Math.max(a.int(1, 1), 1), out = []
    for (var i = 0; i < l.length; i += n) out.push(l.slice(i, i + n))
    return lst(out)
  }),
  // owl 11: the matches of a query best first, as the bar ranks apps: by a map's name (and alias), with its score as the boost.
  rank: B(2, 2, function(a) {
    var l = a.list(0)
    a.tick(l.length * 4)
    return lst(rankMatches(l, a.str(1)))
  }),
  // owl 11: whether Enter in the bar would open this match rather than ask the agent; the tiers stay the launcher's.
  strongMatch: B(2, 2, function(a) {
    var item = a.get(0), q = a.str(1)
    var alias = rankAlias(item)
    var sc = Math.max(matchScore(rankName(item), q), alias !== null ? matchScore(alias, q) : 0)
    return isStrongMatch(sc, q)
  }),
  // flatten(list): one level of lists in lists; owl 9 takes how many levels.
  flatten: B(1, 2, function(a) {
    var l = a.list(0)
    a.tick(l.length)
    return lst(flattenTo(l, Math.min(a.int(1, 1), 64)))
  }),
  // owl 9: shuffle(list, seed) shuffles the same way for the same seed; shuffle(list) differently each time, so only in handlers.
  shuffle: B(1, 2, function(a) {
    var l = a.list(0)
    a.tick(l.length)
    return lst(shuffled(l, a.size > 1 ? seeded(a.get(1)) : Math.random))
  }, false),
  // random() in [0, 1), random(n) a whole number from 0 to n - 1, random(a, b) one from a to b. Only in handlers and a state's first value.
  random: B(0, 2, function(a) {
    var r = Math.random()
    if (a.size === 0) return r
    if (a.size === 1) return Math.floor(r * Math.max(Math.floor(a.num(0)), 0))
    var lo = Math.ceil(Math.min(a.num(0), a.num(1))), hi = Math.floor(Math.max(a.num(0), a.num(1)))
    return hi < lo ? lo : lo + Math.floor(r * (hi - lo + 1))
  }, false),
  // hash(values...): a number in [0, 1) that's always the same for the same values, for noise in lets and canvases.
  hash: B(1, 16, function(a) { return hashOf(a.args) }),
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
  // owl 9: set(list, i, v) and set(map, key, v) are copies with that one changed; remove(...) without it.
  set: B(3, 3, function(a) { return edited(a.get(0), a.get(1), a.get(2)) }),
  remove: B(2, 2, function(a) { return edited(a.get(0), a.get(1), undefined) }),
  // owl 9: merge(a, b, ...) is the maps' fields together, a later map's winning.
  merge: B(1, 16, function(a) {
    var out = new Map()
    a.args.forEach(function(m) { if (m instanceof Map) m.forEach(function(value, key) { out.set(key, value) }) })
    return out
  }),
  // owl 9: reduce(list, (total, x, i) => ..., start) folds a list into one value; scan gives every step of it.
  reduce: B(3, 3, function(a) {
    var f = a.fn(1), l = a.list(0)
    a.tick(l.length)
    var acc = a.get(2)
    for (var i = 0; i < l.length; i++) acc = callFn(f, [acc, l[i], i])
    return acc
  }),
  scan: B(3, 3, function(a) {
    var f = a.fn(1), l = a.list(0)
    a.tick(l.length)
    var acc = a.get(2)
    return lst(l.map(function(v, i) { acc = callFn(f, [acc, v, i]); return acc }))
  }),
  // owl 9: groupBy(list, x => x.day) is a map from each key to the items with it, in the order they came.
  groupBy: B(2, 2, function(a) {
    var f = a.fn(1), l = a.list(0)
    a.tick(l.length)
    var out = new Map()
    l.forEach(function(v) {
      var k = show(callFn(f, [v]))
      if (!out.has(k)) out.set(k, [])
      out.get(k).push(v)
    })
    return out
  }),
  // owl 9: JSON text, for a post body built by hand, a file or a command.
  toJson: B(1, 1, function(a) {
    var t = jsonText(a.get(0), MAX_TEXT)
    if (t === null) throw new WidgetError("toJson takes numbers, text, lists and maps, not colors or functions")
    return t
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

// Nothing compares with NaN ("NaN" is a number), or with null.
function cmp(test) {
  return function(a, b) {
    if (typeof a === "number" && typeof b === "number") return a !== a || b !== b ? false : test(numCompare(a, b))
    if (a === null || b === null) return false
    var x = num(a), y = num(b)
    if (x !== null && x !== x || y !== null && y !== y) return false
    return test(compare(a, b))
  }
}

var OPERATORS = {
  "+": function(a, b) {
    if (typeof a === "number" && typeof b === "number") return a + b
    if (Array.isArray(a) && Array.isArray(b)) return lst(a.concat(b))
    // Strings join as written ("- " + x keeps its space); only other values are formatted.
    if (typeof a === "string" || typeof b === "string") {
      var x0 = typeof a === "string" ? a : text(a), y0 = typeof b === "string" ? b : text(b)
      checkText(x0.length + y0.length)
      return x0 + y0
    }
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

var LEVEL = 13
var MAX_NODES = 500
var MAX_SCREEN_NODES = 1000
var MAX_ASSET_BYTES = 2097152
// Pages as far out as a file can ask for; past Int's range, the pages either side of them would wrap.
var MAX_PAGE = 1000

var KINDS = {
  Column: [["gap", "align", "justify", "scroll", "lazy", "reverse"], "ui"],
  Row: [["gap", "align", "justify", "wrap"], "ui"],
  Flow: [["gap", "align", "justify"], "ui"],
  Box: [["align"], "ui"],
  Grid: [["columns", "gap", "lazy", "reverse"], "ui"],
  Text: [["text", "style", "color", "fontSize", "bold", "italic", "font", "align", "maxLines", "minLines", "spans", "fontWeight", "letterSpacing"], "none"],
  Image: [["src", "fit", "tint", "label"], "none"],
  Button: [["text", "color"], "none"],
  Progress: [["value", "max", "color", "track"], "none"],
  Ring: [["value", "max", "color", "track", "thickness", "start", "sweep"], "none"],
  Sparkline: [["values", "min", "max", "color", "area", "thickness"], "none"],
  Canvas: [[], "draw"],
  Shader: [["code", "uniforms", "fallback"], "none"],
  Spacer: [[], "none"],
  Terminal: [["command", "fontSize"], "none"],
  Slider: [["value", "min", "max", "step", "color", "track", "live"], "none"],
  Input: [["text", "placeholder", "color", "fontSize", "clear", "focus", "underline", "password"], "none"],
  // owl 10: a menu over everything else, next to the node that holds it.
  Popup: [["position", "gap", "align"], "ui"]
}
var KIND_NAMES = Object.keys(KINDS)
var COMMON = ["width", "height", "size", "fill", "weight", "padding", "background", "border", "borderColor",
  "radius", "opacity", "rotation", "scale", "offset", "clip", "visible", "frost", "repeats", "drag"]
var ANIMATABLE = ["opacity", "rotation", "scale", "offset", "value", "color", "background"]
var ALIGN = ["start", "center", "end", "top", "bottom", "topStart", "topEnd", "bottomStart", "bottomEnd"]
var ENUMS = {
  style: ["huge", "title", "body", "small", "muted", "label"],
  align: ALIGN,
  justify: ["start", "center", "end", "spaceBetween", "spaceAround", "spaceEvenly"],
  fit: ["contain", "cover", "fill"],
  font: ["mono", "sans", "serif", "icon"],
  fill: ["width", "height"],
  cap: ["round", "butt", "square"],
  position: ["above", "below"],
  // The one direction onDrag follows (owl 13); without it, any.
  drag: ["horizontal", "vertical"]
}

var DRAW = {
  rect: [4, 4, false], circle: [3, 3, false], arc: [5, 5, false], line: [4, 4, false], path: [1, 1, false],
  text: [3, 3, false], image: [5, 5, false], translate: [2, 2, true], rotate: [1, 3, true], scale: [1, 4, true],
  clip: [4, 4, true], layer: [1, 1, true], sprite: [4, 4, false]
}
// text(...)'s options beyond size, color, align and bold, as Text has them (owl 10).
var TEXT_STYLE = ["font", "fontWeight", "italic", "letterSpacing"]
var DRAW_NAMED = ["fill", "stroke", "width", "cap", "radius", "closed", "size", "color", "align", "bold", "palette"].concat(TEXT_STYLE)

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
// owl 8: the phone's apps as a list; images and sounds from the web; values in URLs; sending.
var WEB_IMAGE = "an image from the web"
;["android.apps", WEB_IMAGE, "sound", "enc", "post"].forEach(function(k) { SINCE[k] = 8 })
var FMT_TIME_ZONE = "fmtTime with a time zone or language"
var FLATTEN_DEPTH = "flatten with a depth"
var ON_FIRST = "on … first"
var HANDLER_IF = "if in a handler"
var HANDLER_LET = "let in a handler"
// owl 9: dates and numbers as text and back; chance; lists and maps changed in place of rebuilding
// them; a trigger for a first value; handlers that choose, and name values on the way.
;["parseTime", "fmtAgo", "fmtNum", FMT_TIME_ZONE, "random", "shuffle", "hash", "set", "remove", "merge", "reduce", "scan",
  "groupBy", "toJson", "capitalize", "asin", "acos", FLATTEN_DEPTH, ON_FIRST, HANDLER_IF, HANDLER_LET].forEach(function(k) { SINCE[k] = 9 })
var FACE_FILE = "face \"…\" { }"
var GRADIENT_BACKGROUND = "a gradient background"
var FONT_FILE = "a font of its own"
var CANVAS_TEXT_STYLE = "text(...) with font, fontWeight, italic or letterSpacing"
// owl 10: faces, files that are a whole home page; long-press where it isn't the home screen's; text styled in
// pieces, by weight and spacing; gradients and frosted glass behind any node; the agents and the recent apps,
// for a face with its own prompt bar; fonts of the widget's own, and Canvas text styled like a Text.
;[FACE_FILE, "onLongPress", "Text.spans", "Text.fontWeight", "Text.letterSpacing", GRADIENT_BACKGROUND, "frost",
  "android.agents", "android.recent", "open", "ask", "Popup", "Input.underline", FONT_FILE, CANVAS_TEXT_STYLE]
  .forEach(function(k) { SINCE[k] = 10 })
var PANEL_FILE = "panel \"…\" { }"
// A panel's read-only name for the prompt bar's text.
var QUERY = "query"
var APP_STATUS_BAR = "an app's statusBar"
// owl 11: panels, files a swipe on home opens (the app drawer is one), with the prompt bar's text; the drawer's
// apps and what their long-press menu does; long lists built as they scroll into view; the bar's search ranking;
// an app that hides the status bar.
;[PANEL_FILE, QUERY, "onKey", "android.drawer", "appAction", "workApps", "shortcuts", APP_STATUS_BAR,
  "Column.lazy", "Grid.lazy", "Column.reverse", "Grid.reverse", "Image.label", "Text.minLines", "rank", "strongMatch", "chunk"]
  .forEach(function(k) { SINCE[k] = 11 })
var KEYBAR_FILE = "keybar \"…\" { }"
var POST_METHOD = "method:"
var SECRET = "secret"
// owl 12: how much of an app's top a camera cutout covers; the extra keys over the soft keyboard as a file, keys
// for the focused Linux window and touches as they go down; the launcher's gaps and border width; requests other
// than POST and base64 text; tokens kept encrypted, which only go into requests, and fields that hide what's typed.
;["screenTop", KEYBAR_FILE, "pressKey", "typeText", "latch", "android.modifiers", "onPress", "onRelease", "repeats",
  "gapsIn", "gapsOut", "borderWidth", POST_METHOD, "toBase64", "fromBase64", SECRET, "Input.password"]
  .forEach(function(k) { SINCE[k] = 12 })
var PANEL_OPACITY = "panel opacity"
var ANIMATE_OFFSET = "animate offset"
var VOLUME_STREAM = "volume(…, stream)"
var TORCH_LEVEL = "torch(level)"
// owl 13: Android's own panels for what a launcher may show but not switch, the other volume streams, a
// notification's buttons, replies and snoozing, Do Not Disturb; drags along one direction and their end; how much
// a panel covers home; the bytes sent and received, the SIM; offsets that ease back; the torch dimmed; the glass
// home's tiles have.
;["settings", VOLUME_STREAM, "notification(\"clear\")", "notification(\"action\")", "notification(\"reply\")", "drag", "onDragEnd",
  PANEL_OPACITY, "android.network", "android.sim", "dnd", "notification(\"snooze\")", "notification(\"snoozeAll\")",
  "notification(\"unsnooze\")", "notification(\"unsnoozeAll\")", ANIMATE_OFFSET, TORCH_LEVEL, "tileOpacity", "tileFrost"]
  .forEach(function(k) { SINCE[k] = 13 })

var MANAGERS = { pacman: /^[a-z0-9@_+][a-z0-9@._+-]*$/ }
// onLongPress only off the home grid: on a tile, long-press belongs to the home screen, which lifts it to move it.
var HANDLER_PARAMS = { onTap: ["x", "y"], onLongPress: ["x", "y"],
  // As the finger goes down, and with `repeats: true` again while it stays: `repeat` counts from 0, the press.
  onPress: ["x", "y", "repeat"], onRelease: [],
  onDrag: ["dx", "dy", "x", "y"],
  // How fast the finger was moving as it let go, in dp a second.
  onDragEnd: ["vx", "vy"],
  onChange: ["value"], onSubmit: ["value"], onDismiss: [],
  // A panel's, at its top: a key pressed in the prompt bar while it's open.
  onKey: ["value"] }
var HANDLER_KINDS = { onChange: ["Slider", "Input"], onSubmit: ["Input"], onDismiss: ["Popup"] }
var TRIGGER_PARAMS = { on: ["value", "old"] }
var ANDROID = ["battery", "device", "media", "notifications", "volume", "system", "network", "sim", "alarm", "modes", "apps",
  "agents", "recent", "drawer", "modifiers"]
// The words an action's first value may be, when it's written out; `numbers` also allows a number. `forms` are
// the words that take another number of values than the action's usual: how many, and how they're written.
function words(list, message, numbers, forms) { return { words: list, message: message, numbers: !!numbers, forms: forms || {} } }
var SETTINGS_PAGES = ["internet", "wifi", "bluetooth", "airplane", "data", "location", "cast", "nfc", "volume", "output", "sound",
  "dnd", "display", "dark", "battery", "notifications"]
var LATCHES = ["ctrl", "alt", "shift"]
var LATCH_HOWS = ["once", "locked", "off"]
var ACTION_WORDS = {
  media: words(["toggle", "play", "pause", "next", "previous", "open"], "media takes toggle, play, pause, next, previous, open"),
  // A number sets the level in percent.
  volume: words(["up", "down", "mute", "unmute", "toggle"], "volume takes a level in percent, or up, down, mute, unmute, toggle", true),
  // true and false also turn it on and off; a number turns it on at that brightness, in percent.
  torch: words(["on", "off", "toggle"], "torch takes a brightness in percent, true, false, on, off, toggle", true),
  // Besides on, off and toggle, what android.modes' dndAllows says, so dnd(m.dndAllows) sets back what it read.
  dnd: words(["on", "off", "toggle", "all", "priority", "alarms", "none"], "dnd takes true, false, on, off, toggle, all, priority, alarms, none"),
  notification: words(["open", "dismiss", "clear", "action", "reply", "snooze", "snoozeAll", "unsnooze", "unsnoozeAll"],
    "notification takes open, dismiss, clear, action, reply, snooze, snoozeAll, unsnooze or unsnoozeAll", false, {
      open: [2, 2, "notification(\"open\", key)"],
      dismiss: [2, 2, "notification(\"dismiss\", key)"],
      clear: [1, 1, "notification(\"clear\")"],
      action: [3, 3, "notification(\"action\", key, i)"],
      reply: [3, 3, "notification(\"reply\", key, text)"],
      snooze: [3, 3, "notification(\"snooze\", key, seconds)"],
      snoozeAll: [2, 2, "notification(\"snoozeAll\", seconds)"],
      unsnooze: [2, 2, "notification(\"unsnooze\", key)"],
      unsnoozeAll: [1, 1, "notification(\"unsnoozeAll\")"]
    }),
  // Android's panel (a sheet over home) where it has one, else its settings screen.
  settings: words(SETTINGS_PAGES, "settings takes " + SETTINGS_PAGES.join(", ")),
  appAction: words(["pin", "info", "uninstall", "remove", "edit", "share"], "appAction takes pin, info, uninstall, remove, edit, share and an app's key"),
  workApps: words(["pause", "resume", "toggle"], "workApps takes pause, resume, toggle"),
  latch: words(LATCHES, "latch takes ctrl, alt, shift, and optionally once, locked or off")
}
// volume(...)'s second value; media without one.
var VOLUME_STREAMS = ["media", "ring", "notification", "alarm"]
var POST_METHODS = ["POST", "PUT", "PATCH", "DELETE"]

// Keys by name, as pressKey("ctrl+c") takes them, and characters on a US keyboard: Linux evdev codes.
var KEY_MODIFIERS = { ctrl: 29, alt: 56, shift: 42, "super": 125 }
var KEY_NAMED = { esc: 1, backspace: 14, tab: 15, enter: 28, space: 57, home: 102, up: 103, pgup: 104, left: 105, right: 106,
  end: 107, down: 108, pgdn: 109, insert: 110, "delete": 111 }
for (var fk = 1; fk <= 10; fk++) KEY_NAMED["f" + fk] = 58 + fk
KEY_NAMED.f11 = 87
KEY_NAMED.f12 = 88
var KEY_HELP = "pressKey takes a key, " + Object.keys(KEY_NAMED).join(", ") + " or a character, with modifiers in front: \"ctrl+c\", \"shift+insert\", \"ctrl+alt+t\""
var KEY_UNSHIFTED = "1234567890-=qwertyuiop[]asdfghjkl;'`\\zxcvbnm,./ "
var KEY_SHIFTED = "!@#$%^&*()_+QWERTYUIOP{}ASDFGHJKL:\"~|ZXCVBNM<>? "
var KEY_CODES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 57]

// [evdev code, needs shift] for a character on a US keyboard; null for one that isn't.
function keyForChar(c) {
  if (c === "\n") return [28, false]
  if (c === "\t") return [15, false]
  var i = KEY_UNSHIFTED.indexOf(c)
  if (i >= 0) return [KEY_CODES[i], false]
  i = KEY_SHIFTED.indexOf(c)
  if (i >= 0) return [KEY_CODES[i], true]
  return null
}

// esc, ctrl+c, shift+insert, ctrl+alt+t or a character, as {code, held}; null if it names no key. A shifted
// character holds Shift itself; a letter after a modifier is the key as written on it (ctrl+C is Ctrl+C).
function keyCombo(t) {
  if (t === "") return null
  var parts = t.length === 1 ? [t] : t.slice(-2) === "++" ? t.slice(0, -2).split("+").concat(["+"]) : t.split("+")
  var key = parts[parts.length - 1]
  var held = []
  for (var i = 0; i < parts.length - 1; i++) {
    var m = parts[i].toLowerCase()
    if (!KEY_MODIFIERS.hasOwnProperty(m)) return null
    if (held.indexOf(KEY_MODIFIERS[m]) < 0) held.push(KEY_MODIFIERS[m])
  }
  if (KEY_NAMED.hasOwnProperty(key.toLowerCase())) return { code: KEY_NAMED[key.toLowerCase()], held: held }
  if (key.length !== 1) return null
  var c = held.length && key >= "A" && key <= "Z" ? key.toLowerCase() : key
  var k = keyForChar(c)
  if (k === null) return null
  if (k[1] && held.indexOf(42) < 0) held.push(42)
  return { code: k[0], held: held }
}

// A URL's scheme, host and port, written out so no value can send it elsewhere: what a secret is bound to. No
// `user@` before the host, and the host ends where the text does or at a /, ? or #.
var FIXED_HOST = /^https?:\/\/[A-Za-z0-9.-]+(:[0-9]+)?(?=[\/?#]|$)/

// Strings in the order java's HashSet<String> walks them (16 buckets, by String.hashCode), for the one
// secret a message names when a request sends several.
function javaSetOrder(names) {
  function bucket(t) {
    var h = 0
    for (var i = 0; i < t.length; i++) h = (31 * h + t.charCodeAt(i)) | 0
    return ((h ^ (h >>> 16)) & 15)
  }
  return names.map(function(n, i) { return [bucket(n), i, n] })
    .sort(function(a, b) { return a[0] - b[0] || a[1] - b[1] }).map(function(x) { return x[2] })
}
var TILE = ["cols", "rows", "tileWidth", "tileHeight", "screenWidth", "screenHeight", "screenInset", "screenTop", "corners", "gapsIn",
  "gapsOut", "borderWidth", "tileOpacity", "tileFrost"]
var WIDGET_PROPS = ["size", "minSize", "page", "order", "padding", "background"]
// A face has no tile's size; it says where it goes and whether the status bar stays over it.
var FACE_PROPS = ["page", "order", "padding", "background", "statusBar"]

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
  // A face: it runs under the navigation bar, so its nodes may read screenInset. Known from the file's
  // first word, so its lets and components see it too.
  this.isFace = ast.kind === "face"
  // Compiling a handler or a state's first value, which run once when they run: the only places a
  // value may come out different each time, as random() does.
  this.chance = false
  // States declared `secret`, read only where secretOk says: a request's headers and body, or a check that it's set.
  this.secrets = {}
  this.secretOk = false
  // While compiling a request's URL, where a secret goes only as enc(token).
  this.inUrl = false
  // The secrets a request being compiled sends, in the order they're met.
  this.sent = null
  // Each secret's servers, as https://host:port: it's kept only while the file sends it to these.
  this.secretHosts = {}
  // Whether text put together now waits for each value in it: a URL, a command or an image's src with a value
  // still loading is null, and waits, rather than asked for with "…" in it.
  this.wholeOnly = false
  this.nodeLetNames = null
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

  chancy: function(f) {
    var was = this.chance
    this.chance = true
    try { return f() } finally { this.chance = was }
  },

  withSecrets: function(f) {
    var was = this.secretOk
    this.secretOk = true
    try { return f() } finally { this.secretOk = was }
  },

  // Compiles f, part of a request's URL, where a secret may go as enc(token).
  inRequestUrl: function(f) {
    var was = this.inUrl
    this.inUrl = true
    try { return f() } finally { this.inUrl = was }
  },

  // Compiles f, what a request asks for, with wholeOnly set.
  whole: function(f) {
    var was = this.wholeOnly
    this.wholeOnly = true
    try { return f() } finally { this.wholeOnly = was }
  },

  // Compiles f with secrets readable, but not sent: token == null only says whether it's set.
  checking: function(f) {
    var was = this.sent
    this.sent = null
    try { return this.withSecrets(f) } finally { this.sent = was }
  },

  // Compiles a request's URL, headers and body in f, and binds the secrets they send to the servers written out
  // at the start of its url, so an edit that sends a secret elsewhere loses it.
  request: function(url, scope, f) {
    var self = this
    var was = this.sent
    var names = []
    this.sent = names
    try {
      var out = f()
      if (names.length) {
        var hosts = this.inRequestUrl(function() { return self.servers(url, scope, javaSetOrder(names)[0]) })
        names.forEach(function(n) {
          var list = self.secretHosts[n] || (self.secretHosts[n] = [])
          hosts.forEach(function(h) { if (list.indexOf(h) < 0) list.push(h) })
        })
      }
      return out
    } finally {
      this.sent = was
    }
  },

  // The servers a request to e goes to, each written out at the start of a way it can turn out, for the secret name.
  servers: function(e, s, name) {
    if (e.k === "cond") return this.servers(e.a, s, name).concat(this.servers(e.b, s, name))
    // A URL that's null pauses its source: it goes nowhere.
    var ev = this.ex(e, s)
    if (ev.k && ev.c === null) return []
    var host = this.server(e, s)
    if (host === null) this.fail(name + " is a secret, so the server it goes to is written out: \"https://api.example.com/…\", not a value", e.pos)
    if (host.indexOf("http://") === 0) this.fail(name + " is a secret, so it goes only to an https:// server, where nothing on the way can read it", e.pos)
    return [host]
  },

  // The scheme, host and port e starts with as fixed text; null when a value can change them.
  server: function(e, s) {
    var whole = this.constText(e, s)
    var start = whole !== null ? whole : this.constantStart(e, s)
    var m = FIXED_HOST.exec(start)
    // Where the text gives way to a value, the host has to have ended first: "https://api.x${v}" could go anywhere.
    return m && (whole !== null || m[0].length < start.length) ? m[0].toLowerCase() : null
  },

  // A request's URL, checked. A secret may go into it only as enc(token), for an API that takes its key in the query.
  requestUrl: function(what, name, e, scope) {
    var self = this
    return this.inRequestUrl(function() {
      var url = self.whole(function() { return self.ex(e, scope) })
      if (url.k && typeof url.c === "string" && url.c.indexOf("https://") !== 0 && url.c.indexOf("http://") !== 0)
        self.fail(name + " takes an http:// or https:// URL", e.pos)
      self.commands.push(what + " " + (url.k && typeof url.c === "string" ? url.c : "(a URL built from widget values)"))
      return url
    })
  },

  isSecret: function(e, s) {
    if (e.k !== "name" || !this.secrets.hasOwnProperty(e.name)) return false
    var ref = this.lookup(e.name, s)
    return ref !== null && !ref.local
  },

  isUnset: function(e) { return e.k === "lit" && (e.v === null || e.v === "") },

  // Every let written inside a node, anywhere in the file, for letHint.
  nodeLets: function() {
    if (this.nodeLetNames) return this.nodeLetNames
    var names = {}
    function walk(b) {
      if (!b) return
      b.items.forEach(function(i) {
        if (i.kind === "let") names[i.name] = true
        else if (i.kind === "node" || i.kind === "for" || i.kind === "call") walk(i.body)
        else if (i.kind === "if") { walk(i.then); walk(i.orElse) }
      })
      b.decls.forEach(function(d) { if (d.kind === "component") walk(d.body) })
    }
    walk(this.ast.body)
    return this.nodeLetNames = names
  },

  // Why a let by this name can't be read from here, when there is one.
  letHint: function(name, scope) {
    var below = "it's declared below; a let reads only the lets above it, so move it up"
    for (var f = scope; f !== null; f = f.parent) if (f.names.slice(f.visible).indexOf(name) >= 0) return below
    if (this.ast.body.decls.some(function(d) { return d.kind === "let" && d.name === name })) return below
    if (this.nodeLets().hasOwnProperty(name))
      return "it's a let inside a node, which only the nodes inside that one see, not the node's own properties or anything outside it; put the let on the parent"
    return null
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
      if (h.name !== "onTap") self.fail("a " + self.ast.kind + " only takes onTap at the top level", h.pos)
    })
    body.decls.forEach(function(d) {
      if (d.kind !== "meta" && d.kind !== "trigger" && d.kind !== "requires" && self.slots.hasOwnProperty(d.name))
        self.fail("'" + d.name + "' is already declared", d.pos)
      if (d.kind === "source") { self.reserve(d.name, d.pos); self.sources[d.name] = true }
      else if (d.kind === "state") {
        self.reserve(d.name, d.pos)
        self.states[d.name] = true
        if (d.secret) {
          self.since(SECRET, d.pos)
          self.secrets[d.name] = true
        }
      }
      else if (d.kind === "asset") self.reserve(d.name, d.pos)
    })
    body.decls.forEach(function(d) {
      if (d.kind === "source") self.globals[self.slots[d.name]] = self.source(d)
      else if (d.kind === "state")
        self.globals[self.slots[d.name]] = { type: "state", name: d.name, init: self.chancy(function() { return self.ex(d.init, self.root) }),
          persist: d.persist, secret: !!d.secret }
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
    body.props.forEach(function(p) { props[p.name] = p })
    var meta = {}
    metaFields.forEach(function(f) { meta[f.name] = self.constant(f.value, "meta values") })
    var reqFields = []
    body.decls.forEach(function(d) { if (d.kind === "requires") reqFields = reqFields.concat(d.fields) })
    var requires = this.requires(reqFields)
    // A face is a widget that fills a home page of its own, the whole screen: it gets a screen's room, and
    // has no tile's size.
    var allowed = this.isFace ? FACE_PROPS : WIDGET_PROPS
    body.props.forEach(function(p) {
      if (allowed.indexOf(p.name) < 0)
        self.fail("unknown " + self.ast.kind + " property '" + p.name + "' (" + allowed.join(", ") + ")", p.pos)
    })
    if (this.isFace) {
      this.since(FACE_FILE, 0)
      this.maxNodes = MAX_SCREEN_NODES
    }
    var screens = body.items.filter(function(it) { return it.kind === "node" && it.type === "screen" })
    if (screens.length > 1) this.fail("a " + this.ast.kind + " has one screen { }", screens[1].pos)
    this.inScreen = false
    var rootNodes = this.items(body.items.filter(function(it) { return screens.indexOf(it) < 0 }), this.root, "ui")
    if (!rootNodes.length) this.fail("a widget needs at least one node, like Text { text: \"hi\" }", 0)
    var tileNodes = this.nodes
    var screen = screens.length ? this.screen(screens[0]) : null
    var onTap = body.handlers.length ? this.handler(body.handlers[0], this.root) : null
    if (screen === null && this.screenAction !== null)
      this.fail("screen() and close() need a screen { } block in the widget", this.screenAction)
    var background = null
    if (props.background) {
      if (this.gradient(props.background.value)) this.since(GRADIENT_BACKGROUND, props.background.pos)
      background = this.ex(props.background.value, this.root)
    }
    // Whether the status bar stays over a face, read as it changes: a face can hide it for a game and bring it back.
    var statusBar = props.statusBar ? this.ex(props.statusBar.value, this.root) : null
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
      isFace: this.isFace,
      statusBar: statusBar,
      kind: this.ast.kind,
      // A face goes left of page 1 by default: 0, and -1, -2, ... further left. A tile never does.
      page: props.page ? clampNum(this.constInt(props.page), this.isFace ? -MAX_PAGE : 1, MAX_PAGE) : this.isFace ? 0 : 1,
      order: props.order ? this.constInt(props.order) : 0,
      padding: padding,
      background: background,
      globals: this.globals,
      root: rootNodes,
      screen: screen ? screen[0] : null,
      screenTitle: screen ? screen[1] : null,
      onTap: onTap,
      triggers: triggers,
      commands: this.commands,
      secretHosts: (function(h) { var o = {}; for (var k in h) o[k] = h[k].slice().sort(); return o })(this.secretHosts),
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
    // NaN would poll without pause.
    if (every !== null && every !== every) every = null
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
      var self = this
      return this.request(e.args[0], this.root, function() {
        src.kind = "http"
        src.arg = self.requestUrl("http GET", "http", e.args[0], self.root)
        src.every = Math.max(every === null ? 60 : every, 5)
        src.headers = e.args.length > 1 ? self.withSecrets(function() { return self.ex(e.args[1], self.root) }) : null
        return src
      })
    }
    if (isCall && (e.name === "cmd" || e.name === "stream")) {
      if (e.args.length !== 1 || e.named.length) this.fail(e.name + "(\"command\") takes one command", e.pos)
      var arg = this.whole(function() { return this.ex(e.args[0], this.root) }.bind(this))
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
      var path = this.whole(function() { return this.ex(e.args[0], this.root) }.bind(this))
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
      if (e.name === "apps") this.commands.push("read installed Android apps (names, packages and icons)")
      if (e.name === "recent") this.commands.push("read the recently opened apps")
      if (e.name === "drawer") this.commands.push("read the launcher's apps (names and icons)")
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
    // pacman: [] asks for nothing, so it mustn't make the widget need Linux.
    for (var k in out) if (!out[k].length) delete out[k]
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
    if (d.first) this.since(ON_FIRST, d.pos)
    return {
      kind: d.trigger,
      expr: expr,
      action: this.handler({ name: d.trigger, stmts: d.stmts, pos: d.pos }, this.root, TRIGGER_PARAMS[d.trigger] || []),
      pos: d.pos,
      // `on x first`: also for x's first value, with `old` null.
      first: !!d.first
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
    if (c.name === "image") this.webFile(c.args[0], scope, "image")
    if (c.name === "text" && c.named.some(function(n) { return TEXT_STYLE.indexOf(n[0]) >= 0 })) this.since(CANVAS_TEXT_STYLE, c.pos)
    var fontArg = c.named.filter(function(n) { return n[0] === "font" })[0]
    if (fontArg) this.font(fontArg[1], scope)
    if (c.name === "text" && c.args.length) this.spanFonts(c.args[0], scope)
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
      this.fail("more than " + this.maxNodes + " nodes; " + (this.maxNodes === MAX_NODES ? "widgets" : "screens and faces") + " should stay small", n.pos)
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
      if (p.name === "reverse" && !body.props.some(function(q) { return q.name === "lazy" }))
        self.fail("reverse lists a lazy " + n.type + " from its end: add lazy: true", p.pos)
      if (p.name === "background" && self.gradient(p.value)) self.since(GRADIENT_BACKGROUND, p.pos)
      if (p.name === "frost") self.since("frost", p.pos)
      if (p.name === "drag") {
        self.since("drag", p.pos)
        if (p.value.k !== "name" || ENUMS.drag.indexOf(p.value.name) < 0) self.fail("drag is " + ENUMS.drag.join(" or "), p.pos)
        if (!body.handlers.some(function(h) { return h.name === "onDrag" })) self.fail("drag picks the direction onDrag follows: add onDrag", p.pos)
      }
      if (p.name === "repeats") {
        self.since("repeats", p.pos)
        if (!body.handlers.some(function(h) { return h.name === "onPress" }))
          self.fail("repeats runs onPress again while the finger stays down: add onPress", p.pos)
      }
      if (p.name === "font") self.font(p.value, scope)
      if (p.name === "spans") self.spanFonts(p.value, scope)
      props[p.name] = n.type === "Image" && p.name === "src" ? self.whole(function() { return self.prop(p, scope) }) : self.prop(p, scope)
    })
    var handlers = {}
    body.handlers.forEach(function(h) {
      if (!HANDLER_PARAMS.hasOwnProperty(h.name))
        self.fail("unknown handler '" + h.name + "' (" + Object.keys(HANDLER_PARAMS).join(", ") + ")", h.pos)
      if (h.name === "onKey") self.fail("onKey goes at the top of a panel, next to onSubmit", h.pos)
      if (h.name === "onDragEnd" && !body.handlers.some(function(o) { return o.name === "onDrag" }))
        self.fail("onDragEnd runs when an onDrag drag ends: add onDrag", h.pos)
      var kinds = HANDLER_KINDS[h.name]
      if (kinds && kinds.indexOf(n.type) < 0) self.fail(h.name + " only works on " + kinds.join(" and "), h.pos)
      if (h.name === "onLongPress" && self.inScreen === false && !self.isFace)
        self.fail("long-press on a tile belongs to the home screen, which lifts it to move and resize it; onLongPress works in faces, apps and a screen { }", h.pos)
      self.since(h.name, h.pos)
      handlers[h.name] = self.handler(h, scope)
    })
    var animations = {}
    body.animations.forEach(function(a) {
      if (ANIMATABLE.indexOf(a.name) < 0) self.fail("'" + a.name + "' can't animate (" + ANIMATABLE.join(", ") + ")", a.pos)
      if (a.name === "offset") self.since(ANIMATE_OFFSET, a.pos)
      animations[a.name] = self.ex(a.value, scope)
    })
    this.since(n.type, n.pos)
    // A tap outside or Back asks it to close; without a handler for that, nothing could.
    if (n.type === "Popup" && !handlers.hasOwnProperty("onDismiss"))
      this.fail("a Popup needs onDismiss, run when a tap outside it or Back closes it: onDismiss: open = false", n.pos)
    if (n.type === "Terminal") {
      this.terminal = true
      var command = props.command
      this.commands.push(!command ? "a terminal running the login shell"
        : command.k && typeof command.c === "string" ? command.c : "Terminal command built from widget values")
      this.guest = true
    }
    if (n.type === "Image") {
      var src = body.props.filter(function(p) { return p.name === "src" })[0]
      if (src) this.webFile(src.value, scope, "image")
    }
    // A shader animates only if its code reads `time`; code that's worked out at run time might.
    if (n.type === "Shader") {
      var code = props.code
      if (!code || !code.k || /\btime\b/.test(show(code.c))) this.animated = true
    }
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
    if (body.handlers.length || body.animations.length)
      this.fail("put handlers and animate inside the component, or wrap it: Box { onTap: …; " + n.type + " { … } }", n.pos)
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
    var frost = body.props.filter(function(p) { return p.name === "frost" && c.params.indexOf(p.name) < 0 })[0]
    if (frost) this.since("frost", frost.pos)
    var drag = body.props.filter(function(p) { return p.name === "drag" && c.params.indexOf(p.name) < 0 })[0]
    if (drag) this.fail("drag goes on the node inside " + n.type + " that has onDrag", drag.pos)
    return { t: "use", component: n.type, args: args, wrapper: wrapper, body: c.body, pos: n.pos }
  },

  // Whether a background is written as a gradient, linear(...) or radial(...), or chooses one: they need owl 10 there.
  gradient: function(e) {
    if (e.k === "call") return e.name === "linear" || e.name === "radial"
    if (e.k === "cond") return this.gradient(e.a) || this.gradient(e.b)
    if (e.k === "bin") return e.op === "??" && (this.gradient(e.a) || this.gradient(e.b))
    return false
  },

  // A font that isn't one of the words names a font file: an asset, a file in this system or a URL (owl 10).
  // One only known at run time, a state's or a source's, needs no level.
  font: function(e, s) {
    var self = this
    if (e.k === "cond") { this.font(e.a, s); this.font(e.b, s); return }
    var words = ENUMS.font
    if (e.k === "name" && words.indexOf(e.name) >= 0) return
    var t = this.constText(e, s)
    if (t !== null && words.indexOf(t) >= 0) return
    var asset = e.k === "name" && this.globals.some(function(g) { return g && g.type === "asset" && g.name === e.name })
    if (t !== null || asset || e.k === "interp") this.since(FONT_FILE, e.pos)
    this.webFile(e, s, "font")
  },

  // The fonts named in a Text's or a Canvas text's spans, [{text: "a", font: "https://…"}]: level-checked like a font:.
  spanFonts: function(e, s) {
    var self = this
    if (e.k === "list") e.items.forEach(function(it) { self.spanFonts(it, s) })
    else if (e.k === "map") {
      var f = e.entries.filter(function(en) { return en[0] === "font" })[0]
      if (f) this.font(f[1], s)
    } else if (e.k === "cond") { this.spanFonts(e.a, s); this.spanFonts(e.b, s) }
  },

  enumOrNull: function(name, e, scope) {
    var options = ENUMS[name]
    if (!options) return null
    // The word, even when a let, state, source or parameter has its name.
    if (e.k === "name" && options.indexOf(e.name) >= 0) return evOf(e.name)
    return null
  },

  prop: function(p, scope) { return this.enumOrNull(p.name, p.value, scope) || this.ex(p.value, scope) },

  handler: function(h, scope, paramsIn) {
    var self = this
    var params = paramsIn || HANDLER_PARAMS[h.name] || []
    var inner = new Scope(scope, params)
    var body = this.chancy(function() { return self.block(h.stmts, inner) })
    var hname = h.name
    return {
      params: params,
      run: function(env, values) {
        var e = params.length ? env.child(params.map(function(p, i) { return i < values.length ? values[i] : null })) : env
        // Handlers run from touch events: a failure is reported, never thrown into the UI.
        try {
          env.host.budget.run(function() { body(e) })
        } catch (x) {
          env.host.report(hname + ": " + messageOf(x))
        }
      }
    }
  },

  // Handler statements, in order. A `let` opens a frame that the statements after it in its block see.
  block: function(stmts, scope) {
    var self = this
    var steps = []
    var s = scope
    stmts.forEach(function(st) {
      if (st.kind === "let") {
        self.since(HANDLER_LET, st.pos)
        // One name, one meaning: a let named like a state would read as the let but assign the state.
        if (self.lookup(st.name, s) !== null) self.fail("'" + st.name + "' is already a name here; give the let a name of its own", st.pos)
        var v = self.ex(st.value, s)
        s = new Scope(s, [st.name])
        steps.push(function(env) { return env.child([run(v, env)]) })
      } else if (st.kind === "if") {
        self.since(HANDLER_IF, st.pos)
        var cond = self.ex(st.cond, s)
        var then = self.block(st.then, s)
        var orElse = self.block(st.orElse, s)
        steps.push(function(env) {
          if (truthy(run(cond, env))) then(env); else orElse(env)
          return env
        })
      } else {
        var one = self.statement(st, s)
        steps.push(function(env) { one(env); return env })
      }
    })
    return function(env) {
      var e = env
      for (var i = 0; i < steps.length; i++) e = steps[i](e)
    }
  },

  // An assignment or an action.
  statement: function(st, scope) {
    var self = this
    if (st.kind === "assign") {
      var slot = this.slots.hasOwnProperty(st.name) ? this.slots[st.name] : null
      // A state wins, even with a local of its name in reach (onChange: value = value): widgets did that before owl 9.
      var ref = this.lookup(st.name, scope)
      if (!this.states.hasOwnProperty(st.name) && ref !== null && ref.local)
        this.fail("'" + st.name + "' is a let or a value given to the handler, not a state, so it can't be assigned", st.pos)
      if (slot === null || !this.states.hasOwnProperty(st.name))
        this.fail(slot === null ? "unknown state '" + st.name + "'; declare it with: state " + st.name + " = ..."
          : "'" + st.name + "' isn't a state and can't be assigned", st.pos)
      var call = st.value.k === "call" ? st.value : null
      if (call && call.name === "run") {
        if (call.args.length !== 1 || call.named.length) this.fail("run takes one command", call.pos)
        var command = this.ex(call.args[0], scope)
        this.commands.push(command.k && typeof command.c === "string" ? command.c : "run(…) built from widget values")
        this.guest = true
        return function(env) { env.host.runInto(show(run(command, env)), slot) }
      }
      if (call && call.name === "post") return this.post(call, scope, slot)
      if (call && call.name === "shortcuts") {
        // s = shortcuts(key): they load off the main thread, and arrive in the state.
        if (call.args.length !== 1 || call.named.length) this.fail("shortcuts takes an app's key", call.pos)
        this.since("shortcuts", call.pos)
        var key = this.ex(call.args[0], scope)
        this.commands.push("read an app's shortcuts (the actions its long-press menu offers)")
        return function(env) { env.host.shortcutsInto(show(run(key, env)), slot) }
      }
      var v = this.ex(st.value, scope)
      return function(env) { env.host.write(slot, run(v, env)) }
    }
    var c = st.call
    if (c.name === "post") return this.post(c, scope, null)
    if (c.name === "shortcuts")
      this.fail("shortcuts(...) puts an app's shortcuts into a state, when they've loaded: menuShortcuts = shortcuts(a.key)", c.pos)
    var arity = ACTIONS[c.name]
    if (!arity) this.fail("'" + c.name + "' isn't an action (" + Object.keys(ACTIONS).join(", ") + ")", c.pos)
    if (c.args.length < arity[0] || c.args.length > arity[1])
      this.fail(c.name + " takes " + arity[0] + "-" + arity[1] + " values", c.pos)
    var args = c.args.map(function(a) { return self.ex(a, scope) })
    var first = args.length && args[0].k && typeof args[0].c === "string" ? args[0].c : null
    var w = ACTION_WORDS[c.name]
    if (w) {
      if (first !== null && w.words.indexOf(first) < 0 && !(w.numbers && javaDouble(first) !== null)) this.fail(w.message, c.pos)
      var form = first !== null && w.forms.hasOwnProperty(first) ? w.forms[first] : null
      if (form && (c.args.length < form[0] || c.args.length > form[1])) this.fail("it's " + form[2], c.pos)
      // A word newer than its action, like notification("reply"), needs the level it came with.
      this.since(c.name + "(\"" + first + "\")", c.pos)
    }
    this.since(c.name, c.pos)
    // notification(...) with one value or three is a word from owl 13, even when the word isn't written out.
    if (c.name === "notification" && c.args.length !== 2) this.since("notification(\"action\")", c.pos)
    // A written-out brightness; one from a value, like a Slider's, can't be told from on and off here.
    if (c.name === "torch" && args[0].k && (typeof args[0].c === "number" || first !== null && javaDouble(first) !== null))
      this.since(TORCH_LEVEL, c.pos)
    if (c.name === "volume" && c.args.length === 2) {
      if (args[1].k && typeof args[1].c === "string" && VOLUME_STREAMS.indexOf(args[1].c) < 0)
        this.fail("volume's stream is " + VOLUME_STREAMS.join(", "), c.args[1].pos)
      this.since(VOLUME_STREAM, c.pos)
    }
    if (c.name === "sound") this.webFile(c.args[0], scope, "sound")
    if (c.name === "pressKey" && first !== null && keyCombo(first) === null) this.fail(KEY_HELP, c.args[0].pos)
    if (c.name === "latch" && args.length > 1 && args[1].k && typeof args[1].c === "string" && LATCH_HOWS.indexOf(args[1].c) < 0)
      this.fail("latch's second value is " + LATCH_HOWS.join(", "), c.args[1].pos)
    if ((c.name === "screen" || c.name === "close") && this.screenAction === null) this.screenAction = c.pos
    // The reviewer sees what a widget would ask, as it sees a command.
    // Uninstalling and removing take apps away: the reviewer sees which entries a widget uses.
    if (c.name === "appAction") this.commands.push("act on an app from the drawer's menu: " + (first !== null ? first : "any of its entries"))
    if (c.name === "ask") this.commands.push(first !== null ? "ask the agent: " + first : "ask the agent something built from widget values")
    if (c.name === "run" || c.name === "terminal" || c.name === "app") {
      this.commands.push(first !== null ? first : c.name + "(…) built from widget values")
      if (c.name === "run") this.guest = true
    }
    var name = c.name
    return function(env) { env.host.act(name, args.map(function(a) { return run(a, env) })) }
  },

  // post(url, body, headers), or x = post(...) to get the answer into the state slot: an HTTP POST.
  post: function(call, scope, slot) {
    var self = this
    if (call.args.length < 1 || call.args.length > 3)
      this.fail("post(\"https://...\", body, headers) takes a URL, optionally a body and a map of headers", call.pos)
    call.named.forEach(function(n) { if (n[0] !== "method") self.fail("post takes method: and no other named arguments", n[1].pos) })
    this.since("post", call.pos)
    // A constant, so the reviewer reads what it does: "http DELETE https://…".
    var method = "POST"
    var m = call.named.filter(function(n) { return n[0] === "method" })[0]
    if (m) {
      this.since(POST_METHOD, m[1].pos)
      var mv = this.constant(m[1], "method")
      method = typeof mv === "string" ? mv.toUpperCase() : null
      if (POST_METHODS.indexOf(method) < 0) this.fail("method: is one of " + POST_METHODS.map(function(x) { return "\"" + x + "\"" }).join(", "), m[1].pos)
    }
    var parts = this.request(call.args[0], scope, function() {
      return [
        self.requestUrl("http " + method, "post", call.args[0], scope),
        call.args.length > 1 ? self.withSecrets(function() { return self.ex(call.args[1], scope) }) : null,
        call.args.length > 2 ? self.withSecrets(function() { return self.ex(call.args[2], scope) }) : null
      ]
    })
    var url = parts[0], body = parts[1], headers = parts[2]
    return function(env) {
      var target = run(url, env)
      // Like any action whose value hasn't loaded: a null URL sends nothing.
      if (target === null) return
      var h = headers ? run(headers, env) : null
      env.host.post(show(target), body ? run(body, env) : null, h instanceof Map ? toJson(h) : {}, slot, method)
    }
  },

  // An image src or a sound that is, or starts as, an https URL: it needs owl 8, and it's listed like http(...).
  webFile: function(e, s, what) {
    // Each way it can turn out: sound(voice ? "https://..." : null) plays that URL.
    if (e.k === "cond") {
      this.webFile(e.a, s, what)
      this.webFile(e.b, s, what)
      return
    }
    var whole = this.constText(e, s)
    var start = whole !== null ? whole : this.constantStart(e, s)
    if (start.indexOf("http://") === 0) this.fail(what + "s load over https only", e.pos)
    if (start.indexOf("https://") !== 0) return
    if (what === "image") this.since(WEB_IMAGE, e.pos)
    this.commands.push(what + " GET " + (whole !== null ? whole : start + "…"))
  },

  // The text e starts with whatever its values turn out to be: "https://x.test/" for "https://x.test/${id}.svg".
  constantStart: function(e, s) {
    if (e.k === "interp") {
      var out = ""
      for (var i = 0; i < e.parts.length; i++) {
        var c = this.constText(e.parts[i], s)
        if (c === null) return out + this.constantStart(e.parts[i], s)
        out += c
      }
      return out
    }
    if (e.k === "bin") {
      if (e.op !== "+") return ""
      var a = this.constText(e.a, s)
      return a !== null ? a + this.constantStart(e.b, s) : this.constantStart(e.a, s)
    }
    var t = this.constText(e, s)
    return t === null ? "" : t
  },

  // e's text if it's fixed: a literal, a name for a top-level let that is one, or "${base}a.svg".
  constText: function(e, s) {
    if (e.k === "interp") {
      var out = ""
      for (var i = 0; i < e.parts.length; i++) {
        var p = this.constText(e.parts[i], s)
        if (p === null) return null
        out += p
      }
      return out
    }
    var ev = this.ex(e, s)
    var c = ev.k ? ev.c : null
    if (!ev.k && e.k === "name") {
      var ref = this.lookup(e.name, s)
      var g = ref && !ref.local ? this.globals[ref.slot] : null
      if (g && g.type === "let" && g.value.k) c = g.value.c
    }
    return typeof c === "string" || typeof c === "number" ? text(c) : null
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
      var wholeOnly = this.wholeOnly
      return this.fold(parts, function(env) {
        var out = ""
        for (var i = 0; i < parts.length; i++) {
          var v = run(parts[i], env)
          if (wholeOnly && v === null) return null
          out += literal[i] ? show(v) : text(v)
          checkText(out.length)
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
      // token == null says whether it's set, which a widget shows (sign in, or the data).
      var check = (e.op === "==" || e.op === "!=") && (this.isSecret(e.a, s) && this.isUnset(e.b) || this.isSecret(e.b, s) && this.isUnset(e.a))
      var x, y
      if (check) this.checking(function() { x = self.ex(e.a, s); y = self.ex(e.b, s) })
      else { x = this.ex(e.a, s); y = this.ex(e.b, s) }
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
      // Never shown, run or copied: on screen or in Linux, it would be out.
      if (this.secrets.hasOwnProperty(e.name)) {
        if (this.sent && this.sent.indexOf(e.name) < 0) this.sent.push(e.name)
        if (!this.secretOk)
          this.fail(e.name + " is a secret: it goes only into http(...)'s and post(...)'s headers and body, written out in them, not through a let "
            + "({Authorization: \"Bearer ${" + e.name + "}\"}), into their URL as enc(" + e.name + "), or into " + e.name + " == null, != null or != \"\"", e.pos)
      }
      return new Ev(function(env) { return env.host.read(slot) })
    }
    if (CONSTANTS.hasOwnProperty(e.name)) return evOf(CONSTANTS[e.name])
    if (THEME.indexOf(e.name) >= 0) return evOf(new Col(e.name, THEME_GREY, 1))
    if (e.name === "time") {
      this.animated = true
      return new Ev(function(env) { return env.host.time() })
    }
    // Apps and faces only: a widget's screen ends above the navigation bar. This runtime has no apps, and
    // no navigation bar under a face, so it's 0 here.
    if (e.name === "screenInset" && !(this.isFace && this.inScreen !== true))
      this.fail("screenInset is for apps with edge: true and faces; a widget's screen ends above the navigation bar", e.pos)
    // Only an app runs up to the top edge, with statusBar: false; a face and a widget's screen stay clear of the cutout.
    if (e.name === "screenTop")
      this.fail("screenTop is for apps with statusBar: false; a face and a widget's screen start below the camera", e.pos)
    if (TILE.indexOf(e.name) >= 0 || e.name === "linux") {
      this.since(e.name, e.pos)
      var tn = e.name
      return new Ev(function(env) { return env.host.tile(tn) })
    }
    // The prompt bar's text, which only a panel has; this runtime has none.
    if (e.name === QUERY) this.fail("query is the prompt bar's text, which only a panel has", e.pos)
    for (var prop in ENUMS) {
      if (ENUMS[prop].indexOf(e.name) >= 0)
        this.fail("'" + e.name + "' isn't a value here: a word like it stands alone, as in " + prop + ": " + e.name
          + "; in an expression, quote it: x ? \"" + e.name + "\" : …", e.pos)
    }
    var hint = this.letHint(e.name, s)
    this.fail("unknown name '" + e.name + "'" + (hint !== null ? ": " + hint : ""), e.pos)
  },

  call: function(e, s) {
    var self = this
    if (ACTIONS.hasOwnProperty(e.name)) this.fail(e.name + "(...) is an action; use it in a handler like onTap", e.pos)
    if (e.name === "history" || e.name === "prev")
      this.fail(e.name + "(...) keeps samples over time, so it only works as: let x = " + e.name + "(...)", e.pos)
    if (["cmd", "stream", "http", "file"].indexOf(e.name) >= 0)
      this.fail(e.name + "(...) is a source: source x = " + e.name + "(\"...\")", e.pos)
    var b = BUILTINS.hasOwnProperty(e.name) ? BUILTINS[e.name] : null
    if (!b) {
      var ref = this.lookup(e.name, s)
      var isLet = this.ast.body.decls.some(function(d) { return d.kind === "let" && d.name === e.name })
        || this.nodeLets().hasOwnProperty(e.name) || ref !== null && ref.local
      this.fail("unknown function '" + e.name + "'" + (isLet
        ? ": '" + e.name + "' is a let, and a let can't be called; write the expression out where it's used, or make a component for nodes you repeat" : ""), e.pos)
    }
    this.since(e.name, e.pos)
    if (e.name === "fmtTime" && e.args.length > 2) this.since(FMT_TIME_ZONE, e.pos)
    if (e.name === "flatten" && e.args.length > 1) this.since(FLATTEN_DEPTH, e.pos)
    if ((e.name === "random" || e.name === "shuffle" && e.args.length === 1) && !this.chance)
      this.fail(e.name === "random"
        ? "random() gives a new number each time it's read; set a state with it in a handler, like onTap: roll = random(1, 6), or use hash(seed, i) in a let"
        : "shuffle(list) shuffles anew each time it's read; give it a seed, shuffle(list, seed), with the seed a state set to random(1000000) in a handler", e.pos)
    if (e.named.length) this.fail(e.name + " takes no named arguments", e.named[0][1].pos)
    if (e.args.length < b.min || e.args.length > b.max)
      this.fail(e.name + " takes " + (b.min === b.max ? String(b.min) : b.min + "-" + b.max) + " arguments, not " + e.args.length, e.pos)
    // A secret in a request's URL, as enc(token).
    var urlSecret = e.name === "enc" && this.inUrl && e.args.length === 1 && this.isSecret(e.args[0], s) ? e.args[0] : null
    var args = urlSecret !== null ? [this.withSecrets(function() { return self.ex(urlSecret, s) })] : e.args.map(function(a) { return self.ex(a, s) })
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
//   post(url, body, headers, slot, method) sends an HTTP POST, or method's PUT,
//                     PATCH or DELETE; with a slot, it later calls setState(slot, {code, ok, out})
//   shortcutsInto(key, slot) an app's shortcuts, later through setState(slot, list);
//                     without it, the slot gets an empty list
//   report(message)   a runtime error, for the widget's error log
//   changed()         something a render reads has changed
//
// and drives the instance with setSource(), frame() and the handlers that
// render() hands out.

// `secrets` are the secret states kept from before, {name: {hosts, value}}: each comes back only while the
// file still sends it to the same servers (program.secretHosts).
function Instance(program, host, persisted, secrets) {
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
  var kept = secrets || {}
  program.globals.forEach(function(g, slot) {
    self.values[slot] = null
    self.letCache[slot] = undefined
    if (g.type === "state") {
      if (g.persist && saved.hasOwnProperty(g.name)) self.values[slot] = fromJson(saved[g.name])
      else if (g.secret && kept.hasOwnProperty(g.name) && kept[g.name]
          && JSON.stringify(kept[g.name].hosts) === JSON.stringify(program.secretHosts[g.name] || []))
        self.values[slot] = fromJson(kept[g.name].value)
      else self.values[slot] = self.guard("state " + g.name, function() { return run(g.init, self.env) }, null)
    } else if (g.type === "sampled") {
      self.sampled[slot] = g.persist && Array.isArray(saved[g.name]) ? saved[g.name].map(fromJson) : []
    } else if (g.type === "asset") {
      self.values[slot] = "data:" + assetType(g.base64) + ";base64," + g.base64
    }
  })
  // What each trigger last saw. An `on` starts unseen, so its first value is taken in as the launcher
  // takes it, by the first checkTriggers(): seen without firing, or fired with old null for `on x first`.
  this.triggerLast = program.triggers.map(function(t) {
    if (t.kind === "on") return undefined
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
      post: function(url, body, headers, slot, method) { self.host.post(url, body, headers, slot, method || "POST") },
      shortcutsInto: function(key, slot) {
        if (self.host.shortcutsInto) self.host.shortcutsInto(key, slot)
        else self.setState(slot, [])
      },
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
        // Null is "still loading": neither a change nor something to compare with.
        if (t.kind === "on" && v === null) return
        var old = self.triggerLast[i]
        self.triggerLast[i] = v
        if (t.kind === "on" && old !== undefined && !equals(v, old)) t.action.run(self.env, [v, old])
        if (t.kind === "on" && old === undefined && t.first) t.action.run(self.env, [v, null])
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

  // The secret states that are set, with the servers each is bound to, for a file of their own.
  secrets: function() {
    var self = this
    var out = {}
    this.program.globals.forEach(function(g, slot) {
      if (g.type === "state" && g.secret && self.values[slot] !== null)
        out[g.name] = { hosts: self.program.secretHosts[g.name] || [], value: toJson(self.values[slot]) }
    })
    return out
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
      // A face's status bar: this shell has none to hide, but a host with one can follow it.
      statusBar: this.program.statusBar ? truthy(this.evalSafe(this.program.statusBar, this.env)) : true,
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
      out.push({ kind: "Box", p: p, h: {}, a: {}, c: children, wrapper: true, level: this.program.level })
      return
    }
    if (n.t === "el") {
      var props = {}
      for (var name in n.props) props[name] = this.prop(name, n.props[name], env)
      var handlers = {}
      for (var h in n.handlers) handlers[h] = this.handlerFor(n.handlers[h], env)
      var anim = {}
      for (var a in n.animations) anim[a] = plain(this.evalSafe(n.animations[a], env))
      // level: the file's owl, which decides how a Text in a Row is laid out.
      var node = { kind: n.kind, p: props, h: handlers, a: anim, c: [], level: this.program.level }
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
    if (name === "spans") return this.spans(v)
    if (name === "placeholder") return v === null ? "" : text(v)
    if (name === "uniforms") {
      var u = {}
      var self = this
      if (v instanceof Map) v.forEach(function(value, key) { u[key] = self.uniform(value) })
      return u
    }
    return plain(v)
  },

  // A Text's spans (owl 10) as [{text, color, bold, italic, fontSize, fontWeight, letterSpacing, font}]:
  // a piece is text, or a map of its text and how it differs from the rest. A piece's text is as
  // written, spaces at its ends and all, unlike a command's trailing newline.
  spans: function(v) {
    var self = this
    return asList(v).map(function(piece) {
      if (!(piece instanceof Map)) return { text: typeof piece === "string" ? piece : text(piece) }
      var out = {}
      piece.forEach(function(value, key) {
        if (key === "color") out.color = self.color(value)
        else if (key === "text") out.text = typeof value === "string" ? value : text(value)
        else if (key === "bold" || key === "italic") out[key] = truthy(value)
        else if (key === "font") out.font = value === null ? null : show(value)
        else if (key === "fontSize" || key === "fontWeight" || key === "letterSpacing") out[key] = num(value)
      })
      if (out.text === undefined) out.text = ""
      return out
    })
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
    // owl 10: text(...) styled like a Text, and its text a list of spans.
    if (named.font !== undefined && named.font !== null) op.font = show(named.font)
    if (named.fontWeight !== undefined) op.fontWeight = num(named.fontWeight)
    if (named.italic !== undefined) op.italic = truthy(named.italic)
    if (named.letterSpacing !== undefined) op.letterSpacing = num(named.letterSpacing)
    if (n.op === "path") {
      op.points = asList(args[0]).map(function(p) {
        if (Array.isArray(p)) return [num(p[0]) || 0, num(p[1]) || 0]
        if (p instanceof Map) return [num(p.get("x")) || 0, num(p.get("y")) || 0]
        return [0, 0]
      })
      op.args = []
    } else if (n.op === "text") {
      op.text = text(args[0])
      if (Array.isArray(args[0]) && this.program.level >= 10) op.spans = this.spans(args[0])
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
    themeFromToml: themeFromToml, setWeekStart: setWeekStart, setZoneReader: setZoneReader, hex8: hex8, argb: argb, fmtTime: fmtTime, fixed: fixed, numText: numText,
    run: run, Env: Env
  }
}
