"use strict";

// Headless tests for the gamepad poller in js/runtime/input.js (phase 3): button -> action
// edges, left-stick -> synthetic dpad -> dir(), deadzone, menu DAS/ARR auto-repeat,
// activeDevice detection, and lazy connect/disconnect. navigator.getGamepads is stubbed;
// document/window are injected as deps so no real DOM is needed. Mirrors the vm harness in
// tests/input.test.js (loads plugins.js + data.js for RA, then input.js).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = vm.createContext({ console, Assets: { T: {} }, window: {} });
vm.runInContext(fs.readFileSync("js/plugins.js", "utf8"), context, { filename: "js/plugins.js" });
vm.runInContext(fs.readFileSync("js/data.js", "utf8"), context, { filename: "js/data.js" });
vm.runInContext(fs.readFileSync("js/runtime/input.js", "utf8"), context, { filename: "js/runtime/input.js" });

const createInputSystem = vm.runInContext("createInputSystem", context);
const RA = vm.runInContext("RA", context);
const defaultInput = () => JSON.parse(JSON.stringify(RA.defaultInput()));
const PAD_BUTTONS = RA.PAD_BUTTONS;
const idx = (name) => PAD_BUTTONS.indexOf(name);

// Build a fake Standard Gamepad. `down` is a list of PAD_BUTTONS names; axes default centered.
function pad(down, axes) {
  const buttons = PAD_BUTTONS.map((name) => ({ pressed: down.indexOf(name) !== -1, value: down.indexOf(name) !== -1 ? 1 : 0 }));
  return { index: 0, buttons, axes: axes || [0, 0] };
}

// Make an Input wired to a mutable `pads` array and a controllable menu flag.
function makeInput() {
  let pads = [];
  let menuOpen = false;
  const navCalls = [];
  const Input = createInputSystem({
    defaultBindings: defaultInput(),
    padButtons: PAD_BUTTONS,
    document: { addEventListener() {} },
    window: { addEventListener() {} },
    navigator: { getGamepads: () => pads },
    isMenuOpen: () => menuOpen,
    onMenuNav: (a) => navCalls.push(a),
  });
  return {
    Input,
    navCalls,
    setPads: (p) => { pads = p; },
    setMenu: (v) => { menuOpen = v; },
  };
}

// 1. Button press -> action edge on the map; consume fires once, not while held.
{
  const t = makeInput();
  t.setPads([pad(["face_south"])]); // face_south = ok
  t.Input.poll();
  assert.equal(t.Input.justPressed("ok"), true, "face_south -> ok edge");
  assert.equal(t.Input.consume("ok"), true, "consume ok");
  assert.equal(t.Input.consume("ok"), false, "ok already consumed this frame");
  t.Input.poll(); // still held -> no new edge
  assert.equal(t.Input.consume("ok"), false, "held button does not re-edge");
  assert.equal(t.Input.activeDevice(), "gamepad", "pad input flips activeDevice");
  t.setPads([pad([])]); // release
  t.Input.poll();
  t.setPads([pad(["face_south"])]); // press again -> fresh edge
  t.Input.poll();
  assert.equal(t.Input.consume("ok"), true, "re-press edges again");
}

// 2. Left stick past deadzone -> synthetic dpad -> dir()/pressed().
{
  const t = makeInput();
  t.setPads([pad([], [-1, 0])]); // stick left
  t.Input.poll();
  assert.equal(t.Input.pressed("left"), true, "stick left -> left held");
  assert.equal(t.Input.dir(), 1, "dir() == left (1)");
  t.setPads([pad([], [0, -1])]); // stick up
  t.Input.poll();
  assert.equal(t.Input.dir(), 3, "dir() == up (3)");
  // dpad button maps the same way.
  t.setPads([pad(["dpad_right"])]);
  t.Input.poll();
  assert.equal(t.Input.dir(), 2, "dpad_right -> right (2)");
}

