/* RPGAtlas — src/engine/scenes/menus.ts
   The in-game menus, extracted verbatim from the js/engine.js monolith
   (Phase 1 Stage B): the pause menu (items/skills/equip/status/journal/
   options/save/load/to-title), the options menu with its slider/cycler rows,
   the controls rebinding flow (capture, conflict resolution, critical-action
   guard), the party-row HTML helpers shared with the battle scene, and the
   journal-view wiring. Logic unchanged; mutable engine state goes through
   the shared context, toTitle is reached through fns (the title scene is
   extracted in a later step), and the journal view is created by
   initJournalView() at the exact point the monolith created it (after the
   quest runtime exists). This module self-installs fns.openMenu for the map
   scene's cancel-press. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, RA, RPGAtlasJournalView } from "../../shared/deps.js";
import { el, esc, clamp, sysSe } from "../util.js";
import { showList, pushUI, removeUI } from "../ui-stack.js";
import { ctx, fns } from "../state/engine-context.js";
import {
  G,
  actorClass,
  param,
  learnedSkills,
  skillMpCost,
  skillPowerRate,
  canActorEquip,
  invCount,
  addInv,
  dbFor,
  expForLevel,
  traitDescription,
  Quests,
  questState,
} from "../state/game-state.js";
import { saveLoadMenu } from "../state/save.js";
import { actionLabel } from "../input.js";
import {
  audioVol,
  setOptAudio,
  setOpt,
  setOptTextSpeed,
  saveOptions,
} from "../state/player-options.js";

export function bar(cur: any, max: any, color: any): string {
  const pct = max > 0 ? clamp((cur / max) * 100, 0, 100) : 0;
  return (
    '<span class="bar"><span class="bar-fill" style="width:' +
    pct +
    "%;background:" +
    color +
    '"></span></span>'
  );
}
export function iconEntryHtml(entry: any, text?: any): string {
  return (
    Assets.iconHtml(entry && entry.icon, "menu-icon") +
    (text == null ? esc(entry.name) : text)
  );
}
function actorRowHTML(a: any): string {
  const cls = actorClass(a);
  return (
    '<div class="arow"><span class="aface"></span><div class="ainfo">' +
    Assets.iconHtml(cls && cls.icon, "menu-icon") +
    "<b>" +
    esc(a.name) +
    '</b> <span class="lv">' +
    esc(cls ? cls.name : "") +
    " · Lv " +
    a.level +
    "</span><br>" +
    "HP " +
    a.hp +
    "/" +
    param(a, "mhp") +
    " " +
    bar(a.hp, param(a, "mhp"), "#58c46a") +
    "<br>" +
    "MP " +
    a.mp +
    "/" +
    param(a, "mmp") +
    " " +
    bar(a.mp, param(a, "mmp"), "#5a8ad8") +
    "</div></div>"
  );
}
function attachFaces(container: any, actors: any): void {
  const slots = container.querySelectorAll(".aface");
  actors.forEach((a: any, i: any) => {
    if (!slots[i]) return;
    const ci = Assets.charsetIndex(a.charset);
    if (ci >= 0) slots[i].appendChild(Assets.faceCanvas(ci));
  });
}

async function pickPartyMember(title: any): Promise<any> {
  const i = await showList(
    G.party.map((a: any) => ({ html: actorRowHTML(a) })),
    { title, className: "partywin" },
  );
  return i < 0 ? null : G.party[i];
}

let journalView: any = null;
/** Create the in-game journal view (js/journal-view.js) — called by the
 *  engine body at the exact point the monolith created it, after the quest
 *  runtime exists. */
export function initJournalView(): void {
  journalView = RPGAtlasJournalView.create({
    el,
    esc,
    pushUI,
    removeUI,
    sysSe,
    appendUI: (node: any) => ctx.uiLayer.appendChild(node),
    showMessage: (...args: any[]) => ctx.showMessage(...args),
    getProj: () => ctx.proj,
    questState,
    Quests,
  });
}
async function menuJournal(): Promise<any> {
  return journalView.open();
}

