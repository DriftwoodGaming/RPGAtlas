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

import { ctx, fns } from "./state/engine-context.js";
import { G, makeActor, addInv } from "./state/game-state.js";
import { el, esc } from "./util.js";
import { defaultWorld } from "./state/default-world.js";
import { applyBattleEnd } from "./scenes/battle-coop.js";
import type { BattleEvent } from "../shared/sim/coop-battle.js";
import type { PartyChange } from "../shared/sim/party.js";
import { soloHost } from "./net/solo-session.js";
import { active } from "./net/active.js";
import { RoomHost } from "./net/room-host.js";
import { RoomClient, type RoomSnapshot } from "./net/room-client.js";
import { RelayClient } from "./net/relay-client.js";
import { connectSocket, isAllowedRelayUrl } from "./net/socket-transport.js";
import { renderDirective } from "./scenes/directive-renderer.js";
import { loadMap, initPlayer, syncFollowers } from "./scenes/map-runtime.js";
import { generateRoomCode, normalizeRoomCode, formatRoomCode } from "../shared/net/room-code.js";
import { resetSession, session } from "./net/session.js";
import { loadOrCreatePassport, exportPassportText, importPassportText } from "./net/passport-store.js";
import { mpText } from "./mp-i18n.js";
import type { PlayerState } from "../shared/sim/players.js";
import type { ErrorCode } from "../shared/net/protocol.js";

/** Host a room from an ALREADY-running game (player 0 = G.player). Returns the
 *  room code to share. The host keeps playing exactly as solo; peers join. */
export function createRoom(name: string): string {
  const code = generateRoomCode();
  myName = (name || "Host").slice(0, 24);
  active.host = new RoomHost(soloHost.world, soloHost, code, {
    localName: myName,
    localCharset: (G.party && G.party[0] && G.party[0].charset) || "",
    onPresence: (p) => {
      if (p.kind === "join") toast(mpText("playerJoined", { name: p.name || mpText("someone") }));
      firePresencePlugins(p);
    },
    onCustom: onCustomMessage, // MP7·C: a client's plugin message → host plugins
  });
  return code;
}

/** Join a room by (raw, human-typed) code. Returns the RoomClient, or null if
 *  the code isn't valid (the caller shows the friendly "check the code" copy).
 *  The tab becomes a client: its world mirrors the host's from here. */
export function joinRoom(rawCode: string, name: string): RoomClient | null {
  const code = normalizeRoomCode(rawCode);
  if (!code) return null;
  myName = (name || "Player").slice(0, 24);
  const client = new RoomClient(defaultWorld, code, {
    name: myName,
    onSnapshot: reconstructClient,
    onLocal: writeLocalPlayer,
    onPresence: (p) => {
      if (p.kind === "join") toast(mpText("playerJoined", { name: p.name || mpText("someone") }));
      firePresencePlugins(p);
    },
    renderDirective,
    onParty: onPartyChange,
    onBattle: onBattleEvent,
    onCustom: onCustomMessage,
  });
  active.client = client;
  return client;
}

/** MP6·A: my party membership changed — kid-readable feedback. */
function onPartyChange(change: PartyChange): void {
  if (change.joined) {
    toast(mpText("youJoinedParty"));
    return;
  }
  if (change.left) {
    toast(mpText("youLeftParty"));
    return;
  }
  for (const pid of change.newMates) {
    const e = defaultWorld.roster.players.get(pid);
    toast(mpText("friendJoinedParty", { name: (e && e.name) || mpText("aFriend") }));
  }
}

/** MP6·B: shared-battle events addressed to me. `start` opens a simple battle
 *  overlay (the remote participant's window on a fight running on the host);
 *  `round`/`log` stream into it; `itemUsed` decrements MY OWN inventory (the
 *  host spent one of my items — D-6-7); `end` applies the end frame (exp / loot
 *  / gold / battler write-back — the authority rolled every draw), closes the
 *  overlay and toasts the result. The battleCmd command UI itself renders
 *  through directive-renderer, on top of this overlay. */
