/* RPGAtlas — tests-unit/net-room-code.test.ts
   Room codes (src/shared/net/room-code.ts) are capability tokens for friend
   rooms, so these tests pin the SAFETY properties: entropy ≥ 40 bits, a
   kid-typable alphabet that cannot spell words (no vowels), uniform CSPRNG
   sampling (no modulo bias), and forgiving normalization of real typing
   (lowercase, dashes, O/I/L look-alikes). GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_ENTROPY_BITS,
  ROOM_CODE_LENGTH,
  formatRoomCode,
  generateRoomCode,
  isCanonicalRoomCode,
  normalizeRoomCode,
} from "../src/shared/net/room-code";

describe("room-code alphabet & entropy (safety floor)", () => {
  it("clears the roadmap's 40-bit entropy floor", () => {
    expect(ROOM_CODE_ENTROPY_BITS).toBeGreaterThanOrEqual(40);
    expect(ROOM_CODE_ENTROPY_BITS).toBeCloseTo(ROOM_CODE_LENGTH * Math.log2(ROOM_CODE_ALPHABET.length));
  });

  it("has 30 unique characters with no vowels (no accidental words) and no L", () => {
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(30);
    for (const banned of "AEIOUL") expect(ROOM_CODE_ALPHABET).not.toContain(banned);
  });
});

describe("generateRoomCode", () => {
  it("emits canonical codes from the real CSPRNG", () => {
    for (let i = 0; i < 100; i++) {
      const code = generateRoomCode();
      expect(isCanonicalRoomCode(code)).toBe(true);
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
    }
  });

  it("10 000 codes collide never (collision-safety sanity)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) seen.add(generateRoomCode());
    expect(seen.size).toBe(10_000);
  });

  it("is deterministic under an injected byte source", () => {
    const fixed = () => Uint8Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => i);
    expect(generateRoomCode(fixed)).toBe(generateRoomCode(fixed));
    // bytes 0..8 map straight through the alphabet: indices 0..8 = "012345678"
    expect(generateRoomCode(fixed)).toBe("012345678");
  });

  it("rejection-samples: bytes ≥ 240 are skipped, not folded (no modulo bias)", () => {
    // First batch is all rejects; the generator must ask again rather than
    // bias-fold 240..255 onto low indices.
    const batches = [
      Uint8Array.from({ length: ROOM_CODE_LENGTH }, () => 250),
      Uint8Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => i),
    ];
    let call = 0;
    const code = generateRoomCode(() => batches[Math.min(call++, batches.length - 1)]);
    expect(code).toBe("012345678");
    expect(call).toBe(2);
  });

  it("byte 239 is the last accepted value and maps uniformly (239 % 30 = 29)", () => {
    const fixed = () => Uint8Array.from({ length: ROOM_CODE_LENGTH }, () => 239);
    expect(generateRoomCode(fixed)).toBe(ROOM_CODE_ALPHABET[29].repeat(ROOM_CODE_LENGTH));
  });
});

describe("normalizeRoomCode (what kids actually type)", () => {
  it("accepts the canonical form unchanged", () => {
    expect(normalizeRoomCode("XY3KM9PQ7")).toBe("XY3KM9PQ7");
  });

  it("strips separators and uppercases", () => {
    expect(normalizeRoomCode("xy3-km9-pq7")).toBe("XY3KM9PQ7");
    expect(normalizeRoomCode(" xy3 km9 pq7 ")).toBe("XY3KM9PQ7");
    expect(normalizeRoomCode("xy3.km9.pq7")).toBe("XY3KM9PQ7");
  });

  it("repairs the classic look-alikes O→0, I→1, L→1", () => {
    expect(normalizeRoomCode("OY3KM9PQ7")).toBe("0Y3KM9PQ7");
    expect(normalizeRoomCode("iY3KM9PQ7")).toBe("1Y3KM9PQ7");
    expect(normalizeRoomCode("lY3KM9PQ7")).toBe("1Y3KM9PQ7");
  });

  it("returns null (never throws) for hopeless input", () => {
    expect(normalizeRoomCode("")).toBeNull();
    expect(normalizeRoomCode("XY3KM9PQ")).toBeNull(); // too short
    expect(normalizeRoomCode("XY3KM9PQ77")).toBeNull(); // too long
    expect(normalizeRoomCode("AY3KM9PQ7")).toBeNull(); // vowel A is not repairable
    expect(normalizeRoomCode("XY3KM9PQ!")).toBeNull();
  });
});

describe("formatRoomCode", () => {
  it("groups as XXX-XXX-XXX and round-trips through normalize", () => {
    const code = generateRoomCode();
    const shown = formatRoomCode(code);
    expect(shown).toMatch(/^[0-9BCDFGHJKMNPQRSTVWXYZ]{3}-[0-9BCDFGHJKMNPQRSTVWXYZ]{3}-[0-9BCDFGHJKMNPQRSTVWXYZ]{3}$/);
    expect(normalizeRoomCode(shown)).toBe(code);
  });
});
