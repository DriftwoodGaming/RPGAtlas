/* RPGAtlas — src/editor/database/system-tab.ts
   The Database "System" and "Controls" tabs: game/system settings, screen &
   window options, system sounds/music, and the default key/gamepad bindings.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 3):
   logic unchanged, closure vars routed through editor-state.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, RA, Sfx, editorState as S } from "../editor-state";
import { h, tIn, nIn, sel, chk, rangeIn, field, row, dbOpts, charsetOpts, DIR_OPTS, SE_OPTS, MUSIC_OPTS } from "../dom";
import { modal, confirmBox } from "../modals";
import { touch } from "../persistence";

export function systemTab() {
  // Dynamic form editor over the system blob: indexes s.input[device][action]
  // and s[key] with runtime-string keys and writes s.party[i] = undefined
  // before filtering. Kept locally `any` — tightening these dynamic-index sites
  // is tracked in the Stage D any-debt list, not chased here (behavior-frozen).
  const s: any = S.proj.system;
  const box = h("div", { class: "dbform single" });
  box.appendChild(field("Game title", tIn(s, "title")));
  box.appendChild(row(field("Start map", sel(s, "startMapId", dbOpts(S.proj.maps))),
    field("X", nIn(s, "startX", 0, 200)), field("Y", nIn(s, "startY", 0, 200)),
    field("Facing", sel(s, "startDir", DIR_OPTS)),
    field("Start transparent", chk(s, "startTransparent"))));
  box.appendChild(h("div", { class: "dim" }, "Tip: use the “Start” mode button and click the map to set this visually. A transparent player is invisible until an event runs “Change Transparency” — handy for intro cutscenes."));
  const partyRow = h("div");
  for (let i = 0; i < 4; i++) {
    const slot = { v: s.party[i] || 0 };
    partyRow.appendChild(field("Member " + (i + 1), sel(slot, "v", dbOpts(S.proj.actors, "(empty)"), () => {
      s.party[i] = slot.v || undefined;
      s.party = s.party.filter(Boolean);
      touch();
    })));
  }
  box.appendChild(h("div", { class: "subhead" }, "Starting party"));
  box.appendChild(h("div", { class: "frow" }, partyRow));
  box.appendChild(row(field("Starting gold", nIn(s, "startGold", 0)), field("Currency name", tIn(s, "currency")),
    field("Battle view", sel(s, "battleView", [{ v: "side", l: "Side view (party sprites)" }, { v: "front", l: "Front view (classic)" }]))));
  // Battle scheduling mode (Phase 5): classic rounds, ATB gauges, or CTB order
  if (!s.battleSystem) s.battleSystem = "turn";
  box.appendChild(row(field("Battle system", sel(s, "battleSystem", [
    { v: "turn", l: "Turn-based (classic rounds)" },
    { v: "atb", l: "ATB (active-time gauges)" },
    { v: "ctb", l: "CTB (turn-order timeline)" },
  ]))));
  box.appendChild(h("div", { class: "dim" }, "ATB: gauges fill with agility; a battler acts when full (gauges pause during command input). CTB: one battler acts at a time in an agility-driven order shown at the top of the battle."));

  // ---- map systems (Phase 5 Stage C) ----
  box.appendChild(h("div", { class: "subhead" }, "Map systems"));
  if (s.followers == null) s.followers = false;
  if (s.minimap == null) s.minimap = false;
  box.appendChild(row(
    field("Party followers (members trail the player)", chk(s, "followers")),
    field("Minimap (corner map + quest tracker HUD; M toggles)", chk(s, "minimap"))));
  s.vehicles = s.vehicles && typeof s.vehicles === "object" ? s.vehicles : {};
  const vehicleRows = h("div");
  for (const [type, label] of [["boat", "Boat (shallow water)"], ["ship", "Ship (all water)"], ["airship", "Airship (flies anywhere)"]] as any[]) {
    const v = (s.vehicles[type] = s.vehicles[type] || { charset: "", mapId: 0, x: 0, y: 0, music: "none" });
    if (!v.music) v.music = "none";
    vehicleRows.appendChild(row(
      field(label + " — sprite", sel(v, "charset", charsetOpts())),
      field("Map", sel(v, "mapId", dbOpts(S.proj.maps, "(unused)"))),
      field("X", nIn(v, "x", 0, 200)), field("Y", nIn(v, "y", 0, 200)),
      field("Music while riding", sel(v, "music", MUSIC_OPTS()))));
  }
  box.appendChild(vehicleRows);
  box.appendChild(h("div", { class: "dim" }, "A vehicle needs a sprite AND a map to appear (the boat/ship/airship object sprites ship built in). Players board by facing it and pressing the action key; boats sail shallow water, ships any water, airships fly over everything and land on open ground."));

  box.appendChild(h("div", { class: "subhead" }, "Screen"));
  box.appendChild(row(field("Game width (px)", nIn(s, "screenWidth", 384, 3840)),
    field("Game height (px)", nIn(s, "screenHeight", 288, 2160)),
    field("Screen scale (max zoom)", nIn(s, "screenScale", 0.5, 4, 0.1))));
  box.appendChild(row(field("UI area width (0 = full)", nIn(s, "uiWidth", 0, 3840)),
    field("UI area height (0 = full)", nIn(s, "uiHeight", 0, 2160))));
  box.appendChild(h("div", { class: "dim" }, "The UI area centres message windows and menus inside the game screen — useful on very wide screens. Changes apply on the next playtest."));

  box.appendChild(h("div", { class: "subhead" }, "Windows & fonts"));
  const fontOpts: any = RA.FONTS.slice();
  fontOpts.stringValues = true;
  box.appendChild(row(field("Message font", sel(s, "fontText", fontOpts)),
    field("Menu font", sel(s, "fontMenu", fontOpts))));
  const windowColor = h("input", {
    type: "color",
    value: RA.normalizeWindowColor(s.windowColor),
    oninput(e: any) { s.windowColor = RA.normalizeWindowColor(e.target.value); touch(); },
  });
  box.appendChild(row(field("Font size (px)", nIn(s, "fontSize", 8, 48)),
    field("Window opacity", rangeIn(s, "windowOpacity", 0, 100, "%")),
    field("Window color", windowColor)));

  box.appendChild(h("div", { class: "subhead" }, "System sounds"));
  const seOpts: any = SE_OPTS(); // procedural + imported (Phase 6)
  const sgrid = h("div", { class: "sysgrid" });
  for (const def of RA.SYSTEM_SOUNDS) {
    sgrid.appendChild(field(def.label, h("span", { class: "frow", style: "gap:4px; flex-wrap:nowrap" },
      sel(s.sounds, def.key, seOpts),
      h("button", { class: "mini", onclick() { Sfx.play(s.sounds[def.key] || def.def); } }, "▶"))));
  }
  box.appendChild(sgrid);

  box.appendChild(h("div", { class: "subhead" }, "System music"));
  box.appendChild(row(field("Title theme", sel(s.music, "title", MUSIC_OPTS())),
    field("Battle theme", sel(s.music, "battle", MUSIC_OPTS()))));

  box.appendChild(h("div", { class: "subhead" }, "Controls"));
  box.appendChild(h("div", { class: "dim" }, "Default key & gamepad bindings now have their own “Controls” tab."));
  return box;
}

export function controlsTab() {
  // The project's DEFAULT key/gamepad bindings (proj.system.input) — the controls a NEW
  // player starts with. Mirrors the in-game rebinder; replaces the old localStorage snippet.
  // Kept `any`: setBinding/removeBinding index s.input[device][action] with runtime
  // strings (tracked in the Stage D any-debt list, not chased — behavior-frozen).
  const s: any = S.proj.system;
  const box = h("div", { class: "dbform single" });
  box.appendChild(h("div", { class: "subhead" }, "Default controls"));
  box.appendChild(h("div", { class: "dim" }, "The key/gamepad bindings a NEW player starts with. Players who change their controls in-game keep their own settings — editing these won't override them."));
  s.input = RA.mergeInputBindings(s.input, null); // normalize: guarantees every action/device array exists
  const inActLabel = (k: any) => { const a = RA.INPUT_ACTIONS.find((x: any) => x.key === k); return a ? a.label : k; };
  // Display-only controller-family preview. Bindings are stored by POSITION; switching this
  // only changes how gamepad glyphs/labels are drawn — it is NOT written to proj.system.input.
  let previewFamily = "xbox";
  const famOpts: any = RA.PAD_FAMILIES.map((f: any) => ({ v: f.key, l: f.label }));
  famOpts.stringValues = true;
  const famObj = { v: previewFamily };
  const inputWrap = h("div", { class: "input-grid-wrap" });
  box.appendChild(inputWrap);
  let inputNote: any;
  function flashNote(msg: any) { if (inputNote) inputNote.textContent = msg; }
  function setBinding(device: any, action: any, code: any) {
    // De-conflict: a code drives one action per device, so free it from any other action first.
    for (const other of RA.INPUT_ACTIONS) {
      if (other.key === action) continue;
      const oa = s.input[device][other.key];
      const idx = oa ? oa.indexOf(code) : -1;
      if (idx === -1) continue;
      if (RA.INPUT_CRITICAL.indexOf(other.key) !== -1 && oa.length <= 1) {
        flashNote(other.label + " needs a binding on this device — rebind it before reusing this one.");
        return;
      }
      oa.splice(idx, 1);
    }
    const arr = s.input[device][action];
    if (arr.indexOf(code) === -1) arr.push(code);
    touch();
    renderInputGrid();
  }
  function removeBinding(device: any, action: any, i: any) {
    const arr = s.input[device][action];
    if (RA.INPUT_CRITICAL.indexOf(action) !== -1 && arr.length <= 1) {
      flashNote(inActLabel(action) + " must keep at least one binding on each device.");
      return;
    }
    arr.splice(i, 1);
    touch();
    renderInputGrid();
  }
  function captureKey(action: any) {
    let done = false;
    function cleanup() { if (!done) { done = true; document.removeEventListener("keydown", onKey, true); } }
    function onKey(e: any) {
      e.preventDefault();
      e.stopPropagation();
      const code = e.code;
      cleanup();
      m.close();
      if (code && code !== "Escape") setBinding("keyboard", action, code);
    }
    const m = modal({
      title: "Bind " + inActLabel(action) + " (keyboard)",
      content: h("div", { class: "capture-note" }, "Press any key…  (Esc cancels)"),
      buttons: [{ label: "Cancel" }],
      onClose: cleanup,
    });
    document.addEventListener("keydown", onKey, true);
  }
  function pickGamepad(action: any) {
    const codes = RA.PAD_BUTTONS.concat(["lstick_up", "lstick_down", "lstick_left", "lstick_right"]);
    const list = h("div", { class: "pad-pick" });
    // eslint-disable-next-line prefer-const -- assigned below (after a closure captures it); kept `let` verbatim
    let m: any;
    codes.forEach((code: any) => {
      list.appendChild(h("button", { class: "pad-pick-btn", onclick() { m.close(); setBinding("gamepad", action, code); } },
        h("img", { class: "bind-glyph", src: Assets.inputGlyphDataUrl("gamepad", code, previewFamily), alt: "" }),
        h("span", null, RA.codeLabel("gamepad", code, previewFamily))));
    });
    m = modal({ title: "Bind " + inActLabel(action) + " (gamepad)", content: list, buttons: [{ label: "Cancel" }] });
  }
  function bindCell(device: any, action: any) {
    const cell = h("div", { class: "bind-cell" });
    const arr = s.input[device][action] || [];
    const fam = device === "gamepad" ? previewFamily : undefined;
    arr.forEach((code: any, i: any) => {
      cell.appendChild(h("span", { class: "bind-chip" },
        h("img", { class: "bind-glyph", src: Assets.inputGlyphDataUrl(device, code, fam), alt: RA.codeLabel(device, code, fam), title: RA.codeLabel(device, code, fam) }),
        h("button", { class: "bind-x", title: "Remove", onclick() { removeBinding(device, action, i); } }, "×")));
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- verbatim ternary-as-statement dispatch
    cell.appendChild(h("button", { class: "bind-add", title: "Add binding", onclick() { device === "keyboard" ? captureKey(action) : pickGamepad(action); } }, "+"));
    return cell;
  }
  function renderInputGrid() {
    inputWrap.innerHTML = "";
    const grid = h("div", { class: "input-grid" });
    grid.appendChild(h("div", { class: "input-row input-head" },
      h("div", { class: "input-act" }, "Action"),
      h("div", { class: "bind-cell" }, "Keyboard"),
      h("div", { class: "bind-cell gp-head" },
        h("span", { class: "gp-head-label" }, "Gamepad"),
        h("label", { class: "gp-preview" }, h("span", null, "Preview"),
          sel(famObj, "v", famOpts, () => { previewFamily = famObj.v; renderInputGrid(); })))));
    for (const a of RA.INPUT_ACTIONS) {
      grid.appendChild(h("div", { class: "input-row" },
        h("div", { class: "input-act" }, a.label),
        bindCell("keyboard", a.key),
        bindCell("gamepad", a.key)));
    }
    inputWrap.appendChild(grid);
    inputWrap.appendChild(h("div", { class: "dim", style: "margin-top:2px" }, "Gamepad glyphs preview the controller chosen above; in-game they auto-detect the player's. Bindings stay positional — switching the preview doesn't change them."));
    inputNote = h("div", { class: "input-note" });
    inputWrap.appendChild(inputNote);
    inputWrap.appendChild(h("div", { class: "frow", style: "margin-top:6px" },
      h("button", { class: "mini", onclick() {
        confirmBox("Reset all controls to the engine defaults?", () => { s.input = RA.defaultInput(); touch(); renderInputGrid(); });
      } }, "Reset to defaults")));
  }
  renderInputGrid();
  return box;
}
