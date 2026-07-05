"use strict";

// Project Compass M2·A: behavior tests for the presentation runtime
// (src/engine/scenes/presentation-runtime.ts) — pictures, screen tint, the
// count-down timer, and map scroll — as pure state advanced by
// updatePresentation()/tickTimer(). Bundled with esbuild and evaluated in a vm
// with the classic-script globals stubbed (no browser), mirroring
// tests/interpreter.test.js. Drawing + image loading are DOM-guarded, so this
// exercises the deterministic state math without a canvas.

const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

async function loadRuntime() {
  const { build } = require("esbuild");
  const entry = `export * from ${JSON.stringify(
    path.join(root, "src/engine/scenes/presentation-runtime.ts").replace(/\\/g, "/"),
  )};`;
  const out = (await build({
    stdin: { contents: entry, resolveDir: root, loader: "ts" },
    bundle: true,
    format: "cjs",
    write: false,
    platform: "node",
    logLevel: "silent",
  })).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(out, {
    module,
    exports: module.exports,
    require,
    console,
    // deps.js reads window.RPGAtlasDeps.Assets at eval; scrollOffsetPx() reads TILE.
    window: { RPGAtlasDeps: { Assets: { TILE: 48 } } },
  });
  return module.exports;
}

// The runtime is evaluated in a separate vm realm, so its arrays/objects have a
// different Array/Object prototype than this file's — assert.deepStrictEqual is
// prototype-sensitive across realms, so compare structural values via JSON.
const jsonEq = (actual, expected, msg) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), msg);

(async () => {
  const P = await loadRuntime();

  // ---- pictures: show / rotate / erase + serialize ----
  P.resetPresentation();
  P.showPicture({ t: "showPic", id: 1, name: "", origin: 1, x: 40, y: 30, scaleX: 150, scaleY: 150, opacity: 200, blend: 1 });
  let pic = P.__test.pictures().get(1);
  assert.ok(pic, "showPicture creates the slot");
  assert.equal(pic.origin, 1, "origin stored");
  assert.equal(pic.sx, 1.5, "scaleX percent → factor");
  assert.equal(pic.opacity, 200, "opacity stored");

  // move tween lands exactly on target after `frames` ticks
  P.movePicture({ id: 1, x: 100, y: 30, scaleX: 100, scaleY: 100, opacity: 255, blend: 1, frames: 4 });
  assert.equal(P.pictureBusy(1), true, "picture is busy mid-move");
  for (let i = 0; i < 4; i++) P.updatePresentation();
  pic = P.__test.pictures().get(1);
  assert.equal(pic.x, 100, "move tween reaches the target x");
  assert.equal(pic.sx, 1, "move tween reaches the target scale");
  assert.equal(P.pictureBusy(1), false, "picture no longer busy after the move");

  // rotation accumulates each tick
  P.rotatePicture({ id: 1, speed: 10 });
  P.updatePresentation();
  P.updatePresentation();
  assert.equal(P.__test.pictures().get(1).angle, 20, "rotation advances by speed each tick");

  const snap = P.serializePresentation();
  assert.equal(snap.pictures.length, 1, "serialize captures the picture");
  assert.equal(snap.pictures[0].x, 100, "serialized picture keeps its position");

  P.erasePicture({ id: 1 });
  assert.equal(P.__test.pictures().size, 0, "erasePicture removes the slot");

  // restore round-trips the serialized state
  P.restorePresentation(snap);
  assert.equal(P.__test.pictures().size, 1, "restore rebuilds pictures");
  assert.equal(P.__test.pictures().get(1).opacity, snap.pictures[0].opacity, "restore keeps opacity");
  assert.equal(P.__test.pictures().get(1).x, 100, "restore keeps position");

  // ---- screen tint: immediate + tween ----
  P.resetPresentation();
  P.tintScreen({ tone: [10, 20, 30, 40], frames: 0 });
  jsonEq(P.__test.tint(), [10, 20, 30, 40], "frames 0 tint applies immediately");
  P.tintScreen({ tone: [100, 0, 0, 0], frames: 2 });
  assert.equal(P.tintBusy(), true, "tint is busy mid-tween");
  P.updatePresentation();
  P.updatePresentation();
  jsonEq(P.__test.tint(), [100, 0, 0, 0], "tint tween reaches the target tone");
  assert.equal(P.tintBusy(), false, "tint no longer busy after the tween");

  // ---- timer: count-down + expiry common-event id ----
  P.resetPresentation();
  P.startTimer(1 / 60, 7); // exactly 1 frame, expiry → common event 7
  assert.equal(P.__test.timer().frames, 1, "startTimer seeds frames from seconds*60");
  assert.equal(P.tickTimer(), 7, "tickTimer returns the expiry common-event id at 0");
  assert.equal(P.__test.timer().running, false, "timer stops when it expires");
  assert.equal(P.tickTimer(), 0, "an expired/stopped timer returns 0");

  P.startTimer(10);
  P.stopTimer();
  assert.equal(P.tickTimer(), 0, "a stopped timer does not tick");

  // ---- map scroll: tween + pixel offset ----
  P.resetPresentation();
  jsonEq(P.scrollOffsetPx(), { x: 0, y: 0 }, "no scroll → zero offset");
  P.scrollMap({ dir: "right", distance: 2, speed: 6 }); // 2*256/64 = 8 frames
  assert.equal(P.scrollBusy(), true, "scroll is busy mid-tween");
  for (let i = 0; i < 8; i++) P.updatePresentation();
  assert.equal(P.scrollBusy(), false, "scroll finishes after its frames");
  jsonEq(P.scrollOffsetPx(), { x: 2 * 48, y: 0 }, "scroll right 2 tiles → +96px x offset");
  P.resetScroll();
  jsonEq(P.scrollOffsetPx(), { x: 0, y: 0 }, "resetScroll clears the offset");

  console.log("Presentation-runtime state tests passed.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
