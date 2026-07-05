/* RPGAtlas — src/editor/importers/mz/convert-system.ts
   Project Compass M1·A: `System.json` → a `Partial<SystemData>` patch (matrix
   §1, decision A6). M1·D overlays this on `DataDefaults.newProject().system`, so
   only derivable fields are set — input bindings, screenScale, and the logical
   sound/music maps keep their engine defaults. `types` and `music` are complete
   replacements; scalars are set only when MZ provides them. The index→key maps
   for elements/skillTypes are returned alongside so the DB converters can remap
   trait/skill references. Copyright (C) 2026 RPGAtlas contributors —
   GPL-3.0-or-later (see LICENSE). */

import type { IdType, Params, SystemData, VehicleDef } from "../../../shared/schema";
import type { ImportReport } from "./report";
import type { RmSystem, RmVehicle } from "./raw-types";
import { slugKey, synthKeyedTypes } from "./slug";

export interface SystemConversion {
  system: Partial<SystemData>;
  /** MZ element index → Atlas element key (index 0 = ""). */
  elementKeyByIndex: string[];
  /** MZ skill-type index → Atlas skill-type key (index 0 = ""). */
  skillTypeKeyByIndex: string[];
}

function toHex2(n: number): string {
  const v = Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
  return v.toString(16).padStart(2, "0");
}

/** MZ weapon/armor/equip type list (`["", "Dagger", …]`) → Atlas `IdType[]`
 *  (index 0 placeholder dropped; id = index). */
function idTypes(names: string[] | undefined): IdType[] {
  const list = Array.isArray(names) ? names : [];
  const out: IdType[] = [];
  for (let i = 1; i < list.length; i++) {
    if (String(list[i] || "").trim() === "") continue;
    out.push({ id: i, name: String(list[i]) });
  }
  return out;
}

function vehicle(v: RmVehicle | undefined): VehicleDef | undefined {
  if (!v) return undefined;
  const charset = slugKey(v.characterName) + (v.characterIndex ? "-" + v.characterIndex : "");
  const def: VehicleDef = {
    charset: charset || "vehicle",
    mapId: v.startMapId || 1,
    x: v.startX || 0,
    y: v.startY || 0,
  };
  if (v.bgm && v.bgm.name) def.music = "asset:audio/" + v.bgm.name;
  return def;
}

