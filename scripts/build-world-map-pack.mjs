/* RPGAtlas — scripts/build-world-map-pack.mjs
   Builds the bundled World Map Deluxe tiles from high-resolution source art.
   The source atlases are sliced into native 48px tiles, magenta is keyed to
   transparency for overlays, and terrain edges are blended for clean repeats.

   Run: node scripts/build-world-map-pack.mjs
   GPL-3.0-or-later (see LICENSE). */

import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packId = "world-map-essentials";
const outDir = join(root, "img", "packs", packId);
const sourceDir = join(root, "scripts", "assets", packId);
const registryPath = join(root, "img", "packs", "index.json");
const TILE = 48;
mkdirSync(outDir, { recursive: true });

const terrainNames = [
  "world-plains.terrain", "world-forest.terrain", "world-desert.terrain", "world-tundra.terrain",
  "world-swamp.terrain", "world-volcanic.terrain", "world-highlands.terrain", "world-ocean",
  "world-shallows", "world-autumn-floor.terrain", "world-flower-meadow.terrain", "world-cobblestone.terrain",
  "world-temple-stone.terrain", "world-dungeon-stone.terrain", "world-red-badlands.terrain", "world-crystal-cavern.terrain",
];

const landmarkNames = [
  "world-village", "world-town", "world-castle", "world-port",
  "world-tower", "world-ruins", "world-cave", "world-shrine",
  "world-mountains", "world-snow-mountains", "world-cliffs", "world-volcano",
  "world-monolith", "world-logging-camp", "world-oasis", "world-crystal-cave",
];

const routeDefs = [
  ["world-road-ns.pass", "ns"], ["world-road-ew.pass", "ew"],
  ["world-road-ne.pass", "ne"], ["world-road-es.pass", "es"],
  ["world-road-sw.pass", "sw"], ["world-road-wn.pass", "wn"],
  ["world-road-nes.pass", "nes"], ["world-road-esw.pass", "esw"],
  ["world-road-nsw.pass", "nsw"], ["world-road-new.pass", "new"],
  ["world-road-cross.pass", "nesw"], ["world-bridge-ns.pass", "ns"],
  ["world-bridge-ew.pass", "ew"], ["world-causeway-ns.pass", "ns"],
  ["world-causeway-ew.pass", "ew"], ["world-stone-plaza.pass", ""],
];

function sourceData(name) {
  return "data:image/png;base64," + readFileSync(join(sourceDir, name)).toString("base64");
}

