/* RPGAtlas — editor.js
   Map editor, event editor, database editor.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
"use strict";

import * as host from "../../js/editor/host.js";
import { PATCH_NOTES } from "../../js/patch-notes.js?v=4";
import {
  Assets, AtlasBuiltins, DataDefaults, GLRender, Music, RA, Sfx,
  editorI18n,
  TILE, LAYER_ORDER, LAYER_LABELS, TOOL_LABELS, ZOOMS,
  editorState as S,
  editorHooks,
  curMap,
} from "./editor-state";
import {
  $, h, esc, tIn, nIn, sel, chk, rangeIn, field, row,
  dbOpts, switchOpts, varOpts, cmpOpts, charsetOpts,
  DIR_OPTS, SE_NAMES, MUSIC_OPTS,
  elementSelOpts, skillTypeSelOpts, typeSelOpts, stringSelOpts,
} from "./dom";
import { modalRoot, modal, confirmBox, closePopupMenu, showPopupMenu } from "./modals";
import {
  touch, saveNow, loadStored, desktopSave, exportProject,
  openStandaloneExport, importProject,
} from "./persistence";
import { renderMap, renderPalette, effectivePass, normRect } from "./map-editor/map-render";
import { pushUndo, undo, redo, snapshotOf, applySnapshot } from "./map-editor/history";
import {
  eventAt, heightsOf, newEventAt, deleteSelectedEvent, openCanvasMenu,
  onCanvasDown, onCanvasMove, onCanvasUp, onCanvasDbl,
  cellFromMouse, topLayerAt, getCell,
} from "./map-editor/painting";
import { canCopy, copySelection, startPaste, clearSelection } from "./map-editor/clipboard";
import { setStatus, flashStatus } from "./map-editor/status";
import { rebuildMapList, addMap, deleteMap, openMapGenProps, openMapProps } from "./map-editor/map-list";
import { toggleHdPreview, isHdPreviewOpen } from "./map-editor/hd-preview";
import { openLocationPicker } from "./event-editor/location-picker";

(() => {
  const t = editorI18n.t;

  function playtestUrl() { return "play.html?playtest=" + Date.now(); }

  // Cross-boundary hook registrations: functions that still live in this
  // closure but are called from the extracted modules (see editor-state.ts).
  // Function declarations hoist, so registering here is safe.
  Object.assign(editorHooks, {
    refreshToolbar,
    setMode,
    rebuildAll,
    openEventEditor,
    quickTransfer,
    quickSign,
    quickChest,
    walkCommands,
  });

  function skillTypeTraitOpts() {
    const st = RA.typeList(S.proj, "skillTypes");
    const o = TRAIT_SKILL_TYPES.map((d) => {
      const f = st.find((s) => s.key === d.v);
      return { v: d.v, l: f ? f.name + " skills" : d.l };
    });
    o.stringValues = true;
    return o;
  }







  // ---- quick-event builders ----
  // Build a page from the defaults, merging cond onto (not over) the default cond.
  function mkPage(opts, commands) {
    const p = DataDefaults.newPage();
    opts = opts || {};
    if (opts.cond) Object.assign(p.cond, opts.cond);
    for (const k in opts) if (k !== "cond") p[k] = opts[k];
    p.commands = commands || [];
    return p;
  }
  function placeQuickEvent(cell, name, pages) {
    if (eventAt(cell.x, cell.y)) { flashStatus("That cell already has an event"); return null; }
    pushUndo();
    const ev = DataDefaults.newEvent(RA.nextId(curMap().events), cell.x, cell.y, name);
    ev.pages = pages;
    curMap().events.push(ev);
    S.selectedEvent = ev;
    touch(); renderMap(); refreshToolbar();
    return ev;
  }
  function quickSign(cell) {
    if (eventAt(cell.x, cell.y)) { flashStatus("That cell already has an event"); return; }
    // Like Transfer/Chest: collect the content in a small dialog (here, the Show Text editor),
    // then build & place the event — no detour through the full event editor.
    const c = { t: "text", name: "", face: "", text: "" };
    // editCommand(cmd, onOK, skipSnapshot, snapFn, onCancel): skip the editor's own undo snapshot
    // (placeQuickEvent pushes one) and, on Cancel, do nothing so no empty event is left behind.
    editCommand(c, () => {
      placeQuickEvent(cell, "Sign", [
        mkPage({ charset: "sign", trigger: "action" }, [c]),
      ]);
    }, true, null, () => {});
  }
  function quickTransfer(cell) {
    if (eventAt(cell.x, cell.y)) { flashStatus("That cell already has an event"); return; }
    const w = { mapId: S.proj.maps[0] ? S.proj.maps[0].id : 0, x: 0, y: 0, dir: 0 };
    // Keep refs to the Map/X/Y inputs so the visual picker can write back into them
    // (mirrors the full Transfer Player command form's "Pick destination" button).
    const mapSel = sel(w, "mapId", dbOpts(S.proj.maps));
    const xIn = nIn(w, "x", 0);
    const yIn = nIn(w, "y", 0);
    const content = h("div", null,
      row(field("Map", mapSel), field("X", xIn), field("Y", yIn),
        field("Facing", sel(w, "dir", DIR_OPTS))),
      h("button", { class: "mini", onclick() {
        openLocationPicker(w.mapId, w.x, w.y, (res) => {
          w.mapId = res.mapId; w.x = res.x; w.y = res.y;
          mapSel.value = String(res.mapId); xIn.value = res.x; yIn.value = res.y;
        });
      } }, "📍 Pick destination on map…"));
    modal({
      title: "New Transfer Event",
      content,
      buttons: [
        { label: "Create", primary: true, onClick(close) {
          close();
          placeQuickEvent(cell, "Transfer", [
            mkPage({ charset: "", trigger: "touch", priority: "below", through: true },
              [{ t: "transfer", mapId: w.mapId, x: w.x, y: w.y, dir: w.dir }]),
          ]);
        } },
        { label: "Cancel" },
      ],
      dialogKeys: true,
    });
  }
  function quickChest(cell) {
    if (eventAt(cell.x, cell.y)) { flashStatus("That cell already has an event"); return; }
    const w = { kind: "item", id: S.proj.items[0] ? S.proj.items[0].id : 0, val: 1 };
    const entryWrap = h("span");
    function redrawEntry() {
      const isGold = w.kind === "gold";
      const arr = w.kind === "weapon" ? S.proj.weapons : w.kind === "armor" ? S.proj.armors : S.proj.items;
      if (!isGold) w.id = arr[0] ? arr[0].id : 0; // keep id valid when kind changes
      entryWrap.innerHTML = "";
      entryWrap.appendChild(isGold ? h("span", null, "—") : sel(w, "id", dbOpts(arr)));
    }
    const content = h("div", null,
      row(field("Kind", sel(w, "kind",
          [{ v: "item", l: "Item" }, { v: "weapon", l: "Weapon" }, { v: "armor", l: "Armor" }, { v: "gold", l: "Gold" }],
          redrawEntry)),
        field("Entry", entryWrap),
        field("Amount", nIn(w, "val", 1, 9999))));
    redrawEntry();
    modal({
      title: "New Chest",
      content,
      buttons: [
        { label: "Create", primary: true, onClick(close) {
          close();
          const give = w.kind === "gold"
            ? { t: "gold", op: "add", val: w.val }
            : { t: "item", kind: w.kind, id: w.id, op: "add", val: w.val };
          const label = w.kind === "gold" ? (w.val + " Gold") : ("×" + w.val);
          placeQuickEvent(cell, "Chest", [
            mkPage({ charset: "chest", trigger: "action" }, [
              { t: "se", name: "chest" },
              give,
              { t: "text", name: "", text: "Found " + label + "!" },
              { t: "selfsw", key: "A", val: true },
            ]),
            mkPage({ cond: { selfSw: "A" }, charset: "chest_open", trigger: "action" }, []),
          ]);
        } },
        { label: "Cancel" },
      ],
      dialogKeys: true,
    });
  }





  // ============================ command definitions ============================
  function cmdSummary(c) {
    const swName = (id) => id + (S.proj.system.switches[id - 1] ? " (" + S.proj.system.switches[id - 1] + ")" : "");
    const varName = (id) => id + (S.proj.system.variables[id - 1] ? " (" + S.proj.system.variables[id - 1] + ")" : "");
    const dbName = (arr, id) => { const e = RA.byId(arr, id); return e ? e.name : "#" + id; };
    const questName = (id) => dbName(S.proj.quests || [], id);
    const commonEventName = (id) => dbName(S.proj.commonEvents || [], id);
    const questObjName = (questId, objIndex) => {
      const q = RA.byId(S.proj.quests || [], questId);
      const obj = q && Array.isArray(q.objectives) ? q.objectives[objIndex] : null;
      return obj ? (obj.label || obj.kind || ("Objective " + (objIndex + 1))) : ("Objective " + (objIndex + 1));
    };
    switch (c.t) {
      case "text": return "Text" + (c.name ? " [" + c.name + "]" : "") + (c.face ? " (face)" : "") + ": " + c.text.split("\n")[0].slice(0, 42);
      case "choices": return "Show Choices: " + c.options.join(" / ");
      case "switch": return "Switch " + swName(c.id) + " = " + (c.val ? "ON" : "OFF");
      case "selfsw": return "Self-Switch " + c.key + " = " + (c.val ? "ON" : "OFF");
      case "var": return "Variable " + varName(c.id) + " " + (c.op === "set" ? "=" : c.op === "add" ? "+=" : c.op === "sub" ? "−=" : "= rnd") + " " + c.val + (c.op === "rnd" ? ".." + (c.val2 || c.val) : "");
      case "if": {
        const k = c.cond.kind;
        let d = k === "switch" ? "Switch " + swName(c.cond.id) + (c.cond.val === false ? " is OFF" : " is ON")
          : k === "var" ? "Var " + varName(c.cond.id) + " " + (c.cond.cmp || ">=") + " " + c.cond.val
          : k === "selfsw" ? "Self-Switch " + c.cond.key + " is ON"
          : k === "quest" ? "Quest " + questName(c.cond.questId) + " is " + (c.cond.status || "active")
          : k === "item" ? "Has " + dbName(c.cond.itemKind === "weapon" ? S.proj.weapons : c.cond.itemKind === "armor" ? S.proj.armors : S.proj.items, c.cond.id)
          : "Gold " + (c.cond.cmp || ">=") + " " + c.cond.val;
        return "If " + d;
      }
      case "questStart": return "Start Quest: " + questName(c.questId);
      case "questAdvanceObj": return "Advance Objective: " + questName(c.questId) + " — " + questObjName(c.questId, c.objIndex) + " +" + (c.amount || 1);
      case "questSetObj": return "Set Objective: " + questName(c.questId) + " — " + questObjName(c.questId, c.objIndex) + " = " + (c.value || 0);
      case "questComplete": return "Complete Quest: " + questName(c.questId);
      case "questFail": return "Fail Quest: " + questName(c.questId);
      case "commonEvent": return "Call Common Event: " + commonEventName(c.commonEventId);
      case "transfer": { const m = RA.byId(S.proj.maps, c.mapId); return "Transfer → " + (m ? m.name : "?") + " (" + c.x + "," + c.y + ")"; }
      case "gold": return (c.op === "sub" ? "Lose" : "Gain") + " " + c.val + " " + S.proj.system.currency;
      case "item": return (c.op === "sub" ? "Lose" : "Gain") + " " + dbName(c.kind === "weapon" ? S.proj.weapons : c.kind === "armor" ? S.proj.armors : S.proj.items, c.id) + " ×" + c.val;
      case "party": return (c.op === "add" ? "Add" : "Remove") + " party member: " + dbName(S.proj.actors, c.actorId);
      case "heal": return c.full ? "Recover All" : "Heal " + (c.hp || 0) + " HP / " + (c.mp || 0) + " MP";
      case "battle": return "Battle: " + dbName(S.proj.troops, c.troopId) + (c.escape === false ? " (no escape)" : "") + (c.lose ? " (lose allowed)" : "");
      case "shop": return "Open Shop (" + (c.goods || []).length + " goods)";
      case "wait": return "Wait " + c.frames + " frames";
      case "se": return "Sound: " + c.name;
      case "music": return "Music: " + c.theme;
      case "move": return "Move " + (c.target === "player" ? "Player" : "This Event") + ": " + c.steps.join(", ").slice(0, 40) + (c.wait ? " (wait)" : "");
      case "cameraZoom": return "Camera Zoom: " + Math.round((c.zoom || 1) * 100) + "% over " + (c.frames || 0) + " frames";
      case "transparency": return "Player Transparency: " + (c.val ? "hidden" : "visible");
      case "erase": return "Erase This Event";
      case "save": return "Open Save Screen";
      case "gameover": return "Game Over";
      case "totitle": return "Return to Title";
      case "script": return "Script: " + (c.code || "").split("\n")[0].slice(0, 42);
      default: return c.t;
    }
  }

  // Collapsible reminder of the message control codes, shown under Show Text / Show Choices so
  // authors can recall what to type. The \input[...] action list is read from RA.INPUT_ACTIONS,
  // so it stays in sync (and will auto-include any future custom actions).
  function textCodesHelp() {
    const acts = (RA.INPUT_ACTIONS || []).map((a) => a.key).join(", ");
    const rows = [
      ["\\v[n]", "variable value"],
      ["\\n[n]", "actor name"],
      ["\\g", "gold amount"],
      ["\\input[action]", "button glyph for a control (action: " + acts + ")"],
      ["\\i[n]", "inline icon"],
      ["\\c[n] · \\c[#hex]", "text color"],
      ["[b]…[/b] · [i]…[/i]", "bold / italic"],
      ["[color=#hex]…[/color] · [size=n]…[/size]", "color / size"],
    ];
    return h("details", { class: "code-legend" },
      h("summary", null, "Text codes"),
      h("ul", { class: "code-legend-list" },
        ...rows.map(([code, desc]) =>
          h("li", null, h("code", null, code), h("span", { class: "cl-desc" }, " — " + desc)))),
      h("div", { class: "cl-note" },
        "\\i, \\c and the [b]/[i]/[color]/[size] tags need the Atlas_TextCodes plugin (on by default)."));
  }

  // each entry: label, make(), form(c, box) -> apply()
  const CMD_DEFS = [
    { t: "text", label: "Show Text", make: () => ({ t: "text", name: "", face: "", text: "" }),
      form(c, box) {
        const w = { name: c.name, face: c.face || "", text: c.text };
        const preview = h("span", { class: "char-preview" });
        function redrawFace() {
          preview.innerHTML = "";
          const ci = Assets.charsetIndex(w.face);
          if (ci >= 0) preview.appendChild(Assets.faceCanvas(ci));
        }
        const ta = h("textarea", { rows: 4, oninput(e) { w.text = e.target.value; } }, c.text);
        box.appendChild(row(field("Speaker name (optional)", tIn(w, "name")),
          field("Face (optional)", sel(w, "face", charsetOpts(true), redrawFace)), preview));
        box.appendChild(field("Text", ta));
        box.appendChild(textCodesHelp());
        redrawFace();
        return () => { c.name = w.name; c.face = w.face; c.text = w.text; };
      } },
    { t: "choices", label: "Show Choices", make: () => ({ t: "choices", options: ["Yes", "No"], branches: [[], []] }),
      form(c, box) {
        const ta = h("textarea", { rows: 4 }, c.options.join("\n"));
        box.appendChild(field("Choices (one per line)", ta));
        box.appendChild(textCodesHelp());
        return () => {
          const opts = ta.value.split("\n").map((s) => s.trim()).filter(Boolean);
          if (!opts.length) opts.push("OK");
          const br = opts.map((_, i) => c.branches[i] || []);
          c.options = opts; c.branches = br;
        };
      } },
    { t: "if", label: "Conditional Branch", make: () => ({ t: "if", cond: { kind: "switch", id: 1, val: true }, then: [], else: [] }),
      form(c, box) {
        const w = RA.clone(c.cond);
        if (!w.kind) w.kind = "switch";
        const sub = h("div");
        function redraw() {
          sub.innerHTML = "";
          if (w.kind === "switch") {
            sub.appendChild(row(field("Switch", sel(w, "id", switchOpts())), field("Is", sel(w, "val", [{ v: "true", l: "ON" }, { v: "false", l: "OFF" }]))));
          } else if (w.kind === "var") {
            sub.appendChild(row(field("Variable", sel(w, "id", varOpts())),
              field("Cmp", sel(w, "cmp", cmpOpts())),
              field("Value", nIn(w, "val"))));
          } else if (w.kind === "selfsw") {
            sub.appendChild(field("Self-Switch", sel(w, "key", [{ v: "A", l: "A" }, { v: "B", l: "B" }, { v: "C", l: "C" }, { v: "D", l: "D" }])));
          } else if (w.kind === "quest") {
            sub.appendChild(row(field("Quest", sel(w, "questId", dbOpts(S.proj.quests, "(none)"))),
              field("Status", sel(w, "status", stringSelOpts(["inactive", "active", "completed", "failed", "abandoned"])))));
          } else if (w.kind === "item") {
            const kindSel = sel(w, "itemKind", [{ v: "item", l: "Item" }, { v: "weapon", l: "Weapon" }, { v: "armor", l: "Armor" }], redrawItem);
            sub.appendChild(row(field("Kind", kindSel), field("Entry", h("span", { id: "ifitem" }))));
            redrawItem();
            function redrawItem() {
              const arr = w.itemKind === "weapon" ? S.proj.weapons : w.itemKind === "armor" ? S.proj.armors : S.proj.items;
              const span = sub.querySelector("#ifitem") || sub;
              span.innerHTML = "";
              span.appendChild(sel(w, "id", dbOpts(arr)));
            }
          } else if (w.kind === "actor") {
            if (!w.actorId) w.actorId = S.proj.actors[0] ? S.proj.actors[0].id : 1;
            if (!w.check) w.check = "inParty";
            if (w.itemId == null) w.itemId = 0;
            const checkSel = sel(w, "check", [
              { v: "inParty", l: "Is in Party" },
              { v: "weapon", l: "Has Weapon Equipped" },
              { v: "armor", l: "Has Armor Equipped" }
            ], redrawActorCheck);
            const itemSpan = h("span", { id: "actoritem" });
            sub.appendChild(row(
              field("Actor", sel(w, "actorId", dbOpts(S.proj.actors))),
              field("Check", checkSel),
              field("Equipment", itemSpan)
            ));
            redrawActorCheck();
            function redrawActorCheck() {
              const span = sub.querySelector("#actoritem") || itemSpan;
              span.innerHTML = "";
              if (w.check === "weapon") {
                span.appendChild(sel(w, "itemId", dbOpts(S.proj.weapons, "(none)")));
              } else if (w.check === "armor") {
                span.appendChild(sel(w, "itemId", dbOpts(S.proj.armors, "(none)")));
              } else {
                span.appendChild(h("span", { class: "dim" }, "N/A"));
              }
            }
          } else {
            sub.appendChild(row(field("Gold", sel(w, "cmp", [{ v: ">=", l: "≥" }, { v: "<=", l: "≤" }])), field("Value", nIn(w, "val"))));
          }
        }
        box.appendChild(field("Condition type", sel(w, "kind", [
          { v: "switch", l: "Switch" }, { v: "var", l: "Variable" }, { v: "selfsw", l: "Self-Switch" },
          { v: "quest", l: "Quest Status" }, { v: "item", l: "Has item" }, { v: "gold", l: "Gold" }, { v: "actor", l: "Actor" }
        ], redraw)));
        if (w.kind === "item" && !w.itemKind) w.itemKind = "item";
        if (w.kind === "selfsw" && !w.key) w.key = "A";
        if (w.kind === "quest") {
          if (w.questId == null) w.questId = 0;
          if (!w.status) w.status = "active";
        }
        box.appendChild(sub);
        redraw();
        return () => {
          if (w.val === "true") w.val = true;
          if (w.val === "false") w.val = false;
          c.cond = w;
          if (!c.then) c.then = [];
          if (!c.else) c.else = [];
        };
      } },
    { t: "questStart", label: "Start Quest", make: () => ({ t: "questStart", questId: S.proj.quests[0] ? S.proj.quests[0].id : 0 }),
      form(c, box) {
        const w = { questId: c.questId || (S.proj.quests[0] ? S.proj.quests[0].id : 0) };
        box.appendChild(field("Quest", sel(w, "questId", dbOpts(S.proj.quests, "(none)"))));
        return () => { c.questId = w.questId; };
      } },
    { t: "questAdvanceObj", label: "Advance Quest Objective", make: () => ({ t: "questAdvanceObj", questId: S.proj.quests[0] ? S.proj.quests[0].id : 0, objIndex: 0, amount: 1 }),
      form(c, box) {
        const w = { questId: c.questId || (S.proj.quests[0] ? S.proj.quests[0].id : 0), objIndex: c.objIndex || 0, amount: c.amount || 1 };
        const objWrap = h("span");
        function redrawObj() {
          const q = RA.byId(S.proj.quests, w.questId);
          const opts = (q && q.objectives && q.objectives.length ? q.objectives : [{ label: "(none)" }]).map((obj, i) => ({ v: i, l: (i + 1) + ": " + (obj.label || obj.kind || "Objective") }));
          objWrap.innerHTML = "";
          objWrap.appendChild(sel(w, "objIndex", opts));
        }
        redrawObj();
        box.appendChild(row(field("Quest", sel(w, "questId", dbOpts(S.proj.quests, "(none)"), redrawObj)), field("Objective", objWrap), field("Amount", nIn(w, "amount", 1, 999))));
        return () => Object.assign(c, w);
      } },
    { t: "questSetObj", label: "Set Quest Objective Progress", make: () => ({ t: "questSetObj", questId: S.proj.quests[0] ? S.proj.quests[0].id : 0, objIndex: 0, value: 0 }),
      form(c, box) {
        const w = { questId: c.questId || (S.proj.quests[0] ? S.proj.quests[0].id : 0), objIndex: c.objIndex || 0, value: c.value || 0 };
        const objWrap = h("span");
        function redrawObj() {
          const q = RA.byId(S.proj.quests, w.questId);
          const opts = (q && q.objectives && q.objectives.length ? q.objectives : [{ label: "(none)" }]).map((obj, i) => ({ v: i, l: (i + 1) + ": " + (obj.label || obj.kind || "Objective") }));
          objWrap.innerHTML = "";
          objWrap.appendChild(sel(w, "objIndex", opts));
        }
        redrawObj();
        box.appendChild(row(field("Quest", sel(w, "questId", dbOpts(S.proj.quests, "(none)"), redrawObj)), field("Objective", objWrap), field("Value", nIn(w, "value", 0, 999))));
        return () => Object.assign(c, w);
      } },
    { t: "questComplete", label: "Complete Quest", make: () => ({ t: "questComplete", questId: S.proj.quests[0] ? S.proj.quests[0].id : 0 }),
      form(c, box) {
        const w = { questId: c.questId || (S.proj.quests[0] ? S.proj.quests[0].id : 0) };
        box.appendChild(field("Quest", sel(w, "questId", dbOpts(S.proj.quests, "(none)"))));
        return () => { c.questId = w.questId; };
      } },
    { t: "questFail", label: "Fail Quest", make: () => ({ t: "questFail", questId: S.proj.quests[0] ? S.proj.quests[0].id : 0 }),
      form(c, box) {
        const w = { questId: c.questId || (S.proj.quests[0] ? S.proj.quests[0].id : 0) };
        box.appendChild(field("Quest", sel(w, "questId", dbOpts(S.proj.quests, "(none)"))));
        return () => { c.questId = w.questId; };
      } },
    { t: "commonEvent", label: "Call Common Event", make: () => ({ t: "commonEvent", commonEventId: S.proj.commonEvents[0] ? S.proj.commonEvents[0].id : 0 }),
      form(c, box) {
        const w = { commonEventId: c.commonEventId || (S.proj.commonEvents[0] ? S.proj.commonEvents[0].id : 0) };
        box.appendChild(field("Common event", sel(w, "commonEventId", dbOpts(S.proj.commonEvents, "(none)"))));
        return () => { c.commonEventId = w.commonEventId; };
      } },
    { t: "switch", label: "Control Switch", make: () => ({ t: "switch", id: 1, val: true }),
      form(c, box) {
        const w = { id: c.id, val: String(c.val) };
        box.appendChild(row(field("Switch", sel(w, "id", switchOpts())), field("Set", sel(w, "val", [{ v: "true", l: "ON" }, { v: "false", l: "OFF" }]))));
        return () => { c.id = w.id; c.val = w.val === "true"; };
      } },
    { t: "selfsw", label: "Control Self-Switch", make: () => ({ t: "selfsw", key: "A", val: true }),
      form(c, box) {
        const w = { key: c.key, val: String(c.val) };
        box.appendChild(row(field("Key", sel(w, "key", [{ v: "A", l: "A" }, { v: "B", l: "B" }, { v: "C", l: "C" }, { v: "D", l: "D" }])),
          field("Set", sel(w, "val", [{ v: "true", l: "ON" }, { v: "false", l: "OFF" }]))));
        return () => { c.key = w.key; c.val = w.val === "true"; };
      } },
    { t: "var", label: "Control Variable", make: () => ({ t: "var", id: 1, op: "set", val: 0, val2: 0 }),
      form(c, box) {
        const w = { id: c.id, op: c.op, val: c.val, val2: c.val2 || 0 };
        box.appendChild(row(field("Variable", sel(w, "id", varOpts())),
          field("Op", sel(w, "op", [{ v: "set", l: "Set =" }, { v: "add", l: "Add +" }, { v: "sub", l: "Sub −" }, { v: "rnd", l: "Random" }])),
          field("Value", nIn(w, "val")), field("…to (random)", nIn(w, "val2"))));
        return () => Object.assign(c, w);
      } },
    { t: "transfer", label: "Transfer Player", make: () => ({ t: "transfer", mapId: 1, x: 0, y: 0, dir: 0 }),
      form(c, box) {
        const w = { mapId: c.mapId, x: c.x, y: c.y, dir: c.dir == null ? 0 : c.dir };
        const mapSel = sel(w, "mapId", dbOpts(S.proj.maps));
        const xIn = nIn(w, "x", 0, 200);
        const yIn = nIn(w, "y", 0, 200);
        box.appendChild(row(field("Map", mapSel), field("X", xIn), field("Y", yIn), field("Facing", sel(w, "dir", DIR_OPTS))));
        box.appendChild(h("button", { class: "mini", onclick() {
          openLocationPicker(w.mapId, w.x, w.y, (res) => {
            w.mapId = res.mapId; w.x = res.x; w.y = res.y;
            mapSel.value = String(res.mapId); xIn.value = res.x; yIn.value = res.y;
          });
        } }, "📍 Pick destination on map…"));
        return () => Object.assign(c, w);
      } },
    { t: "gold", label: "Change Gold", make: () => ({ t: "gold", op: "add", val: 100 }),
      form(c, box) {
        const w = { op: c.op, val: c.val };
        box.appendChild(row(field("Op", sel(w, "op", [{ v: "add", l: "Gain" }, { v: "sub", l: "Lose" }])), field("Amount", nIn(w, "val", 0))));
        return () => Object.assign(c, w);
      } },
    { t: "item", label: "Change Items", make: () => ({ t: "item", kind: "item", id: 1, op: "add", val: 1 }),
      form(c, box) {
        const w = { kind: c.kind || "item", id: c.id, op: c.op, val: c.val };
        const entryWrap = h("span");
        function redraw() {
          const arr = w.kind === "weapon" ? S.proj.weapons : w.kind === "armor" ? S.proj.armors : S.proj.items;
          entryWrap.innerHTML = "";
          entryWrap.appendChild(sel(w, "id", dbOpts(arr)));
        }
        box.appendChild(row(field("Kind", sel(w, "kind", [{ v: "item", l: "Item" }, { v: "weapon", l: "Weapon" }, { v: "armor", l: "Armor" }], redraw)),
          field("Entry", entryWrap),
          field("Op", sel(w, "op", [{ v: "add", l: "Gain" }, { v: "sub", l: "Lose" }])), field("Count", nIn(w, "val", 1, 99))));
        redraw();
        return () => Object.assign(c, w);
      } },
    { t: "party", label: "Change Party", make: () => ({ t: "party", op: "add", actorId: 1 }),
      form(c, box) {
        const w = { op: c.op, actorId: c.actorId };
        box.appendChild(row(field("Op", sel(w, "op", [{ v: "add", l: "Add" }, { v: "remove", l: "Remove" }])),
          field("Actor", sel(w, "actorId", dbOpts(S.proj.actors)))));
        return () => Object.assign(c, w);
      } },
    { t: "heal", label: "Heal Party", make: () => ({ t: "heal", full: true, hp: 0, mp: 0 }),
      form(c, box) {
        const w = { full: !!c.full, hp: c.hp || 0, mp: c.mp || 0 };
        box.appendChild(row(field("Full recovery", chk(w, "full")), field("…or HP", nIn(w, "hp", 0)), field("MP", nIn(w, "mp", 0))));
        return () => Object.assign(c, w);
      } },
    { t: "battle", label: "Start Battle", make: () => ({ t: "battle", troopId: 1, escape: true, lose: false }),
      form(c, box) {
        const w = { troopId: c.troopId, escape: c.escape !== false, lose: !!c.lose };
        box.appendChild(row(field("Troop", sel(w, "troopId", dbOpts(S.proj.troops))),
          field("Can escape", chk(w, "escape")), field("Continue on loss", chk(w, "lose"))));
        return () => { c.troopId = w.troopId; c.escape = w.escape; c.lose = w.lose; };
      } },
    { t: "shop", label: "Open Shop", make: () => ({ t: "shop", goods: [] }),
      form(c, box) {
        const goods = RA.clone(c.goods || []);
        const list = h("div", { class: "minilist" });
        function redraw() {
          list.innerHTML = "";
          goods.forEach((gd, i) => {
            const arr = gd.kind === "weapon" ? S.proj.weapons : gd.kind === "armor" ? S.proj.armors : S.proj.items;
            const e = RA.byId(arr, gd.id);
            list.appendChild(h("div", { class: "minirow" },
              h("span", null, gd.kind + ": " + (e ? e.name : "?")),
              h("button", { class: "mini", onclick() { goods.splice(i, 1); redraw(); } }, "✕")));
          });
          const pick = { kind: "item", id: S.proj.items.length ? S.proj.items[0].id : 0 };
          const entry = h("span");
          function redrawEntry() {
            const arr = pick.kind === "weapon" ? S.proj.weapons : pick.kind === "armor" ? S.proj.armors : S.proj.items;
            pick.id = arr.length ? arr[0].id : 0;
            entry.innerHTML = "";
            entry.appendChild(sel(pick, "id", dbOpts(arr)));
          }
          redrawEntry();
          list.appendChild(h("div", { class: "minirow" },
            sel(pick, "kind", [{ v: "item", l: "Item" }, { v: "weapon", l: "Weapon" }, { v: "armor", l: "Armor" }], redrawEntry),
            entry,
            h("button", { class: "mini", onclick() { if (pick.id) { goods.push({ kind: pick.kind, id: pick.id }); redraw(); } } }, "+ add")));
        }
        redraw();
        box.appendChild(h("div", { class: "fld" }, h("span", null, "Goods"), list));
        return () => { c.goods = goods; };
      } },
    { t: "wait", label: "Wait", make: () => ({ t: "wait", frames: 60 }),
      form(c, box) {
        const w = { frames: c.frames };
        box.appendChild(field("Frames (60 = 1 second)", nIn(w, "frames", 1, 6000)));
        return () => Object.assign(c, w);
      } },
    { t: "se", label: "Play Sound", make: () => ({ t: "se", name: "ok" }),
      form(c, box) {
        const w = { name: c.name };
        const s = sel(w, "name", SE_NAMES.map((n) => ({ v: n, l: n })));
        s.options[0].parentNode.stringValues = true;
        box.appendChild(row(field("Sound", s), h("button", { class: "mini", onclick() { Sfx.play(w.name); } }, "▶ test")));
        return () => { c.name = w.name; };
      } },
    { t: "music", label: "Change Music", make: () => ({ t: "music", theme: "field" }),
      form(c, box) {
        const w = { theme: c.theme };
        box.appendChild(field("Theme", sel(w, "theme", MUSIC_OPTS())));
        return () => { c.theme = w.theme; };
      } },
    { t: "move", label: "Set Move Route", make: () => ({ t: "move", target: "this", steps: [], wait: true }),
      form(c, box) {
        const w = { target: c.target, wait: !!c.wait };
        const steps = c.steps.slice();
        const chipBox = h("div", { class: "minilist" });
        const STEPS = ["up", "down", "left", "right", "forward", "turn_up", "turn_down", "turn_left", "turn_right", "wait15", "wait60"];
        function redraw() {
          chipBox.innerHTML = "";
          steps.forEach((s, i) => chipBox.appendChild(h("span", { class: "chip", onclick() { steps.splice(i, 1); redraw(); }, title: "click to remove" }, s)));
          const pick = { s: "up" };
          const selEl = sel(pick, "s", STEPS.map((s) => ({ v: s, l: s })));
          chipBox.appendChild(h("div", { class: "minirow" }, selEl,
            h("button", { class: "mini", onclick() { steps.push(pick.s); redraw(); } }, "+ add")));
        }
        redraw();
        box.appendChild(row(field("Target", sel(w, "target", [{ v: "this", l: "This Event" }, { v: "player", l: "Player" }])),
          field("Wait for finish", chk(w, "wait"))));
        box.appendChild(h("div", { class: "fld" }, h("span", null, "Steps (click a chip to remove)"), chipBox));
        return () => { c.target = w.target; c.wait = w.wait; c.steps = steps; };
      } },
    { t: "cameraZoom", label: "Camera Zoom", make: () => ({ t: "cameraZoom", zoom: 1, frames: 30 }),
      form(c, box) {
        const w = { zoom: c.zoom == null ? 1 : c.zoom, frames: c.frames || 0 };
        box.appendChild(row(
          field("Zoom (0.25 = out, 1 = normal, 4 = in)", nIn(w, "zoom", 0.25, 4, 0.05)),
          field("Duration (frames)", nIn(w, "frames", 0, 6000)),
        ));
        box.appendChild(h("div", { class: "dim" }, "The camera stays centered on the player. Use 1.0 to return to the normal view."));
        return () => { c.zoom = Math.max(0.25, Math.min(4, w.zoom || 1)); c.frames = Math.max(0, Math.floor(w.frames || 0)); };
      } },
    { t: "transparency", label: "Change Transparency", make: () => ({ t: "transparency", val: true }),
      form(c, box) {
        const w = { val: String(c.val !== false) };
        box.appendChild(field("Player becomes", sel(w, "val", [{ v: "true", l: "Transparent (hidden)" }, { v: "false", l: "Visible" }])));
        box.appendChild(h("div", { class: "dim" }, "A transparent player still moves and triggers events — only the sprite is hidden. Pair with “Start transparent” in Database ▸ System for cutscene intros."));
        return () => { c.val = w.val === "true"; };
      } },
    { t: "shake", label: "Shake Screen", make: () => ({ t: "shake", power: 5, speed: 5, duration: 30, wait: true }),
      form(c, box) {
        const w = { power: c.power || 5, speed: c.speed || 5, duration: c.duration || 30, wait: c.wait !== false };
        box.appendChild(row(
          field("Power (1-9)", nIn(w, "power", 1, 9)),
          field("Speed (1-9)", nIn(w, "speed", 1, 9)),
          field("Duration (frames)", nIn(w, "duration", 1, 600)),
          field("Wait for completion", chk(w, "wait"))
        ));
        return () => {
          c.power = Number(w.power);
          c.speed = Number(w.speed);
          c.duration = Number(w.duration);
          c.wait = w.wait;
        };
      } },
    { t: "weather", label: "Change Weather", make: () => ({ t: "weather", kind: "none", power: 5 }),
      form(c, box) {
        const w = { kind: c.kind || "none", power: c.power || 5 };
        box.appendChild(row(
          field("Type", sel(w, "kind", [
            { v: "none", l: "None (clear)" },
            { v: "rain", l: "Rain" },
            { v: "storm", l: "Storm" },
            { v: "snow", l: "Snow" },
            { v: "fog", l: "Fog" }
          ])),
          field("Power (1-9)", nIn(w, "power", 1, 9))
        ));
        return () => {
          c.kind = w.kind;
          c.power = Number(w.power);
        };
      } },
    { t: "flash", label: "Flash Screen", make: () => ({ t: "flash", color: "#ffffff", opacity: 0.5, duration: 15, wait: false }),
      form(c, box) {
        const w = { color: c.color || "#ffffff", opacity: c.opacity || 0.5, duration: c.duration || 15, wait: !!c.wait };
        const colorIn = h("input", { type: "color", value: w.color, oninput(e) { w.color = e.target.value; } });
        box.appendChild(row(
          field("Color", colorIn),
          field("Opacity (0.1-1.0)", nIn(w, "opacity", 0.1, 1.0, 0.1)),
          field("Duration (frames)", nIn(w, "duration", 1, 300)),
          field("Wait for completion", chk(w, "wait"))
        ));
        return () => {
          c.color = w.color;
          c.opacity = Number(w.opacity);
          c.duration = Number(w.duration);
          c.wait = w.wait;
        };
      } },
    { t: "erase", label: "Erase This Event", make: () => ({ t: "erase" }), form: () => () => {} },
    { t: "save", label: "Open Save Screen", make: () => ({ t: "save" }), form: () => () => {} },
    { t: "gameover", label: "Game Over", make: () => ({ t: "gameover" }), form: () => () => {} },
    { t: "totitle", label: "Return to Title", make: () => ({ t: "totitle" }), form: () => () => {} },
    { t: "script", label: "Script (JavaScript)", make: () => ({ t: "script", code: "" }),
      form(c, box) {
        const ta = h("textarea", { rows: 6, spellcheck: "false" }, c.code || "");
        box.appendChild(field("JS — api: game.setSwitch(id,v) getSwitch setVar getVar addGold(n) callCommonEvent(id) party() quest(id) questStatus startQuest advanceQuestObjective setQuestObjective completeQuest failQuest abandonQuest state()", ta));
        return () => { c.code = ta.value; };
      } },
  ];
  const cmdDef = (t) => CMD_DEFS.find((d) => d.t === t);

  // Build a command's parameter form into any container and return its apply() commit
  // closure. Shared by the modal editor (editCommand) and the inline inspector, so each
  // per-type form builder is reused verbatim regardless of where it's hosted.
  function mountForm(c, container) {
    return cmdDef(c.t).form(c, container) || (() => {});
  }
  function editCommand(c, onDone, skipSnapshot, snapFn, onCancel) {
    const def = cmdDef(c.t);
    const box = h("div");
    const apply = mountForm(c, box);
    modal({
      title: def.label,
      content: box,
      buttons: [
        { label: "OK", primary: true, onClick(close) { if (!skipSnapshot && snapFn) snapFn(); apply(); close(); touch(); onDone(); } },
        { label: "Cancel", onClick(close) { close(); (onCancel || onDone)(); } },
      ],
      dismissable: false,
      dialogKeys: true,
    });
  }
  function pickCommand(onPicked) {
    const PAGE_SIZE = 24;
    const tabs = h("div", { class: "cmdtabs" });
    const grid = h("div", { class: "cmdgrid" });
    const m = modal({ title: "Add Command", content: h("div", null, tabs, grid), buttons: [{ label: "Cancel" }], dialogKeys: true });
    let page = 0;

    function editPreset(preset) {
      const draft = { name: preset ? preset.name : "", code: preset ? preset.code : "" };
      const nameInput = tIn(draft, "name");
      const codeInput = h("textarea", { rows: 8, spellcheck: "false" }, draft.code);
      const buttons = [
        { label: "Save", primary: true, onClick(close) {
          const name = nameInput.value.trim();
          if (!name) { nameInput.focus(); return; }
          draft.name = name;
          draft.code = codeInput.value;
          if (preset) Object.assign(preset, draft);
          else {
            S.proj.commandPresets.push({
              id: RA.nextId(S.proj.commandPresets),
              name: draft.name,
              code: draft.code,
            });
          }
          touch();
          close();
          page = Math.max(0, Math.ceil((CMD_DEFS.length + S.proj.commandPresets.length + 1) / PAGE_SIZE) - 1);
          redraw();
        } },
        { label: "Cancel" },
      ];
      if (preset) buttons.unshift({ label: "Delete", onClick(close) {
        confirmBox("Delete the saved command button \"" + preset.name + "\"?", () => {
          S.proj.commandPresets = S.proj.commandPresets.filter((p) => p.id !== preset.id);
          touch();
          close();
          redraw();
        });
      } });
      modal({
        title: preset ? "Edit Command Button" : "Add Command Button",
        content: h("div", null,
          field("Button name", nameInput),
          field("JavaScript (runs as an event Script command; API is available as game)", codeInput),
          preset ? h("div", { class: "dim" }, "Saved command buttons are stored with this project.") : null),
        buttons,
        dismissable: false,
        dialogKeys: true,
      });
    }

    function items() {
      return CMD_DEFS.map((def) => ({ kind: "builtin", def }))
        .concat(S.proj.commandPresets.map((preset) => ({ kind: "preset", preset })))
        .concat({ kind: "add" });
    }
    function redraw() {
      const all = items();
      const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
      page = Math.max(0, Math.min(page, pages - 1));
      tabs.innerHTML = "";
      for (let i = 0; i < pages; i++) {
        tabs.appendChild(h("button", {
          class: "mini" + (i === page ? " sel" : ""),
          onclick() { page = i; redraw(); },
        }, "Page " + (i + 1)));
      }
      grid.innerHTML = "";
      all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).forEach((item) => {
        if (item.kind === "builtin") {
          grid.appendChild(h("button", { onclick() { m.close(); onPicked(item.def.make()); } }, item.def.label));
        } else if (item.kind === "preset") {
          grid.appendChild(h("button", {
            class: "cmdpreset",
            title: "Insert saved script. Right-click to edit or delete.",
            onclick() { m.close(); onPicked({ t: "script", code: item.preset.code || "" }); },
            oncontextmenu(e) { e.preventDefault(); editPreset(item.preset); },
          }, item.preset.name));
        } else {
          grid.appendChild(h("button", { class: "cmdaddnew", onclick() { editPreset(null); } }, "+Add New"));
        }
      });
    }
    redraw();
  }

  // ============================ command list widget ============================
  function buildCmdRows(list, depth, out) {
    list.forEach((c, i) => {
      out.push({ arr: list, idx: i, cmd: c, depth });
      if (c.t === "if") {
        out.push({ label: "▸ Then", depth: depth });
        buildCmdRows(c.then, depth + 1, out);
        out.push({ arr: c.then, idx: c.then.length, depth: depth + 1, slot: true });
        out.push({ label: "▸ Else", depth: depth });
        buildCmdRows(c.else, depth + 1, out);
        out.push({ arr: c.else, idx: c.else.length, depth: depth + 1, slot: true });
      } else if (c.t === "choices") {
        c.options.forEach((o, bi) => {
          out.push({ label: "▸ When [" + o + "]", depth });
          buildCmdRows(c.branches[bi], depth + 1, out);
          out.push({ arr: c.branches[bi], idx: c.branches[bi].length, depth: depth + 1, slot: true });
        });
      }
    });
  }
  function cmdListWidget(getList, undoApi, onSelect) {
    const wrap = h("div", { class: "cmdlist-wrap" });
    const listEl = h("div", { class: "cmdlist", tabindex: "0" });
    const cmdCount = h("span", { class: "ev-cmd-count" });   // lives in the banner; updated in redraw()
    const snap = undoApi.snapshot;             // snapshot before a mutation
    let selRow = null, anchorRow = null, rows = [], dragFromIdx = null, cmdMenuEl = null;
    let dragBlock = null, dragFromArr = null, dragFrom = 0, dragCount = 0;
    function clearDropMarks() {
      listEl.querySelectorAll(".drop-before, .drop-after").forEach((d) => d.classList.remove("drop-before", "drop-after"));
    }
    // True when `arr` is one of cmd's own branch arrays, or nested inside one —
    // so a container command (if/choices) is never dropped into its own subtree.
    function ownsArray(cmd, arr) {
      if (!cmd) return false;
      const branches = cmd.t === "if" ? [cmd.then, cmd.else]
        : cmd.t === "choices" ? (cmd.branches || []) : [];
      for (const b of branches) {
        if (b === arr) return true;
        for (const c of b) if (ownsArray(c, arr)) return true;
      }
      return false;
    }
    // A command may be dropped onto any command row or end-of-branch slot, at any
    // nesting level in this event — except onto itself or inside its own subtree.
    function dropOk(target) {
      if (!dragBlock) return false;
      if (!target.arr || !(target.cmd || target.slot)) return false;
      if (dragBlock.includes(target.cmd)) return false;            // not onto a member of the dragged block
      return !dragBlock.some((c) => ownsArray(c, target.arr));     // not into any block member's own subtree
    }
    function redraw(reselect) {
      rows = [];
      buildCmdRows(getList(), 0, rows);
      rows.push({ arr: getList(), idx: getList().length, depth: 0, slot: true });
      if (reselect) { // re-find the moved/pasted command(s) by identity so the selection follows them
        const cmds = Array.isArray(reselect) ? reselect : [reselect];
        let first = -1, last = -1;
        rows.forEach((r3, i) => { if (r3.cmd && cmds.indexOf(r3.cmd) >= 0) { if (first < 0) first = i; last = i; } });
        if (first >= 0) { anchorRow = first; selRow = last; } // focus = last → repeated paste/move stacks
      }
      listEl.innerHTML = "";
      const blk = selBlock(); // the contiguous multi-selection (or the single focused command)
      rows.forEach((r2, i) => {
        const inBlk = blk && r2.cmd && r2.arr === blk.arr && r2.idx >= blk.lo && r2.idx <= blk.hi;
        const div = h("div", {
          class: "cmdrow" + (r2.label ? " branch" : "") + (r2.slot ? " slot" : "")
            + (i === selRow ? " sel" : (inBlk ? " cmd-selected" : "")),
          style: "padding-left:" + (8 + r2.depth * 18) + "px",
          onclick(e) {
            if (e.shiftKey && anchorRow != null && rows[anchorRow] && r2.cmd && r2.arr === rows[anchorRow].arr)
              selRow = i;                    // extend the range within one sibling list
            else anchorRow = selRow = i;     // plain click / re-anchor (foreign branch, label, slot, ctrl)
            redraw(); listEl.focus({ preventScroll: true });
          },
          ondblclick() { anchorRow = selRow = i; if (r2.slot) addAt(r2); else if (r2.cmd) editAt(r2); },
          oncontextmenu(e) { openCmdMenu(e, i); },
        }, r2.label ? r2.label : r2.slot ? "◇ " + t("Add command…") : "◆ " + cmdSummary(r2.cmd));
        if (r2.cmd) {
          div.draggable = true;
          div.addEventListener("dragstart", (e) => {
            const b = selBlock();
            const inB = b && r2.arr === b.arr && r2.idx >= b.lo && r2.idx <= b.hi;
            if (inB) { dragBlock = b.cmds; dragFromArr = b.arr; dragFrom = b.lo; dragCount = b.count; }
            else { anchorRow = selRow = i; dragBlock = [r2.cmd]; dragFromArr = r2.arr; dragFrom = r2.idx; dragCount = 1; }
            dragFromIdx = i;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", "cmd"); // Firefox needs data to start a drag
            div.classList.add("dragging");
          });
          div.addEventListener("dragend", () => { div.classList.remove("dragging"); clearDropMarks(); dragFromIdx = null; dragBlock = null; });
        }
        div.addEventListener("dragover", (e) => {
          if (!dropOk(r2)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          clearDropMarks();
          if (r2.slot) { div.classList.add("drop-before"); return; } // slot = drop at end of level
          const rect = div.getBoundingClientRect();
          div.classList.add(e.clientY - rect.top < rect.height / 2 ? "drop-before" : "drop-after");
        });
        div.addEventListener("dragleave", () => div.classList.remove("drop-before", "drop-after"));
        div.addEventListener("drop", (e) => {
          if (!dropOk(r2)) return;
          e.preventDefault();
          const toArr = r2.arr;
          let to = r2.idx; // slot => end of branch (idx == length)
          if (!r2.slot) {
            const rect = div.getBoundingClientRect();
            to = e.clientY - rect.top < rect.height / 2 ? r2.idx : r2.idx + 1;
          }
          clearDropMarks();
          if (dragFromArr === toArr && to >= dragFrom && to <= dragFrom + dragCount) { dragBlock = null; dragFromIdx = null; return; } // lands inside itself
          snap();
          dragFromArr.splice(dragFrom, dragCount);
          if (dragFromArr === toArr && to > dragFrom) to -= dragCount; // adjust for the gap we just removed
          toArr.splice(to, 0, ...dragBlock);
          const moved = dragBlock; dragBlock = null; dragFromIdx = null;
          touch(); redraw(moved); // keep the moved block selected
        });
        listEl.appendChild(div);
      });
      // One notification site for the inspector: report the single focused command
      // (or null for none/multi-select/label/slot). Every selection change that should
      // update the inspector funnels through redraw(); ondblclick/dragstart are the two
      // deliberate exceptions that settle on the next redraw.
      cmdCount.textContent = "(" + getList().length + ")";
      if (onSelect) { const b = selBlock(); onSelect(b && b.count === 1 ? b.cmds[0] : null); }
    }
    function cur() { return selRow != null ? rows[selRow] : null; }
    // The current selection as a contiguous block within ONE sibling array: the run between
    // anchorRow and the focused row, or just the focused command. Null if nothing usable is selected.
    function selBlock() {
      const a = rows[anchorRow], f = cur();
      if (a && f && a.cmd && f.cmd && a.arr === f.arr) {
        const arr = a.arr, lo = Math.min(a.idx, f.idx), hi = Math.max(a.idx, f.idx);
        return { arr, lo, hi, count: hi - lo + 1, cmds: arr.slice(lo, hi + 1) };
      }
      return (f && f.cmd) ? { arr: f.arr, lo: f.idx, hi: f.idx, count: 1, cmds: [f.cmd] } : null;
    }
    function addAt(r2) {
      let target = r2 || cur();
      if (!target || (!target.slot && !target.cmd)) target = { arr: getList(), idx: getList().length };
      pickCommand((nc) => {
        // Edit the new command in its own dialog FIRST; only insert it on OK, so Cancel adds nothing.
        editCommand(nc, () => {
          snap();                                   // snapshot pre-insertion state (one clean "add" undo step)
          target.arr.splice(target.idx, 0, nc);
          touch();
          redraw(nc);
          listEl.focus({ preventScroll: true });    // so Delete works immediately on the new row
        }, true, null, () => {});                    // skipSnapshot + no-op Cancel: nothing happens unless OK
      });
    }
    function editAt(r2) {
      const target = r2 || cur();
      if (!target || !target.cmd) return;
      editCommand(target.cmd, redraw, false, snap);   // edit path snapshots on OK (before apply)
    }
    function delAt() {
      const b = selBlock();
      if (!b) return;
      snap();
      b.arr.splice(b.lo, b.count);
      touch();
      const survivor = b.arr.length ? b.arr[Math.min(b.lo, b.arr.length - 1)] : null;
      anchorRow = selRow = null;
      redraw(survivor || undefined);
    }
    function moveSel(d) {
      const b = selBlock();
      if (!b) return;
      if (d < 0 && b.lo <= 0) return;
      if (d > 0 && b.hi >= b.arr.length - 1) return;
      snap();
      const blk = b.arr.splice(b.lo, b.count);
      b.arr.splice(b.lo + d, 0, ...blk);
      touch();
      redraw(blk); // the whole block follows so ↑/↓ can be tapped repeatedly
    }
    function copySel(cut) {
      const b = selBlock();
      if (!b) return;
      S.clipCmd = b.cmds.map((c) => RA.clone(c));
      flashStatus((cut ? "Cut " : "Copied ") + b.count + (b.count > 1 ? " commands" : " command"));
      if (cut) {
        snap();
        b.arr.splice(b.lo, b.count);
        touch();
        const survivor = b.arr.length ? b.arr[Math.min(b.lo, b.arr.length - 1)] : null;
        anchorRow = selRow = null;
        redraw(survivor || undefined);
      }
    }
    function pasteSel() {
      const block = Array.isArray(S.clipCmd) ? S.clipCmd : (S.clipCmd ? [S.clipCmd] : null);
      if (!block || !block.length) { flashStatus("Clipboard is empty — copy a command first"); return; }
      const target = cur();
      let arr, idx;
      if (target && target.cmd) { arr = target.arr; idx = target.idx + 1; }   // after the focused command
      else if (target && target.slot) { arr = target.arr; idx = target.idx; } // at the insertion slot
      else { arr = getList(); idx = getList().length; }                       // nothing selected → end of list
      const clones = block.map((c) => RA.clone(c));
      snap();
      arr.splice(idx, 0, ...clones);
      touch(); redraw(clones); // select the pasted block so repeated Ctrl+V stacks
    }
    function closeCmdMenu() {
      if (!cmdMenuEl) return;
      cmdMenuEl.remove(); cmdMenuEl = null;
      document.removeEventListener("mousedown", onCmdMenuOutside, true);
      document.removeEventListener("keydown", onCmdMenuKey, true);
    }
    function onCmdMenuOutside(ev) { if (cmdMenuEl && !cmdMenuEl.contains(ev.target)) closeCmdMenu(); }
    function onCmdMenuKey(ev) { if (ev.key === "Escape") { ev.preventDefault(); closeCmdMenu(); } }
    // Right-click a command (or insertion slot) for the same actions as the toolbar buttons.
    function openCmdMenu(e, i) {
      e.preventDefault();
      if (!rows[i] || (!rows[i].cmd && !rows[i].slot)) return; // labels: just suppress the native menu
      const x = e.clientX, y = e.clientY;
      const b0 = selBlock(); // keep an existing multi-selection if the right-click lands inside it
      const inBlk = b0 && rows[i].cmd && rows[i].arr === b0.arr && rows[i].idx >= b0.lo && rows[i].idx <= b0.hi;
      if (!inBlk) anchorRow = selRow = i;
      redraw(); listEl.focus({ preventScroll: true });
      closeCmdMenu();
      const b = selBlock(), isCmd = !!b, n = b ? b.count : 0, sfx = n > 1 ? " " + n : "";
      const canPaste = Array.isArray(S.clipCmd) ? S.clipCmd.length > 0 : !!S.clipCmd;
      const canUp = !!b && b.lo > 0, canDown = !!b && b.hi < b.arr.length - 1;
      const menu = h("div", { class: "menu-drop" });
      const item = (label, key, on, fn) => menu.appendChild(h("div", {
        class: "menu-item" + (on ? "" : " disabled"),
        onclick() { if (!on) return; closeCmdMenu(); fn(); },
      }, h("span", { class: "mi-label" }, label), key ? h("span", { class: "mi-key" }, key) : null));
      const sep = () => menu.appendChild(h("div", { class: "menu-sep" }));
      item("Add…", "", true, () => addAt());
      item("Edit", "", isCmd, () => editAt());
      sep();
      item("Cut" + sfx, "Ctrl+X", isCmd, () => copySel(true));
      item("Copy" + sfx, "Ctrl+C", isCmd, () => copySel(false));
      item("Paste", "Ctrl+V", canPaste, () => pasteSel());
      item("Delete" + sfx, "", isCmd, () => delAt());
      sep();
      item("Move Up", "", canUp, () => moveSel(-1));
      item("Move Down", "", canDown, () => moveSel(1));
      menu.style.left = x + "px"; menu.style.top = y + "px";
      document.body.appendChild(menu);
      menu.style.left = Math.max(4, Math.min(x, window.innerWidth - menu.offsetWidth - 4)) + "px";
      menu.style.top = Math.max(4, Math.min(y, window.innerHeight - menu.offsetHeight - 4)) + "px";
      cmdMenuEl = menu;
      document.addEventListener("mousedown", onCmdMenuOutside, true);
      document.addEventListener("keydown", onCmdMenuKey, true);
    }
    // Banner: "Commands N" on the left, actions on the right. Copy/Cut/Paste/move keep working
    // via Ctrl+C/X/V, drag-reorder, and the right-click menu — they just lost their buttons.
    const btns = h("div", { class: "cmdbtns" },
      h("div", { class: "cmdbanner-title" }, h("span", null, t("Commands")), cmdCount),
      h("div", { class: "cmdbtns-actions" },
        h("button", { onclick: () => addAt() }, "+ Add"),
        h("button", { onclick: () => editAt() }, "Edit"),
        h("button", { onclick: delAt }, "Delete")),
    );
    // Ctrl+C/X/V and Delete work when the command list has focus. The global editor shortcuts
    // are suppressed while a modal is open, so there's no collision with map copy/paste.
    listEl.addEventListener("keydown", (e) => {
      if (e.code === "Delete") { e.preventDefault(); delAt(); return; }
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.code === "KeyC") { e.preventDefault(); copySel(false); }
      else if (e.code === "KeyX") { e.preventDefault(); copySel(true); }
      else if (e.code === "KeyV") { e.preventDefault(); pasteSel(); }
    });
    wrap.appendChild(btns);
    wrap.appendChild(listEl);
    redraw();
    return { el: wrap, redraw };
  }

  // ============================ event editor ============================
  // onCommitNew (optional): for a brand-new, not-yet-inserted event, called on OK after the edited
  // clone is written back — inserts it into the map. Omitted when editing an existing event.
  function openEventEditor(evOriginal, onCommitNew) {
    const ev = RA.clone(evOriginal);
    let pageIdx = 0;

    // Per-page command undo/redo, keyed by page object; discarded with `ev` when the editor closes.
    const cmdHist = new Map();                 // page -> { undo, redo }
    function histFor(p) {
      let hst = cmdHist.get(p);
      if (!hst) { hst = { undo: [], redo: [] }; cmdHist.set(p, hst); }
      return hst;
    }
    const curPage = () => ev.pages[pageIdx];
    function cmdSnapshot() {                    // call before mutating the current page's commands
      const hst = histFor(curPage());
      hst.undo.push(RA.clone(curPage().commands));
      if (hst.undo.length > 60) hst.undo.shift();
      hst.redo.length = 0;
    }
    function cmdStep(from, to) {
      const hst = histFor(curPage());
      if (!hst[from].length) { flashStatus(from === "undo" ? "Nothing to undo" : "Nothing to redo"); return false; }
      hst[to].push(RA.clone(curPage().commands));
      curPage().commands = RA.clone(hst[from].pop());   // re-clone so the archived entry stays immutable
      touch();
      return true;
    }
    const undoApi = {
      snapshot: cmdSnapshot,
      undo: () => cmdStep("undo", "redo"),
      redo: () => cmdStep("redo", "undo"),
    };
    // Editor-wide keys (selection ≠ focus): Ctrl+Z/Y/Shift+Z undo/redo commands, Delete removes
    // the highlighted page (the command list handles its own Delete), and 1–9 jump to a page.
    // Defers to native field editing; inert while a nested Add/Edit dialog is the topmost modal.
    let evOverlay = null;
    function onEvKey(e) {
      if (modalRoot().lastElementChild !== evOverlay) return;
      if (pageMenuEl) return;                    // a page context menu is open — let it own the keys
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      const inCmdList = t && t.closest && t.closest(".cmdlist");   // the command list owns its own Delete/keys
      if (e.ctrlKey || e.metaKey) {
        if (e.code === "KeyZ" && e.shiftKey) { e.preventDefault(); if (undoApi.redo()) redrawPage(); }
        else if (e.code === "KeyZ") { e.preventDefault(); if (undoApi.undo()) redrawPage(); }
        else if (e.code === "KeyY") { e.preventDefault(); if (undoApi.redo()) redrawPage(); }
        return;
      }
      if (e.code === "Delete" && !inCmdList) {
        e.preventDefault(); deletePage(pageIdx); return;
      }
      if (e.key >= "1" && e.key <= "9" && !inCmdList) {   // jump to page 1–9 if it exists
        const p = +e.key - 1;
        if (p < ev.pages.length) { e.preventDefault(); pageIdx = p; redrawTabs(); redrawPage(); }
      }
    }
    document.addEventListener("keydown", onEvKey);

    const head = h("div", { class: "event-head" });
    const tabs = h("div", { class: "tabs" });
    const pageBox = h("div", { class: "event-pagebox" });

    function deletePage(i) {
      if (ev.pages.length <= 1) return;
      const del = () => {
        ev.pages.splice(i, 1);
        if (pageIdx > i) pageIdx--;
        pageIdx = Math.min(pageIdx, ev.pages.length - 1);
        redrawTabs(); redrawPage();
      };
      const n = ev.pages[i].commands.length;   // confirm only if there are commands to lose (can't be undone)
      if (n) confirmBox("This page has " + n + " command" + (n === 1 ? "" : "s") + " that will be permanently lost. Delete this page?", del);
      else del();
    }
    function addPageAt(i) { ev.pages.splice(i, 0, DataDefaults.newPage()); pageIdx = i; redrawTabs(); redrawPage(); }
    function copyPage(i) { S.clipPage = RA.clone(ev.pages[i]); flashStatus("Copied page " + (i + 1)); }
    function pastePage(i) { if (!S.clipPage) return; ev.pages.splice(i + 1, 0, RA.clone(S.clipPage)); pageIdx = i + 1; redrawTabs(); redrawPage(); }
    function movePage(i, d) {
      const j = i + d;
      if (j < 0 || j >= ev.pages.length) return;
      ev.pages.splice(j, 0, ev.pages.splice(i, 1)[0]);
      pageIdx = j; redrawTabs(); redrawPage();
    }

    // Page tabs: rename (double-click or menu), right-click menu, and drag-reorder.
    let pageMenuEl = null, dragPageFrom = null, editingPage = null;
    function startRename(i) { editingPage = i; redrawTabs(); }
    function commitRename(i, value) { ev.pages[i].name = value.trim(); editingPage = null; touch(); redrawTabs(); redrawPage(); }
    function closePageMenu() {
      if (!pageMenuEl) return;
      pageMenuEl.remove(); pageMenuEl = null;
      document.removeEventListener("mousedown", onPageMenuOutside, true);
      document.removeEventListener("keydown", onPageMenuKey, true);
    }
    function onPageMenuOutside(e) { if (pageMenuEl && !pageMenuEl.contains(e.target)) closePageMenu(); }
    function onPageMenuKey(e) { if (e.key === "Escape") { e.preventDefault(); closePageMenu(); } }
    function openPageMenu(e, i) {
      e.preventDefault();
      const x = e.clientX, y = e.clientY, last = ev.pages.length - 1;
      pageIdx = i; redrawTabs(); redrawPage();   // right-click selects the tab first
      closePageMenu();
      const menu = h("div", { class: "menu-drop" });
      const item = (label, on, fn) => menu.appendChild(h("div", {
        class: "menu-item" + (on ? "" : " disabled"),
        onclick() { if (!on) return; closePageMenu(); fn(); },
      }, h("span", { class: "mi-label" }, label)));
      const sep = () => menu.appendChild(h("div", { class: "menu-sep" }));
      item("Add page", true, () => addPageAt(i + 1));   // to the right, like Paste
      item("Rename", true, () => startRename(i));
      item("Move left", i > 0, () => movePage(i, -1));
      item("Move right", i < last, () => movePage(i, 1));
      sep();
      item("Copy", true, () => copyPage(i));
      item("Paste", !!S.clipPage, () => pastePage(i));
      item("Delete", ev.pages.length > 1, () => deletePage(i));
      document.body.appendChild(menu);
      menu.style.left = Math.max(4, Math.min(x, window.innerWidth - menu.offsetWidth - 4)) + "px";
      menu.style.top = Math.max(4, Math.min(y, window.innerHeight - menu.offsetHeight - 4)) + "px";
      pageMenuEl = menu;
      document.addEventListener("mousedown", onPageMenuOutside, true);
      document.addEventListener("keydown", onPageMenuKey, true);
    }
    function clearTabDrops() { tabs.querySelectorAll(".drop-left, .drop-right").forEach((b) => b.classList.remove("drop-left", "drop-right")); }
    function redrawTabs() {
      tabs.innerHTML = "";
      tabs.appendChild(h("button", { class: "mini tab-add", title: "Add a page", onclick() { ev.pages.push(DataDefaults.newPage()); pageIdx = ev.pages.length - 1; redrawTabs(); redrawPage(); } }, "+"));
      ev.pages.forEach((_, i) => {
        if (editingPage === i) {                  // inline rename: an input replaces the tab button
          const inp = h("input", { class: "tab-rename", value: ev.pages[i].name || "",
            onkeydown(e) {
              if (e.key === "Enter") { e.preventDefault(); commitRename(i, inp.value); }
              else if (e.key === "Escape") { e.preventDefault(); editingPage = null; redrawTabs(); }
            },
            onblur() { if (editingPage === i) commitRename(i, inp.value); },
          });
          tabs.appendChild(inp);
          setTimeout(() => { inp.focus(); inp.select(); }, 0);
          return;
        }
        const btn = h("button", {
          class: i === pageIdx ? "sel" : "",
          onclick() { pageIdx = i; redrawTabs(); redrawPage(); },
          ondblclick() { startRename(i); },
          oncontextmenu(e) { openPageMenu(e, i); },
        }, ev.pages[i].name || ("Page " + (i + 1)));
        btn.draggable = true;
        btn.addEventListener("dragstart", (e) => { dragPageFrom = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "page"); btn.classList.add("dragging"); });
        btn.addEventListener("dragend", () => { btn.classList.remove("dragging"); clearTabDrops(); dragPageFrom = null; });
        btn.addEventListener("dragover", (e) => {
          if (dragPageFrom === null || dragPageFrom === i) return;
          e.preventDefault(); e.dataTransfer.dropEffect = "move"; clearTabDrops();
          const r = btn.getBoundingClientRect();
          btn.classList.add(e.clientX - r.left < r.width / 2 ? "drop-left" : "drop-right");
        });
        btn.addEventListener("dragleave", () => btn.classList.remove("drop-left", "drop-right"));
        btn.addEventListener("drop", (e) => {
          if (dragPageFrom === null || dragPageFrom === i) return;
          e.preventDefault();
          const r = btn.getBoundingClientRect();
          let to = e.clientX - r.left < r.width / 2 ? i : i + 1;
          const from = dragPageFrom; dragPageFrom = null; clearTabDrops();
          if (from < to) to--;                   // the removed page shifts later indices down
          ev.pages.splice(to, 0, ev.pages.splice(from, 1)[0]);
          pageIdx = to; redrawTabs(); redrawPage();
        });
        tabs.appendChild(btn);
      });
    }
    function redrawPage() {
      const pg = ev.pages[pageIdx];
      pageBox.innerHTML = "";
      // ---- right pane: live inspector (Show Text inline; placeholder otherwise) ----
      const inspector = h("div", { class: "event-inspector" });
      let mountedCmd = null, dirtySinceMount = false, selfCommitting = false;
      let cw;   // command-list widget, assigned below; inline commits trigger cw.redraw()
      function showPlaceholder() {
        mountedCmd = null;
        inspector.innerHTML = "";
        inspector.appendChild(h("div", { class: "ev-insp-empty" },
          t("Select a command to edit here, or double-click any command to edit in the dialog.")));
      }
      function mountInspector(c) {
        mountedCmd = c; dirtySinceMount = false;
        inspector.innerHTML = "";
        const formBox = h("div", { class: "ev-insp-form" });
        const apply = mountForm(c, formBox);   // reuse the command's own form builder verbatim
        inspector.appendChild(formBox);
        if (!formBox.childNodes.length)        // no-parameter commands (erase/save/gameover/totitle)
          formBox.appendChild(h("div", { class: "ev-insp-empty" }, t("This command has no parameters.")));
        if (c.t === "choices" || c.t === "if") // nested branches are authored in the command tree, not here
          inspector.appendChild(h("div", { class: "ev-insp-hint" }, t("Branch contents are edited in the command list.")));
        function commit() {
          if (!dirtySinceMount) { undoApi.snapshot(); dirtySinceMount = true; }  // one undo step per mount
          apply();
          touch();   // explicit: some forms (e.g. the message textarea) don't call touch() themselves
          selfCommitting = true;
          cw.redraw();   // refresh the command's list-row summary (same-identity → no remount)
          selfCommitting = false;
        }
        formBox.addEventListener("input", commit);
        formBox.addEventListener("change", commit);
      }
      // Selection → inspector. Same command during our own inline commit is a no-op (keeps
      // focus); the same command from any OTHER cause (modal edit, undo/redo) force-remounts
      // so the inspector re-reads a fresh working copy and never overwrites external edits.
      function onSelect(cmd) {
        if (cmd) {
          if (cmd === mountedCmd && selfCommitting) return;
          mountInspector(cmd);
        } else {
          showPlaceholder();
        }
      }
      showPlaceholder();

      // ---- left pane: Conditions + Appearance + Behaviour (always expanded) ----
      function section(title, bodyKids, badge) {
        const secHead = h("div", { class: "ev-sec-head" }, h("span", { class: "ev-sec-title" }, t(title)), badge || null);
        return h("div", { class: "ev-section" }, secHead, h("div", { class: "ev-sec-body" }, ...bodyKids));
      }

      // Shared label-left / control-right row, used by Conditions, Appearance, and Behaviour.
      function propRow(label, control) {
        return h("div", { class: "prop-row" }, h("span", { class: "prop-label" }, t(label)), h("div", { class: "prop-ctrl" }, control));
      }

      const condBadge = h("span", { class: "ev-badge" });
      function refreshConditions() {
        const n = (pg.cond.switchId ? 1 : 0) + (pg.cond.varId ? 1 : 0) + (pg.cond.selfSw ? 1 : 0)
          + (pg.cond.questId ? 1 : 0) + (pg.cond.objectiveQuestId ? 1 : 0);
        condBadge.textContent = n ? n + " active" : "";
        condBadge.style.display = n ? "" : "none";
      }
      // Quest objective condition: the objective dropdown depends on the chosen quest, so it
      // rebuilds whenever the objective-quest selection changes (preserved from the quest system).
      const objWrap = h("div", { class: "prop-ctrl" });
      function redrawObjectiveList() {
        const q = RA.byId(S.proj.quests, pg.cond.objectiveQuestId);
        const opts = [{ v: 0, l: "(none)" }].concat(((q && q.objectives) || []).map((obj, i) => ({ v: i, l: (i + 1) + ": " + (obj.label || obj.kind || "Objective") })));
        objWrap.innerHTML = "";
        objWrap.appendChild(sel(pg.cond, "objectiveIndex", opts));
      }
      redrawObjectiveList();
      const condSection = section("Conditions", [
        h("div", { class: "prop-rows" },
          propRow("Switch", sel(pg.cond, "switchId", switchOpts(), refreshConditions)),
          propRow("Variable", h("div", { class: "cond-var" },
            sel(pg.cond, "varId", varOpts(), refreshConditions),
            sel(pg.cond, "cmp", cmpOpts(), refreshConditions),
            nIn(pg.cond, "varVal"))),
          propRow("Self-Switch", sel(pg.cond, "selfSw",
            [{ v: "", l: "(none)" }, { v: "A", l: "A" }, { v: "B", l: "B" }, { v: "C", l: "C" }, { v: "D", l: "D" }],
            refreshConditions)),
          propRow("Quest", sel(pg.cond, "questId", dbOpts(S.proj.quests, "(none)"), refreshConditions)),
          propRow("Status", sel(pg.cond, "questStatus", stringSelOpts(["inactive", "active", "completed", "failed", "abandoned"]))),
          propRow("Obj. quest", sel(pg.cond, "objectiveQuestId", dbOpts(S.proj.quests, "(none)"),
            () => { refreshConditions(); redrawObjectiveList(); })),
          h("div", { class: "prop-row" }, h("span", { class: "prop-label" }, t("Objective")), objWrap),
          propRow("Obj. is", sel(pg.cond, "objectiveStatus", stringSelOpts(["incomplete", "completed"])))),
      ], condBadge);
      refreshConditions();

      const preview = h("span", { class: "char-preview" });
      function redrawPreview() {
        preview.innerHTML = "";
        const ci = Assets.charsetIndex(pg.charset);
        if (ci >= 0) preview.appendChild(Assets.charFrameCanvas(ci, pg.dir || 0, 1));
      }
      redrawPreview();
      const appSection = section("Appearance", [
        h("div", { class: "appearance-row" },
          h("div", { class: "prop-rows appearance-fields" },
            propRow("Graphic", sel(pg, "charset", charsetOpts(), redrawPreview)),
            propRow("Facing", sel(pg, "dir", DIR_OPTS, redrawPreview))),
          preview),
      ]);
      const behSection = section("Behaviour", [
        h("div", { class: "prop-rows" },
          propRow("Trigger", sel(pg, "trigger", [
            { v: "action", l: "Action button" }, { v: "touch", l: "Player touch" },
            { v: "auto", l: "Autorun" }, { v: "parallel", l: "Parallel" }])),
          propRow("Movement", sel(pg, "moveType", [{ v: "fixed", l: "Fixed" }, { v: "random", l: "Random" }])),
          propRow("Priority", sel(pg, "priority", [{ v: "below", l: "Below player" }, { v: "same", l: "Same as player" }, { v: "above", l: "Above player" }])),
          propRow("Through", chk(pg, "through"))),
      ]);
      pg.combat = Object.assign(RA.defaultActionCombat(), pg.combat || {});
      const combatBadge = h("span", { class: "ev-badge" }, pg.combat.enabled ? "enabled" : "");
      combatBadge.style.display = pg.combat.enabled ? "" : "none";
      const refreshCombatBadge = () => {
        combatBadge.textContent = pg.combat.enabled ? "enabled" : "";
        combatBadge.style.display = pg.combat.enabled ? "" : "none";
      };
      const combatSection = section("Action Combat", [
        h("div", { class: "prop-rows" },
          propRow("Enabled", chk(pg.combat, "enabled")),
          propRow("Enemy", sel(pg.combat, "enemyId", dbOpts(S.proj.enemies, "(none)"))),
          h("div", { class: "subhead" }, "Enemy AI"),
          propRow("AI", sel(pg.combat, "ai", RA.ACTION_COMBAT_AI || [{ v: "none", l: "None" }])),
          propRow("HP override", nIn(pg.combat, "hp", 0, 9999)),
          propRow("Touch damage", nIn(pg.combat, "touchDamage", 0, 999)),
          propRow("Knockback", nIn(pg.combat, "knockbackTiles", 0, 4)),
          propRow("Invuln frames", nIn(pg.combat, "invulnFrames", 0, 180)),
          propRow("Defeat switch", sel(pg.combat, "defeatSelfSwitch",
            [{ v: "", l: "(erase event)" }, { v: "A", l: "Self-Switch A" }, { v: "B", l: "Self-Switch B" }, { v: "C", l: "Self-Switch C" }, { v: "D", l: "Self-Switch D" }])),
          h("div", { class: "dim" },
            "Players use the remappable Attack action to swing. Enemy AI controls extra movement such as chasing; Touch damage controls adjacent strikes. In messages, use \\input[attack] for an input-aware prompt. HP 0 uses the selected enemy's database HP.")),
      ], combatBadge);
      combatSection.addEventListener("change", refreshCombatBadge);

      const left = h("div", { class: "event-ide-col event-ide-left" }, condSection, appSection, behSection, combatSection);

      // ---- center pane: command list ----
      cw = cmdListWidget(() => ev.pages[pageIdx].commands, undoApi, onSelect);
      const center = h("div", { class: "event-ide-col event-ide-center" }, cw.el);

      // ---- right pane: inspector ----
      const right = h("div", { class: "event-ide-col event-ide-right" }, inspector);

      pageBox.appendChild(h("div", { class: "event-ide" }, left, center, right));
    }

    const evIcon = h("span", { class: "event-icon" });
    evIcon.innerHTML = ICONS.event;   // the person glyph used by the Event tool in the main editor
    const closeX = h("button", { class: "event-close", title: t("Close") }, "✕");
    head.appendChild(h("div", { class: "event-topbar" },
      h("div", { class: "event-topbar-id" },
        evIcon,
        tIn(ev, "name", "event-name-input")),
      tabs,
      closeX));
    head.appendChild(pageBox);
    redrawTabs(); redrawPage();

    // Footer: map position pinned far left, OK/Cancel right-aligned like every other dialog.
    const okBtn = h("button", { class: "primary" }, t("OK"));
    const cancelBtn = h("button", null, t("Cancel"));
    const footer = h("div", { class: "modal-btns event-footer" },
      h("div", { class: "ef-left" },
        h("span", { class: "event-pos-foot" },
          h("span", { class: "epf-label" }, t("Map Position:")),
          h("span", { class: "epf-val" }, ev.x + ", " + ev.y))),
      h("div", { class: "ef-right" }, okBtn, cancelBtn));

    const evModal = modal({
      title: "Event — " + esc(evOriginal.name),
      content: head,
      wide: true,
      class: "event-modal",
      dismissable: false,
      onClose() { closePageMenu(); document.removeEventListener("keydown", onEvKey); },
      footer,
    });
    okBtn.onclick = () => {
      pushUndo();
      Object.assign(evOriginal, ev);
      if (onCommitNew) onCommitNew(evOriginal);   // new event: insert into the map now (not before)
      touch(); renderMap(); evModal.close();
    };
    cancelBtn.onclick = () => evModal.close();
    evOverlay = evModal.el.parentElement;
    closeX.onclick = () => evModal.close();   // ✕ in the header = Cancel (discard the working clone)
  }

  // ============================ database ============================
  const STAT_KEYS = ["mhp", "mmp", "atk", "def", "mat", "mdf", "agi"];
  const PARAM_KEYS = ["atk", "def", "mat", "mdf", "agi"];
  const TRAIT_SKILL_TYPES = [
    { v: "phys", l: "Physical skills" },
    { v: "magic", l: "Magical skills" },
    { v: "heal", l: "Healing skills" },
  ];
  function traitDefault(type) {
    if (type === "element") return { type, key: (RA.typeList(S.proj, "elements")[0] || { key: "physical" }).key, value: 100 };
    if (type === "state") return { type, key: String(S.proj.states[0] ? S.proj.states[0].id : 1), value: 100 };
    if (type === "skill") return { type, key: "phys", value: 100 };
    if (type === "equip") return { type, key: "weapon", value: S.proj.weapons[0] ? S.proj.weapons[0].id : 0 };
    if (type === "special") return { type, key: "critChance", value: 5 };
    return { type: "param", key: "atk", value: 100 };
  }

  function listFormTab(spec) {
    // spec: {list(), blank(), label(e), form(e, box)}
    const wrap = h("div", { class: "dbtab" });
    const listEl = h("ul", { class: "dblist" });
    const formEl = h("div", { class: "dbform" });
    let cur = null;
    function redrawList() {
      listEl.innerHTML = "";
      for (const e of spec.list()) {
        const li = h("li", { class: e === cur ? "sel" : "", onclick() { cur = e; redrawList(); redrawForm(); } },
          h("span", { class: "db-entry-id" }, e.id + ":"));
        if (e.icon != null) li.appendChild(Assets.iconSpan(e.icon, "db-entry-icon"));
        li.appendChild(h("span", null, e.name || "—"));
        listEl.appendChild(li);
      }
    }
    function redrawForm() {
      formEl.innerHTML = "";
      if (cur) spec.form(cur, formEl, () => { redrawList(); });
    }
    const btns = h("div", { class: "dbbtns" },
      h("button", { onclick() {
        const e = spec.blank();
        e.id = RA.nextId(spec.list());
        spec.list().push(e);
        cur = e; touch(); redrawList(); redrawForm();
      } }, "+ New"),
      ...(spec.reorderable ? [
        h("button", { class: "mini", title: "Move earlier", onclick() {
          if (!cur) return;
          const arr = spec.list();
          const i = arr.indexOf(cur);
          if (i <= 0) return;
          const [moved] = arr.splice(i, 1);
          arr.splice(i - 1, 0, moved);
          touch(); redrawList(); redrawForm();
        } }, "↑"),
        h("button", { class: "mini", title: "Move later", onclick() {
          if (!cur) return;
          const arr = spec.list();
          const i = arr.indexOf(cur);
          if (i < 0 || i >= arr.length - 1) return;
          const [moved] = arr.splice(i, 1);
          arr.splice(i + 1, 0, moved);
          touch(); redrawList(); redrawForm();
        } }, "↓"),
      ] : []),
      h("button", { onclick() {
        if (!cur) return;
        if (spec.allowEmpty !== true && spec.list().length <= 1) { alert("Keep at least one entry."); return; }
        confirmBox("Delete \"" + cur.name + "\"?", () => {
          const arr = spec.list();
          arr.splice(arr.indexOf(cur), 1);
          cur = arr[0] || null;
          touch(); redrawList(); redrawForm();
        });
      } }, "Delete"),
    );
    cur = spec.list()[0] || null;
    redrawList(); redrawForm();
    wrap.appendChild(h("div", { class: "dbside" }, btns, listEl));
    wrap.appendChild(formEl);
    return wrap;
  }
  function nameRefresher(e, redrawList) {
    const inp = tIn(e, "name");
    inp.addEventListener("input", redrawList);
    return inp;
  }
  function iconPickerField(entry, redrawList) {
    if (entry.icon == null) entry.icon = 0;
    const preview = h("span", { class: "icon-preview-wrap" }, Assets.iconSpan(entry.icon, "icon-preview"));
    const button = h("button", { class: "icon-pick-button", onclick(ev) {
      ev.preventDefault();
      const grid = h("div", { class: "icon-picker-grid" });
      let picker = null;
      for (let i = 0; i < Assets.ICON_COUNT; i++) {
        grid.appendChild(h("button", {
          class: "icon-choice" + (i === entry.icon ? " sel" : ""),
          title: "Icon " + i,
          onclick() {
            entry.icon = i;
            touch();
            redrawList();
            preview.innerHTML = "";
            preview.appendChild(Assets.iconSpan(i, "icon-preview"));
            picker.close();
          },
        }, Assets.iconSpan(i)));
      }
      picker = modal({ title: "Choose Icon", content: grid, wide: true, buttons: [{ label: "Cancel" }] });
    } }, preview, h("span", null, "Choose Icon"));
    return h("div", { class: "fld icon-field" }, h("span", null, "Icon"), button);
  }

  function dbTabs() {
    return [
      { label: "System", build() {
        const s = S.proj.system;
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

        box.appendChild(h("div", { class: "subhead" }, "Screen"));
        box.appendChild(row(field("Game width (px)", nIn(s, "screenWidth", 384, 3840)),
          field("Game height (px)", nIn(s, "screenHeight", 288, 2160)),
          field("Screen scale (max zoom)", nIn(s, "screenScale", 0.5, 4, 0.1))));
        box.appendChild(row(field("UI area width (0 = full)", nIn(s, "uiWidth", 0, 3840)),
          field("UI area height (0 = full)", nIn(s, "uiHeight", 0, 2160))));
        box.appendChild(h("div", { class: "dim" }, "The UI area centres message windows and menus inside the game screen — useful on very wide screens. Changes apply on the next playtest."));

        box.appendChild(h("div", { class: "subhead" }, "Windows & fonts"));
        const fontOpts = RA.FONTS.slice();
        fontOpts.stringValues = true;
        box.appendChild(row(field("Message font", sel(s, "fontText", fontOpts)),
          field("Menu font", sel(s, "fontMenu", fontOpts))));
        const windowColor = h("input", {
          type: "color",
          value: RA.normalizeWindowColor(s.windowColor),
          oninput(e) { s.windowColor = RA.normalizeWindowColor(e.target.value); touch(); },
        });
        box.appendChild(row(field("Font size (px)", nIn(s, "fontSize", 8, 48)),
          field("Window opacity", rangeIn(s, "windowOpacity", 0, 100, "%")),
          field("Window color", windowColor)));

        box.appendChild(h("div", { class: "subhead" }, "System sounds"));
        const seOpts = SE_NAMES.map((n) => ({ v: n, l: n }));
        seOpts.stringValues = true;
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
      } },
      { label: "Controls", build() {
        // The project's DEFAULT key/gamepad bindings (proj.system.input) — the controls a NEW
        // player starts with. Mirrors the in-game rebinder; replaces the old localStorage snippet.
        const s = S.proj.system;
        const box = h("div", { class: "dbform single" });
        box.appendChild(h("div", { class: "subhead" }, "Default controls"));
        box.appendChild(h("div", { class: "dim" }, "The key/gamepad bindings a NEW player starts with. Players who change their controls in-game keep their own settings — editing these won't override them."));
        s.input = RA.mergeInputBindings(s.input, null); // normalize: guarantees every action/device array exists
        const inActLabel = (k) => { const a = RA.INPUT_ACTIONS.find((x) => x.key === k); return a ? a.label : k; };
        // Display-only controller-family preview. Bindings are stored by POSITION; switching this
        // only changes how gamepad glyphs/labels are drawn — it is NOT written to proj.system.input.
        let previewFamily = "xbox";
        const famOpts = RA.PAD_FAMILIES.map((f) => ({ v: f.key, l: f.label }));
        famOpts.stringValues = true;
        const famObj = { v: previewFamily };
        const inputWrap = h("div", { class: "input-grid-wrap" });
        box.appendChild(inputWrap);
        let inputNote;
        function flashNote(msg) { if (inputNote) inputNote.textContent = msg; }
        function setBinding(device, action, code) {
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
        function removeBinding(device, action, i) {
          const arr = s.input[device][action];
          if (RA.INPUT_CRITICAL.indexOf(action) !== -1 && arr.length <= 1) {
            flashNote(inActLabel(action) + " must keep at least one binding on each device.");
            return;
          }
          arr.splice(i, 1);
          touch();
          renderInputGrid();
        }
        function captureKey(action) {
          let done = false;
          function cleanup() { if (!done) { done = true; document.removeEventListener("keydown", onKey, true); } }
          function onKey(e) {
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
        function pickGamepad(action) {
          const codes = RA.PAD_BUTTONS.concat(["lstick_up", "lstick_down", "lstick_left", "lstick_right"]);
          const list = h("div", { class: "pad-pick" });
          let m;
          codes.forEach((code) => {
            list.appendChild(h("button", { class: "pad-pick-btn", onclick() { m.close(); setBinding("gamepad", action, code); } },
              h("img", { class: "bind-glyph", src: Assets.inputGlyphDataUrl("gamepad", code, previewFamily), alt: "" }),
              h("span", null, RA.codeLabel("gamepad", code, previewFamily))));
          });
          m = modal({ title: "Bind " + inActLabel(action) + " (gamepad)", content: list, buttons: [{ label: "Cancel" }] });
        }
        function bindCell(device, action) {
          const cell = h("div", { class: "bind-cell" });
          const arr = s.input[device][action] || [];
          const fam = device === "gamepad" ? previewFamily : undefined;
          arr.forEach((code, i) => {
            cell.appendChild(h("span", { class: "bind-chip" },
              h("img", { class: "bind-glyph", src: Assets.inputGlyphDataUrl(device, code, fam), alt: RA.codeLabel(device, code, fam), title: RA.codeLabel(device, code, fam) }),
              h("button", { class: "bind-x", title: "Remove", onclick() { removeBinding(device, action, i); } }, "×")));
          });
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
      } },
      { label: "Actors", build: () => listFormTab({
        list: () => S.proj.actors,
        blank: () => ({ id: 0, name: "Actor", classId: S.proj.classes[0].id, level: 1, charset: "hero", weaponId: 0, armorId: 0 }),
        form(e, box, redrawList) {
          const preview = h("span", { class: "char-preview" });
          function rp() {
            preview.innerHTML = "";
            const ci = Assets.charsetIndex(e.charset);
            if (ci >= 0) { preview.appendChild(Assets.faceCanvas(ci)); }
          }
          box.appendChild(row(field("Name", nameRefresher(e, redrawList)), field("Class", sel(e, "classId", dbOpts(S.proj.classes))), field("Initial level", nIn(e, "level", 1, 99))));
          box.appendChild(row(field("Sprite", sel(e, "charset", charsetOpts(true), rp)), preview));
          box.appendChild(row(field("Initial weapon", sel(e, "weaponId", dbOpts(S.proj.weapons, "(none)"))),
            field("Initial armor", sel(e, "armorId", dbOpts(S.proj.armors, "(none)")))));
          rp();
        },
      }) },
      { label: "Classes", build: () => listFormTab({
        list: () => S.proj.classes,
        blank: () => ({ id: 0, name: "Class", icon: 0, base: { mhp: 40, mmp: 12, atk: 10, def: 9, mat: 8, mdf: 8, agi: 8 },
          growth: { mhp: 7, mmp: 2, atk: 2, def: 1.8, mat: 1.8, mdf: 1.8, agi: 1.5 }, traits: [], learnings: [] }),
        form(e, box, redrawList) {
          box.appendChild(row(field("Name", nameRefresher(e, redrawList)), iconPickerField(e, redrawList)));
          const bRow = h("div", { class: "frow" }), gRow = h("div", { class: "frow" });
          for (const k of STAT_KEYS) bRow.appendChild(field(k.toUpperCase(), nIn(e.base, k, 0, 9999)));
          for (const k of STAT_KEYS) gRow.appendChild(field("+" + k.toUpperCase() + "/lv", nIn(e.growth, k, 0, 999, 0.1)));
          box.appendChild(h("div", { class: "subhead" }, "Base stats (level 1)"));
          box.appendChild(bRow);
          box.appendChild(h("div", { class: "subhead" }, "Growth per level"));
          box.appendChild(gRow);
          // traits
          e.traits = Array.isArray(e.traits) ? e.traits : [];
          const traitBox = h("div", { class: "trait-list" });
          function traitKeyOptions(t) {
            if (t.type === "param") {
              const opts = STAT_KEYS.map((k) => ({ v: k, l: k.toUpperCase() }));
              opts.stringValues = true;
              return opts;
            }
            if (t.type === "element") {
              return elementSelOpts();
            }
            if (t.type === "state") {
              const opts = dbOpts(S.proj.states);
              opts.stringValues = true;
              return opts;
            }
            if (t.type === "skill") {
              return skillTypeTraitOpts();
            }
            if (t.type === "equip") {
              const opts = [{ v: "weapon", l: "Weapon" }, { v: "armor", l: "Armor" }];
              opts.stringValues = true;
              return opts;
            }
            const opts = RA.TRAIT_SPECIALS.slice();
            opts.stringValues = true;
            return opts;
          }
          function traitValueLabel(t) {
            if (t.type === "param") return "Stat rate %";
            if (t.type === "element") return "Damage taken %";
            if (t.type === "state") return "Infliction chance %";
            if (t.type === "skill") return "Power rate %";
            return "Value %";
          }
          function redrawTraits() {
            traitBox.innerHTML = "";
            e.traits.forEach((t, i) => {
              const typeOpts = RA.TRAIT_TYPES.slice();
              typeOpts.stringValues = true;
              const typeSelect = sel(t, "type", typeOpts, (type) => {
                Object.assign(t, traitDefault(type));
                redrawTraits();
              });
              const keySelect = sel(t, "key", traitKeyOptions(t), () => {
                if (t.type === "equip") {
                  const db = t.key === "armor" ? S.proj.armors : S.proj.weapons;
                  if (!db.some((item) => item.id === Number(t.value))) t.value = db[0] ? db[0].id : 0;
                  redrawTraits();
                }
              });
              let valueControl;
              if (t.type === "equip") {
                const db = t.key === "armor" ? S.proj.armors : S.proj.weapons;
                valueControl = field("Allowed item", sel(t, "value", dbOpts(db, "(none)")));
              } else {
                const max = t.type === "special" && t.key === "critChance" ? 100 : 999;
                valueControl = field(traitValueLabel(t), nIn(t, "value", 0, max));
              }
              const controls = h("div", { class: "trait-actions" },
                h("button", {
                  class: "mini", title: "Move trait up", "aria-label": "Move trait up",
                  ...(i === 0 ? { disabled: "" } : {}),
                  onclick() {
                    if (i <= 0) return;
                    const [moved] = e.traits.splice(i, 1); e.traits.splice(i - 1, 0, moved);
                    touch(); redrawTraits();
                  },
                }, "↑"),
                h("button", {
                  class: "mini", title: "Move trait down", "aria-label": "Move trait down",
                  ...(i === e.traits.length - 1 ? { disabled: "" } : {}),
                  onclick() {
                    if (i >= e.traits.length - 1) return;
                    const [moved] = e.traits.splice(i, 1); e.traits.splice(i + 1, 0, moved);
                    touch(); redrawTraits();
                  },
                }, "↓"),
                h("button", {
                  class: "mini danger", title: "Delete trait", "aria-label": "Delete trait",
                  onclick() { e.traits.splice(i, 1); touch(); redrawTraits(); },
                }, "Delete"),
              );
              traitBox.appendChild(h("div", { class: "trait-row" },
                field("Trait type", typeSelect), field("Target", keySelect), valueControl, controls));
            });
            if (!e.traits.length) {
              traitBox.appendChild(h("div", { class: "dim trait-empty" }, "No traits. This class uses the engine's normal rules."));
            }
            traitBox.appendChild(h("button", {
              class: "mini trait-add",
              onclick() { e.traits.push(traitDefault("param")); touch(); redrawTraits(); },
            }, "+ Add trait"));
          }
          redrawTraits();
          box.appendChild(h("div", { class: "subhead" }, "Traits"));
          box.appendChild(h("div", { class: "dim" },
            "Rates use 100% as normal, 50% as half, and 0% as immunity. Multiple matching rates multiply. Equipment permissions become a whitelist for that slot."));
          box.appendChild(traitBox);
          // learnings
          const lbox = h("div", { class: "minilist" });
          function redrawL() {
            lbox.innerHTML = "";
            (e.learnings || []).forEach((l, i) => {
              lbox.appendChild(h("div", { class: "minirow" },
                h("span", null, "Lv"), nIn(l, "level", 1, 99), sel(l, "skillId", dbOpts(S.proj.skills)),
                h("button", { class: "mini", onclick() { e.learnings.splice(i, 1); touch(); redrawL(); } }, "✕")));
            });
            lbox.appendChild(h("button", { class: "mini", onclick() {
              e.learnings = e.learnings || [];
              e.learnings.push({ level: 1, skillId: S.proj.skills[0] ? S.proj.skills[0].id : 1 });
              touch(); redrawL();
            } }, "+ add skill"));
          }
          redrawL();
          box.appendChild(h("div", { class: "subhead" }, "Skills learned"));
          box.appendChild(lbox);
        },
      }) },
      { label: "Skills", build: () => listFormTab({
        list: () => S.proj.skills,
        blank: () => ({ id: 0, name: "Skill", icon: 8, type: "magic", power: 20, mp: 5, scope: "enemy", color: "#f07030", stateId: 0, stateOp: "add", stateChance: 100 }),
        form(e, box, redrawList) {
          if (!e.element) e.element = RA.elementOfSkill(e);
          box.appendChild(row(field("Name", nameRefresher(e, redrawList)), iconPickerField(e, redrawList),
            field("Type", sel(e, "type", skillTypeSelOpts())),
            field("Element", sel(e, "element", elementSelOpts())),
            field("Power", nIn(e, "power", 0, 9999)), field("MP cost", nIn(e, "mp", 0, 999))));
          box.appendChild(field("Scope", sel(e, "scope", [
            { v: "enemy", l: "One enemy" }, { v: "enemies", l: "All enemies" },
            { v: "ally", l: "One ally" }, { v: "allies", l: "All allies" }])));
          if (e.stateId == null) e.stateId = 0;
          if (!e.stateOp) e.stateOp = "add";
          if (e.stateChance == null) e.stateChance = 100;
          box.appendChild(h("div", { class: "subhead" }, "State effect (optional)"));
          box.appendChild(row(field("Effect", sel(e, "stateOp", [{ v: "add", l: "Add state" }, { v: "remove", l: "Remove state" }])),
            field("State", sel(e, "stateId", dbOpts(S.proj.states, "(none)"))),
            field("Chance %", nIn(e, "stateChance", 0, 100))));
          box.appendChild(h("div", { class: "dim" }, "Damage: physical = power + 2·ATK − 1.2·DEF · magical = power + 2·MAT − 1.5·MDF · heal = power + 1.2·MAT. The state effect rolls per target hit (see the States tab)."));
        },
      }) },
      { label: "Items", build: () => listFormTab({
        list: () => S.proj.items,
        blank: () => ({ id: 0, name: "Item", icon: 24, price: 50, hp: 50, mp: 0, desc: "" }),
        form(e, box, redrawList) {
          box.appendChild(row(field("Name", nameRefresher(e, redrawList)), iconPickerField(e, redrawList), field("Price", nIn(e, "price", 0))));
          box.appendChild(row(field("Restores HP", nIn(e, "hp", 0, 9999)), field("Restores MP", nIn(e, "mp", 0, 9999))));
          box.appendChild(field("Description", tIn(e, "desc")));
        },
      }) },
      { label: "Weapons", build: () => listFormTab({
        list: () => S.proj.weapons,
        blank: () => ({ id: 0, name: "Weapon", icon: 48, price: 100, wtypeId: 1, params: { atk: 5 } }),
        form(e, box, redrawList) {
          e.params = e.params || {};
          box.appendChild(row(field("Name", nameRefresher(e, redrawList)), iconPickerField(e, redrawList),
            field("Type", sel(e, "wtypeId", typeSelOpts("weaponTypes"))), field("Price", nIn(e, "price", 0))));
          const pr = h("div", { class: "frow" });
          for (const k of PARAM_KEYS) { if (e.params[k] == null) e.params[k] = 0; pr.appendChild(field(k.toUpperCase() + " +", nIn(e.params, k, -999, 999))); }
          box.appendChild(pr);
        },
      }) },
      { label: "Armors", build: () => listFormTab({
        list: () => S.proj.armors,
        blank: () => ({ id: 0, name: "Armor", icon: 56, price: 80, atypeId: 1, etypeId: 4, params: { def: 4 } }),
        form(e, box, redrawList) {
          e.params = e.params || {};
          box.appendChild(row(field("Name", nameRefresher(e, redrawList)), iconPickerField(e, redrawList), field("Price", nIn(e, "price", 0))));
          box.appendChild(row(field("Type", sel(e, "atypeId", typeSelOpts("armorTypes"))),
            field("Equip slot", sel(e, "etypeId", typeSelOpts("equipTypes")))));
          const pr = h("div", { class: "frow" });
          for (const k of PARAM_KEYS) { if (e.params[k] == null) e.params[k] = 0; pr.appendChild(field(k.toUpperCase() + " +", nIn(e.params, k, -999, 999))); }
          box.appendChild(pr);
        },
      }) },
      { label: "Enemies", build: () => listFormTab({
        list: () => S.proj.enemies,
        blank: () => ({ id: 0, name: "Enemy", sprite: "slime", color: "#5aa84f",
          stats: { mhp: 30, atk: 10, def: 6, mat: 5, mdf: 5, agi: 6 }, exp: 10, gold: 10, actions: [{ skillId: 0, weight: 5 }] }),
        form(e, box, redrawList) {
          const preview = h("span", { class: "enemy-preview" });
          function rp() {
            preview.innerHTML = "";
            preview.appendChild(Assets.enemyCanvas(e.sprite, e.color, 96));
          }
          const colorIn = h("input", { type: "color", value: e.color || "#5aa84f", oninput(ev2) { e.color = ev2.target.value; touch(); rp(); } });
          box.appendChild(row(field("Name", nameRefresher(e, redrawList)),
            field("Sprite", sel(e, "sprite", Assets.ENEMY_TYPES.map((t) => ({ v: t, l: Assets.assetLabel(t) })), rp)),
            field("Color", colorIn), preview));
          const st = h("div", { class: "frow" });
          for (const k of ["mhp", "atk", "def", "mat", "mdf", "agi"]) st.appendChild(field(k.toUpperCase(), nIn(e.stats, k, 0, 99999)));
          box.appendChild(st);
          box.appendChild(row(field("EXP reward", nIn(e, "exp", 0)), field("Gold reward", nIn(e, "gold", 0))));
          const abox = h("div", { class: "minilist" });
          function redrawA() {
            abox.innerHTML = "";
            (e.actions || []).forEach((a, i) => {
              abox.appendChild(h("div", { class: "minirow" },
                sel(a, "skillId", [{ v: 0, l: "(basic attack)" }].concat(dbOpts(S.proj.skills))),
                h("span", null, "weight"), nIn(a, "weight", 1, 99),
                h("button", { class: "mini", onclick() { e.actions.splice(i, 1); touch(); redrawA(); } }, "✕")));
            });
            abox.appendChild(h("button", { class: "mini", onclick() {
              e.actions = e.actions || [];
              e.actions.push({ skillId: 0, weight: 1 });
              touch(); redrawA();
            } }, "+ add action"));
          }
          redrawA();
          box.appendChild(h("div", { class: "subhead" }, "Actions (picked by weight)"));
          box.appendChild(abox);
          rp();
        },
      }) },
      { label: "Troops", build: () => listFormTab({
        list: () => S.proj.troops,
        blank: () => ({ id: 0, name: "Troop", enemies: [] }),
        form(e, box, redrawList) {
          box.appendChild(field("Name", nameRefresher(e, redrawList)));
          const mbox = h("div", { class: "frow" });
          function redrawM() {
            mbox.innerHTML = "";
            for (let i = 0; i < 4; i++) {
              const slot = { v: e.enemies[i] || 0 };
              mbox.appendChild(field("Slot " + (i + 1), sel(slot, "v", dbOpts(S.proj.enemies, "(empty)"), () => {
                const arr = [];
                const slots = mbox.querySelectorAll("select");
                slots.forEach((s2) => { const v = Number(s2.value); if (v) arr.push(v); });
                e.enemies = arr;
                touch();
              })));
            }
          }
          redrawM();
          box.appendChild(h("div", { class: "subhead" }, "Members (up to 4)"));
          box.appendChild(mbox);
        },
      }) },
      { label: "Common Events", build: () => listFormTab({
        list: () => S.proj.commonEvents,
        allowEmpty: true,
        blank: () => RA.defaultCommonEvent(),
        form(e, box, redrawList) {
          e.commands = Array.isArray(e.commands) ? e.commands : [];
          e.trigger = ["none", "auto", "parallel"].includes(e.trigger) ? e.trigger : "none";
          e.switchId = Math.max(0, Number(e.switchId) || 0);
          box.appendChild(h("div", { class: "subhead" }, "Common event settings"));
          box.appendChild(row(
            field("Name", nameRefresher(e, redrawList)),
            field("Trigger", sel(e, "trigger", [
              { v: "none", l: "None" },
              { v: "auto", l: "Autorun" },
              { v: "parallel", l: "Parallel" },
            ])),
            field("Activation switch", sel(e, "switchId", switchOpts())),
          ));
          box.appendChild(h("div", { class: "dim" },
            "Autorun and Parallel run while the selected switch is ON. Choose (none) to keep the trigger always active. Direct calls run regardless of this switch."));
          box.appendChild(h("div", { class: "subhead" }, "Contents"));
          box.appendChild(cmdListWidget(() => e.commands, { snapshot() {} }).el);
        },
      }) },
      { label: "Quests", build: () => listFormTab({
        list: () => S.proj.quests,
        allowEmpty: true,
        reorderable: true,
        blank: () => ({
          id: 0,
          name: "Quest",
          shortDesc: "",
          desc: "",
          category: "side",
          visible: true,
          objectives: [],
          startReqs: [],
          failConditions: [],
          rewards: [],
          failEffects: [],
          failText: "",
          nextQuestIds: [],
          autoStartNext: false,
          allowRestartOnFail: false,
          canAbandon: false,
        }),
        form(e, box, redrawList) {
          if (!e.name) e.name = "Quest";
          if (e.shortDesc == null) e.shortDesc = "";
          if (e.desc == null) e.desc = "";
          if (!Array.isArray(e.objectives)) e.objectives = [];
          if (!Array.isArray(e.rewards)) e.rewards = [];
          if (!Array.isArray(e.startReqs)) e.startReqs = [];
          if (!Array.isArray(e.failConditions)) e.failConditions = [];
          if (!Array.isArray(e.failEffects)) e.failEffects = [];
          if (!Array.isArray(e.nextQuestIds)) e.nextQuestIds = [];
          if (!e.category) e.category = "side";
          if (e.visible == null) e.visible = true;
          if (e.autoStartNext == null) e.autoStartNext = false;
          if (e.failText == null) e.failText = "";
          if (e.allowRestartOnFail == null) e.allowRestartOnFail = false;
          if (e.canAbandon == null) e.canAbandon = false;

          const warningWrap = h("div");
          const warningBox = h("div", { class: "minilist" });
          function pushQuestWarning(list, text) {
            if (!list.includes(text)) list.push(text);
          }
          function questWarnings() {
            const warnings = [];
            const questById = (id) => RA.byId(S.proj.quests, Number(id) || 0);
            const itemDbFor = (kind) => kind === "weapon" ? S.proj.weapons : kind === "armor" ? S.proj.armors : S.proj.items;
            if (!e.objectives.length) pushQuestWarning(warnings, "This quest has no objectives.");

            const seenNext = new Set();
            e.nextQuestIds.forEach((nextId) => {
              const id = Number(nextId) || 0;
              if (!id) return;
              if (id === e.id) pushQuestWarning(warnings, "A quest cannot list itself as a next quest.");
              if (seenNext.has(id)) pushQuestWarning(warnings, "This quest lists the same next quest more than once.");
              seenNext.add(id);
              if (!questById(id)) pushQuestWarning(warnings, "Next quest #" + id + " does not exist.");
            });

            e.startReqs.forEach((rq) => {
              if (rq.kind === "quest") {
                const id = Number(rq.questId) || 0;
                if (id && !questById(id)) pushQuestWarning(warnings, "Start requirement references missing quest #" + id + ".");
              }
            });

            e.failEffects.forEach((fx) => {
              if (fx.kind === "questUnlock" || fx.kind === "questLock") {
                const id = Number(fx.questId) || 0;
                if (id && !questById(id)) pushQuestWarning(warnings, "Fail effect references missing quest #" + id + ".");
              }
            });

            e.failConditions.forEach((fc) => {
              if (fc.kind === "battleLose") {
                const id = Number(fc.troopId) || 0;
                if (id && !RA.byId(S.proj.troops, id)) pushQuestWarning(warnings, "Fail condition references missing troop #" + id + ".");
              } else if (fc.kind === "enemyDefeatCount") {
                const id = Number(fc.enemyId) || 0;
                if (id && !RA.byId(S.proj.enemies, id)) pushQuestWarning(warnings, "Fail condition references missing enemy #" + id + ".");
              }
            });

            e.objectives.forEach((obj, i) => {
              const idx = i + 1;
              if (obj.kind === "kill") {
                const id = Number(obj.enemyId) || 0;
                if (id && !RA.byId(S.proj.enemies, id)) pushQuestWarning(warnings, "Objective " + idx + " references missing enemy #" + id + ".");
              } else if (obj.kind === "fetch") {
                const kind = obj.itemKind || "item";
                const id = Number(obj.id) || 0;
                if (id && !RA.byId(itemDbFor(kind), id)) pushQuestWarning(warnings, "Objective " + idx + " references missing " + kind + " #" + id + ".");
                const mapId = Number(obj.targetMapId) || 0;
                const eventId = Number(obj.targetEventId) || 0;
                const map = mapId ? RA.byId(S.proj.maps, mapId) : null;
                if (mapId && !map) pushQuestWarning(warnings, "Objective " + idx + " references missing turn-in map #" + mapId + ".");
                if (eventId && !mapId) pushQuestWarning(warnings, "Objective " + idx + " has a turn-in event but no turn-in map.");
                if (map && eventId && !(map.events || []).some((ev2) => ev2.id === eventId)) {
                  pushQuestWarning(warnings, "Objective " + idx + " references missing turn-in event #" + eventId + " on map #" + mapId + ".");
                }
              }
            });

            return warnings;
          }
          function renderWarnings() {
            const warnings = questWarnings();
            warningWrap.innerHTML = "";
            if (!warnings.length) return;
            warningBox.innerHTML = "";
            warnings.forEach((text) => {
              warningBox.appendChild(h("div", { class: "minirow", style: "color:#ffd1a8; white-space:normal" }, text));
            });
            warningWrap.appendChild(h("div", { class: "subhead" }, "Warnings (" + warnings.length + ")"));
            warningWrap.appendChild(warningBox);
          }

          function effectEditor(list, title, addLabel, blank, kinds) {
            const panel = h("div", { class: "minilist" });
            function redraw() {
              panel.innerHTML = "";
              list.forEach((rw, i) => {
                if (!rw.kind) rw.kind = kinds[0].v;
                const rowEl = h("div", { class: "minirow" });
                rowEl.appendChild(sel(rw, "kind", kinds, redraw));
                if (rw.kind === "item") {
                  if (!rw.itemKind) rw.itemKind = "item";
                  const entryWrap = h("span");
                  const redrawEntry = () => {
                    const arr = rw.itemKind === "weapon" ? S.proj.weapons : rw.itemKind === "armor" ? S.proj.armors : S.proj.items;
                    if (!arr.some((it) => it.id === Number(rw.id))) rw.id = arr[0] ? arr[0].id : 0;
                    entryWrap.innerHTML = "";
                    entryWrap.appendChild(sel(rw, "id", dbOpts(arr, "(none)")));
                  };
                  rowEl.appendChild(sel(rw, "itemKind", [
                    { v: "item", l: "Item" },
                    { v: "weapon", l: "Weapon" },
                    { v: "armor", l: "Armor" },
                  ], redrawEntry));
                  redrawEntry();
                  rowEl.appendChild(entryWrap);
                  rowEl.appendChild(nIn(rw, "count", 1, 99));
                } else if (rw.kind === "switch") {
                  rowEl.appendChild(sel(rw, "id", switchOpts()));
                  rowEl.appendChild(sel(rw, "val", [{ v: "true", l: "ON" }, { v: "false", l: "OFF" }]));
                } else if (rw.kind === "var") {
                  rowEl.appendChild(sel(rw, "id", varOpts()));
                  rowEl.appendChild(sel(rw, "op", [{ v: "set", l: "Set" }, { v: "add", l: "Add" }, { v: "sub", l: "Sub" }]));
                  rowEl.appendChild(nIn(rw, "amount", -9999999, 9999999));
                } else if (rw.kind === "questUnlock" || rw.kind === "questLock") {
                  rowEl.appendChild(sel(rw, "questId", dbOpts(S.proj.quests, "(none)")));
                } else {
                  rowEl.appendChild(nIn(rw, "amount", 0, 9999999));
                }
                rowEl.appendChild(h("button", { class: "mini", onclick() { list.splice(i, 1); touch(); redraw(); } }, "✕"));
                panel.appendChild(rowEl);
              });
              panel.appendChild(h("button", { class: "mini", onclick() {
                list.push(blank());
                touch(); redraw();
              } }, addLabel));
              renderWarnings();
            }
            redraw();
            box.appendChild(h("div", { class: "subhead" }, title));
            box.appendChild(panel);
          }
          function failConditionEditor() {
            const panel = h("div", { class: "minilist" });
            function redraw() {
              panel.innerHTML = "";
              e.failConditions.forEach((fc, i) => {
                if (!fc.kind) fc.kind = "manual";
                const rowEl = h("div", { class: "minirow", style: "align-items:flex-start; flex-wrap:wrap" });
                rowEl.appendChild(field("Type", sel(fc, "kind", stringSelOpts(["manual", "switch", "var", "battleLose", "enemyDefeatCount"]), redraw)));
                if (fc.kind === "switch") {
                  rowEl.appendChild(field("Switch", sel(fc, "id", switchOpts())));
                  rowEl.appendChild(field("State", sel(fc, "val", [{ v: "true", l: "ON" }, { v: "false", l: "OFF" }])));
                } else if (fc.kind === "var") {
                  rowEl.appendChild(field("Variable", sel(fc, "id", varOpts())));
                  rowEl.appendChild(field("Cmp", sel(fc, "cmp", [{ v: ">=", l: "≥" }, { v: "==", l: "=" }, { v: "<=", l: "≤" }])));
                  rowEl.appendChild(field("Value", nIn(fc, "val", -9999999, 9999999)));
                } else if (fc.kind === "battleLose") {
                  rowEl.appendChild(field("Troop", sel(fc, "troopId", dbOpts(S.proj.troops, "(none)"))));
                } else if (fc.kind === "enemyDefeatCount") {
                  rowEl.appendChild(field("Enemy", sel(fc, "enemyId", dbOpts(S.proj.enemies, "(none)"))));
                  rowEl.appendChild(field("Losses", nIn(fc, "count", 1, 99)));
                } else {
                  rowEl.appendChild(h("div", { class: "dim" }, "Manual fail only — use the Fail Quest command."));
                }
                rowEl.appendChild(h("button", { class: "mini", onclick() { e.failConditions.splice(i, 1); touch(); redraw(); } }, "✕"));
                panel.appendChild(rowEl);
              });
              panel.appendChild(h("button", { class: "mini", onclick() {
                e.failConditions.push({ kind: "manual" });
                touch(); redraw();
              } }, "+ add fail condition"));
              renderWarnings();
            }
            redraw();
            box.appendChild(h("div", { class: "subhead" }, "Fail conditions"));
            box.appendChild(panel);
          }

          function requirementEditor() {
            const panel = h("div", { class: "minilist" });
            function redraw() {
              panel.innerHTML = "";
              e.startReqs.forEach((rq, i) => {
                if (!rq.kind) rq.kind = "quest";
                const rowEl = h("div", { class: "minirow" });
                rowEl.appendChild(sel(rq, "kind", [
                  { v: "quest", l: "Quest state" },
                  { v: "switch", l: "Switch" },
                  { v: "var", l: "Variable" },
                ], redraw));
                if (rq.kind === "quest") {
                  const questOpts = [{ v: 0, l: "(none)" }].concat(S.proj.quests.filter((q) => q !== e).map((q) => ({ v: q.id, l: q.id + ": " + (q.name || "Quest") })));
                  rowEl.appendChild(sel(rq, "questId", questOpts));
                  rowEl.appendChild(sel(rq, "status", stringSelOpts(["active", "completed", "failed", "abandoned"])));
                } else if (rq.kind === "switch") {
                  rowEl.appendChild(sel(rq, "id", switchOpts()));
                  rowEl.appendChild(sel(rq, "val", [{ v: "true", l: "ON" }, { v: "false", l: "OFF" }]));
                } else {
                  rowEl.appendChild(sel(rq, "id", varOpts()));
                  rowEl.appendChild(sel(rq, "cmp", [{ v: ">=", l: "≥" }, { v: "==", l: "=" }, { v: "<=", l: "≤" }]));
                  rowEl.appendChild(nIn(rq, "val", -9999999, 9999999));
                }
                rowEl.appendChild(h("button", { class: "mini", onclick() { e.startReqs.splice(i, 1); touch(); redraw(); } }, "✕"));
                panel.appendChild(rowEl);
              });
              panel.appendChild(h("button", { class: "mini", onclick() {
                e.startReqs.push({ kind: "quest", questId: 0, status: "completed" });
                touch(); redraw();
              } }, "+ add requirement"));
              renderWarnings();
            }
            redraw();
            box.appendChild(h("div", { class: "subhead" }, "Availability / start requirements"));
            box.appendChild(panel);
          }
          function objectiveEditor() {
            const panel = h("div", { class: "minilist" });
            function redraw() {
              panel.innerHTML = "";
              e.objectives.forEach((obj, i) => {
                if (!obj.kind) obj.kind = "event";
                if (!obj.label) obj.label = "";
                if (obj.count == null) obj.count = 1;
                const rowEl = h("div", { class: "minirow", style: "align-items:flex-start; flex-wrap:wrap" });
                rowEl.appendChild(field("Type", sel(obj, "kind", stringSelOpts(["event", "kill", "fetch"]), redraw)));
                rowEl.appendChild(field("Label", tIn(obj, "label")));
                rowEl.appendChild(field("Count", nIn(obj, "count", 1, 999)));
                if (obj.kind === "kill") {
                  rowEl.appendChild(field("Enemy", sel(obj, "enemyId", dbOpts(S.proj.enemies, "(none)"))));
                } else if (obj.kind === "fetch") {
                  const itemWrap = h("span");
                  const eventWrap = h("span");
                  const redrawItem = () => {
                    const arr = obj.itemKind === "weapon" ? S.proj.weapons : obj.itemKind === "armor" ? S.proj.armors : S.proj.items;
                    if (!arr.some((it) => it.id === Number(obj.id))) obj.id = arr[0] ? arr[0].id : 0;
                    itemWrap.innerHTML = "";
                    itemWrap.appendChild(sel(obj, "id", dbOpts(arr, "(none)")));
                  };
                  const redrawEvent = () => {
                    const map = RA.byId(S.proj.maps, obj.targetMapId);
                    const eventOpts = [{ v: 0, l: "(any)" }].concat((map || { events: [] }).events.map((ev2) => ({ v: ev2.id, l: ev2.id + ": " + ev2.name })));
                    eventWrap.innerHTML = "";
                    eventWrap.appendChild(sel(obj, "targetEventId", eventOpts));
                  };
                  if (!obj.itemKind) obj.itemKind = "item";
                  rowEl.appendChild(field("Kind", sel(obj, "itemKind", [
                    { v: "item", l: "Item" },
                    { v: "weapon", l: "Weapon" },
                    { v: "armor", l: "Armor" },
                  ], redrawItem)));
                  redrawItem();
                  rowEl.appendChild(field("Entry", itemWrap));
                  rowEl.appendChild(field("Turn-in map", sel(obj, "targetMapId", dbOpts(S.proj.maps, "(any)"), redrawEvent)));
                  redrawEvent();
                  rowEl.appendChild(field("Turn-in event", eventWrap));
                  rowEl.appendChild(field("Consume on complete", chk(obj, "consumeOnComplete")));
                }
                rowEl.appendChild(h("button", { class: "mini", onclick() { e.objectives.splice(i, 1); touch(); redraw(); } }, "✕"));
                panel.appendChild(rowEl);
              });
              panel.appendChild(h("div", { class: "minirow" },
                h("button", { class: "mini", onclick() { e.objectives.push({ kind: "event", label: "Talk to target", count: 1 }); touch(); redraw(); } }, "+ Event objective"),
                h("button", { class: "mini", onclick() { e.objectives.push({ kind: "kill", label: "Defeat target enemies", enemyId: S.proj.enemies[0] ? S.proj.enemies[0].id : 0, count: 3 }); touch(); redraw(); } }, "+ Kill objective"),
                h("button", { class: "mini", onclick() { e.objectives.push({ kind: "fetch", label: "Bring requested item", itemKind: "item", id: S.proj.items[0] ? S.proj.items[0].id : 0, count: 1, targetMapId: 0, targetEventId: 0, consumeOnComplete: false }); touch(); redraw(); } }, "+ Fetch objective")));
              renderWarnings();
            }
            redraw();
            box.appendChild(h("div", { class: "subhead" }, "Objectives"));
            box.appendChild(panel);
          }

          box.appendChild(row(field("Title", nameRefresher(e, redrawList)),
            field("Category", sel(e, "category", stringSelOpts(["main", "side", "guild", "hidden"]))),
            field("Visible in journal", chk(e, "visible"))));
          const shortDesc = h("input", { type: "text", value: e.shortDesc || "", oninput(ev) { e.shortDesc = ev.target.value; touch(); } });
          const desc = h("textarea", { rows: 5, oninput(ev) { e.desc = ev.target.value; touch(); } }, e.desc || "");
          box.appendChild(field("Short description", shortDesc));
          box.appendChild(field("Long description", desc));
          renderWarnings();
          box.appendChild(warningWrap);

          objectiveEditor();
          requirementEditor();
          failConditionEditor();

          effectEditor(e.rewards, "Rewards", "+ add reward", () => ({ kind: "gold", amount: 100 }), [
            { v: "exp", l: "XP" },
            { v: "gold", l: "Money" },
            { v: "item", l: "Item" },
          ]);

          effectEditor(e.failEffects, "Fail effects", "+ add fail effect", () => ({ kind: "switch", id: 1, val: "true" }), [
            { v: "gold", l: "Money" },
            { v: "item", l: "Item" },
            { v: "switch", l: "Switch" },
            { v: "var", l: "Variable" },
            { v: "questUnlock", l: "Unlock quest" },
            { v: "questLock", l: "Lock quest" },
          ]);
          box.appendChild(field("Failure / consequence text", h("textarea", { rows: 3, oninput(ev) { e.failText = ev.target.value; touch(); } }, e.failText || "")));

          const nextBox = h("div", { class: "minilist" });
          function redrawNext() {
            nextBox.innerHTML = "";
            e.nextQuestIds.forEach((id, i) => {
              const slot = { id };
              const options = [{ v: 0, l: "(none)" }].concat(S.proj.quests.filter((q) => q !== e).map((q) => ({ v: q.id, l: q.id + ": " + (q.name || "Quest") })));
              nextBox.appendChild(h("div", { class: "minirow" },
                sel(slot, "id", options, () => {
                  e.nextQuestIds[i] = slot.id;
                  e.nextQuestIds = e.nextQuestIds.filter((qid) => qid && qid !== e.id);
                  touch();
                }),
                h("button", { class: "mini", onclick() { e.nextQuestIds.splice(i, 1); touch(); redrawNext(); } }, "✕")));
            });
            nextBox.appendChild(h("button", { class: "mini", onclick() {
              const candidate = S.proj.quests.find((q) => q !== e && !e.nextQuestIds.includes(q.id));
              if (!candidate) return;
              e.nextQuestIds.push(candidate.id);
              touch(); redrawNext();
            } }, "+ add next quest"));
            renderWarnings();
          }
          redrawNext();
          box.appendChild(h("div", { class: "subhead" }, "Next quests"));
          box.appendChild(nextBox);
          box.appendChild(field("Auto-start next quests", chk(e, "autoStartNext")));
          box.appendChild(row(field("Allow restart after fail", chk(e, "allowRestartOnFail")), field("Player can abandon", chk(e, "canAbandon"))));
        },
      }) },
      { label: "States", build: () => listFormTab({
        list: () => S.proj.states,
        blank: () => ({ id: 0, name: "State", icon: 12, color: "#a050d8", restrict: "none", hpTurn: 0, minTurns: 2, maxTurns: 4, removeAtEnd: true }),
        form(e, box, redrawList) {
          const colorIn = h("input", { type: "color", value: e.color || "#a050d8", oninput(ev2) { e.color = ev2.target.value; touch(); } });
          box.appendChild(row(field("Name", nameRefresher(e, redrawList)), iconPickerField(e, redrawList), field("Color", colorIn)));
          box.appendChild(row(field("Restriction", sel(e, "restrict", [{ v: "none", l: "None" }, { v: "act", l: "Cannot act" }])),
            field("HP per turn %", nIn(e, "hpTurn", -100, 100)),
            field("Min turns", nIn(e, "minTurns", 1, 99)), field("Max turns", nIn(e, "maxTurns", 1, 99)),
            field("Removed after battle", chk(e, "removeAtEnd"))));
          box.appendChild(h("div", { class: "dim" }, "Negative HP per turn deals damage each round (poison); positive restores (regen). “Cannot act” makes the battler skip its turns (stun). States are inflicted or cured by skills — set that on the Skills tab. Full recovery cures all states."));
        },
      }) },
      { label: "Tilesets", build: () => tilesetTab() },
      { label: "Types", build: () => typesTab() },
      { label: "Switches", build: () => nameListTab("switches", "S", RA.MAX_SWITCHES) },
      { label: "Variables", build: () => nameListTab("variables", "V", RA.MAX_VARIABLES) },
    ];
  }

  // ====================== Tilesets tab ======================
  // Passage byte: bits 0-7 = N E S W NE SE SW NW (1 = passable)
  // Flag byte: bit 0=bush bit 1=ladder bit 2=counter bit 3=damage
  // terrain: 0-7 tag number
  const TS_DIRS = [
    [7, "↖", "NW"], [0, "↑", "N"],  [4, "↗", "NE"],
    [3, "←", "W"],  [-1, "●", ""],  [1, "→", "E"],
    [6, "↙", "SW"], [2, "↓", "S"],  [5, "↘", "SE"],
  ];
  const TS_FLAGS = [
    { bit: 0, label: "Bush", tip: "Player is drawn behind this tile" },
    { bit: 1, label: "Ladder", tip: "Player faces up and passes through (walk south looks like climbing)" },
    { bit: 2, label: "Counter", tip: "NPCs can interact with the player from across this tile" },
    { bit: 3, label: "Damage Floor", tip: "Player takes damage each step on this tile" },
  ];

  function tilesetTab() {
    if (!Array.isArray(S.proj.tilesets) || !S.proj.tilesets.length) {
      S.proj.tilesets = [{ id: 1, name: "Default", tileProps: {} }];
    }

    const wrap = h("div", { class: "dbtab" });
    const listEl = h("ul", { class: "dblist" });
    const formEl = h("div", { class: "dbform" });
    let cur = S.proj.tilesets[0] || null;
    let selTileIdx = -1;
    let tileBtns = [];
    let detailEl = null;

    function tileDefaultPass(idx) {
      const tile = Assets.tiles[idx];
      return (tile && tile.pass) ? 0xFF : 0x00;
    }
    function getTileProps(ts, idx) {
      const key = Assets.tiles[idx] && Assets.tiles[idx].key;
      return (ts.tileProps[key]) || { pass: tileDefaultPass(idx), flag: 0, terrain: 0 };
    }
    function saveTileProps(idx, update) {
      const key = Assets.tiles[idx].key;
      cur.tileProps[key] = Object.assign({}, getTileProps(cur, idx), update);
      touch();
      redrawDetail();
    }

    function redrawDetail() {
      if (!detailEl) return;
      detailEl.innerHTML = "";
      if (selTileIdx < 1 || !cur) {
        detailEl.appendChild(h("div", { class: "dim" }, "Select a tile above to configure its passage, flags, and terrain tag."));
        return;
      }
      const tile = Assets.tiles[selTileIdx];
      const props = getTileProps(cur, selTileIdx);

      // Tile preview + label
      const prev = document.createElement("canvas");
      prev.width = 48; prev.height = 48;
      prev.style.cssText = "image-rendering:pixelated;border:1px solid #2c2f44;border-radius:4px;flex:0 0 auto";
      prev.getContext("2d").drawImage(Assets.tileCanvas(selTileIdx), 0, 0);
      detailEl.appendChild(h("div", { class: "ts-tile-heading" }, prev,
        h("div", null,
          h("div", { style: "font-weight:600;margin-bottom:2px" }, tile.name),
          h("div", { class: "dim", style: "font-size:11px" }, tile.key + " · tile " + selTileIdx)
        )
      ));

      // Passage
      detailEl.appendChild(h("div", { class: "subhead" }, "Passage — 8 directions"));
      detailEl.appendChild(h("div", { class: "dim" }, "Click a direction to toggle. Green = passable, red = blocked."));
      const passGrid = h("div", { class: "ts-pass-grid" });
      for (const [bit, glyph] of TS_DIRS) {
        if (bit === -1) {
          const any = (props.pass & 0x0F) !== 0;
          passGrid.appendChild(h("div", { class: "ts-pass-center" + (any ? " passable" : " blocked") }, glyph));
        } else {
          const isPass = !!(props.pass & (1 << bit));
          passGrid.appendChild(h("button", {
            class: "ts-pass-btn" + (isPass ? " passable" : " blocked"),
            onclick() { saveTileProps(selTileIdx, { pass: isPass ? (props.pass & ~(1 << bit)) : (props.pass | (1 << bit)) }); },
          }, glyph));
        }
      }
      detailEl.appendChild(passGrid);
      detailEl.appendChild(h("div", { class: "ts-pass-actions" },
        h("button", { class: "mini", onclick() { saveTileProps(selTileIdx, { pass: 0xFF }); } }, "Allow all"),
        h("button", { class: "mini", onclick() { saveTileProps(selTileIdx, { pass: 0x00 }); } }, "Block all"),
        h("button", { class: "mini", onclick() {
          const key = Assets.tiles[selTileIdx].key;
          delete cur.tileProps[key];
          touch(); redrawDetail();
        } }, "Reset to default"),
      ));

      // Special flags
      detailEl.appendChild(h("div", { class: "subhead" }, "Special flags"));
      const flagWrap = h("div", { class: "ts-flags" });
      for (const fd of TS_FLAGS) {
        const on = !!(props.flag & (1 << fd.bit));
        const cb = h("input", { type: "checkbox", title: fd.tip, ...(on ? { checked: "" } : {}),
          onchange(e) {
            const p = getTileProps(cur, selTileIdx);
            saveTileProps(selTileIdx, { flag: e.target.checked ? (p.flag | (1 << fd.bit)) : (p.flag & ~(1 << fd.bit)) });
          },
        });
        flagWrap.appendChild(h("label", { class: "ts-flag-label", title: fd.tip }, cb, " " + fd.label));
      }
      detailEl.appendChild(flagWrap);

      // Terrain tag
      detailEl.appendChild(h("div", { class: "subhead" }, "Terrain tag"));
      detailEl.appendChild(row(field("Tag (0 = none, 1–7)",
        h("input", { type: "number", min: 0, max: 7, value: props.terrain || 0, style: "width:70px",
          onchange(e) { saveTileProps(selTileIdx, { terrain: Math.max(0, Math.min(7, Number(e.target.value) || 0)) }); },
        })
      )));
      detailEl.appendChild(h("div", { class: "dim" },
        "Terrain tags let scripts and plugins classify tile types (e.g., 1=shallow water, 2=grass). Tag 0 means no special terrain."
      ));
    }

    function selectTile(idx) {
      tileBtns.forEach((b, i) => b.classList.toggle("sel", i + 1 === idx));
      selTileIdx = idx;
      redrawDetail();
    }

    function redrawForm() {
      formEl.innerHTML = "";
      tileBtns = [];
      selTileIdx = -1;
      detailEl = null;
      if (!cur) return;

      const nameInp = tIn(cur, "name");
      nameInp.addEventListener("input", redrawList);
      formEl.appendChild(row(field("Name", nameInp)));

      formEl.appendChild(h("div", { class: "subhead" }, "Tiles"));
      formEl.appendChild(h("div", { class: "dim" }, "Click a tile to configure passage, special flags, and terrain tag."));

      const tileGrid = h("div", { class: "ts-tile-grid" });
      for (let i = 1; i < Assets.tiles.length; i++) {
        const tile = Assets.tiles[i];
        const btn = h("button", { class: "ts-tile-btn", title: tile.name, onclick() { selectTile(i); } });
        const src = Assets.tileCanvas(i);
        const thumb = document.createElement("canvas");
        thumb.width = 32; thumb.height = 32;
        thumb.style.cssText = "image-rendering:pixelated;display:block";
        thumb.getContext("2d").drawImage(src, 0, 0, src.width, src.height, 0, 0, 32, 32);
        btn.appendChild(thumb);
        tileBtns.push(btn);
        tileGrid.appendChild(btn);
      }
      formEl.appendChild(tileGrid);

      detailEl = h("div", { class: "ts-tile-detail" });
      formEl.appendChild(detailEl);
      redrawDetail();
    }

    function redrawList() {
      listEl.innerHTML = "";
      for (const ts of S.proj.tilesets) {
        const li = h("li", { class: ts === cur ? "sel" : "", onclick() { cur = ts; selTileIdx = -1; redrawList(); redrawForm(); } },
          h("span", { class: "db-entry-id" }, ts.id + ":"),
          h("span", null, ts.name || "—"));
        listEl.appendChild(li);
      }
    }

    const btns = h("div", { class: "dbbtns" },
      h("button", { onclick() {
        const e = { id: RA.nextId(S.proj.tilesets), name: "Tileset", tileProps: {} };
        S.proj.tilesets.push(e);
        cur = e; touch(); redrawList(); redrawForm();
      } }, "+ New"),
      h("button", { onclick() {
        if (!cur) return;
        if (S.proj.tilesets.length <= 1) { alert("Keep at least one tileset."); return; }
        confirmBox("Delete \"" + cur.name + "\"?", () => {
          S.proj.tilesets.splice(S.proj.tilesets.indexOf(cur), 1);
          cur = S.proj.tilesets[0] || null;
          touch(); redrawList(); redrawForm();
        });
      } }, "Delete"),
    );

    cur = S.proj.tilesets[0] || null;
    redrawList(); redrawForm();
    wrap.appendChild(h("div", { class: "dbside" }, btns, listEl));
    wrap.appendChild(formEl);
    return wrap;
  }

  // A unique string key for a new element / skill type, kept stable so that
  // renaming or reordering never breaks references stored on skills & traits.
  function uniqueTypeKey(prefix, list) {
    let n = list.length + 1, key;
    do { key = prefix + n; n++; } while (list.some((e) => e.key === key));
    return key;
  }

  function typeColumn(list, label, blank, lockedNote) {
    const col = h("div", { class: "types-col" });
    col.appendChild(h("div", { class: "types-col-head" }, label));
    const rows = h("div", { class: "types-rows" });
    function redraw() {
      rows.innerHTML = "";
      list.forEach((entry, i) => {
        const num = h("span", { class: "types-num" }, String(i + 1).padStart(2, "0"));
        const input = h("input", { type: "text", value: entry.name || "",
          oninput(ev) { entry.name = ev.target.value; touch(); } });
        const del = h("button", {
          class: "mini danger", title: "Delete", "aria-label": "Delete " + (entry.name || "entry"),
          onclick() {
            if (list.length <= 1) { alert("Keep at least one entry."); return; }
            list.splice(i, 1); touch(); redraw();
          },
        }, "✕");
        rows.appendChild(h("div", { class: "types-row" }, num, input, del));
      });
    }
    redraw();
    col.appendChild(rows);
    col.appendChild(h("button", { class: "mini types-add",
      onclick() { list.push(blank()); touch(); redraw(); } }, "+ Add"));
    if (lockedNote) col.appendChild(h("div", { class: "dim" }, lockedNote));
    return col;
  }

  function typesTab() {
    const t = S.proj.system.types;
    const box = h("div", { class: "dbform single" });
    box.appendChild(h("div", { class: "dim", style: "margin-bottom:10px" },
      "Define the categories your game uses. Elements drive resistances (set them on Classes ▸ Traits and pick one per skill). " +
      "Skill types label the three combat classes — only Physical, Magical and Heal affect the damage formula. " +
      "Weapon, armor and equipment types tag equipment for organisation. Renaming or reordering is always safe."));
    const cols = h("div", { class: "types-cols" });
    cols.appendChild(typeColumn(t.elements, "Elements",
      () => ({ key: uniqueTypeKey("elem", t.elements), name: "New Element" })));
    cols.appendChild(typeColumn(t.skillTypes, "Skill Types",
      () => ({ key: uniqueTypeKey("stype", t.skillTypes), name: "New Type" }),
      "Extra skill types beyond the first three are labels only."));
    cols.appendChild(typeColumn(t.weaponTypes, "Weapon Types",
      () => ({ id: RA.nextId(t.weaponTypes), name: "New Weapon Type" })));
    cols.appendChild(typeColumn(t.armorTypes, "Armor Types",
      () => ({ id: RA.nextId(t.armorTypes), name: "New Armor Type" })));
    cols.appendChild(typeColumn(t.equipTypes, "Equipment Types",
      () => ({ id: RA.nextId(t.equipTypes), name: "New Slot" })));
    box.appendChild(cols);
    return box;
  }

  function nameListTab(key, prefix, maxEntries) {
    const names = S.proj.system[key];
    const box = h("div", { class: "dbform single namegrid" });
    const addBtn = h("button", { class: "namegrid-add" });

    function appendEntry(i) {
      const input = h("input", {
        type: "text",
        value: names[i],
        oninput(e) { names[i] = e.target.value; touch(); },
      });
      box.insertBefore(field(prefix + String(i + 1).padStart(3, "0"), input), addBtn);
      return input;
    }

    function updateAddButton() {
      const atLimit = names.length >= maxEntries;
      addBtn.disabled = atLimit;
      addBtn.textContent = atLimit ? "Maximum " + maxEntries + " reached" : "Add New";
    }

    box.appendChild(addBtn);
    names.forEach((_, i) => appendEntry(i));
    addBtn.addEventListener("click", () => {
      if (names.length >= maxEntries) return;
      names.push("");
      const input = appendEntry(names.length - 1);
      updateAddButton();
      touch();
      requestAnimationFrame(() => {
        input.scrollIntoView({ block: "nearest" });
        input.focus();
      });
    });
    updateAddButton();
    return box;
  }

  function openDatabase() {
    const tabs = dbTabs();
    const tabBar = h("div", { class: "dbtabs-vert" });
    const body = h("div", { class: "dbbody" });
    let cur = 0;
    function show(i) {
      cur = i;
      tabBar.querySelectorAll("button").forEach((b, bi) => b.classList.toggle("sel", bi === i));
      body.innerHTML = "";
      body.appendChild(tabs[i].build());
    }
    tabs.forEach((t, i) => tabBar.appendChild(h("button", { onclick: () => show(i) }, t.label)));
    const content = h("div", { class: "dbwrap" }, tabBar, body);
    modal({ title: "Database", content, wide: true, class: "db-modal", dismissable: false,
      buttons: [{ label: "Close", primary: true, onClick(c) { c(); rebuildMapList(); renderMap(); } }] });
    show(0);
  }

  // ============================ plugin manager ============================
  const PLUGIN_TEMPLATE = `/* RPGAtlas plugin — runs once when the game boots.
 * Available objects:
 *   atlas.project / atlas.map / atlas.player / atlas.scene
 *   atlas.SCREEN_W atlas.SCREEN_H atlas.TILE   atlas.Assets / atlas.Sfx / atlas.Music
 *   atlas.onMapLoad(fn)        fn(map) after every map load
 *   atlas.onUpdate(fn)         fn() every frame on the map scene
 *   atlas.onRender(ctx, info)  draw over the map each frame (info: w,h,t,map,camX,camY)
 *   atlas.onMessageText(fn)    transform message HTML (text codes)
 *   atlas.setTransition({out,in})   custom transfer effect
 *   atlas.registerCommand(type, fn) handle a custom event command
 *   atlas.startBattle(troopId)      start a battle, resolves "win"/"lose"/"escape"
 *   game.setSwitch/getSwitch/setVar/getVar/addGold/callCommonEvent/party/state
 * Tip: the bundled Atlas_* plugins (Add → Built-in…) show real examples.
 * A hook that throws is disabled (see the browser console). */