// Formation (Phase 5): toggle each member's battle row. Back row deals and
// takes 25% less physical damage and is targeted less often.
async function menuFormation(): Promise<void> {
  while (true) {
    const i = await showList(
      G.party.map((a: any) => ({
        html:
          (a.row === "back" ? "▽ " : "▲ ") +
          esc(a.name) +
          ' <span class="cnt">' +
          (a.row === "back" ? "Back row" : "Front row") +
          "</span>",
      })),
      { title: "Formation — Enter toggles row", className: "cmdwin" },
    );
    if (i < 0) return;
    const a = G.party[i];
    a.row = a.row === "back" ? "front" : "back";
    sysSe("cursor");
  }
}

export async function openMenu(): Promise<void> {
  if (ctx.menuOpen || ctx.blockingRun) return;
  ctx.menuOpen = true;
  sysSe("ok");
  const panel = el("div", "win menupanel");
  const partyBox = el("div", "menu-party");
  panel.appendChild(partyBox);
  const goldBox = el("div", "menu-gold");
  panel.appendChild(goldBox);
  ctx.uiLayer.appendChild(panel);
  function refreshPanel() {
    partyBox.innerHTML = G.party.map(actorRowHTML).join("");
    attachFaces(partyBox, G.party);
    goldBox.textContent = G.gold + " " + ctx.proj.system.currency;
  }
  try {
    let idx = 0;
    while (true) {
      refreshPanel();
      const i = await showList(
        [
          { html: Assets.iconHtml(24, "menu-icon") + "Items" },
          { html: Assets.iconHtml(8, "menu-icon") + "Skills" },
          { html: Assets.iconHtml(48, "menu-icon") + "Equip" },
          {
            html:
              Assets.iconHtml(
                (actorClass(G.party[0]) || {}).icon,
                "menu-icon",
              ) + "Status",
          },
          { html: Assets.iconHtml(20, "menu-icon") + "Formation" },
          { html: Assets.iconHtml(16, "menu-icon") + "Journal" },
          { html: Assets.iconHtml(46, "menu-icon") + "Options" },
          { html: Assets.iconHtml(44, "menu-icon") + "Save" },
          { html: Assets.iconHtml(45, "menu-icon") + "Load" },
          { html: Assets.iconHtml(47, "menu-icon") + "To Title" },
        ],
        { className: "mainmenu", start: idx },
      );
      if (i < 0) break;
      idx = i;

      if (i === 0) {
        await menuItems();
      } else if (i === 1) {
        await menuSkills();
      } else if (i === 2) {
        await menuEquip();
      } else if (i === 3) {
        await menuStatus();
      } else if (i === 4) {
        await menuFormation();
        refreshPanel();
      } else if (i === 5) {
        panel.style.display = "none";
        try {
          if (await menuJournal() === "close") return;
        } finally {
          panel.style.display = "";
        }
      } else if (i === 6) {
        await optionsMenu();
      } else if (i === 7) {
        await saveLoadMenu("save");
      } else if (i === 8) {
        if (await saveLoadMenu("load")) break;
      } else if (i === 9) {
        const c = await showList(
          [{ label: "Return to title" }, { label: "Cancel" }],
          { className: "choicewin" },
        );
        if (c === 0) {
          panel.remove();
          ctx.menuOpen = false;
          await fns.toTitle();
          return;
        }
      }
    }
  } finally {
    panel.remove();
    ctx.menuOpen = false;
  }
}
// The map scene's cancel-press opens the pause menu through fns.
fns.openMenu = openMenu;

