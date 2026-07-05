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

  // Speech-balloon glyph names (Project Compass M2·A), RM balloon ids 1–15;
  // 11–15 are custom slots in RM, kept as generic "Balloon N".
  const BALLOON_NAMES: Record<number, string> = {
    1: "Exclamation", 2: "Question", 3: "Music Note", 4: "Heart", 5: "Anger",
    6: "Sweat", 7: "Frustration", 8: "Silence", 9: "Light Bulb", 10: "Zzz",
  };
  const BALLOON_OPTS = Array.from({ length: 15 }, (_, i) => ({ v: i + 1, l: (i + 1) + ": " + (BALLOON_NAMES[i + 1] || "Balloon " + (i + 1)) }));
  const BLEND_OPTS = [{ v: 0, l: "Normal" }, { v: 1, l: "Add" }, { v: 2, l: "Multiply" }, { v: 3, l: "Screen" }];
  const ORIGIN_OPTS = [{ v: 0, l: "Upper-left" }, { v: 1, l: "Center" }];
  // Change-actor-data family (Project Compass M2·C): the base parameters Atlas
  // models (RM's `luk` has no Atlas home), and the actor dropdowns. The
  // exp/level/param/skill/state commands offer "Entire Party" (id 0).
  const PARAM_OPTS = [
    { v: "mhp", l: "Max HP" }, { v: "mmp", l: "Max MP" }, { v: "atk", l: "Attack" },
    { v: "def", l: "Defense" }, { v: "mat", l: "M.Attack" }, { v: "mdf", l: "M.Defense" }, { v: "agi", l: "Agility" },
  ];
  const PARAM_LABEL: Record<string, string> = { mhp: "Max HP", mmp: "Max MP", atk: "Attack", def: "Defense", mat: "M.Attack", mdf: "M.Defense", agi: "Agility" };
  const actorOnlyOpts = () => S.proj.actors.map((a: any) => ({ v: a.id, l: a.name }));
  const actorPartyOpts = () => [{ v: 0, l: "Entire Party" }, ...actorOnlyOpts()];
  const actorLabel = (id: any) => (Number(id) === 0 ? "Entire Party" : (RA.byId(S.proj.actors, id) || { name: "#" + id }).name);
  // Screen/picture colour tone presets ([r,g,b,gray]) offered in the tint forms.
  const TONE_PRESETS: { l: string; tone: [number, number, number, number] }[] = [
    { l: "Normal", tone: [0, 0, 0, 0] },
    { l: "Dark", tone: [-68, -68, -68, 0] },
    { l: "Night", tone: [-68, -68, 0, 68] },
    { l: "Sepia", tone: [34, -34, -68, 170] },
    { l: "Sunset", tone: [68, -34, -34, 0] },
  ];
  /** A [r,g,b,gray] tone editor: four numeric fields + a preset dropdown. */
  function toneEditor(w: any, key: string) {
    if (!Array.isArray(w[key])) w[key] = [0, 0, 0, 0];
    const t = w[key];
    const model = { r: t[0], g: t[1], b: t[2], gray: t[3], preset: "" };
    const sync = () => { w[key] = [Number(model.r) || 0, Number(model.g) || 0, Number(model.b) || 0, Number(model.gray) || 0]; };
    const rIn = nIn(model, "r", -255, 255); const gIn = nIn(model, "g", -255, 255);
    const bIn = nIn(model, "b", -255, 255); const grIn = nIn(model, "gray", 0, 255);
    [rIn, gIn, bIn, grIn].forEach((i: any) => i.addEventListener("input", sync));
    const presetSel = sel(model, "preset", [{ v: "", l: "Preset…" }, ...TONE_PRESETS.map((p, i) => ({ v: String(i), l: p.l }))], () => {
      if (model.preset === "") return;
      const p = TONE_PRESETS[Number(model.preset)];
      model.r = p.tone[0]; model.g = p.tone[1]; model.b = p.tone[2]; model.gray = p.tone[3];
      rIn.value = String(model.r); gIn.value = String(model.g); bIn.value = String(model.b); grIn.value = String(model.gray);
      sync();
    });
    sync();
    return row(field("Red (−255…255)", rIn), field("Green", gIn), field("Blue", bIn), field("Gray (0…255)", grIn), field("", presetSel));
  }

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
      case "showPic": return "Show Picture #" + c.id + (c.name ? ": " + String(c.name).replace(/^asset:[^/]*\//, "") : "");
      case "movePic": return "Move Picture #" + c.id + " over " + (c.frames || 0) + " frames";
      case "rotatePic": return "Rotate Picture #" + c.id + " (speed " + (c.speed || 0) + ")";
      case "tintPic": return "Tint Picture #" + c.id + " [" + (c.tone || []).join(", ") + "]";
      case "erasePic": return "Erase Picture #" + c.id;
      case "tint": return "Tint Screen [" + (c.tone || []).join(", ") + "] over " + (c.frames || 0) + "f";
      case "timer": return c.op === "stop" ? "Stop Timer" : "Start Timer: " + (c.seconds || 0) + "s" + (c.common ? " → " + commonEventName(c.common) : "");
      case "scrollMap": return "Scroll Map " + (c.dir || "?") + " " + (c.distance || 0) + " tiles (speed " + (c.speed || 0) + ")";
      case "balloon": return "Balloon " + (BALLOON_NAMES[c.balloonId] || c.balloonId) + " over " + (c.target === "player" ? "Player" : c.target === "this" ? "This Event" : "Event #" + c.target);
      case "scrollText": return "Scrolling Text: " + String(c.text || "").split("\n")[0].slice(0, 40);
      case "inputNumber": return "Input Number → Variable " + varName(c.varId) + " (" + (c.digits || 1) + " digit" + ((c.digits || 1) === 1 ? "" : "s") + ")";
      case "selectItem": return "Select Item → Variable " + varName(c.varId);
      case "nameInput": return "Name Input: " + dbName(S.proj.actors, c.actorId) + " (max " + (c.maxChars || 8) + ")";
      // --- Actor-data family + flow labels + system toggles (M2·C) ---
      case "label": return "◆ Label: " + (c.name || "");
      case "jump": return "→ Jump to Label: " + (c.name || "");
      case "changeExp": return "Change EXP: " + actorLabel(c.actorId) + " " + (c.op === "sub" ? "−" : "+") + (c.value || 0);
      case "changeLevel": return "Change Level: " + actorLabel(c.actorId) + " " + (c.op === "sub" ? "−" : "+") + (c.value || 0);
      case "changeParam": return "Change " + (PARAM_LABEL[c.param] || c.param) + ": " + actorLabel(c.actorId) + " " + (c.op === "sub" ? "−" : "+") + (c.value || 0);
      case "changeSkill": return (c.op === "forget" ? "Forget" : "Learn") + " Skill: " + actorLabel(c.actorId) + " — " + dbName(S.proj.skills, c.skillId);
      case "changeEquip": return "Change Equipment: " + actorLabel(c.actorId) + " " + (c.slot === "armor" ? "armor" : "weapon") + " = " + (c.itemId ? dbName(c.slot === "armor" ? S.proj.armors : S.proj.weapons, c.itemId) : "(none)");
      case "changeName": return "Change Name: " + actorLabel(c.actorId) + " → " + (c.name || "");
      case "changeClass": return "Change Class: " + actorLabel(c.actorId) + " → " + dbName(S.proj.classes, c.classId);
      case "changeActorImage": return "Change Actor Image: " + actorLabel(c.actorId) + " → " + (c.charset || "(none)");
      case "changeNickname": return "Change Nickname: " + actorLabel(c.actorId) + " → " + (c.nickname || "");
      case "changeProfile": return "Change Profile: " + actorLabel(c.actorId);
      case "changeState": return (c.op === "remove" ? "Remove" : "Add") + " State: " + actorLabel(c.actorId) + " — " + dbName(S.proj.states, c.stateId);
      case "changeTp": return "Change TP: " + actorLabel(c.actorId) + " " + (c.op === "sub" ? "−" : "+") + (c.value || 0);
      case "changeEnemyTp": return "Change Enemy TP: " + (c.enemyIndex < 0 ? "Entire Troop" : "Enemy #" + ((c.enemyIndex || 0) + 1)) + " " + (c.op === "sub" ? "−" : "+") + (c.value || 0);
      case "access": {
        const label = c.kind === "save" ? "Save" : c.kind === "encounter" ? "Encounters" : c.kind === "formation" ? "Formation" : "Menu";
        return "Change " + label + " Access: " + (c.enabled === false ? "Disable" : "Enable");
      }
      case "followers": return "Change Followers: " + (c.show === false ? "Hide" : "Show");
      case "windowTone": return "Change Window Color [" + (c.tone || []).join(", ") + "]";
      case "getLocationInfo": return "Get Location Info → Variable " + varName(c.varId) + " (" + (c.infoType || "region") + " @ " + (c.x || 0) + "," + (c.y || 0) + ")";
      case "erase": return "Erase This Event";
      case "save": return "Open Save Screen";
      case "gameover": return "Game Over";
      case "totitle": return "Return to Title";
      case "script": return "Script: " + (c.code || "").split("\n")[0].slice(0, 42);
      case "mzTodo": return "📌 " + (c.label || "Imported command (coming in a later update)");
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
      ["\\p[n]", "party member's name (nth in party)"],
      ["\\g", "gold amount"],
      ["\\$", "show the current gold inline"],
      ["\\input[action]", "button glyph for a control (action: " + acts + ")"],
      ["\\i[n]", "inline icon"],
      ["\\c[n] · \\c[#hex]", "text color"],
      ["\\{ … \\}", "bigger / smaller text"],
      ["\\. · \\|", "pause ¼ sec / 1 sec while typing"],
      ["\\!", "wait for a button press"],
      ["\\> … \\<", "type the rest instantly / back to normal"],
      ["\\^", "close without waiting for input"],
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
        const w = { name: c.name, face: c.face || "", text: c.text, background: c.background || 0, position: c.position == null ? 2 : c.position };
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
        box.appendChild(row(
          field("Window", sel(w, "background", [{ v: 0, l: "Window" }, { v: 1, l: "Dim" }, { v: 2, l: "Transparent" }])),
          field("Position", sel(w, "position", [{ v: 0, l: "Top" }, { v: 1, l: "Middle" }, { v: 2, l: "Bottom" }]))));
        box.appendChild(textCodesHelp());
        redrawFace();
        return () => {
          c.name = w.name; c.face = w.face; c.text = w.text;
          const bg = Number(w.background) || 0;
          if (bg) c.background = bg; else delete c.background;
          const pos = Number(w.position);
          if (pos !== 2) c.position = pos; else delete c.position;
        };
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
    // --- Presentation family (Project Compass M2·A) ---
    { t: "showPic", label: "Show Picture", make: () => ({ t: "showPic", id: 1, name: "", origin: 0, x: 0, y: 0, scaleX: 100, scaleY: 100, opacity: 255, blend: 0 }),
      form(c: any, box: any) {
        const w = { id: c.id || 1, name: c.name || "", origin: c.origin || 0, x: c.x || 0, y: c.y || 0, scaleX: c.scaleX == null ? 100 : c.scaleX, scaleY: c.scaleY == null ? 100 : c.scaleY, opacity: c.opacity == null ? 255 : c.opacity, blend: c.blend || 0 };
        box.appendChild(row(field("Picture # (1–100)", nIn(w, "id", 1, 100)), field("Origin", sel(w, "origin", ORIGIN_OPTS))));
        box.appendChild(field("Image (asset key or image URL)", tIn(w, "name")));
        box.appendChild(h("div", { class: "dim" }, "Point this at an image in your Assets library (asset:… key) or a direct image URL. Pictures imported from RPG Maker keep their name; add the matching art to your library and it appears."));
        box.appendChild(row(field("X (px)", nIn(w, "x")), field("Y (px)", nIn(w, "y"))));
        box.appendChild(row(field("Scale X %", nIn(w, "scaleX", 0, 2000)), field("Scale Y %", nIn(w, "scaleY", 0, 2000)),
          field("Opacity (0–255)", nIn(w, "opacity", 0, 255)), field("Blend", sel(w, "blend", BLEND_OPTS))));
        return () => Object.assign(c, w);
      } },
    { t: "movePic", label: "Move Picture", make: () => ({ t: "movePic", id: 1, origin: 0, x: 0, y: 0, scaleX: 100, scaleY: 100, opacity: 255, blend: 0, frames: 60, wait: true }),
      form(c: any, box: any) {
        const w = { id: c.id || 1, origin: c.origin || 0, x: c.x || 0, y: c.y || 0, scaleX: c.scaleX == null ? 100 : c.scaleX, scaleY: c.scaleY == null ? 100 : c.scaleY, opacity: c.opacity == null ? 255 : c.opacity, blend: c.blend || 0, frames: c.frames == null ? 60 : c.frames, wait: c.wait !== false };
        box.appendChild(row(field("Picture #", nIn(w, "id", 1, 100)), field("Origin", sel(w, "origin", ORIGIN_OPTS)), field("Blend", sel(w, "blend", BLEND_OPTS))));
        box.appendChild(row(field("X (px)", nIn(w, "x")), field("Y (px)", nIn(w, "y"))));
        box.appendChild(row(field("Scale X %", nIn(w, "scaleX", 0, 2000)), field("Scale Y %", nIn(w, "scaleY", 0, 2000)), field("Opacity", nIn(w, "opacity", 0, 255))));
        box.appendChild(row(field("Duration (frames)", nIn(w, "frames", 0, 6000)), field("Wait for completion", chk(w, "wait"))));
        return () => Object.assign(c, w);
      } },
    { t: "rotatePic", label: "Rotate Picture", make: () => ({ t: "rotatePic", id: 1, speed: 5 }),
      form(c: any, box: any) {
        const w = { id: c.id || 1, speed: c.speed == null ? 5 : c.speed };
        box.appendChild(row(field("Picture #", nIn(w, "id", 1, 100)), field("Speed (° per frame; 0 stops)", nIn(w, "speed", -90, 90))));
        return () => Object.assign(c, w);
      } },
    { t: "tintPic", label: "Tint Picture", make: () => ({ t: "tintPic", id: 1, tone: [0, 0, 0, 0], frames: 60, wait: true }),
      form(c: any, box: any) {
        const w: any = { id: c.id || 1, tone: Array.isArray(c.tone) ? c.tone.slice() : [0, 0, 0, 0], frames: c.frames == null ? 60 : c.frames, wait: c.wait !== false };
        box.appendChild(row(field("Picture #", nIn(w, "id", 1, 100)), field("Duration (frames)", nIn(w, "frames", 0, 6000)), field("Wait", chk(w, "wait"))));
        box.appendChild(toneEditor(w, "tone"));
        return () => { c.id = w.id; c.tone = w.tone; c.frames = w.frames; c.wait = w.wait; };
      } },
    { t: "erasePic", label: "Erase Picture", make: () => ({ t: "erasePic", id: 1 }),
      form(c: any, box: any) {
        const w = { id: c.id || 1 };
        box.appendChild(field("Picture #", nIn(w, "id", 1, 100)));
        return () => Object.assign(c, w);
      } },
    { t: "tint", label: "Tint Screen", make: () => ({ t: "tint", tone: [0, 0, 0, 0], frames: 60, wait: false }),
      form(c: any, box: any) {
        const w: any = { tone: Array.isArray(c.tone) ? c.tone.slice() : [0, 0, 0, 0], frames: c.frames == null ? 60 : c.frames, wait: !!c.wait };
        box.appendChild(toneEditor(w, "tone"));
        box.appendChild(row(field("Duration (frames)", nIn(w, "frames", 0, 6000)), field("Wait for completion", chk(w, "wait"))));
        box.appendChild(h("div", { class: "dim" }, "Colour-tints the whole screen. Use “Dark” for a fade to dusk, or drag all channels to −255 for a fade to black. Set “Normal” to clear it."));
        return () => { c.tone = w.tone; c.frames = w.frames; c.wait = w.wait; };
      } },
    { t: "timer", label: "Control Timer", make: () => ({ t: "timer", op: "start", seconds: 60, common: 0 }),
      form(c: any, box: any) {
        const w = { op: c.op || "start", seconds: c.seconds == null ? 60 : c.seconds, common: c.common || 0 };
        box.appendChild(field("Operation", sel(w, "op", [{ v: "start", l: "Start" }, { v: "stop", l: "Stop" }])));
        box.appendChild(row(field("Seconds", nIn(w, "seconds", 0, 5999)),
          field("On expire, call Common Event (optional)", sel(w, "common", dbOpts(S.proj.commonEvents, "(none)")))));
        box.appendChild(h("div", { class: "dim" }, "A count-down clock shows at the top of the screen. When it reaches 0 it stops; optionally it can fire a common event (a nice touch for time-limit puzzles)."));
        return () => { c.op = w.op; c.seconds = Number(w.seconds); c.common = Number(w.common) || 0; };
      } },
    { t: "scrollMap", label: "Scroll Map", make: () => ({ t: "scrollMap", dir: "right", distance: 4, speed: 4, wait: true }),
      form(c: any, box: any) {
        const w = { dir: c.dir || "right", distance: c.distance == null ? 4 : c.distance, speed: c.speed || 4, wait: c.wait !== false };
        box.appendChild(row(
          field("Direction", sel(w, "dir", [{ v: "up", l: "Up" }, { v: "down", l: "Down" }, { v: "left", l: "Left" }, { v: "right", l: "Right" }])),
          field("Distance (tiles)", nIn(w, "distance", 0, 200)),
          field("Speed (1–6)", nIn(w, "speed", 1, 6)),
          field("Wait for completion", chk(w, "wait"))));
        box.appendChild(h("div", { class: "dim" }, "Pans the camera away from the player. The view returns to the player when they move. Can't scroll past the edge of the map."));
        return () => Object.assign(c, w);
      } },
    { t: "balloon", label: "Show Balloon Icon", make: () => ({ t: "balloon", target: "this", balloonId: 1, wait: false }),
      form(c: any, box: any) {
        const w = { target: typeof c.target === "number" ? "event" : (c.target || "this"), eventId: typeof c.target === "number" ? c.target : 1, balloonId: c.balloonId || 1, wait: !!c.wait };
        const evWrap = h("span");
        function redraw() {
          evWrap.innerHTML = "";
          if (w.target === "event") evWrap.appendChild(nIn(w, "eventId", 1, 999));
          else evWrap.appendChild(h("span", { class: "dim" }, "—"));
        }
        box.appendChild(row(
          field("Over", sel(w, "target", [{ v: "player", l: "Player" }, { v: "this", l: "This Event" }, { v: "event", l: "Event # …" }], redraw)),
          field("Event #", evWrap),
          field("Balloon", sel(w, "balloonId", BALLOON_OPTS)),
          field("Wait", chk(w, "wait"))));
        redraw();
        return () => { c.target = w.target === "event" ? Number(w.eventId) : w.target; c.balloonId = Number(w.balloonId); c.wait = w.wait; };
      } },
    { t: "scrollText", label: "Show Scrolling Text", make: () => ({ t: "scrollText", text: "", speed: 2, noFast: false }),
      form(c: any, box: any) {
        const w = { speed: c.speed == null ? 2 : c.speed, noFast: !!c.noFast };
        const ta = h("textarea", { rows: 5 }, c.text || "");
        box.appendChild(field("Text (one line per line)", ta));
        box.appendChild(row(field("Speed (1 slow – 8 fast)", nIn(w, "speed", 1, 8)), field("Can't speed up (hold OK)", chk(w, "noFast"))));
        box.appendChild(h("div", { class: "dim" }, "Full-screen credits-style crawl. Players can hold OK to speed it up (unless disabled) or press Cancel to skip."));
        return () => { c.text = ta.value; c.speed = Number(w.speed); c.noFast = w.noFast; };
      } },
    // --- Message-system input scenes (Project Compass M2·B) ---
    { t: "inputNumber", label: "Input Number", make: () => ({ t: "inputNumber", varId: 1, digits: 2 }),
      form(c: any, box: any) {
        const w = { varId: c.varId || 1, digits: c.digits == null ? 2 : c.digits };
        box.appendChild(row(field("Store in Variable", sel(w, "varId", varOpts())), field("Digits (1–8)", nIn(w, "digits", 1, 8))));
        box.appendChild(h("div", { class: "dim" }, "The player dials in a number on screen; it's saved to the chosen variable."));
        return () => { c.varId = Number(w.varId); c.digits = Number(w.digits); };
      } },
    { t: "selectItem", label: "Select Item", make: () => ({ t: "selectItem", varId: 1 }),
      form(c: any, box: any) {
        const w = { varId: c.varId || 1 };
        box.appendChild(field("Store chosen item's id in Variable", sel(w, "varId", varOpts())));
        box.appendChild(h("div", { class: "dim" }, "The player picks one of the items they're carrying; the item's id is saved to the variable (0 if they cancel)."));
        return () => { c.varId = Number(w.varId); };
      } },
    { t: "nameInput", label: "Name Input", make: () => ({ t: "nameInput", actorId: S.proj.actors[0] ? S.proj.actors[0].id : 1, maxChars: 8 }),
      form(c: any, box: any) {
        const w = { actorId: c.actorId || (S.proj.actors[0] ? S.proj.actors[0].id : 1), maxChars: c.maxChars || 8 };
        box.appendChild(row(field("Hero", sel(w, "actorId", dbOpts(S.proj.actors))), field("Max letters (1–16)", nIn(w, "maxChars", 1, 16))));
        box.appendChild(h("div", { class: "dim" }, "Opens an on-screen keyboard so the player can rename this hero."));
        return () => { c.actorId = Number(w.actorId); c.maxChars = Number(w.maxChars); };
      } },
    // --- Flow labels (Project Compass M2·C) ---
    { t: "label", label: "Label", make: () => ({ t: "label", name: "Start" }),
      form(c: any, box: any) {
        const w = { name: c.name || "" };
        box.appendChild(field("Label name", tIn(w, "name")));
        box.appendChild(h("div", { class: "dim" }, "A named spot in this command list that a Jump to Label can leap to."));
        return () => { c.name = w.name; };
      } },
    { t: "jump", label: "Jump to Label", make: () => ({ t: "jump", name: "Start" }),
      form(c: any, box: any) {
        const w = { name: c.name || "" };
        box.appendChild(field("Label name", tIn(w, "name")));
        box.appendChild(h("div", { class: "dim" }, "Jumps to the matching Label in this same command list (looks in enclosing lists if it isn't here). Handy for making your own loops."));
        return () => { c.name = w.name; };
      } },
    // --- Change-actor-data family (Project Compass M2·C) ---
    { t: "changeExp", label: "Change EXP", make: () => ({ t: "changeExp", actorId: 0, op: "add", value: 100 }),
      form(c: any, box: any) {
        const w = { actorId: c.actorId == null ? 0 : c.actorId, op: c.op || "add", value: c.value == null ? 100 : c.value };
        box.appendChild(row(field("Hero", sel(w, "actorId", actorPartyOpts())),
          field("Op", sel(w, "op", [{ v: "add", l: "Increase" }, { v: "sub", l: "Decrease" }])),
          field("Amount", nIn(w, "value", 0))));
        box.appendChild(h("div", { class: "dim" }, "Levels rise as EXP crosses each threshold (and class skills are learned along the way)."));
        return () => { c.actorId = Number(w.actorId); c.op = w.op; c.value = Number(w.value); };
      } },
    { t: "changeLevel", label: "Change Level", make: () => ({ t: "changeLevel", actorId: 0, op: "add", value: 1 }),
      form(c: any, box: any) {
        const w = { actorId: c.actorId == null ? 0 : c.actorId, op: c.op || "add", value: c.value == null ? 1 : c.value };
        box.appendChild(row(field("Hero", sel(w, "actorId", actorPartyOpts())),
          field("Op", sel(w, "op", [{ v: "add", l: "Increase" }, { v: "sub", l: "Decrease" }])),
          field("Levels", nIn(w, "value", 0, 99))));
        return () => { c.actorId = Number(w.actorId); c.op = w.op; c.value = Number(w.value); };
      } },
    { t: "changeParam", label: "Change Parameters", make: () => ({ t: "changeParam", actorId: 0, param: "atk", op: "add", value: 1 }),
      form(c: any, box: any) {
        const w = { actorId: c.actorId == null ? 0 : c.actorId, param: c.param || "atk", op: c.op || "add", value: c.value == null ? 1 : c.value };
        box.appendChild(row(field("Hero", sel(w, "actorId", actorPartyOpts())),
          field("Parameter", sel(w, "param", PARAM_OPTS))));
        box.appendChild(row(field("Op", sel(w, "op", [{ v: "add", l: "Increase" }, { v: "sub", l: "Decrease" }])),
          field("Amount", nIn(w, "value", 0))));
        box.appendChild(h("div", { class: "dim" }, "Adds a permanent bonus to a base stat (on top of class growth and equipment)."));
        return () => { c.actorId = Number(w.actorId); c.param = w.param; c.op = w.op; c.value = Number(w.value); };
      } },
    { t: "changeSkill", label: "Change Skills", make: () => ({ t: "changeSkill", actorId: 0, op: "learn", skillId: S.proj.skills[0] ? S.proj.skills[0].id : 1 }),
      form(c: any, box: any) {
        const w = { actorId: c.actorId == null ? 0 : c.actorId, op: c.op || "learn", skillId: c.skillId || (S.proj.skills[0] ? S.proj.skills[0].id : 1) };
        box.appendChild(row(field("Hero", sel(w, "actorId", actorPartyOpts())),
          field("Op", sel(w, "op", [{ v: "learn", l: "Learn" }, { v: "forget", l: "Forget" }])),
          field("Skill", sel(w, "skillId", dbOpts(S.proj.skills)))));
        return () => { c.actorId = Number(w.actorId); c.op = w.op; c.skillId = Number(w.skillId); };
      } },
    { t: "changeEquip", label: "Change Equipment", make: () => ({ t: "changeEquip", actorId: S.proj.actors[0] ? S.proj.actors[0].id : 1, slot: "weapon", itemId: 0 }),
      form(c: any, box: any) {
        const w = { actorId: c.actorId || (S.proj.actors[0] ? S.proj.actors[0].id : 1), slot: c.slot || "weapon", itemId: c.itemId || 0 };
        const entry = h("span");
        function redraw() {
          const arr = w.slot === "armor" ? S.proj.armors : S.proj.weapons;
          entry.innerHTML = "";
          entry.appendChild(sel(w, "itemId", dbOpts(arr, "(none / unequip)")));
        }
        box.appendChild(row(field("Hero", sel(w, "actorId", dbOpts(S.proj.actors))),
          field("Slot", sel(w, "slot", [{ v: "weapon", l: "Weapon" }, { v: "armor", l: "Armor" }], redraw)),
          field("Equip", entry)));
        redraw();
        return () => { c.actorId = Number(w.actorId); c.slot = w.slot; c.itemId = Number(w.itemId) || 0; };
      } },
    { t: "changeName", label: "Change Name", make: () => ({ t: "changeName", actorId: S.proj.actors[0] ? S.proj.actors[0].id : 1, name: "" }),
      form(c: any, box: any) {
        const w = { actorId: c.actorId || (S.proj.actors[0] ? S.proj.actors[0].id : 1), name: c.name || "" };
        box.appendChild(row(field("Hero", sel(w, "actorId", dbOpts(S.proj.actors))), field("New name", tIn(w, "name"))));
        return () => { c.actorId = Number(w.actorId); c.name = w.name; };
      } },
    { t: "changeClass", label: "Change Class", make: () => ({ t: "changeClass", actorId: S.proj.actors[0] ? S.proj.actors[0].id : 1, classId: S.proj.classes[0] ? S.proj.classes[0].id : 1 }),
      form(c: any, box: any) {
        const w = { actorId: c.actorId || (S.proj.actors[0] ? S.proj.actors[0].id : 1), classId: c.classId || (S.proj.classes[0] ? S.proj.classes[0].id : 1) };
        box.appendChild(row(field("Hero", sel(w, "actorId", dbOpts(S.proj.actors))), field("New class", sel(w, "classId", dbOpts(S.proj.classes)))));
        box.appendChild(h("div", { class: "dim" }, "The hero keeps their level; their stats and learnable skills follow the new class."));
        return () => { c.actorId = Number(w.actorId); c.classId = Number(w.classId); };
      } },
    { t: "changeActorImage", label: "Change Actor Image", make: () => ({ t: "changeActorImage", actorId: S.proj.actors[0] ? S.proj.actors[0].id : 1, charset: "" }),
      form(c: any, box: any) {
        const w = { actorId: c.actorId || (S.proj.actors[0] ? S.proj.actors[0].id : 1), charset: c.charset || "" };
        box.appendChild(row(field("Hero", sel(w, "actorId", dbOpts(S.proj.actors))), field("Charset (map sprite + face)", sel(w, "charset", charsetOpts(true)))));
        box.appendChild(h("div", { class: "dim" }, "Atlas uses one image for a hero's map sprite and menu face."));
        return () => { c.actorId = Number(w.actorId); c.charset = w.charset; };
      } },
    { t: "changeNickname", label: "Change Nickname", make: () => ({ t: "changeNickname", actorId: S.proj.actors[0] ? S.proj.actors[0].id : 1, nickname: "" }),
      form(c: any, box: any) {
        const w = { actorId: c.actorId || (S.proj.actors[0] ? S.proj.actors[0].id : 1), nickname: c.nickname || "" };
        box.appendChild(row(field("Hero", sel(w, "actorId", dbOpts(S.proj.actors))), field("Nickname", tIn(w, "nickname"))));
        return () => { c.actorId = Number(w.actorId); c.nickname = w.nickname; };
      } },
    { t: "changeProfile", label: "Change Profile", make: () => ({ t: "changeProfile", actorId: S.proj.actors[0] ? S.proj.actors[0].id : 1, profile: "" }),
      form(c: any, box: any) {
        const w = { actorId: c.actorId || (S.proj.actors[0] ? S.proj.actors[0].id : 1) };
        const ta = h("textarea", { rows: 3 }, c.profile || "");
        box.appendChild(field("Hero", sel(w, "actorId", dbOpts(S.proj.actors))));
        box.appendChild(field("Profile", ta));
        return () => { c.actorId = Number(w.actorId); c.profile = ta.value; };
      } },
    { t: "changeState", label: "Change State", make: () => ({ t: "changeState", actorId: 0, op: "add", stateId: S.proj.states[0] ? S.proj.states[0].id : 1 }),
      form(c: any, box: any) {
        const w = { actorId: c.actorId == null ? 0 : c.actorId, op: c.op || "add", stateId: c.stateId || (S.proj.states[0] ? S.proj.states[0].id : 1) };
        box.appendChild(row(field("Hero", sel(w, "actorId", actorPartyOpts())),
          field("Op", sel(w, "op", [{ v: "add", l: "Add" }, { v: "remove", l: "Remove" }])),
          field("State", sel(w, "stateId", dbOpts(S.proj.states)))));
        return () => { c.actorId = Number(w.actorId); c.op = w.op; c.stateId = Number(w.stateId); };
      } },
    // --- TP (Project Compass M3·B) ---
    { t: "changeTp", label: "Change TP", make: () => ({ t: "changeTp", actorId: 0, op: "add", value: 25 }),
      form(c: any, box: any) {
        const w = { actorId: c.actorId == null ? 0 : c.actorId, op: c.op || "add", value: c.value == null ? 25 : c.value };
        box.appendChild(row(field("Hero", sel(w, "actorId", actorPartyOpts())),
          field("Op", sel(w, "op", [{ v: "add", l: "Increase" }, { v: "sub", l: "Decrease" }])),
          field("Amount", nIn(w, "value", 0, 100))));
        box.appendChild(h("div", { class: "dim" }, "TP only matters when the TP system is on (System ▸ “Show TP in battle”, or any skill with a TP cost)."));
        return () => { c.actorId = Number(w.actorId); c.op = w.op; c.value = Number(w.value); };
      } },
    { t: "changeEnemyTp", label: "Change Enemy TP", make: () => ({ t: "changeEnemyTp", enemyIndex: -1, op: "add", value: 25 }),
      form(c: any, box: any) {
        const w = { enemyIndex: c.enemyIndex == null ? -1 : c.enemyIndex, op: c.op || "add", value: c.value == null ? 25 : c.value };
        const slots: any = [{ v: -1, l: "Entire Troop" }];
        for (let i = 0; i < 8; i++) slots.push({ v: i, l: "Enemy #" + (i + 1) });
        box.appendChild(row(field("Enemy", sel(w, "enemyIndex", slots)),
          field("Op", sel(w, "op", [{ v: "add", l: "Increase" }, { v: "sub", l: "Decrease" }])),
          field("Amount", nIn(w, "value", 0, 100))));
        box.appendChild(h("div", { class: "dim" }, "Runs during battle (troop event pages). Outside battle it does nothing."));
        return () => { c.enemyIndex = Number(w.enemyIndex); c.op = w.op; c.value = Number(w.value); };
      } },
    // --- System toggles (Project Compass M2·C) ---
    { t: "access", label: "Change Access (Menu/Save/…)", make: () => ({ t: "access", kind: "menu", enabled: true }),
      form(c: any, box: any) {
        const w = { kind: c.kind || "menu", enabled: String(c.enabled !== false) };
        box.appendChild(row(field("Access", sel(w, "kind", [
          { v: "menu", l: "Menu" }, { v: "save", l: "Save" }, { v: "encounter", l: "Encounters" }, { v: "formation", l: "Formation" },
        ])), field("Set", sel(w, "enabled", [{ v: "true", l: "Enable" }, { v: "false", l: "Disable" }]))));
        box.appendChild(h("div", { class: "dim" }, "Locks part of the game: the pause menu, its Save or Formation option, or random encounters. Remembered in the save file."));
        return () => { c.kind = w.kind; c.enabled = w.enabled === "true"; };
      } },
    { t: "followers", label: "Change Followers", make: () => ({ t: "followers", show: true }),
      form(c: any, box: any) {
        const w = { show: String(c.show !== false) };
        box.appendChild(field("Follower trail", sel(w, "show", [{ v: "true", l: "Show" }, { v: "false", l: "Hide" }])));
        box.appendChild(h("div", { class: "dim" }, "Hides or shows the party members that trail behind the leader (needs Followers turned on in Database ▸ System)."));
        return () => { c.show = w.show === "true"; };
      } },
    { t: "windowTone", label: "Change Window Color", make: () => ({ t: "windowTone", tone: [18, 24, 46] }),
      form(c: any, box: any) {
        const tone = Array.isArray(c.tone) ? c.tone.slice() : [18, 24, 46];
        const toHex = (n: number) => ("0" + Math.max(0, Math.min(255, Math.round(n || 0))).toString(16)).slice(-2);
        const w = { hex: "#" + toHex(tone[0]) + toHex(tone[1]) + toHex(tone[2]) };
        const colorIn = h("input", { type: "color", value: w.hex, oninput(e: any) { w.hex = e.target.value; } });
        box.appendChild(row(field("Window color", colorIn)));
        box.appendChild(h("div", { class: "dim" }, "Recolors the message and menu windows for the rest of the game (saved with your game)."));
        return () => {
          const m = /^#?([0-9a-f]{6})$/i.exec(w.hex || "");
          const hx = m ? m[1] : "12182e";
          c.tone = [parseInt(hx.slice(0, 2), 16), parseInt(hx.slice(2, 4), 16), parseInt(hx.slice(4, 6), 16)];
        };
      } },
    { t: "getLocationInfo", label: "Get Location Info", make: () => ({ t: "getLocationInfo", varId: 1, infoType: "region", x: 0, y: 0 }),
      form(c: any, box: any) {
        const w = { varId: c.varId || 1, infoType: c.infoType || "region", x: c.x || 0, y: c.y || 0 };
        box.appendChild(row(field("Store in Variable", sel(w, "varId", varOpts())),
          field("Read", sel(w, "infoType", [{ v: "region", l: "Region id" }, { v: "eventId", l: "Event id" }, { v: "tileId", l: "Tile id" }, { v: "terrain", l: "Terrain tag" }]))));
        box.appendChild(row(field("Tile X", nIn(w, "x", 0, 500)), field("Tile Y", nIn(w, "y", 0, 500))));
        box.appendChild(h("div", { class: "dim" }, "Reads info about a map tile into a variable. (Atlas has no terrain tags, so Terrain tag reads 0.)"));
        return () => { c.varId = Number(w.varId); c.infoType = w.infoType; c.x = Number(w.x); c.y = Number(w.y); };
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
    // MZ/MV import placeholder (Project Compass M1·C). Not offered in the Add
    // Command picker (`hidden`), but editable-without-crashing when an imported
    // event contains one; a no-op in the engine. See docs/mig-1-spec.md.
    { t: "mzTodo", label: "Imported (coming in a later update)", hidden: true,
      make: () => ({ t: "mzTodo", code: 0, params: [], label: "" }),
      form(c: any, box: any) {
        box.appendChild(h("div", { class: "dim" },
          "📌 " + (c.label || "An imported RPG Maker command.")));
        box.appendChild(h("div", { class: "dim" },
          "This came from an RPG Maker import and isn't available in Atlas yet. It's kept safe here and will start working after a future update — you don't need to do anything. Re-importing the project once that update ships turns it on automatically."));
        return () => {};
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
      return (CMD_DEFS.filter((def) => !def.hidden).map((def) => ({ kind: "builtin", def })) as any[])
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
