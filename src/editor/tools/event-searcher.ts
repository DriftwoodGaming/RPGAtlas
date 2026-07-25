/* RPGAtlas — src/editor/tools/event-searcher.ts
   The Event Searcher modal: find message text, event names, or switch/variable
   usage across every map; clicking a result jumps to and opens that event.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 3):
   logic unchanged, closure vars routed through editor-state.ts. setMode and
   refreshToolbar are imported directly from workspace.ts (function-only import
   cycle — workspace binds openEventSearcher to an action; both are called only
   on user interaction, so evaluation order is irrelevant).
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { TILE, editorState as S } from "../editor-state";
import { $, h, field } from "../dom";
import { modal } from "../modals";
import { renderMap } from "../map-editor/map-render";
import { rebuildMapList } from "../map-editor/map-list";
import { walkCommands } from "../event-editor/command-list";
import { openEventEditor } from "../event-editor/event-editor";
import { setMode, refreshToolbar } from "../workspace";
import { openDialogueWorkspace } from "./dialogue-workspace";

/** Does this condition use switch/variable `id` anywhere inside it? A gate
 *  can now be an ALL/ANY group of conditions, so a flat `cond.kind === …`
 *  check would quietly miss every switch an author combined with another. */
function condUses(cond: any, kind: string, id: number, depth = 0): boolean {
  if (!cond || depth >= 16) return false;
  if (cond.kind === "all" || cond.kind === "any") {
    return (cond.conds || []).some((sub: any) => condUses(sub, kind, id, depth + 1));
  }
  if (cond.kind !== kind) return false;
  // A variable condition can also compare AGAINST a variable (valVarId).
  return cond.id === id || (kind === "var" && Number(cond.valVarId) === id);
}

export function openEventSearcher() {
  const results = h("div", { class: "search-results" });
  const input = h("input", { type: "text", placeholder: "Search…", onkeydown(e: any) { if (e.key === "Enter") run(); } });
  const kindSel = h("select", null,
    h("option", { value: "text" }, "Message text"),
    h("option", { value: "name" }, "Event name"),
    h("option", { value: "switch" }, "Switch ID"),
    h("option", { value: "var" }, "Variable ID"),
  );
  let dlg: any = null;
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
    const matches: any[] = [];
    for (const dialogue of S.proj.dialogues || []) {
      for (const node of dialogue.nodes || []) {
        let hit: any = null;
        // A hub has no options of its own — its player-facing lines are the
        // dialogue's topics, so they are searched alongside the node.
        const topics = node.kind === "hub" ? (dialogue.topics || []) : [];
        if (kind === "text") {
          const optionText = (node.options || []).map((option: any) => option.text).join(" ");
          const topicText = topics.map((topic: any) => topic.text).join(" ");
          if (((node.text || "") + " " + optionText + " " + topicText).toLowerCase().includes(ql)) {
            hit = "Dialogue node: “" + String(node.text || optionText || topicText).split("\n")[0].slice(0, 50) + "”";
          }
        } else if (kind === "switch" || kind === "var") {
          if (condUses(node.condition, kind, idQ)) hit = "Dialogue node condition";
          // Per-option and per-topic guards are conditions too.
          if (!hit && (node.options || []).some((option: any) => condUses(option.condition, kind, idQ))) hit = "Dialogue choice condition";
          if (!hit && topics.some((topic: any) => condUses(topic.condition, kind, idQ))) hit = "Dialogue topic condition";
          walkCommands(node.commands, (c: any) => {
            if (!hit && c.t === kind && c.id === idQ) hit = "Dialogue cutscene command";
            else if (!hit && c.t === "if" && condUses(c.cond, kind, idQ)) hit = "Dialogue cutscene branch";
            else if (!hit && c.t === "choices" && (c.conditions || []).some((k: any) => condUses(k, kind, idQ))) hit = "Dialogue cutscene choice condition";
          });
        }
        if (hit != null) matches.push({ dialogue, node, hit });
      }
    }
    for (const m of S.proj.maps) {
      for (const ev of m.events) {
        ev.pages.forEach((pg: any, pi: any) => {
          let hit: any = null;
          if (kind === "name") {
            if (pi === 0 && (ev.name || "").toLowerCase().includes(ql)) hit = ev.name;
          } else if (kind === "text") {
            walkCommands(pg.commands, (c: any) => {
              if (hit) return;
              if (c.t === "text" && ((c.text || "") + " " + (c.name || "")).toLowerCase().includes(ql)) hit = "“" + c.text.split("\n")[0].slice(0, 50) + "”";
              else if (c.t === "choices" && c.options.some((o: any) => o.toLowerCase().includes(ql))) hit = "Choices: " + c.options.join(" / ");
            });
          } else if (kind === "switch") {
            if (pg.cond.switchId === idQ) hit = "page condition (switch ON)";
            walkCommands(pg.commands, (c: any) => {
              if (hit) return;
              if (c.t === "switch" && c.id === idQ) hit = "Control Switch command";
              else if (c.t === "if" && condUses(c.cond, "switch", idQ)) hit = "Conditional Branch";
              else if (c.t === "choices" && (c.conditions || []).some((k: any) => condUses(k, "switch", idQ))) hit = "Show Choices condition";
            });
          } else {
            if (pg.cond.varId === idQ) hit = "page condition (variable ≥)";
            walkCommands(pg.commands, (c: any) => {
              if (hit) return;
              if (c.t === "var" && c.id === idQ) hit = "Control Variable command";
              else if (c.t === "if" && condUses(c.cond, "var", idQ)) hit = "Conditional Branch";
              else if (c.t === "choices" && (c.conditions || []).some((k: any) => condUses(k, "var", idQ))) hit = "Show Choices condition";
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
        if (r.dialogue) {
          openDialogueWorkspace(r.dialogue.id, r.node.id);
          return;
        }
        S.curMapId = r.m.id;
        setMode("event");
        S.selectedEvent = r.ev;
        rebuildMapList(); renderMap(); refreshToolbar();
        const sc = $("mapscroll");
        sc.scrollLeft = r.ev.x * TILE * S.zoom - sc.clientWidth / 2;
        sc.scrollTop = r.ev.y * TILE * S.zoom - sc.clientHeight / 2;
        openEventEditor(r.ev);
      } },
        h("b", null, r.dialogue ? "Dialogue — " + r.dialogue.name : r.m.name + " — " + r.ev.name),
        r.dialogue ? " node " + r.node.id : " (" + r.ev.x + "," + r.ev.y + ") page " + (r.pi + 1),
        h("span", { class: "dim" }, r.hit)));
    }
  }
  const bar = h("div", { class: "search-bar" },
    field("Find", input), field("In", kindSel),
    h("button", { class: "primary", onclick: run }, "Search"));
  dlg = modal({ title: "Event Searcher", wide: true, content: h("div", null, bar, results) });
  setTimeout(() => input.focus(), 50);
}
