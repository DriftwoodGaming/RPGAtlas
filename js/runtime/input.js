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
  let lastPadId = ""; // Gamepad.id of the most-recently-used pad, for controller-family display

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
      d.addEventListener("visibilitychange", onVisibilityChange);
    }
    // Connect/disconnect are best-effort hints; the poller also creates/drops slots
    // lazily from getGamepads() so a missed event never strands input.
    if (win && win.addEventListener) {
      win.addEventListener("gamepadconnected", onPadConnected);
      win.addEventListener("gamepaddisconnected", onPadDisconnected);
      win.addEventListener("blur", clearHeld);
    }
  }
  // If focus leaves the window (alt-tab, a native file dialog, switching apps) while a key
  // or pad button is held, releasing it while unfocused never fires a keyup/poll diff, so
  // the action would otherwise stay "held" forever. Clear all held state on blur and on the
  // tab going hidden — the player has to press the key again once focus returns, same as a
  // fresh press. Bound bindings/capture state are untouched, only the live-held snapshot.
  function clearHeld() {
    keyboard.down = {};
    for (const code in heldCodes) delete heldCodes[code];
    for (const idx in padSlots) padSlots[idx].down = {};
    edgeQueue = [];
    edges = {};
  }
  function onVisibilityChange() {
    if (doc && doc.hidden) clearHeld();
  }
  // A key aimed at an editable DOM element (the Play Together name / room-code /
  // world-address fields, the chat box, any plugin dialog) belongs to that field,
  // not the game. Without this, every bound key (W/A/S/D, arrows, Space, Enter,
  // Z/X, F/J, M, Shift) was preventDefault-ed out of the field — typing "Mike"
  // produced "ike". Buttons are deliberately NOT included: clicking a DOM button
  // focuses it, and movement must keep working right after a HUD click.
  function isEditableTarget(t) {
    if (!t || !t.tagName) return false;
    const tag = t.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!t.isContentEditable;
  }
  function onKeyDown(e) {
    // Typing wins over everything (even rebinder capture): never consume, queue,
    // or menu-route a key the player is typing into a text field. onKeyUp still
    // runs unguarded so a key held before focusing a field can't stay stuck.
    if (isEditableTarget(e.target)) return;
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
    if (isMenuOpen()) onMenuNav(action, e.repeat);
    else edgeQueue.push(action);
  }
  function onKeyUp(e) {
    delete heldCodes[e.code];
    if (capture) delete capture.ignoreKb[e.code]; // released → a fresh re-press now counts
    const action = kbReverse[e.code];
    if (action) keyboard.down[action] = false;
  }
  function onPadConnected(e) {
    lastDevice = "gamepad";
    if (e && e.gamepad && e.gamepad.id) lastPadId = e.gamepad.id;
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
    let sx = ax[0] || 0;
    let sy = ax[1] || 0;
    // The left stick gets its own lstick_* names (distinct from the D-Pad buttons) so it
    // is a separately bindable input; defaults bind both to the directions.
    // In a menu, a diagonal push keeps only its dominant axis so navigating up/down doesn't also
    // fire left/right (which would adjust a value row in passing). On the map both axes stay, so
    // diagonal movement still works.
    if (isMenuOpen() && Math.abs(sx) > dz && Math.abs(sy) > dz) {
      if (Math.abs(sx) > Math.abs(sy)) sy = 0;
      else sx = 0;
    }
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
        slot = { kind: "gamepad", index: gp.index, id: gp.id || "", down: {}, navHeld: {} };
        padSlots[gp.index] = slot;
        slots.push(slot);
        if (!lastPadId && gp.id) lastPadId = gp.id; // seed family before the first button press
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
          // fresh press — route by precedence (menu > map edge).
          if (isMenuOpen()) onMenuNav(a, false);
          else edges[a] = true;
          slot.navHeld[a] = 0;
        } else if (isDown && wasDown) {
          // held — auto-repeat nav actions while a menu is open
          if (NAV[a] && isMenuOpen()) {
            slot.navHeld[a] = (slot.navHeld[a] || 0) + 1;
            const over = slot.navHeld[a] - DAS_DELAY;
            if (over >= 0 && over % ARR_RATE === 0) onMenuNav(a, true);
          }
        } else {
          slot.navHeld[a] = 0;
        }
      }
      if (anyDown) { lastDevice = "gamepad"; if (slot.id) lastPadId = slot.id; }
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
  // The label tables + formatting now live in RA (js/data.js) so the editor -- which never
  // loads this file -- shares one source. Delegate lazily (RA is a global well before any
  // input function runs at boot); fall back to the raw code if RA is somehow unavailable.
  function raNS() {
    if (typeof RA !== "undefined" && RA) return RA;
    if (typeof window !== "undefined" && window.RA) return window.RA;
    return null;
  }
  // Controller family ("xbox"|"ps"|"switch") of the most-recently-used pad, for platform-correct
  // labels/glyphs. Bindings stay positional; this only changes how a code is shown.
  function padFamily() {
    const ns = raNS();
    return ns && ns.padFamilyFromId ? ns.padFamilyFromId(lastPadId) : "xbox";
  }
  function codeLabel(device, code) {
    const ns = raNS();
    if (!ns || !ns.codeLabel) return code;
    return ns.codeLabel(device, code, device === "gamepad" ? padFamily() : undefined);
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
  // Four-way mode preserves the original priority exactly. Eight-way mode resolves
  // one vertical + one horizontal action into the diagonal direction ids shared by
  // the map runtime: 4=down-left, 5=down-right, 6=up-left, 7=up-right.
  function dir(eightWay) {
    if (!eightWay) {
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
    const vertical = pressed("down") ? 0 : pressed("up") ? 3 : -1;
    const horizontal = pressed("left") ? 1 : pressed("right") ? 2 : -1;
    if (vertical === 0 && horizontal === 1) return 4;
    if (vertical === 0 && horizontal === 2) return 5;
    if (vertical === 3 && horizontal === 1) return 6;
    if (vertical === 3 && horizontal === 2) return 7;
    return vertical >= 0 ? vertical : horizontal;
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
    padFamily,
    beginCapture,
    cancelCapture,
    isCapturing,
    label,
    codeLabel,
  };
}

if (typeof window !== "undefined") window.createInputSystem = createInputSystem;
