/* RPGAtlas - runtime/input.js
   Unified input abstraction: named actions (up/down/left/right/ok/cancel/dash/attack)
   fed by the keyboard and the gamepad. Engine + menu code reads named actions through
   this module and never touches raw key codes or button indices. Device-slot state
   leaves local co-op open without being built yet.
   GPL-3.0-or-later (see LICENSE). */

function createInputSystem(deps) {
  deps = deps || {};
  const doc = deps.document || (typeof document !== "undefined" ? document : null);
  const win = deps.window || (typeof window !== "undefined" ? window : null);
  const nav = deps.navigator || (typeof navigator !== "undefined" ? navigator : null);
  const isMenuOpen = deps.isMenuOpen || (() => false);
  const onMenuNav = deps.onMenuNav || (() => {});

  // Generic positional button names in W3C "Standard Gamepad" index order (0..15).
  // Prefer the single source of truth in data.js; fall back to a local copy so the
  // module stays usable in headless contexts with no RA global.
  const PAD_BUTTONS =
    (deps.padButtons && deps.padButtons.length && deps.padButtons.slice()) ||
    (win && win.RA && win.RA.PAD_BUTTONS && win.RA.PAD_BUTTONS.slice()) ||
    [
      "face_south", "face_east", "face_west", "face_north",
      "bumper_l", "bumper_r", "trigger_l", "trigger_r",
      "select", "start", "stick_l", "stick_r",
      "dpad_up", "dpad_down", "dpad_left", "dpad_right",
    ];

  // Menu auto-repeat for the gamepad (it has no OS key-repeat): hold a nav direction
  // for DAS_DELAY ticks, then repeat every ARR_RATE ticks. ok/cancel/attack are edge-only.
  const DAS_DELAY = 16;
  const ARR_RATE = 5;
  const NAV = { up: true, down: true, left: true, right: true };

  // A rebind of an analog input (stick / trigger) needs a firm, deliberate press past this —
  // well above the 0.5 gameplay deadzone — so feather/variable pressure or stick drift can't
  // bind itself or instantly re-trigger. Capture-only; gameplay reads still use the deadzone.
  const CAPTURE_PRESS = 0.8;

  // Current bindings. setBindings() swaps these and rebuilds the reverse lookups
  // (physical code/button-name -> action) the handlers and poller use.
  let bindings = cloneBindings(deps.defaultBindings) || emptyBindings();
  let kbReverse = buildReverse(bindings.keyboard);
  let padReverse = buildReverse(bindings.gamepad);
  let actionList = buildActionList();

  // Device slots: slot 0 is the keyboard; gamepad slots (one per connected pad index)
  // are appended/removed lazily by the poller. Each slot holds the live-held set per
  // action. Single-player reads the aggregate across slots; the per-slot split is what
  // keeps future co-op possible (a second player would read only its own slot).
  const keyboard = { kind: "keyboard", down: {} };
  const slots = [keyboard];
  const padSlots = {}; // gamepad index -> slot (also a member of `slots`)

  // Edges queued by keydown since the last poll(), drained into `edges` each frame.
  let edgeQueue = [];
  let edges = {}; // action -> true (fresh this frame)
  let lastDevice = "keyboard";

  // Physical keyboard codes currently held (by e.code, regardless of binding) — the
  // snapshot the rebinder's capture mode uses to ignore keys already down when it began.
  const heldCodes = {};
  // Rebinder capture: while set, the next *fresh* key (or pad button) for the target
  // device is reported to cb and normal routing is suppressed. ignoreKb/ignorePad are
  // the inputs held when capture began — ignored until released so the press that
  // opened "rebind" can't bind itself. Escape cancels (cb(null)).
  let capture = null; // { device, cb, ignoreKb:{}, ignorePad:{} } | null

  function cloneBindings(b) {
    if (!b) return null;
    const out = { keyboard: {}, gamepad: {} };
    for (const dev of ["keyboard", "gamepad"]) {
      const src = (b && b[dev]) || {};
      for (const a in src) out[dev][a] = Array.isArray(src[a]) ? src[a].slice() : [];
    }
    if (b.stickDeadzone != null) out.stickDeadzone = b.stickDeadzone;
    return out;
  }
  function emptyBindings() {
    return { keyboard: {}, gamepad: {} };
  }
  function buildReverse(map) {
    const r = {};
    for (const action in map)
      for (const code of map[action] || []) r[code] = action;
    return r;
  }
  // Union of every action named in either device's bindings — the stable list the
  // poller iterates to diff held state into edges.
  function buildActionList() {
    const seen = {};
    for (const dev of ["keyboard", "gamepad"])
      for (const a in (bindings[dev] || {})) seen[a] = true;
    return Object.keys(seen);
  }

  // ---- bindings -----------------------------------------------------------
  function setBindings(merged) {
    bindings = cloneBindings(merged) || emptyBindings();
    kbReverse = buildReverse(bindings.keyboard);
    padReverse = buildReverse(bindings.gamepad);
    actionList = buildActionList();
    // A rebind can remap a pad button the player is still holding (e.g. the one they just bound),
    // so reseed each pad slot's held set from the live physical state under the NEW mapping — else
    // that button fresh-edges its new action next poll and auto-confirms the menu/dialog open then.
    reseedPadHeld();
  }
  // Mark every currently-held pad button as already-down under the current bindings so it can't
  // produce a fresh edge until released and pressed again (used after a bindings swap).
  function reseedPadHeld() {
    if (!nav || !nav.getGamepads) return;
    let list;
    try {
      list = nav.getGamepads();
    } catch (err) {
      return;
    }
    if (!list) return;
    const dz = bindings.stickDeadzone != null ? bindings.stickDeadzone : 0.5;
    for (let i = 0; i < list.length; i++) {
      const gp = list[i];
      if (!gp) continue;
      const slot = padSlots[gp.index];
      if (slot) slot.down = readPad(gp, dz);
    }
  }
  function getBindings() {
    return bindings;
  }

  // ---- DOM / device attach ------------------------------------------------
  function attachDOM(targetDoc) {
    const d = targetDoc || doc;
    if (d) {
      d.addEventListener("keydown", onKeyDown);
      d.addEventListener("keyup", onKeyUp);
    }
    // Connect/disconnect are best-effort hints; the poller also creates/drops slots
    // lazily from getGamepads() so a missed event never strands input.
    if (win && win.addEventListener) {
      win.addEventListener("gamepadconnected", onPadConnected);
      win.addEventListener("gamepaddisconnected", onPadDisconnected);
    }
  }
  function onKeyDown(e) {
    // Capture mode (rebinder) takes absolute precedence: grab the next fresh key for a
    // keyboard rebind, swallow stray keys during a gamepad rebind, Escape cancels.
    if (capture) {
      e.preventDefault();
      if (e.repeat) return; // a held key only repeats; wait for a genuinely fresh press
      if (e.code === "Escape") return endCapture(null);
      if (capture.device !== "keyboard") return; // capturing a pad button; ignore keys
      if (capture.ignoreKb[e.code]) return; // still held since capture began
      return endCapture({ device: "keyboard", code: e.code });
    }
    const action = kbReverse[e.code];
    if (!action) return;
    e.preventDefault();
    keyboard.down[action] = true;
    heldCodes[e.code] = true;
    lastDevice = "keyboard";
    // Suppress OS key-repeat for confirm/cancel exactly as the old handler did,
    // so a held Z/X doesn't machine-gun those actions.
    if (e.repeat && (action === "ok" || action === "cancel")) return;
    // Dispatch to exactly one destination: menu (UIStack) > map edge. While any UI
    // is open the press only reaches the menu, so e.g. a cancel that closes a menu
    // can't also queue a map edge that instantly reopens it.
    if (isMenuOpen()) onMenuNav(action);
    else edgeQueue.push(action);
  }
  function onKeyUp(e) {
    delete heldCodes[e.code];
    if (capture) delete capture.ignoreKb[e.code]; // released → a fresh re-press now counts
    const action = kbReverse[e.code];
    if (action) keyboard.down[action] = false;
  }
  function onPadConnected() {
    lastDevice = "gamepad";
  }
  function onPadDisconnected(e) {
    const idx = e && e.gamepad ? e.gamepad.index : null;
    if (idx != null) dropPad(idx);
  }
  function dropPad(idx) {
    const slot = padSlots[idx];
    if (!slot) return;
    const i = slots.indexOf(slot);
    if (i >= 0) slots.splice(i, 1);
    delete padSlots[idx];
  }

  // ---- gamepad poll -------------------------------------------------------
  // Resolve a pad's physical state into the set of actions it is asserting this frame.
  // Pressed buttons map by index -> PAD_BUTTONS name -> action; the left stick past the
  // deadzone synthesizes dpad_* names so it follows the dpad bindings (grid 4/8-way).
  function readPad(gp, dz) {
    const active = {};
    const btns = gp.buttons || [];
    for (let i = 0; i < btns.length && i < PAD_BUTTONS.length; i++) {
      const b = btns[i];
      const isDown = b && (typeof b === "number" ? b > 0.5 : (b.pressed || b.value > 0.5));
      if (!isDown) continue;
      const action = padReverse[PAD_BUTTONS[i]];
      if (action) active[action] = true;
    }
    const ax = gp.axes || [];
    const sx = ax[0] || 0;
    const sy = ax[1] || 0;
    // The left stick gets its own lstick_* names (distinct from the D-Pad buttons) so it
    // is a separately bindable input; defaults bind both to the directions.
    if (sx < -dz) addSynthetic(active, "lstick_left");
    else if (sx > dz) addSynthetic(active, "lstick_right");
    if (sy < -dz) addSynthetic(active, "lstick_up");
    else if (sy > dz) addSynthetic(active, "lstick_down");
    return active;
  }
  function addSynthetic(active, name) {
    const action = padReverse[name];
    if (action) active[action] = true;
  }
  // Like readPad, but returns the set of physical PAD_BUTTONS *names* asserted (not the
  // actions they map to) — what the rebinder needs to record a new gamepad binding.
  function readPadRaw(gp) {
    const names = {};
    const btns = gp.buttons || [];
    for (let i = 0; i < btns.length && i < PAD_BUTTONS.length; i++) {
      const b = btns[i];
      if (!b) continue;
      const name = PAD_BUTTONS[i];
      // Triggers are analog: a rebind needs a firm pull past CAPTURE_PRESS so a feather/variable
      // pull can't bind itself or instantly re-trigger. Digital buttons bind on a normal press.
      const isDown =
        name === "trigger_l" || name === "trigger_r"
          ? (typeof b === "number" ? b : b.value) > CAPTURE_PRESS
          : typeof b === "number"
            ? b > 0.5
            : b.pressed || b.value > 0.5;
      if (isDown) names[name] = true;
    }
    const ax = gp.axes || [];
    const sx = ax[0] || 0;
    const sy = ax[1] || 0;
    // The left stick likewise needs a deliberate push past CAPTURE_PRESS to bind (capture-only;
    // gameplay still reads it at the deadzone via readPad).
    if (sx < -CAPTURE_PRESS) names["lstick_left"] = true;
    else if (sx > CAPTURE_PRESS) names["lstick_right"] = true;
    if (sy < -CAPTURE_PRESS) names["lstick_up"] = true;
    else if (sy > CAPTURE_PRESS) names["lstick_down"] = true;
    return names;
  }

  function pollGamepads() {
    if (!nav || !nav.getGamepads) return;
    let list;
    try {
      list = nav.getGamepads();
    } catch (err) {
      return;
    }
    if (!list) return;
    const dz = bindings.stickDeadzone != null ? bindings.stickDeadzone : 0.5;
    const seen = {};
    for (let i = 0; i < list.length; i++) {
      const gp = list[i];
      if (!gp) continue;
      seen[gp.index] = true;
      let slot = padSlots[gp.index];
      if (!slot) {
        slot = { kind: "gamepad", index: gp.index, down: {}, navHeld: {} };
        padSlots[gp.index] = slot;
        slots.push(slot);
      }
      if (capture) {
        // Rebinder active: feed the capture scan and suppress all normal routing so
        // the pad neither navigates the menu nor fires a map edge while binding.
        capturePadScan(gp, dz);
        continue;
      }
      const cur = readPad(gp, dz);
      const prev = slot.down;
      let anyDown = false;
      for (const a of actionList) {
        const isDown = !!cur[a];
        if (isDown) anyDown = true;
        const wasDown = !!prev[a];
        if (isDown && !wasDown) {
          // fresh press — route by precedence (menu > map edge). capture lands in phase 4.
          if (isMenuOpen()) onMenuNav(a);
          else edges[a] = true;
          slot.navHeld[a] = 0;
        } else if (isDown && wasDown) {
          // held — auto-repeat nav actions while a menu is open
          if (NAV[a] && isMenuOpen()) {
            slot.navHeld[a] = (slot.navHeld[a] || 0) + 1;
            const over = slot.navHeld[a] - DAS_DELAY;
            if (over >= 0 && over % ARR_RATE === 0) onMenuNav(a);
          }
        } else {
          slot.navHeld[a] = 0;
        }
      }
      if (anyDown) lastDevice = "gamepad";
      slot.down = cur;
    }
    // Drop pads that vanished from getGamepads() (covers missed disconnect events).
    for (const idx in padSlots) if (!seen[idx]) dropPad(idx);
  }

  // ---- capture (rebinder) -------------------------------------------------
  // The next fresh key / pad button for `device` is reported to cb({device,code}); Escape
  // (or cancelCapture) reports cb(null). Inputs held when capture begins are ignored until
  // released, so the Confirm press that opened "rebind" never binds itself.
  function snapshotPadHeld() {
    const held = {};
    if (!nav || !nav.getGamepads) return held;
    let list;
    try {
      list = nav.getGamepads();
    } catch (err) {
      return held;
    }
    if (!list) return held;
    for (let i = 0; i < list.length; i++) {
      const gp = list[i];
      if (!gp) continue;
      const names = readPadRaw(gp);
      for (const n in names) held[n] = true;
    }
    return held;
  }
  function capturePadScan(gp, dz) {
    if (!capture || capture.device !== "gamepad") return;
    const cur = readPadRaw(gp);
    for (const name in capture.ignorePad) if (!cur[name]) delete capture.ignorePad[name];
    for (const name in cur) {
      if (!capture.ignorePad[name]) {
        // Seed the pad slot's held state so the still-pressed button doesn't fresh-edge
        // on the next normal poll (which would otherwise auto-confirm a conflict dialog).
        const slot = padSlots[gp.index];
        if (slot) slot.down = readPad(gp, dz);
        endCapture({ device: "gamepad", code: name });
        return;
      }
    }
  }
  function endCapture(result) {
    const cb = capture && capture.cb;
    capture = null;
    if (cb) cb(result);
  }
  function beginCapture(device, cb) {
    capture = {
      device: device,
      cb: cb,
      ignoreKb: Object.assign({}, heldCodes),
      ignorePad: snapshotPadHeld(),
    };
  }
  function cancelCapture() {
    endCapture(null);
  }
  function isCapturing() {
    return !!capture;
  }

  // ---- labels (generic text prompts; no glyph art) ------------------------
  const KB_LABELS = {
    ArrowUp: "Up Arrow", ArrowDown: "Down Arrow", ArrowLeft: "Left Arrow", ArrowRight: "Right Arrow",
    Enter: "Enter", Space: "Space", Escape: "Esc", Tab: "Tab", Backspace: "Backspace",
    ShiftLeft: "L-Shift", ShiftRight: "R-Shift", ControlLeft: "L-Ctrl", ControlRight: "R-Ctrl",
    AltLeft: "L-Alt", AltRight: "R-Alt",
  };
  const PAD_LABELS = {
    face_south: "Face Down (A)", face_east: "Face Right (B)", face_west: "Face Left (X)", face_north: "Face Up (Y)",
    bumper_l: "L Bumper", bumper_r: "R Bumper", trigger_l: "L Trigger", trigger_r: "R Trigger",
    select: "Select", start: "Start", stick_l: "L Stick (click)", stick_r: "R Stick (click)",
    dpad_up: "D-Pad Up", dpad_down: "D-Pad Down", dpad_left: "D-Pad Left", dpad_right: "D-Pad Right",
    lstick_up: "L-Stick Up", lstick_down: "L-Stick Down", lstick_left: "L-Stick Left", lstick_right: "L-Stick Right",
  };
  function codeLabel(device, code) {
    if (device === "gamepad") return PAD_LABELS[code] || code;
    if (KB_LABELS[code]) return KB_LABELS[code];
    if (/^Key.$/.test(code)) return code.slice(3); // KeyZ -> Z
    if (/^Digit.$/.test(code)) return code.slice(5); // Digit1 -> 1
    if (/^Numpad/.test(code)) return "Num " + code.slice(6);
    return code;
  }
  function label(device, action) {
    const arr = (bindings[device] && bindings[device][action]) || [];
    if (!arr.length) return "(none)";
    return arr.map((c) => codeLabel(device, c)).join(" / ");
  }

  // ---- per-frame ----------------------------------------------------------
  // The ONLY per-frame bookkeeping; run before any early-return in update().
  // Rebuilds the fresh-edge set from queued keyboard edges plus gamepad button/stick
  // diffs, and routes gamepad menu nav. Because it runs every tick, no edge stays
  // latched across menu frames.
  function poll() {
    edges = {};
    for (let i = 0; i < edgeQueue.length; i++) edges[edgeQueue[i]] = true;
    edgeQueue = [];
    pollGamepads();
  }

  // ---- reads --------------------------------------------------------------
  function pressed(a) {
    for (const s of slots) if (s.down[a]) return true;
    return false;
  }
  function justPressed(a) {
    return !!edges[a];
  }
  function consume(a) {
    if (edges[a]) {
      delete edges[a];
      return true;
    }
    return false;
  }
  // Same priority order as the original held.down?0:held.left?1:held.right?2:held.up?3:-1.
  function dir() {
    return pressed("down")
      ? 0
      : pressed("left")
        ? 1
        : pressed("right")
          ? 2
          : pressed("up")
            ? 3
            : -1;
  }
  function activeDevice() {
    return lastDevice;
  }

  return {
    attachDOM,
    poll,
    setBindings,
    getBindings,
    pressed,
    justPressed,
    consume,
    dir,
    activeDevice,
    beginCapture,
    cancelCapture,
    isCapturing,
    label,
    codeLabel,
  };
}

if (typeof window !== "undefined") window.createInputSystem = createInputSystem;
