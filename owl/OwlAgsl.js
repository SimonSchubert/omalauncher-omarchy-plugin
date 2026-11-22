.pragma library

// A Shader's AGSL as the GLSL a Qt ShaderEffect runs (OwlShader.qml compiles
// it with qsb). AGSL is Android's dialect of GLSL: half4 for vec4, main(p)
// returning the color, `uniform shader img;` sampled with img.eval(uv). The
// translation renames types, takes the uniforms into one uniform block, and
// adds the main() Qt calls.
//
// Every uniform, size and time too, travels in vec4 slots (owl_s, owl_u0,
// owl_u1, ...): a ShaderEffect fills a block member from the property of its
// name, and has no arrays, so a uniform array is spread over slots and put
// together again at the start of main().
//
// cost() is the launcher's ShaderCost: loop turns a pixel may take, so a
// shader that would hang the GPU isn't drawn.

var MAX_TURNS = 1000
var LIMIT = 1e12
// Slots a shader's uniforms may take: 16 kB, the least uniform block a GPU has.
var MAX_SLOTS = 1000

// ------------------------------------------------------------- cost

function Unclear(message) { this.message = message }

var TOKEN = /[A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*(?:[eE][-+]?\d+)?[fF]?|\.\d+(?:[eE][-+]?\d+)?[fF]?|\+\+|--|[-+*\/<>=!]=|&&|\|\||\S/g

function stripComments(code) {
  return String(code).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ")
}

function tokens(code) {
  return stripComments(code).match(TOKEN) || []
}

function isName(s) { return !!s && /^[A-Za-z_]/.test(s) }

function match(t, open) {
  var o = t[open]
  if (o !== "(" && o !== "{") throw new Unclear("a bracket missing")
  var c = o === "(" ? ")" : "}"
  var depth = 0
  for (var k = open; k < t.length; k++) {
    if (t[k] === o) depth++
    if (t[k] === c && --depth === 0) return k
  }
  throw new Unclear("unmatched " + o)
}

function add(a, b) { return Math.min(LIMIT, a + b) }
function mul(a, b) { return Math.min(LIMIT, a * b) }

var CASTS = ["int", "float", "half"]

function Expr(t, consts) { this.t = t; this.consts = consts; this.i = 0 }
Expr.prototype.value = function() {
  var v = this.sum()
  if (this.i !== this.t.length) throw new Unclear("a loop bound that isn't a fixed number (" + this.t.join(" ") + ")")
  return v
}
Expr.prototype.sum = function() {
  var v = this.product()
  while (this.i < this.t.length && (this.t[this.i] === "+" || this.t[this.i] === "-"))
    v = this.t[this.i++] === "+" ? v + this.product() : v - this.product()
  return v
}
Expr.prototype.product = function() {
  var v = this.unary()
  while (this.i < this.t.length && (this.t[this.i] === "*" || this.t[this.i] === "/"))
    v = this.t[this.i++] === "*" ? v * this.unary() : v / this.unary()
  return v
}
Expr.prototype.unary = function() {
  var tok = this.t[this.i++]
  if (tok === undefined) throw new Unclear("a loop bound that ends early")
  if (tok === "-") return -this.unary()
  if (tok === "(") { var v = this.sum(); this.expect(")"); return v }
  if (CASTS.indexOf(tok) >= 0 && this.t[this.i] === "(") { this.i++; var w = this.sum(); this.expect(")"); return w }
  if (Object.prototype.hasOwnProperty.call(this.consts, tok)) return this.consts[tok]
  var n = /^[\d.]/.test(tok) ? parseFloat(tok.replace(/[fF]$/, "")) : NaN
  if (isNaN(n)) throw new Unclear("a loop bound that isn't a fixed number (" + tok + ")")
  return n
}
Expr.prototype.expect = function(s) {
  if (this.t[this.i++] !== s) throw new Unclear("a loop bound with unmatched brackets")
}

function split(header) {
  var out = [], at = 0, depth = 0
  for (var k = 0; k < header.length; k++) {
    if (header[k] === "(") depth++
    if (header[k] === ")") depth--
    if (header[k] === ";" && depth === 0) { out.push(header.slice(at, k)); at = k + 1 }
  }
  out.push(header.slice(at))
  return out
}

function same(a, b) { return a.length === b.length && a.every(function(x, i) { return x === b[i] }) }

function trips(header, consts) {
  var parts = split(header)
  if (parts.length !== 3) throw new Unclear("a loop without three parts")
  var init = parts[0], cond = parts[1], step = parts[2]
  var eq = init.indexOf("=")
  if (eq < 1) throw new Unclear("a loop that doesn't start its counter at a number")
  var name = init[eq - 1]
  var start = new Expr(init.slice(eq + 1), consts).value()
  if (cond.length < 3 || cond[0] !== name) throw new Unclear("a loop whose test isn't on its counter (" + name + " < …)")
  var op = cond[1]
  var end = new Expr(cond.slice(2), consts).value()
  var by
  if (same(step, [name, "++"]) || same(step, ["++", name])) by = 1
  else if (same(step, [name, "--"]) || same(step, ["--", name])) by = -1
  else if (step.length >= 3 && step[0] === name && step[1] === "+=") by = new Expr(step.slice(2), consts).value()
  else if (step.length >= 3 && step[0] === name && step[1] === "-=") by = -new Expr(step.slice(2), consts).value()
  else throw new Unclear("a loop that doesn't count by a fixed step")
  if (by === 0) throw new Unclear("a loop that never moves")
  var span
  if (op === "<") span = end - start
  else if (op === "<=") span = end - start + by
  else if (op === ">") span = start - end
  else if (op === ">=") span = start - end - by
  else if (op === "!=") span = by > 0 ? end - start : start - end
  else throw new Unclear("a loop tested with " + op)
  var n = Math.ceil(span / Math.abs(by))
  if (isNaN(n)) throw new Unclear("a loop whose bounds aren't numbers")
  return Math.max(0, Math.min(LIMIT, n))
}

// Loop turns per pixel of code's main(), at most LIMIT.
function turns(code) {
  var t = tokens(code)
  var consts = {}
  var functions = {}
  for (var k = 0; k < t.length; k++) {
    if (t[k] !== "const" || t[k + 3] !== "=") continue
    var end = t.indexOf(";", k)
    if (end > k) try { consts[t[k + 2]] = new Expr(t.slice(k + 4, end), consts).value() } catch (e) {}
  }
  var depth = 0
  for (var i = 0; i < t.length; i++) {
    if (t[i] === "{") depth++
    else if (t[i] === "}") depth--
    else if (depth === 0 && isName(t[i]) && i + 2 < t.length && isName(t[i + 1]) && t[i + 2] === "(") {
      var close = match(t, i + 2)
      if (t[close + 1] === "{") {
        var bodyEnd = match(t, close + 1)
        functions[t[i + 1]] = [close + 1, bodyEnd]
        i = bodyEnd
      }
    }
  }
  if (!functions.main) return 0
  var memo = {}
  function cost(name, stack) {
    if (Object.prototype.hasOwnProperty.call(memo, name)) return memo[name]
    if (stack.indexOf(name) >= 0) throw new Unclear(name + " calls itself")
    var body = functions[name]
    var v = block(body[0] + 1, body[1], stack.concat([name]))
    memo[name] = v
    return v
  }
  function statementEnd(from) {
    for (var j = from; j < t.length; j++) {
      if (t[j] === "{") return match(t, j)
      if (t[j] === "(") { j = match(t, j); continue }
      if (t[j] === ";") return j
      if (t[j] === "for") {
        var c = match(t, j + 1)
        return t[c + 1] === "{" ? match(t, c + 1) : statementEnd(c + 1)
      }
    }
    return t.length - 1
  }
  function block(from, to, stack) {
    var sum = 0
    var j = from
    while (j < to) {
      var tok = t[j]
      if (tok === "for" && t[j + 1] === "(") {
        var close = match(t, j + 1)
        var n = trips(t.slice(j + 2, close), consts)
        var bodyEnd = t[close + 1] === "{" ? match(t, close + 1) : statementEnd(close + 1)
        var inner = Math.max(1, block(close + 1, bodyEnd + 1, stack))
        sum = add(sum, mul(n, inner))
        j = bodyEnd + 1
        continue
      }
      if (tok === "while" || tok === "do") throw new Unclear("AGSL has no " + tok + " loops")
      if (Object.prototype.hasOwnProperty.call(functions, tok) && t[j + 1] === "(") sum = add(sum, cost(tok, stack))
      j++
    }
    return sum
  }
  return cost("main", [])
}

// Why code isn't drawn, or null when its work is within MAX_TURNS.
function cost(code) {
  var n
  try {
    n = turns(code)
  } catch (e) {
    if (e instanceof Unclear) return "its loops can't be counted (" + e.message + "): count with fixed numbers, for (int i = 0; i < 8; i++), or a const"
    if (e instanceof RangeError) return "its loops can't be counted (brackets nested too deep): count with fixed numbers, for (int i = 0; i < 8; i++), or a const"
    throw e
  }
  if (n <= MAX_TURNS) return null
  return "its loops take " + (n >= LIMIT ? "billions of" : n.toLocaleString("en-US")) + " turns for every pixel, over the "
    + MAX_TURNS + " a shader may take: each frame waits for every pixel, and a heavy one freezes the screen; use fewer loops inside loops, or fewer turns"
}

// ------------------------------------------------------- translation

// GLSL words AGSL code may use as names: renamed, or the GLSL wouldn't compile.
var RESERVED = ["sample", "input", "output", "filter", "common", "partition", "active", "smooth", "flat",
  "noperspective", "centroid", "patch", "buffer", "shared", "coherent", "volatile", "restrict", "readonly",
  "writeonly", "resource", "subroutine", "texture", "precise", "superp", "varying", "attribute", "fragColor",
  "union", "enum", "typedef", "template", "this", "goto", "packed", "class", "extern", "external", "interface",
  "long", "fixed", "unsigned", "image1D", "image2D", "image3D", "sampler", "atomic_uint"]

function glslType(t) {
  if (t === "half") return "float"
  var m = /^(half|float|int|uint|short|ushort|bool)([234])(?:x([234]))?$/.exec(t)
  if (!m) return t
  if (m[3]) return m[2] === m[3] ? "mat" + m[2] : "mat" + m[2] + "x" + m[3]
  var base = m[1] === "half" || m[1] === "float" ? "" : m[1] === "bool" ? "b" : m[1] === "uint" || m[1] === "ushort" ? "u" : "i"
  return base + "vec" + m[2]
}

// Floats in one value of a GLSL type, null for one a uniform can't be.
function floatsOf(t) {
  if (t === "float" || t === "int" || t === "uint" || t === "bool") return 1
  var m = /^[iub]?vec([234])$/.exec(t)
  if (m) return +m[1]
  m = /^mat([234])(?:x([234]))?$/.exec(t)
  if (m) return +m[1] * +(m[2] || m[1])
  return null
}

var HELPERS = [
  "float saturate(float x) { return clamp(x, 0.0, 1.0); }",
  "vec2 saturate(vec2 x) { return clamp(x, 0.0, 1.0); }",
  "vec3 saturate(vec3 x) { return clamp(x, 0.0, 1.0); }",
  "vec4 saturate(vec4 x) { return clamp(x, 0.0, 1.0); }",
  "vec4 unpremul(vec4 c) { return c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : c; }"
].join("\n")

// {glsl, slots, uniforms: [{name, type, count, slot}], images: [{name, binding}], readsTime}, or {problem}.
function translate(code) {
  code = String(code || "")
  var problem = cost(code)
  if (problem) return { problem: problem }
  var src = stripComments(code)
  src = src.replace(new RegExp("\\b(" + RESERVED.join("|") + ")\\b", "g"), "owl_w_$1")
  // const ints, for array sizes given by name.
  var consts = {}
  src.replace(/\bconst\s+int\s+(\w+)\s*=\s*(\d+)\s*;/g, function(_, n, v) { consts[n] = +v; return _ })
  var uniforms = []
  var images = []
  var slot = 0
  var failed = null
  src = src.replace(/(?:\blayout\s*\([^)]*\)\s*)?\buniform\s+(\w+)\s+([^;]+);/g, function(all, type, names) {
    if (type === "shader") {
      return names.split(",").map(function(n) {
        n = n.trim()
        var b = images.length + 1
        images.push({ name: n, binding: b, glsl: "owl_t" + images.length })
        return ""
      }).join("")
    }
    var g = glslType(type)
    var per = floatsOf(g)
    if (per === null) { failed = "a uniform of type " + type; return all }
    return names.split(",").map(function(d) {
      var m = /^\s*(\w+)\s*(?:\[\s*(\w+)\s*\])?\s*$/.exec(d)
      if (!m) { failed = "a uniform written " + d.trim(); return "" }
      var count = m[2] === undefined ? 0 : /^\d+$/.test(m[2]) ? +m[2] : consts[m[2]]
      if (count === undefined) { failed = "an array uniform sized by " + m[2]; return "" }
      var u = { name: m[1], type: g, per: per, count: count, slot: slot }
      slot += Math.ceil(per * Math.max(1, count) / 4)
      uniforms.push(u)
      return g + " " + m[1] + (count ? "[" + count + "]" : "") + ";"
    }).join("\n")
  })
  if (failed) return { problem: "this shell can't run " + failed }
  if (slot > MAX_SLOTS) return { problem: "its uniforms hold more numbers than this shell can give a shader (" + MAX_SLOTS * 4 + ")" }
  images.forEach(function(im) {
    src = src.replace(new RegExp("\\b" + im.name + "\\s*\\.\\s*eval\\s*\\(", "g"), "texture(" + im.glsl + ", ")
  })
  src = src.replace(/\b(?:half|float|int|uint|short|ushort|bool)[234](?:x[234])?\b|\bhalf\b/g, glslType)
  if (!/\bmain\s*\(/.test(src)) return { problem: "it has no main(p)" }
  src = src.replace(/\bmain\s*\(/g, "owl_main(")

  var members = ["  mat4 qt_Matrix;", "  float qt_Opacity;", "  vec4 owl_s;"]
  for (var s = 0; s < slot; s++) members.push("  vec4 owl_u" + s + ";")
  var head = ["#version 440",
    "layout(location = 0) in vec2 qt_TexCoord0;",
    "layout(location = 0) out vec4 owl_color;",
    "layout(std140, binding = 0) uniform owl_buf {"].concat(members, ["};"])
  images.forEach(function(im) { head.push("layout(binding = " + im.binding + ") uniform sampler2D " + im.glsl + ";") })
  head.push("vec2 size;", "float time;", HELPERS)

  var fill = ["  size = owl_s.xy;", "  time = owl_s.z;"]
  uniforms.forEach(function(u) {
    function f(i) { var k = u.slot * 4 + i; return "owl_u" + Math.floor(k / 4) + "." + "xyzw".charAt(k % 4) }
    function one(at) {
      var parts = []
      for (var i = 0; i < u.per; i++) parts.push(f(at + i))
      return u.type + "(" + parts.join(", ") + ")"
    }
    if (!u.count) fill.push("  " + u.name + " = " + one(0) + ";")
    else for (var e = 0; e < u.count; e++) fill.push("  " + u.name + "[" + e + "] = " + one(e * u.per) + ";")
  })
  var foot = ["void main() {"].concat(fill, [
    "  owl_color = clamp(owl_main(qt_TexCoord0 * size), 0.0, 1.0) * qt_Opacity;",
    "}"])
  return {
    glsl: head.join("\n") + "\n" + src + "\n" + foot.join("\n") + "\n",
    slots: slot,
    uniforms: uniforms,
    images: images,
    readsTime: /\btime\b/.test(stripComments(code))
  }
}

// The slots' values, [[x, y, z, w], ...] for owl_u0..., from a node's
// uniforms (Owl.js: numbers, lists, colors as [r, g, b, a]).
function pack(tr, values) {
  var flat = new Array(tr.slots * 4)
  for (var i = 0; i < flat.length; i++) flat[i] = 0
  tr.uniforms.forEach(function(u) {
    var v = values ? values[u.name] : undefined
    var nums = []
    ;(function walk(x) {
      if (nums.length >= 4096) return
      if (Array.isArray(x)) x.forEach(walk)
      else nums.push(typeof x === "number" && isFinite(x) ? x : typeof x === "boolean" ? (x ? 1 : 0) : 0)
    })(v === undefined || v === null ? [] : v)
    var n = u.per * Math.max(1, u.count)
    for (var k = 0; k < n && k < nums.length; k++) flat[u.slot * 4 + k] = nums[k]
  })
  var out = []
  for (var s = 0; s < tr.slots; s++) out.push(flat.slice(s * 4, s * 4 + 4))
  return out
}

// The QML of the ShaderEffect that runs it: a vector4d property per slot,
// and an image per `uniform shader`, repeating past its edges.
function effectQml(tr) {
  var q = ["import QtQuick", "ShaderEffect {", "  anchors.fill: parent", "  property vector4d owl_s"]
  for (var s = 0; s < tr.slots; s++) q.push("  property vector4d owl_u" + s)
  tr.images.forEach(function(im) {
    q.push("  property string " + im.glsl + "_url: \"\"")
    q.push("  property var " + im.glsl + ": " + im.glsl + "_src")
    q.push("  Image { id: " + im.glsl + "_img; source: parent." + im.glsl + "_url; sourceSize.width: 1024; sourceSize.height: 1024 }")
    q.push("  ShaderEffectSource { id: " + im.glsl + "_src; sourceItem: " + im.glsl + "_img; wrapMode: ShaderEffectSource.Repeat; hideSource: true; visible: false; width: 1; height: 1 }")
  })
  q.push("}")
  return q.join("\n")
}
