/* RPGAtlas — src/editor/advanced/adv-objects.ts
   The Advanced Map Editor's Objects palette + per-kind zone inspectors (Phase 8
   Stage D, mockup 3). The right-rail "Objects" tab: a kind picker for the next
   drawn zone, the zone drawing tool strip, the list of the map's zones, and a
   contextual inspector for the selected zone (encounter pool + "Test Encounter
   in This Area", transfer destination via the location picker, sound key +
   falloff, weather kind + power, custom typed props). Light in the Objects
   palette edits the map's existing lights, not a zone kind.

   Every property edit goes through pushUndo()/touch(); the drawing tools live
   in adv-zone-draw.ts. Copyright (C) 2026 RPGAtlas contributors — GPL-3.0. */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { RA, editorState as S, curMap, t } from "../editor-state";
import { h } from "../dom";
import { touch } from "../persistence";
import { pushUndo } from "../map-editor/history";
import { runAct } from "../workspace";
import { openLocationPicker } from "../event-editor/location-picker";
import type { MapZone } from "../../shared/schema";
import { advState, advHooks, type ZoneTool } from "./adv-state";
import { ZONE_KINDS, findZone, deleteZone, patchZone, moveZone, type ZoneKind } from "./adv-zones";

const PLAYTEST_START_KEY = "rpgatlas_playtest_start";

// kind → a short human label + the drawing hint shown under the picker.
const KIND_LABEL: Record<ZoneKind, string> = {
  encounter: "Encounter", transfer: "Transfer", sound: "Sound", weather: "Weather",
  spawn: "Spawn Point", collision: "Collision", nav: "Navigation", custom: "Custom",
};

function commit(label: string, fn: () => void) {
  pushUndo(label);
  fn();
  touch();
  advHooks.render();
  advHooks.rebuildObjects();
}

function zoneLabel(z: MapZone): string {
  const kind = t(KIND_LABEL[z.kind] || z.kind);
  return z.name ? kind + " · " + z.name : kind + " #" + z.id;
}

// ---- kind picker + tool strip ----
function kindPicker(): HTMLElement {
  const wrap = h("div", { class: "adv-obj-kinds" });
  for (const k of ZONE_KINDS) {
    const b = h("button", {
      class: "adv-mini-btn" + (advState.activeKind === k ? " sel" : ""),
      title: t(KIND_LABEL[k]),
      onclick() { advState.activeKind = k; advHooks.rebuildObjects(); },
    }, t(KIND_LABEL[k])) as HTMLElement;
    wrap.appendChild(b);
  }
  return wrap as HTMLElement;
}

function toolStrip(): HTMLElement {
  const tools: [ZoneTool, string, string][] = [
    ["select", "➤", t("Select / Edit")], ["rect", "▭", t("Rectangle Zone")],
    ["ellipse", "◯", t("Ellipse Zone")], ["poly", "⬡", t("Polygon Zone")],
    ["point", "•", t("Point Zone")],
  ];
  return h("div", { class: "adv-obj-tools" },
    ...tools.map(([id, icon, title]) =>
      h("button", {
        class: "adv-mini-btn" + (advState.zoneTool === id ? " sel" : ""),
        title, onclick() { advState.zoneTool = id; advHooks.rebuildObjects(); },
      }, icon)),
  ) as HTMLElement;
}

// ---- zone list ----
function zoneRow(m: any, z: MapZone): HTMLElement {
  return h("div", {
    class: "adv-zone-row" + (z.id === advState.selectedZoneId ? " sel" : ""),
    onclick() { advState.selectedZoneId = z.id; advHooks.rebuildObjects(); advHooks.render(); },
  },
    h("span", { class: "adv-zone-swatch adv-zone-" + z.kind }),
    h("span", { class: "adv-zone-name" }, zoneLabel(z)),
    h("button", { class: "adv-zone-btn", title: t("Move Up"), onclick(e: any) { e.stopPropagation(); commit("Reorder zone", () => moveZone(m, z.id, 1)); } }, "▲"),
    h("button", { class: "adv-zone-btn", title: t("Move Down"), onclick(e: any) { e.stopPropagation(); commit("Reorder zone", () => moveZone(m, z.id, -1)); } }, "▼"),
    h("button", { class: "adv-zone-btn", title: t("Delete Zone"), onclick(e: any) {
      e.stopPropagation();
      commit("Delete zone", () => { deleteZone(m, z.id); if (advState.selectedZoneId === z.id) advState.selectedZoneId = null; });
    } }, "✕"),
  ) as HTMLElement;
}

