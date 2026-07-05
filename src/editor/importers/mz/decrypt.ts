/* RPGAtlas — src/editor/importers/mz/decrypt.ts
   Project Compass M1·A: RPG Maker MV/MZ asset (de)cryption (matrix §15, decision
   D9). Symmetric scheme — a 16-byte fake PNG/OGG header, then the real file's
   first 16 bytes XORed with the 16-byte key (hex in the user's OWN System.json,
   locked decision 5). Detection is by *extension*, not the System flags (D9):
   real projects mix plain + encrypted assets. Pure Uint8Array in/out so it runs
   in the browser, Tauri, and node/vitest alike.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

/** The 16-byte fake header MV/MZ prepend ("RPGMV\0\0\0\0\x03\x01\0\0\0\0\0"). */
export const ENC_HEADER = new Uint8Array([
  0x52, 0x50, 0x47, 0x4d, 0x56, 0, 0, 0, 0, 3, 1, 0, 0, 0, 0, 0,
]);

/** The four encrypted-asset extensions: MV `.rpgmvp`/`.rpgmvo`, MZ `.png_`/`.ogg_`. */
const ENC_EXT = /\.(rpgmvp|rpgmvo|png_|ogg_)$/i;

/** Parse the 32-hex-char `System.encryptionKey` into 16 bytes. Throws on a
 *  malformed key so a missing/garbled key surfaces (M1·D reports it plainly). */
export function parseEncryptionKey(hex: string): Uint8Array {
  const clean = String(hex == null ? "" : hex).trim();
  if (!/^[0-9a-f]+$/i.test(clean) || clean.length % 2 !== 0) {
    throw new Error("encryption key is not a hex string");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  if (out.length === 0) throw new Error("encryption key is empty");
  return out;
}

/** Is this an encrypted asset, by extension (D9)? */
export function isEncryptedAssetPath(path: string): boolean {
  return ENC_EXT.test(String(path || ""));
}

/** Map an encrypted asset path to its decrypted counterpart:
 *  `.rpgmvp`/`.png_` → `.png`, `.rpgmvo`/`.ogg_` → `.ogg`. Non-encrypted
 *  paths pass through unchanged. */
export function restoredPath(path: string): string {
  return String(path || "")
    .replace(/\.(rpgmvp|png_)$/i, ".png")
    .replace(/\.(rpgmvo|ogg_)$/i, ".ogg");
}

/** Decrypt an encrypted asset: drop the 16-byte fake header, then XOR the next
 *  16 bytes with the key. Returns a fresh buffer (input untouched). */
export function decryptAsset(bytes: Uint8Array, key: Uint8Array): Uint8Array {
  if (bytes.length < ENC_HEADER.length) {
    throw new Error("encrypted asset is too short to hold a header");
  }
  const out = bytes.slice(ENC_HEADER.length);
  const n = Math.min(16, out.length, key.length);
  for (let i = 0; i < n; i++) out[i] ^= key[i];
  return out;
}

/** Encrypt a plain asset (symmetric inverse of `decryptAsset`) — used by the
 *  decryption unit tests to prove round-trip fidelity; the importer only ever
 *  decrypts. `header` defaults to the standard MV/MZ signature. */
export function encryptAsset(
  bytes: Uint8Array,
  key: Uint8Array,
  header: Uint8Array = ENC_HEADER,
): Uint8Array {
  const out = new Uint8Array(header.length + bytes.length);
  out.set(header, 0);
  out.set(bytes, header.length);
  const n = Math.min(16, bytes.length, key.length);
  for (let i = 0; i < n; i++) out[header.length + i] ^= key[i];
  return out;
}
