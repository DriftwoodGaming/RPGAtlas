/* RPGAtlas — scripts/build-starter-pack.mjs
   Regenerates the bundled "Driftwood Starter" asset pack (Phase 6 Stage E):
   real PNG/WAV files rendered from the engine's own procedural generators, so
   the pack is license-clean (project-generated, CC0-dedicated) and works
   offline. Images render through js/assets.js inside headless Chromium (the
   repo's Playwright dependency); audio is synthesized directly in Node as
   16-bit PCM WAV. Output: img/packs/driftwood-starter/* + img/packs/index.json.

   Run: node scripts/build-starter-pack.mjs
   GPL-3.0-or-later (see LICENSE). */

import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "img", "packs", "driftwood-starter");
mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------------------
// Images via js/assets.js in headless Chromium
// ---------------------------------------------------------------------------

async function renderImages() {
  const assetsJs = readFileSync(join(root, "js", "assets.js"), "utf8");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<!DOCTYPE html><html><body></body></html>");
  await page.addScriptTag({ content: assetsJs });

  const images = await page.evaluate(() => {
    const A = window.Assets;
    const out = {};
    const dataUrl = (canvas) => canvas.toDataURL("image/png");
    const recolor = (src, hue, sat = 1, bright = 1) => {
      const c = document.createElement("canvas");
      c.width = src.width;
      c.height = src.height;
      const g = c.getContext("2d");
      g.imageSmoothingEnabled = false;
      g.filter = `hue-rotate(${hue}deg) saturate(${sat}) brightness(${bright})`;
      g.drawImage(src, 0, 0);
      return c;
    };

    // --- tiles: hue-shifted takes on the walkable terrain set -------------
    const tileByName = (name) => {
      const i = A.tiles.findIndex((t) => t && t.name === name);
      return i > 0 ? A.tileCanvas(i) : null;
    };
    const tilePlan = [
      ["Grass", "autumn-grass.terrain", 300, 0.9, 1.0],
      ["Grass", "ashen-grass.terrain", 0, 0.15, 0.9],
      ["Grass", "spring-grass.terrain", 40, 1.25, 1.1],
      ["Flowers", "autumn-flowers.pass", 300, 0.95, 1.0],
      ["Flowers", "frost-flowers.pass", 180, 0.8, 1.15],
      ["Tall Grass", "crimson-tallgrass.pass", 260, 1.0, 0.95],
      ["Tall Grass", "golden-tallgrass.pass", 45, 1.2, 1.1],
      ["Sand", "ash-dunes.terrain", 0, 0.2, 0.8],
      ["Sand", "rose-dunes.terrain", 320, 0.7, 1.0],
      ["Stone Path", "moss-path.pass", 90, 0.8, 0.95],
      ["Stone Path", "sun-path.pass", 40, 1.0, 1.15],
      ["Water", "abyss-water", 260, 1.1, 0.75],
    ];
    for (const [src, name, hue, sat, bright] of tilePlan) {
      const canvas = tileByName(src);
      if (canvas) out["tilesets/" + name + ".png"] = dataUrl(recolor(canvas, hue, sat, bright));
    }

    // --- charsets: four generated villagers via the chargen pipeline ------
    const villagers = [
      ["pack-villager-rose", { skin: "#e8b88a", hair: "#7a4a2a", style: "long", shirt: "#c05070", pants: "#3a4a6a", hat: "#7a3a4a" }],
      ["pack-villager-moss", { skin: "#c99a6b", hair: "#2a2a2a", style: "short", shirt: "#4a7a3a", pants: "#5a4a3a", hat: "#3a5a2a" }],
      ["pack-villager-sky", { skin: "#f0c8a0", hair: "#c0a040", style: "spiky", shirt: "#4a7ac0", pants: "#2a3a5a", hat: "#3a5a8a" }],
      ["pack-elder-dune", { skin: "#a97a4b", hair: "#d8d8d8", style: "bald", shirt: "#8a6a3a", pants: "#4a3a2a", hat: "#6a5a3a" }],
    ];
    for (const [name, params] of villagers) {
      const idx = A.registerHuman("pack_" + name, name, params);
      out["characters/" + name + ".png"] = dataUrl(A.charSheetCanvas(idx));
    }

    // --- battlers: recolored takes on three procedural enemies ------------
    const battlers = [
      ["frost-slime", "slime", "#7ac0e8"],
      ["ember-wolf", "wolf", "#e07a40"],
      ["gloom-golem", "golem", "#6a5a8a"],
    ];
    for (const [name, type, color] of battlers) {
      out["enemies/" + name + ".png"] = dataUrl(A.enemyCanvas(type, color, 264));
    }
    return out;
  });

  await browser.close();
  return images;
}

// ---------------------------------------------------------------------------
// Audio: 16-bit PCM WAV chiptunes in plain Node
// ---------------------------------------------------------------------------

const RATE = 22050;

function wav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  }
  return buf;
}

const noteFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Additive square/triangle voice with linear decay, mixed into `mix`. */
function tone(mix, startSec, durSec, freq, vol, shape) {
  const start = Math.floor(startSec * RATE);
  const n = Math.min(mix.length - start, Math.floor(durSec * RATE));
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const phase = (t * freq) % 1;
    const raw = shape === "triangle" ? 1 - 4 * Math.abs(phase - 0.5) : phase < 0.5 ? 1 : -1;
    mix[start + i] += raw * vol * (1 - i / n);
  }
}

/** Seeded 16-step chiptune loop in a pentatonic scale (same spirit as the
 *  engine's generative themes, but bounced to a fixed loop). */
