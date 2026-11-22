// node test/agsl.test.mjs -- owl/OwlAgsl.js, which turns a Shader's AGSL into
// the GLSL a Qt ShaderEffect runs. The GLSL is compiled with qsb when it is
// installed (qt6-shadertools), and only checked as text without it.

import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { readFileSync } from "node:fs"

const source = readFileSync(new URL("../owl/OwlAgsl.js", import.meta.url), "utf8").replace(/^\.pragma library\s*/, "")
const A = new Function(source + "\nreturn { translate, pack, effectQml, cost, turns }")()

const qsb = ["/usr/lib/qt6/bin/qsb", "/usr/bin/qsb"].find(existsSync)
const compiles = (glsl) => {
  if (!qsb) return
  const dir = mkdtempSync(join(tmpdir(), "agsl-"))
  writeFileSync(join(dir, "s.frag"), glsl)
  execFileSync(qsb, ["--glsl", "100 es,120,150,330", "-o", join(dir, "s.qsb"), join(dir, "s.frag")], { stdio: "pipe" })
}

const docs = `
  uniform half4 tint;
  uniform float speed;
  half4 main(float2 p) {
    float w = sin(p.x / size.x * 6.0 + time * speed) * 0.5 + 0.5;
    return half4(tint.rgb * w, 1.0);
  }`

test("the docs' example becomes GLSL with its uniforms in slots", () => {
  const tr = A.translate(docs)
  assert.equal(tr.problem, undefined)
  assert.equal(tr.readsTime, true)
  assert.deepEqual(tr.uniforms.map((u) => [u.name, u.type, u.slot]), [["tint", "vec4", 0], ["speed", "float", 1]])
  assert.match(tr.glsl, /vec4 owl_main\(vec2 p\)/)
  assert.match(tr.glsl, /tint = vec4\(owl_u0\.x, owl_u0\.y, owl_u0\.z, owl_u0\.w\);/)
  assert.doesNotMatch(tr.glsl, /\bhalf4\b|\bfloat2\b/)
  compiles(tr.glsl)
})

test("an array uniform is spread over slots and put together in main", () => {
  const tr = A.translate(`
    const int N = 3;
    uniform float3 rocks[N];
    half4 main(float2 p) { return half4(rocks[2], 1); }`)
  assert.equal(tr.slots, 3)
  assert.match(tr.glsl, /rocks\[2\] = vec3\(owl_u1\.z, owl_u1\.w, owl_u2\.x\);/)
  assert.deepEqual(A.pack(tr, { rocks: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] }), [[1, 2, 3, 4], [5, 6, 7, 8], [9, 0, 0, 0]])
  compiles(tr.glsl)
})

test("an image uniform samples a texture", () => {
  const tr = A.translate(`
    uniform shader photo;
    half4 main(float2 p) { return photo.eval(p / size); }`)
  assert.deepEqual(tr.images.map((i) => [i.name, i.glsl, i.binding]), [["photo", "owl_t0", 1]])
  assert.match(tr.glsl, /texture\(owl_t0, p \/ size\)/)
  assert.match(A.effectQml(tr), /property var owl_t0: owl_t0_src/)
  compiles(tr.glsl)
})

test("names GLSL keeps for itself are renamed", () => {
  const tr = A.translate(`
    half4 main(float2 p) { float sample = 0.5; half4 input = half4(sample); return saturate(input); }`)
  assert.match(tr.glsl, /float owl_w_sample = 0\.5;/)
  compiles(tr.glsl)
})

test("colors pack as given, numbers missing as 0", () => {
  const tr = A.translate(`uniform half4 ink; uniform float2 at; half4 main(float2 p) { return ink; }`)
  assert.deepEqual(A.pack(tr, { ink: [1, 0.5, 0.25, 1] }), [[1, 0.5, 0.25, 1], [0, 0, 0, 0]])
})

test("loops that would hang the GPU aren't drawn, as on the phone", () => {
  const heavy = `half4 main(float2 p) {
    float s = 0;
    for (int i = 0; i < 100; i++) { for (int j = 0; j < 100; j++) { s += 1; } }
    return half4(s); }`
  assert.equal(A.turns(heavy), 10000)
  assert.match(A.translate(heavy).problem, /10,000 turns for every pixel/)
  assert.match(A.translate("half4 main(float2 p) { while (true) {} }").problem, /no while loops/)
  assert.equal(A.translate(`const int STEPS = 8;
    float f(float x) { for (int i = 0; i < STEPS; i++) x += 1; return x; }
    half4 main(float2 p) { for (int k = 0; k < 4; k++) { f(1); } return half4(1); }`).problem, undefined)
})
