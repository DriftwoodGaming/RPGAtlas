/* RPGAtlas - scripts/build-dungeon-depths-pack.mjs
   Builds Dungeon Depths Deluxe from the checked-in high-resolution source
   atlases and downsamples every cell to a native 48px editor tile.

   Run: node scripts/build-dungeon-depths-pack.mjs
   Source artwork and generated pack: CC0. */

import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packId = "dungeon-depths-deluxe";
const sourceDir = join(root, "scripts", "sources", packId);
const outDir = join(root, "img", "packs", packId);
const registryPath = join(root, "img", "packs", "index.json");
const TILE = 48;
mkdirSync(outDir, { recursive: true });

const surfaces = [
  "dungeon-ancient-flagstone.terrain", "dungeon-dark-basalt.terrain",
  "dungeon-mossy-stone.terrain", "dungeon-temple-marble.terrain",
  "dungeon-rune-floor.terrain", "dungeon-worn-brick.terrain",
  "dungeon-iron-grate.terrain", "dungeon-timber-floor.terrain",
  "dungeon-blue-water", "dungeon-toxic-water", "dungeon-blood-water",
  "dungeon-arcane-water", "dungeon-shallow-water", "dungeon-abyss-water",
  "dungeon-ice-water", "dungeon-molten-water",
];

const walls = [
  "dungeon-wall-ns-a", "dungeon-wall-ew-a", "dungeon-wall-ns-b", "dungeon-wall-ew-b",
  "dungeon-wall-ne-inner", "dungeon-wall-es-inner", "dungeon-wall-sw-inner", "dungeon-wall-wn-inner",
  "dungeon-wall-ne-outer", "dungeon-wall-es-outer", "dungeon-wall-sw-outer", "dungeon-wall-wn-outer",
  "dungeon-wall-t-junction", "dungeon-wall-cross", "dungeon-wall-cracked", "dungeon-barred-arch",
];

const ceilings = [
  "dungeon-ceiling-stone", "dungeon-ceiling-cracked", "dungeon-ceiling-mossy",
  "dungeon-ceiling-rune", "dungeon-ceiling-ribbed-vault", "dungeon-ceiling-crossed-vault",
  "dungeon-ceiling-timber-ns", "dungeon-ceiling-timber-ew", "dungeon-ceiling-iron",
  "dungeon-ceiling-collapse", "dungeon-hanging-chains.pass", "dungeon-chandelier.pass",
  "dungeon-arch-ns.pass", "dungeon-arch-ew.pass", "dungeon-stalactites", "dungeon-crystal-ceiling",
];

function sourceData(name) {
  return "data:image/png;base64," + readFileSync(join(sourceDir, name)).toString("base64");
}