function themeLoop({ seconds, tempo, root, scale, seed, lead, density, drums }) {
  const mix = new Float64Array(Math.floor(seconds * RATE));
  const step = 60 / tempo / 2;
  const steps = Math.floor(seconds / step);
  const rng = mulberry(seed);
  let pos = scale.length;
  const prog = [0, 0, -4, -2];
  for (let s = 0; s < steps; s++) {
    const t = s * step;
    if (s % 4 === 0) tone(mix, t, step * 3, noteFreq(root - 12 + prog[Math.floor(s / 16) % 4]), 0.16, "triangle");
    if (drums && s % 4 === 0) {
      const start = Math.floor(t * RATE);
      const rn = mulberry(s + 1);
      for (let i = 0; i < RATE * 0.05 && start + i < mix.length; i++) mix[start + i] += (rn() * 2 - 1) * 0.12 * (1 - i / (RATE * 0.05));
    }
    if (rng() < density) {
      const move = Math.floor(rng() * 5) - 2;
      pos = Math.max(0, Math.min(scale.length * 2 - 1, pos + move));
      const deg = scale[pos % scale.length] + 12 * Math.floor(pos / scale.length);
      tone(mix, t, step * 1.6, noteFreq(root + 12 + deg), 0.11, lead);
    }
  }
  // Gentle loop seam: fade the last 30ms into the first 30ms level.
  const seam = Math.floor(RATE * 0.03);
  for (let i = 0; i < seam; i++) mix[mix.length - seam + i] *= 1 - i / seam;
  return mix;
}

function rainLoop(seconds) {
  const mix = new Float64Array(Math.floor(seconds * RATE));
  const rng = mulberry(777);
  let lp = 0;
  for (let i = 0; i < mix.length; i++) {
    lp += ((rng() * 2 - 1) - lp) * 0.25; // one-pole low-pass noise
    mix[i] = lp * 0.5;
  }
  // droplets
  for (let d = 0; d < seconds * 14; d++) {
    const at = Math.floor(rng() * (mix.length - RATE * 0.02));
    for (let i = 0; i < RATE * 0.015; i++) mix[at + i] += Math.sin(i / 18) * 0.12 * (1 - i / (RATE * 0.015));
  }
  const seam = Math.floor(RATE * 0.05);
  for (let i = 0; i < seam; i++) {
    const w = i / seam;
    mix[i] = mix[i] * w + mix[mix.length - seam + i] * (1 - w);
  }
  return mix;
}

function fanfare() {
  const mix = new Float64Array(Math.floor(1.8 * RATE));
  const notes = [60, 64, 67, 72, 72, 71, 72];
  const at = [0, 0.12, 0.24, 0.36, 0.72, 0.84, 0.96];
  notes.forEach((n, i) => {
    tone(mix, at[i], i >= 4 ? 0.5 : 0.16, noteFreq(n), 0.2, "square");
    tone(mix, at[i], i >= 4 ? 0.5 : 0.16, noteFreq(n - 12), 0.1, "triangle");
  });
  return mix;
}

function chime() {
  const mix = new Float64Array(Math.floor(0.5 * RATE));
  tone(mix, 0, 0.5, noteFreq(84), 0.18, "triangle");
  tone(mix, 0.06, 0.44, noteFreq(88), 0.12, "triangle");
  return mix;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const images = await renderImages();
const files = [];

for (const [rel, dataUrl] of Object.entries(images)) {
  const [type, file] = rel.split("/");
  const name = file.replace(/\.png$/, "");
  writeFileSync(join(outDir, type + "." + file), Buffer.from(dataUrl.split(",")[1], "base64"));
  // Registry-relative URLs: the Packs tab resolves them against the
  // registry's own location, so remote registries can host files beside
  // their index.json the same way.
  files.push({ type, name, url: "driftwood-starter/" + type + "." + file });
}

const audio = [
  ["driftwood-theme", "bgm", themeLoop({ seconds: 7.5, tempo: 104, root: 60, scale: [0, 2, 4, 7, 9], seed: 23, lead: "square", density: 0.6 })],
  ["deepwood-theme", "bgm", themeLoop({ seconds: 7.5, tempo: 84, root: 55, scale: [0, 3, 5, 7, 10], seed: 11, lead: "triangle", density: 0.5 })],
  ["rain-ambience", "bgs", rainLoop(6)],
  ["victory-fanfare", "me", fanfare()],
  ["signal-chime", "se", chime()],
];
for (const [name, kind, samples] of audio) {
  writeFileSync(join(outDir, "audio." + name + ".wav"), wav(samples));
  files.push({ type: "audio", name, kind, url: "driftwood-starter/audio." + name + ".wav" });
}

const registryPath = join(root, "img", "packs", "index.json");
let index = { packs: [] };
try { index = JSON.parse(readFileSync(registryPath, "utf8")); } catch { /* first build */ }
const pack = {
  id: "driftwood-starter",
  name: "Driftwood Starter",
  desc: "HD-2D-ready terrain recolors, four generated villagers, three battlers, and a small chiptune soundtrack (two loops, rain ambience, a victory fanfare, and a chime). Generated from RPGAtlas's own procedural art — CC0, no attribution needed.",
  license: "CC0",
  version: 1,
  files,
};
index.packs = [pack, ...(Array.isArray(index.packs) ? index.packs : []).filter((item) => item.id !== pack.id)];
writeFileSync(registryPath, JSON.stringify(index, null, 1));
console.log("Driftwood Starter: " + files.length + " files → img/packs/driftwood-starter/");