async function renderTiles() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  const images = await page.evaluate(async ({ terrainSrc, landmarkSrc, routeSrc, terrainNames, landmarkNames, routeDefs, tileSize }) => {
    const load = (src) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
    const [terrainAtlas, landmarkAtlas, routeAtlas] = await Promise.all([
      load(terrainSrc), load(landmarkSrc), load(routeSrc),
    ]);
    const makeCanvas = (w = tileSize, h = tileSize) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      return canvas;
    };
    const cellCanvas = (atlas, index) => {
      const cell = makeCanvas(Math.round(atlas.width / 4), Math.round(atlas.height / 4));
      const g = cell.getContext("2d", { willReadFrequently: true });
      const col = index % 4;
      const row = Math.floor(index / 4);
      const sx0 = Math.round(col * atlas.width / 4);
      const sy0 = Math.round(row * atlas.height / 4);
      const sx1 = Math.round((col + 1) * atlas.width / 4);
      const sy1 = Math.round((row + 1) * atlas.height / 4);
      cell.width = sx1 - sx0;
      cell.height = sy1 - sy0;
      g.drawImage(atlas, sx0, sy0, cell.width, cell.height, 0, 0, cell.width, cell.height);
      return cell;
    };
    const keyMagenta = (canvas) => {
      const g = canvas.getContext("2d", { willReadFrequently: true });
      const image = g.getImageData(0, 0, canvas.width, canvas.height);
      const d = image.data;
      const samples = [0, canvas.width - 1, (canvas.height - 1) * canvas.width, canvas.width * canvas.height - 1];
      const key = [0, 0, 0];
      for (const p of samples) {
        key[0] += d[p * 4]; key[1] += d[p * 4 + 1]; key[2] += d[p * 4 + 2];
      }
      key[0] /= samples.length; key[1] /= samples.length; key[2] /= samples.length;
      for (let p = 0; p < d.length; p += 4) {
        const distance = Math.hypot(d[p] - key[0], d[p + 1] - key[1], d[p + 2] - key[2]);
        if (distance <= 18) {
          d[p + 3] = 0;
          continue;
        }
        if (distance < 100) {
          const alpha = Math.max(0, Math.min(1, (distance - 18) / 82));
          d[p + 3] = Math.round(d[p + 3] * alpha);
          const spill = (1 - alpha) * 0.72;
          d[p] = Math.max(0, Math.round(d[p] - key[0] * spill));
          d[p + 2] = Math.max(0, Math.round(d[p + 2] - key[2] * spill));
        }
      }
      g.putImageData(image, 0, 0);
    };
    const alphaBounds = (canvas) => {
      const d = canvas.getContext("2d", { willReadFrequently: true })
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        if (d[(y * canvas.width + x) * 4 + 3] < 20) continue;
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
      return right < left ? null : { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
    };
    const fitSprite = (source, margin = 2, bottomAlign = true) => {
      const bounds = alphaBounds(source);
      const out = makeCanvas();
      if (!bounds) return out;
      const scale = Math.min((tileSize - margin * 2) / bounds.w, (tileSize - margin * 2) / bounds.h);
      const w = bounds.w * scale;
      const h = bounds.h * scale;
      const x = (tileSize - w) / 2;
      const y = bottomAlign ? tileSize - margin - h : (tileSize - h) / 2;
      const g = out.getContext("2d");
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      g.drawImage(source, bounds.x, bounds.y, bounds.w, bounds.h, x, y, w, h);
      return out;
    };
    const fitRoute = (source, arms) => {
      const bounds = alphaBounds(source);
      const out = makeCanvas();
      if (!bounds) return out;
      if (!arms) return fitSprite(source, 1, false);
      const verticalOnly = arms.includes("n") && arms.includes("s") && !arms.includes("e") && !arms.includes("w");
      const horizontalOnly = arms.includes("e") && arms.includes("w") && !arms.includes("n") && !arms.includes("s");
      let scale = verticalOnly ? tileSize / bounds.h : horizontalOnly ? tileSize / bounds.w
        : Math.min(tileSize / bounds.w, tileSize / bounds.h);
      let w = bounds.w * scale;
      let h = bounds.h * scale;
      if (arms.includes("e") && arms.includes("w")) w = tileSize;
      if (arms.includes("n") && arms.includes("s")) h = tileSize;
      let x = (tileSize - w) / 2;
      let y = (tileSize - h) / 2;
      if (arms.includes("w") && !arms.includes("e")) x = 0;
      if (arms.includes("e") && !arms.includes("w")) x = tileSize - w;
      if (arms.includes("n") && !arms.includes("s")) y = 0;
      if (arms.includes("s") && !arms.includes("n")) y = tileSize - h;
      const g = out.getContext("2d");
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      g.drawImage(source, bounds.x, bounds.y, bounds.w, bounds.h, x, y, w, h);
      const normalizeEdges = () => {
        const edgeBand = 2;
        g.save();
        g.globalCompositeOperation = "destination-out";
        if (!arms.includes("n")) g.clearRect(0, 0, tileSize, edgeBand);
        if (!arms.includes("e")) g.clearRect(tileSize - edgeBand, 0, edgeBand, tileSize);
        if (!arms.includes("s")) g.clearRect(0, tileSize - edgeBand, tileSize, edgeBand);
        if (!arms.includes("w")) g.clearRect(0, 0, edgeBand, tileSize);
        g.restore();
        const image = g.getImageData(0, 0, tileSize, tileSize);
        const d = image.data;
        const alphaAt = (px, py) => d[(py * tileSize + px) * 4 + 3];
        const copyPixel = (sx, sy, dx, dy) => {
          const sourceAt = (sy * tileSize + sx) * 4;
          const targetAt = (dy * tileSize + dx) * 4;
          for (let c = 0; c < 4; c++) d[targetAt + c] = d[sourceAt + c];
        };
        const enoughHorizontal = (y) => {
          let count = 0;
          for (let x = 10; x < tileSize - 10; x++) if (alphaAt(x, y) > 20) count++;
          return count >= 4;
        };
        const enoughVertical = (x) => {
          let count = 0;
          for (let y = 10; y < tileSize - 10; y++) if (alphaAt(x, y) > 20) count++;
          return count >= 4;
        };
        if (arms.includes("n")) {
          let sourceY = 0;
          while (sourceY < tileSize / 2 && !enoughHorizontal(sourceY)) sourceY++;
          for (let y = 0; y < sourceY; y++) for (let x = 0; x < tileSize; x++) copyPixel(x, sourceY, x, y);
        }
        if (arms.includes("s")) {
          let sourceY = tileSize - 1;
          while (sourceY >= tileSize / 2 && !enoughHorizontal(sourceY)) sourceY--;
          for (let y = sourceY + 1; y < tileSize; y++) for (let x = 0; x < tileSize; x++) copyPixel(x, sourceY, x, y);
        }
        if (arms.includes("w")) {
          let sourceX = 0;
          while (sourceX < tileSize / 2 && !enoughVertical(sourceX)) sourceX++;
          for (let x = 0; x < sourceX; x++) for (let y = 0; y < tileSize; y++) copyPixel(sourceX, y, x, y);
        }
        if (arms.includes("e")) {
          let sourceX = tileSize - 1;
          while (sourceX >= tileSize / 2 && !enoughVertical(sourceX)) sourceX--;
          for (let x = sourceX + 1; x < tileSize; x++) for (let y = 0; y < tileSize; y++) copyPixel(sourceX, y, x, y);
        }
        g.putImageData(image, 0, 0);
      };
      normalizeEdges();
      return out;
    };
    const seamlessEdges = (canvas, band = 3) => {
      const g = canvas.getContext("2d", { willReadFrequently: true });
      const image = g.getImageData(0, 0, canvas.width, canvas.height);
      const d = image.data;
      const blendPair = (a, b, strength) => {
        for (let c = 0; c < 3; c++) {
          const avg = (d[a + c] + d[b + c]) / 2;
          d[a + c] = Math.round(d[a + c] * (1 - strength) + avg * strength);
          d[b + c] = Math.round(d[b + c] * (1 - strength) + avg * strength);
        }
      };
      for (let offset = 0; offset < band; offset++) {
        const strength = (band - offset) / band;
        for (let y = 0; y < tileSize; y++) {
          blendPair((y * tileSize + offset) * 4, (y * tileSize + tileSize - 1 - offset) * 4, strength);
        }
        for (let x = 0; x < tileSize; x++) {
          blendPair((offset * tileSize + x) * 4, ((tileSize - 1 - offset) * tileSize + x) * 4, strength);
        }
      }
      g.putImageData(image, 0, 0);
    };
    const downsampleTerrain = (source) => {
      const out = makeCanvas();
      const g = out.getContext("2d");
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      g.drawImage(source, 0, 0, source.width, source.height, 0, 0, tileSize, tileSize);
      seamlessEdges(out);
      return out;
    };
    const out = {};
    terrainNames.forEach((name, index) => {
      out[name] = downsampleTerrain(cellCanvas(terrainAtlas, index)).toDataURL("image/png");
    });
    landmarkNames.forEach((name, index) => {
      const cell = cellCanvas(landmarkAtlas, index);
      keyMagenta(cell);
      out[name] = fitSprite(cell).toDataURL("image/png");
    });
    routeDefs.forEach(([name, arms], index) => {
      const cell = cellCanvas(routeAtlas, index);
      keyMagenta(cell);
      out[name] = fitRoute(cell, arms).toDataURL("image/png");
    });
    return out;
  }, {
    terrainSrc: sourceData("terrain-atlas.png"),
    landmarkSrc: sourceData("landmarks-atlas.png"),
    routeSrc: sourceData("routes-atlas.png"),
    terrainNames,
    landmarkNames,
    routeDefs,
    tileSize: TILE,
  });
  await browser.close();
  return images;
}

