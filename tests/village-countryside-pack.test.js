/* RPGAtlas - Village & Countryside Deluxe pack regression tests. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("@playwright/test");

const root = path.join(__dirname, "..");
const registry = JSON.parse(fs.readFileSync(path.join(root, "img", "packs", "index.json"), "utf8"));
const pack = registry.packs.find((item) => item.id === "village-countryside-deluxe");

test("Village & Countryside Deluxe is a complete installable outdoor map pack", () => {
  assert.ok(pack, "pack is registered");
  assert.equal(pack.name, "Village & Countryside Deluxe");
  assert.equal(pack.license, "CC0");
  assert.equal(pack.version, 1);
  assert.equal(pack.preview, "village-countryside-deluxe/preview.png");
  assert.equal(pack.files.length, 80);
  assert.ok(pack.files.every((file) => file.type === "tilesets"));
  assert.equal(new Set(pack.files.map((file) => file.name)).size, 80, "tile names are unique");
  for (const category of ["grounds", "routes", "buildings", "nature", "boundaries"]) {
    assert.equal(pack.files.filter((file) => file.tags.includes(category)).length, 16, `includes sixteen ${category}`);
  }
  assert.ok(pack.files.every((file) => file.tags.includes("village") && file.tags.includes("outdoors") && file.tags.includes("deluxe")));
  assert.ok(pack.files.some((file) => file.name === "village-summer-grass.terrain"), "includes walkable terrain");
  assert.ok(pack.files.some((file) => file.name === "village-path-cross.pass"), "includes passable path overlays");
  assert.ok(pack.files.some((file) => file.name === "village-timber-bridge-ew.pass"), "includes bridges");
  assert.ok(pack.files.some((file) => file.name === "village-inn"), "includes village buildings");
  assert.ok(pack.files.some((file) => file.name === "village-old-oak"), "includes outdoor scenery");
  assert.ok(pack.files.some((file) => file.name === "village-gate-ew.pass"), "includes passable gates");
  assert.ok(pack.files.some((file) => file.name === "village-stone-wall-ns"), "includes solid boundaries");
});

test("every Village & Countryside Deluxe asset is a native 48x48 PNG", () => {
  for (const file of pack.files) {
    const bytes = fs.readFileSync(path.join(root, "img", "packs", file.url));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], file.name);
    assert.equal(bytes.readUInt32BE(16), 48, file.name + " width");
    assert.equal(bytes.readUInt32BE(20), 48, file.name + " height");
  }
});

test("Village & Countryside Deluxe ships a large full-pack preview", () => {
  const bytes = fs.readFileSync(path.join(root, "img", "packs", pack.preview));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), 1440);
  assert.equal(bytes.readUInt32BE(20), 1152);
});

test("modular path and fence pieces connect only at their named edges", async () => {
  const armsByName = {
    "village-path-ns.pass": "ns", "village-path-ew.pass": "ew",
    "village-path-ne.pass": "ne", "village-path-es.pass": "es",
    "village-path-sw.pass": "sw", "village-path-wn.pass": "wn",
    "village-path-nes.pass": "nes", "village-path-esw.pass": "esw",
    "village-path-nsw.pass": "nsw", "village-path-new.pass": "new",
    "village-path-cross.pass": "nesw",
    "village-fence-ns": "ns", "village-fence-ew": "ew",
    "village-fence-ne": "ne", "village-fence-es": "es",
    "village-fence-sw": "sw", "village-fence-wn": "wn",
    "village-fence-nes": "nes", "village-fence-esw": "esw",
    "village-fence-nsw": "nsw", "village-fence-new": "new",
    "village-fence-cross": "nesw",
  };
  const inputs = Object.keys(armsByName).map((name) => {
    const file = pack.files.find((item) => item.name === name);
    return {
      name,
      arms: armsByName[name],
      src: "data:image/png;base64," + fs.readFileSync(path.join(root, "img", "packs", file.url)).toString("base64"),
    };
  });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const results = await page.evaluate(async (items) => {
    const samples = { n: [24, 0], e: [47, 24], s: [24, 47], w: [0, 24] };
    const output = [];
    for (const item of items) {
      const image = new Image(); image.src = item.src; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = 48; canvas.height = 48;
      const g = canvas.getContext("2d", { willReadFrequently: true }); g.drawImage(image, 0, 0);
      const alpha = {};
      for (const [arm, [x, y]] of Object.entries(samples)) alpha[arm] = g.getImageData(x, y, 1, 1).data[3];
      output.push({ name: item.name, arms: item.arms, alpha });
    }
    return output;
  }, inputs);
  await browser.close();
  for (const item of results) {
    for (const arm of "nesw") {
      if (item.arms.includes(arm)) assert.ok(item.alpha[arm] > 20, `${item.name} connects at ${arm}`);
      else assert.equal(item.alpha[arm], 0, `${item.name} stays transparent at ${arm}`);
    }
  }
});
