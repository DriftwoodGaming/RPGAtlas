/* RPGAtlas — src/engine/net/social-ui.ts
   Project Beacon MP9·A: the in-game "Players & Chat" panel — the always-on
   social layer (D4) plus the moderation tools. A small floating button appears
   only while a multiplayer session is live (co-op.ts mounts it on room/world
   entry, unmounts it on leave), so single-player is byte-identical (the frozen
   goldens never see it). Inline-styled like the rest of co-op.ts's UI, so it
   adds no editor.css and needs no cache-bust.

   Contents: emotes (always on) · the game's authored quick phrases (always on) ·
   free-text chat (only when the dev opted into chatMode:"text", D4) · a player
   list with instant client-local MUTE, plus REPORT (any player → the room
   owner / world operator) and, for the owner, KICK / BAN. The panel reads the
   live roster + chat config through the SocialApi the engine passes in; muting
   is local (net/moderation.ts). GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { ctx } from "../state/engine-context.js";
import { el } from "../util.js";
import { mpText } from "../mp-i18n.js";
import { isMuted, toggleMute } from "./moderation.js";
import type { ModAction } from "../../shared/net/protocol.js";

/** What the panel needs from the live session (co-op.ts supplies it). */
export interface SocialApi {
  emote(id: string): void;
  say(payload: { text?: string; preset?: number }): void;
  mod(action: ModAction, target: number, reason?: string): void;
  /** The OTHER players in the room (not the local player). */
  roster(): Array<{ id: number; name: string }>;
}

/** A compact, kid-readable emote palette (rendered as the bubble text itself —
 *  the wire carries the emoji string, ≤ MAX_EMOTE_LEN). */
const EMOTES = ["👋", "👍", "❤️", "😀", "😮", "😢", "🎉", "❓", "❗"];

let btn: HTMLElement | null = null;
let panel: HTMLElement | null = null;
let api: SocialApi | null = null;

function chatMode(): string {
  const mp = ctx.proj && ctx.proj.system && (ctx.proj.system as any).multiplayer;
  return (mp && mp.chatMode) || "off";
}
function presets(): string[] {
  const mp = ctx.proj && ctx.proj.system && (ctx.proj.system as any).multiplayer;
  return (mp && Array.isArray(mp.presets) ? mp.presets : []).filter((s: any) => typeof s === "string" && s);
}

/** Show the floating "Players & Chat" button (idempotent). */
export function mountSocialUI(a: SocialApi): void {
  api = a;
  if (!ctx.uiLayer || btn) return;
  const b = el("button", "mp-social-btn");
  b.textContent = "💬";
  b.title = mpText("openSocial");
  b.setAttribute("aria-label", mpText("openSocial"));
  b.style.cssText =
    "position:absolute;right:12px;bottom:12px;width:44px;height:44px;border-radius:50%;border:0;" +
    "background:#4a86ff;color:#fff;font-size:20px;cursor:pointer;z-index:140;" +
    "box-shadow:0 4px 14px rgba(0,0,0,0.4);font-family:system-ui,sans-serif;";
  b.onclick = (): void => togglePanel();
  ctx.uiLayer.appendChild(b);
  btn = b;
}

/** Remove the button + any open panel (leaving the room / returning to solo). */
export function unmountSocialUI(): void {
  if (panel) { panel.remove(); panel = null; }
  if (btn) { btn.remove(); btn = null; }
  api = null;
}

function togglePanel(): void {
  if (panel) { panel.remove(); panel = null; return; }
  openPanel();
}

function mkBtn(label: string, kind: "primary" | "ghost" | "warn" = "ghost"): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  const bg = kind === "primary" ? "#4a86ff" : kind === "warn" ? "#7a2f38" : "#39415a";
  b.style.cssText =
    "padding:5px 9px;border-radius:8px;border:0;cursor:pointer;font:600 12px system-ui,sans-serif;" +
    `background:${bg};color:${kind === "ghost" ? "#dfe6f5" : "#fff"};`;
  return b;
}