async function renderPack() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  const images = await page.evaluate(async ({ atlases, groups, tileSize }) => {
    const load = (src) => new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src;
    });
    const loaded = await Promise.all(atlases.map(load));
    const makeCanvas = (w = tileSize, h = tileSize) => {
      const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h; return canvas;
    };
    const cropCell = (atlas, index) => {
      const col = index % 4, row = Math.floor(index / 4);
      const sx0 = Math.round(col * atlas.width / 4), sy0 = Math.round(row * atlas.height / 4);
      const sx1 = Math.round((col + 1) * atlas.width / 4), sy1 = Math.round((row + 1) * atlas.height / 4);
      const canvas = makeCanvas();
      const g = canvas.getContext("2d", { willReadFrequently: true });
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
      g.drawImage(atlas, sx0, sy0, sx1 - sx0, sy1 - sy0, 0, 0, tileSize, tileSize);
      return canvas;
    };
    const makeSeamless = (canvas, band = 3) => {
      const g = canvas.getContext("2d", { willReadFrequently: true });
      const image = g.getImageData(0, 0, tileSize, tileSize), d = image.data;
      const blend = (a, b, strength) => {
        for (let c = 0; c < 4; c++) {
          const average = Math.round((d[a + c] + d[b + c]) / 2);
          d[a + c] = Math.round(d[a + c] * (1 - strength) + average * strength);
          d[b + c] = Math.round(d[b + c] * (1 - strength) + average * strength);
        }
      };
      for (let offset = 0; offset < band; offset++) {
        const strength = (band - offset) / band;
        for (let y = 0; y < tileSize; y++) blend((y * tileSize + offset) * 4, (y * tileSize + tileSize - 1 - offset) * 4, strength);
        for (let x = 0; x < tileSize; x++) blend((offset * tileSize + x) * 4, ((tileSize - 1 - offset) * tileSize + x) * 4, strength);
      }
      g.putImageData(image, 0, 0);
    };
    const out = {};
    groups.forEach((names, groupIndex) => names.forEach((name, index) => {
      const canvas = cropCell(loaded[groupIndex], index);
      if (groupIndex === 0) makeSeamless(canvas);
      out[name] = canvas.toDataURL("image/png");
    }));
    return out;
  }, {
    atlases: [sourceData("surfaces-atlas.png"), sourceData("walls-atlas.png"), sourceData("ceilings-atlas.png")],
    groups: [surfaces, walls, ceilings], tileSize: TILE,
  });
  await browser.close();
  return images;
}

function tagsFor(name) {
  if (surfaces.includes(name)) return ["dungeon", /water/.test(name) ? "water" : "floors", "indoors", "deluxe"];
  if (walls.includes(name)) return ["dungeon", "walls", "indoors", "deluxe"];
  return ["dungeon", "ceilings", "indoors", "deluxe"];
}

const images = await renderPack();
const files = [];
for (const [name, dataUrl] of Object.entries(images)) {
  const filename = "tilesets." + name + ".png";
  writeFileSync(join(outDir, filename), Buffer.from(dataUrl.split(",")[1], "base64"));
  files.push({ type: "tilesets", name, url: packId + "/" + filename, tags: tagsFor(name) });
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<!doctype html><html><body></body></html>");
const preview = await page.evaluate(async ({ entries, tileSize }) => {
  const load = (src) => new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src;
  });
  const loaded = await Promise.all(entries.map(([name, src]) => load(src).then((image) => [name, image])));
  const canvas = document.createElement("canvas"); canvas.width = tileSize * 8; canvas.height = tileSize * 6;
  const g = canvas.getContext("2d"); g.fillStyle = "#090d12"; g.fillRect(0, 0, canvas.width, canvas.height);
  loaded.forEach(([, image], index) => g.drawImage(image, (index % 8) * tileSize, Math.floor(index / 8) * tileSize));
  const scaled = document.createElement("canvas"); scaled.width = canvas.width * 3; scaled.height = canvas.height * 3;
  const sg = scaled.getContext("2d"); sg.imageSmoothingEnabled = false; sg.drawImage(canvas, 0, 0, scaled.width, scaled.height);
  return scaled.toDataURL("image/png");
}, { entries: Object.entries(images), tileSize: TILE });
await browser.close();
writeFileSync(join(outDir, "preview.png"), Buffer.from(preview.split(",")[1], "base64"));

let registry = { packs: [] };
try { registry = JSON.parse(readFileSync(registryPath, "utf8")); } catch { /* first build */ }
const pack = {
  id: packId,
  name: "Dungeon Depths Deluxe",
  desc: "Forty-eight high-fidelity indoor dungeon tiles: eight floors, eight colored waters, a full modular wall kit, and sixteen ceiling and overhang pieces. Original RPGAtlas art - CC0, no attribution needed.",
  license: "CC0",
  version: 1,
  preview: packId + "/preview.png",
  files,
};
registry.packs = [...(Array.isArray(registry.packs) ? registry.packs : []).filter((item) => item.id !== packId), pack];
writeFileSync(registryPath, JSON.stringify(registry, null, 1));
console.log("Dungeon Depths Deluxe: " + files.length + " tiles -> " + outDir);