function onBattleEvent(ev: BattleEvent): void {
  if (ev.ev === "start") {
    battleOverlay.open(ev.names);
    toast(mpText("battleStart", { names: ev.names.join(", ") }));
    return;
  }
  if (ev.ev === "round") {
    battleOverlay.line("— Round " + ev.n + " —", true);
    return;
  }
  if (ev.ev === "log") {
    battleOverlay.line(ev.text);
    return;
  }
  if (ev.ev === "itemUsed") {
    // The authority consumed one of my items resolving my battler's command;
    // decrement my own bag now (the host never held it).
    addInv("item", ev.id, -1);
    return;
  }
  if (ev.ev !== "end") return;
  const lines = applyBattleEnd(ev);
  battleOverlay.close();
  toast(
    ev.result === "win"
      ? mpText("victory")
      : ev.result === "escape"
        ? mpText("escaped")
        : mpText("battleOver"),
  );
  if (lines.length) toast(lines.join("  ·  "));
}

/** The remote participant's battle overlay: a compact, inline-styled log panel
 *  (no editor.css touch, no cache-bust). Opened on `start`, fed by `round`/
 *  `log`, torn down on `end`. The battleCmd command windows stack above it. */
const battleOverlay = {
  box: null as HTMLElement | null,
  logEl: null as HTMLElement | null,
  open(names: string[]): void {
    if (!ctx.uiLayer) return;
    this.close();
    const box = el("div", "mp-battle-overlay");
    box.style.cssText =
      "position:absolute;top:10px;left:50%;transform:translateX(-50%);width:min(88%,420px);" +
      "background:rgba(20,24,34,0.92);color:#fff;border-radius:12px;padding:10px 14px;z-index:115;" +
      "font-family:system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,0.45);pointer-events:none;";
    const title = el("div");
    title.textContent = mpText("battleWith", { names: names.join(", ") });
    title.style.cssText = "font-weight:700;font-size:14px;margin-bottom:6px;text-align:center;";
    const logEl = el("div", "mp-battle-log");
    logEl.style.cssText =
      "font-size:12px;line-height:1.5;max-height:96px;overflow:hidden;opacity:.92;";
    box.append(title, logEl);
    ctx.uiLayer.appendChild(box);
    this.box = box;
    this.logEl = logEl;
  },
  line(text: string, strong = false): void {
    if (!this.logEl) return;
    const row = el("div");
    row.innerHTML = strong ? "<b>" + esc(text) + "</b>" : esc(text);
    if (strong) row.style.cssText = "margin-top:3px;color:#ffd27a;";
    this.logEl.appendChild(row);
    // keep the panel bounded — show the most recent few beats only
    while (this.logEl.children.length > 6) this.logEl.removeChild(this.logEl.firstChild!);
  },
  close(): void {
    if (this.box) this.box.remove();
    this.box = null;
    this.logEl = null;
  },
};

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

/** Apply the local player's authoritative position from the host (client).
 *  MP6·A (A-2): when the authority reports ME on another map (the party
 *  followed its leader through a transfer), load that map first and land on
 *  the reported tile; position writes pause while the load is in flight. */
