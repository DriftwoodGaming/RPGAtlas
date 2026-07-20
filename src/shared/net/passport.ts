/* RPGAtlas — src/shared/net/passport.ts
   Project Beacon MP8·A: passport identity (roadmap D3). A passport is a
   device-local keypair plus a display name — no email, no account, no PII. A
   world server knows a player ONLY as the SHA-256 fingerprint of their public
   key: it keys the player's persistent record (position, per-player switches)
   and the operator's ban list. Friend rooms never see a passport at all (they
   stay fully anonymous, name only — the relay sends no challenge).

   Crypto choices (deliberately boring): ECDSA P-256 + SHA-256 via WebCrypto
   (`globalThis.crypto.subtle`) — the one signature suite that is green across
   every runtime this project ships on (browsers/WebView2, Node ≥ 20, and
   Cloudflare workerd). Ed25519 would be shorter but its WebCrypto support is
   still uneven. The private key is extractable BY DESIGN: the passport must
   export to a file so a kid can move devices (D3) — the file is the same
   trust tier as a save file, and the docs say to treat it like one.

   Auth flow (server side lives in server/src/core/beacon-world.ts):
     connect → server sends `challenge { nonce }`
             → client `hello { …, pub, sig }` where sig = ECDSA(nonce, domain-
               separated — see signChallenge)
             → server verifyChallenge(pub, nonce, sig) → fingerprint(pub) is
               the player's identity key.
   The nonce is per-connection CSPRNG, so a captured signature replays into
   nothing.

   Pure and DOM-free (vitest env=node); every decoder here treats its input as
   hostile (import must never crash on garbage). GPL-3.0-or-later. */

/* ── base64url (no atob/Buffer — must run in browser, Node, workerd) ────── */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64_INV: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64_INV[B64[i]] = i;

/** Uint8Array → base64url (no padding). */
export function bytesToB64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) out += B64[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) out += B64[c & 63];
  }
  return out;
}

/** base64url → bytes, or null on any non-base64url input (hostile-safe).
 *  "" decodes to an empty array (a total codec); field minimum lengths are the
 *  protocol validators' job, not the codec's. */
export function b64urlToBytes(text: string): Uint8Array | null {
  if (typeof text !== "string" || text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (const ch of text) {
    const v = B64_INV[ch];
    if (v === undefined) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, n);
}

/* ── Passport shape ────────────────────────────────────────────────────── */

/** The exportable passport file/record. `name` is the display name (the only
 *  human-facing field); the JWKs are the device-local P-256 keypair. */
export interface Passport {
  v: 1;
  kind: "rpgatlas-passport";
  name: string;
  /** ms epoch of creation (informational). */
  created: number;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
}

const EC_PARAMS: EcKeyImportParams = { name: "ECDSA", namedCurve: "P-256" };
const SIGN_PARAMS: EcdsaParams = { name: "ECDSA", hash: "SHA-256" };
/** Domain separation: a passport signature can only ever mean "answering a
 *  Beacon world challenge" — it cannot be replayed into any other protocol. */
const SIGN_DOMAIN = "rpgatlas-passport-v1:";

const subtle = (): SubtleCrypto => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || !c.subtle) throw new Error("WebCrypto unavailable (passport needs a modern runtime)");
  return c.subtle;
};

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Create a fresh passport: a new device-local P-256 keypair + the display
 *  name. Extractable so the passport can export to a file (D3). */
export async function generatePassport(name: string): Promise<Passport> {
  const pair = (await subtle().generateKey(EC_PARAMS, true, ["sign", "verify"])) as CryptoKeyPair;
  return {
    v: 1,
    kind: "rpgatlas-passport",
    name: String(name || ""),
    created: Date.now(),
    publicKeyJwk: await subtle().exportKey("jwk", pair.publicKey),
    privateKeyJwk: await subtle().exportKey("jwk", pair.privateKey),
  };
}

/** The passport's public key as the wire form (`hello.pub`): the raw
 *  uncompressed P-256 point (65 bytes), base64url. */
