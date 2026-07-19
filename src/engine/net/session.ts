/* RPGAtlas — src/engine/net/session.ts
   Project Beacon MP4·B: the live session mode. Single-player is `solo` — the
   default, and the ONLY mode the frozen goldens ever run in, so it must stay
   byte-identical. "Play Together (local test)" flips this to `host` (this tab
   owns the authoritative world + tick and serves peers) or `client` (this tab
   mirrors a host's world over the BroadcastChannel transport and renders it).
   The loop and the map tick read `session.mode` to fork; everything reads
   `solo` until a room is created/joined. GPL-3.0-or-later (see LICENSE). */

export type SessionMode = "solo" | "host" | "client";

/** The one live session descriptor. `localPlayerId` is 0 for solo/host (the
 *  local player is player 0 / `G.player`) and the server-assigned id for a
 *  client. */
export const session: {
  mode: SessionMode;
  roomCode: string;
  localPlayerId: number;
  name: string;
} = { mode: "solo", roomCode: "", localPlayerId: 0, name: "" };

export function resetSession(): void {
  session.mode = "solo";
  session.roomCode = "";
  session.localPlayerId = 0;
  session.name = "";
}