// 3. Deadzone: a small tilt under the threshold is ignored.
{
  const t = makeInput();
  t.setPads([pad([], [-0.4, 0])]); // |0.4| < default deadzone 0.5
  t.Input.poll();
  assert.equal(t.Input.pressed("left"), false, "sub-deadzone tilt ignored");
  assert.equal(t.Input.dir(), -1, "dir() neutral under deadzone");
}

// 4. Menu DAS/ARR: edge fires immediately, first repeat after the delay, then at the rate.
{
  const t = makeInput();
  t.setMenu(true);
  t.setPads([pad(["dpad_up"])]); // up, held
  t.Input.poll(); // poll #1 = edge
  assert.deepEqual(t.navCalls, ["up"], "edge routes one nav immediately");
  for (let i = 2; i <= 16; i++) t.Input.poll(); // through poll #16, navHeld=15, no repeat yet
  assert.equal(t.navCalls.length, 1, "no repeat before DAS delay");
  t.Input.poll(); // poll #17, navHeld=16 -> first repeat
  assert.equal(t.navCalls.length, 2, "first repeat at DAS delay");
  for (let i = 18; i <= 22; i++) t.Input.poll(); // poll #22, navHeld=21 -> second repeat
  assert.equal(t.navCalls.length, 3, "second repeat one ARR period later");
  // While a menu is open the press is NOT a map edge.
  assert.equal(t.Input.justPressed("up"), false, "menu nav is not queued as a map edge");
}

// 4b. START is unbound by default (it no longer shares cancel) — pressing it does nothing.
{
  const t = makeInput();
  t.setPads([pad(["start"])]);
  t.Input.poll();
  assert.equal(t.Input.consume("cancel"), false, "start is unbound by default");
}

// 5. ok/cancel/attack do not auto-repeat in menus (edge only).
{
  const t = makeInput();
  t.setMenu(true);
  t.setPads([pad(["face_south"])]); // ok, held
  for (let i = 0; i < 30; i++) t.Input.poll();
  assert.deepEqual(t.navCalls, ["ok"], "confirm fires once, never repeats");
}

// 6. Disconnect (pad vanishes from getGamepads) drops the slot and its held state.
{
  const t = makeInput();
  t.setPads([pad(["dpad_left"])]);
  t.Input.poll();
  assert.equal(t.Input.pressed("left"), true, "held before disconnect");
  t.setPads([]); // unplugged
  t.Input.poll();
  assert.equal(t.Input.pressed("left"), false, "held state cleared on disconnect");
}

// 7. Gamepad ok in a menu routes to onMenuNav (not a map edge); on the map it is a consumable edge.
{
  const t = makeInput();
  t.setMenu(true);
  t.setPads([pad(["face_east"])]); // cancel
  t.Input.poll();
  assert.deepEqual(t.navCalls, ["cancel"], "menu-open cancel -> onMenuNav");
  assert.equal(t.Input.justPressed("cancel"), false, "menu-open cancel is not a map edge");
}

// 8. After a bindings swap (a rebind), a still-held pad button must not fresh-edge its NEW action
//    — otherwise the button just bound auto-confirms the menu/dialog that opens right after.
{
  const t = makeInput();
  t.setPads([pad(["face_west"])]); // hold face_west (default action: dash)
  t.Input.poll();
  assert.equal(t.Input.justPressed("ok"), false, "face_west is not ok under defaults");
  const b = defaultInput();
  b.gamepad.ok = ["face_west"]; // rebind ok onto the held button...
  b.gamepad.dash = [];          // ...and free it from dash so it maps solely to ok
  t.Input.setBindings(b);
  t.Input.poll();
  assert.equal(t.Input.justPressed("ok"), false, "held button does not fresh-edge its new action after rebind");
  t.setPads([pad([])]);            // release
  t.Input.poll();
  t.setPads([pad(["face_west"])]); // genuine re-press
  t.Input.poll();
  assert.equal(t.Input.justPressed("ok"), true, "re-press after release fires the rebound action");
}

console.log("Input gamepad-poller tests passed.");
