/* RPGAtlas — src/engine/co-op.ts
   Project Beacon MP4·B + MP5·C: the engine-facing "Play Together" flow.

   Two paths share this DOM/engine glue (read the project, drive the map scene,
   show presence toasts; the protocol itself is headless, under net/):
   - LOCAL TEST (MP4·B): `createRoom`/`joinRoom` turn a running solo game into a
     BroadcastChannel host, or a fresh tab into a joined client — same-machine,
     no server (net/room-host.ts, net/room-client.ts). Reached only via the
     RPGATLAS_MP dev hook.
   - RELAY (MP5·C): `playTogether()` is the real title-screen flow — connect to a
     Beacon server over `wss://`, Create (server assigns a code) or Join by code,
     with friendly errors. Both endpoints are CLIENTS; the server is the one
     authority (net/relay-client.ts, net/socket-transport.ts).

   Nothing here runs in solo — a game only reaches it through the RPGATLAS_MP hook
   or the gated "Play Together" title entry (shown only when the project enables
   multiplayer, absent in the frozen fixtures), so single-player is byte-identical.
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
import { RelayClient } from "./net/relay-client.js";
import { connectSocket, isAllowedRelayUrl } from "./net/socket-transport.js";
import { renderDirective } from "./scenes/directive-renderer.js";
import { loadMap, initPlayer, syncFollowers } from "./scenes/map-runtime.js";
import { generateRoomCode, normalizeRoomCode, formatRoomCode } from "../shared/net/room-code.js";
import { resetSession } from "./net/session.js";
import type { PlayerState } from "../shared/sim/players.js";
import type { ErrorCode } from "../shared/net/protocol.js";

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

/* ── MP5·C: the relay "Play Together" title flow ──────────────────────────── */

/** Driftwood's hosted relay (default). A game can override it in the DB
 *  (system.multiplayer.relayUrl — MP7 authoring UI); dev/test overrides via
 *  `?relay=` or window.RPGATLAS_MP.relayUrl. No real relay is deployed in MP5 —
 *  the default is a placeholder the self-hosted/dev flow overrides. */
export const DEFAULT_RELAY_URL = "wss://beacon.rpgatlas.app";

/** True when this project turns on multiplayer (the gate for showing the "Play
 *  Together" title entry). Additive + absent in the frozen fixtures → the title
 *  screen stays byte-identical. The DB toggle that sets it is MP7. */
export function multiplayerEnabled(): boolean {
  const mp = ctx.proj && ctx.proj.system && (ctx.proj.system as any).multiplayer;
  return !!(mp && mp.enabled);
}

/** Resolve the relay URL: dev override → project setting → default. */
function relayUrl(): string {
  try {
    const q = new URLSearchParams(location.search).get("relay");
    if (q) return q;
  } catch { /* no location (headless) */ }
  const dev = (globalThis as any).RPGATLAS_MP && (globalThis as any).RPGATLAS_MP.relayUrl;
  if (dev) return dev;
  const mp = ctx.proj && ctx.proj.system && (ctx.proj.system as any).multiplayer;
  return (mp && mp.relayUrl) || DEFAULT_RELAY_URL;
}

/** Plain-language copy for a server error (audience-beginners rule — a kid reads
 *  this, never a code or a stack trace). */
