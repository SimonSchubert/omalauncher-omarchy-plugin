// node test/packaging.test.mjs -- the AUR package against the checkout it is
// built from: the same version, and every file the app reads at run time.

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8")
const pkgbuild = read("packaging/PKGBUILD")

test("the PKGBUILD is at the manifest's version", () => {
  assert.equal(/^pkgver=(.*)$/m.exec(pkgbuild)[1], JSON.parse(read("manifest.json")).version)
})

test("the package has manifest.json, where the app's version comes from", () => {
  assert.match(pkgbuild, /^\s*install .*\bmanifest\.json\b/m)
})