let clientMapSwitching = false;
function writeLocalPlayer(s: PlayerState): void {
  const p = G.player;
  if (!p) return;
  if (clientMapSwitching) return; // don't fight the in-flight map load
  if (s.mapId !== G.mapId) {
    clientMapSwitching = true;
    void (async () => {
      try {
        await loadMap(s.mapId);
        const me = G.player;
        me.x = me.tx = s.x;
        me.y = me.ty = s.y;
        me.rx = me.prx = s.rx;
        me.ry = me.pry = s.ry;
        me.dir = s.dir;
        me.moving = false;
        me.route = null;
        syncFollowers(true);
      } finally {
        clientMapSwitching = false;
      }
    })();
    return;
  }
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

// The host's own party feedback (map.ts handlePartyIntent) reaches the toast
// through the late-bound registry — no scene↔co-op import cycle.
fns.mpToast = toast;

/* ── MP7·C: the plugin multiplayer surface (the 2.0 net unfreeze) ──────────
   Presence + custom messages reach the game's plugins through the plugin
   runtime's hook arrays (fns.Plugins, late-bound). `fns.mp` gives atlas.mp its
   send/read operations without the plugin runtime importing the net tree. All
   inert in solo (no host/client ⇒ isOnline false, no players, sendCustom a
   no-op), so a game with no multiplayer is byte-identical. */

/** The world whose roster the local tab reads (host: the authority; client: the
 *  mirror). Both keep OTHER players in `roster.players`; the local player is
 *  `roster.local`. */
function rosterWorld() {
  return active.host ? soloHost.world : defaultWorld;
}

/** Fire a plugin multiplayer hook (playerJoin / playerLeave / custom), guarded
 *  so it is a no-op when no plugin runtime is present (headless tests). */
function firePlugins(name: string, arg: unknown): void {
  const P = (fns as any).Plugins;
  if (P && typeof P.fire === "function") P.fire(name, arg);
}

/** Dispatch a presence event to the plugin join/leave hooks (in addition to the
 *  toast). Emote/say are not plugin-facing here (they render as bubbles). */
function firePresencePlugins(p: { kind: string; playerId: number; name?: string }): void {
  if (p.kind === "join") firePlugins("playerJoin", { id: p.playerId, name: p.name || "" });
  else if (p.kind === "leave") {
    const e = rosterWorld().roster.players.get(p.playerId);
    firePlugins("playerLeave", { id: p.playerId, name: (e && e.name) || p.name || "" });
  }
}

/** A plugin custom message arrived from another player → the game's plugins. */
function onCustomMessage(msg: { from: number; data: unknown }): void {
  firePlugins("custom", msg);
}

/** This tab's own display name, remembered at connect time so atlas.mp.self()
 *  can report it (the roster only stores OTHER players' names). */
let myName = "";

// atlas.mp's operations, late-bound so plugin-runtime.ts never imports the net
// tree. Solo-inert (no active session).
(fns as any).mp = {
  sendCustom(data: unknown): void {
    if (active.host) active.host.sendCustom(data as never);
    else if (active.client) active.client.sendCustom(data as never);
  },
  isOnline(): boolean {
    return !!(active.host || active.client);
  },
  self(): { id: number; name: string } {
    return { id: rosterWorld().roster.local, name: myName };
  },
  players(): Array<{ id: number; name: string }> {
    const w = rosterWorld();
    const out: Array<{ id: number; name: string }> = [{ id: w.roster.local, name: myName }];
    for (const e of w.roster.players.values()) out.push({ id: e.id, name: e.name || "" });
    return out;
  },
};

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
      return mpText("errRoomNotFound");
    case "room-full":
      return mpText("errRoomFull");
    case "rate-limited":
      return mpText("errRateLimited");
    case "proto-mismatch":
      return mpText("errProtoMismatch");
    case "auth-failed":
      return mpText("errAuthFailed");
    case "offline":
      return mpText("errOffline");
    default:
      return mpText("errGeneric");
  }
}

