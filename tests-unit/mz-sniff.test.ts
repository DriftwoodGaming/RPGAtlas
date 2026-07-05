/* RPGAtlas — tests-unit/mz-sniff.test.ts
   Project Compass M1·A: MV-vs-MZ format detection (matrix §0). Marker file is
   authoritative; data cues (System.advanced/tileSize/locale, Effekseer-vs-sheet
   Animations, encrypted extension) resolve markerless intakes.
   GPL-3.0-or-later (see LICENSE). */

import { describe, expect, it } from "vitest";
import { sniffFormat } from "../src/editor/importers/mz/sniff";

describe("sniffFormat — marker file", () => {
  it("detects MV from Game.rpgproject", () => {
    const r = sniffFormat({ paths: ["mv-project/Game.rpgproject", "data/System.json"] });
    expect(r.format).toBe("mv");
    expect(r.confidence).toBe("marker");
  });
  it("detects MZ from Game.rmmzproject", () => {
    const r = sniffFormat({ paths: ["Game.rmmzproject", "data/System.json"] });
    expect(r.format).toBe("mz");
    expect(r.confidence).toBe("marker");
  });
  it("prefers the marker over conflicting data cues", () => {
    const r = sniffFormat({
      paths: ["Game.rpgproject"],
      system: { advanced: { screenWidth: 816 } }, // an MZ cue…
    });
    expect(r.format).toBe("mv"); // …but the MV marker wins
  });
});

describe("sniffFormat — data cues", () => {
  it("detects MZ from System.advanced / tileSize / locale", () => {
    const r = sniffFormat({ paths: ["data/System.json"], system: { advanced: {}, tileSize: 48 } });
    expect(r.format).toBe("mz");
    expect(r.confidence).toBe("data");
  });
  it("detects MZ from Effekseer animations", () => {
    const r = sniffFormat({ paths: [], animations: [null, { id: 1, effectName: "Fire" }] });
    expect(r.format).toBe("mz");
  });
  it("detects MV from sheet-based animations", () => {
    const r = sniffFormat({
      paths: [],
      animations: [null, { id: 1, animation1Name: "Fire", frames: [[]] }],
    });
    expect(r.format).toBe("mv");
  });
  it("detects format from the encrypted-asset extension", () => {
    expect(sniffFormat({ paths: ["img/pictures/Sign.png_"] }).format).toBe("mz");
    expect(sniffFormat({ paths: ["img/pictures/Sign.rpgmvp"] }).format).toBe("mv");
  });
});

describe("sniffFormat — fallback", () => {
  it("defaults to MV with a 'guess' when nothing is decisive", () => {
    const r = sniffFormat({ paths: ["data/System.json"], system: {} });
    expect(r.format).toBe("mv");
    expect(r.confidence).toBe("guess");
  });
});
