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
              else if (c.t === "if" && c.cond && c.cond.kind === "switch" && c.cond.id === idQ) hit = "Conditional Branch";
            });
          } else {
            if (pg.cond.varId === idQ) hit = "page condition (variable ≥)";
            walkCommands(pg.commands, (c: any) => {
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