// ---- inspectors ----
function labeled(label: string, control: HTMLElement | HTMLElement[]): HTMLElement {
  return h("label", { class: "adv-prop-row" },
    h("span", { class: "adv-prop-label" }, t(label)),
    ...(Array.isArray(control) ? control : [control])) as HTMLElement;
}

function nameField(m: any, z: MapZone): HTMLElement {
  const inp = h("input", {
    type: "text", value: z.name || "", placeholder: t("Zone name"),
    class: "adv-prop-input", spellcheck: "false",
    onchange(e: any) { commit("Rename zone", () => patchZone(m, z.id, { name: e.target.value.trim() || undefined })); },
  }) as HTMLInputElement;
  return labeled("Name", inp);
}

function troopChecklist(m: any, z: MapZone): HTMLElement {
  const list = h("div", { class: "adv-troop-list" });
  const cur = new Set(z.encounter?.troops || []);
  for (const tp of S.proj.troops || []) {
    const cb = h("input", {
      type: "checkbox", ...(cur.has(tp.id) ? { checked: "" } : {}),
      onchange(e: any) {
        commit("Edit zone", () => {
          const enc = z.encounter || (z.encounter = { troops: [], rate: 30 });
          const s = new Set(enc.troops);
          if (e.target.checked) s.add(tp.id); else s.delete(tp.id);
          enc.troops = [...s].sort((a, b) => a - b);
        });
      },
    });
    list.appendChild(h("label", { class: "adv-troop-item" }, cb, h("span", null, tp.id + ": " + tp.name)));
  }
  if (!(S.proj.troops || []).length) list.appendChild(h("div", { class: "dim" }, t("No troops in this project yet.")));
  return list as HTMLElement;
}

function encounterInspector(m: any, z: MapZone): HTMLElement[] {
  const enc = z.encounter || (z.encounter = { troops: [], rate: 30 });
  const rate = h("input", {
    type: "number", min: "1", value: String(enc.rate ?? 30), class: "adv-prop-input adv-prop-num",
    onchange(e: any) { commit("Edit zone", () => { enc.rate = Math.max(1, Number(e.target.value) || 30); }); },
  }) as HTMLInputElement;
  const test = h("button", {
    class: "adv-obj-testbtn",
    title: t("Save and playtest here, forcing an encounter inside this zone"),
    onclick() { testEncounterHere(m, z); },
  }, "▶ " + t("Test Encounter in This Area")) as HTMLElement;
  return [
    h("div", { class: "adv-prop-note dim" }, t("While the player stands inside, this pool replaces the map's encounters for the roll.")) as HTMLElement,
    labeled("Encounter rate", rate),
    h("div", { class: "adv-prop-head" }, t("Troops")) as HTMLElement,
    troopChecklist(m, z),
    test,
  ];
}

function transferInspector(m: any, z: MapZone): HTMLElement[] {
  const tr = z.transfer || (z.transfer = { mapId: 0, x: 0, y: 0 });
  const info = h("span", { class: "adv-prop-dest" }) as HTMLElement;
  const refresh = () => {
    const dm = RA.byId(S.proj.maps, tr.mapId);
    info.textContent = dm ? dm.name + " (" + tr.x + ", " + tr.y + ")" : t("(pick a destination)");
  };
  refresh();
  const pick = h("button", {
    class: "adv-mini-btn", title: t("Pick Destination"),
    onclick() {
      openLocationPicker(tr.mapId || S.proj.maps[0].id, tr.x, tr.y, (dest: any) => {
        commit("Edit zone", () => { tr.mapId = dest.mapId; tr.x = dest.x; tr.y = dest.y; });
        refresh();
      });
    },
  }, "📍") as HTMLElement;
  const dirOpts: [string, string][] = [["", t("Keep facing")], ["0", t("Down")], ["1", t("Left")], ["2", t("Right")], ["3", t("Up")]];
  const dirSel = h("select", { class: "adv-prop-select",
    onchange(e: any) { const raw = e.target.value; commit("Edit zone", () => { tr.dir = raw === "" ? undefined : (Number(raw) as 0 | 1 | 2 | 3); }); } },
    ...dirOpts.map(([v, l]) => h("option", { value: v, selected: (tr.dir == null ? "" : String(tr.dir)) === v ? "selected" : null }, l)),
  ) as HTMLSelectElement;
  return [
    h("div", { class: "adv-prop-note dim" }, t("Fires once when the player enters, like a transfer event.")) as HTMLElement,
    labeled("Destination", [info, pick]),
    labeled("Facing", dirSel),
  ];
}

