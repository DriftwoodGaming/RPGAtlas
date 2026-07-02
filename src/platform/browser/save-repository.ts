/* RPGAtlas — src/platform/browser/save-repository.ts
   The browser SaveRepository (Phase 1 Stage D): per-game save slots + player
   options over localStorage, formalizing the key-naming + fallback logic that
   lived inline in src/engine/state/save.ts (saveKey/slotInfo) and
   state/player-options.ts (optionsKey/loadOptions/saveOptions).
   Behavior-frozen — every key, fallback, and failure mode is preserved:

   - saveKey(slot): "rpgatlas_<gameId>_save_<slot>" when window.RPGATLAS_GAME_ID
     is set, else "rpgatlas_save_<slot>". Reads fall back to the pre-rebrand
     "driftwood_*" key (regex-rewrite of the leading "rpgatlas").
   - optionsKey(): "rpgatlas_<gameId>_options" / "rpgatlas_options". (Options
     have no driftwood read-fallback today; that is preserved — options are not
     migrated, they simply start fresh for a never-configured player.)
   - readSlot/slotInfo: parse the stored JSON, or null on missing/corrupt
     (try/catch swallow, exactly like slotInfo()).
   - writeSlot: setItem in a try/catch; returns false on quota/unavailable so
     the caller shows the storage-full message. Returns true on success.
   - readOptions: parse or {} on missing/corrupt (loadOptions()).
   - writeOptions: setItem in a try/catch that silently drops on failure
     (saveOptions() — options "simply don't persist").

   The gameId lives on window.RPGATLAS_GAME_ID (set by the standalone export /
   player host); it is read live per call so a late assignment is honored,
   identical to the original inline helpers. GPL-3.0-or-later. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { SaveRepository, StorageDriver } from "../../shared/services";
import { localStorageDriver } from "./local-storage-driver";

function gameId(): string | undefined {
  return (window as any).RPGATLAS_GAME_ID;
}

/** "rpgatlas_<gameId>_save_<slot>" or "rpgatlas_save_<slot>" — verbatim from
 *  the engine's saveKey(). */
export function saveKey(slot: number | string): string {
  const id = gameId();
  return id ? "rpgatlas_" + id + "_save_" + slot : "rpgatlas_save_" + slot;
}

/** "rpgatlas_<gameId>_options" or "rpgatlas_options" — verbatim from the
 *  engine's optionsKey(). */
export function optionsKey(): string {
  const id = gameId();
  return id ? "rpgatlas_" + id + "_options" : "rpgatlas_options";
}

export class BrowserSaveRepository implements SaveRepository {
  private readonly driver: StorageDriver;

  constructor(driver: StorageDriver = localStorageDriver) {
    this.driver = driver;
  }

  /** The full stored slot payload ({ ts, mapName, level, data }) or null.
   *  Reads the current key, then the pre-rebrand "driftwood_*" fallback. */
  readSlot(slot: number): any | null {
    try {
      const raw =
        this.driver.getItem(saveKey(slot)) ||
        this.driver.getItem(saveKey(slot).replace(/^rpgatlas/, "driftwood"));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** Write a slot payload. Returns false on quota/unavailable so the caller
   *  shows the storage-full message (the try/catch mirrors saveLoadMenu). */
  writeSlot(slot: number, payload: any): boolean {
    try {
      this.driver.setItem(saveKey(slot), JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  /** Parsed options object, or {} on missing/corrupt (loadOptions()). */
  readOptions(): any {
    try {
      const raw = this.driver.getItem(optionsKey());
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  /** Persist options; silently drops on failure (saveOptions()). */
  writeOptions(options: any): void {
    try {
      this.driver.setItem(optionsKey(), JSON.stringify(options));
    } catch {
      /* storage full or unavailable — options simply don't persist */
    }
  }
}

/** The shared browser save repository over window.localStorage. */
export const browserSaveRepository = new BrowserSaveRepository();
