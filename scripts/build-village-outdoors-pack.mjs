/* RPGAtlas - scripts/build-village-outdoors-pack.mjs
   Builds the bundled Village & Countryside Deluxe pack as deterministic,
   layered high-resolution artwork, then downsamples it to native 48px tiles.

   Run: node scripts/build-village-outdoors-pack.mjs
   GPL-3.0-or-later (see LICENSE). */

import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packId = "village-countryside-deluxe";
const outDir = join(root, "img", "packs", packId);
const registryPath = join(root, "img", "packs", "index.json");
const TILE = 48;
mkdirSync(outDir, { recursive: true });

const grounds = [
  ["village-summer-grass.terrain", "grass", ["#4f7f45", "#6e9a55", "#365f39"]],
  ["village-clover.terrain", "clover", ["#396f42", "#5d9250", "#2d5438"]],
  ["village-dry-grass.terrain", "grass", ["#9a884d", "#bea563", "#716c3f"]],
  ["village-dirt.terrain", "earth", ["#8b6746", "#ae8158", "#674a38"]],
  ["village-mud.terrain", "mud", ["#5f5042", "#786351", "#403b36"]],
  ["village-cobblestone.terrain", "cobble", ["#74746c", "#99978c", "#4e5553"]],
  ["village-flagstone.terrain", "flagstone", ["#777a73", "#9da097", "#555b58"]],
  ["village-mossy-stone.terrain", "moss", ["#677363", "#8a9278", "#445846"]],
  ["village-wood-deck.terrain", "wood", ["#8b5d38", "#b37b48", "#5b3d2c"]],
  ["village-tilled-soil.terrain", "furrows", ["#684632", "#875b3a", "#4d3429"]],
  ["village-flower-meadow.terrain", "flowers", ["#4f8248", "#74a35a", "#365f39"]],
  ["village-leaf-litter.terrain", "leaves", ["#72543b", "#98683f", "#4d4134"]],
  ["village-snow.terrain", "snow", ["#d8e1df", "#f3f4eb", "#aebdbe"]],
  ["village-river-sand.terrain", "sand", ["#b69b69", "#d0ba82", "#8d7a58"]],
  ["village-shallow-water", "water", ["#3f8890", "#69adb0", "#286b78"]],
  ["village-deep-water", "water", ["#24576f", "#397995", "#173d59"]],
];

const routes = [
  ["village-path-ns.pass", "ns", "dirt"], ["village-path-ew.pass", "ew", "dirt"],
  ["village-path-ne.pass", "ne", "dirt"], ["village-path-es.pass", "es", "dirt"],
  ["village-path-sw.pass", "sw", "dirt"], ["village-path-wn.pass", "wn", "dirt"],
  ["village-path-nes.pass", "nes", "dirt"], ["village-path-esw.pass", "esw", "dirt"],
  ["village-path-nsw.pass", "nsw", "dirt"], ["village-path-new.pass", "new", "dirt"],
  ["village-path-cross.pass", "nesw", "dirt"],
  ["village-cobble-lane-ns.pass", "ns", "cobble"], ["village-cobble-lane-ew.pass", "ew", "cobble"],
  ["village-timber-bridge-ns.pass", "ns", "bridge"], ["village-timber-bridge-ew.pass", "ew", "bridge"],
  ["village-market-square.pass", "", "square"],
];

const buildings = [
  ["village-cottage-red", "cottage", "#854846", "#d4bd8a"],
  ["village-cottage-blue", "cottage", "#496b7f", "#d6c59b"],
  ["village-thatched-cottage", "thatch", "#b88a49", "#d7c393"],
  ["village-timber-cottage", "timber", "#634536", "#c9b58c"],
  ["village-inn", "inn", "#7c3f3d", "#d0b27f"],
  ["village-blacksmith", "smithy", "#4b5356", "#a88b68"],
  ["village-bakery", "bakery", "#a8644f", "#e1c99a"],
  ["village-apothecary", "apothecary", "#4d7659", "#c6c295"],
  ["village-chapel", "chapel", "#526a79", "#d8d0b2"],
  ["village-town-hall", "hall", "#6d4f65", "#d5c49d"],
  ["village-barn", "barn", "#8c4738", "#b78659"],
  ["village-windmill", "windmill", "#7b5a41", "#d9c79f"],
  ["village-market-stall", "market", "#bd5b4f", "#e3c36d"],
  ["village-stone-well", "well", "#617070", "#a49e8c"],
  ["village-fountain", "fountain", "#647b82", "#a9bbb7"],
  ["village-gatehouse", "gatehouse", "#586267", "#aaa28c"],
];

