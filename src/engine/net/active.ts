/* RPGAtlas — src/engine/net/active.ts
   Project Beacon MP4·B: the live room references. `active.host` is set while
   this tab hosts a room; `active.client` is set while it has joined one. Both
   are null in solo — the loop and map tick check them to fork, and a null check
   is a no-op, so single-player is byte-identical. Kept in a tiny module of its
   own so the loop can read it without importing the (DOM-adjacent) co-op flow.
   GPL-3.0-or-later (see LICENSE). */

import type { RoomHost } from "./room-host.js";
import type { RoomClient } from "./room-client.js";

export const active: { host: RoomHost | null; client: RoomClient | null } = {
  host: null,
  client: null,
};
