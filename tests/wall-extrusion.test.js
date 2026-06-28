"use strict";

// Exercises the pure height-extrusion geometry (Renderer.planWalls) without a
// GPU or a DOM. The renderer IIFE only touches window.Assets/document/WebGL
// inside its methods, so a bare window stub is enough to load it.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = vm.createContext({ window: {}, console });
vm.runInContext(fs.readFileSync("js/renderer.js", "utf8"), context, {
  filename: "js/renderer.js",
});
const planWalls = context.window.Renderer.planWalls;
const planLightOccluders = context.window.Renderer.planLightOccluders;

const map = (width, height, heights) => ({ width, height, heights });
// planWalls returns objects from the vm realm, so compare by value, not by
// prototype (deepStrictEqual would reject the cross-realm Array/Object).
const json = (v) => JSON.stringify(v);

// A flat map (or one without a heights layer) extrudes nothing.
assert.equal(json(planWalls(map(3, 3, new Array(9).fill(0)))), "[]");
assert.equal(json(planWalls({ width: 2, height: 2 })), "[]");
assert.equal(json(planWalls(null)), "[]");

// A lone raised tile exposes its full south face (neighbour is flat ground).
// 3x3, only the centre tile (1,1) is height 2.
const lone = planWalls(map(3, 3, [0, 0, 0, 0, 2, 0, 0, 0, 0]));
assert.equal(lone.length, 1);
assert.equal(json(lone[0]), json({ tx: 1, ty: 1, h: 2, faceUnits: 2 }));

// A taller tile sitting south of a shorter one hides the shorter tile's face,
// while the taller tile still exposes its full height over flat ground below.
// Column at x=0: (0,0)=2 above (0,1)=3 above (0,2)=0.
const step = planWalls(map(1, 3, [2, 3, 0]));
const back = step.find((w) => w.ty === 0);
const front = step.find((w) => w.ty === 1);
assert.equal(back.faceUnits, 0); // 2 - 3 < 0, clamped: fully occluded by the taller block
assert.equal(front.faceUnits, 3); // 3 - 0

// A tile on the south edge has no neighbour, so it exposes its full height.
const edge = planWalls(map(1, 2, [0, 4]));
assert.equal(edge.length, 1);
assert.equal(json(edge[0]), json({ tx: 0, ty: 1, h: 4, faceUnits: 4 }));

// Equal-height neighbours expose no face between them (a flat plateau), only
// the plateau's leading (south) edge does.
const plateau = planWalls(map(1, 3, [1, 1, 0]));
assert.equal(plateau.find((w) => w.ty === 0).faceUnits, 0); // 1 - 1
assert.equal(plateau.find((w) => w.ty === 1).faceUnits, 1); // 1 - 0

// Lighting occlusion includes blocked and elevated nearby tiles, but not the
// tile occupied by the light source itself.
const shadowMap = map(4, 3, [
  0, 0, 0, 0,
  0, 0, 2, 0,
  0, 0, 0, 0,
]);
const blocked = new Set(["1,1"]);
const occluders = planLightOccluders(
  shadowMap,
  { rx: 0, ry: 1, radius: 180 },
  (x, y) => !blocked.has(x + "," + y),
);
assert.equal(occluders.some((o) => o.tx === 1 && o.ty === 1 && o.tileHeight === 0), true);
assert.equal(occluders.some((o) => o.tx === 2 && o.ty === 1 && o.tileHeight === 2), true);
assert.equal(occluders.some((o) => o.tx === 0 && o.ty === 1), false);
assert.equal(planLightOccluders(shadowMap, null, () => true).length, 0);

console.log("Wall extrusion tests passed.");