atlas.onMapLoad((map) => {
  console.log("Entered " + map.name);
});`;

  function openPluginManager() {
    const plugins = S.proj.plugins;
    let cur = plugins[0] || null;
    const list = h("ul", { class: "plug-list" });
    const nameIn = h("input", { type: "text", placeholder: "Plugin name", oninput(e) { if (cur) { cur.name = e.target.value; touch(); redrawList(); } } });
    const pluginIdIn = h("input", { type: "text", placeholder: "Plugin ID, e.g. atlas.weather", oninput(e) { if (cur) { cur.pluginId = e.target.value.trim(); touch(); redrawList(); } } });
    const versionIn = h("input", { type: "text", placeholder: "Version", oninput(e) { if (cur) { cur.version = e.target.value.trim(); touch(); } } });
    const authorIn = h("input", { type: "text", placeholder: "Author", oninput(e) { if (cur) { cur.author = e.target.value; touch(); } } });
    const depsIn = h("input", { type: "text", placeholder: "Dependencies: atlas.core, other.plugin", oninput(e) { if (cur) { cur.dependencies = e.target.value.split(",").map((s) => s.trim()).filter(Boolean); touch(); redrawList(); } } });
    const descIn = h("textarea", { class: "plug-desc", placeholder: "Description", spellcheck: "true", oninput(e) { if (cur) { cur.description = e.target.value; touch(); } } });
    const codeTa = h("textarea", { spellcheck: "false", oninput(e) { if (cur) { cur.code = e.target.value; touch(); } } });
    function pluginIdentity(pl) { return String(pl && (pl.pluginId || pl.key || pl.name || ("plugin." + pl.id)) || "").trim(); }
    function pluginStatus(pl) {
      const id = pluginIdentity(pl);
      if (!id) return { label: "missing id", cls: "warn" };
      if (plugins.some((other) => other !== pl && pluginIdentity(other) === id)) return { label: "duplicate id", cls: "warn" };
      const missing = (pl.dependencies || []).filter((dep) => !plugins.some((other) => other.on && pluginIdentity(other) === dep));
      if (pl.on && missing.length) return { label: "missing dep", cls: "warn" };
      return { label: pl.on ? "ready" : "disabled", cls: pl.on ? "ok" : "off" };
    }
    function redrawList() {
      list.innerHTML = "";
      plugins.forEach((pl) => {
        const st = pluginStatus(pl);
        const cb = h("input", { type: "checkbox",
          onclick(e) { e.stopPropagation(); },
          onchange(e) { pl.on = e.target.checked; touch(); redrawList(); },
          ...(pl.on ? { checked: "" } : {}) });
        const kids = [cb, h("span", { class: "plug-name" }, pl.name || "(unnamed)")];
        if (pl.builtin) kids.push(h("span", { class: "plug-badge" }, "built-in"));
        kids.push(h("span", { class: "plug-status " + st.cls }, st.label));
        list.appendChild(h("li", {
          class: (pl === cur ? "sel" : "") + (pl.on ? "" : " off"),
          onclick() { cur = pl; redrawList(); redrawForm(); },
        }, ...kids));
      });
    }
    function addBuiltinPicker() {
      const missing = typeof AtlasBuiltins !== "undefined" ? AtlasBuiltins.missingFor(plugins) : [];
      if (!missing.length) { flashStatus("All bundled plugins are already in this project"); return; }
      const box = h("div", { class: "minilist" });
      const picker = modal({ title: "Add Bundled Plugin", content: box, buttons: [{ label: "Cancel" }] });
      missing.forEach((spec) => {
        box.appendChild(h("div", { class: "minirow", style: "align-items:flex-start" },
          h("div", { style: "flex:1" }, h("b", null, spec.key), h("div", { class: "dim" }, spec.desc)),
          h("button", { class: "mini", onclick() {
            const id = RA.nextId(plugins.length ? plugins : [{ id: 0 }]);
            const pl = AtlasBuiltins.make(spec.key, id);
            plugins.push(pl); cur = pl;
            touch(); redrawList(); redrawForm(); picker.close();
          } }, "Add")));
      });
    }
    function redrawForm() {
      nameIn.value = cur ? cur.name : "";
      pluginIdIn.value = cur ? (cur.pluginId || cur.key || "") : "";
      versionIn.value = cur ? (cur.version || "") : "";
      authorIn.value = cur ? (cur.author || "") : "";
      depsIn.value = cur ? (cur.dependencies || []).join(", ") : "";
      descIn.value = cur ? (cur.description || "") : "";
      codeTa.value = cur ? cur.code : "";
      nameIn.disabled = pluginIdIn.disabled = versionIn.disabled = authorIn.disabled = depsIn.disabled = descIn.disabled = codeTa.disabled = !cur;
    }
    function move(d) {
      if (!cur) return;
      const i = plugins.indexOf(cur), ni = i + d;
      if (ni < 0 || ni >= plugins.length) return;
      plugins.splice(i, 1); plugins.splice(ni, 0, cur);
      touch(); redrawList();
    }
    const side = h("div", { class: "plug-side" },
      h("div", { class: "dbbtns" },
        h("button", { onclick() {
          const id = RA.nextId(plugins.length ? plugins : [{ id: 0 }]);
          const pl = { id: id, name: "New Plugin", pluginId: "plugin." + id, version: "1.0.0", author: "", description: "", dependencies: [], on: true, code: PLUGIN_TEMPLATE };
          plugins.push(pl); cur = pl;
          touch(); redrawList(); redrawForm();
        } }, "+ New"),
        h("button", { title: "Add one of the engine's bundled plugins", onclick: addBuiltinPicker }, "+ Built-in…"),
        h("button", { onclick() {
          if (!cur) return;
          confirmBox('Delete plugin "' + cur.name + '"?', () => {
            plugins.splice(plugins.indexOf(cur), 1);
            cur = plugins[0] || null;
            touch(); redrawList(); redrawForm();
          });
        } }, "Delete"),
        h("button", { class: "mini", title: "Run earlier", onclick: () => move(-1) }, "↑"),
        h("button", { class: "mini", title: "Run later", onclick: () => move(1) }, "↓"),
      ),
      list,
      h("div", { class: "dim" }, "Checked plugins run top-to-bottom at game boot."),
    );
    const meta = h("div", { class: "plug-meta" },
      h("label", null, "Name", nameIn),
      h("label", null, "Plugin ID", pluginIdIn),
      h("label", null, "Version", versionIn),
      h("label", null, "Author", authorIn),
      h("label", { class: "wide" }, "Dependencies", depsIn),
      h("label", { class: "wide" }, "Description", descIn));
    const form = h("div", { class: "plug-form" }, meta, codeTa);
    const minSideW = 220, minFormW = 360;
    let draggingSplit = false, dragStartX = 0, dragStartW = 0;
    function clampSideW(w) {
      const max = Math.max(minSideW, wrap.getBoundingClientRect().width - minFormW);
      return Math.max(minSideW, Math.min(max, w));
    }
    const split = h("div", {
      class: "plug-split",
      title: "Drag to resize the plugin list",
      onpointerdown(e) {
        draggingSplit = true;
        dragStartX = e.clientX;
        dragStartW = side.getBoundingClientRect().width;
        split.classList.add("dragging");
        split.setPointerCapture(e.pointerId);
        e.preventDefault();
      },
      onpointermove(e) {
        if (!draggingSplit) return;
        side.style.width = clampSideW(dragStartW + e.clientX - dragStartX) + "px";
      },
      onpointerup(e) {
        draggingSplit = false;
        split.classList.remove("dragging");
        if (split.hasPointerCapture(e.pointerId)) split.releasePointerCapture(e.pointerId);
      },
      onpointercancel(e) {
        draggingSplit = false;
        split.classList.remove("dragging");
        if (split.hasPointerCapture(e.pointerId)) split.releasePointerCapture(e.pointerId);
      },
    });
    const wrap = h("div", { class: "plug-wrap" }, side, split, form);
    redrawList(); redrawForm();
    modal({ title: "Plugin Manager", wide: true, resizable: true, dismissable: false, class: "plugin-modal",
      content: wrap,
      buttons: [{ label: "Close", primary: true }] });
  }

  // ============================ audio manager ============================
  function openAudioManager() {
    let playingTheme = null;
    const seGrid = h("div", { class: "audio-grid" });
    for (const n of SE_NAMES) seGrid.appendChild(h("button", { onclick() { Sfx.play(n); } }, "▶ " + n));
    const musGrid = h("div", { class: "audio-grid" });
    const musBtns = [];
    for (const t of Sfx.THEMES) {
      const b = h("button", { onclick() {
        if (playingTheme === t) { Music.stop(); playingTheme = null; }
        else { Music.play(t); playingTheme = t; }
        musBtns.forEach((x) => x.b.classList.toggle("playing", x.t === playingTheme));
      } }, "♪ " + t);
      musBtns.push({ t, b });
      musGrid.appendChild(b);
    }
    modal({
      title: "Audio Manager",
      wide: true,
      content: h("div", null,
        h("div", { class: "subhead" }, "Sound effects (used by the Play Sound event command)"),
        seGrid,
        h("div", { class: "subhead" }, "Music themes (click to preview, click again to stop)"),
        musGrid,
        h("div", { class: "dim", style: "margin-top:10px" },
          "Assign a theme per map in Map Properties. Battles always use “battle”, the title screen “title”, defeat “gameover”. All audio is generated procedurally — no files, no copyright."),
      ),
      onClose() { Music.stop(); },
    });
  }

  // ============================ event searcher ============================
  function walkCommands(list, cb) {
    for (const c of list || []) {
      cb(c);
      if (c.t === "if") { walkCommands(c.then, cb); walkCommands(c.else, cb); }
      else if (c.t === "choices") (c.branches || []).forEach((b) => walkCommands(b, cb));
    }
  }
  function openEventSearcher() {
    const results = h("div", { class: "search-results" });
    const input = h("input", { type: "text", placeholder: "Search…", onkeydown(e) { if (e.key === "Enter") run(); } });
    const kindSel = h("select", null,
      h("option", { value: "text" }, "Message text"),
      h("option", { value: "name" }, "Event name"),
      h("option", { value: "switch" }, "Switch ID"),
      h("option", { value: "var" }, "Variable ID"),
    );
    let dlg = null;
    function run() {
      const kind = kindSel.value;
      const query = input.value.trim();
      const idQ = Number(query);
      results.innerHTML = "";
      if (!query || ((kind === "switch" || kind === "var") && (!idQ || isNaN(idQ)))) {
        results.appendChild(h("div", { class: "search-row dim" }, kind === "switch" || kind === "var" ? "Enter a numeric ID." : "Enter a search term."));
        return;
      }
      const ql = query.toLowerCase();
      const matches = [];
      for (const m of S.proj.maps) {
        for (const ev of m.events) {
          ev.pages.forEach((pg, pi) => {
            let hit = null;
            if (kind === "name") {
              if (pi === 0 && ev.name.toLowerCase().includes(ql)) hit = ev.name;
            } else if (kind === "text") {
              walkCommands(pg.commands, (c) => {
                if (hit) return;
                if (c.t === "text" && ((c.text || "") + " " + (c.name || "")).toLowerCase().includes(ql)) hit = "“" + c.text.split("\n")[0].slice(0, 50) + "”";
                else if (c.t === "choices" && c.options.some((o) => o.toLowerCase().includes(ql))) hit = "Choices: " + c.options.join(" / ");
              });
            } else if (kind === "switch") {
              if (pg.cond.switchId === idQ) hit = "page condition (switch ON)";
              walkCommands(pg.commands, (c) => {
                if (hit) return;
                if (c.t === "switch" && c.id === idQ) hit = "Control Switch command";
                else if (c.t === "if" && c.cond && c.cond.kind === "switch" && c.cond.id === idQ) hit = "Conditional Branch";
              });
            } else {
              if (pg.cond.varId === idQ) hit = "page condition (variable ≥)";
              walkCommands(pg.commands, (c) => {
                if (hit) return;
                if (c.t === "var" && c.id === idQ) hit = "Control Variable command";
                else if (c.t === "if" && c.cond && c.cond.kind === "var" && c.cond.id === idQ) hit = "Conditional Branch";
              });
            }
            if (hit != null) matches.push({ m, ev, pi, hit });
          });
        }
      }
      if (!matches.length) {
        results.appendChild(h("div", { class: "search-row dim" }, "No matches."));
        return;
      }
      for (const r of matches) {
        results.appendChild(h("div", { class: "search-row", onclick() {
          dlg.close();
          S.curMapId = r.m.id;
          setMode("event");
          S.selectedEvent = r.ev;
          rebuildMapList(); renderMap(); refreshToolbar();
          const sc = $("mapscroll");
          sc.scrollLeft = r.ev.x * TILE * S.zoom - sc.clientWidth / 2;
          sc.scrollTop = r.ev.y * TILE * S.zoom - sc.clientHeight / 2;
          openEventEditor(r.ev);
        } },
          h("b", null, r.m.name + " — " + r.ev.name),
          " (" + r.ev.x + "," + r.ev.y + ") page " + (r.pi + 1),
          h("span", { class: "dim" }, r.hit)));
      }
    }
    const bar = h("div", { class: "search-bar" },
      field("Find", input), field("In", kindSel),
      h("button", { class: "primary", onclick: run }, "Search"));
    dlg = modal({ title: "Event Searcher", wide: true, content: h("div", null, bar, results) });
    setTimeout(() => input.focus(), 50);
  }

  // ============================ resource manager ============================
  function downloadCanvas(c, name) {
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = name + ".png";
    a.click();
  }
  function copyCanvas(src, scale) {
    const c = document.createElement("canvas");
    c.width = Math.round(src.width * (scale || 1));
    c.height = Math.round(src.height * (scale || 1));
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  function openResourceManager() {
    const tabBar = h("div", { class: "tabs" });
    const body = h("div");
    function resCell(canvas, name, dlName, dlCanvas) {
      return h("div", { class: "res-cell" },
        canvas,
        h("span", { class: "res-name", title: name }, name),
        h("button", { class: "mini", onclick() { downloadCanvas(dlCanvas || canvas, dlName); } }, "PNG"));
    }
    const tabs = [
      { label: "Tiles", build() {
        const grid = h("div", { class: "res-grid" });
        Assets.tiles.forEach((t, i) => {
          if (i === 0) return;
          grid.appendChild(resCell(copyCanvas(Assets.tileCanvas(i)), t.name + (t.pass ? " ○" : " ✕"), "tile-" + t.key, Assets.tileCanvas(i)));
        });
        return h("div", null,
          h("div", { style: "margin-bottom:8px" },
            h("button", { onclick() { downloadCanvas(Assets.tilesetCanvas(), "rpgatlas-tileset"); } }, "Export full tileset PNG"),
            h("span", { class: "dim" }, "  ○ = passable, ✕ = blocked (override per map in Passability mode)")),
          grid);
      } },
      { label: "Characters", build() {
        const grid = h("div", { class: "res-grid" });
        Assets.charsets.forEach((cs, i) => {
          grid.appendChild(resCell(copyCanvas(Assets.charFrameCanvas(i, 0, 1), 1.5),
            cs.name + (cs.custom ? " ★" : ""), "char-" + cs.key, Assets.charSheetCanvas(i)));
        });
        return h("div", null,
          h("div", { class: "dim", style: "margin-bottom:8px" }, "PNG exports the full 3-frame × 4-direction walking sheet. ★ = made in the Character Generator."),
          grid);
      } },
      { label: "Enemies", build() {
        const grid = h("div", { class: "res-grid" });
        for (const e of S.proj.enemies) {
          grid.appendChild(resCell(copyCanvas(Assets.enemyCanvas(e.sprite, e.color, 96)),
            e.name, "enemy-" + e.name.toLowerCase().replace(/\W+/g, "-"), Assets.enemyCanvas(e.sprite, e.color, 264)));
        }
        return h("div", null,
          h("div", { class: "dim", style: "margin-bottom:8px" }, "Battlers from this project's Enemies database (edit them in the Database)."),
          grid);
      } },
      { label: "Icons", build() {
        const grid = h("div", { class: "res-grid" });
        for (let i = 0; i < Assets.ICON_COUNT; i++) {
          grid.appendChild(resCell(copyCanvas(Assets.iconCanvas(i), 1.5),
            "Icon " + i, "icon-" + String(i).padStart(2, "0"), Assets.iconCanvas(i)));
        }
        return h("div", null,
          h("div", { class: "dim", style: "margin-bottom:8px" },
            "64 icons from img/system/icon_set.png. Assign them in the Classes, Skills, Items, Weapons, and Armors tabs."),
          grid);
      } },
    ];
    function show(i) {
      tabBar.querySelectorAll("button").forEach((b, bi) => b.classList.toggle("sel", bi === i));
      body.innerHTML = "";
      body.appendChild(tabs[i].build());
    }
    tabs.forEach((t, i) => tabBar.appendChild(h("button", { onclick: () => show(i) }, t.label)));
    modal({ title: "Resource Manager", wide: true, content: h("div", null, tabBar, body) });
    show(0);
  }

  // ============================ character generator ============================
  function openCharGenerator() {
    const SKINS = ["#f0c8a0", "#e8b890", "#d8a070", "#c08858", "#9a6a40", "#f0d0b0"];
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const randCol = () => "#" + [0, 0, 0].map(() => ("0" + Math.floor(40 + Math.random() * 200).toString(16)).slice(-2)).join("");
    function randomWork() {
      return { name: "New Hero", style: pick(Assets.HAIR_STYLES), skin: pick(SKINS),
        hair: randCol(), shirt: randCol(), pants: randCol(), hat: randCol() };
    }
    let editing = null; // entry in proj.customChars being edited, or null for a new one
    let work = randomWork();
    const PV_KEY = "cg_preview";
    let animF = 0;

    const previews = [0, 1, 2, 3].map(() => {
      const c = document.createElement("canvas");
      c.width = TILE; c.height = TILE;
      return c;
    });
    function paramsOf(w) { return { skin: w.skin, hair: w.hair, style: w.style, shirt: w.shirt, pants: w.pants, hat: w.hat }; }
    function redrawPreview() {
      const idx = Assets.registerHuman(PV_KEY, "preview", paramsOf(work));
      const frame = [0, 1, 2, 1][animF % 4];
      previews.forEach((c, dir) => {
        const g = c.getContext("2d");
        g.clearRect(0, 0, TILE, TILE);
        g.drawImage(Assets.charFrameCanvas(idx, dir, frame), 0, 0);
      });
    }
    const animTimer = setInterval(() => { animF++; redrawPreview(); }, 170);

    const formBox = h("div", { class: "cg-form" });
    const listEl = h("ul", { class: "dblist" });
    function colorIn(key) {
      return h("input", { type: "color", value: work[key], oninput(e) { work[key] = e.target.value; redrawPreview(); } });
    }
    function redrawForm() {
      formBox.innerHTML = "";
      const nameIn = h("input", { type: "text", value: work.name, oninput(e) { work.name = e.target.value; } });
      const styleSel = h("select", { onchange(e) { work.style = e.target.value; redrawPreview(); } },
        ...Assets.HAIR_STYLES.map((s) => h("option", { value: s, ...(s === work.style ? { selected: "" } : {}) }, s)));
      const skinSel = h("select", { onchange(e) { work.skin = e.target.value; redrawPreview(); } },
        ...SKINS.map((s, i) => h("option", { value: s, ...(s === work.skin ? { selected: "" } : {}) }, "skin " + (i + 1))));
      formBox.appendChild(row(field("Name", nameIn), field("Hair style", styleSel)));
      formBox.appendChild(row(field("Skin", skinSel), field("Hair", colorIn("hair")),
        field("Shirt", colorIn("shirt")), field("Pants", colorIn("pants")), field("Hat", colorIn("hat"))));
      formBox.appendChild(h("div", { class: "cg-preview" }, ...previews));
      formBox.appendChild(h("div", { class: "frow", style: "margin-top:8px; gap:6px" },
        h("button", { onclick() { const n = work.name; work = randomWork(); work.name = n; redrawForm(); redrawPreview(); } }, "🎲 Randomize"),
        h("button", { class: "primary", onclick: save }, editing ? "Update “" + editing.name + "”" : "Save as new character"),
        editing ? h("button", { onclick() { editing = null; redrawForm(); } }, "Cancel edit") : null,
      ));
    }
    function save() {
      if (!work.name.trim()) work.name = "Hero";
      if (editing) {
        editing.name = work.name;
        editing.params = paramsOf(work);
        Assets.registerHuman(editing.key, editing.name, editing.params);
      } else {
        const id = RA.nextId(S.proj.customChars.length ? S.proj.customChars : [{ id: 0 }]);
        const entry = { id, key: "cg" + id, name: work.name, params: paramsOf(work) };
        S.proj.customChars.push(entry);
        Assets.registerHuman(entry.key, entry.name, entry.params);
        editing = entry;
      }
      touch();
      redrawList(); redrawForm();
      flashStatus("Character saved — pick it as a sprite for actors and events");
    }
    function redrawList() {
      listEl.innerHTML = "";
      for (const c of S.proj.customChars) {
        listEl.appendChild(h("li", { class: c === editing ? "sel" : "", onclick() {
          editing = c;
          work = Object.assign({ name: c.name }, c.params);
          redrawForm(); redrawPreview();
        } }, c.name));
      }
      if (!S.proj.customChars.length) listEl.appendChild(h("li", { class: "dim" }, "(none yet)"));
    }
    const side = h("div", { class: "cg-side" },
      h("div", { class: "subhead", style: "margin:0" }, "Saved characters"),
      listEl,
      h("button", { onclick() {
        if (!editing) return;
        confirmBox('Delete "' + editing.name + '"? Actors/events using it will show no sprite.', () => {
          Assets.removeCharset(editing.key);
          S.proj.customChars.splice(S.proj.customChars.indexOf(editing), 1);
          editing = null;
          touch(); redrawList(); redrawForm(); renderMap();
        });
      } }, "Delete selected"),
      h("div", { class: "dim" }, "Saved characters appear in every sprite picker (marked ★ in the Resource Manager)."),
    );
    redrawList(); redrawForm(); redrawPreview();
    modal({
      title: "Character Generator",
      wide: true,
      dismissable: false,
      content: h("div", { class: "cg-wrap" }, side, formBox),
      buttons: [{ label: "Close", primary: true }],
      onClose() {
        clearInterval(animTimer);
        Assets.removeCharset(PV_KEY);
        renderMap();
      },
    });
  }

  // ============================ help / about ============================
  function refreshLocalizedChrome() {
    editorI18n.localizeStatic();
    buildMenubar();
    buildToolbar();
    refreshToolbar();
    setStatus();
    const saveIndicator = $("save-ind");
    if (saveIndicator.textContent.startsWith("●")) saveIndicator.textContent = "● " + t("unsaved");
    else if (saveIndicator.textContent.startsWith("⚠")) saveIndicator.textContent = "⚠ " + t("save failed");
    else saveIndicator.textContent = "✓ " + t("saved");
  }
  function openLanguageSettings() {
    let selectedLocale = editorI18n.locale;
    const languageSelect = h("select", {
      onchange(e) { selectedLocale = e.target.value; },
    }, ...editorI18n.locales().map((locale) =>
      h("option", { value: locale.id, ...(locale.id === selectedLocale ? { selected: "" } : {}) }, locale.label)));
    modal({
      title: "Interface Language",
      content: h("div", null,
        h("p", null, t("Choose the language used by the editor. Project content is not translated.")),
        field("Language", languageSelect)),
      buttons: [
        { label: "Apply", primary: true, onClick(close) {
          editorI18n.setLocale(selectedLocale);
          close();
          refreshLocalizedChrome();
        } },
        { label: "Cancel" },
      ],
    });
  }
  function openPatchNotes() {
    const list = h("div", { class: "patch-notes" });
    PATCH_NOTES.forEach((note) => {
      const items = h("ul");
      (note.items || []).forEach((item) => items.appendChild(h("li", null, item)));
      list.appendChild(h("article", { class: "patch-note" },
        h("div", { class: "patch-note-head" },
          h("h3", null, note.title),
          h("time", null, note.date)),
        h("p", null, note.summary),
        items));
    });
    modal({
      title: "RPGAtlas - Patch Notes",
      wide: true,
      content: list,
      buttons: [{ label: "Close", primary: true }],
    });
  }
  function openHelp() {
    modal({
      title: "RPGAtlas — Quick Help",
      wide: true,
      content: h("div", { class: "helpbox", html: `
