/* RPGAtlas — src/engine/net/passport-store.ts
   Project Beacon MP8·A: the device-local passport (roadmap D3) as the engine
   keeps it. One passport per device, stored beside the saves in localStorage,
   auto-created the first time a world connection needs it — a kid never sees
   a signup, because there isn't one. Export writes the passport to a file the
   player can carry to another device; import replaces the local passport
   after strict validation (a corrupt file can never half-load).

   The storage backend is injectable so the logic is unit-testable headlessly
   (vitest env=node has no localStorage); the engine calls these with the
   default (window.localStorage). The crypto lives in the shared core
   (src/shared/net/passport.ts) — this file is only custody. GPL-3.0. */

import {
  decodePassportFile,
  encodePassportFile,
  generatePassport,
  type Passport,
} from "../../shared/net/passport.js";

/** localStorage key (device-local; the same trust tier as save slots). */
export const PASSPORT_KEY = "rpgatlas_passport";

/** The subset of Storage we use (injectable for headless tests). */
export interface KVStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const defaultStore = (): KVStore | null => {
  try {
    const w = globalThis as { localStorage?: KVStore };
    return w.localStorage || null;
  } catch {
    return null;
  }
};

/** The stored passport, or null (absent OR corrupt — corrupt reads as absent
 *  so a damaged store heals by re-creating, never crashes the boot). */
export function storedPassport(store: KVStore | null = defaultStore()): Passport | null {
  if (!store) return null;
  const text = store.getItem(PASSPORT_KEY);
  return text ? decodePassportFile(text) : null;
}

/** Get the device passport, creating (and persisting) one on first use.
 *  `name` seeds a fresh passport's display name; an existing passport keeps
 *  its own name (rename via updatePassportName). */
export async function loadOrCreatePassport(
  name: string,
  store: KVStore | null = defaultStore(),
): Promise<Passport> {
  const existing = storedPassport(store);
  if (existing) return existing;
  const fresh = await generatePassport(name);
  if (store) store.setItem(PASSPORT_KEY, encodePassportFile(fresh));
  return fresh;
}

/** Update the display name on the stored passport (keys unchanged). */
export function updatePassportName(name: string, store: KVStore | null = defaultStore()): Passport | null {
  const p = storedPassport(store);
  if (!p || !store) return null;
  const renamed: Passport = { ...p, name: String(name || "").slice(0, 64) };
  store.setItem(PASSPORT_KEY, encodePassportFile(renamed));
  return renamed;
}

/** Serialize the stored passport for a file export (null when none exists). */
export function exportPassportText(store: KVStore | null = defaultStore()): string | null {
  const p = storedPassport(store);
  return p ? encodePassportFile(p) : null;
}

/** Import a passport file's text, replacing the device passport. Returns the
 *  passport on success, null on ANY validation failure (store untouched). */
export function importPassportText(text: string, store: KVStore | null = defaultStore()): Passport | null {
  const p = decodePassportFile(text);
  if (!p || !store) return p && !store ? p : null;
  store.setItem(PASSPORT_KEY, encodePassportFile(p));
  return p;
}
