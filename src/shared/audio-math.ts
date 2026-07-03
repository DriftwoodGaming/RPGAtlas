/* RPGAtlas — src/shared/audio-math.ts
   Pure audio-v2 math (Phase 6 Stage D), split from audio-deck.ts so it can
   be imported without the classic-script deps bridge (window.RPGAtlasDeps):
   the ambience-layer differ and the positional-SE pan/gain curve. Consumed
   by the deck, the interpreter's positional `se` command, and vitest.
   GPL-3.0-or-later (see LICENSE). */

import { isAssetKey } from "./asset-library";

export interface AmbienceLayer {
  key: string;
  vol?: number;
}

/** Diff the running ambience layers against a map's wanted list. */
export function ambienceDiff(
  current: { key: string; vol: number }[],
  wanted: AmbienceLayer[],
): { start: { key: string; vol: number }[]; stop: string[]; retune: { key: string; vol: number }[] } {
  const want = new Map<string, number>();
  for (const l of wanted || []) {
    if (l && isAssetKey(l.key)) want.set(l.key, l.vol == null ? 1 : Math.max(0, Math.min(1, l.vol)));
  }
  const have = new Map(current.map((l) => [l.key, l.vol]));
  const start: { key: string; vol: number }[] = [];
  const retune: { key: string; vol: number }[] = [];
  const stop: string[] = [];
  for (const [key, vol] of want) {
    if (!have.has(key)) start.push({ key, vol });
    else if (have.get(key) !== vol) retune.push({ key, vol });
  }
  for (const key of have.keys()) if (!want.has(key)) stop.push(key);
  return { start, stop, retune };
}

/** Stereo pan + distance gain for a positional SE, from the sound's tile
 *  offset relative to the listener (the player). Pan follows horizontal
 *  offset (full at ±8 tiles); gain falls linearly from 1 (≤ 1 tile) to 0 at
 *  `maxDist` tiles (default 12). */
export function panGainForTile(dx: number, dy: number, maxDist = 12): { pan: number; vol: number } {
  const pan = Math.max(-1, Math.min(1, dx / 8));
  const dist = Math.sqrt(dx * dx + dy * dy);
  const vol = dist <= 1 ? 1 : Math.max(0, 1 - (dist - 1) / (maxDist - 1));
  return { pan, vol };
}