function friendlyError(code: ErrorCode | "offline"): string {
  switch (code) {
    case "room-not-found":
    case "bad-code":
      return "Couldn't find that room — check the code and try again.";
    case "room-full":
      return "That room is full. Ask your friend to make a new one.";
    case "rate-limited":
      return "Too many tries — wait a moment, then try again.";
    case "proto-mismatch":
      return "This game needs an update to play together.";
    case "offline":
      return "Couldn't reach the play server. Check your connection and try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

/** Plain-language copy for being disconnected by the server. */
function friendlyKick(code: "kicked" | "banned" | "room-closed" | "idle"): string {
  switch (code) {
    case "kicked": return "You were removed from the room.";
    case "banned": return "You can't rejoin this room.";
    case "room-closed": return "The room was closed.";
    case "idle": return "You were away too long and left the room.";
  }
}

/** Connect to the relay as a CREATE (no code) or JOIN (code). Wires a
 *  RelayClient with the engine reconstruction hooks + friendly error handling.
 *  `onFail` fires (with copy already chosen) if the attempt can't proceed. */
function connectRelay(
  name: string,
  code: string | undefined,
  onWelcome: (roomCode: string) => void,
  onFail: (message: string) => void,
): RelayClient | null {
  const url = relayUrl();
  if (!isAllowedRelayUrl(url)) { onFail("This game's play server address isn't safe to use (must be wss://)."); return null; }
  let settled = false;
  let transport;
  try {
    transport = connectSocket(url, {
      onClose: () => { if (!settled) { settled = true; onFail(friendlyError("offline")); } },
      onError: () => { if (!settled) { settled = true; onFail(friendlyError("offline")); } },
    });
  } catch {
    onFail(friendlyError("offline"));
    return null;
  }
  const client = new RelayClient(defaultWorld, transport, {
    name: (name || "Player").slice(0, 24),
    code,
    onWelcome: (_pid, roomCode) => { settled = true; onWelcome(roomCode); },
    onSnapshot: reconstructClient,
    onLocal: writeLocalPlayer,
    onPresence: (p) => { if (p.kind === "join") toast((p.name || "Someone") + " joined"); },
    renderDirective,
    onError: (c) => { if (!settled) { settled = true; onFail(friendlyError(c)); } },
    onKick: (c) => { toast(friendlyKick(c)); leaveRelay(); },
  });
  active.client = client;
  return client;
}

/** Tear down the current relay session and return to solo (title). */
export function leaveRelay(): void {
  if (active.client) { active.client.close(); active.client = null; }
  resetSession();
}

/** Open the "Play Together" modal (the gated title entry calls this). A small,
 *  inline-styled, kid-readable form: enter a name, then Create a room (shows the
 *  code to share) or Join by code. English strings in MP5; i18n is MP7. Resolves
 *  true when a room was entered (the game has started — the caller stops the
 *  title menu) or false when cancelled (the caller re-shows the title). */
export function playTogether(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
  if (!ctx.uiLayer) { resolve(false); return; }
  const back = el("div", "mp-modal-back");
  back.style.cssText =
    "position:absolute;inset:0;background:rgba(0,0,0,0.55);z-index:200;display:flex;" +
    "align-items:center;justify-content:center;font-family:system-ui,sans-serif;";
  const card = el("div", "mp-modal");
  card.style.cssText =
    "background:#232a3a;color:#fff;border-radius:14px;padding:22px 24px;min-width:300px;max-width:360px;" +
    "box-shadow:0 12px 40px rgba(0,0,0,0.5);text-align:center;";
  back.appendChild(card);
  const h = el("div"); h.textContent = "Play Together"; h.style.cssText = "font-weight:700;font-size:20px;margin-bottom:12px;";
  const nameLabel = el("div"); nameLabel.textContent = "Your name"; nameLabel.style.cssText = "font-size:12px;opacity:.75;text-align:left;margin-bottom:4px;";
  const nameIn = document.createElement("input");
  nameIn.type = "text"; nameIn.maxLength = 24; nameIn.value = ((G.party && G.party[0] && G.party[0].name) || "Player").slice(0, 24);
  nameIn.style.cssText = "width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid #3a4358;background:#1a2130;color:#fff;font-size:15px;margin-bottom:14px;";
  const status = el("div"); status.style.cssText = "font-size:13px;min-height:18px;margin:10px 0;color:#ffd27a;";
  const btnRow = el("div"); btnRow.style.cssText = "display:flex;gap:10px;justify-content:center;";
  const mkBtn = (label: string, primary: boolean): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText =
      "flex:1;padding:9px 12px;border-radius:9px;border:0;cursor:pointer;font-size:14px;font-weight:600;" +
      (primary ? "background:#4a86ff;color:#fff;" : "background:#39415a;color:#dfe6f5;");
    return b;
  };
  const createBtn = mkBtn("Create Room", true);
  const joinBtn = mkBtn("Join a Room", false);
  const closeX = mkBtn("Cancel", false); closeX.style.marginTop = "10px"; closeX.style.background = "transparent"; closeX.style.color = "#9aa6bf";

  const setBusy = (busy: boolean): void => { createBtn.disabled = joinBtn.disabled = busy; };
  const enter = (roomCode: string, isHost: boolean): void => { status.textContent = ""; back.remove(); onRoomEntered(roomCode, isHost); resolve(true); };

  createBtn.onclick = (): void => {
    setBusy(true); status.textContent = "Creating a room…";
    connectRelay(nameIn.value, undefined,
      (roomCode) => enter(roomCode, true),
      (msg) => { setBusy(false); status.textContent = msg; },
    );
  };
  joinBtn.onclick = (): void => {
    // Reveal a code field on first click; connect on the second.
    if (!card.querySelector(".mp-code-in")) {
      const codeLabel = el("div"); codeLabel.textContent = "Room code"; codeLabel.style.cssText = "font-size:12px;opacity:.75;text-align:left;margin:4px 0;";
      const codeIn = document.createElement("input");
      codeIn.className = "mp-code-in"; codeIn.type = "text"; codeIn.placeholder = "XXX-XXX-XXX"; codeIn.maxLength = 13;
      codeIn.style.cssText = nameIn.style.cssText;
      card.insertBefore(codeLabel, status); card.insertBefore(codeIn, status);
      joinBtn.textContent = "Join";
      codeIn.focus();
      return;
    }
    const codeIn = card.querySelector<HTMLInputElement>(".mp-code-in")!;
    const norm = normalizeRoomCode(codeIn.value);
    if (!norm) { status.textContent = friendlyError("bad-code"); return; }
    setBusy(true); status.textContent = "Joining…";
    connectRelay(nameIn.value, norm,
      () => enter(norm, false),
      (msg) => { setBusy(false); status.textContent = msg; },
    );
  };
  closeX.onclick = (): void => { back.remove(); resolve(false); };

  btnRow.appendChild(createBtn); btnRow.appendChild(joinBtn);
  card.append(h, nameLabel, nameIn, btnRow, status, closeX);
  ctx.uiLayer.appendChild(back);
  nameIn.focus();
  });
}