/** Plain-language copy for being disconnected by the server. */
function friendlyKick(code: "kicked" | "banned" | "room-closed" | "idle" | "replaced"): string {
  switch (code) {
    case "kicked": return mpText("kickKicked");
    case "banned": return mpText("kickBanned");
    case "room-closed": return mpText("kickRoomClosed");
    case "idle": return mpText("kickIdle");
    case "replaced": return mpText("kickReplaced"); // MP8·A: world passport signed in elsewhere
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
  if (!isAllowedRelayUrl(url)) { onFail(mpText("errBadRelay")); return null; }
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
  myName = (name || "Player").slice(0, 24);
  const client = new RelayClient(defaultWorld, transport, {
    name: myName,
    code,
    onWelcome: (_pid, roomCode) => { settled = true; onWelcome(roomCode); },
    onSnapshot: reconstructClient,
    onLocal: writeLocalPlayer,
    onPresence: (p) => { if (p.kind === "join") toast(mpText("playerJoined", { name: p.name || mpText("someone") })); firePresencePlugins(p); },
    renderDirective,
    onError: (c) => { if (!settled) { settled = true; onFail(friendlyError(c)); } },
    onKick: (c) => { toast(friendlyKick(c)); leaveRelay(); },
    onParty: onPartyChange,
    onBattle: onBattleEvent,
    onCustom: onCustomMessage,
  });
  active.client = client;
  return client;
}

/** The world address of the current session (for a handoff re-dial). */
let lastWorldUrl = "";

/** Connect to a persistent WORLD by address (Project Beacon MP8·B, D-8-4). A
 *  world requires a passport (D3): the device passport (auto-created on first
 *  use — a kid never sees a signup) answers the server's `challenge`, and the
 *  join is codeless (a world has one shared room). `onEntered` fires on welcome;
 *  the snapshot has already landed the player on their saved tile. */
function connectWorld(name: string, url: string, onEntered: () => void, onFail: (message: string) => void): void {
  if (!isAllowedRelayUrl(url)) { onFail(mpText("errBadRelay")); return; }
  myName = (name || "Player").slice(0, 24);
  void (async () => {
    let passport;
    try {
      passport = await loadOrCreatePassport(myName);
    } catch {
      onFail(friendlyError("auth-failed"));
      return;
    }
    let settled = false;
    let transport;
    try {
      transport = connectSocket(url, {
        onClose: () => { if (!settled) { settled = true; onFail(friendlyError("offline")); } },
        onError: () => { if (!settled) { settled = true; onFail(friendlyError("offline")); } },
      });
    } catch {
      onFail(friendlyError("offline"));
      return;
    }
    lastWorldUrl = url;
    active.client = new RelayClient(defaultWorld, transport, {
      name: myName,
      passport,
      onWelcome: () => { settled = true; onEntered(); },
      onSnapshot: reconstructClient,
      onLocal: writeLocalPlayer,
      onPresence: (p) => { if (p.kind === "join") toast(mpText("playerJoined", { name: p.name || mpText("someone") })); firePresencePlugins(p); },
      renderDirective,
      onError: (c) => { if (!settled) { settled = true; onFail(friendlyError(c)); } },
      onKick: (c) => { toast(friendlyKick(c)); leaveRelay(); },
      onHandoff: (h) => reconnectWorld(h.url || lastWorldUrl, h.token),
      onParty: onPartyChange,
      onBattle: onBattleEvent,
      onCustom: onCustomMessage,
    });
  })();
}

/** Handoff re-dial (the CF socket-per-zone path, D-8-1 / carried as D-8-7): the
 *  server moved us to another zone DO. Re-open the target and RESUME with the
 *  handoff token — same passport, same world. Single-DO worlds never emit a
 *  handoff (in-process gateway transfer), so this is the multi-DO scale arm. */
function reconnectWorld(url: string, token: string): void {
  if (active.client) { active.client.close(); active.client = null; }
  if (!isAllowedRelayUrl(url)) return;
  void (async () => {
    const passport = await loadOrCreatePassport(myName).catch(() => null);
    if (!passport) return;
    let transport;
    try {
      transport = connectSocket(url, {});
    } catch {
      return;
    }
    lastWorldUrl = url;
    active.client = new RelayClient(defaultWorld, transport, {
      name: myName,
      passport,
      resume: { code: session.roomCode, token },
      onSnapshot: reconstructClient,
      onLocal: writeLocalPlayer,
      onPresence: (p) => firePresencePlugins(p),
      renderDirective,
      onKick: (c) => { toast(friendlyKick(c)); leaveRelay(); },
      onHandoff: (h) => reconnectWorld(h.url || url, h.token),
      onParty: onPartyChange,
      onBattle: onBattleEvent,
      onCustom: onCustomMessage,
    });
  })();
}

/** Export the device passport to a file the player carries to another device
 *  (D3 — the passport is the same trust tier as a save file). User-initiated. */
function exportPassportFile(): void {
  const text = exportPassportText();
  if (!text || typeof document === "undefined") { toast(mpText("passportBadFile")); return; }
  try {
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "rpgatlas-passport.json";
    a.click();
    setTimeout(() => { try { URL.revokeObjectURL(a.href); } catch { /* */ } }, 1000);
    toast(mpText("passportSaved"));
  } catch {
    toast(mpText("passportBadFile"));
  }
}

/** Import a passport file (replaces the device passport after strict validation
 *  — a corrupt file can never half-load; passport-store guarantees it). */
function importPassportFile(onDone?: () => void): void {
  if (typeof document === "undefined") return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json,text/plain";
  input.onchange = (): void => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (): void => {
      const p = importPassportText(String(reader.result || ""));
      toast(p ? mpText("passportLoaded") : mpText("passportBadFile"));
      onDone?.();
    };
    reader.onerror = (): void => toast(mpText("passportBadFile"));
    reader.readAsText(file);
  };
  input.click();
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
  const h = el("div"); h.textContent = mpText("playTogether"); h.style.cssText = "font-weight:700;font-size:20px;margin-bottom:12px;";
  const nameLabel = el("div"); nameLabel.textContent = mpText("yourName"); nameLabel.style.cssText = "font-size:12px;opacity:.75;text-align:left;margin-bottom:4px;";
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
  const createBtn = mkBtn(mpText("createRoom"), true);
  const joinBtn = mkBtn(mpText("joinRoom"), false);
  const worldBtn = mkBtn(mpText("joinWorld"), false); worldBtn.style.flex = "unset"; worldBtn.style.width = "100%";
  const closeX = mkBtn(mpText("cancel"), false); closeX.style.marginTop = "10px"; closeX.style.background = "transparent"; closeX.style.color = "#9aa6bf";

  const setBusy = (busy: boolean): void => { createBtn.disabled = joinBtn.disabled = worldBtn.disabled = busy; };
  const enter = (roomCode: string, isHost: boolean): void => { status.textContent = ""; back.remove(); onRoomEntered(roomCode, isHost); resolve(true); };
  // A world has no code to share; the snapshot already placed the player.
  const enterWorld = (): void => { status.textContent = ""; back.remove(); toast(mpText("enteredWorld")); resolve(true); };

  createBtn.onclick = (): void => {
    setBusy(true); status.textContent = mpText("creatingRoom");
    connectRelay(nameIn.value, undefined,
      (roomCode) => enter(roomCode, true),
      (msg) => { setBusy(false); status.textContent = msg; },
    );
  };
  joinBtn.onclick = (): void => {
    // Reveal a code field on first click; connect on the second.
    if (!card.querySelector(".mp-code-in")) {
      const codeLabel = el("div"); codeLabel.textContent = mpText("roomCodeField"); codeLabel.style.cssText = "font-size:12px;opacity:.75;text-align:left;margin:4px 0;";
      const codeIn = document.createElement("input");
      codeIn.className = "mp-code-in"; codeIn.type = "text"; codeIn.placeholder = "XXX-XXX-XXX"; codeIn.maxLength = 13;
      codeIn.style.cssText = nameIn.style.cssText;
      card.insertBefore(codeLabel, status); card.insertBefore(codeIn, status);
      joinBtn.textContent = mpText("join");
      codeIn.focus();
      return;
    }
    const codeIn = card.querySelector<HTMLInputElement>(".mp-code-in")!;
    const norm = normalizeRoomCode(codeIn.value);
    if (!norm) { status.textContent = friendlyError("bad-code"); return; }
    setBusy(true); status.textContent = mpText("joining");
    connectRelay(nameIn.value, norm,
      () => enter(norm, false),
      (msg) => { setBusy(false); status.textContent = msg; },
    );
  };
  // Join a persistent WORLD by address (D-8-4): reveal an address field on the
  // first click, connect on the second (mirrors the Join-by-code reveal).
  worldBtn.onclick = (): void => {
    if (!card.querySelector(".mp-world-in")) {
      const addrLabel = el("div"); addrLabel.textContent = mpText("worldAddress"); addrLabel.style.cssText = "font-size:12px;opacity:.75;text-align:left;margin:4px 0;";
      const addrIn = document.createElement("input");
      addrIn.className = "mp-world-in"; addrIn.type = "text"; addrIn.placeholder = "wss://…"; addrIn.maxLength = 200;
      addrIn.style.cssText = nameIn.style.cssText;
      card.insertBefore(addrLabel, status); card.insertBefore(addrIn, status);
      worldBtn.textContent = mpText("join");
      addrIn.focus();
      return;
    }
    const addrIn = card.querySelector<HTMLInputElement>(".mp-world-in")!;
    const url = addrIn.value.trim();
    if (!url) { status.textContent = mpText("errBadRelay"); return; }
    setBusy(true); status.textContent = mpText("joining");
    connectWorld(nameIn.value, url, enterWorld, (msg) => { setBusy(false); status.textContent = msg; });
  };
  closeX.onclick = (): void => { back.remove(); resolve(false); };

  btnRow.appendChild(createBtn); btnRow.appendChild(joinBtn);
  const worldRow = el("div"); worldRow.style.cssText = "display:flex;margin-top:10px;";
  worldRow.appendChild(worldBtn);
  // Passport custody (D3): carry your device passport between devices.
  const ppRow = el("div"); ppRow.style.cssText = "display:flex;gap:8px;justify-content:center;margin-top:12px;";
  const ppExport = mkBtn(mpText("passportExport"), false);
  const ppImport = mkBtn(mpText("passportImport"), false);
  for (const b of [ppExport, ppImport]) { b.style.fontSize = "12px"; b.style.padding = "6px 8px"; b.style.background = "transparent"; b.style.color = "#9aa6bf"; b.style.border = "1px solid #3a4358"; }
  ppExport.onclick = (): void => exportPassportFile();
  ppImport.onclick = (): void => importPassportFile();
  ppRow.append(ppExport, ppImport);
  card.append(h, nameLabel, nameIn, btnRow, worldRow, status, ppRow, closeX);
  ctx.uiLayer.appendChild(back);
  nameIn.focus();
  });
}

