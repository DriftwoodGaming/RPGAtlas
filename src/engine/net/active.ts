/* RPGAtlas — src/engine/net/active.ts
   Project Beacon MP4·B: the live room references. `active.host` is set while
   this tab hosts a room; `active.client` is set while it has joined one. Both
   are null in solo — the loop and map tick check them to fork, and a null check
   is a no-op, so single-player is byte-identical. Kept in a tiny module of its
   own so the loop can read it without importing the (DOM-adjacent) co-op flow.
   GPL-3.0-or-later (see LICENSE). */

import type { RoomHost } from "./room-host.js";
import type { InputIntent } from "../../shared/net/protocol.js";

/** What the loop + map tick need from a joined client, satisfied by BOTH MP4's
 *  BroadcastChannel RoomClient and MP5's WebSocket RelayClient — so `active`
 *  stays transport-agnostic (the loop reads `session.mode`, not the class). */
export interface ClientLike {
  sendInput(intent: InputIntent): void;
  sendEmote(emote: string): void;
  sendChat(payload: { text?: string; preset?: number }): void;
  close(): void;
}

export const active: { host: RoomHost | null; client: ClientLike | null } = {
  host: null,
  client: null,
};
