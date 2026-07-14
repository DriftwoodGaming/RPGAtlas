/* RPGAtlas — scripts/build-world-map-pack.mjs
   Regenerates the bundled "World Map Essentials" tileset as deterministic,
   license-clean pixel art. Tiles are authored on a 16px grid and scaled to
   the engine's native 48px tile size without smoothing.

   Run: node scripts/build-world-map-pack.mjs
   GPL-3.0-or-later (see LICENSE). */

import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packId = "world-map-essentials";
const outDir = join(root, "img", "packs", packId);
const registryPath = join(root, "img", "packs", "index.json");
mkdirSync(outDir, { recursive: true });

async function renderTiles() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  const images = await page.evaluate(() => {
    const out = {};
    const make = (name, draw, opaque = false) => {
      const source = document.createElement("canvas");
      source.width = source.height = 16;
      const g = source.getContext("2d");
      g.imageSmoothingEnabled = false;
      if (opaque) {
        g.fillStyle = "#000";
        g.fillRect(0, 0, 16, 16);
      }
      draw(g);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 48;
      const target = canvas.getContext("2d");
      target.imageSmoothingEnabled = false;
      target.drawImage(source, 0, 0, 48, 48);
      out[name] = canvas.toDataURL("image/png");
    };
    const rect = (g, color, x, y, w = 1, h = 1) => {
      g.fillStyle = color;
      g.fillRect(x, y, w, h);
    };
    const poly = (g, color, points) => {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) g.lineTo(points[i][0], points[i][1]);
      g.closePath();
      g.fill();
    };
    const texture = (g, colors, marks) => {
      rect(g, colors[0], 0, 0, 16, 16);
      for (let i = 0; i < marks; i++) {
        const x = (i * 7 + 3) % 16;
        const y = (i * 11 + Math.floor(i / 3)) % 16;
        rect(g, colors[1 + (i % (colors.length - 1))], x, y, i % 4 === 0 ? 2 : 1, 1);
      }
    };
    const road = (g, arms) => {
      const edge = "#795735", dirt = "#b88b50", light = "#d0a766";
      if (arms.includes("n")) { rect(g, edge, 5, 0, 6, 9); rect(g, dirt, 6, 0, 4, 9); }
      if (arms.includes("s")) { rect(g, edge, 5, 7, 6, 9); rect(g, dirt, 6, 7, 4, 9); }
      if (arms.includes("w")) { rect(g, edge, 0, 5, 9, 6); rect(g, dirt, 0, 6, 9, 4); }
      if (arms.includes("e")) { rect(g, edge, 7, 5, 9, 6); rect(g, dirt, 7, 6, 9, 4); }
      rect(g, dirt, 6, 6, 4, 4);
      if (arms.includes("n") || arms.includes("s")) rect(g, light, 8, 1, 1, 3);
      if (arms.includes("e") || arms.includes("w")) rect(g, light, 1, 8, 3, 1);
    };
    const mountain = (g, x, y, snow = false) => {
      poly(g, "#51483f", [[x, y + 7], [x + 4, y], [x + 8, y + 7]]);
      poly(g, "#786b59", [[x + 1, y + 7], [x + 4, y], [x + 4, y + 7]]);
      poly(g, "#a49378", [[x + 4, y], [x + 7, y + 7], [x + 4, y + 7]]);
      if (snow) poly(g, "#eef5f4", [[x + 2, y + 3], [x + 4, y], [x + 6, y + 3], [x + 5, y + 3], [x + 4, y + 4], [x + 3, y + 3]]);
    };
    const roofHouse = (g, x, y, roof, wall = "#ead4a0") => {
      rect(g, wall, x + 1, y + 3, 5, 4);
      poly(g, roof, [[x, y + 3], [x + 3, y], [x + 7, y + 3]]);
      rect(g, "#6a432c", x + 3, y + 5, 1, 2);
      rect(g, "#8fc4d0", x + 1, y + 4, 1, 1);
    };

    // Full-cell terrain. The .terrain suffix makes these walkable ground tiles.
    make("world-plains.terrain", (g) => texture(g, ["#74a84b", "#5e913c", "#91bd5d"], 25));
    make("world-forest.terrain", (g) => {
      texture(g, ["#3f713d", "#315d34", "#56884a"], 18);
      for (const [x, y] of [[2, 2], [9, 1], [5, 7], [12, 9], [1, 11], [8, 12]]) {
        rect(g, "#274b2c", x + 1, y + 2, 1, 2);
        poly(g, "#4e8b43", [[x, y + 3], [x + 2, y], [x + 4, y + 3]]);
        poly(g, "#356c38", [[x, y + 2], [x + 2, y - 1], [x + 4, y + 2]]);
      }
    });
    make("world-desert.terrain", (g) => {
      texture(g, ["#d8b86b", "#c69b50", "#efd486"], 18);
      rect(g, "#b98943", 2, 5, 5, 1); rect(g, "#efd486", 9, 11, 5, 1);
    });
    make("world-tundra.terrain", (g) => texture(g, ["#b9c5af", "#8fa38f", "#d8ded0"], 20));
    make("world-swamp.terrain", (g) => {
      texture(g, ["#536542", "#3e5038", "#75815a"], 20);
      rect(g, "#435f58", 2, 4, 5, 2); rect(g, "#6f8a77", 3, 4, 2, 1);
      rect(g, "#435f58", 9, 10, 5, 2); rect(g, "#6f8a77", 11, 10, 2, 1);
    });
    make("world-volcanic.terrain", (g) => {
      texture(g, ["#403a3b", "#2e292c", "#62504a"], 22);
      rect(g, "#a83d27", 0, 8, 5, 1); rect(g, "#e46b2d", 3, 8, 1, 1);
      rect(g, "#a83d27", 9, 3, 7, 1); rect(g, "#e46b2d", 12, 3, 2, 1);
    });
    make("world-highlands.terrain", (g) => {
      texture(g, ["#81945d", "#65784e", "#a5aa72"], 18);
      for (let y = 3; y < 16; y += 5) { rect(g, "#5c6d49", 0, y, 16, 1); rect(g, "#a5aa72", 4, y - 1, 7, 1); }
    });
    // Water intentionally has no suffix: it remains impassable in the engine.
    make("world-ocean", (g) => {
      texture(g, ["#285985", "#1f486f", "#3a75a5"], 12);
      for (let y = 3; y < 16; y += 5) { rect(g, "#5793bd", 1 + (y % 3), y, 6, 1); rect(g, "#3a75a5", 10, y + 2, 4, 1); }
    });
    make("world-shallows", (g) => {
      texture(g, ["#3e8c9b", "#317582", "#65b3ad"], 12);
      for (let y = 2; y < 16; y += 5) rect(g, "#83c8bd", y % 4, y, 8, 1);
    });

    // Transparent, walkable route overlays.
    for (const [name, arms] of [
      ["world-road-ns.pass", "ns"], ["world-road-ew.pass", "ew"],
      ["world-road-ne.pass", "ne"], ["world-road-es.pass", "es"],
      ["world-road-sw.pass", "sw"], ["world-road-wn.pass", "wn"],
      ["world-road-nes.pass", "nes"], ["world-road-esw.pass", "esw"],
      ["world-road-nsw.pass", "nsw"], ["world-road-new.pass", "new"],
      ["world-road-cross.pass", "nesw"],
    ]) make(name, (g) => road(g, arms));
    make("world-bridge-ns.pass", (g) => {
      rect(g, "#5c4029", 4, 0, 8, 16); rect(g, "#ad7b45", 5, 0, 6, 16);
      for (let y = 1; y < 16; y += 3) rect(g, "#6f4d30", 5, y, 6, 1);
      rect(g, "#d1a76a", 5, 0, 1, 16); rect(g, "#d1a76a", 10, 0, 1, 16);
    });
    make("world-bridge-ew.pass", (g) => {
      rect(g, "#5c4029", 0, 4, 16, 8); rect(g, "#ad7b45", 0, 5, 16, 6);
      for (let x = 1; x < 16; x += 3) rect(g, "#6f4d30", x, 5, 1, 6);
      rect(g, "#d1a76a", 0, 5, 16, 1); rect(g, "#d1a76a", 0, 10, 16, 1);
    });

    // Natural barriers.
    make("world-mountains", (g) => { mountain(g, 0, 7); mountain(g, 7, 3); mountain(g, 5, 9); });
    make("world-snow-mountains", (g) => { mountain(g, 0, 7, true); mountain(g, 7, 3, true); mountain(g, 5, 9, true); });
    make("world-cliffs", (g) => {
      poly(g, "#80705a", [[0, 5], [4, 2], [8, 5], [12, 1], [16, 5], [16, 14], [0, 14]]);
      rect(g, "#a49378", 0, 5, 16, 2); rect(g, "#51483f", 2, 9, 4, 1); rect(g, "#51483f", 10, 11, 5, 1);
    });
    make("world-volcano", (g) => {
      poly(g, "#4a3c3a", [[1, 14], [7, 3], [10, 3], [15, 14]]);
      poly(g, "#6a5148", [[1, 14], [7, 3], [8, 14]]);
      rect(g, "#251f22", 7, 2, 4, 2); rect(g, "#df5729", 8, 3, 2, 5); rect(g, "#f39a35", 9, 4, 1, 3);
    });

    // Settlements and landmarks, transparent so they sit over any terrain.
    make("world-village", (g) => { roofHouse(g, 1, 7, "#b85b3f"); roofHouse(g, 8, 4, "#d08a43"); });
    make("world-town", (g) => { roofHouse(g, 0, 7, "#a84c3c"); roofHouse(g, 7, 2, "#4f739b"); roofHouse(g, 8, 9, "#c27a37"); });
    make("world-castle", (g) => {
      rect(g, "#a9aaa4", 2, 5, 12, 9); rect(g, "#73756f", 3, 3, 3, 11); rect(g, "#73756f", 10, 3, 3, 11);
      for (const x of [3, 5, 10, 12]) rect(g, "#c8c9bf", x, 2, 1, 2);
      rect(g, "#3c3540", 7, 9, 2, 5); rect(g, "#e4b34e", 5, 7, 1, 2); rect(g, "#e4b34e", 10, 7, 1, 2);
    });
    make("world-port", (g) => {
      rect(g, "#8b663f", 0, 10, 16, 3); rect(g, "#5d422c", 2, 13, 2, 3); rect(g, "#5d422c", 12, 13, 2, 3);
      poly(g, "#d9d4bd", [[5, 2], [5, 10], [11, 8]]); rect(g, "#51382a", 4, 2, 1, 9); poly(g, "#8f4939", [[3, 10], [13, 10], [11, 13], [5, 13]]);
    });
    make("world-tower", (g) => {
      rect(g, "#898b88", 5, 4, 6, 11); rect(g, "#686a68", 4, 3, 8, 3); rect(g, "#34383b", 7, 11, 2, 4);
      rect(g, "#d1b35a", 7, 6, 2, 2); rect(g, "#74423b", 11, 1, 1, 5); poly(g, "#c95b4e", [[12, 1], [16, 3], [12, 4]]);
    });
    make("world-ruins", (g) => {
      rect(g, "#777b72", 2, 5, 3, 10); rect(g, "#a5a99c", 2, 4, 6, 2); rect(g, "#777b72", 11, 7, 3, 8);
      rect(g, "#a5a99c", 8, 12, 6, 2); rect(g, "#566149", 0, 14, 16, 2);
    });
    make("world-cave", (g) => {
      poly(g, "#5c5146", [[1, 14], [3, 6], [8, 2], [13, 6], [15, 14]]);
      poly(g, "#24252a", [[5, 14], [5, 9], [8, 6], [11, 9], [11, 14]]); rect(g, "#8f7e67", 3, 13, 10, 2);
    });
    make("world-shrine", (g) => {
      rect(g, "#dad5c2", 4, 7, 8, 7); poly(g, "#b84d45", [[2, 7], [8, 2], [14, 7]]);
      rect(g, "#6f4730", 7, 10, 2, 4); rect(g, "#d6aa49", 7, 6, 2, 2); rect(g, "#b84d45", 1, 14, 14, 1);
    });
    return out;
  });
  await browser.close();
  return images;
}