/** After welcome: the snapshot has already landed the player on the map
 *  (reconstructClient). Show the room code so the host can share it. */
function onRoomEntered(roomCode: string, isHost: boolean): void {
  if (isHost) showRoomCodeBanner(roomCode);
  else toast(mpText("joinedRoom", { code: formatRoomCode(roomCode) }));
}

/** A persistent, dismissible banner with the room code to share (host). */
function showRoomCodeBanner(roomCode: string): void {
  if (!ctx.uiLayer) return;
  const bar = el("div", "mp-code-banner");
  bar.style.cssText =
    "position:absolute;top:10px;left:50%;transform:translateX(-50%);background:#232a3a;color:#fff;" +
    "padding:8px 14px;border-radius:10px;font-family:system-ui,sans-serif;font-size:14px;z-index:130;" +
    "box-shadow:0 6px 20px rgba(0,0,0,0.4);display:flex;gap:10px;align-items:center;";
  const label = el("span"); label.textContent = mpText("roomCodeLabel");
  label.style.cssText = "opacity:.8;";
  const code = el("span"); code.textContent = formatRoomCode(roomCode);
  code.style.cssText = "font-weight:700;letter-spacing:1px;";
  const x = document.createElement("button");
  x.textContent = "✕"; x.style.cssText = "background:transparent;border:0;color:#9aa6bf;cursor:pointer;font-size:14px;";
  x.onclick = (): void => bar.remove();
  bar.append(label, code, x);
  ctx.uiLayer.appendChild(bar);
}
