/* RPGAtlas — tests-unit/passport-store.test.ts
   Project Beacon MP8·A: device-local passport custody
   (src/engine/net/passport-store.ts) over an injected KV store — no DOM.
   Proves first-use auto-create persists, reload returns the SAME identity,
   corrupt storage heals by re-creating, rename keeps the keys, and file
   import replaces the device passport only when valid. GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import {
  PASSPORT_KEY,
  exportPassportText,
  importPassportText,
  loadOrCreatePassport,
  storedPassport,
  updatePassportName,
  type KVStore,
} from "../src/engine/net/passport-store";
import { generatePassport, encodePassportFile } from "../src/shared/net/passport";

function memStore(): KVStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("MP8·A passport custody (device-local, auto-created)", () => {
  it("first use creates + persists; second load returns the same identity", async () => {
    const store = memStore();
    expect(storedPassport(store)).toBeNull();
    const p1 = await loadOrCreatePassport("Riko", store);
    expect(p1.name).toBe("Riko");
    expect(store.map.has(PASSPORT_KEY)).toBe(true);
    const p2 = await loadOrCreatePassport("SomeoneElse", store);
    expect(p2).toEqual(p1); // existing passport wins; the name arg only seeds a fresh one
  });

  it("corrupt storage heals: re-creates instead of crashing or half-loading", async () => {
    const store = memStore();
    store.setItem(PASSPORT_KEY, "{corrupt");
    expect(storedPassport(store)).toBeNull();
    const p = await loadOrCreatePassport("Riko", store);
    expect(p.kind).toBe("rpgatlas-passport");
    expect(storedPassport(store)).toEqual(p);
  });

  it("rename keeps the keys (same identity, new label)", async () => {
    const store = memStore();
    const p = await loadOrCreatePassport("Riko", store);
    const renamed = updatePassportName("Captain Riko", store);
    expect(renamed!.name).toBe("Captain Riko");
    expect(renamed!.publicKeyJwk).toEqual(p.publicKeyJwk);
    expect(renamed!.privateKeyJwk).toEqual(p.privateKeyJwk);
    expect(storedPassport(store)).toEqual(renamed);
  });

  it("export/import round-trips a passport between two devices", async () => {
    const a = memStore();
    const b = memStore();
    const p = await loadOrCreatePassport("Riko", a);
    const file = exportPassportText(a)!;
    const imported = importPassportText(file, b);
    expect(imported).toEqual(p);
    expect(storedPassport(b)).toEqual(p);
  });

  it("a bad import never touches the stored passport", async () => {
    const store = memStore();
    const p = await loadOrCreatePassport("Riko", store);
    expect(importPassportText("not a passport", store)).toBeNull();
    expect(importPassportText(JSON.stringify({ v: 1, kind: "evil" }), store)).toBeNull();
    expect(storedPassport(store)).toEqual(p); // untouched
    const other = await generatePassport("Visitor");
    expect(importPassportText(encodePassportFile(other), store)).toEqual(other); // a valid one replaces
    expect(storedPassport(store)).toEqual(other);
  });
});
