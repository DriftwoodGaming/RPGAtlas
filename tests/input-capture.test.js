"use strict";

// Headless tests for the rebinder capture API in js/runtime/input.js (phase 4):
// beginCapture/cancelCapture grab the next fresh key or pad button, ignore inputs held
// when capture began (so the Confirm press that opened "rebind" can't bind itself),
// isolate by device, cancel on Escape, and suppress normal routing while active. Also
// covers the label/codeLabel text helpers. document is faked so its keydown/keyup
// handlers can be fired directly; navigator.getGamepads is stubbed. Mirrors the vm
// harness in tests/input.test.js (loads plugins.js + data.js for RA, then input.js).

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

// Capture results are object literals created inside the vm realm; re-wrap them in this
// realm so deepStrictEqual (assert/strict) compares by value, not by foreign prototype.
const norm = (o) => (o == null ? o : { device: o.device, code: o.code });

// Fake Standard Gamepad from a list of pressed PAD_BUTTONS names (axes centered).
function pad(down, axes) {
  const buttons = PAD_BUTTONS.map((name) => ({ pressed: down.indexOf(name) !== -1, value: down.indexOf(name) !== -1 ? 1 : 0 }));
  return { index: 0, buttons, axes: axes || [0, 0] };
}

// Input wired to a fake document (captured keydown/keyup handlers) + mutable pad list.
function makeInput() {
  let pads = [];
  const handlers = {};
  const Input = createInputSystem({
    defaultBindings: defaultInput(),
    padButtons: PAD_BUTTONS,
    document: { addEventListener: (type, fn) => { handlers[type] = fn; } },
    window: { addEventListener() {} },
    navigator: { getGamepads: () => pads },
    isMenuOpen: () => false,
    onMenuNav: () => {},
  });
  Input.attachDOM();
  return {
    Input,
    setPads: (p) => { pads = p; },
    keydown: (code, repeat) => handlers.keydown({ code, repeat: !!repeat, preventDefault() {} }),
    keyup: (code) => handlers.keyup({ code, preventDefault() {} }),
  };
}

// 1. Keyboard capture grabs the next fresh key, then ends (one-shot).
{
  const t = makeInput();
  let got;
  t.Input.beginCapture("keyboard", (r) => { got = r; });
  t.keydown("KeyM");
  assert.deepEqual(norm(got), { device: "keyboard", code: "KeyM" }, "captures a fresh key by code");
  assert.equal(t.Input.isCapturing(), false, "capture ends after one grab");
  got = undefined;
  t.keydown("KeyN");
  assert.equal(got, undefined, "capture is one-shot — next key is not captured");
}

// 2. Ignore-held-until-release: a key already down when capture begins binds only on a
//    fresh press after release (the Confirm key that opened the rebinder can't self-bind).
{
  const t = makeInput();
  t.keydown("KeyZ"); // Z (Confirm) held when the rebinder opens
  let got;
  t.Input.beginCapture("keyboard", (r) => { got = r; });
  t.keydown("KeyZ", true); // OS repeat of the held key — ignored
  assert.equal(got, undefined, "held key is ignored while still down");
  t.keyup("KeyZ");
  t.keydown("KeyZ"); // genuine fresh press
  assert.deepEqual(norm(got), { device: "keyboard", code: "KeyZ" }, "fresh re-press after release is captured");
}

// 3. Escape cancels capture (reports null), and cancelCapture() does too.
{
  const t = makeInput();
  let got = "untouched";
  t.Input.beginCapture("keyboard", (r) => { got = r; });
  t.keydown("Escape");
  assert.equal(got, null, "Escape cancels with null");
  assert.equal(t.Input.isCapturing(), false, "not capturing after cancel");

  let got2 = "untouched";
  t.Input.beginCapture("keyboard", (r) => { got2 = r; });
  t.Input.cancelCapture();
  assert.equal(got2, null, "cancelCapture() reports null");
}

// 4. Device isolation: during a gamepad rebind, stray keys are ignored — but Esc still cancels.
{
  const t = makeInput();
  let got = "untouched";
  t.Input.beginCapture("gamepad", (r) => { got = r; });
  t.keydown("KeyM");
  assert.equal(got, "untouched", "keyboard key ignored during a gamepad capture");
  assert.equal(t.Input.isCapturing(), true, "still capturing the pad");
  t.keydown("Escape");
  assert.equal(got, null, "Esc cancels even a gamepad capture");
}

