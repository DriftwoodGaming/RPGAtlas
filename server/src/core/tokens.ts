/* RPGAtlas — server/src/core/tokens.ts
   Project Beacon MP5·A: per-session resume secrets. A resume token is an
   unguessable capability (like a room code, but private to one player) that
   lets a dropped client re-attach to its slot without re-joining. It must be
   CSPRNG-backed and match the protocol's `isResumeToken` shape
   (^[A-Za-z0-9_-]{16,128}$). Rotated on every use so a sniffed old token is
   dead (room.ts). GPL-3.0. */

const URL_SAFE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** A 32-char URL-safe token from the platform CSPRNG (Node ≥ 19 and the DO
 *  runtime both expose globalThis.crypto). ~190 bits of entropy. */
export function randomResumeToken(): string {
  const c = globalThis.crypto;
  if (!c || !c.getRandomValues) throw new Error("tokens: no crypto.getRandomValues");
  const bytes = c.getRandomValues(new Uint8Array(32));
  let out = "";
  for (const b of bytes) out += URL_SAFE[b & 63];
  return out;
}