export function convertSystem(sys: RmSystem, report: ImportReport): SystemConversion {
  const elements = synthKeyedTypes(sys.elements);
  const skillTypes = synthKeyedTypes(sys.skillTypes);

  const patch: Partial<SystemData> = {
    title: sys.gameTitle || "Imported Project",
    currency: sys.currencyUnit || "G",
    // RM switch/variable lists carry a leading placeholder at index 0; Atlas
    // keys by (id − 1), so drop it.
    switches: (sys.switches || []).slice(1).map((s) => String(s || "")),
    variables: (sys.variables || []).slice(1).map((s) => String(s || "")),
    party: (sys.partyMembers || []).slice(),
    startMapId: sys.startMapId || 1,
    startX: sys.startX || 0,
    startY: sys.startY || 0,
    startDir: 0, // MZ has no start facing; default down (matrix §1).
    startTransparent: !!sys.optTransparent,
    followers: !!sys.optFollowers,
    battleView: sys.optSideView ? "side" : "front",
    battleSystem: sys.battleSystem ? "atb" : "turn",
    // M3·C: imported games keep RPG Maker's battle pacing — preemptive/
    // surprise rolls on random encounters and the MZ escape ratio.
    mzBattleFlow: true,
    // M3·B: the TP gauge flag (and one of the TP-mechanics activators).
    ...(sys.optDisplayTp ? { displayTp: true } : {}),
    types: {
      elements: elements.types,
      skillTypes: skillTypes.types,
      weaponTypes: idTypes(sys.weaponTypes),
      armorTypes: idTypes(sys.armorTypes),
      equipTypes: idTypes(sys.equipTypes),
    },
  };

  // windowTone [r,g,b,gray] → base window color (gray channel dropped).
  if (Array.isArray(sys.windowTone) && sys.windowTone.length >= 3) {
    const [r, g, b, gray] = sys.windowTone;
    patch.windowColor = "#" + toHex2(r) + toHex2(g) + toHex2(b);
    if (gray) {
      report.add({
        area: "System",
        kind: "partial",
        what: "window color tint",
        detail: "the gray part of the window tint isn't used in Atlas",
      });
    }
  }

  // MZ-only advanced{} → screen / UI / font sizing.
  const adv = sys.advanced;
  if (adv) {
    if (adv.screenWidth) patch.screenWidth = adv.screenWidth;
    if (adv.screenHeight) patch.screenHeight = adv.screenHeight;
    if (adv.uiAreaWidth) patch.uiWidth = adv.uiAreaWidth;
    if (adv.uiAreaHeight) patch.uiHeight = adv.uiAreaHeight;
    if (adv.fontSize) patch.fontSize = adv.fontSize;
    if (adv.windowOpacity != null) {
      patch.windowOpacity = Math.round((adv.windowOpacity / 255) * 100);
    }
    if (adv.mainFontFilename) {
      report.add({
        area: "System",
        kind: "partial",
        what: "custom game font",
        detail: "the font file isn't imported — Atlas uses its built-in fonts",
      });
    }
  }

  // Vehicles (matrix §12a).
  const boat = vehicle(sys.boat);
  const ship = vehicle(sys.ship);
  const airship = vehicle(sys.airship);
  if (boat || ship || airship) {
    patch.vehicles = {};
    if (boat) patch.vehicles.boat = boat;
    if (ship) patch.vehicles.ship = ship;
    if (airship) patch.vehicles.airship = airship;
  }

  // Title/battle BGM → asset keys (audio files convert later); ME + SE array
  // stay on Atlas defaults with one report line each.
  const music: Record<string, string> = {};
  if (sys.titleBgm && sys.titleBgm.name) music.title = "asset:audio/" + sys.titleBgm.name;
  if (sys.battleBgm && sys.battleBgm.name) music.battle = "asset:audio/" + sys.battleBgm.name;
  if (Object.keys(music).length) patch.music = music;

  if (Array.isArray(sys.sounds) && sys.sounds.some((s) => s && s.name)) {
    report.add({
      area: "System",
      kind: "partial",
      what: "system sound effects",
      detail: "Atlas plays its own menu/battle sounds; your sound files import with your audio",
    });
  }
  if (sys.title1Name) {
    report.add({
      area: "System",
      kind: "partial",
      what: "title screen background",
      detail: "Atlas uses its own themed title screen",
    });
  }

  // MZ-only options with no Atlas home (matrix §1).
  const dropped: [unknown, string][] = [
    [sys.optAutosave, "autosave"],
    [sys.optKeyItemsNumber, "key-item counts"],
    [sys.itemCategories, "custom item menu categories"],
    [sys.menuCommands, "custom menu commands"],
    [sys.optExtraExp, "the extra-EXP option"],
  ];
  for (const [present, label] of dropped) {
    if (present != null && present !== false) {
      report.add({
        area: "System",
        kind: "skipped",
        what: label,
        detail: "Atlas doesn't have this setting; your game plays fine without it",
      });
    }
  }

  return {
    system: patch,
    elementKeyByIndex: elements.keyByIndex,
    skillTypeKeyByIndex: skillTypes.keyByIndex,
  };
}

/** MZ params array `[mhp,mmp,atk,def,mat,mdf,agi,luk]` → Atlas `Params` (7),
 *  omitting zeros and dropping `luk` (index 7 → counted via the report). Shared
 *  by weapon/armor/enemy stat conversion. */
export function paramsFromArray(arr: number[] | undefined, onLuk: () => void): Params {
  const src = Array.isArray(arr) ? arr : [];
  const keys: (keyof Params)[] = ["mhp", "mmp", "atk", "def", "mat", "mdf", "agi"];
  const out: Params = {};
  for (let i = 0; i < keys.length; i++) {
    const v = Number(src[i]) || 0;
    if (v) out[keys[i]] = v;
  }
  if (src.length > 7 && (Number(src[7]) || 0) !== 0) onLuk();
  return out;
}