// In-game Options: rebind keyboard / gamepad per action (editable list — add / replace
// / remove), audio mixer + game settings, reset. Built on showList/UIStack; capture uses
// Input.beginCapture (ignore-held-until-release + conflict prompt). Player overrides
// persist to the options store and apply live via Input.setBindings.
// Build a 10-segment volume bar like "▰▰▰▰▰▱▱▱▱▱".
function volBar(v: any): string {
  const n = Math.max(0, Math.min(10, Math.round(v * 10)));
  return "▰".repeat(n) + "▱".repeat(10 - n);
}
const OPT_TEXT_SPEED: any[] = [["Slow", 1], ["Normal", 2], ["Fast", 4], ["Instant", 9999]];
const OPT_DASH: any[] = [["Hold", "hold"], ["Toggle", "toggle"], ["Always On", "always"]];
const OPT_SHAKE: any[] = [["Off", 0], ["Reduced", 0.5], ["Full", 1]];
// Registry-row builders: a slider (continuous 0..1) and a cycler (fixed [label,value] list).
// sliderRow exposes bar()/pct() for the split display and seek(frac) for click-to-seek.
function sliderRow(label: any, getVal: any, setVal: any): any {
  const set = (v: any) => setVal(Math.max(0, Math.min(1, v)));
  return {
    label,
    slider: true,
    get() {
      return volBar(getVal()) + " " + Math.round(getVal() * 100) + "%";
    },
    bar() {
      return volBar(getVal());
    },
    pct() {
      return Math.round(getVal() * 100) + "%";
    },
    adjust(dir: any) {
      set(getVal() + dir * 0.1);
    },
    seek(frac: any) {
      set(Math.ceil(frac * 10) / 10); // fill up to the segment the cursor is over (click anywhere in it)
    },
  };
}
function choiceRow(label: any, list: any, getVal: any, setVal: any): any {
  return {
    label,
    get() {
      const v = getVal();
      const m = list.find((x: any) => x[1] === v);
      return (m || list[0])[0];
    },
    adjust(dir: any) {
      let i = list.findIndex((x: any) => x[1] === getVal());
      if (i < 0) i = 0;
      i = (i + dir + list.length) % list.length;
      setVal(list[i][1]);
    },
  };
}
export async function optionsMenu(): Promise<void> {
  let idx = 0;
  while (true) {
    const rows: any[] = [
      sliderRow("Master Volume", () => audioVol("master"), (v: any) => setOptAudio("master", v)),
      sliderRow("Music Volume", () => audioVol("bgm"), (v: any) => setOptAudio("bgm", v)),
      sliderRow("SFX Volume", () => audioVol("se"), (v: any) => setOptAudio("se", v)),
      choiceRow("Text Speed", OPT_TEXT_SPEED, () => ctx.playerOptions.textSpeed || 2, (v: any) => setOptTextSpeed(v)),
      choiceRow("Dash", OPT_DASH, () => ctx.playerOptions.dashMode || "hold", (v: any) => setOpt("dashMode", v)),
      choiceRow("Screen Shake", OPT_SHAKE, () => (ctx.playerOptions.shakeScale == null ? 1 : ctx.playerOptions.shakeScale), (v: any) => setOpt("shakeScale", v)),
      choiceRow("Fullscreen", [["Off", false], ["On", true]],
        () => !!document.fullscreenElement,
        (v: any) => {
          if (v) document.documentElement.requestFullscreen().catch(() => {});
          else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        }),
      { label: "Controls", nav: true },
      { label: "Back", nav: true },
    ];
    const i = await showList(rows, { title: "Options", className: "optionswin optionswin-wide", start: idx });
    if (i < 0 || i === rows.length - 1) return; // Back / cancel
    idx = i;
    if (rows[i] && rows[i].label === "Controls") await controlsMenu();
  }
}
// Controls submenu (Options ▸ Controls): per-device rebinders + reset to author defaults.
async function controlsMenu(): Promise<void> {
  let idx = 0;
  while (true) {
    const items = [
      { label: "Keyboard", nav: true },
      { label: "Gamepad", nav: true },
      { label: "Reset to Defaults", nav: true },
      { label: "Back", nav: true },
    ];
    const i = await showList(items, {
      title: "Controls",
      start: idx,
    });
    if (i < 0 || i === items.length - 1) return;
    idx = i;
    if (i === 0) await controlsDevice("keyboard");
    else if (i === 1) await controlsDevice("gamepad");
    else if (i === 2) {
      const c = await showList(
        [{ label: "Yes", nav: true }, { label: "Cancel", nav: true }],
        { title: "Reset controls to defaults?" },
      );
      if (c === 0) {
        delete ctx.playerOptions.input;
        ctx.Input.setBindings(RA.mergeInputBindings(ctx.proj.system.input, null));
        saveOptions();
      }
    }
  }
}
// Render a binding array as the same procedural glyphs the editor draws, skinned to the
// player's live controller family for gamepad. Dim em-dash when an action is unbound.
function bindGlyphsHtml(device: any, action: any): string {
  const arr = (ctx.Input.getBindings()[device] || {})[action] || [];
  if (!arr.length) return "<span class='bind-none'>—</span>";
  const fam = device === "gamepad" && ctx.Input.padFamily ? ctx.Input.padFamily() : "xbox";
  return arr.map((code: any) => Assets.inputGlyphHtml(device, code, fam, "bind-icon")).join("");
}
// Per-device action list: each row shows the action and its bindings (as glyphs).
async function controlsDevice(device: any): Promise<void> {
  let idx = 0;
  while (true) {
    const rows: any[] = RA.INPUT_ACTIONS.map((a: any) => ({
      html:
        "<span>" + esc(a.label) + "</span>" +
        "<span class='bind'>" + bindGlyphsHtml(device, a.key) + "</span>",
    }));
    rows.push({ label: "Back", nav: true });
    const i = await showList(rows, {
      title: (device === "keyboard" ? "Keyboard" : "Gamepad") + " — pick an action",
      className: "optionswin",
      start: idx,
    });
    if (i < 0 || i === rows.length - 1) return; // cancel or Back
    idx = i;
    await actionBindings(device, RA.INPUT_ACTIONS[i].key);
  }
}
// Editable binding list for one action: existing bindings + Add + Back. Selecting a
// binding offers Replace / Remove; Add captures a new one. First entry = primary.
async function actionBindings(device: any, action: any): Promise<void> {
  let idx = 0;
  while (true) {
    const arr = (ctx.Input.getBindings()[device] || {})[action] || [];
    const fam = device === "gamepad" && ctx.Input.padFamily ? ctx.Input.padFamily() : "xbox";
    const items: any[] = arr.map((code: any) => ({
      html:
        Assets.inputGlyphHtml(device, code, fam, "bind-icon") +
        "<span class='bind-name'>" + esc(ctx.Input.codeLabel(device, code)) + "</span>",
    }));
    items.push({ label: "+ Add binding" });
    items.push({ label: "Back", nav: true });
    const i = await showList(items, {
      title: actionLabel(action),
      start: idx,
    });
    if (i < 0 || i === items.length - 1) return; // cancel or Back
    idx = i;
    if (i === arr.length) {
      const code = await rebindCapture(device);
      if (code) await applyCapturedCode(device, action, code, -1);
    } else {
      const c = await showList(
        [
          { label: "Replace", nav: true },
          { label: "Remove", nav: true },
          { label: "Back", nav: true },
        ],
        {
          titleHtml:
            Assets.inputGlyphHtml(device, arr[i], fam, "bind-icon") +
            " " + esc(ctx.Input.codeLabel(device, arr[i])),
        },
      );
      if (c === 0) {
        const code = await rebindCapture(device);
        if (code) await applyCapturedCode(device, action, code, i);
      } else if (c === 1) {
        await removeBinding(device, action, i);
      }
    }
  }
}
// Show a centered "press any input" prompt and resolve to the captured code, or null
// if cancelled. The capture itself (ignore-held-until-release) lives in input.js.
async function rebindCapture(device: any): Promise<any> {
  const prompt = el(
    "div",
    "win listwin cap-prompt",
    "<div class='win-title'>Press any " + (device === "keyboard" ? "key" : "button") + "</div>" +
      "<div class='win-help'>Esc cancels</div>",
  );
  ctx.uiLayer.appendChild(prompt);
  let cap;
  try {
    cap = await new Promise((res) => ctx.Input.beginCapture(device, res));
  } finally {
    prompt.remove();
  }
  return cap ? (cap as any).code : null;
}
// Apply a captured code to an action (slot -1 = append, otherwise replace that index),
// resolving a cross-action conflict via a Replace/Cancel prompt, then persist + apply.
async function applyCapturedCode(device: any, action: any, code: any, slot: any): Promise<void> {
  const merged = RA.mergeInputBindings(ctx.proj.system.input, ctx.playerOptions.input || null);
  const clash = RA.inputConflict(merged, device, code, action);
  if (clash) {
    // Refuse a Replace that would orphan a menu-driving action (its last binding on this
    // device) — otherwise unbinding Confirm/Cancel this way could lock the player out.
    if (RA.INPUT_CRITICAL.indexOf(clash) !== -1 && merged[device][clash].length <= 1) {
      sysSe("buzzer");
      await ctx.showMessage("", actionLabel(clash) + " needs at least one binding — free it up first.");
      return;
    }
    const c = await showList(
      [{ label: "Replace" }, { label: "Cancel" }],
      { title: ctx.Input.codeLabel(device, code) + " is bound to " + actionLabel(clash) },
    );
    if (c !== 0) return;
    merged[device][clash] = merged[device][clash].filter((x: any) => x !== code);
  }
  const arr = merged[device][action].slice();
  if (slot >= 0) arr[slot] = code;
  else arr.push(code);
  // drop empties and de-duplicate within the action (keep first occurrence)
  merged[device][action] = arr.filter((x: any, j: any) => x && arr.indexOf(x) === j);
  commitBindings(merged);
}
async function removeBinding(device: any, action: any, slot: any): Promise<void> {
  const merged = RA.mergeInputBindings(ctx.proj.system.input, ctx.playerOptions.input || null);
  // Don't let the last Confirm/Cancel binding on this device be removed — they drive every
  // menu, so emptying them could lock the player out (recoverable only via mouse/reload).
  if (RA.INPUT_CRITICAL.indexOf(action) !== -1 && merged[device][action].length <= 1) {
    sysSe("buzzer");
    await ctx.showMessage("", actionLabel(action) + " needs at least one binding.");
    return;
  }
  const arr = merged[device][action].slice();
  arr.splice(slot, 1);
  merged[device][action] = arr;
  commitBindings(merged);
}
function commitBindings(merged: any): void {
  ctx.playerOptions.input = merged;
  ctx.Input.setBindings(merged);
  saveOptions();
}