<h3>Drawing maps</h3>
<ul>
<li><b>Tools</b>: Pen <kbd>Q</kbd>, Eraser <kbd>W</kbd>, Rectangle <kbd>E</kbd>, Circle <kbd>R</kbd>, Fill <kbd>T</kbd>, Shadow Pen <kbd>Y</kbd>. Right-click = pick tile from the map.</li>
<li><b>Layers</b>: Auto <kbd>&#96;</kbd> places terrain on Layer 1 and stacks decorations on Layers 2–3 automatically. <kbd>1</kbd>–<kbd>4</kbd> select Ground / Decor / Decor&nbsp;2 / Overhead directly (Overhead draws above the player).</li>
<li><b>Shadow Pen</b>: left-click paints a half-tile shadow quadrant, right-click erases it.</li>
<li><b>Modes</b>: press <kbd>Tab</kbd> (<kbd>Shift</kbd>+<kbd>Tab</kbd> reverse) to cycle Map → Event → Passability → Height. <b>Height Mode</b>: paint HD-2D elevation with Pen / Rectangle / Circle / Fill. Keys <kbd>0</kbd>–<kbd>9</kbd> set the value, right-click picks it up, Eraser clears. Raised tiles become 3D blocks when the map's HD-2D rendering is on.</li>
<li><b>HD-2D</b>: enable per map in Game ▸ Map Properties (camera tilt, bloom, depth of field, fog, point lights). Game ▸ HD-2D Preview opens a live panel that follows your edits — drag it to pan. Lights are events named “light #rrggbb radius”.</li>
<li><b>Selection</b>: Shift+drag selects an area. Cut <kbd>Ctrl+X</kbd> / Copy <kbd>Ctrl+C</kbd> / Paste <kbd>Ctrl+V</kbd>, then click to stamp (Esc cancels). Works for events too.</li>
<li>Undo <kbd>Ctrl+Z</kbd> · Redo <kbd>Ctrl+Y</kbd> · Zoom <kbd>+</kbd>/<kbd>−</kbd>, <kbd>Ctrl</kbd>+wheel, <kbd>Ctrl+0</kbd> = 100%. Press <kbd>?</kbd> for the full keyboard shortcut list.</li>
</ul>
<h3>Passability</h3>
<ul>
<li>By default the topmost decoration tile decides (○ passable / ✕ blocked); otherwise the ground tile.</li>
<li>In <b>Passability mode</b> click a tile to cycle: auto → force ✕ → force ○. Overridden tiles get a yellow corner badge.</li>
</ul>
<h3>Events</h3>
<ul>
<li>In <b>Event mode</b> double-click a cell to create/edit an event; drag to move; <kbd>Del</kbd> deletes. <b>Right-click</b> for a menu: New Event, <b>Quick Events</b> (Transfer / Sign / Chest), Cut/Copy/Paste, and Set Start Position Here. Each event has <b>pages</b> — the last page whose conditions hold is active.</li>
<li>Triggers: Action button (Z), Player touch, Autorun (blocks play), Parallel (background). Use Self-Switches for chest-like one-time events.</li>
<li><b>Event Searcher</b> (Tools menu) finds text, names, or switch/variable usage across all maps.</li>
</ul>
<h3>Tools</h3>
<ul>
<li><b>Database</b>: actors, classes, skills, items, equipment, enemies, troops, common events, states, types, switches, variables, system.</li>
<li><b>System tab</b>: screen size, UI area, screen scale, fonts &amp; font size, window opacity, system sounds &amp; music, side-view or front-view battles, start-transparent player.</li>
<li><b>States</b>: poison / stun / regen-style battle effects, inflicted or cured by skills.</li>
<li><b>Plugin Manager</b>: project-embedded JavaScript that runs at game boot, with map-load and per-frame hooks.</li>
<li><b>Character Generator</b>: build original walking sprites; they appear in every sprite picker.</li>
<li><b>Resource Manager</b>: browse every generated tile/character/battler and export PNGs.</li>
<li><b>Custom assets</b>: copy images into the shared <code>img/characters</code>, <code>facesets</code>, <code>enemies</code>, or <code>tilesets</code> folders, then reload the editor.</li>
</ul>
<h3>Playtesting & saving</h3>
<ul>
<li><b>▶ Playtest</b> opens the player. In game: Arrows/WASD move, Shift dashes, Z/Enter confirms, X/Esc menu/cancel.</li>
<li>Your project autosaves to this browser (<kbd>Ctrl+S</kbd> forces it). Use File ▸ Export for a .json backup; Open to load one.</li>
<li><b>Export Standalone Game</b> creates a Windows .exe or cross-platform .html that runs without the editor or engine folder.</li>
</ul>
<h3>License</h3>
<p>RPGAtlas is free and open source software under the <b>GNU GPLv3</b>. The content you create — maps, story, database, characters — is yours. Exported games bundle the engine runtime, which stays under the GPL (its readable source ships inside every export).</p>
` }),
    });
  }
  function openKeyboardShortcuts() {
    const box = h("div", { class: "helpbox" });
    const kbd = (s) => h("kbd", null, s);
    const keys = (...labels) => {
      const out = [];
      labels.forEach((l, i) => { if (i) out.push(" / "); out.push(kbd(l)); });
      return out;
    };
    const line = (chips, desc) => h("li", null, ...chips, h("span", { class: "cl-desc" }, " — " + desc));
    const aKey = (id) => ACT[id].key;
    const aLabel = (id) => actionLabel(ACT[id]);
    const section = (title, rows) => {
      box.appendChild(h("h3", null, title));
      const ul = h("ul", { class: "code-legend-list" });
      rows.forEach((r) => ul.appendChild(r));
      box.appendChild(ul);
    };

    const toolIds = ["tool-pen", "tool-erase", "tool-rect", "tool-circle", "tool-fill", "tool-shadow"];
    const layerIds = ["layer-auto", "layer-ground", "layer-decor", "layer-decor2", "layer-over"];

    section("Modes", [
      line(keys("Tab"), "next mode  (Map → Event → Passability → Height, wraps)"),
      line(keys("Shift", "Tab"), "previous mode"),
      h("li", { class: "dim" }, "Set Start Position is reached from the Mode menu, not the Tab cycle."),
    ]);
    section("Tools  (Map or Height mode)", toolIds.map((id) => line(keys(aKey(id)), aLabel(id))));
    section("Layers  (Map mode)", layerIds.map((id) => line(keys(aKey(id)), aLabel(id))));
    section("Height mode", [line(keys("0–9"), "set the painted elevation value")]);
    section("Edit & file", ["undo", "redo", "cut", "copy", "paste", "save"].map((id) => line(keys(aKey(id)), aLabel(id))));
    section("View", [
      line(keys("+", "−"), "zoom in / out  (Ctrl + wheel also zooms)"),
      line(keys(aKey("zoom1")), "zoom to 100%"),
    ]);
    section("Application", ["db", "hdpreview", "play"].map((id) => line(keys(aKey(id)), aLabel(id))));
    section("Selection & events", [
      line(keys("Shift", "drag"), "select an area of tiles"),
      line(keys("Del"), "delete the selected event (Event mode)"),
      line(keys("Esc"), "clear selection / cancel paste / deselect"),
    ]);
    box.appendChild(h("div", { class: "dim", style: "margin-top:10px;font-size:12px" },
      "Tool and layer keys do nothing outside their mode — switch with Tab first. Toolbar and menu clicks switch mode automatically. F1 and F5 take over the browser's Help and Reload while the editor is focused."));

    modal({ title: "Keyboard Shortcuts", wide: true, content: box, dialogKeys: true });
  }
  function openAbout() {
    modal({
      title: "About RPGAtlas",
      content: h("div", { class: "helpbox", html: `
