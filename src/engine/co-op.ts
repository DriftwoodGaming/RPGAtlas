/* RPGAtlas — src/engine/co-op.ts
   Project Beacon MP4·B: the engine-facing "Play Together (local test)" flow —
   the composition that turns a running solo game into a host, or a fresh tab
   into a joined client, over the BroadcastChannel room protocol
   (net/room-host.ts, net/room-client.ts). This is the DOM/engine glue: it reads
   the project, drives the map scene, and shows presence toasts; the protocol
   itself is headless and lives under net/. Nothing here runs in solo — a game
   only reaches it through the dev entry (title, ?mp=1) or the RPGATLAS_MP hook,
   so single-player is byte-identical. The polished title-screen UI is MP5·C;
   MP4 ships the dev entry + programmatic hooks the two-context e2e drives.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { ctx } from "./state/engine-context.js";
import { G, makeActor } from "./state/game-state.js";
import { el } from "./util.js";
import { defaultWorld } from "./state/default-world.js";
import { soloHost } from "./net/solo-session.js";
import { active } from "./net/active.js";
import { RoomHost } from "./net/room-host.js";
import { RoomClient, type RoomSnapshot } from "./net/room-client.js";
import { renderDirective } from "./scenes/directive-renderer.js";
import { loadMap, initPlayer, syncFollowers } from "./scenes/map-runtime.js";
import { generateRoomCode, normalizeRoomCode } from "../shared/net/room-code.js";
import type { PlayerState } from "../shared/sim/players.js";

/** Host a room from an ALREADY-running game (player 0 = G.player). Returns the
 *  room code to share. The host keeps playing exactly as solo; peers join. */
export function createRoom(name: string): string {
  const code = generateRoomCode();
  active.host = new RoomHost(soloHost.world, soloHost, code, {
    localName: (name || "Host").slice(0, 24),
    localCharset: (G.party && G.party[0] && G.party[0].charset) || "",
    onPresence: (p) => {
      if (p.kind === "join") toast((p.name || "Someone") + " joined");
    },
  });
  return code;
}

/** Join a room by (raw, human-typed) code. Returns the RoomClient, or null if
 *  the code isn't valid (the caller shows the friendly "check the code" copy).
 *  The tab becomes a client: its world mirrors the host's from here. */
export function joinRoom(rawCode: string, name: string): RoomClient | null {
  const code = normalizeRoomCode(rawCode);
  if (!code) return null;
  const client = new RoomClient(defaultWorld, code, {
    name: (name || "Player").slice(0, 24),
    onSnapshot: reconstructClient,
    onLocal: writeLocalPlayer,
    onPresence: (p) => {
      if (p.kind === "join") toast((p.name || "Someone") + " joined");
    },
    renderDirective,
  });
  active.client = client;
  return client;
}

/** Client reconstruction from the host's snapshot: build the same map + party
 *  the host has (both tabs share the project), then land on the map. The
 *  authoritative positions arrive immediately after via onLocal + the roster. */
async function reconstructClient(snap: RoomSnapshot): Promise<void> {
  const sys = ctx.proj.system;
  G.party = (sys.party || []).slice(0, 4).map(makeActor).filter(Boolean);
  if (!G.party.length && ctx.proj.actors.length) G.party = [makeActor(ctx.proj.actors[0].id)];
  G.gold = sys.startGold || 0;
  G.timeOfDay = snap.timeOfDay != null ? snap.timeOfDay : 12;
  initPlayer(sys.startX, sys.startY, sys.startDir);
  await loadMap(snap.mapId);
  syncFollowers(true);
  // clear any title UI + reveal the map
  ctx.uiLayer.querySelectorAll(".titlewin, .titlemenu").forEach((n: any) => n.remove());
  ctx.scene = "map";
  if (ctx.fader) ctx.fader.style.opacity = 0;
}

/** Apply the local player's authoritative position from the host (client). */
function writeLocalPlayer(s: PlayerState): void {
  const p = G.player;
  if (!p) return;
  p.prx = p.rx;
  p.pry = p.ry;
  p.x = s.x;
  p.y = s.y;
  p.rx = s.rx;
  p.ry = s.ry;
  p.dir = s.dir;
  p.moving = s.moving;
  p.animT = s.animT;
}

/** A brief presence toast (join). Inline-styled so MP4 adds no player-facing
 *  CSS (no cache-bust); MP5·C gives presence a designed treatment. */
function toast(text: string): void {
  if (!ctx.uiLayer) return;
  const box = el("div", "mp-toast");
  box.textContent = text;
  box.style.cssText =
    "position:absolute;top:8px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.72);" +
    "color:#fff;padding:4px 12px;border-radius:8px;font:600 13px system-ui,sans-serif;z-index:120;" +
    "pointer-events:none;";
  ctx.uiLayer.appendChild(box);
  setTimeout(() => box.remove(), 3200);
}