async function menuItems(): Promise<void> {
  while (true) {
    const list = ctx.proj.items.filter((it: any) => invCount("item", it.id) > 0);
    if (!list.length) {
      await ctx.showMessage("", "You have no items.");
      return;
    }
    const i = await showList(
      list.map((it: any) => ({
        html:
          iconEntryHtml(it) +
          ' <span class="cnt">×' +
          invCount("item", it.id) +
          "</span>",
        help: it.desc || "",
      })),
      { title: "Items", className: "itemwin" },
    );
    if (i < 0) return;
    const it = list[i];
    const target = await pickPartyMember("Use on…");
    if (!target) continue;
    useItemOn(it, target);
  }
}
export function useItemOn(it: any, target: any): void {
  if (it.hp) target.hp = clamp(target.hp + it.hp, 0, param(target, "mhp"));
  if (it.mp) target.mp = clamp(target.mp + it.mp, 0, param(target, "mmp"));
  sysSe("heal");
  addInv("item", it.id, -1);
}

async function menuSkills(): Promise<void> {
  const a = await pickPartyMember("Whose skills?");
  if (!a) return;
  while (true) {
    const skills = learnedSkills(a);
    if (!skills.length) {
      await ctx.showMessage("", a.name + " knows no skills.");
      return;
    }
    const i = await showList(
      skills.map((s: any) => ({
        html:
          iconEntryHtml(s) +
          ' <span class="cnt">' +
          skillMpCost(a, s) +
          " MP</span>",
        disabled: s.type !== "heal" || a.mp < skillMpCost(a, s),
        help: s.type === "heal" ? "Restores HP." : "Usable in battle only.",
      })),
      { title: a.name + "'s Skills", className: "itemwin" },
    );
    if (i < 0) return;
    const s = skills[i];
    const target = await pickPartyMember("Heal whom?");
    if (!target) continue;
    a.mp -= skillMpCost(a, s);
    const amount = Math.max(
      1,
      Math.floor((s.power + param(a, "mat") * 1.2) * skillPowerRate(a, s)),
    );
    target.hp = clamp(target.hp + amount, 0, param(target, "mhp"));
    sysSe("heal");
  }
}

