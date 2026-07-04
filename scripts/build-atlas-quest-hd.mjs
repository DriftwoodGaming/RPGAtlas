/* RPGAtlas — scripts/build-atlas-quest-hd.mjs
   Phase 7 Stage D: upgrades the bundled sample game (Atlas_Quest.json) into
   the "Atlas Quest HD" showcase. Deterministic and idempotent — rerunning
   produces byte-identical output, like build-starter-pack.mjs.

   HARD CONSTRAINT — Meridian Village (map 1) is visually FROZEN: the
   renderer golden images (tests-e2e/renderer-golden.spec.mjs) render that
   map's own tiles/heights/lights/events, so the showcase upgrades live in
   the Whispering Cave (already HD-dressed in Phase 2; gains crystal lights +
   a new exit), the Cottage (full interior treatment), and a brand-new
   flagship map: Driftwood Shore — dusk day/night sun, animated water with a
   dock, auto-textured cliffs, materials, bloom/ACES/warm grade/vignette/
   SSAO/FXAA, soft drop shadows, and lantern point lights, reached through a
   back passage in the cave. The quest chain, battles, and start position are
   untouched, so the playthrough e2e stays green. GPL-3.0-or-later. */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const file = join(root, "Atlas_Quest.json");
const project = JSON.parse(readFileSync(file, "utf8"));

// Procedural tile ids (js/assets.js defTile order).
const T = {
  grass: 1, flowers: 2, tallgrass: 3, dirt: 4, sand: 5, path: 6,
  water: 7, deepwater: 8, bridge: 13, tree: 15, pine: 16, bush: 17, rock: 18,
};

const mapById = (id) => project.maps.find((m) => m.id === id);

/** Deterministic LCG (same recipe as the stress spec). */
function makeRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function eventPage(overrides) {
  return Object.assign({
    name: "",
    cond: { switchId: 0, varId: 0, varVal: 0, selfSw: "", questId: 0, questStatus: "active",
      objectiveQuestId: 0, objectiveIndex: 0, objectiveStatus: "completed" },
    charset: "", dir: 0, moveType: "fixed", trigger: "action", priority: "same", through: false,
    combat: { enabled: false, enemyId: 0, hp: 0, touchDamage: 0, knockbackTiles: 1,
      invulnFrames: 24, defeatSelfSwitch: "" },
    commands: [],
  }, overrides);
}

// --------------------------------------------------------------------------
// Whispering Cave (map 2): two extra crystal glows + the shore passage.
// --------------------------------------------------------------------------
{
  const cave = mapById(2);
  cave.hd2d = Object.assign({}, cave.hd2d, { ssao: true, aces: true });
  const extraLights = [
    { rx: 12, ry: 4, color: "#66ffe0", radius: 200 },
    { rx: 5, ry: 7, color: "#bb88ff", radius: 190 },
  ];
  for (const light of extraLights) {
    if (!cave.lights.some((l) => l.rx === light.rx && l.ry === light.ry)) cave.lights.push(light);
  }
  // Open the east wall at (15,10) and place the touch-transfer to the shore.
  cave.layers.decor[10 * cave.width + 15] = 0;
  cave.events = cave.events.filter((e) => e.name !== "To the Shore");
  cave.events.push({
    id: Math.max(...cave.events.map((e) => e.id)) + 1,
    name: "To the Shore", x: 15, y: 10,
    pages: [eventPage({
      trigger: "touch", priority: "below", through: true,
      commands: [
        { t: "script", code: "if (window.Atlas) Atlas.transition = 'fade';" },
        { t: "transfer", mapId: 4, x: 1, y: 5, dir: 1 },
      ],
    })],
  });
}

// --------------------------------------------------------------------------
// Cottage (map 3): warm HD-2D interior — firelight, window light, materials.
// --------------------------------------------------------------------------
{
  const cottage = mapById(3);
  cottage.hd2d = {
    enabled: true, tilt: 48, lights: true, ambient: 0.32,
    materials: true, dropShadows: true, vignette: true, aces: true, fxaa: true,
  };
  cottage.lights = [
    { rx: 2.5, ry: 3, color: "#ffb060", radius: 250 },
    { rx: 7, ry: 2.5, color: "#88bbff", radius: 170 },
  ];
}