const nature = [
  ["village-old-oak", "tree", "#315d35", "#6f943e"],
  ["village-pine", "pine", "#244f3b", "#4d7751"],
  ["village-birch", "birch", "#4b713e", "#84a34d"],
  ["village-apple-tree", "apple", "#34623a", "#78a24b"],
  ["village-autumn-tree", "tree", "#9b4e32", "#d18a3e"],
  ["village-evergreen-cluster", "cluster", "#234c38", "#527650"],
  ["village-flowering-hedge", "hedge", "#3c703e", "#72974c"],
  ["village-round-shrub", "shrub", "#3f7545", "#75a451"],
  ["village-wildflowers.pass", "flowers", "#d9d06c", "#da7488"],
  ["village-grass-tuft.pass", "tuft", "#4d7f45", "#83a856"],
  ["village-fallen-leaves.pass", "leaves", "#a85f35", "#d0923e"],
  ["village-mossy-boulder", "boulder", "#66716a", "#93a08a"],
  ["village-tree-stump", "stump", "#714a31", "#a7784b"],
  ["village-firewood-stack", "woodpile", "#784a2e", "#bd7b43"],
  ["village-scarecrow", "scarecrow", "#7b5635", "#d0a75c"],
  ["village-signpost", "sign", "#755037", "#b07a49"],
];

const boundaries = [
  ["village-fence-ns", "ns", "fence"], ["village-fence-ew", "ew", "fence"],
  ["village-fence-ne", "ne", "fence"], ["village-fence-es", "es", "fence"],
  ["village-fence-sw", "sw", "fence"], ["village-fence-wn", "wn", "fence"],
  ["village-fence-nes", "nes", "fence"], ["village-fence-esw", "esw", "fence"],
  ["village-fence-nsw", "nsw", "fence"], ["village-fence-new", "new", "fence"],
  ["village-fence-cross", "nesw", "fence"],
  ["village-gate-ns.pass", "ns", "gate"], ["village-gate-ew.pass", "ew", "gate"],
  ["village-stone-wall-ns", "ns", "wall"], ["village-stone-wall-ew", "ew", "wall"],
  ["village-hedge-arch.pass", "ew", "arch"],
];