const images = await renderTiles();
const tagsFor = (name) => {
  if (/road|bridge/.test(name)) return ["world-map", "routes"];
  if (/village|town|castle|port|tower|ruins|cave|shrine/.test(name)) return ["world-map", "landmarks"];
  if (/mountain|cliff|volcano/.test(name)) return ["world-map", "barriers"];
  return ["world-map", "terrain"];
};
const files = [];
for (const [name, dataUrl] of Object.entries(images)) {
  const filename = "tilesets." + name + ".png";
  writeFileSync(join(outDir, filename), Buffer.from(dataUrl.split(",")[1], "base64"));
  files.push({
    type: "tilesets",
    name,
    url: packId + "/" + filename,
    tags: tagsFor(name),
  });
}

let registry = { packs: [] };
try { registry = JSON.parse(readFileSync(registryPath, "utf8")); } catch { /* first build */ }
const pack = {
  id: packId,
  name: "World Map Essentials",
  desc: "Thirty-four 48px tiles for overworlds: nine biomes, a complete road-and-bridge kit, natural barriers, settlements, and landmarks. Generated by RPGAtlas as deterministic pixel art — CC0, no attribution needed.",
  license: "CC0",
  version: 1,
  files,
};
registry.packs = [...(Array.isArray(registry.packs) ? registry.packs : []).filter((item) => item.id !== packId), pack];
writeFileSync(registryPath, JSON.stringify(registry, null, 1));
console.log("World Map Essentials: " + files.length + " tiles → " + outDir);
