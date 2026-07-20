/* RPGAtlas — src/engine/net/moderation.ts
   Project Beacon MP9·A: client-local mute (D4). Muting is INSTANT and never
   crosses the wire — a muted player's chat/emote bubbles are simply not drawn on
   THIS device (render-glue checks `isMuted`), and it costs the muter nothing to
   toggle. Because it never leaves the device it carries no privacy surface (D6)
   and needs no server round-trip. Kept in a tiny module so both the renderer and
   the social panel can read it without importing the co-op flow.
   GPL-3.0-or-later (see LICENSE). */

const muted = new Set<number>();

/** Is this player id muted on this device? Hot path (render-glue) — a plain
 *  Set lookup; empty in solo / when nobody is muted, so it's free. */
export function isMuted(pid: number): boolean {
  return muted.size > 0 && muted.has(pid);
}

/** Toggle mute for a player; returns the new muted state. */
export function toggleMute(pid: number): boolean {
  if (muted.has(pid)) { muted.delete(pid); return false; }
  muted.add(pid);
  return true;
}

export function setMuted(pid: number, on: boolean): void {
  if (on) muted.add(pid);
  else muted.delete(pid);
}

/** Drop all mutes (leaving a room / returning to solo). */
export function clearMuted(): void {
  muted.clear();
}