async function renderPack() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  const result = await page.evaluate(({ tileSize, grounds, routes, buildings, nature, boundaries }) => {
    const SCALE = 4;
    const SIZE = tileSize * SCALE;
    const u = (value) => value * SCALE;
    const makeCanvas = (w = SIZE, h = SIZE) => {
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      return canvas;
    };
    const hash = (text) => {
      let value = 2166136261;
      for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
      return value >>> 0;
    };
    const randomFor = (text) => {
      let state = hash(text) || 1;
      return () => ((state = Math.imul(state ^ (state >>> 15), 2246822519) + 3266489917 >>> 0) / 4294967296);
    };
    const ellipse = (g, x, y, rx, ry, fill, stroke = null, width = 1) => {
      g.beginPath(); g.ellipse(u(x), u(y), u(rx), u(ry), 0, 0, Math.PI * 2);
      g.fillStyle = fill; g.fill();
      if (stroke) { g.lineWidth = u(width); g.strokeStyle = stroke; g.stroke(); }
    };
    const polygon = (g, points, fill, stroke = null, width = 1) => {
      g.beginPath(); g.moveTo(u(points[0][0]), u(points[0][1]));
      for (let i = 1; i < points.length; i++) g.lineTo(u(points[i][0]), u(points[i][1]));
      g.closePath(); g.fillStyle = fill; g.fill();
      if (stroke) { g.lineWidth = u(width); g.strokeStyle = stroke; g.lineJoin = "round"; g.stroke(); }
    };
    const line = (g, points, color, width, cap = "round") => {
      g.beginPath(); g.moveTo(u(points[0][0]), u(points[0][1]));
      for (let i = 1; i < points.length; i++) g.lineTo(u(points[i][0]), u(points[i][1]));
      g.strokeStyle = color; g.lineWidth = u(width); g.lineCap = cap; g.lineJoin = "round"; g.stroke();
    };
    const rect = (g, x, y, w, h, fill, stroke = null, width = 1) => {
      g.fillStyle = fill; g.fillRect(u(x), u(y), u(w), u(h));
      if (stroke) { g.lineWidth = u(width); g.strokeStyle = stroke; g.strokeRect(u(x), u(y), u(w), u(h)); }
    };
    const wrapEllipse = (g, x, y, rx, ry, fill) => {
      for (const ox of [-48, 0, 48]) for (const oy of [-48, 0, 48]) ellipse(g, x + ox, y + oy, rx, ry, fill);
    };
    const downsample = (source) => {
      const out = makeCanvas(tileSize, tileSize);
      const g = out.getContext("2d");
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
      g.drawImage(source, 0, 0, tileSize, tileSize);
      return out;
    };
    const drawGround = ([name, kind, colors]) => {
      const canvas = makeCanvas(); const g = canvas.getContext("2d"); const rng = randomFor(name);
      g.fillStyle = colors[0]; g.fillRect(0, 0, SIZE, SIZE);
      for (let i = 0; i < 145; i++) {
        const x = rng() * 48, y = rng() * 48;
        const color = colors[1 + (i % 2)];
        const rx = kind === "cobble" || kind === "flagstone" ? 2.7 + rng() * 2.3 : 0.35 + rng() * 0.8;
        const ry = kind === "cobble" || kind === "flagstone" ? 1.4 + rng() * 1.8 : 0.3 + rng() * 0.7;
        wrapEllipse(g, x, y, rx, ry, color + (kind === "snow" ? "88" : "70"));
      }
      if (["grass", "clover", "flowers"].includes(kind)) {
        for (let i = 0; i < 34; i++) {
          const x = rng() * 48, y = rng() * 48;
          line(g, [[x, y + 1.5], [x - 0.5, y - 1]], i % 3 ? colors[2] : colors[1], 0.45);
          if (kind === "clover" && i % 3 === 0) {
            ellipse(g, x - 0.7, y - 1.2, 0.7, 0.45, colors[1]); ellipse(g, x + 0.7, y - 1.2, 0.7, 0.45, colors[1]);
          }
          if (kind === "flowers" && i % 4 === 0) ellipse(g, x, y - 1.5, 0.65, 0.65, ["#f3d76b", "#e990a1", "#d9d5f1"][i % 3]);
        }
      }
      if (kind === "mud") for (let i = 0; i < 10; i++) ellipse(g, rng() * 48, rng() * 48, 3 + rng() * 3, 1 + rng() * 1.4, colors[2] + "65");
      if (kind === "furrows") for (let y = 3; y < 48; y += 6) { line(g, [[0, y], [48, y]], colors[2], 1.7, "butt"); line(g, [[0, y - 1], [48, y - 1]], colors[1] + "88", 0.7, "butt"); }
      if (kind === "wood") for (let y = 0; y < 48; y += 8) { line(g, [[0, y], [48, y]], colors[2], 1, "butt"); for (let x = (y % 16 ? 12 : 2); x < 48; x += 20) line(g, [[x, y], [x, y + 8]], colors[2], 0.8, "butt"); }
      if (kind === "flagstone") for (let y = 0; y < 48; y += 12) for (let x = (y % 24 ? -7 : 0); x < 48; x += 14) { g.strokeStyle = colors[2] + "aa"; g.lineWidth = u(0.7); g.strokeRect(u(x), u(y), u(13), u(11)); }
      if (kind === "cobble") for (let y = 2; y < 48; y += 7) for (let x = (y % 14 ? -2 : 2); x < 48; x += 8) ellipse(g, x, y, 3.4, 2.4, colors[(x + y) % 3 === 0 ? 1 : 0], colors[2], 0.55);
      if (kind === "moss") for (let i = 0; i < 13; i++) wrapEllipse(g, rng() * 48, rng() * 48, 2 + rng() * 3, 1 + rng() * 2, "#4e7547aa");
      if (kind === "leaves") for (let i = 0; i < 42; i++) { const x = rng() * 48, y = rng() * 48; ellipse(g, x, y, 1.1, 0.55, ["#be6c35", "#d0943f", "#7f4930"][i % 3]); }
      if (kind === "sand") for (let i = 0; i < 15; i++) line(g, [[rng() * 44, rng() * 48], [2 + rng() * 46, rng() * 48]], colors[2] + "55", 0.45);
      if (kind === "water") for (let y = 4; y < 48; y += 7) for (let x = (y % 14 ? -2 : 4); x < 48; x += 13) line(g, [[x, y], [x + 5, y - 0.8], [x + 9, y]], colors[1] + "aa", 0.9);
      return downsample(canvas).toDataURL("image/png");
    };
    const endpoints = { n: [24, -2], e: [50, 24], s: [24, 50], w: [-2, 24] };
    const routeSegments = (arms) => [...arms].map((arm) => [[24, 24], endpoints[arm]]);
    const drawRoute = ([name, arms, kind]) => {
      const canvas = makeCanvas(); const g = canvas.getContext("2d"); const rng = randomFor(name);
      if (kind === "square") {
        polygon(g, [[5, 12], [12, 5], [36, 5], [43, 12], [43, 36], [36, 43], [12, 43], [5, 36]], "#746f65", "#4b4e4a", 1.2);
        for (let y = 10; y < 42; y += 6) for (let x = 8 + (y % 12); x < 42; x += 8) ellipse(g, x, y, 3.1, 2.1, (x + y) % 3 ? "#969083" : "#5f625d", "#4d504c", 0.45);
        ellipse(g, 24, 24, 3, 3, "#b99657", "#594936", 0.8);
      } else if (kind === "bridge") {
        const vertical = arms === "ns";
        const a = vertical ? [[15, -2], [15, 50]] : [[-2, 15], [50, 15]];
        const b = vertical ? [[33, -2], [33, 50]] : [[-2, 33], [50, 33]];
        line(g, a, "#3d2b23aa", 3); line(g, b, "#3d2b23aa", 3);
        for (let p = -2; p <= 50; p += 4) {
          const points = vertical ? [[16, p], [32, p + (p % 8 ? 0.5 : -0.5)]] : [[p, 16], [p + (p % 8 ? 0.5 : -0.5), 32]];
          line(g, points, p % 8 ? "#a76f3e" : "#c08a4d", 3.6, "butt");
          line(g, points, "#5c3c29", 0.45, "butt");
        }
        line(g, a, "#d4a45d", 1); line(g, b, "#d4a45d", 1);
      } else {
        const segments = routeSegments(arms);
        const shadow = kind === "cobble" ? "#404844aa" : "#4d382b99";
        const base = kind === "cobble" ? "#777b73" : "#9b714c";
        const light = kind === "cobble" ? "#a7a89b" : "#c59b68";
        for (const segment of segments) line(g, segment, shadow, kind === "cobble" ? 14 : 17);
        for (const segment of segments) line(g, segment, base, kind === "cobble" ? 11.5 : 14.5);
        for (const segment of segments) line(g, segment, light + "99", kind === "cobble" ? 1.1 : 2.2);
        for (let i = 0; i < 24; i++) {
          const angle = rng() * Math.PI * 2, radius = rng() * 6;
          ellipse(g, 24 + Math.cos(angle) * radius, 24 + Math.sin(angle) * radius, 0.6 + rng(), 0.4 + rng() * 0.6, i % 2 ? light : shadow);
        }
      }
      return downsample(canvas).toDataURL("image/png");
    };
    const buildingBase = (g, roof, wall, wide = false) => {
      ellipse(g, 24, 40, wide ? 18 : 15, 4, "#18251d55");
      const x = wide ? 7 : 10, width = wide ? 34 : 28;
      rect(g, x, 21, width, 18, wall, "#493d34", 1);
      polygon(g, [[x - 2, 23], [24, 9], [x + width + 2, 23], [x + width - 2, 27], [24, 15], [x + 2, 27]], roof, "#49352f", 1.2);
      for (let sx = x + 3; sx < x + width - 2; sx += 5) line(g, [[sx, 23], [24, 11]], "#f0d69c33", 0.65);
      rect(g, 21, 29, 6, 10, "#594231", "#352d29", 0.8);
      rect(g, x + 4, 29, 5, 5, "#9fd0cf", "#594b3b", 0.8); rect(g, x + width - 9, 29, 5, 5, "#f0c978", "#594b3b", 0.8);
      line(g, [[x + 6.5, 29], [x + 6.5, 34]], "#e4eee6", 0.45); line(g, [[x + width - 6.5, 29], [x + width - 6.5, 34]], "#f8e5b3", 0.45);
    };
    const drawBuilding = ([, kind, roof, wall]) => {
      const canvas = makeCanvas(); const g = canvas.getContext("2d");
      if (["well", "fountain", "market", "windmill"].includes(kind)) ellipse(g, 24, 41, 15, 3.5, "#18251d55");
      if (kind === "well") {
        ellipse(g, 24, 30, 11, 5, "#6b7471", "#394545", 1.2); rect(g, 14, 29, 20, 8, wall, "#455052", 1); ellipse(g, 24, 29, 9, 3.5, "#203e4c", "#343d3d", 1);
        rect(g, 14, 15, 2.5, 15, "#714b30"); rect(g, 31.5, 15, 2.5, 15, "#714b30"); polygon(g, [[10, 17], [24, 9], [38, 17], [35, 20], [24, 14], [13, 20]], "#84503a", "#4a342a", 1);
      } else if (kind === "fountain") {
        ellipse(g, 24, 34, 15, 7, "#778c8d", "#455457", 1.2); ellipse(g, 24, 33, 11.5, 4.5, "#5ea6b2", "#c6e0d8", 0.8); rect(g, 22, 18, 4, 15, wall, "#4c595a", 0.8); ellipse(g, 24, 18, 6, 2.4, wall, "#4c595a", 0.8); line(g, [[24, 16], [20, 25]], "#a9e2ea", 1); line(g, [[24, 16], [28, 25]], "#a9e2ea", 1);
      } else if (kind === "market") {
        rect(g, 10, 24, 28, 14, "#7f5a3a", "#4a3528", 1); for (let x = 10; x < 38; x += 7) polygon(g, [[x, 18], [x + 7, 18], [x + 6, 27], [x + 1, 27]], x % 14 ? roof : wall, "#5a4032", 0.5);
        rect(g, 11, 14, 2, 24, "#65412c"); rect(g, 35, 14, 2, 24, "#65412c"); ellipse(g, 18, 31, 3, 2, "#d39743"); ellipse(g, 29, 31, 3, 2, "#6d9f53");
      } else if (kind === "windmill") {
        polygon(g, [[16, 39], [19, 14], [29, 14], [33, 39]], wall, "#4d4035", 1.1); polygon(g, [[16, 16], [24, 8], [31, 16]], roof, "#4d352d", 1); rect(g, 21, 29, 6, 10, "#5a4030", "#332c28", 0.8);
        ellipse(g, 25, 17, 2.2, 2.2, "#bb8c4d", "#4b3529", 0.7);
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 2) { const dx = Math.cos(angle), dy = Math.sin(angle); line(g, [[25 + dx * 2, 17 + dy * 2], [25 + dx * 16, 17 + dy * 16]], "#6f4d34", 1.4); polygon(g, [[25 + dx * 5 - dy * 1.5, 17 + dy * 5 + dx * 1.5], [25 + dx * 15 - dy * 2.8, 17 + dy * 15 + dx * 2.8], [25 + dx * 15 + dy * 2.8, 17 + dy * 15 - dx * 2.8], [25 + dx * 5 + dy * 1.5, 17 + dy * 5 - dx * 1.5]], "#d4bf8d88", "#684b34", 0.45); }
      } else {
        buildingBase(g, roof, wall, ["inn", "hall", "barn", "gatehouse"].includes(kind));
        if (kind === "thatch") for (let y = 15; y < 24; y += 2) line(g, [[11, y + 5], [24, y - 4], [37, y + 5]], "#e0bd6c99", 0.6);
        if (kind === "timber") { line(g, [[12, 23], [36, 39]], "#5a3e2f", 1); line(g, [[36, 23], [12, 39]], "#5a3e2f", 1); }
        if (kind === "inn") { rect(g, 37, 24, 2, 11, "#6e4930"); ellipse(g, 40, 27, 4, 3, "#c79b4c", "#5d432d", 0.7); }
        if (kind === "smithy") { rect(g, 31, 8, 5, 16, "#555354", "#37383a", 0.8); ellipse(g, 34, 7, 4, 2, "#6a6d70aa"); polygon(g, [[6, 36], [13, 31], [19, 36]], "#4e5355", "#313638", 1); }
        if (kind === "bakery") { polygon(g, [[9, 27], [39, 27], [36, 32], [12, 32]], "#efe1bd", "#71493b", 0.8); for (let x = 13; x < 36; x += 6) line(g, [[x, 28], [x + 2, 31]], "#b95f4d", 1.4); }
        if (kind === "apothecary") { ellipse(g, 39, 29, 3.5, 3.5, "#4b8357", "#31513a", 0.7); line(g, [[39, 27], [39, 31]], "#e7f0c8", 0.7); line(g, [[37, 29], [41, 29]], "#e7f0c8", 0.7); }
        if (kind === "chapel") { polygon(g, [[19, 15], [24, 4], [29, 15]], wall, "#4e4a42", 0.8); line(g, [[24, 4], [24, 0]], "#e4d6a0", 1); line(g, [[22, 2], [26, 2]], "#e4d6a0", 1); }
        if (kind === "hall") { ellipse(g, 24, 20, 4, 4, "#d7cfac", "#51463b", 0.8); line(g, [[24, 17], [24, 20], [26, 21]], "#4d443d", 0.65); }
        if (kind === "barn") { rect(g, 18, 28, 12, 11, "#774031", "#4b332c", 0.8); line(g, [[18, 28], [30, 39]], "#d39d68", 0.7); line(g, [[30, 28], [18, 39]], "#d39d68", 0.7); }
        if (kind === "gatehouse") { ellipse(g, 24, 34, 5, 7, "#252b2c"); polygon(g, [[5, 23], [12, 14], [18, 23]], roof, "#403c38", 0.8); polygon(g, [[30, 23], [36, 14], [43, 23]], roof, "#403c38", 0.8); }
      }
      return downsample(canvas).toDataURL("image/png");
    };
    const leafyTree = (g, dark, light, trunkX = 24, trunkY = 37, size = 1) => {
      ellipse(g, trunkX, 40, 11 * size, 3, "#18251d55"); rect(g, trunkX - 2.2 * size, 22, 4.4 * size, trunkY - 20, "#6d4931", "#3c352d", 0.7);
      const blobs = [[-8, -5, 8], [0, -10, 10], [9, -4, 8], [-3, 0, 10], [6, 2, 8]];
      for (const [x, y, r] of blobs) ellipse(g, trunkX + x * size, 21 + y * size, r * size, r * 0.78 * size, dark, "#27432e", 0.55);
      for (const [x, y, r] of [[-5, -7, 4], [3, -11, 5], [8, -3, 4], [-1, 1, 4]]) ellipse(g, trunkX + x * size, 20 + y * size, r * size, r * 0.65 * size, light + "cc");
    };
    const drawNature = ([name, kind, dark, light]) => {
      const canvas = makeCanvas(); const g = canvas.getContext("2d"); const rng = randomFor(name);
      if (["tree", "birch", "apple"].includes(kind)) { leafyTree(g, dark, light); if (kind === "birch") { rect(g, 22, 22, 4, 17, "#d9d7c5", "#51504a", 0.6); for (let y = 24; y < 38; y += 4) line(g, [[22, y], [25, y + 1]], "#4b4a45", 0.6); } if (kind === "apple") for (const p of [[16, 16], [24, 10], [31, 18], [21, 24], [29, 27]]) ellipse(g, p[0], p[1], 1.4, 1.4, "#c84f3f", "#74362f", 0.3); }
      else if (kind === "pine") { ellipse(g, 24, 42, 10, 3, "#18251d55"); rect(g, 22, 27, 4, 13, "#62462f"); for (const [y, w] of [[8, 7], [14, 11], [21, 15], [29, 18]]) polygon(g, [[24, y - 5], [24 - w, y + 12], [24 + w, y + 12]], y % 2 ? light : dark, "#1c3d30", 0.6); }
      else if (kind === "cluster") { leafyTree(g, dark, light, 17, 38, 0.72); leafyTree(g, dark, light, 32, 39, 0.67); leafyTree(g, dark, light, 25, 40, 0.82); }
      else if (kind === "hedge" || kind === "shrub") { ellipse(g, 24, 37, kind === "hedge" ? 17 : 11, 3, "#18251d55"); const count = kind === "hedge" ? 7 : 5; for (let i = 0; i < count; i++) ellipse(g, 12 + i * (24 / (count - 1)), 28 + (i % 2) * 2, kind === "hedge" ? 6 : 7, 7, i % 2 ? dark : light, "#2d5236", 0.5); if (kind === "hedge") for (let i = 0; i < 7; i++) ellipse(g, 12 + rng() * 24, 23 + rng() * 8, 0.8, 0.8, i % 2 ? "#eac2d2" : "#f0df8e"); }
      else if (kind === "flowers") for (let i = 0; i < 18; i++) { const x = 10 + rng() * 28, y = 22 + rng() * 17; line(g, [[x, y + 3], [x, y]], "#4d7b42", 0.55); ellipse(g, x, y, 1.1, 1.1, i % 2 ? dark : light); }
      else if (kind === "tuft") for (let i = 0; i < 10; i++) { const x = 12 + rng() * 24, y = 28 + rng() * 10; line(g, [[x, y + 4], [x - 2 + rng() * 4, y]], i % 2 ? dark : light, 0.8); }
      else if (kind === "leaves") for (let i = 0; i < 20; i++) { const x = 9 + rng() * 30, y = 24 + rng() * 14; ellipse(g, x, y, 1.7, 0.8, i % 2 ? dark : light); }
      else if (kind === "boulder") { ellipse(g, 24, 39, 13, 3, "#18251d55"); polygon(g, [[10, 36], [14, 22], [24, 15], [36, 22], [40, 35], [31, 40], [17, 40]], dark, "#3f4b49", 1); polygon(g, [[14, 25], [24, 17], [33, 23], [23, 27]], light, null); ellipse(g, 19, 25, 5, 2, "#5d814f88"); }
      else if (kind === "stump") { ellipse(g, 24, 39, 10, 3, "#18251d55"); rect(g, 17, 25, 14, 13, dark, "#4b3429", 1); ellipse(g, 24, 25, 8, 3.5, light, "#4f3526", 0.9); ellipse(g, 24, 25, 4, 1.8, "#8b5f3a", "#60422d", 0.5); }
      else if (kind === "woodpile") { ellipse(g, 24, 39, 14, 3, "#18251d55"); for (let y = 25; y < 37; y += 5) for (let x = 13 + (y % 10); x < 35; x += 7) { rect(g, x, y, 14, 3.5, dark, "#4a3228", 0.5); ellipse(g, x + 14, y + 1.7, 1.8, 1.7, light, "#4a3228", 0.4); } }
      else if (kind === "scarecrow") { ellipse(g, 24, 41, 8, 2, "#18251d55"); line(g, [[24, 16], [24, 40]], dark, 2); line(g, [[11, 25], [37, 25]], dark, 2); ellipse(g, 24, 14, 5, 5, light, "#4a392b", 0.7); polygon(g, [[16, 11], [24, 6], [32, 11]], "#7c5131", "#4b3529", 0.7); polygon(g, [[17, 22], [31, 22], [34, 35], [14, 35]], "#806b45", "#4b4032", 0.7); }
      else if (kind === "sign") { ellipse(g, 24, 41, 7, 2, "#18251d55"); rect(g, 22, 17, 4, 23, dark, "#4a352a", 0.7); polygon(g, [[8, 15], [36, 15], [41, 21], [36, 27], [8, 27]], light, "#4b3428", 1); line(g, [[13, 21], [32, 21]], "#6a452d", 1); }
      return downsample(canvas).toDataURL("image/png");
    };
    const drawBoundary = ([, arms, kind]) => {
      const canvas = makeCanvas(); const g = canvas.getContext("2d");
      if (kind === "wall") {
        const vertical = arms === "ns";
        const base = vertical ? [17, -2, 14, 52] : [-2, 17, 52, 14];
        rect(g, ...base, "#6b7471", "#3f4949", 1);
        for (let p = 0; p < 48; p += 7) {
          if (vertical) { line(g, [[17, p], [31, p + 2]], "#a8a492", 0.7); line(g, [[24, p], [24, p + 7]], "#4c5655", 0.55); }
          else { line(g, [[p, 17], [p + 2, 31]], "#a8a492", 0.7); line(g, [[p, 24], [p + 7, 24]], "#4c5655", 0.55); }
        }
      } else if (kind === "arch") {
        for (let x = -2; x < 52; x += 5) { line(g, [[x, 20], [x, 28]], x % 10 ? "#39663d" : "#5f8a4e", 5); }
        g.globalCompositeOperation = "destination-out"; ellipse(g, 24, 29, 7, 10, "#000"); rect(g, 17, 28, 14, 14, "#000"); g.globalCompositeOperation = "source-over";
        line(g, [[17, 37], [17, 24], [24, 17], [31, 24], [31, 37]], "#725039", 2.2);
      } else if (kind === "gate") {
        const vertical = arms === "ns";
        if (vertical) {
          line(g, [[24, -2], [24, 15]], "#714b31", 2.2); line(g, [[24, 33], [24, 50]], "#714b31", 2.2);
          line(g, [[20, 15], [20, 33]], "#4d382d", 2.5); line(g, [[28, 15], [28, 33]], "#4d382d", 2.5); line(g, [[20, 16], [28, 16]], "#b1814f", 2);
        } else {
          line(g, [[-2, 24], [15, 24]], "#714b31", 2.2); line(g, [[33, 24], [50, 24]], "#714b31", 2.2);
          line(g, [[15, 20], [33, 20]], "#4d382d", 2.5); line(g, [[15, 28], [33, 28]], "#4d382d", 2.5); line(g, [[16, 20], [16, 28]], "#b1814f", 2);
        }
      } else {
        for (const segment of routeSegments(arms)) { line(g, segment, "#4a352b99", 3.5); line(g, segment, "#9b6b3f", 2); line(g, segment, "#d2a260", 0.55); }
        for (const arm of arms) {
          const [ex, ey] = endpoints[arm];
          for (const t of [0.18, 0.5, 0.82]) { const x = 24 + (ex - 24) * t, y = 24 + (ey - 24) * t; line(g, [[x, y - 3], [x, y + 3]], "#5a3c2c", 1.5); ellipse(g, x, y - 3, 1.2, 0.8, "#bd8950"); }
        }
        line(g, [[24, 20], [24, 28]], "#5a3c2c", 1.7); ellipse(g, 24, 20, 1.3, 0.8, "#bd8950");
      }
      return downsample(canvas).toDataURL("image/png");
    };
    const images = {};
    grounds.forEach((def) => { images[def[0]] = drawGround(def); });
    routes.forEach((def) => { images[def[0]] = drawRoute(def); });
    buildings.forEach((def) => { images[def[0]] = drawBuilding(def); });
    nature.forEach((def) => { images[def[0]] = drawNature(def); });
    boundaries.forEach((def) => { images[def[0]] = drawBoundary(def); });

    const entries = Object.entries(images);
    const preview = makeCanvas(tileSize * 10, tileSize * 8);
    const pg = preview.getContext("2d");
    pg.fillStyle = "#253a2e"; pg.fillRect(0, 0, preview.width, preview.height);
    const meadow = entries[0][1];
    return Promise.all(entries.map(async ([name, src]) => {
      const image = new Image(); image.src = src; await image.decode(); return [name, image];
    })).then(async (loaded) => {
      const meadowImage = new Image(); meadowImage.src = meadow; await meadowImage.decode();
      loaded.forEach(([, image], index) => {
        const x = (index % 10) * tileSize, y = Math.floor(index / 10) * tileSize;
        if (index >= grounds.length) pg.drawImage(meadowImage, x, y);
        pg.drawImage(image, x, y);
      });
      const scaled = makeCanvas(preview.width * 3, preview.height * 3);
      const sg = scaled.getContext("2d"); sg.imageSmoothingEnabled = false;
      sg.drawImage(preview, 0, 0, scaled.width, scaled.height);
      return {
        images: Object.fromEntries(entries),
        preview: scaled.toDataURL("image/png"),
      };
    });
  }, { tileSize: TILE, grounds, routes, buildings, nature, boundaries });
  await browser.close();
  return result;
}