async function menuEquip(): Promise<void> {
  const a = await pickPartyMember("Equip whom?");
  if (!a) return;
  while (true) {
    const w = RA.byId(ctx.proj.weapons, a.weaponId),
      ar = RA.byId(ctx.proj.armors, a.armorId);
    const slot = await showList(
      [
        {
          html: iconEntryHtml(
            w || { icon: 48 },
            "Weapon: <b>" + esc(w ? w.name : "—") + "</b>",
          ),
        },
        {
          html: iconEntryHtml(
            ar || { icon: 56 },
            "Armor: <b>" + esc(ar ? ar.name : "—") + "</b>",
          ),
        },
      ],
      {
        title:
          a.name +
          " — ATK " +
          param(a, "atk") +
          " / DEF " +
          param(a, "def") +
          " / MAT " +
          param(a, "mat"),
        className: "itemwin",
      },
    );
    if (slot < 0) return;
    const kind = slot === 0 ? "weapon" : "armor";
    const db = dbFor(kind);
    const candidates = db.filter((e: any) => invCount(kind, e.id) > 0);
    const opts: any[] = candidates.map((e: any) => ({
      html:
        iconEntryHtml(e) +
        ' <span class="cnt">' +
        Object.entries(e.params || {})
          .map(([k, v]) => k.toUpperCase() + "+" + v)
          .join(" ") +
        "</span>",
      disabled: !canActorEquip(a, kind, e.id),
      help: canActorEquip(a, kind, e.id)
        ? ""
        : actorClass(a).name + " cannot equip this item.",
    }));
    opts.push({ label: "(Remove)" });
    const ci = await showList(opts, {
      title: "Equip " + kind,
      className: "itemwin",
    });
    if (ci < 0) continue;
    const cur = kind === "weapon" ? a.weaponId : a.armorId;
    if (cur) addInv(kind, cur, 1);
    const next = ci < candidates.length ? candidates[ci].id : 0;
    if (next) addInv(kind, next, -1);
    if (kind === "weapon") a.weaponId = next;
    else a.armorId = next;
    sysSe("equip");
    a.hp = Math.min(a.hp, param(a, "mhp"));
    a.mp = Math.min(a.mp, param(a, "mmp"));
  }
}

async function menuStatus(): Promise<void> {
  const a = await pickPartyMember("Status of…");
  if (!a) return;
  const c = actorClass(a);
  const next = expForLevel(a.level + 1) - a.exp;
  const stats = ["mhp", "mmp", "atk", "def", "mat", "mdf", "agi"]
    .map(
      (s) =>
        "<tr><td>" +
        s.toUpperCase() +
        "</td><td>" +
        param(a, s) +
        "</td></tr>",
    )
    .join("");
  const traits = (c.traits || []).map(traitDescription);
  await showList(
    [
      {
        html:
          Assets.iconHtml(c.icon, "menu-icon") +
          "<b>" +
          esc(a.name) +
          "</b> — " +
          esc(c.name) +
          " Lv " +
          a.level +
          "<br>EXP " +
          a.exp +
          " (next in " +
          next +
          ")" +
          '<table class="stats">' +
          stats +
          "</table>" +
          "Skills: " +
          (learnedSkills(a)
            .map((s: any) => esc(s.name))
            .join(", ") || "none") +
          "<br>Traits: " +
          (traits.map(esc).join(" · ") || "none"),
      },
    ],
    { title: "Status", className: "statuswin" },
  );
}