// 5. Gamepad capture: a button held at capture-start is ignored until released; a fresh
//    button is captured by its generic name.
{
  const t = makeInput();
  t.setPads([pad(["face_south"])]); // Confirm button still held from opening the rebinder
  let got;
  t.Input.beginCapture("gamepad", (r) => { got = r; });
  t.Input.poll();
  assert.equal(got, undefined, "held pad button ignored at capture start");
  t.setPads([pad([])]); // release
  t.Input.poll();
  t.setPads([pad(["face_west"])]); // fresh button
  t.Input.poll();
  assert.deepEqual(norm(got), { device: "gamepad", code: "face_west" }, "fresh pad button captured by name");
}

// 5b. The same held button, once released, can be re-pressed to bind itself.
{
  const t = makeInput();
  t.setPads([pad(["face_south"])]);
  let got;
  t.Input.beginCapture("gamepad", (r) => { got = r; });
  t.Input.poll();
  t.setPads([pad([])]);
  t.Input.poll();
  t.setPads([pad(["face_south"])]); // re-press the same button
  t.Input.poll();
  assert.deepEqual(norm(got), { device: "gamepad", code: "face_south" }, "re-pressed held button binds after release");
}

// 5c. After capturing a fresh pad button, the still-held button does NOT fresh-edge its
//     action on the next normal poll — otherwise it would auto-confirm the conflict dialog.
{
  const t = makeInput();
  let got;
  t.Input.beginCapture("gamepad", (r) => { got = r; }); // nothing held at start
  t.setPads([pad(["face_south"])]); // press face_south (bound to "ok") fresh
  t.Input.poll();
  assert.deepEqual(norm(got), { device: "gamepad", code: "face_south" }, "captured fresh button");
  t.Input.poll(); // button still held, capture over
  assert.equal(t.Input.justPressed("ok"), false, "held captured button does not re-edge its action");
}

// 5d. Analog rebind needs a firm press: a left-stick lean past the deadzone but below the
//     capture threshold does NOT bind; a near-full push binds the lstick_* direction.
{
  const t = makeInput();
  const stickPad = (axes) => ({ index: 0, buttons: PAD_BUTTONS.map(() => ({ pressed: false, value: 0 })), axes });
  let got;
  t.Input.beginCapture("gamepad", (r) => { got = r; });
  t.setPads([stickPad([0, -0.6])]); // a lean (already past the 0.5 deadzone) — too soft to bind
  t.Input.poll();
  assert.equal(got, undefined, "soft stick lean does not bind");
  t.setPads([stickPad([0, -1])]); // a deliberate full push
  t.Input.poll();
  assert.deepEqual(norm(got), { device: "gamepad", code: "lstick_up" }, "firm stick push binds lstick_up");
}

// 5e. Same for an analog trigger: a light pull is ignored, a full pull binds.
{
  const t = makeInput();
  const trigPad = (v) => ({ index: 0, buttons: PAD_BUTTONS.map((n) => ({ pressed: false, value: n === "trigger_r" ? v : 0 })), axes: [0, 0] });
  let got;
  t.Input.beginCapture("gamepad", (r) => { got = r; });
  t.setPads([trigPad(0.6)]); // a light pull
  t.Input.poll();
  assert.equal(got, undefined, "light trigger pull does not bind");
  t.setPads([trigPad(1)]); // a full pull
  t.Input.poll();
  assert.deepEqual(norm(got), { device: "gamepad", code: "trigger_r" }, "full trigger pull binds trigger_r");
}

// 6. Capture suppresses normal routing — the captured key does not also queue a map edge.
{
  const t = makeInput();
  let got;
  t.Input.beginCapture("keyboard", (r) => { got = r; });
  t.keydown("KeyW"); // bound to "up"
  t.Input.poll();
  assert.deepEqual(norm(got), { device: "keyboard", code: "KeyW" }, "captured the press");
  assert.equal(t.Input.justPressed("up"), false, "capture swallows it — no map edge queued");
}

// 7. Generic text labels for prompts (no glyph art).
{
  const t = makeInput();
  assert.equal(t.Input.codeLabel("keyboard", "KeyZ"), "Z", "KeyZ -> Z");
  assert.equal(t.Input.codeLabel("keyboard", "ArrowUp"), "Up Arrow", "ArrowUp -> Up Arrow");
  assert.equal(t.Input.codeLabel("gamepad", "face_south"), "Face Down (A)", "face_south label");
  assert.equal(t.Input.label("keyboard", "ok"), "Z / Enter / Space", "joined keyboard label");
  assert.equal(t.Input.codeLabel("gamepad", "lstick_up"), "L-Stick Up", "lstick label");
  assert.equal(t.Input.label("gamepad", "up"), "D-Pad Up / L-Stick Up", "joined gamepad label (dpad + stick)");
}

console.log("Input capture/rebind tests passed.");