function openPanel(): void {
  if (!ctx.uiLayer || !api) return;
  const card = el("div", "mp-social-panel");
  card.style.cssText =
    "position:absolute;right:12px;bottom:64px;width:min(92%,300px);max-height:70%;overflow-y:auto;" +
    "background:#232a3a;color:#fff;border-radius:14px;padding:14px 14px 12px;z-index:141;" +
    "box-shadow:0 10px 34px rgba(0,0,0,0.5);font-family:system-ui,sans-serif;";

  const head = el("div"); head.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;";
  const title = el("div"); title.textContent = mpText("openSocial"); title.style.cssText = "font-weight:700;font-size:15px;";
  const x = mkBtn("✕"); x.style.background = "transparent"; x.style.color = "#9aa6bf"; x.onclick = (): void => togglePanel();
  head.append(title, x);
  card.appendChild(head);

  // Emotes (always on).
  card.appendChild(section(mpText("emotesLabel")));
  const emoteRow = el("div"); emoteRow.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;";
  for (const e of EMOTES) {
    const eb = mkBtn(e); eb.style.fontSize = "18px"; eb.style.padding = "4px 8px";
    eb.onclick = (): void => { api!.emote(e); };
    emoteRow.appendChild(eb);
  }
  card.appendChild(emoteRow);

  // Quick phrases (authored presets, always on).
  const ph = presets();
  if (ph.length) {
    card.appendChild(section(mpText("phrasesLabel")));
    const phRow = el("div"); phRow.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;";
    ph.forEach((phrase, i) => {
      const pb = mkBtn(phrase);
      pb.onclick = (): void => { api!.say({ preset: i }); };
      phRow.appendChild(pb);
    });
    card.appendChild(phRow);
  }

  // Free-text chat (only when the dev opted in, D4).
  if (chatMode() === "text") {
    const inputRow = el("div"); inputRow.style.cssText = "display:flex;gap:6px;margin:6px 0;";
    const input = document.createElement("input");
    input.type = "text"; input.maxLength = 200; input.placeholder = mpText("typeMessage");
    input.style.cssText =
      "flex:1;min-width:0;padding:7px 9px;border-radius:8px;border:1px solid #3a4358;background:#1a2130;color:#fff;font-size:13px;";
    const send = mkBtn(mpText("sendMsg"), "primary");
    const doSend = (): void => {
      const text = input.value.trim();
      if (!text) return;
      api!.say({ text });
      input.value = "";
    };
    send.onclick = doSend;
    input.onkeydown = (ev: KeyboardEvent): void => { if (ev.key === "Enter") doSend(); };
    inputRow.append(input, send);
    card.appendChild(inputRow);
  } else {
    const note = el("div"); note.textContent = mpText("chatOffNote");
    note.style.cssText = "font-size:11px;opacity:.6;margin:4px 0 6px;";
    card.appendChild(note);
  }

  // Player list with mute / report / kick / ban.
  card.appendChild(section(mpText("openSocial")));
  const list = el("div"); list.style.cssText = "display:flex;flex-direction:column;gap:6px;";
  const others = api.roster();
  if (!others.length) {
    const empty = el("div"); empty.textContent = mpText("noOthers");
    empty.style.cssText = "font-size:12px;opacity:.6;"; list.appendChild(empty);
  }
  for (const p of others) list.appendChild(playerRow(p, () => togglePanel()));
  card.appendChild(list);

  ctx.uiLayer.appendChild(card);
  panel = card;
}

function section(label: string): HTMLElement {
  const s = el("div"); s.textContent = label;
  s.style.cssText = "font-size:11px;letter-spacing:.4px;text-transform:uppercase;opacity:.55;margin:6px 0 4px;";
  return s;
}

function playerRow(p: { id: number; name: string }, refresh: () => void): HTMLElement {
  const row = el("div");
  row.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:#1c2331;border-radius:8px;padding:6px 8px;";
  const name = el("span"); name.textContent = p.name || ("#" + p.id);
  name.style.cssText = "flex:1;min-width:60px;font-size:13px;font-weight:600;";
  const muteBtn = mkBtn(isMuted(p.id) ? mpText("unmuteBtn") : mpText("muteBtn"));
  muteBtn.onclick = (): void => { const on = toggleMute(p.id); muteBtn.textContent = on ? mpText("unmuteBtn") : mpText("muteBtn"); };
  const reportBtn = mkBtn(mpText("reportBtn"));
  reportBtn.onclick = (): void => { api!.mod("report", p.id); toast(mpText("reportedToast", { name: p.name || ("#" + p.id) })); };
  const kickBtn = mkBtn(mpText("kickBtn"), "warn");
  kickBtn.onclick = (): void => { api!.mod("kick", p.id); };
  const banBtn = mkBtn(mpText("banBtn"), "warn");
  banBtn.onclick = (): void => { api!.mod("ban", p.id); };
  row.append(name, muteBtn, reportBtn, kickBtn, banBtn);
  void refresh;
  return row;
}

/** A brief toast (mirrors co-op.ts's, kept local so this module has no import
 *  cycle with the co-op flow). */
function toast(text: string): void {
  if (!ctx.uiLayer) return;
  const box = el("div", "mp-toast");
  box.textContent = text;
  box.style.cssText =
    "position:absolute;top:8px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.72);" +
    "color:#fff;padding:4px 12px;border-radius:8px;font:600 13px system-ui,sans-serif;z-index:150;pointer-events:none;";
  ctx.uiLayer.appendChild(box);
  setTimeout(() => box.remove(), 2600);
}
