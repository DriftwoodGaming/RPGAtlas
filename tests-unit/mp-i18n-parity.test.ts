/* RPGAtlas — tests-unit/mp-i18n-parity.test.ts
   Project Beacon MP7·D: the anti-rot gate for the PLAYER-facing multiplayer
   strings (mp-i18n.ts). Mirrors the editor i18n-parity gate: every one of the
   ten locale packs must define EXACTLY the English key set (no missing key = a
   new Beacon string shipped without translations; no orphan = a renamed key left
   rotting), with placeholders preserved and no empty values. GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import { MP_EN, MP_PACKS, MP_LOCALES, mpText } from "../src/engine/mp-i18n";

const enKeys = Object.keys(MP_EN).sort();

describe("Beacon player-string localization (mp-i18n)", () => {
  it("ships the ten editor locales", () => {
    expect(MP_LOCALES.sort()).toEqual(
      ["de", "es", "fr", "it", "ja", "ko", "pt", "ru", "zh-cn", "zh-tw"],
    );
  });

  it("has a non-trivial key set", () => {
    expect(enKeys.length).toBeGreaterThan(25);
  });

  for (const [id, pack] of Object.entries(MP_PACKS)) {
    it(`${id}: defines every English key (no missing translations)`, () => {
      const missing = enKeys.filter((k) => !Object.prototype.hasOwnProperty.call(pack, k));
      expect(missing).toEqual([]);
    });

    it(`${id}: carries no orphaned keys (no stale entries)`, () => {
      const orphans = Object.keys(pack).filter((k) => !Object.prototype.hasOwnProperty.call(MP_EN, k));
      expect(orphans).toEqual([]);
    });

    it(`${id}: every value is non-empty and keeps its {placeholders}`, () => {
      for (const [k, v] of Object.entries(pack)) {
        expect(v, `${id} → ${k}`).toBeTruthy();
        for (const ph of (MP_EN[k].match(/\{\w+\}/g) || [])) {
          expect(v, `${id} → ${k} must keep ${ph}`).toContain(ph);
        }
      }
    });
  }
});

describe("mpText()", () => {
  it("falls back to English for an unknown locale and substitutes placeholders", () => {
    // No localStorage/navigator in the node env ⇒ English fallback.
    expect(mpText("victory")).toBe("Victory!");
    expect(mpText("playerJoined", { name: "Robin" })).toBe("Robin joined");
    expect(mpText("battleStart", { names: "Ana, Bo" })).toBe("Battle! Fighting alongside Ana, Bo!");
  });

  it("returns the key itself for a truly unknown string (never throws)", () => {
    expect(mpText("no-such-key")).toBe("no-such-key");
  });
});
