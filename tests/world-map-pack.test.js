/* RPGAtlas — World Map Essentials pack regression tests. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const registry = JSON.parse(fs.readFileSync(path.join(root, "img", "packs", "index.json"), "utf8"));
const pack = registry.packs.find((item) => item.id === "world-map-essentials");

test("World Map Essentials is a complete installable tile pack", () => {
  assert.ok(pack, "pack is registered");
  assert.equal(pack.name, "World Map Essentials");
  assert.equal(pack.license, "CC0");
  assert.equal(pack.files.length, 34);
  assert.ok(pack.files.every((file) => file.type === "tilesets"));
  assert.equal(new Set(pack.files.map((file) => file.name)).size, 34, "tile names are unique");
  assert.ok(pack.files.some((file) => file.name.endsWith(".terrain")), "includes walkable terrain");
  assert.ok(pack.files.some((file) => file.name.endsWith(".pass")), "includes passable route overlays");
  assert.ok(pack.files.some((file) => file.name === "world-ocean"), "includes impassable water");
  assert.ok(pack.files.some((file) => file.name === "world-bridge-ew.pass"), "includes passable bridges");
});

test("every World Map Essentials asset is a native 48x48 PNG", () => {
  for (const file of pack.files) {
    const bytes = fs.readFileSync(path.join(root, "img", "packs", file.url));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], file.name);
    assert.equal(bytes.readUInt32BE(16), 48, file.name + " width");
    assert.equal(bytes.readUInt32BE(20), 48, file.name + " height");
  }
});
