"use strict";

// Regression coverage for the imported-map launch crash: an MZ/MV import (or any
// project) stamped formatVersion 2 skips every version-gated migration step, so
// before RA.normalizeMapPlanes a map missing an invariant plane reached the
// first render unnormalized and crashed the editor on launch "until restored".
// migrateProject now normalizes every map unconditionally at the load boundary.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Same sandbox recipe as schema-version.test.js: data.js's DataDefaults IIFE
// reads Assets.T at load, and the migrations reference AtlasBuiltins (guarded).
const context = vm.createContext({ console, Assets: { T: {} } });
vm.runInContext(fs.readFileSync("js/plugins.js", "utf8"), context, { filename: "js/plugins.js" });
vm.runInContext(fs.readFileSync("js/data.js", "utf8"), context, { filename: "js/data.js" });

const evaluate = (src) => vm.runInContext(src, context);
const plain = (o) => JSON.parse(JSON.stringify(o));

const ROLES = ["ground", "decor", "decor2", "over"];
const PLANES = ["shadows", "passOv", "heights", "regions"];

function normalize(map) {
  context.__m = map;
  const r = evaluate("RA.normalizeMapPlanes(__m)");
  delete context.__m;
  return r;
}
function migrate(project) {
  context.__p = project;
  const r = evaluate("RA.migrateProject(__p)");
  delete context.__p;
  return r;
}
function fullMap(w, h, extra) {
  const n = w * h;
  const mk = () => new Array(n).fill(0);
  return Object.assign({
    id: 1, name: "M", width: w, height: h,
    layers: { ground: mk(), decor: mk(), decor2: mk(), over: mk() },
  }, extra || {});
}

// (1) A map missing every layer and plane is filled with full-length zero arrays.
{
  const m = normalize({ width: 3, height: 2 });
  const n = 6;
  for (const role of ROLES) {
    assert.ok(Array.isArray(m.layers[role]), `layers.${role} is an array`);
    assert.equal(m.layers[role].length, n, `layers.${role} length`);
  }
  for (const p of PLANES) {
    assert.ok(Array.isArray(m[p]), `${p} is an array`);
    assert.equal(m[p].length, n, `${p} length`);
  }
}

// (2) Existing correct-length data is preserved; only missing/short planes rebuild.
{
  const shadows = new Array(6).fill(0); shadows[2] = 7;
  const ground = new Array(6).fill(5);
  const m = normalize({
    width: 3, height: 2,
    layers: { ground, decor: new Array(6).fill(0), decor2: new Array(6).fill(0), over: new Array(6).fill(0) },
    shadows,
    passOv: [1, 2], // wrong length -> rebuilt to zeros
    // heights, regions absent -> built
  });
  assert.equal(m.shadows, shadows, "correct-length shadows array kept by reference");
  assert.equal(m.shadows[2], 7, "existing shadow data preserved");
  assert.equal(m.layers.ground[0], 5, "existing ground data preserved");
  assert.equal(m.passOv.length, 6, "short passOv rebuilt to full length");
  assert.ok(m.passOv.every((v) => v === 0), "rebuilt passOv is zero-filled");
  assert.equal(m.heights.length, 6, "missing heights built");
  assert.equal(m.regions.length, 6, "missing regions built");
}

// (3) Idempotent: normalizing an already-normal map changes nothing.
{
  const once = normalize(fullMap(4, 4));
  const before = plain(once);
  const twice = normalize(once);
  assert.deepEqual(plain(twice), before, "normalizeMapPlanes is idempotent");
}

// (4) Degenerate/absent dimensions must not throw (nothing valid to size by).
{
  for (const dims of [{ width: undefined, height: 3 }, { width: 3, height: 2.5 }, { width: -4, height: 4 }, { width: 1e9, height: 1e9 }]) {
    const bad = normalize({ ...dims });
    assert.ok(bad && typeof bad === "object", `dims ${JSON.stringify(dims)} return the map without throwing`);
    assert.ok(!("shadows" in bad) || bad.shadows === undefined, `no bogus arrays invented for unsized dims ${JSON.stringify(dims)}`);
  }
  // n === 0 is a valid (empty) map: planes become zero-length arrays, no throw.
  const empty = normalize({ width: 0, height: 0 });
  for (const p of PLANES) assert.ok(Array.isArray(empty[p]) && empty[p].length === 0, `0-size map: ${p} is an empty array`);
}

// (5) THE bug: migrateProject on a formatVersion-2 project backfills a partial map.
{
  const latest = evaluate("RA.FORMAT_VERSION");
  const proj = {
    meta: { engine: "rpgatlas", version: 3, builtinsSeeded: true, formatVersion: latest },
    plugins: [], assets: {}, system: {}, states: [], skills: [], classes: [],
    maps: [fullMap(3, 3, { shadows: [] /* short */ })], // heights/passOv/regions absent
  };
  const out = migrate(proj);
  assert.equal(out.meta.formatVersion, latest, "stays stamped at the latest version");
  const m = out.maps[0], n = 9;
  for (const p of PLANES) {
    assert.ok(Array.isArray(m[p]) && m[p].length === n, `v2 import: ${p} backfilled to ${n}`);
  }
  for (const role of ROLES) {
    assert.ok(Array.isArray(m.layers[role]) && m.layers[role].length === n, `v2 import: layers.${role} intact`);
  }
}

// (6) migrateProject leaves a well-formed v2 project's maps untouched (no churn).
{
  const latest = evaluate("RA.FORMAT_VERSION");
  const proj = {
    meta: { engine: "rpgatlas", version: 3, builtinsSeeded: true, formatVersion: latest },
    plugins: [], assets: {}, system: {}, states: [], skills: [], classes: [],
    maps: [fullMap(2, 2, { shadows: new Array(4).fill(0), passOv: new Array(4).fill(0), heights: new Array(4).fill(0), regions: new Array(4).fill(0) })],
  };
  const before = plain(proj.maps[0]);
  const out = migrate(proj);
  assert.deepEqual(plain(out.maps[0]), before, "a complete v2 map is not rewritten");
}

// (7) migrateProject tolerates a non-array (or absent) maps without throwing.
{
  const latest = evaluate("RA.FORMAT_VERSION");
  for (const maps of [undefined, null, {}, "oops"]) {
    const out = migrate({ meta: { formatVersion: latest }, maps });
    assert.equal(out.meta.formatVersion, latest, `maps=${JSON.stringify(maps)} still migrates without throwing`);
  }
}

console.log("Map plane normalize tests passed.");
