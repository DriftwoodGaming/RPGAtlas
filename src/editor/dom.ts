/* RPGAtlas — src/editor/dom.ts
   Tiny DOM builder: h(), bound inputs, option-list helpers.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 1):
   logic unchanged, closure vars already routed through editor-state.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, RA, Sfx, t, editorState as S } from "./editor-state";
import { touch } from "./persistence";
import { libraryMetas } from "../shared/asset-library";

export const $ = (id: any): any => document.getElementById(id);

  // ============================ tiny DOM builder ============================
  export function h(tag: any, attrs?: any, ...kids: any[]): any {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (k === "html") e.innerHTML = v;
      else e.setAttribute(k, v);
    }
    for (const k of kids) {
      if (k == null) continue;
      e.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
    }
    return e;
  }
  export function esc(s: any) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // bound inputs ---------------------------------------------------------
  export function tIn(obj: any, key: any, cls?: any) {
    return h("input", { type: "text", value: obj[key] == null ? "" : obj[key], class: cls || "",
      oninput(e: any) { obj[key] = e.target.value; touch(); } });
  }
  export function nIn(obj: any, key: any, min?: any, max?: any, step?: any) {
    return h("input", { type: "number", value: obj[key] == null ? 0 : obj[key],
      min: min == null ? -99999 : min, max: max == null ? 99999 : max, step: step || 1,
      oninput(e: any) { obj[key] = Number(e.target.value) || 0; touch(); } });
  }
  export function sel(obj: any, key: any, options: any, onchange?: any): any {
    const s = h("select", {
      onchange(e: any) {
        const raw = e.target.value;
        obj[key] = isNaN(Number(raw)) || raw === "" || options.stringValues ? raw : Number(raw);
        touch();
        if (onchange) onchange(obj[key]);
      },
    });
    for (const o of options) s.appendChild(h("option", { value: o.v }, o.l));
    s.value = String(obj[key] == null ? "" : obj[key]);
    return s;
  }
  export function chk(obj: any, key: any) {
    return h("input", { type: "checkbox", onchange(e: any) { obj[key] = e.target.checked; touch(); } , ...(obj[key] ? { checked: "" } : {}) });
  }
  export function rangeIn(obj: any, key: any, min: any, max: any, suffix?: any) {
    const out = h("span", { class: "range-val" }, String(obj[key] == null ? min : obj[key]) + (suffix || ""));
    const r = h("input", { type: "range", min, max, value: obj[key] == null ? min : obj[key],
      oninput(e: any) { obj[key] = Number(e.target.value); out.textContent = e.target.value + (suffix || ""); touch(); } });
    return h("span", { class: "rangewrap" }, r, out);
  }
  export function field(label: any, input: any) {
    return h("label", { class: "fld" }, h("span", null, t(label)), input);
  }
  export function row(...kids: any[]) { return h("div", { class: "frow" }, ...kids); }

  // option helpers -------------------------------------------------------
  export function dbOpts(arr: any, noneLabel?: any) {
    const o = arr.map((e: any) => ({
      v: e.id,
      l: e.id + ": " + (e.icon == null ? "" : "Icon " + String(e.icon).padStart(2, "0") + " · ") + e.name,
    }));
    if (noneLabel != null) o.unshift({ v: 0, l: noneLabel });
    return o;
  }
  export function switchOpts() {
    return [{ v: 0, l: "(none)" }].concat(S.proj.system.switches.map((n: any, i: any) => ({ v: i + 1, l: (i + 1) + ": " + (n || "—") })));
  }
  export function varOpts() {
    return [{ v: 0, l: "(none)" }].concat(S.proj.system.variables.map((n: any, i: any) => ({ v: i + 1, l: (i + 1) + ": " + (n || "—") })));
  }
  export function cmpOpts() {
    return [{ v: ">=", l: "≥" }, { v: "==", l: "=" }, { v: "<=", l: "≤" }, {v: "<", l: "<"}, {v: ">", l: ">"}, {v: "!=", l: "≠"}];
  }
  export function charsetOpts(humansOnly?: any) {
    const o: any = [{ v: "", l: "(none)" }];
    Assets.charsets.forEach((c: any) => {
      if (humansOnly && c.kind !== "human") return;
      o.push({ v: c.key, l: c.name });
    });
    o.stringValues = true;
    return o;
  }
  export const DIR_OPTS = [{ v: 0, l: "Down" }, { v: 1, l: "Left" }, { v: 2, l: "Right" }, { v: 3, l: "Up" }];
  export const SE_NAMES = ["cursor", "ok", "cancel", "buzzer", "hit", "crit", "magic", "heal", "item", "chest", "door", "levelup", "save", "escape", "miss", "encounter", "gameover"];
  // Imported library audio (Phase 6) joins the pickers behind the procedural
  // entries: bgm-kind assets in music selects, se/me-kind in SE selects,
  // bgs-kind (and bgm) in ambience-layer rows.
  const audioAssetOpts = (kinds: string[]) =>
    libraryMetas()
      .filter((m: any) => m.type === "audio" && kinds.includes(m.kind || "se"))
      .map((m: any) => ({ v: m.key, l: "♪ " + m.name }));
  export const MUSIC_OPTS = () =>
    [{ v: "none", l: "(none)" }]
      .concat(Sfx.THEMES.map((t: any) => ({ v: t, l: t })))
      .concat(audioAssetOpts(["bgm"]));
  export const SE_OPTS = () => {
    const o: any = SE_NAMES.map((n) => ({ v: n, l: n })).concat(audioAssetOpts(["se", "me"]));
    o.stringValues = true;
    return o;
  };
  export const BGS_OPTS = () => {
    const o: any = audioAssetOpts(["bgs", "bgm"]);
    o.stringValues = true;
    return o;
  };

  // Type-list options (sourced from Database ▸ Types) ---------------------
  export function elementSelOpts() {
    const o = RA.typeList(S.proj, "elements").map((e: any) => ({ v: e.key, l: e.name }));
    o.stringValues = true;
    return o;
  }
  export function skillTypeSelOpts() {
    const st = RA.typeList(S.proj, "skillTypes");
    const base = [{ v: "phys", l: "Physical" }, { v: "magic", l: "Magical" }, { v: "heal", l: "Heal" }];
    return base.map((b) => { const f = st.find((s: any) => s.key === b.v); return { v: b.v, l: f ? f.name : b.l }; });
  }
  export function typeSelOpts(kind: any, noneLabel?: any) {
    const o = RA.typeList(S.proj, kind).map((t: any) => ({ v: t.id, l: t.name }));
    if (noneLabel != null) o.unshift({ v: 0, l: noneLabel });
    return o;
  }
  export function stringSelOpts(values: any) {
    const o = values.map((v: any) => ({ v, l: v }));
    o.stringValues = true;
    return o;
  }