/** After welcome: the snapshot has already landed the player on the map
 *  (reconstructClient). Show the room code so the host can share it. */
function onRoomEntered(roomCode: string, isHost: boolean): void {
  if (isHost) showRoomCodeBanner(roomCode);
  else toast("Joined room " + formatRoomCode(roomCode));
}

/** A persistent, dismissible banner with the room code to share (host). */
function showRoomCodeBanner(roomCode: string): void {
  if (!ctx.uiLayer) return;
  const bar = el("div", "mp-code-banner");
  bar.style.cssText =
    "position:absolute;top:10px;left:50%;transform:translateX(-50%);background:#232a3a;color:#fff;" +
    "padding:8px 14px;border-radius:10px;font-family:system-ui,sans-serif;font-size:14px;z-index:130;" +
    "box-shadow:0 6px 20px rgba(0,0,0,0.4);display:flex;gap:10px;align-items:center;";
  const label = el("span"); label.textContent = "Room code:";
  label.style.cssText = "opacity:.8;";
  const code = el("span"); code.textContent = formatRoomCode(roomCode);
  code.style.cssText = "font-weight:700;letter-spacing:1px;";
  const x = document.createElement("button");
  x.textContent = "✕"; x.style.cssText = "background:transparent;border:0;color:#9aa6bf;cursor:pointer;font-size:14px;";
  x.onclick = (): void => bar.remove();
  bar.append(label, code, x);
  ctx.uiLayer.appendChild(bar);
}
