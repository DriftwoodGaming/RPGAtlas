/* RPGAtlas — tests-unit/mz-decrypt.test.ts
   Project Compass M1·A: RPG Maker MV/MZ asset (de)cryption (decision D9).
   Extension-based detection, key parsing, encrypt/decrypt symmetry, and
   decrypting the committed fixture `Sign` picture back to a valid PNG.
   GPL-3.0-or-later (see LICENSE). */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decryptAsset,
  encryptAsset,
  isEncryptedAssetPath,
  parseEncryptionKey,
  restoredPath,
} from "../src/editor/importers/mz/decrypt";

const fixture = (rel: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL("../tests/fixtures/" + rel, import.meta.url))));

const readJson = (rel: string): { encryptionKey: string } =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL("../tests/fixtures/" + rel, import.meta.url)), "utf8"),
  );

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("parseEncryptionKey", () => {
  it("parses a 32-hex-char key into 16 bytes", () => {
    const key = parseEncryptionKey("0f1e2d3c4b5a69788796a5b4c3d2e1f0");
    expect(key).toHaveLength(16);
    expect(key[0]).toBe(0x0f);
    expect(key[15]).toBe(0xf0);
  });
  it("rejects a malformed key", () => {
    expect(() => parseEncryptionKey("nothex")).toThrow();
    expect(() => parseEncryptionKey("abc")).toThrow(); // odd length
    expect(() => parseEncryptionKey("")).toThrow();
  });
});

describe("extension detection (D9)", () => {
  it("recognizes all four encrypted extensions, case-insensitively", () => {
    expect(isEncryptedAssetPath("img/pictures/Sign.rpgmvp")).toBe(true);
    expect(isEncryptedAssetPath("audio/bgm/Theme.rpgmvo")).toBe(true);
    expect(isEncryptedAssetPath("img/pictures/Sign.png_")).toBe(true);
    expect(isEncryptedAssetPath("audio/bgm/Theme.OGG_")).toBe(true);
    expect(isEncryptedAssetPath("img/pictures/Sign.png")).toBe(false);
    expect(isEncryptedAssetPath("data/System.json")).toBe(false);
  });
  it("maps encrypted paths to their restored counterparts", () => {
    expect(restoredPath("img/pictures/Sign.rpgmvp")).toBe("img/pictures/Sign.png");
    expect(restoredPath("img/pictures/Sign.png_")).toBe("img/pictures/Sign.png");
    expect(restoredPath("audio/bgm/Theme.rpgmvo")).toBe("audio/bgm/Theme.ogg");
    expect(restoredPath("audio/bgm/Theme.ogg_")).toBe("audio/bgm/Theme.ogg");
    expect(restoredPath("img/pictures/Sign.png")).toBe("img/pictures/Sign.png"); // pass-through
  });
});

describe("encrypt/decrypt symmetry", () => {
  it("round-trips arbitrary bytes", () => {
    const key = parseEncryptionKey("a1b2c3d4e5f6a7b8c9d0e1f203142536");
    const plain = new Uint8Array([...PNG_MAGIC, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const enc = encryptAsset(plain, key);
    expect(enc.length).toBe(plain.length + 16); // fake header prepended
    expect(Array.from(enc.slice(16, 16 + 8))).not.toEqual(PNG_MAGIC); // header XORed
    const dec = decryptAsset(enc, key);
    expect(Array.from(dec)).toEqual(Array.from(plain));
  });
  it("only scrambles the first 16 bytes", () => {
    const key = parseEncryptionKey("0f1e2d3c4b5a69788796a5b4c3d2e1f0");
    const plain = new Uint8Array(40).map((_, i) => i);
    const enc = encryptAsset(plain, key);
    // Bytes past the first 16 of the payload are untouched.
    expect(Array.from(enc.slice(16 + 16))).toEqual(Array.from(plain.slice(16)));
  });
  it("throws on a truncated file", () => {
    const key = parseEncryptionKey("0f1e2d3c4b5a69788796a5b4c3d2e1f0");
    expect(() => decryptAsset(new Uint8Array(8), key)).toThrow();
  });
});

describe("decrypting the fixture Sign picture", () => {
  it("MV Sign.rpgmvp decrypts to a valid PNG", () => {
    const keyHex = readJson("mv-project/data/System.json").encryptionKey;
    const dec = decryptAsset(fixture("mv-project/img/pictures/Sign.rpgmvp"), parseEncryptionKey(keyHex));
    expect(Array.from(dec.slice(0, 8))).toEqual(PNG_MAGIC);
  });
  it("MZ Sign.png_ decrypts to a valid PNG", () => {
    const keyHex = readJson("mz-project/data/System.json").encryptionKey;
    const dec = decryptAsset(fixture("mz-project/img/pictures/Sign.png_"), parseEncryptionKey(keyHex));
    expect(Array.from(dec.slice(0, 8))).toEqual(PNG_MAGIC);
  });
});
