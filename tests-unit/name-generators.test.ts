/* RPGAtlas - Generator Hub combinatorial regression tests. */
import { describe, expect, it } from "vitest";
import {
  GENERATOR_DEFINITIONS, estimatePossibilities, generateNames,
} from "../src/editor/tools/name-generator-data";

function seededRandom(seed = 0x5eed1234): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("Generator Hub data", () => {
  it("ships 20 distinct generators including every requested core family", () => {
    expect(GENERATOR_DEFINITIONS).toHaveLength(20);
    expect(new Set(GENERATOR_DEFINITIONS.map((definition) => definition.id)).size).toBe(20);
    for (const required of ["weapon", "armor", "spell", "currency", "item", "enemy"]) {
      expect(GENERATOR_DEFINITIONS.some((definition) => definition.id === required), required).toBe(true);
    }
  });

  it("keeps thousands of possibilities in every generator, subtype, and naming style", () => {
    for (const definition of GENERATOR_DEFINITIONS) {
      for (const subtype of definition.types) {
        for (const style of ["concise", "evocative", "legendary"] as const) {
          expect(
            estimatePossibilities(definition, { subtype: subtype.id, tone: definition.tones[0], style }),
            `${definition.id}/${subtype.id}/${style}`,
          ).toBeGreaterThanOrEqual(1_000);
        }
      }
    }
  });

  it("generates unique, fully rendered batches across all word banks", () => {
    for (const [index, definition] of GENERATOR_DEFINITIONS.entries()) {
      const results = generateNames(definition, {
        subtype: definition.types[index % definition.types.length].id,
        tone: definition.tones[index % definition.tones.length],
        style: index % 3 === 0 ? "concise" : index % 3 === 1 ? "evocative" : "legendary",
      }, 20, seededRandom(1000 + index));
      expect(results, definition.id).toHaveLength(20);
      expect(new Set(results.map((result) => result.name)).size, definition.id).toBe(20);
      expect(results.every((result) => result.name.length > 2 && result.hook.length > 12), definition.id).toBe(true);
      expect(results.every((result) => !/[{}]/.test(result.name + result.hook)), definition.id).toBe(true);
    }
  });

  it("honors world keywords, formal prefixes, and alliteration", () => {
    const themed = generateNames("spell", {
      subtype: "elemental", tone: "mystical", style: "evocative",
      worldWord: "Everbloom", prefixThe: true,
    }, 12, seededRandom(17));
    expect(themed.every((result) => result.name.startsWith("The "))).toBe(true);
    expect(themed.every((result) => result.name.includes("Everbloom"))).toBe(true);

    const alliterative = generateNames("weapon", {
      subtype: "blades", tone: "heroic", style: "concise", alliteration: true,
    }, 12, seededRandom(99));
    expect(alliterative.every((result) => {
      const [adjective, subject] = result.name.split(" ");
      return adjective[0].toLowerCase() === subject[0].toLowerCase();
    })).toBe(true);

    const combined = generateNames("character", {
      subtype: "adventurer", tone: "heroic", style: "concise",
      alliteration: true, worldWord: "Red Moon",
    }, 8, seededRandom(211));
    expect(combined.every((result) => result.name.includes("Red Moon"))).toBe(true);
  });
});
