/* RPGAtlas — src/editor/database/multiplayer-tab.ts
   The Database "Multiplayer" tab (Project Beacon MP7·A): the authoring surface
   for online "Play Together" — the enable toggle that replaces the MP5 dev flag,
   room capacity, relay-server override, communication mode (D4 kid-safety
   defaults), the always-on preset-phrase list, and per-map spawn points for
   joining players. Every field writes to `proj.system.multiplayer`, which
   RA.normalizeMultiplayer backfills at every load boundary — additive and inert
   at its default (a game with multiplayer OFF stays byte-identical).
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { RA, editorState as S } from "../editor-state";
import { h, tIn, nIn, sel, chk, field, row, dbOpts } from "../dom";
import { touch } from "../persistence";

// Display-only mirror of the engine's co-op.ts DEFAULT_RELAY_URL (Driftwood's
// free relay). Kept as a literal so this editor tab never imports the engine
// runtime (which wires ctx/G at module load); the authored `relayUrl` field
// still overrides it at play time.
const DEFAULT_RELAY_URL = "wss://beacon.rpgatlas.app";

// Spawn-point direction options (string values, matching Dir on the wire).
const SPAWN_DIR_OPTS: any = [
  { v: "down", l: "Down" }, { v: "left", l: "Left" }, { v: "right", l: "Right" }, { v: "up", l: "Up" },
];
SPAWN_DIR_OPTS.stringValues = true;

const CHAT_OPTS: any = [
  { v: "off", l: "Emotes + preset phrases only (safest)" },
  { v: "presets", l: "Emotes + preset phrases only" },
  { v: "text", l: "Filtered free-text chat (opt-in)" },
];
CHAT_OPTS.stringValues = true;

export function multiplayerTab() {
  // Ensure the block exists + is well-formed (migrateProject already did this at
  // load; re-normalizing here is idempotent and guards a stale in-session doc).
  const mp: any = (S.proj.system as any).multiplayer = RA.normalizeMultiplayer((S.proj.system as any).multiplayer);
  const box = h("div", { class: "dbform single" });

  box.appendChild(h("div", { class: "subhead", style: "margin-top:0" }, "Play Together (online multiplayer)"));
  box.appendChild(h("div", { class: "dim" },
    "Turn this on to let friends join this game online with a room code. It stays completely off until you tick the box — a game with multiplayer off plays exactly as before. Friends connect only to a play server (never to each other), and no names, emails, or accounts are collected."));
  box.appendChild(row(field("Enable Play Together", chk(mp, "enabled"))));

  box.appendChild(h("div", { class: "subhead" }, "Friend room"));
  box.appendChild(row(
    field("Max players in a room (2–16)", nIn(mp, "maxPlayers", 2, 16)),
    field("Play server address (blank = Driftwood's free server)", tIn(mp, "relayUrl"))));
  box.appendChild(h("div", { class: "dim" },
    "Leave the address blank to use Driftwood's free play server (" + DEFAULT_RELAY_URL + "). "
    + "Run your own world? Put your wss:// server address here. Room capacity can be smaller than the server allows, never larger."));

  // ---- Communication mode (D4 kid-safety) ----
  box.appendChild(h("div", { class: "subhead" }, "Talking to each other"));
  const chatNote = h("div", { class: "dim" });
  function redrawChatNote() {
    chatNote.innerHTML = "";
    if (mp.chatMode === "text") {
      chatNote.appendChild(h("strong", null, "Free-text chat is on. "));
      chatNote.appendChild(document.createTextNode(
        "Players can type messages to each other (run through a bad-word filter, with mute and report built in). "
        + "Only turn this on if you're okay with players typing whatever they like. Emotes and your preset phrases always work too."));
    } else {
      chatNote.appendChild(document.createTextNode(
        "Players chat with emotes and the preset phrases you write below — no free typing. This is the safest choice and the default."));
    }
  }
  box.appendChild(row(field("Chat mode", sel(mp, "chatMode", CHAT_OPTS, () => { redrawChatNote(); }))));
  box.appendChild(chatNote);
  redrawChatNote();

  box.appendChild(h("div", { class: "subhead" }, "Preset phrases"));
  box.appendChild(h("div", { class: "dim" }, "Short things players can say with one tap (one per line). These always work, even with free-text chat off. Example: “Follow me!”, “Nice one!”, “Need healing!”"));
  const presetTa = h("textarea", { rows: 4, oninput(e: any) {
    mp.presets = String(e.target.value).split("\n").map((s: string) => s.trim()).filter(Boolean).slice(0, 24);
    touch();
  } }, (mp.presets || []).join("\n"));
  box.appendChild(field("Phrases", presetTa));

  // ---- Per-map spawn points ----
  box.appendChild(h("div", { class: "subhead" }, "Where players appear"));
  box.appendChild(h("div", { class: "dim" }, "By default everyone joins at the game's start position. Add a spawn point to place joining players somewhere specific on a map (handy for a lobby or hub map)."));
  const spawnWrap = h("div");
  box.appendChild(spawnWrap);
  redrawSpawns();

  return box;

  function redrawSpawns() {
    spawnWrap.innerHTML = "";
    const spawns = mp.spawns || (mp.spawns = {});
    const ids = Object.keys(spawns).map(Number).sort((a, b) => a - b);
    for (const id of ids) {
      const sp = spawns[id];
      const map = RA.byId(S.proj.maps, id);
      const label = map ? map.name : "(deleted map #" + id + ")";
      const del = h("button", { class: "mini", title: "Remove spawn point", onclick() { delete spawns[id]; touch(); redrawSpawns(); } }, "−");
      spawnWrap.appendChild(row(
        h("span", { class: "fld" }, h("span", null, label)),
        field("X", nIn(sp, "x", 0, 999)),
        field("Y", nIn(sp, "y", 0, 999)),
        field("Facing", sel(sp, "dir", SPAWN_DIR_OPTS)),
        del));
    }
    if (!ids.length) spawnWrap.appendChild(h("div", { class: "dim" }, "No spawn points — everyone joins at the start position."));
    // "Add spawn point" row: pick any map without one yet.
    const remaining = (S.proj.maps || []).filter((m: any) => spawns[m.id] == null);
    if (remaining.length) {
      const pick = { v: remaining[0].id };
      const add = h("button", { class: "mini", onclick() {
        const id = Number(pick.v) || remaining[0].id;
        if (spawns[id] == null) { spawns[id] = { x: 0, y: 0, dir: "down" }; touch(); redrawSpawns(); }
      } }, "＋ Add spawn point");
      spawnWrap.appendChild(row(field("Map", sel(pick, "v", dbOpts(remaining))), add));
    }
  }
}
