"use strict";

// Headless tests for the editable-target guard in js/runtime/input.js: a key
// event aimed at an editable DOM element (text input, textarea, select,
// contenteditable — the Play Together name/room-code/world-address fields and
// the chat box) must never be consumed as game input. Before the guard, every
// bound key was preventDefault-ed out of the field: typing "Mike" produced
// "ike" (W/A/S/D/M plus Space, Enter, arrows, Z/X, F/J, Shift all eaten).
// Mirrors the vm harness in tests/input-focus.test.js (loads plugins.js +
// data.js for RA, then input.js; document/window are injected fakes so their
// handlers can be fired directly).

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

// Fake key event with a preventDefault spy and an optional DOM-ish target.
function keyEvent(code, target, repeat) {
  return {
    code,
    repeat: !!repeat,
    target,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
}
const INPUT_EL = { tagName: "INPUT" };
const TEXTAREA_EL = { tagName: "TEXTAREA" };
const SELECT_EL = { tagName: "SELECT" };
const EDITABLE_DIV = { tagName: "DIV", isContentEditable: true };
const CANVAS_EL = { tagName: "CANVAS" };
const BUTTON_EL = { tagName: "BUTTON" };

// Input wired to fake document/window; exposes the raw handlers plus the menu
// spy so each check can assert exactly where a key was (not) routed.
function makeInput(menuOpen) {
  const docHandlers = {};
  const menuNav = [];
  const Input = createInputSystem({
    defaultBindings: defaultInput(),
    document: { hidden: false, addEventListener: (type, fn) => { docHandlers[type] = fn; } },
    window: { addEventListener: () => {} },
    navigator: { getGamepads: () => [] },
    isMenuOpen: () => !!menuOpen,
    onMenuNav: (action, repeat) => menuNav.push({ action, repeat }),
  });
  Input.attachDOM();
  return {
    Input,
    menuNav,
    keydown: (code, target, repeat) => { const e = keyEvent(code, target, repeat); docHandlers.keydown(e); return e; },
    keyup: (code, target) => { const e = keyEvent(code, target); docHandlers.keyup(e); return e; },
  };
}

// 1. A bound key typed into a text input is not consumed: no preventDefault
//    (the field gets the character), no held state, no queued map edge.
{
  const t = makeInput(false);
  for (const [code, action] of [["KeyW", "up"], ["KeyA", "left"], ["KeyS", "down"], ["KeyD", "right"], ["KeyM", "hud"], ["Space", "ok"]]) {
    const e = t.keydown(code, INPUT_EL);
    assert.equal(e.defaultPrevented, false, code + " into an input keeps its default (the typed character)");
    assert.equal(t.Input.pressed(action), false, code + " into an input is not held as " + action);
  }
  t.Input.poll();
  for (const action of ["up", "left", "down", "right", "hud", "ok"])
    assert.equal(t.Input.justPressed(action), false, action + " never edges from typing");
}

// 2. Sanity (the old path still works): the same key aimed at the game IS
//    consumed — canvas, button, and no-target (the node-test fakes) alike.
{
  for (const target of [CANVAS_EL, BUTTON_EL, undefined]) {
    const t = makeInput(false);
    const e = t.keydown("KeyW", target);
    assert.equal(e.defaultPrevented, true, "game-bound KeyW is consumed for target " + (target ? target.tagName : "none"));
    assert.equal(t.Input.pressed("up"), true, "and held as up");
    t.Input.poll();
    assert.equal(t.Input.justPressed("up"), true, "and edges");
  }
}

// 3. While a menu is open (the title screen behind the Play Together modal),
//    typing must not navigate the menu; the same key off-field still does.
{
  const t = makeInput(true);
  t.keydown("KeyW", INPUT_EL);
  t.keydown("KeyS", TEXTAREA_EL);
  assert.equal(t.menuNav.length, 0, "typing never routes to menu nav");
  t.keydown("KeyW", CANVAS_EL);
  assert.deepEqual(t.menuNav, [{ action: "up", repeat: false }], "off-field key still navigates the menu");
}

// 4. Every editable flavor is shielded: input, textarea, select, contenteditable.
{
  const t = makeInput(false);
  for (const target of [INPUT_EL, TEXTAREA_EL, SELECT_EL, EDITABLE_DIV]) {
    const e = t.keydown("KeyD", target);
    assert.equal(e.defaultPrevented, false, (target.tagName || "?") + " is shielded");
    assert.equal(t.Input.pressed("right"), false, (target.tagName || "?") + " holds nothing");
  }
}

// 5. keyup stays unguarded: a key held on the game side then released while a
//    field has focus must clear its held state (no stuck walking while typing).
{
  const t = makeInput(false);
  t.keydown("KeyW", CANVAS_EL);
  assert.equal(t.Input.pressed("up"), true, "held from the game side");
  t.keyup("KeyW", INPUT_EL);
  assert.equal(t.Input.pressed("up"), false, "release over an input still clears the action");
}

// 6. Typing wins over rebinder capture too: a key typed into a field is neither
//    captured as a binding nor swallowed; the capture stays armed for a real press.
{
  const t = makeInput(false);
  let captured = "unset";
  t.Input.beginCapture("keyboard", (r) => { captured = r; });
  const e = t.keydown("KeyM", INPUT_EL);
  assert.equal(e.defaultPrevented, false, "typed key is not swallowed by capture");
  assert.equal(captured, "unset", "typed key is not captured as a binding");
  assert.equal(t.Input.isCapturing(), true, "capture stays armed");
  t.keydown("KeyM", CANVAS_EL);
  // Field-by-field: the result object is born in the vm realm (deepStrictEqual
  // would fail on the foreign Object.prototype).
  assert.equal(captured && captured.device, "keyboard", "a real press still binds (device)");
  assert.equal(captured && captured.code, "KeyM", "a real press still binds (code)");
}

console.log("Input editable-target tests passed.");