// --------------------------------------------------------------------------
// Driftwood Shore (map 4): the flagship HD-2D showcase map.
// --------------------------------------------------------------------------
{
  const W = 24, H = 14, size = W * H;
  const ground = new Array(size).fill(T.grass);
  const decor = new Array(size).fill(0);
  const heights = new Array(size).fill(0);
  const at = (x, y) => y * W + x;

  for (let x = 0; x < W; x++) {
    heights[at(x, 0)] = 3; heights[at(x, 1)] = 3; heights[at(x, 2)] = 2; // cliff ridge
    for (let y = 7; y <= 9; y++) ground[at(x, y)] = T.sand;
    for (let y = 10; y <= 11; y++) ground[at(x, y)] = T.water;
    for (let y = 12; y < H; y++) ground[at(x, y)] = T.deepwater;
  }
  // Path from the cave mouth east along the grass, then down to the beach.
  for (let x = 0; x <= 10; x++) ground[at(x, 5)] = T.path;
  for (let y = 6; y <= 7; y++) ground[at(10, y)] = T.path;
  // The dock: a bridge run out over the water, lantern-lit at the end.
  for (let y = 9; y <= 12; y++) ground[at(16, y)] = T.bridge;
  // Deterministic greenery: pines/bushes on grass, driftwood rocks on sand.
  const rand = makeRand(773377);
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < W; x++) {
      if (ground[at(x, y)] !== T.grass || (y === 4 || y === 6)) continue; // keep the path shoulder clear
      const r = rand();
      if (r < 0.14) decor[at(x, y)] = T.pine;
      else if (r < 0.2) decor[at(x, y)] = T.bush;
      else if (r < 0.3) ground[at(x, y)] = rand() < 0.5 ? T.flowers : T.tallgrass;
    }
  }
  for (let y = 7; y <= 9; y++) {
    for (let x = 0; x < W; x++) {
      if (ground[at(x, y)] === T.sand && x !== 10 && x !== 16 && rand() < 0.06) {
        decor[at(x, y)] = T.rock;
      }
    }
  }

  const shore = {
    id: 4, name: "Driftwood Shore", width: W, height: H,
    layers: { ground, decor, decor2: new Array(size).fill(0), over: new Array(size).fill(0) },
    heights, shadows: new Array(size).fill(0), passOv: new Array(size).fill(0),
    music: "field",
    encounters: { troops: [], rate: 0 },
    lights: [
      { rx: 4, ry: 6.5, color: "#ffcc88", radius: 260 },
      { rx: 10, ry: 6.5, color: "#ffcc88", radius: 260 },
      { rx: 16.5, ry: 11.5, color: "#ffd890", radius: 300 },
      { rx: 20, ry: 10.5, color: "#88bbff", radius: 240 },
    ],
    hd2d: {
      enabled: true, tilt: 52, lights: true, ambient: 0.5,
      shadows: true, water: true, materials: true, cliffs: true, dropShadows: true,
      dayNight: true, timeOfDay: 17.2,
      bloom: true, ssao: true, aces: true, vignette: true, lut: "warm", fxaa: true,
      fog: { color: "#241a26" },
    },
    events: [
      { id: 1, name: "To the Cave", x: 0, y: 5,
        pages: [eventPage({
          trigger: "touch", priority: "below", through: true,
          commands: [
            { t: "script", code: "if (window.Atlas) Atlas.transition = 'fade';" },
            { t: "transfer", mapId: 2, x: 14, y: 10, dir: 3 },
          ],
        })] },
      { id: 2, name: "Sign", x: 2, y: 4,
        pages: [eventPage({
          charset: "sign",
          commands: [{ t: "text", name: "", text: "— Driftwood Shore —\nThe tide glows at dusk." }],
        })] },
      { id: 3, name: "Old Fisherman", x: 8, y: 8,
        pages: [eventPage({
          charset: "villager", moveType: "random",
          commands: [{ t: "text", name: "Old Fisherman",
            text: "Prettiest hour of the day, this.\nThe sun sinks, the lanterns wake,\nand the whole sea turns to gold." }],
        })] },
    ],
  };

  const existing = project.maps.findIndex((m) => m.id === 4);
  if (existing >= 0) project.maps[existing] = shore;
  else project.maps.push(shore);
}

// The committed file uses LF, indent 1, and no trailing newline (the editor's
// own save format since the post-1.0 round-trip); matching it keeps the diff
// to exactly the showcase changes.
writeFileSync(file, JSON.stringify(project, null, 1));
console.log("[atlas-quest-hd] wrote " + file + " (" + project.maps.length + " maps)");
