/* RPGAtlas — World Map Essentials pack regression tests. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("@playwright/test");

const root = path.join(__dirname, "..");
const registry = JSON.parse(fs.readFileSync(path.join(root, "img", "packs", "index.json"), "utf8"));
const pack = registry.packs.find((item) => item.id === "world-map-essentials");

test("World Map Deluxe is a complete installable tile pack", () => {
  assert.ok(pack, "pack is registered");
  assert.equal(pack.name, "World Map Deluxe");
  assert.equal(pack.license, "CC0");
  assert.equal(pack.version, 2);
  assert.equal(pack.preview, "world-map-essentials/preview.png");
  assert.equal(pack.files.length, 48);
  assert.ok(pack.files.every((file) => file.type === "tilesets"));
  assert.equal(new Set(pack.files.map((file) => file.name)).size, 48, "tile names are unique");
  assert.equal(pack.files.filter((file) => file.tags.includes("terrain")).length, 16, "includes sixteen terrains");
  assert.equal(pack.files.filter((file) => file.tags.includes("routes")).length, 16, "includes sixteen routes");
  assert.equal(pack.files.filter((file) => file.tags.includes("landmarks") || file.tags.includes("barriers")).length, 16, "includes sixteen landmarks and barriers");
  assert.ok(pack.files.some((file) => file.name.endsWith(".terrain")), "includes walkable terrain");
  assert.ok(pack.files.some((file) => file.name.endsWith(".pass")), "includes passable route overlays");
  assert.ok(pack.files.some((file) => file.name === "world-ocean"), "includes impassable water");
  assert.ok(pack.files.some((file) => file.name === "world-bridge-ew.pass"), "includes passable bridges");
  assert.ok(pack.files.some((file) => file.name === "world-crystal-cavern.terrain"), "includes premium fantasy terrain");
  assert.ok(pack.files.some((file) => file.name === "world-causeway-ew.pass"), "includes stone causeways");
});

test("every World Map Deluxe asset is a native 48x48 PNG", () => {
  for (const file of pack.files) {
    const bytes = fs.readFileSync(path.join(root, "img", "packs", file.url));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], file.name);
    assert.equal(bytes.readUInt32BE(16), 48, file.name + " width");
    assert.equal(bytes.readUInt32BE(20), 48, file.name + " height");
  }
});

test("World Map Deluxe ships a large pack preview", () => {
  const bytes = fs.readFileSync(path.join(root, "img", "packs", pack.preview));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), 1152);
  assert.equal(bytes.readUInt32BE(20), 864);
});

test("terrain seams and transparent route connectors are production-safe", async () => {
  const armsByName = {
    "world-road-ns.pass": "ns", "world-road-ew.pass": "ew",
    "world-road-ne.pass": "ne", "world-road-es.pass": "es",
    "world-road-sw.pass": "sw", "world-road-wn.pass": "wn",
    "world-road-nes.pass": "nes", "world-road-esw.pass": "esw",
    "world-road-nsw.pass": "nsw", "world-road-new.pass": "new",
    "world-road-cross.pass": "nesw", "world-bridge-ns.pass": "ns",
    "world-bridge-ew.pass": "ew", "world-causeway-ns.pass": "ns",
    "world-causeway-ew.pass": "ew", "world-stone-plaza.pass": "",
  };
  const inputs = pack.files.map((file) => ({
    ...file,
    src: "data:image/png;base64," + fs.readFileSync(path.join(root, "img", "packs", file.url)).toString("base64"),
  }));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const results = await page.evaluate(async (files) => {
    const load = (src) => new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src;
    });
    const out = {};
    for (const file of files) {
      const image = await load(file.src);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 48;
      const g = canvas.getContext("2d", { willReadFrequently: true });
      g.drawImage(image, 0, 0);
      const d = g.getImageData(0, 0, 48, 48).data;
      const pixel = (x, y) => [...d.slice((y * 48 + x) * 4, (y * 48 + x) * 4 + 4)];
      const edgeAlpha = { n: 0, e: 0, s: 0, w: 0 };
      let opaqueMagenta = 0;
      for (let i = 0; i < 48; i++) {
        if (pixel(i, 0)[3] > 20) edgeAlpha.n++;
        if (pixel(47, i)[3] > 20) edgeAlpha.e++;
        if (pixel(i, 47)[3] > 20) edgeAlpha.s++;
        if (pixel(0, i)[3] > 20) edgeAlpha.w++;
      }
      for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
        const [r, green, b, a] = pixel(x, y);
        if (a > 20 && r > 220 && green < 70 && b > 180) opaqueMagenta++;
      }
      let seamless = true;
      if (file.tags.includes("terrain")) {
        for (let i = 0; i < 48; i++) {
          seamless &&= pixel(0, i).every((value, channel) => value === pixel(47, i)[channel]);
          seamless &&= pixel(i, 0).every((value, channel) => value === pixel(i, 47)[channel]);
        }
      }
      out[file.name] = { edgeAlpha, opaqueMagenta, seamless };
    }
    return out;
  }, inputs);
  await browser.close();

  for (const file of pack.files.filter((item) => item.tags.includes("terrain"))) {
    assert.equal(results[file.name].seamless, true, file.name + " has matching opposite edges");
  }
  for (const [name, arms] of Object.entries(armsByName)) {
    const result = results[name];
    assert.equal(result.opaqueMagenta, 0, name + " has a clean transparency key");
    for (const edge of "nesw") {
      assert.equal(result.edgeAlpha[edge] > 0, arms.includes(edge), name + " edge " + edge);
    }
  }
});