<div style="display:flex;align-items:center;gap:14px;margin-bottom:10px">
  <img src="img/system/rpgatlas-logo.svg" alt="" width="56" height="56">
  <div>
    <div style="font-size:20px;font-weight:800">RPG<span style="font-weight:300">Atlas</span></div>
    <div class="dim">Chart your world. Tell your story.</div>
  </div>
</div>
<p><b>RPGAtlas</b> — a free and open source RPG maker that runs entirely in your browser.</p>
<ul>
<li>No build step or dependencies — built-in art and audio are generated procedurally, with optional shared custom images from the <code>img</code> folder.</li>
<li>Free software under the <b>GNU GPLv3</b> — use it, study it, share it, improve it.</li>
<li>Your game's content (maps, story, data, art) is yours — sell it, remix it, no credit required. Exported games include the engine runtime, which remains GPL-licensed.</li>
</ul>
<p class="dim">Editor: index.html · Player: play.html · Data: one portable .json project file.</p>
` }),
    });
  }

  // ============================ icons (original line art) ============================
  function svgIcon(inner) {
    return '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">' + inner + "</svg>";
  }
  const layerGlyph = '<path d="M10 2.6 17.4 6.6 10 10.6 2.6 6.6z"/><path d="M2.6 10.4 10 14.4l7.4-4"/>';
  const ICONS = {
    new: svgIcon('<path d="M5 2.5h7l3.5 3.5v11.5H5z"/><path d="M12 2.5V6h3.5"/><path d="M10 9.5v5M7.5 12h5"/>'),
    open: svgIcon('<path d="M2.5 16V4.5h5l2 2h8V9"/><path d="M2.5 16l2.8-7h13.2l-2.8 7z"/>'),
    save: svgIcon('<path d="M3 3h11.5L17 5.5V17H3z"/><path d="M6 3v4.5h7V3"/><rect x="6" y="11" width="8" height="6"/>'),
    cut: svgIcon('<circle cx="5.2" cy="14.8" r="2.3"/><circle cx="14.8" cy="14.8" r="2.3"/><path d="M6.8 13 15 2.5M13.2 13 5 2.5"/>'),
    copy: svgIcon('<rect x="7" y="6" width="10" height="11.5" rx="1.5"/><path d="M4 13.5V4a1.5 1.5 0 0 1 1.5-1.5H13"/>'),
    paste: svgIcon('<rect x="4" y="4.5" width="12" height="13" rx="1.5"/><path d="M7.2 4.5a2.8 2.8 0 0 1 5.6 0"/><rect x="7" y="3.2" width="6" height="2.8" rx="1"/><path d="M7 10.5h6M7 13.5h6"/>'),
    undo: svgIcon('<path d="M4 8.5h8.5a3.8 3.8 0 0 1 0 7.6H8"/><path d="M7 5 3.5 8.5 7 12"/>'),
    redo: svgIcon('<path d="M16 8.5H7.5a3.8 3.8 0 0 0 0 7.6H12"/><path d="M13 5l3.5 3.5L13 12"/>'),
    map: svgIcon('<rect x="3" y="3" width="14" height="14"/><path d="M3 9.7h14M9.7 3v14"/>'),
    event: svgIcon('<circle cx="10" cy="6.3" r="3.1"/><path d="M4.2 17c.5-4 2.9-5.6 5.8-5.6s5.3 1.6 5.8 5.6"/>'),
    pass: svgIcon('<circle cx="6.8" cy="6.8" r="4"/><path d="M11.8 11.8l5.5 5.5M17.3 11.8l-5.5 5.5"/>'),
    pen: svgIcon('<path d="M3.5 16.5l.9-3.6L13.6 3.7l2.7 2.7L7.1 15.6l-3.6.9z"/><path d="M12 5.3l2.7 2.7"/>'),
    erase: svgIcon('<path d="M7.5 15.5 3.6 11.6a1.5 1.5 0 0 1 0-2.1l6-6a1.5 1.5 0 0 1 2.1 0l4.8 4.8a1.5 1.5 0 0 1 0 2.1l-5.1 5.1H7.5z"/><path d="M3.5 17.5h13"/><path d="M7.1 6.9l6 6"/>'),
    rect: svgIcon('<rect x="3.5" y="5" width="13" height="10"/>'),
    circle: svgIcon('<ellipse cx="10" cy="10" rx="6.6" ry="5.2"/>'),
    fill: svgIcon('<path d="M8.2 2.2v2.6"/><path d="M8.2 3.8l6.2 6.2L9 15.4 3.4 9.8z"/><path d="M16.2 12.8s1.7 2.1 1.7 3.3a1.7 1.7 0 1 1-3.4 0c0-1.2 1.7-3.3 1.7-3.3z"/>'),
    shadow: svgIcon('<rect x="3.5" y="3.5" width="13" height="13"/><path d="M16.5 3.5 3.5 16.5"/><path d="M16.5 3.5v13h-13z" fill="currentColor" stroke="none" opacity="0.45"/>'),
    height: svgIcon('<path d="M3 16.5h4v-4h4v-4h4v-5"/><path d="M12.5 6 15 3.5 17.5 6"/>'),
    hd2d: svgIcon('<path d="M2.5 14.5l5-8 4 6 2-3 4 5"/><path d="M2.5 17h15"/>'),
    zoomin: svgIcon('<circle cx="8.8" cy="8.8" r="5.6"/><path d="M13 13l4.3 4.3"/><path d="M6.3 8.8h5M8.8 6.3v5"/>'),
    zoomout: svgIcon('<circle cx="8.8" cy="8.8" r="5.6"/><path d="M13 13l4.3 4.3"/><path d="M6.3 8.8h5"/>'),
    zoom1: svgIcon('<circle cx="8.8" cy="8.8" r="5.6"/><path d="M13 13l4.3 4.3"/><text x="8.8" y="10.9" font-size="5.6" font-weight="bold" text-anchor="middle" fill="currentColor" stroke="none" font-family="monospace">1:1</text>'),
    db: svgIcon('<ellipse cx="10" cy="4.6" rx="6.4" ry="2.4"/><path d="M3.6 4.6v10.8c0 1.3 2.9 2.4 6.4 2.4s6.4-1.1 6.4-2.4V4.6"/><path d="M3.6 10c0 1.3 2.9 2.4 6.4 2.4s6.4-1.1 6.4-2.4"/>'),
    plugins: svgIcon('<path d="M8 3.4a2 2 0 0 1 4 0V5h3.2a.8.8 0 0 1 .8.8V9h-1.6a2 2 0 0 0 0 4H16v3.2a.8.8 0 0 1-.8.8H4.8a.8.8 0 0 1-.8-.8V13h1.6a2 2 0 0 0 0-4H4V5.8a.8.8 0 0 1 .8-.8H8z"/>'),
    audio: svgIcon('<path d="M3 8v4h2.8L10 16V4L5.8 8H3z"/><path d="M12.8 7.2a4 4 0 0 1 0 5.6M15.3 5a7.2 7.2 0 0 1 0 10"/>'),
    search: svgIcon('<rect x="3" y="2.5" width="9.5" height="13" rx="1"/><path d="M5.6 6h4.3M5.6 9h4.3"/><circle cx="13.6" cy="13.6" r="3.4"/><path d="M16 16l2.4 2.4"/>'),
    resources: svgIcon('<rect x="3" y="4" width="14" height="12" rx="1.5"/><circle cx="7.4" cy="8.4" r="1.5"/><path d="M3 13.8l4-4 3 3 3.4-3.4 3.6 3.6"/>'),
    chargen: svgIcon('<circle cx="8" cy="6.5" r="3"/><path d="M2.8 17c.5-3.6 2.6-5.1 5.2-5.1s4.7 1.5 5.2 5.1"/><path d="M15.6 4.6v5M13.1 7.1h5"/>'),
    play: svgIcon('<path d="M5.5 3.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>'),
  };
  [["auto", "A"], ["ground", "1"], ["decor", "2"], ["decor2", "3"], ["over", "4"]].forEach(([ln, glyph]) => {
    ICONS["layer-" + ln] = svgIcon(layerGlyph +
      '<text x="15" y="19" font-size="9" font-weight="bold" text-anchor="middle" fill="currentColor" stroke="none">' + glyph + "</text>");
  });

  // ============================ actions / menus / toolbar ============================
  const ACT = {};
  function act(id, def) {
    def.labelKey = def.label;
    def.tipKey = def.tip;
    ACT[id] = def;
  }
  function actionLabel(action) { return t(action.labelKey); }
  function actionTip(action) { return t(action.tipKey || action.labelKey); }
  function runAct(id) {
    const a = ACT[id];
    if (!a || (a.enabled && !a.enabled())) return;
    a.run();
    refreshToolbar();
  }

  act("new", { label: "New Project…", icon: "new", tip: "New project (resets to the bundled sample game)", run() {
    confirmBox("Start a fresh project (the bundled sample game)? Your current project will be replaced — Export first if you want to keep it.", () => {
      S.proj = DataDefaults.newProject();
      Assets.registerCustomChars(S.proj.customChars);
      Assets.bindExternalAssets(S.proj);
      S.curMapId = S.proj.maps[0].id;
      S.selectedEvent = null; S.selection = null; S.pasteMode = null;
      S.undoStack.length = 0; S.redoStack.length = 0;
      rebuildAll(); touch();
    });
  } });
  act("open", { label: "Open Project (.json)…", icon: "open", tip: "Open / import a project file", run() { $("import-file").click(); } });
  act("save", { label: "Save Project", icon: "save", key: "Ctrl+S",
    tip: host.isTauri ? "Save the project to its file" : "Save the project to this browser now",
    run() {
      if (host.isTauri) { desktopSave(false); return; }
      saveNow();
      flashStatus("Project saved to this browser — use File ▸ Export for a backup file");
    } });
  act("export", { label: "Export Project As File…", run: exportProject });
  act("build", { label: "Export Standalone Game…", run: openStandaloneExport });
  act("play", { label: "Playtest", icon: "play", key: "F5", tip: "Save and run the game", run() {
    saveNow();
    if (host.isTauri) {
      host.openPlaytest().catch((e) => alert("Could not open play-test window: " + ((e && e.message) || e)));
    } else {
      window.open(playtestUrl(), "rpgatlas_play");
    }
  } });
  act("mapprops", { label: "Map Properties…", run: openMapProps });
  act("hdpreview", { label: "HD-2D Preview", icon: "hd2d", key: "F2", tip: "Toggle the live HD-2D preview panel (uses this map's HD-2D settings)", active: () => isHdPreviewOpen(), run: toggleHdPreview });

  act("undo", { label: "Undo", icon: "undo", key: "Ctrl+Z", enabled: () => S.undoStack.length > 0, run: undo });
  act("redo", { label: "Redo", icon: "redo", key: "Ctrl+Y", enabled: () => S.redoStack.length > 0, run: redo });
  act("cut", { label: "Cut", icon: "cut", key: "Ctrl+X", tip: "Cut the selected area / event", enabled: canCopy, run: () => copySelection(true) });
  act("copy", { label: "Copy", icon: "copy", key: "Ctrl+C", tip: "Copy the selected area / event (Shift+drag selects tiles)", enabled: canCopy, run: () => copySelection(false) });
  act("paste", { label: "Paste", icon: "paste", key: "Ctrl+V", tip: "Paste — then click the map to place", enabled: () => !!(S.clipTiles || S.clipEvent), run: startPaste });
  act("deselect", { label: "Clear Selection", key: "Esc", enabled: () => !!(S.selection || S.pasteMode), run: clearSelection });

  act("mode-map", { label: "Map (Tile) Mode", icon: "map", key: "Tab ⇆", tip: "Tile layer — draw the map", active: () => S.mode === "map", run: () => setMode("map") });
  act("mode-event", { label: "Event Mode", icon: "event", key: "Tab ⇆", tip: "Event layer — place and edit events", active: () => S.mode === "event", run: () => setMode("event") });
  act("mode-pass", { label: "Passability Mode", icon: "pass", key: "Tab ⇆", tip: "Passability — click tiles to cycle auto → ✕ block → ○ pass", active: () => S.mode === "pass", run: () => setMode("pass") });
  act("mode-height", { label: "Height Mode (HD-2D)", icon: "height", key: "Tab ⇆",
    tip: "Heights — paint HD-2D elevation with the Pen / Rectangle / Circle / Fill tools (digits 0–9 set the value)",
    active: () => S.mode === "height", run: () => setMode("height") });
  act("mode-start", { label: "Set Start Position…", active: () => S.mode === "start", run() {
    setMode("start");
    flashStatus("Click the map to set the player start position");
  } });

  [["auto", "`"], ["ground", "1"], ["decor", "2"], ["decor2", "3"], ["over", "4"]].forEach(([ln, key]) => {
    act("layer-" + ln, { label: LAYER_LABELS[ln], icon: "layer-" + ln, key,
      active: () => S.layer === ln && S.mode === "map",
      run() { if (S.mode !== "map") setMode("map"); setLayer(ln); } });
  });
  [["pen", "Q"], ["erase", "W"], ["rect", "E"], ["circle", "R"], ["fill", "T"], ["shadow", "Y"]].forEach(([t, key]) => {
    act("tool-" + t, { label: TOOL_LABELS[t], icon: t, key,
      tip: t === "shadow" ? "Shadow Pen — left paints a shadow quadrant, right erases" : TOOL_LABELS[t],
      active: () => S.tool === t && (S.mode === "map" || S.mode === "height"),
      run() { if (S.mode !== "map" && S.mode !== "height") setMode("map"); setTool(t); } });
  });

  act("zoomin", { label: "Zoom In", icon: "zoomin", key: "+", run: () => zoomStep(1) });
  act("zoomout", { label: "Zoom Out", icon: "zoomout", key: "−", run: () => zoomStep(-1) });
  act("zoom1", { label: "Zoom 1:1", icon: "zoom1", key: "0", tip: "Set zoom to 100%", active: () => Math.abs(S.zoom - 1) < 0.01, run: () => setZoom(1) });
  act("zoomfit", { label: "Fit Map In View", run: () => zoomFit() });

  act("db", { label: "Database…", icon: "db", key: "F1", tip: "Database — actors, items, enemies, switches…", run: openDatabase });
  act("plugins", { label: "Plugin Manager…", icon: "plugins", tip: "Plugin Manager — project JavaScript run at game boot", run: openPluginManager });
  act("audio", { label: "Audio Manager…", icon: "audio", tip: "Audio Manager — preview sounds and music", run: openAudioManager });
  act("search", { label: "Event Searcher…", icon: "search", tip: "Event Searcher — find text / switches / variables across maps", run: openEventSearcher });
  act("resources", { label: "Resource Manager…", icon: "resources", tip: "Resource Manager — browse and export generated assets", run: openResourceManager });
  act("chargen", { label: "Character Generator…", icon: "chargen", tip: "Character Generator — build original walking sprites", run: openCharGenerator });
  act("language", { label: "Interface Language…", run: openLanguageSettings });
  act("patchnotes", { label: "Patch Notes", run: openPatchNotes });
  act("shortcuts", { label: "Keyboard Shortcuts…", key: "?", run: openKeyboardShortcuts });
  act("help", { label: "Quick Help", run: openHelp });
  act("about", { label: "About RPGAtlas", run: openAbout });

  const TOOLBAR = [
    ["new", "open", "save"],
    ["cut", "copy", "paste"],
    ["undo", "redo"],
    ["mode-map", "mode-event", "mode-pass", "mode-height"],
    ["layer-auto", "layer-ground", "layer-decor", "layer-decor2", "layer-over"],
    ["tool-pen", "tool-erase", "tool-rect", "tool-circle", "tool-fill", "tool-shadow"],
    ["zoomin", "zoomout", "zoom1"],
    ["db", "plugins", "audio", "search", "resources", "chargen"],
    ["hdpreview", "play"],
  ];
  function buildToolbar() {
    const bar = $("toolbar");
    bar.innerHTML = "";
    TOOLBAR.forEach((group, gi) => {
      if (gi) bar.appendChild(h("span", { class: "tb-sep" }));
      for (const id of group) {
        const a = ACT[id];
        const btn = h("button", {
          class: "tbtn" + (id === "play" ? " play-btn" : ""),
          title: actionTip(a) + (a.key ? "  (" + a.key + ")" : ""),
          onclick: () => runAct(id),
        });
        btn.innerHTML = ICONS[a.icon] || "";
        if (id === "play") btn.appendChild(document.createTextNode(actionLabel(a)));
        a.btn = btn;
        bar.appendChild(btn);
      }
    });
  }
  function refreshToolbar() {
    for (const id of Object.keys(ACT)) {
      const a = ACT[id];
      if (!a.btn) continue;
      a.btn.classList.toggle("sel", !!(a.active && a.active()));
      a.btn.disabled = !!(a.enabled && !a.enabled());
    }
  }

  const MENUS = [
    { label: "File", items: ["new", "open", "save", "export", "build", "-", "play"] },
    { label: "Edit", items: ["undo", "redo", "-", "cut", "copy", "paste", "-", "deselect"] },
    { label: "Mode", items: ["mode-map", "mode-event", "mode-pass", "mode-height", "-", "mode-start"] },
    { label: "Draw", items: ["tool-pen", "tool-erase", "tool-rect", "tool-circle", "tool-fill", "tool-shadow"] },
    { label: "Layer", items: ["layer-auto", "layer-ground", "layer-decor", "layer-decor2", "layer-over"] },
    { label: "Scale", items: ["zoomin", "zoomout", "zoom1", "zoomfit"] },
    { label: "Tools", items: ["db", "plugins", "audio", "search", "resources", "chargen"] },
    { label: "Game", items: ["play", "build", "-", "mapprops", "hdpreview", "mode-start"] },
    { label: "Help", items: ["language", "-", "shortcuts", "patchnotes", "help", "about"] },
  ];
  let menuOpenRef = null;
  let menuDismissBound = false;
  function closeMenus() {
    if (!menuOpenRef) return;
    menuOpenRef.drop.remove();
    menuOpenRef.lab.classList.remove("open");
    menuOpenRef = null;
  }
  function openMenuFor(menu, lab) {
    closeMenus();
    const drop = h("div", { class: "menu-drop" });
    for (const it of menu.items) {
      if (it === "-") { drop.appendChild(h("div", { class: "menu-sep" })); continue; }
      const a = ACT[it];
      const dis = !!(a.enabled && !a.enabled());
      drop.appendChild(h("div", {
        class: "menu-item" + (dis ? " disabled" : ""),
        onclick() { if (dis) return; closeMenus(); a.run(); refreshToolbar(); },
      },
        h("span", { class: "mi-check" }, a.active && a.active() ? "✓" : ""),
        h("span", { class: "mi-label" }, actionLabel(a)),
        a.key ? h("span", { class: "mi-key" }, a.key) : null));
    }
    const r = lab.getBoundingClientRect();
    drop.style.left = r.left + "px";
    drop.style.top = (r.bottom + 2) + "px";
    document.body.appendChild(drop);
    lab.classList.add("open");
    menuOpenRef = { drop, lab };
  }
  function buildMenubar() {
    const nav = $("menus");
    nav.innerHTML = "";
    for (const menu of MENUS) {
      const lab = h("span", { class: "menu-label" }, t(menu.label));
      lab.addEventListener("mousedown", (e) => {
        e.preventDefault(); e.stopPropagation();
        if (menuOpenRef && menuOpenRef.lab === lab) closeMenus();
        else openMenuFor(menu, lab);
      });
      lab.addEventListener("mouseenter", () => {
        if (menuOpenRef && menuOpenRef.lab !== lab) openMenuFor(menu, lab);
      });
      nav.appendChild(lab);
    }
    if (!menuDismissBound) {
      document.addEventListener("mousedown", (e) => {
        if (menuOpenRef && !menuOpenRef.drop.contains(e.target)) closeMenus();
      });
      menuDismissBound = true;
    }
  }

  // ============================ modes / zoom ============================
  function setMode(m) {
    S.mode = m;
    S.selectedEvent = null;
    S.pasteMode = null;
    renderMap(); refreshToolbar(); setStatus();
  }
  const MODE_CYCLE = ["map", "event", "pass", "height"]; // "start" intentionally excluded
  function cycleMode(dir) {
    let i = MODE_CYCLE.indexOf(S.mode);
    if (i < 0) i = 0; // "start"/unexpected -> enter at "map"
    const n = MODE_CYCLE.length;
    setMode(MODE_CYCLE[(i + dir + n) % n]);
  }
  function setTool(t) {
    S.tool = t;
    renderMap(); refreshToolbar(); setStatus();
  }
  function setLayer(l) {
    S.layer = l;
    renderMap(); refreshToolbar(); setStatus();
  }
  function setZoom(z, pivot) {
    z = Math.max(0.15, Math.min(3, z));
    const sc = $("mapscroll");
    const px = pivot ? pivot.x : sc.clientWidth / 2;
    const py = pivot ? pivot.y : sc.clientHeight / 2;
    const wx = (sc.scrollLeft + px - 14) / S.zoom;  // 14 = #mapscroll padding
    const wy = (sc.scrollTop + py - 14) / S.zoom;
    S.zoom = z;
    renderMap();
    sc.scrollLeft = wx * S.zoom + 14 - px;
    sc.scrollTop = wy * S.zoom + 14 - py;
    setStatus(); refreshToolbar();
  }
  function zoomStep(d, pivot) {
    let best = 0, bd = Infinity;
    ZOOMS.forEach((z, i) => { const dd = Math.abs(z - S.zoom); if (dd < bd) { bd = dd; best = i; } });
    setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, best + d))], pivot);
  }
  function zoomFit() {
    const m = curMap(), sc = $("mapscroll");
    if (!m) return;
    setZoom(Math.min((sc.clientWidth - 30) / (m.width * TILE), (sc.clientHeight - 30) / (m.height * TILE), 1.5));
  }

  // ============================ boot / wiring ============================
  function rebuildAll() {
    if (!RA.byId(S.proj.maps, S.curMapId)) S.curMapId = S.proj.maps[0].id;
    rebuildMapList();
    renderPalette();
    renderMap();
    refreshToolbar();
    setStatus();
  }

  async function boot() {
    S.proj = loadStored() || DataDefaults.newProject();
    Assets.registerCustomChars(S.proj.customChars);
    await Promise.all([Assets.loadIconSet(), Assets.loadExternalAssets(S.proj)]);
    S.mapCanvas = $("mapcanvas");
    S.mapCtx = S.mapCanvas.getContext("2d");
    S.palCanvas = $("palette");

    editorI18n.localizeStatic();
    buildMenubar();
    buildToolbar();

    // palette
    S.palCanvas.addEventListener("mousedown", (e) => {
      const r = S.palCanvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left) / TILE), y = Math.floor((e.clientY - r.top) / TILE);
      const id = y * Assets.PALETTE_COLS + x;
      if (id >= 0 && Assets.tiles[id]) { S.selectedTile = id; renderPalette(); setStatus(); }
    });
    S.palCanvas.addEventListener("mousemove", (e) => {
      const r = S.palCanvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left) / TILE), y = Math.floor((e.clientY - r.top) / TILE);
      const id = y * Assets.PALETTE_COLS + x;
      S.palCanvas.title = Assets.tiles[id] ? Assets.tiles[id].name : "";
    });

    // map canvas
    S.mapCanvas.addEventListener("mousedown", onCanvasDown);
    S.mapCanvas.addEventListener("mousemove", onCanvasMove);
    window.addEventListener("mouseup", onCanvasUp);
    S.mapCanvas.addEventListener("dblclick", onCanvasDbl);
    S.mapCanvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (S.suppressNextCtxMenu) { S.suppressNextCtxMenu = false; return; }
      if (S.mode === "event") openCanvasMenu(e);
    });
    S.mapCanvas.addEventListener("mouseleave", () => { S.hoverCell = null; S.hoverQuad = 0; renderMap(); });

    // ctrl+wheel zooms around the cursor
    $("mapscroll").addEventListener("wheel", (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = $("mapscroll").getBoundingClientRect();
      zoomStep(e.deltaY < 0 ? 1 : -1, { x: e.clientX - r.left, y: e.clientY - r.top });
    }, { passive: false });

    $("import-file").addEventListener("change", (e) => {
      if (e.target.files[0]) importProject(e.target.files[0]);
      e.target.value = "";
    });
    $("map-add").addEventListener("click", addMap);
    $("map-del").addEventListener("click", deleteMap);
    $("map-gen").addEventListener("click", openMapGenProps);

    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      if (modalRoot().children.length) return;
      if (e.code === "Escape") {
        if (menuOpenRef) { closeMenus(); return; }
        if (S.pasteMode || S.selection) { clearSelection(); return; }
        if (S.selectedEvent) { S.selectedEvent = null; renderMap(); refreshToolbar(); }
        return;
      }
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openKeyboardShortcuts(); return; }
      // Mode cycle (always available). Tab forward, Shift+Tab back. Skip when Ctrl/Meta held.
      if (e.code === "Tab" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); cycleMode(e.shiftKey ? -1 : 1); return; }

      if (e.ctrlKey || e.metaKey) {
        switch (e.code) {
          case "KeyZ": e.preventDefault(); undo(); break;
          case "KeyY": e.preventDefault(); redo(); break;
          case "KeyX": e.preventDefault(); copySelection(true); break;
          case "KeyC": e.preventDefault(); copySelection(false); break;
          case "KeyV": e.preventDefault(); startPaste(); break;
          case "KeyS": e.preventDefault(); runAct("save"); break;
        }
        return;
      }
      // Application shortcuts — global (any mode). F1/F5 override the browser's Help/Reload.
      switch (e.code) {
        case "F1": e.preventDefault(); runAct("db");        return;
        case "F2": e.preventDefault(); runAct("hdpreview"); return;
        case "F5": e.preventDefault(); runAct("play");      return;
      }
      // Height mode consumes ALL digits for the painted elevation (0–9). Must stay above the layer gate.
      if (S.mode === "height" && /^Digit\d$/.test(e.code)) {
        S.heightVal = Number(e.code.slice(5));
        setStatus();
        return;
      }
      // Tools
      if (S.mode === "map" || S.mode === "height") {
        switch (e.code) {
          case "KeyQ": setTool("pen");    return;
          case "KeyW": setTool("erase");  return;
          case "KeyE": setTool("rect");   return;
          case "KeyR": setTool("circle"); return;
          case "KeyT": setTool("fill");   return;
          case "KeyY": setTool("shadow"); return;
        }
      }
      // Layers
      if (S.mode === "map") {
        switch (e.code) {
          case "Backquote": setLayer("auto");   return;
          case "Digit1":    setLayer("ground"); return;
          case "Digit2":    setLayer("decor");  return;
          case "Digit3":    setLayer("decor2"); return;
          case "Digit4":    setLayer("over");   return;
        }
      }
      switch (e.code) {
        case "Equal": case "NumpadAdd": zoomStep(1); break;
        case "Minus": case "NumpadSubtract": zoomStep(-1); break;
        case "Digit0": case "Numpad0": setZoom(1); break; // reset to 100% (height mode consumes 0 above)
        case "Delete": case "Backspace":
          if (S.mode === "event") deleteSelectedEvent();
          break;
      }
    });

    setTool("pen");
    setLayer("auto");
    setMode("map");
    rebuildAll();
    saveNow();
  }
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
