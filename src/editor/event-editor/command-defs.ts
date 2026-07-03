/* RPGAtlas — src/editor/event-editor/command-defs.ts
   Event-command metadata (CMD_DEFS), the shared summary/help builders, and the
   command edit/pick dialogs (mountForm, editCommand, pickCommand).
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 2):
   logic unchanged, closure vars routed through editor-state.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, RA, Sfx, editorState as S } from "../editor-state";
import {
  h, tIn, nIn, sel, chk, field, row,
  dbOpts, switchOpts, varOpts, cmpOpts, charsetOpts,
  DIR_OPTS, SE_OPTS, MUSIC_OPTS, stringSelOpts,
} from "../dom";
import { modal, confirmBox } from "../modals";
import { touch } from "../persistence";
import { openLocationPicker } from "./location-picker";

  // ============================ command definitions ============================
  export function cmdSummary(c: any) {
    const swName = (id: any) => id + (S.proj.system.switches[id - 1] ? " (" + S.proj.system.switches[id - 1] + ")" : "");
    const varName = (id: any) => id + (S.proj.system.variables[id - 1] ? " (" + S.proj.system.variables[id - 1] + ")" : "");
    const dbName = (arr: any, id: any) => { const e = RA.byId(arr, id); return e ? e.name : "#" + id; };
    const questName = (id: any) => dbName(S.proj.quests || [], id);
    const commonEventName = (id: any) => dbName(S.proj.commonEvents || [], id);
    const questObjName = (questId: any, objIndex: any) => {
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
        const d = k === "switch" ? "Switch " + swName(c.cond.id) + (c.cond.val === false ? " is OFF" : " is ON")
          : k === "var" ? "Var " + varName(c.cond.id) + " " + (c.cond.cmp || ">=") + " " + c.cond.val
          : k === "selfsw" ? "Self-Switch " + c.cond.key + " is ON"
          : k === "quest" ? "Quest " + questName(c.cond.questId) + " is " + (c.cond.status || "active")
          : k === "item" ? "Has " + dbName(c.cond.itemKind === "weapon" ? S.proj.weapons : c.cond.itemKind === "armor" ? S.proj.armors : S.proj.items, c.cond.id)
          : k === "region" ? "Player in region " + (c.cond.id || 0)
          : k === "time" ? "Clock is " + (c.cond.from || 0) + ":00–" + (c.cond.to || 0) + ":00"
          : "Gold " + (c.cond.cmp || ">=") + " " + c.cond.val;
        return "If " + d;
      }
      case "loop": return "Loop";
      case "breakLoop": return "Break Loop";
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
      case "playAnim": return "Play Animation: " + dbName(S.proj.animations || [], c.animationId) + (c.target === "this" ? " (this event)" : c.target === "screen" ? " (screen)" : " (player)");
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
  export function textCodesHelp() {
    const acts = (RA.INPUT_ACTIONS || []).map((a: any) => a.key).join(", ");
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
  export const CMD_DEFS: any[] = [
    { t: "text", label: "Show Text", make: () => ({ t: "text", name: "", face: "", text: "" }),
      form(c: any, box: any) {
        const w = { name: c.name, face: c.face || "", text: c.text };
        const preview = h("span", { class: "char-preview" });
        function redrawFace() {
          preview.innerHTML = "";
          const ci = Assets.charsetIndex(w.face);
          if (ci >= 0) preview.appendChild(Assets.faceCanvas(ci));
        }
        const ta = h("textarea", { rows: 4, oninput(e: any) { w.text = e.target.value; } }, c.text);
        box.appendChild(row(field("Speaker name (optional)", tIn(w, "name")),
          field("Face (optional)", sel(w, "face", charsetOpts(true), redrawFace)), preview));
        box.appendChild(field("Text", ta));
        box.appendChild(textCodesHelp());
        redrawFace();
        return () => { c.name = w.name; c.face = w.face; c.text = w.text; };
      } },
    { t: "choices", label: "Show Choices", make: () => ({ t: "choices", options: ["Yes", "No"], branches: [[], []] }),
      form(c: any, box: any) {
        const ta = h("textarea", { rows: 4 }, c.options.join("\n"));
        box.appendChild(field("Choices (one per line)", ta));
        box.appendChild(textCodesHelp());
        return () => {
          const opts = ta.value.split("\n").map((s: any) => s.trim()).filter(Boolean);
          if (!opts.length) opts.push("OK");
          const br = opts.map((_: any, i: any) => c.branches[i] || []);
          c.options = opts; c.branches = br;
        };
      } },
    { t: "if", label: "Conditional Branch", make: () => ({ t: "if", cond: { kind: "switch", id: 1, val: true }, then: [], else: [] }),
      form(c: any, box: any) {
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
          } else if (w.kind === "region") {
            sub.appendChild(row(field("Region id (0–63; player's tile)", nIn(w, "id", 0, 63))));
          } else if (w.kind === "time") {
            sub.appendChild(row(field("From hour (0–24)", nIn(w, "from", 0, 24)),
              field("Until hour (wraps past midnight)", nIn(w, "to", 0, 24))));
          } else {
            sub.appendChild(row(field("Gold", sel(w, "cmp", [{ v: ">=", l: "≥" }, { v: "<=", l: "≤" }])), field("Value", nIn(w, "val"))));
          }
        }
        box.appendChild(field("Condition type", sel(w, "kind", [
          { v: "switch", l: "Switch" }, { v: "var", l: "Variable" }, { v: "selfsw", l: "Self-Switch" },
          { v: "quest", l: "Quest Status" }, { v: "item", l: "Has item" }, { v: "gold", l: "Gold" }, { v: "actor", l: "Actor" },
          { v: "region", l: "Player Region" }, { v: "time", l: "Time of Day" }
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
    { t: "loop", label: "Loop", make: () => ({ t: "loop", body: [] }),
      form(c: any, box: any) {
        box.appendChild(h("div", { class: "dim" },
          "Repeats its body until a Break Loop command runs inside it. The body is edited in the command list (or the graph's Body port)."));
        return () => { if (!c.body) c.body = []; };
      } },
    { t: "breakLoop", label: "Break Loop", make: () => ({ t: "breakLoop" }), form: () => () => {} },
    { t: "questStart", label: "Start Quest", make: () => ({ t: "questStart", questId: S.proj.quests[0] ? S.proj.quests[0].id : 0 }),
      form(c: any, box: any) {
        const w = { questId: c.questId || (S.proj.quests[0] ? S.proj.quests[0].id : 0) };
        box.appendChild(field("Quest", sel(w, "questId", dbOpts(S.proj.quests, "(none)"))));
        return () => { c.questId = w.questId; };
      } },
    { t: "questAdvanceObj", label: "Advance Quest Objective", make: () => ({ t: "questAdvanceObj", questId: S.proj.quests[0] ? S.proj.quests[0].id : 0, objIndex: 0, amount: 1 }),
      form(c: any, box: any) {
        const w = { questId: c.questId || (S.proj.quests[0] ? S.proj.quests[0].id : 0), objIndex: c.objIndex || 0, amount: c.amount || 1 };
        const objWrap = h("span");
        function redrawObj() {
          const q = RA.byId(S.proj.quests, w.questId);
          const opts = (q && q.objectives && q.objectives.length ? q.objectives : [{ label: "(none)" }]).map((obj: any, i: any) => ({ v: i, l: (i + 1) + ": " + (obj.label || obj.kind || "Objective") }));
          objWrap.innerHTML = "";
          objWrap.appendChild(sel(w, "objIndex", opts));
        }
        redrawObj();
        box.appendChild(row(field("Quest", sel(w, "questId", dbOpts(S.proj.quests, "(none)"), redrawObj)), field("Objective", objWrap), field("Amount", nIn(w, "amount", 1, 999))));
        return () => Object.assign(c, w);
      } },
    { t: "questSetObj", label: "Set Quest Objective Progress", make: () => ({ t: "questSetObj", questId: S.proj.quests[0] ? S.proj.quests[0].id : 0, objIndex: 0, value: 0 }),
      form(c: any, box: any) {
        const w = { questId: c.questId || (S.proj.quests[0] ? S.proj.quests[0].id : 0), objIndex: c.objIndex || 0, value: c.value || 0 };
        const objWrap = h("span");
        function redrawObj() {
          const q = RA.byId(S.proj.quests, w.questId);
          const opts = (q && q.objectives && q.objectives.length ? q.objectives : [{ label: "(none)" }]).map((obj: any, i: any) => ({ v: i, l: (i + 1) + ": " + (obj.label || obj.kind || "Objective") }));
          objWrap.innerHTML = "";
          objWrap.appendChild(sel(w, "objIndex", opts));
        }
        redrawObj();
        box.appendChild(row(field("Quest", sel(w, "questId", dbOpts(S.proj.quests, "(none)"), redrawObj)), field("Objective", objWrap), field("Value", nIn(w, "value", 0, 999))));
        return () => Object.assign(c, w);
      } },
    { t: "questComplete", label: "Complete Quest", make: () => ({ t: "questComplete", questId: S.proj.quests[0] ? S.proj.quests[0].id : 0 }),
      form(c: any, box: any) {
        const w = { questId: c.questId || (S.proj.quests[0] ? S.proj.quests[0].id : 0) };
        box.appendChild(field("Quest", sel(w, "questId", dbOpts(S.proj.quests, "(none)"))));
        return () => { c.questId = w.questId; };
      } },
    { t: "questFail", label: "Fail Quest", make: () => ({ t: "questFail", questId: S.proj.quests[0] ? S.proj.quests[0].id : 0 }),
      form(c: any, box: any) {
        const w = { questId: c.questId || (S.proj.quests[0] ? S.proj.quests[0].id : 0) };
        box.appendChild(field("Quest", sel(w, "questId", dbOpts(S.proj.quests, "(none)"))));
        return () => { c.questId = w.questId; };
      } },
    { t: "commonEvent", label: "Call Common Event", make: () => ({ t: "commonEvent", commonEventId: S.proj.commonEvents[0] ? S.proj.commonEvents[0].id : 0 }),
      form(c: any, box: any) {
        const w = { commonEventId: c.commonEventId || (S.proj.commonEvents[0] ? S.proj.commonEvents[0].id : 0) };
        box.appendChild(field("Common event", sel(w, "commonEventId", dbOpts(S.proj.commonEvents, "(none)"))));
        return () => { c.commonEventId = w.commonEventId; };
      } },
    { t: "switch", label: "Control Switch", make: () => ({ t: "switch", id: 1, val: true }),
      form(c: any, box: any) {
        const w = { id: c.id, val: String(c.val) };
        box.appendChild(row(field("Switch", sel(w, "id", switchOpts())), field("Set", sel(w, "val", [{ v: "true", l: "ON" }, { v: "false", l: "OFF" }]))));
        return () => { c.id = w.id; c.val = w.val === "true"; };
      } },
    { t: "selfsw", label: "Control Self-Switch", make: () => ({ t: "selfsw", key: "A", val: true }),
      form(c: any, box: any) {
        const w = { key: c.key, val: String(c.val) };
        box.appendChild(row(field("Key", sel(w, "key", [{ v: "A", l: "A" }, { v: "B", l: "B" }, { v: "C", l: "C" }, { v: "D", l: "D" }])),
          field("Set", sel(w, "val", [{ v: "true", l: "ON" }, { v: "false", l: "OFF" }]))));
        return () => { c.key = w.key; c.val = w.val === "true"; };
      } },
    { t: "var", label: "Control Variable", make: () => ({ t: "var", id: 1, op: "set", val: 0, val2: 0 }),
      form(c: any, box: any) {
        const w = { id: c.id, op: c.op, val: c.val, val2: c.val2 || 0 };
        box.appendChild(row(field("Variable", sel(w, "id", varOpts())),
          field("Op", sel(w, "op", [{ v: "set", l: "Set =" }, { v: "add", l: "Add +" }, { v: "sub", l: "Sub −" }, { v: "rnd", l: "Random" }])),
          field("Value", nIn(w, "val")), field("…to (random)", nIn(w, "val2"))));
        return () => Object.assign(c, w);
      } },
    { t: "transfer", label: "Transfer Player", make: () => ({ t: "transfer", mapId: 1, x: 0, y: 0, dir: 0 }),
      form(c: any, box: any) {
        const w = { mapId: c.mapId, x: c.x, y: c.y, dir: c.dir == null ? 0 : c.dir };
        const mapSel = sel(w, "mapId", dbOpts(S.proj.maps));
        const xIn = nIn(w, "x", 0, 200);
        const yIn = nIn(w, "y", 0, 200);
        box.appendChild(row(field("Map", mapSel), field("X", xIn), field("Y", yIn), field("Facing", sel(w, "dir", DIR_OPTS))));
        box.appendChild(h("button", { class: "mini", onclick() {
          openLocationPicker(w.mapId, w.x, w.y, (res: any) => {
            w.mapId = res.mapId; w.x = res.x; w.y = res.y;
            mapSel.value = String(res.mapId); xIn.value = res.x; yIn.value = res.y;
          });
        } }, "📍 Pick destination on map…"));
        return () => Object.assign(c, w);
      } },
    { t: "gold", label: "Change Gold", make: () => ({ t: "gold", op: "add", val: 100 }),
      form(c: any, box: any) {
        const w = { op: c.op, val: c.val };
        box.appendChild(row(field("Op", sel(w, "op", [{ v: "add", l: "Gain" }, { v: "sub", l: "Lose" }])), field("Amount", nIn(w, "val", 0))));
        return () => Object.assign(c, w);
      } },
    { t: "item", label: "Change Items", make: () => ({ t: "item", kind: "item", id: 1, op: "add", val: 1 }),
      form(c: any, box: any) {
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
      form(c: any, box: any) {
        const w = { op: c.op, actorId: c.actorId };
        box.appendChild(row(field("Op", sel(w, "op", [{ v: "add", l: "Add" }, { v: "remove", l: "Remove" }])),
          field("Actor", sel(w, "actorId", dbOpts(S.proj.actors)))));
        return () => Object.assign(c, w);
      } },
    { t: "heal", label: "Heal Party", make: () => ({ t: "heal", full: true, hp: 0, mp: 0 }),
      form(c: any, box: any) {
        const w = { full: !!c.full, hp: c.hp || 0, mp: c.mp || 0 };
        box.appendChild(row(field("Full recovery", chk(w, "full")), field("…or HP", nIn(w, "hp", 0)), field("MP", nIn(w, "mp", 0))));
        return () => Object.assign(c, w);
      } },
    { t: "battle", label: "Start Battle", make: () => ({ t: "battle", troopId: 1, escape: true, lose: false }),
      form(c: any, box: any) {
        const w = { troopId: c.troopId, escape: c.escape !== false, lose: !!c.lose };
        box.appendChild(row(field("Troop", sel(w, "troopId", dbOpts(S.proj.troops))),
          field("Can escape", chk(w, "escape")), field("Continue on loss", chk(w, "lose"))));
        return () => { c.troopId = w.troopId; c.escape = w.escape; c.lose = w.lose; };
      } },
    { t: "shop", label: "Open Shop", make: () => ({ t: "shop", goods: [] }),
      form(c: any, box: any) {
        const goods = RA.clone(c.goods || []);
        const list = h("div", { class: "minilist" });
        function redraw() {
          list.innerHTML = "";
          goods.forEach((gd: any, i: any) => {
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
      form(c: any, box: any) {
        const w = { frames: c.frames };
        box.appendChild(field("Frames (60 = 1 second)", nIn(w, "frames", 1, 6000)));
        return () => Object.assign(c, w);
      } },
    { t: "se", label: "Play Sound", make: () => ({ t: "se", name: "ok" }),
      form(c: any, box: any) {
        const w = { name: c.name, positional: c.at === "event" };
        const s = sel(w, "name", SE_OPTS());
        box.appendChild(row(field("Sound", s), h("button", { class: "mini", onclick() { Sfx.play(w.name); } }, "▶ test")));
        box.appendChild(row(field("Positional (pan/fade by this event's distance — imported sounds)", chk(w, "positional"))));
        return () => { c.name = w.name; if (w.positional) c.at = "event"; else delete c.at; };
      } },
    { t: "music", label: "Change Music", make: () => ({ t: "music", theme: "field" }),
      form(c: any, box: any) {
        const w = { theme: c.theme, fadeMs: c.fadeMs == null ? 800 : c.fadeMs };
        box.appendChild(row(field("Theme", sel(w, "theme", MUSIC_OPTS())),
          field("Crossfade ms (imported music)", nIn(w, "fadeMs", 0, 10000))));
        return () => { c.theme = w.theme; if (w.fadeMs !== 800) c.fadeMs = w.fadeMs; else delete c.fadeMs; };
      } },
    { t: "move", label: "Set Move Route", make: () => ({ t: "move", target: "this", steps: [], wait: true }),
      form(c: any, box: any) {
        const w = { target: c.target, wait: !!c.wait };
        const steps = c.steps.slice();
        const chipBox = h("div", { class: "minilist" });
        const STEPS = ["up", "down", "left", "right", "jump", "forward", "turn_up", "turn_down", "turn_left", "turn_right", "wait15", "wait60"];
        function redraw() {
          chipBox.innerHTML = "";
          steps.forEach((s: any, i: any) => chipBox.appendChild(h("span", { class: "chip", onclick() { steps.splice(i, 1); redraw(); }, title: "click to remove" }, s)));
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
      form(c: any, box: any) {
        const w = { zoom: c.zoom == null ? 1 : c.zoom, frames: c.frames || 0 };
        box.appendChild(row(
          field("Zoom (0.25 = out, 1 = normal, 4 = in)", nIn(w, "zoom", 0.25, 4, 0.05)),
          field("Duration (frames)", nIn(w, "frames", 0, 6000)),
        ));
        box.appendChild(h("div", { class: "dim" }, "The camera stays centered on the player. Use 1.0 to return to the normal view."));
        return () => { c.zoom = Math.max(0.25, Math.min(4, w.zoom || 1)); c.frames = Math.max(0, Math.floor(w.frames || 0)); };
      } },
    { t: "transparency", label: "Change Transparency", make: () => ({ t: "transparency", val: true }),
      form(c: any, box: any) {
        const w = { val: String(c.val !== false) };
        box.appendChild(field("Player becomes", sel(w, "val", [{ v: "true", l: "Transparent (hidden)" }, { v: "false", l: "Visible" }])));
        box.appendChild(h("div", { class: "dim" }, "A transparent player still moves and triggers events — only the sprite is hidden. Pair with “Start transparent” in Database ▸ System for cutscene intros."));
        return () => { c.val = w.val === "true"; };
      } },
    { t: "shake", label: "Shake Screen", make: () => ({ t: "shake", power: 5, speed: 5, duration: 30, wait: true }),
      form(c: any, box: any) {
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
      form(c: any, box: any) {
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
      form(c: any, box: any) {
        const w = { color: c.color || "#ffffff", opacity: c.opacity || 0.5, duration: c.duration || 15, wait: !!c.wait };
        const colorIn = h("input", { type: "color", value: w.color, oninput(e: any) { w.color = e.target.value; } });
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
    { t: "playAnim", label: "Play Animation", make: () => ({ t: "playAnim", animationId: 1, target: "player", wait: true }),
      form(c: any, box: any) {
        const w = { animationId: c.animationId || 1, target: c.target || "player", wait: c.wait !== false };
        box.appendChild(row(
          field("Animation", sel(w, "animationId", dbOpts(S.proj.animations || [], "(none)"))),
          field("Show over", sel(w, "target", [
            { v: "player", l: "Player" },
            { v: "this", l: "This Event" },
            { v: "screen", l: "Screen center" },
          ])),
          field("Wait for completion", chk(w, "wait"))
        ));
        return () => {
          c.animationId = Number(w.animationId);
          c.target = w.target;
          c.wait = w.wait;
        };
      } },
    { t: "erase", label: "Erase This Event", make: () => ({ t: "erase" }), form: () => () => {} },
    { t: "save", label: "Open Save Screen", make: () => ({ t: "save" }), form: () => () => {} },
    { t: "gameover", label: "Game Over", make: () => ({ t: "gameover" }), form: () => () => {} },
    { t: "totitle", label: "Return to Title", make: () => ({ t: "totitle" }), form: () => () => {} },
    { t: "script", label: "Script (JavaScript)", make: () => ({ t: "script", code: "" }),
      form(c: any, box: any) {
        const ta = h("textarea", { rows: 6, spellcheck: "false" }, c.code || "");
        box.appendChild(field("JS — api: game.setSwitch(id,v) getSwitch setVar getVar addGold(n) callCommonEvent(id) party() quest(id) questStatus startQuest advanceQuestObjective setQuestObjective completeQuest failQuest abandonQuest state()", ta));
        return () => { c.code = ta.value; };
      } },
  ];
  export const cmdDef = (t: any) => CMD_DEFS.find((d) => d.t === t);

  // Build a command's parameter form into any container and return its apply() commit
  // closure. Shared by the modal editor (editCommand) and the inline inspector, so each
  // per-type form builder is reused verbatim regardless of where it's hosted.
  export function mountForm(c: any, container: any) {
    return cmdDef(c.t).form(c, container) || (() => {});
  }
  export function editCommand(c: any, onDone: any, skipSnapshot?: any, snapFn?: any, onCancel?: any) {
    const def = cmdDef(c.t);
    const box = h("div");
    const apply = mountForm(c, box);
    modal({
      title: def.label,
      content: box,
      buttons: [
        { label: "OK", primary: true, onClick(close: any) { if (!skipSnapshot && snapFn) snapFn(); apply(); close(); touch(); onDone(); } },
        { label: "Cancel", onClick(close: any) { close(); (onCancel || onDone)(); } },
      ],
      dismissable: false,
      dialogKeys: true,
    });
  }
  export function pickCommand(onPicked: any) {
    const PAGE_SIZE = 24;
    const tabs = h("div", { class: "cmdtabs" });
    const grid = h("div", { class: "cmdgrid" });
    const m = modal({ title: "Add Command", content: h("div", null, tabs, grid), buttons: [{ label: "Cancel" }], dialogKeys: true });
    let page = 0;

    function editPreset(preset: any) {
      const draft = { name: preset ? preset.name : "", code: preset ? preset.code : "" };
      const nameInput = tIn(draft, "name");
      const codeInput = h("textarea", { rows: 8, spellcheck: "false" }, draft.code);
      const buttons: any[] = [
        { label: "Save", primary: true, onClick(close: any) {
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
      if (preset) buttons.unshift({ label: "Delete", onClick(close: any) {
        confirmBox("Delete the saved command button \"" + preset.name + "\"?", () => {
          S.proj.commandPresets = S.proj.commandPresets.filter((p: any) => p.id !== preset.id);
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
      return (CMD_DEFS.map((def) => ({ kind: "builtin", def })) as any[])
        .concat(S.proj.commandPresets.map((preset: any) => ({ kind: "preset", preset })))
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
      all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).forEach((item: any) => {
        if (item.kind === "builtin") {
          grid.appendChild(h("button", { onclick() { m.close(); onPicked(item.def.make()); } }, item.def.label));
        } else if (item.kind === "preset") {
          grid.appendChild(h("button", {
            class: "cmdpreset",
            title: "Insert saved script. Right-click to edit or delete.",
            onclick() { m.close(); onPicked({ t: "script", code: item.preset.code || "" }); },
            oncontextmenu(e: any) { e.preventDefault(); editPreset(item.preset); },
          }, item.preset.name));
        } else {
          grid.appendChild(h("button", { class: "cmdaddnew", onclick() { editPreset(null); } }, "+Add New"));
        }
      });
    }
    redraw();
  }
