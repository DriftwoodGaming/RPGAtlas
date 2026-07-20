/* RPGAtlas — tests-unit/passport.test.ts
   Project Beacon MP8·A: passport identity (src/shared/net/passport.ts).
   Proves the whole D3 loop headlessly (Node's WebCrypto is the same API the
   browser and workerd expose): generate → wire pub → challenge sign/verify,
   tampering fails closed, fingerprints are stable identity keys, and the
   export/import file round-trips while garbage imports return null (never
   throw). GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import {
  b64urlToBytes,
  bytesToB64url,
  decodePassportFile,
  encodePassportFile,
  fingerprintOfPub,
  generatePassport,
  passportPublicRaw,
  randomChallengeNonce,
  signChallenge,
  verifyChallenge,
} from "../src/shared/net/passport";

describe("base64url codec (pure, runtime-agnostic)", () => {
  it("round-trips arbitrary bytes", () => {
    for (const len of [0, 1, 2, 3, 31, 32, 33, 65]) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + len) & 0xff;
      const back = b64urlToBytes(bytesToB64url(bytes));
      expect(back).not.toBeNull();
      expect(Array.from(back!)).toEqual(Array.from(bytes));
    }
  });
  it("rejects non-base64url text (null, never a throw)", () => {
    expect(b64urlToBytes("has spaces")).toBeNull();
    expect(b64urlToBytes("padded==")).toBeNull();
    expect(b64urlToBytes("abcde")).toBeNull(); // len % 4 === 1 is never valid
    expect(b64urlToBytes("plus+slash/")).toBeNull();
  });
});

describe("MP8·A passport identity (D3: keypair, no PII)", () => {
  it("generate → wire pub → sign/verify a challenge", async () => {
    const p = await generatePassport("Riko");
    expect(p.kind).toBe("rpgatlas-passport");
    expect(p.name).toBe("Riko");
    const pub = await passportPublicRaw(p);
    expect(pub).toMatch(/^[A-Za-z0-9_-]{40,200}$/); // valid hello.pub wire form
    const nonce = randomChallengeNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{16,128}$/); // valid challenge.nonce
    const sig = await signChallenge(p, nonce);
    expect(sig).toMatch(/^[A-Za-z0-9_-]{40,200}$/); // valid hello.sig wire form
    expect(await verifyChallenge(pub, nonce, sig)).toBe(true);
  });

  it("verification fails closed on tampering (wrong nonce, wrong key, junk)", async () => {
    const p = await generatePassport("Riko");
    const other = await generatePassport("Mallory");
    const pub = await passportPublicRaw(p);
    const nonce = randomChallengeNonce();
    const sig = await signChallenge(p, nonce);
    expect(await verifyChallenge(pub, randomChallengeNonce(), sig)).toBe(false); // replay to a new nonce dies
    expect(await verifyChallenge(await passportPublicRaw(other), nonce, sig)).toBe(false); // not Mallory's sig
    expect(await verifyChallenge(pub, nonce, await signChallenge(other, nonce))).toBe(false); // Mallory can't sign as Riko
    expect(await verifyChallenge("garbage!!", nonce, sig)).toBe(false); // junk key: false, no throw
    expect(await verifyChallenge(pub, nonce, "AAAA")).toBe(false); // junk sig: false, no throw
  });

  it("fingerprint is a stable identity key, distinct per passport", async () => {
    const p = await generatePassport("Riko");
    const pub = await passportPublicRaw(p);
    const f1 = await fingerprintOfPub(pub);
    const f2 = await fingerprintOfPub(pub);
    expect(f1).not.toBeNull();
    expect(f1).toBe(f2); // stable across calls (the persistence/ban key)
    expect(f1).toMatch(/^[A-Za-z0-9_-]{43}$/); // SHA-256, base64url
    const q = await generatePassport("Riko"); // same NAME, different device/keys
    expect(await fingerprintOfPub(await passportPublicRaw(q))).not.toBe(f1);
    expect(await fingerprintOfPub("junk!!")).toBeNull();
    expect(await fingerprintOfPub("AAAA")).toBeNull(); // too short to be a key
  });

  it("passport file export/import round-trips; garbage imports return null", async () => {
    const p = await generatePassport("Riko");
    const file = encodePassportFile(p);
    const back = decodePassportFile(file);
    expect(back).toEqual(p);
    // The re-imported passport still signs valid challenges (keys survived).
    const nonce = randomChallengeNonce();
    expect(await verifyChallenge(await passportPublicRaw(back!), nonce, await signChallenge(back!, nonce))).toBe(true);
    // Hostile/corrupt imports: null, never a throw, never a half-passport.
    expect(decodePassportFile("not json")).toBeNull();
    expect(decodePassportFile("{}")).toBeNull();
    expect(decodePassportFile(JSON.stringify({ ...p, kind: "evil" }))).toBeNull();
    expect(decodePassportFile(JSON.stringify({ ...p, privateKeyJwk: { kty: "EC" } }))).toBeNull();
    expect(decodePassportFile(JSON.stringify({ ...p, name: "x".repeat(65) }))).toBeNull();
    expect(decodePassportFile(JSON.stringify({ ...p, v: 2 }))).toBeNull();
  });

  it("carries no PII: a passport is exactly name + keys + timestamp", async () => {
    const p = await generatePassport("Riko");
    expect(Object.keys(p).sort()).toEqual(["created", "kind", "name", "privateKeyJwk", "publicKeyJwk", "v"]);
  });
});