function tagsFor(name) {
  if (/road|bridge|causeway|plaza/.test(name)) return ["world-map", "routes", "deluxe"];
  if (/mountain|cliff|volcano/.test(name)) return ["world-map", "barriers", "deluxe"];
  if (landmarkNames.includes(name)) return ["world-map", "landmarks", "deluxe"];
  return ["world-map", "terrain", "deluxe"];
}

const images = await renderTiles();
const files = [];
for (const [name, dataUrl] of Object.entries(images)) {
  const filename = "tilesets." + name + ".png";
  writeFileSync(join(outDir, filename), Buffer.from(dataUrl.split(",")[1], "base64"));
  files.push({ type: "tilesets", name, url: packId + "/" + filename, tags: tagsFor(name) });
}

const preview = await (async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  const dataUrl = await page.evaluate(async ({ entries, tileSize }) => {
    const load = (src) => new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src;
    });
    const images = await Promise.all(entries.map(([name, src]) => load(src).then((image) => [name, image])));
    const canvas = document.createElement("canvas");
    canvas.width = tileSize * 8; canvas.height = tileSize * 6;
    const g = canvas.getContext("2d");
    g.fillStyle = "#18231f"; g.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < 16; i++) g.drawImage(images[i][1], (i % 8) * tileSize, Math.floor(i / 8) * tileSize);
    const meadow = images[0][1];
    for (let i = 16; i < 32; i++) {
      const j = i - 16, x = (j % 8) * tileSize, y = (2 + Math.floor(j / 8)) * tileSize;
      g.drawImage(meadow, x, y); g.drawImage(images[i][1], x, y);
    }
    for (let i = 32; i < 48; i++) {
      const j = i - 32, x = (j % 8) * tileSize, y = (4 + Math.floor(j / 8)) * tileSize;
      g.drawImage(meadow, x, y); g.drawImage(images[i][1], x, y);
    }
    const scaled = document.createElement("canvas");
    scaled.width = canvas.width * 3; scaled.height = canvas.height * 3;
    const sg = scaled.getContext("2d"); sg.imageSmoothingEnabled = false;
    sg.drawImage(canvas, 0, 0, scaled.width, scaled.height);
    return scaled.toDataURL("image/png");
  }, { entries: Object.entries(images), tileSize: TILE });
  await browser.close();
  return dataUrl;
})();
writeFileSync(join(outDir, "preview.png"), Buffer.from(preview.split(",")[1], "base64"));

let registry = { packs: [] };
try { registry = JSON.parse(readFileSync(registryPath, "utf8")); } catch { /* first build */ }
const pack = {
  id: packId,
  name: "World Map Deluxe",
  desc: "Forty-eight premium hand-painted 48px tiles: sixteen seamless terrains, a complete modular road/bridge/causeway kit, and sixteen detailed landmarks. Original RPGAtlas art — CC0, no attribution needed.",
  license: "CC0",
  version: 2,
  preview: packId + "/preview.png",
  files,
};
registry.packs = [...(Array.isArray(registry.packs) ? registry.packs : []).filter((item) => item.id !== packId), pack];
writeFileSync(registryPath, JSON.stringify(registry, null, 1));
console.log("World Map Deluxe: " + files.length + " tiles → " + outDir);