function soundInspector(m: any, z: MapZone): HTMLElement[] {
  const sd = z.sound || (z.sound = { key: "", vol: 1, falloff: "none" });
  const key = h("input", {
    type: "text", value: sd.key || "", placeholder: "asset:audio/…", class: "adv-prop-input", spellcheck: "false",
    onchange(e: any) { commit("Edit zone", () => { sd.key = e.target.value.trim(); }); },
  }) as HTMLInputElement;
  const vol = h("input", {
    type: "range", min: "0", max: "100", value: String(Math.round((sd.vol == null ? 1 : sd.vol) * 100)), class: "adv-prop-range",
    oninput(e: any) { sd.vol = Number(e.target.value) / 100; touch(); },
    onchange() { commit("Edit zone", () => {}); },
  }) as HTMLInputElement;
  const falloff = h("select", { class: "adv-prop-select",
    onchange(e: any) { commit("Edit zone", () => { sd.falloff = e.target.value; }); } },
    h("option", { value: "none", selected: (sd.falloff || "none") === "none" ? "selected" : null }, t("None")),
    h("option", { value: "linear", selected: sd.falloff === "linear" ? "selected" : null }, t("Linear (by distance)")),
  ) as HTMLSelectElement;
  return [
    h("div", { class: "adv-prop-note dim" }, t("Loops an imported ambience while the player is inside.")) as HTMLElement,
    labeled("Audio key", key),
    labeled("Volume", vol),
    labeled("Falloff", falloff),
  ];
}

function weatherInspector(m: any, z: MapZone): HTMLElement[] {
  const wd = z.weather || (z.weather = { kind: "rain", power: 5 });
  const kind = h("select", { class: "adv-prop-select",
    onchange(e: any) { commit("Edit zone", () => { wd.kind = e.target.value; }); } },
    ...["none", "rain", "storm", "snow", "fog"].map((k) => h("option", { value: k, selected: wd.kind === k ? "selected" : null }, k)),
  ) as HTMLSelectElement;
  const power = h("input", {
    type: "range", min: "1", max: "9", value: String(wd.power ?? 5), class: "adv-prop-range",
    oninput(e: any) { wd.power = Number(e.target.value); touch(); },
    onchange() { commit("Edit zone", () => {}); },
  }) as HTMLInputElement;
  return [
    h("div", { class: "adv-prop-note dim" }, t("Applies while inside; the map's weather is restored on exit.")) as HTMLElement,
    labeled("Weather", kind),
    labeled("Power", power),
  ];
}

function customInspector(m: any, z: MapZone): HTMLElement[] {
  const props = z.props || (z.props = {});
  const list = h("div", { class: "adv-prop-props" });
  const rebuild = () => {
    list.innerHTML = "";
    for (const [k, v] of Object.entries(props)) {
      list.appendChild(h("div", { class: "adv-prop-kv" },
        h("span", { class: "adv-prop-key" }, k),
        h("input", { class: "adv-prop-input", value: String(v), spellcheck: "false",
          onchange(e: any) { commit("Edit zone", () => { (props as any)[k] = coerce(e.target.value); }); } }),
        h("button", { class: "adv-zone-btn", title: t("Delete"), onclick() { commit("Edit zone", () => { delete (props as any)[k]; }); rebuild(); } }, "✕"),
      ));
    }
  };
  rebuild();
  const nk = h("input", { class: "adv-prop-input", placeholder: t("key"), spellcheck: "false" }) as HTMLInputElement;
  const nv = h("input", { class: "adv-prop-input", placeholder: t("value"), spellcheck: "false" }) as HTMLInputElement;
  const add = h("button", { class: "adv-mini-btn", onclick() {
    const k = nk.value.trim(); if (!k) return;
    commit("Edit zone", () => { (props as any)[k] = coerce(nv.value); });
    nk.value = ""; nv.value = ""; rebuild();
  } }, "＋");
  return [
    h("div", { class: "adv-prop-note dim" }, t("Inert to the engine; read by plugins/Script via atlas.zonesAt.")) as HTMLElement,
    list as HTMLElement,
    h("div", { class: "adv-prop-kv" }, nk, nv, add) as HTMLElement,
  ];
}

