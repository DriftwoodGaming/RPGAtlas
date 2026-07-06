/* RPGAtlas — src/editor/importers/mz/slug.ts
   Project Compass M1·A: stable string-key synthesis for the type lists that
   Atlas keys by string (elements, skillTypes — matrix §1) and the MZ param
   index → Atlas param key table (matrix §5; `luk` converts for real since
   post-1.1 retired locked skip D7 — Atlas grew a Luck param).
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

import type { KeyedType } from "../../../shared/schema";

/** Slugify a display name into a lowercase key. Empty/whitespace → "". */
export function slugKey(name: string): string {
  return String(name == null ? "" : name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Result of synthesizing keyed types from an MZ index-keyed name list:
 *  `types` (the KeyedType[] for SystemTypes, index-0 placeholder excluded) and
 *  `keyByIndex` (the id → key map traits/skills use to remap element/type ids;
 *  index 0 = "" = none). Collisions are disambiguated with a numeric suffix. */
export interface SynthTypes {
  types: KeyedType[];
  keyByIndex: string[];
}

/** MZ elements/skillTypes are `["", "Fire", "Ice", …]` (index 0 placeholder).
 *  Synthesize a `{key,name}` list with slug keys, keeping the index→key map so
 *  a trait/skill that references an element/type *index* can be remapped. */
export function synthKeyedTypes(names: (string | null | undefined)[] | undefined): SynthTypes {
  const list = Array.isArray(names) ? names : [];
  const types: KeyedType[] = [];
  const keyByIndex: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const name = String(list[i] == null ? "" : list[i]);
    if (i === 0 || name.trim() === "") {
      // Index 0 is the "(none)" placeholder in every RM type list.
      keyByIndex[i] = "";
      continue;
    }
    let key = slugKey(name) || "type-" + i;
    if (seen.has(key)) {
      let n = 2;
      while (seen.has(key + "-" + n)) n++;
      key = key + "-" + n;
    }
    seen.add(key);
    keyByIndex[i] = key;
    types.push({ key, name });
  }
  return { types, keyByIndex };
}

/** MZ params are `[mhp,mmp,atk,def,mat,mdf,agi,luk]` (0–7) and every index
 *  now has an Atlas home (`luk` joined post-1.1, retiring locked skip D7). */
export const PARAM_KEYS: (keyof import("../../../shared/schema").Params | null)[] = [
  "mhp",
  "mmp",
  "atk",
  "def",
  "mat",
  "mdf",
  "agi",
  "luk",
];

/** Atlas param key for an MZ param index, or null when out of range. */
export function paramKey(index: number): keyof import("../../../shared/schema").Params | null {
  return PARAM_KEYS[index] ?? null;
}
