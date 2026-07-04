/* RPGAtlas — scripts/build-atlas-quest-advanced.mjs
   Phase 8 Stage G: adds the Advanced Map Editor showcase to the bundled
   sample game (Atlas_Quest.json). Deterministic and idempotent, same recipe
   as build-atlas-quest-hd.mjs — rerunning produces byte-identical output.

   Meridian Village (map 1) stays FROZEN (renderer goldens render its exact
   tiles); the showcase is a brand-new map 5, "Meridian Village — Advanced":
   the same village layout upgraded with everything Phase 8 shipped that a
   pure-JSON project can carry —
     - a generalized layer stack (map.layersAdv): the four core layers plus an
       "Atmosphere" group holding an add-blend Lantern Glow and a translucent
       tinted Evening Haze overhead;
     - gameplay zones of six kinds (encounter / weather / sound / transfer /
       collision / nav / custom across rect, ellipse, point, and poly shapes);
     - two automap rules (reeds ring the pond, wildflowers along the path)
       ready to Preview/Apply in the Advanced panel's Automap drawer;
     - a reusable stamp in the project library (proj.stamps).
   Terrain Studio terrains are the one Phase 8 feature not represented: they
   resolve against imported sheet assets, and the sample project is 100%
   procedural (no embedded images) — the showcase Sign points there instead.
   GPL-3.0-or-later. */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const file = join(root, "Atlas_Quest.json");
const project = JSON.parse(readFileSync(file, "utf8"));

// Procedural tile ids (js/assets.js defTile order).
const T = { grass: 1, flowers: 2, sand: 5, path: 6, water: 7, deepwater: 8, bush: 17, rock: 18 };

const village = project.maps.find((m) => m.id === 1);
const W = village.width, H = village.height, size = W * H;
const at = (x, y) => y * W + x;
const copy = (v) => JSON.parse(JSON.stringify(v));
const zeros = () => new Array(size).fill(0);

// ---- the generalized layer stack -----------------------------------------
// Lantern Glow: warm add-blend patches around the two doorways and the save
// crystal (sand's tan reads as light at add-blend 0.45).
const glow = zeros();
for (const [cx, cy] of [[6, 4], [17, 6], [14, 10]]) {
  for (let y = cy - 1; y <= cy + 1; y++) {
    for (let x = cx - 1; x <= cx + 1; x++) glow[at(x, y)] = T.sand;
  }
}
// Evening Haze: a translucent, cool-tinted band across the northern tree line,
// drawn in the "above" slot so it also washes over anyone walking there.
const haze = zeros();
for (let y = 0; y < 2; y++) for (let x = 0; x < W; x++) haze[at(x, y)] = T.deepwater;

const layersAdv = [
  { id: 1, name: "Ground", type: "core", role: "ground" },
  { id: 2, name: "Decor", type: "core", role: "decor" },
  { id: 3, name: "Decor 2", type: "core", role: "decor2" },
  { id: 6, name: "Atmosphere", type: "group", children: [
    { id: 4, name: "Lantern Glow", type: "tile", slot: "below", blend: "add", opacity: 0.45, data: glow },
    { id: 5, name: "Evening Haze", type: "tile", slot: "above", opacity: 0.25, tint: "#9db4ff", data: haze },
  ] },
  { id: 7, name: "Overhead", type: "core", role: "over" },
];