export async function passportPublicRaw(p: Passport): Promise<string> {
  const key = await subtle().importKey("jwk", p.publicKeyJwk, EC_PARAMS, true, ["verify"]);
  return bytesToB64url(new Uint8Array(await subtle().exportKey("raw", key)));
}

/** SHA-256 fingerprint of a wire-form public key — the player's identity key
 *  server-side (persistence records, ban list). Returns null on garbage. */
export async function fingerprintOfPub(pubB64: string): Promise<string | null> {
  const raw = b64urlToBytes(pubB64);
  if (!raw || raw.length < 33 || raw.length > 133) return null;
  const digest = await subtle().digest("SHA-256", raw as unknown as ArrayBuffer);
  return bytesToB64url(new Uint8Array(digest));
}

/** Sign a server challenge nonce with the passport's private key. */
export async function signChallenge(p: Passport, nonceB64: string): Promise<string> {
  const key = await subtle().importKey("jwk", p.privateKeyJwk, EC_PARAMS, false, ["sign"]);
  const sig = await subtle().sign(SIGN_PARAMS, key, utf8(SIGN_DOMAIN + nonceB64) as unknown as ArrayBuffer);
  return bytesToB64url(new Uint8Array(sig));
}

/** Verify a `hello.sig` against the challenge nonce and wire public key.
 *  False on ANY failure — bad key bytes, bad signature bytes, wrong nonce —
 *  never throws (server treats the input as hostile). */
export async function verifyChallenge(pubB64: string, nonceB64: string, sigB64: string): Promise<boolean> {
  try {
    const raw = b64urlToBytes(pubB64);
    const sig = b64urlToBytes(sigB64);
    if (!raw || !sig || typeof nonceB64 !== "string" || nonceB64.length === 0) return false;
    const key = await subtle().importKey("raw", raw as unknown as ArrayBuffer, EC_PARAMS, false, ["verify"]);
    return await subtle().verify(SIGN_PARAMS, key, sig as unknown as ArrayBuffer, utf8(SIGN_DOMAIN + nonceB64) as unknown as ArrayBuffer);
  } catch {
    return false;
  }
}

/** Fresh CSPRNG challenge nonce (server side): 24 bytes → 32 chars base64url. */
export function randomChallengeNonce(): string {
  const bytes = new Uint8Array(24);
  (globalThis as unknown as { crypto: Crypto }).crypto.getRandomValues(bytes);
  return bytesToB64url(bytes);
}

/* ── Passport file (export / import) ───────────────────────────────────── */

/** Serialize a passport for file export (pretty JSON — a kid may open it). */
export function encodePassportFile(p: Passport): string {
  return JSON.stringify(p, null, 2);
}

const isJwkShape = (v: unknown, needD: boolean): v is JsonWebKey => {
  if (typeof v !== "object" || v === null) return false;
  const j = v as Record<string, unknown>;
  if (j.kty !== "EC" || j.crv !== "P-256") return false;
  if (typeof j.x !== "string" || typeof j.y !== "string") return false;
  if (needD && typeof j.d !== "string") return false;
  return true;
};

/** Parse + strictly validate a passport file. Null on ANYTHING wrong — a
 *  hostile or corrupted import must never crash or half-load. */
export function decodePassportFile(text: string): Passport | null {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof root !== "object" || root === null) return null;
  const p = root as Record<string, unknown>;
  if (p.v !== 1 || p.kind !== "rpgatlas-passport") return null;
  if (typeof p.name !== "string" || p.name.length > 64) return null;
  if (typeof p.created !== "number" || !Number.isFinite(p.created)) return null;
  if (!isJwkShape(p.publicKeyJwk, false) || !isJwkShape(p.privateKeyJwk, true)) return null;
  return {
    v: 1,
    kind: "rpgatlas-passport",
    name: p.name,
    created: p.created,
    publicKeyJwk: p.publicKeyJwk,
    privateKeyJwk: p.privateKeyJwk,
  };
}