function coerce(raw: string): string | number | boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw.trim() !== "" && !isNaN(Number(raw))) return Number(raw);
  return raw;
}

function inspector(m: any, z: MapZone): HTMLElement {
  const kindSel = h("select", { class: "adv-prop-select",
    onchange(e: any) { commit("Change zone kind", () => patchZone(m, z.id, { kind: e.target.value })); } },
    ...ZONE_KINDS.map((k) => h("option", { value: k, selected: z.kind === k ? "selected" : null }, t(KIND_LABEL[k]))),
  ) as HTMLSelectElement;

  const rows: HTMLElement[] = [
    h("div", { class: "adv-prop-head" }, zoneLabel(z)) as HTMLElement,
    labeled("Kind", kindSel),
    nameField(m, z),
  ];
  let body: HTMLElement[] = [];
  if (z.kind === "encounter") body = encounterInspector(m, z);
  else if (z.kind === "transfer") body = transferInspector(m, z);
  else if (z.kind === "sound") body = soundInspector(m, z);
  else if (z.kind === "weather") body = weatherInspector(m, z);
  else if (z.kind === "custom") body = customInspector(m, z);
  else if (z.kind === "spawn") body = [h("div", { class: "adv-prop-note dim" }, t("A named point resolved at edit time — the transfer location picker offers it. No runtime cost.")) as HTMLElement];
  else if (z.kind === "collision") body = [h("div", { class: "adv-prop-note dim" }, t("Rasterized at map load into the pass grid — force-blocks these tiles.")) as HTMLElement];
  else if (z.kind === "nav") body = [h("div", { class: "adv-prop-note dim" }, t("Rasterized at map load into the pass grid — force-passes these tiles.")) as HTMLElement];
  return h("div", { class: "adv-zone-inspector" }, ...rows, ...body) as HTMLElement;
}

// ---- Test Encounter in This Area ----
function testEncounterHere(m: any, z: MapZone): void {
  // A start tile inside the zone's bounding box (its top-left vertex + a nudge).
  let sx = 0, sy = 0;
  const sh = z.shape;
  if (sh.type === "rect") { sx = Math.floor(sh.x + sh.w / 2); sy = Math.floor(sh.y + sh.h / 2); }
  else if (sh.type === "ellipse") { sx = Math.floor(sh.cx); sy = Math.floor(sh.cy); }
  else if (sh.type === "point") { sx = sh.x; sy = sh.y; }
  else if (sh.type === "poly" && sh.pts.length) { sx = Math.floor(sh.pts[0].x); sy = Math.floor(sh.pts[0].y); }
  sx = Math.max(0, Math.min(m.width - 1, sx));
  sy = Math.max(0, Math.min(m.height - 1, sy));
  try {
    localStorage.setItem(PLAYTEST_START_KEY, JSON.stringify({ mapId: m.id, x: sx, y: sy, forceEncounter: true, ts: Date.now() }));
  } catch { /* quota — the playtest just starts normally */ }
  // Reuse the standard playtest launcher (the "play" action saves + opens the
  // window; boot consumes the handoff above and arms the forced roll).
  runAct("play");
}

/** Render the whole Objects panel into `el` (kind picker, tools, zone list,
 *  selected-zone inspector). */
export function renderObjectsPanel(el: HTMLElement) {
  el.innerHTML = "";
  const m = curMap();
  if (!m) return;
  el.appendChild(h("div", { class: "adv-section-head" }, h("span", null, t("New zone kind"))));
  el.appendChild(kindPicker());
  el.appendChild(toolStrip());
  el.appendChild(h("div", { class: "adv-obj-hint dim" }, t("Draw on the canvas to add a zone. Double-click finishes a polygon.")));
  const zones = (m.zones as MapZone[]) || [];
  const listHead = h("div", { class: "adv-section-head" }, h("span", null, t("Zones") + (zones.length ? " (" + zones.length + ")" : "")));
  el.appendChild(listHead);
  const list = h("div", { class: "adv-zone-list" });
  for (let i = zones.length - 1; i >= 0; i--) list.appendChild(zoneRow(m, zones[i]));
  if (!zones.length) list.appendChild(h("div", { class: "adv-obj-hint dim" }, t("No zones yet.")));
  el.appendChild(list);
  if (advState.selectedZoneId != null) {
    const z = findZone(m, advState.selectedZoneId);
    if (z) el.appendChild(inspector(m, z));
  }
}