// ---- gameplay zones (one of every kind; every shape) ----------------------
const zones = [
  { id: 1, name: "Wild meadow", kind: "encounter",
    shape: { type: "rect", x: 14, y: 10, w: 8, h: 5 },
    encounter: { troops: [1, 5], rate: 14 } },
  { id: 2, name: "Rain cloud over the pond", kind: "weather",
    shape: { type: "rect", x: 1, y: 10, w: 10, h: 6 },
    weather: { kind: "rain", power: 5 } },
  { id: 3, name: "Pond ambience (add your own audio!)", kind: "sound",
    shape: { type: "ellipse", cx: 4, cy: 12, rx: 3, ry: 2.5 },
    sound: { key: "", vol: 1, falloff: "linear" } },
  { id: 4, name: "Back to classic Meridian", kind: "transfer",
    shape: { type: "point", x: 12, y: 15 },
    transfer: { mapId: 1, x: 12, y: 12, dir: 0 } },
  { id: 5, name: "Keep off the flowers!", kind: "collision",
    shape: { type: "rect", x: 19, y: 8, w: 4, h: 1 } },
  { id: 6, name: "Stepping stones", kind: "nav",
    shape: { type: "rect", x: 4, y: 11, w: 1, h: 4 } },
  { id: 7, name: "Village plaza", kind: "custom",
    shape: { type: "poly", pts: [{ x: 13, y: 9 }, { x: 17, y: 9 }, { x: 17, y: 12 }, { x: 13, y: 12 }] },
    props: { note: "Read me from plugins or Script: atlas.zonesAt(x, y)" } },
];

// ---- automap rules (Preview/Apply them from the Automap drawer) ------------
const automapRules = [
  { id: 1, name: "Reeds ring the pond", enabled: true, seed: 773377,
    if: [
      { kind: "tileIs", layerId: "core:ground", tile: T.grass },
      { kind: "near", terrain: T.water, radius: 1 },
    ],
    then: [{ kind: "placeTile", layerId: "core:decor", tile: T.bush, probability: 0.35 }] },
  { id: 2, name: "Wildflowers along the path", enabled: true, seed: 424242,
    if: [
      { kind: "tileIs", layerId: "core:ground", tile: T.grass },
      { kind: "near", terrain: T.path, radius: 1 },
      { kind: "notNear", terrain: T.water, radius: 2 },
    ],
    then: [{ kind: "placeTile", layerId: "core:ground", tile: T.flowers, probability: 0.15 }] },
];

// ---- the map itself --------------------------------------------------------
const advanced = {
  id: 5, name: "Meridian Village — Advanced",
  width: W, height: H,
  tilesetId: 1,
  music: village.music,
  encounters: { troops: [], rate: 0 }, // the meadow zone supplies the battles
  layers: copy(village.layers),
  layersAdv,
  zones,
  automapRules,
  shadows: copy(village.shadows),
  passOv: copy(village.passOv),
  heights: copy(village.heights),
  regions: village.regions ? copy(village.regions) : zeros(),
  lights: copy(village.lights),
  hd2d: copy(village.hd2d),
  events: [
    { id: 1, name: "Showcase Sign", x: 11, y: 8,
      pages: [{
        name: "",
        cond: { switchId: 0, varId: 0, varVal: 0, selfSw: "", questId: 0, questStatus: "active",
          objectiveQuestId: 0, objectiveIndex: 0, objectiveStatus: "completed" },
        charset: "sign", dir: 0, moveType: "fixed", trigger: "action", priority: "same", through: false,
        combat: { enabled: false, enemyId: 0, hp: 0, touchDamage: 0, knockbackTiles: 1,
          invulnFrames: 24, defeatSelfSwitch: "" },
        commands: [{ t: "text", name: "",
          text: "— Meridian Village: Advanced —\nOpen this map with F4 to explore layers,\nzones, stamps, and Automap rules.\n(Terrain Studio lives on the Advanced menu.)" }],
      }] },
  ],
};

const existing = project.maps.findIndex((m) => m.id === 5);
if (existing >= 0) project.maps[existing] = advanced;
else project.maps.push(advanced);

// ---- one reusable stamp in the project library -----------------------------
const stamp = {
  id: 1, name: "Rock cluster", w: 2, h: 2,
  layers: { decor: [T.rock, 0, 0, T.bush] },
  tags: ["nature"],
};
// Replace-by-id keeps reruns idempotent without disturbing any other stamps.
project.stamps = [...(project.stamps || []).filter((s) => s.id !== 1), stamp];

// The committed file uses LF, indent 1, and no trailing newline.
writeFileSync(file, JSON.stringify(project, null, 1));
console.log("[atlas-quest-advanced] wrote " + file + " (" + project.maps.length + " maps, " +
  project.stamps.length + " stamps)");
