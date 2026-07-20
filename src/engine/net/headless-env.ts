/* RPGAtlas — src/engine/net/headless-env.ts
   Project Beacon MP8·B (item 1, D-8-0): the headless bootstrap that lets the
   engine's interpreter slice run SERVER-SIDE.

   The engine reads its classic-script globals through src/shared/deps.ts, which
   does `const RPGAtlasDeps = window.RPGAtlasDeps` at module-eval — on a browser
   the play.html bundle loads js/data.js + js/assets.js first and populates it.
   A Beacon zone worker has no DOM and no classic scripts, so this module stands
   up the SAME window shape BEFORE deps.ts can evaluate. It is a pure side-effect
   module with NO imports, so it is guaranteed (ESM order) to run before any
   engine module that imports deps.ts — the zone event runtime imports it FIRST.

   What the server needs is small and DOM-free: the event interpreter reads
   `RA.byId` (common events / dialogues / records), the day/night + trait math
   helpers, and `commonEventEnabled`; it never renders. So the RA here is a
   faithful HEADLESS re-implementation of exactly those helpers (identical
   semantics to js/data.js — the same source this project ships), and Assets /
   Music / Sfx are inert stubs (a server plays no audio, resolves no sprites).
   tests/mp-commands.test.js proves the engine slice bundles + runs against a
   stub this shape. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

// Faithful headless RA — the exact helper semantics from js/data.js the
// server-side interpreter reaches (byId + trait/element math + commonEvent
// gating + clone + a no-op migrateProject, since a project is already migrated
// by the time it is handed to a zone).
const RA: any = {
  byId(arr: any, id: any) {
    return arr ? arr.find((e: any) => e && e.id === id) || null : null;
  },
  nextId(arr: any) {
    return (arr || []).reduce((m: number, e: any) => Math.max(m, e.id), 0) + 1;
  },
  clone(o: any) {
    return JSON.parse(JSON.stringify(o));
  },
  traitsOf(cls: any, type: any, key: any) {
    return ((cls && cls.traits) || []).filter(
      (t: any) => t && t.type === type && (key == null || String(t.key) === String(key)),
    );
  },
  traitRate(cls: any, type: any, key: any, fallback: any) {
    const list = RA.traitsOf(cls, type, key);
    if (!list.length) return fallback == null ? 1 : fallback;
    return list.reduce((rate: number, t: any) => (rate * Math.max(0, Number(t.value) || 0)) / 100, 1);
  },
  traitSum(cls: any, type: any, key: any, fallback: any) {
    const list = RA.traitsOf(cls, type, key);
    if (!list.length) return fallback == null ? 0 : fallback;
    return list.reduce((sum: number, t: any) => sum + (Number(t.value) || 0), 0);
  },
  canEquip(cls: any, kind: any, itemId: any) {
    if (!itemId) return true;
    const rules = RA.traitsOf(cls, "equip", kind);
    return !rules.length || rules.some((t: any) => Number(t.value) === Number(itemId));
  },
  elementOfSkill(skill: any) {
    if (!skill || skill.type === "phys") return "physical";
    return skill.element || "physical";
  },
  commonEventEnabled(commonEvent: any, switches: any) {
    if (!commonEvent) return false;
    return !commonEvent.switchId || !!(switches && switches[commonEvent.switchId]);
  },
  // A project reaching a zone is already migrated (the directory loads game
  // JSON the editor wrote); identity keeps the shim honest and DOM-free.
  migrateProject(p: any) {
    return p;
  },
  clamp(v: number, a: number, b: number) {
    return v < a ? a : v > b ? b : v;
  },
};

// Inert asset/audio stubs — a headless server resolves no sprites and plays no
// audio, but the eval-time property reads in deps.ts must succeed.
const Assets: any = {
  TILE: 48,
  tiles: [],
  charsets: [],
  charsetIndex: () => -1,
  drawTile: () => {},
};
const noAudio: any = { play: () => {}, stop: () => {} };

const RPGAtlasDeps: any = {
  Assets,
  RA,
  Music: noAudio,
  Sfx: noAudio,
  DataDefaults: {},
};

// Idempotent + non-destructive: a real browser (or a test that already staged
// a window) keeps its own globals; a bare Node worker gets the shim.
const g = globalThis as any;
if (typeof g.window === "undefined") g.window = g;
if (!g.window.RPGAtlasDeps) g.window.RPGAtlasDeps = RPGAtlasDeps;
if (typeof g.location === "undefined") g.location = { search: "" };

export {};
