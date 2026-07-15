/* RPGAtlas - Dungeon Depths Deluxe pack regression tests. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("@playwright/test");

const root = path.join(__dirname, "..");
const registry = JSON.parse(fs.readFileSync(path.join(root, "img", "packs", "index.json"), "utf8"));
const pack = registry.packs.find((item) => item.id === "dungeon-depths-deluxe");

test("Dungeon Depths Deluxe is a complete indoor dungeon pack", () => {
  assert.ok(pack, "pack is registered");
  assert.equal(pack.name, "Dungeon Depths Deluxe");
  assert.equal(pack.license, "CC0");
  assert.equal(pack.version, 1);
  assert.equal(pack.preview, "dungeon-depths-deluxe/preview.png");
  assert.equal(pack.files.length, 48);
  assert.ok(pack.files.every((file) => file.type === "tilesets"));
  assert.equal(new Set(pack.files.map((file) => file.name)).size, 48, "tile names are unique");
  assert.equal(pack.files.filter((file) => file.tags.includes("floors")).length, 8);
  assert.equal(pack.files.filter((file) => file.tags.includes("water")).length, 8);
  assert.equal(pack.files.filter((file) => file.tags.includes("walls")).length, 16);
  assert.equal(pack.files.filter((file) => file.tags.includes("ceilings")).length, 16);
  assert.equal(pack.files.filter((file) => file.name.endsWith(".terrain")).length, 8);
  assert.equal(pack.files.filter((file) => file.name.endsWith(".pass")).length, 4);
  assert.ok(pack.files.every((file) => file.tags.includes("indoors")));
  assert.ok(pack.files.every((file) => !/world|village|building|house/.test(file.name)));
  assert.ok(pack.files.some((file) => file.name === "dungeon-toxic-water"));
  assert.ok(pack.files.some((file) => file.name === "dungeon-wall-cross"));
  assert.ok(pack.files.some((file) => file.name === "dungeon-ceiling-ribbed-vault"));
});

test("every Dungeon Depths Deluxe asset is a native 48x48 PNG", () => {
  for (const file of pack.files) {
    const bytes = fs.readFileSync(path.join(root, "img", "packs", file.url));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], file.name);
    assert.equal(bytes.readUInt32BE(16), 48, file.name + " width");
    assert.equal(bytes.readUInt32BE(20), 48, file.name + " height");
  }
});

test("Dungeon Depths Deluxe ships a large pack preview and source atlases", () => {
  const preview = fs.readFileSync(path.join(root, "img", "packs", pack.preview));
  assert.equal(preview.readUInt32BE(16), 1152);
  assert.equal(preview.readUInt32BE(20), 864);
  for (const name of ["surfaces-atlas.png", "walls-atlas.png", "ceilings-atlas.png"]) {
    assert.ok(fs.statSync(path.join(root, "scripts", "sources", "dungeon-depths-deluxe", name)).size > 1_000_000, name);
  }
});

test("floor and water tiles are seamless and the water palette stays varied", async () => {
  const surfaceFiles = pack.files.filter((file) => file.tags.includes("floors") || file.tags.includes("water"));
  const inputs = surfaceFiles.map((file) => ({
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
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 48;
      const g = canvas.getContext("2d", { willReadFrequently: true }); g.drawImage(image, 0, 0);
      const d = g.getImageData(0, 0, 48, 48).data;
      const pixel = (x, y) => [...d.slice((y * 48 + x) * 4, (y * 48 + x) * 4 + 4)];
      let seamless = true, r = 0, green = 0, b = 0;
      for (let i = 0; i < 48; i++) {
        seamless &&= pixel(0, i).every((value, channel) => value === pixel(47, i)[channel]);
        seamless &&= pixel(i, 0).every((value, channel) => value === pixel(i, 47)[channel]);
      }
      for (let i = 0; i < d.length; i += 4) { r += d[i]; green += d[i + 1]; b += d[i + 2]; }
      const count = 48 * 48;
      out[file.name] = { seamless, average: [r, green, b].map((value) => Math.round(value / count / 16) * 16) };
    }
    return out;
  }, inputs);
  await browser.close();

  assert.ok(surfaceFiles.every((file) => results[file.name].seamless), "all full-cell surfaces have matching opposite edges");
  const waterColors = new Set(surfaceFiles.filter((file) => file.tags.includes("water")).map((file) => results[file.name].average.join(",")));
  assert.ok(waterColors.size >= 7, "the eight liquids retain visibly different color families");
});