function categoryFor(name) {
  if (grounds.some(([item]) => item === name)) return "grounds";
  if (routes.some(([item]) => item === name)) return "routes";
  if (buildings.some(([item]) => item === name)) return "buildings";
  if (nature.some(([item]) => item === name)) return "nature";
  return "boundaries";
}

const rendered = await renderPack();
const files = [];
for (const [name, dataUrl] of Object.entries(rendered.images)) {
  const filename = "tilesets." + name + ".png";
  writeFileSync(join(outDir, filename), Buffer.from(dataUrl.split(",")[1], "base64"));
  files.push({
    type: "tilesets",
    name,
    url: packId + "/" + filename,
    tags: ["village", "outdoors", categoryFor(name), "deluxe"],
  });
}
writeFileSync(join(outDir, "preview.png"), Buffer.from(rendered.preview.split(",")[1], "base64"));

let registry = { packs: [] };
try { registry = JSON.parse(readFileSync(registryPath, "utf8")); } catch { /* first build */ }
const pack = {
  id: packId,
  name: "Village & Countryside Deluxe",
  desc: "Eighty richly layered 48px tiles for complete outdoor maps: seamless village grounds, modular paths and bridges, sixteen buildings, trees and props, plus a full fence, wall, and gate kit. Original RPGAtlas art - CC0, no attribution needed.",
  license: "CC0",
  version: 1,
  preview: packId + "/preview.png",
  files,
};
registry.packs = [...(Array.isArray(registry.packs) ? registry.packs : []).filter((item) => item.id !== packId), pack];
writeFileSync(registryPath, JSON.stringify(registry, null, 1));
console.log("Village & Countryside Deluxe: " + files.length + " tiles -> " + outDir);
