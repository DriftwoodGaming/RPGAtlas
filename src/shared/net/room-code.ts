/* RPGAtlas — src/shared/net/room-code.ts
   Friend-room join codes for Project Beacon (MP0·A). A room code is an
   unguessable capability token — knowing the code IS the permission to join
   (roadmap "Kid safety & privacy" rule 2), so the requirements are safety
   requirements: ≥ 40 bits of entropy from a CSPRNG, a format a kid can read
   aloud and type (no vowels ⇒ no accidental words, no ambiguous glyphs),
   and forgiving normalization of what they actually type. Pure and DOM-free:
   the server (MP5), the client join UI, and vitest all share this module.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

/** The 30-character room-code alphabet: digits plus consonants. Vowels
 *  (A E I O U) are excluded so a random code can never spell a real word in
 *  front of a 7-year-old; L is excluded because it reads as 1. Ambiguous
 *  input (O, I, L, lowercase) is repaired by {@link normalizeRoomCode}. */
export const ROOM_CODE_ALPHABET = "0123456789BCDFGHJKMNPQRSTVWXYZ";

/** Canonical code length (alphabet characters, no separators). */
export const ROOM_CODE_LENGTH = 9;

/** Entropy of a generated code in bits: 9 × log₂(30) ≈ 44.15. The roadmap's
 *  safety floor is 40; the margin is deliberate. */
export const ROOM_CODE_ENTROPY_BITS = ROOM_CODE_LENGTH * Math.log2(ROOM_CODE_ALPHABET.length);

/** Source of cryptographic random bytes; injectable for deterministic tests.
 *  The default draws from globalThis.crypto (browser and Node ≥ 19). */
export type RandomBytes = (count: number) => Uint8Array;

const cryptoRandomBytes: RandomBytes = (count) => {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) throw new Error("room-code: no crypto.getRandomValues available");
  return c.getRandomValues(new Uint8Array(count));
};

/* Largest multiple of the alphabet size that fits in a byte; bytes at or above
   it are rejected so every alphabet index stays equally likely. */
const REJECT_AT = 256 - (256 % ROOM_CODE_ALPHABET.length); // 240

/** Generate a canonical 9-character room code with uniform, CSPRNG-backed
 *  character selection (rejection sampling — no modulo bias). Collision
 *  handling: at ~44 bits, accidental collision between concurrently active
 *  rooms is negligible, but the server still MUST check new codes against its
 *  active-room set and re-generate on hit (MP5·A); guessing resistance is
 *  additionally backed by join rate limits (MP5·D). */
export function generateRoomCode(random: RandomBytes = cryptoRandomBytes): string {
  let out = "";
  while (out.length < ROOM_CODE_LENGTH) {
    for (const byte of random(ROOM_CODE_LENGTH)) {
      if (byte >= REJECT_AT) continue;
      out += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
      if (out.length === ROOM_CODE_LENGTH) break;
    }
  }
  return out;
}

/** True iff `code` is a canonical room code (exactly 9 alphabet characters,
 *  no separators). This is the only form the wire protocol accepts. */
export function isCanonicalRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/** Repair human input into a canonical code: trims, strips separators
 *  (spaces, dashes, dots), uppercases, and maps the classic look-alikes
 *  O→0, I→1, L→1. Returns null when what remains still isn't a valid code —
 *  callers turn that into the friendly "check the code and try again" copy,
 *  never an exception. */
export function normalizeRoomCode(input: string): string | null {
  const repaired = input
    .toUpperCase()
    .replace(/[\s\-.]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return isCanonicalRoomCode(repaired) ? repaired : null;
}

/** Display form of a canonical code: grouped for reading aloud, XXX-XXX-XXX. */
export function formatRoomCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3, 6)}-${code.slice(6, 9)}`;
}
