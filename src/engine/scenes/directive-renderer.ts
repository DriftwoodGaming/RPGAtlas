/* RPGAtlas — src/engine/scenes/directive-renderer.ts
   Project Beacon MP3·A: the client half of the presentation-directive seam.
   One function renders any modal directive with the engine's EXISTING UI —
   the message system (typewriter/control codes), the ui-stack choice window,
   the input scenes, the shop scene — and resolves with the player's reply
   value. boot.ts injects it into the solo ClientSession (injected, not
   imported, so src/engine/net/ stays off the DOM graph).

   Byte-identity: each arm calls the exact function the old command handler
   called, with the exact argument values, and the whole emit→render chain is
   synchronous (loopback delivery contract) — so the modal appears at the same
   point of the same tick as the pre-directive engine, and the reply resumes
   the interpreter in the same microtask chain. The RM-numeric position/
   background options ride the wire as names (protocol MESSAGE_*_NAMES) and
   map back losslessly here. GPL-3.0-or-later (see LICENSE). */

import type {
  BattleActionCmd,
  BattleAllyView,
  BattleCmdDirective,
  BattleEnemyView,
  Directive,
  DirectiveReplyValue,
  ShopTransaction,
} from "../../shared/net/protocol.js";
import { MAX_SHOP_TRANSACTIONS, MESSAGE_BG_NAMES, MESSAGE_POS_NAMES } from "../../shared/net/protocol.js";
import { Assets, RA } from "../../shared/deps.js";
import { esc } from "../util.js";
import { ctx } from "../state/engine-context.js";
import { invCount } from "../state/game-state.js";
import { removeUI, showList, UIStack } from "../ui-stack.js";
import { openCmdSession, SUPERSEDED, type CmdSession } from "./battle-cmd-session.js";
import { numberInputScene, nameInputScene, selectItemScene } from "./input-scenes.js";
import { buildLoadout } from "./battle-coop.js";
import { showScrollText } from "./presentation-runtime.js";
import { frameWait } from "./map.js";
import { Shop } from "./shop.js";

/** Render one directive with the client's UI and return the player's answer.
 *  The world side validates the answer again (C3.2) — this function is
 *  presentation, not authority. */
export async function renderDirective(d: Directive): Promise<DirectiveReplyValue> {
  switch (d.kind) {
    case "message":
      // The old `text` handler's showMessage call, args reconstructed
      // losslessly (names → RM numerics; omitted fields stay undefined, so
      // the message system applies its own defaults exactly as before).
      await ctx.showMessage(d.speaker, d.text, d.portrait, {
        background: d.background == null ? undefined : MESSAGE_BG_NAMES.indexOf(d.background),
        position: d.pos == null ? undefined : MESSAGE_POS_NAMES.indexOf(d.pos),
      });
      return { kind: "message", done: true };
    case "choices": {
      // The old `choices` handler's showList call — richText runs client-side
      // now (same module, same tick, same values in loopback).
      const i = await showList(
        d.options.map((o) => ({ html: ctx.richText(o) })),
        { className: "choicewin", cancellable: !!d.cancelable },
      );
      return i < 0 ? { kind: "choices", canceled: true } : { kind: "choices", choice: i };
    }
    case "numberInput":
      return { kind: "numberInput", value: await numberInputScene(d.digits, d.initial ?? 0) };
    case "nameInput":
      return { kind: "nameInput", value: await nameInputScene(d.initial ?? "", d.maxLen) };
    case "shop": {
      // The shop UI runs its whole session against the local view (loopback:
      // the world itself — its live buy/sell lines ARE the solo mutations,
      // byte-identical) and records the transcript for the reply. The world
      // re-applies it only for non-localEcho sessions (MP4/MP5).
      const transactions: ShopTransaction[] = [];
      await Shop.run(
        d.goods.map((g) => ({ kind: g.itemType, id: g.id })),
        d.currencyId,
        (line: ShopTransaction) => {
          if (transactions.length < MAX_SHOP_TRANSACTIONS) transactions.push(line);
        },
      );
      return { kind: "shop", transactions };
    }
    case "selectItem":
      // The old `selectItem` handler's scene call. Atlas has one item bag and
      // picks a regular item regardless of RM's category (d.itemType), exactly
      // as before; 0 = nothing owned / canceled. The world re-validates the id
      // against authoritative inventory for non-localEcho sessions.
      return { kind: "selectItem", id: await selectItemScene() };
    case "scrollText":
      // The old `scrollText` handler's showScrollText call — same client
      // frameWait tick source, same args; in loopback the scroll runs in the
      // same frame cadence as the pre-directive engine (a completion ack, no
      // value — modal like Show Message).
      await showScrollText(d.text, d.speed ?? 2, !!d.noFast, frameWait);
      return { kind: "scrollText", done: true };
    case "battleJoin":
      // MP6·A: auto-answered — being partied is the consent (A-3/A-4). The
      // client contributes its own party loadout; no UI. Solo never receives
      // battle directives (they only ever target remote participants).
      return { kind: "battleJoin", party: buildLoadout() };
    case "battleCmd":
      // MP6·B: the real remote battle-command UI — one action per battler,
      // built from the round view with the engine's own list/target windows
      // (the same showList the solo battle uses). The authority re-validates
      // every reply (stale targets retarget, unusable skills → guard), so this
      // is presentation, not authority.
      return { kind: "battleCmd", cmds: await renderBattleCmd(d) };
  }
}

/* ── MP6·B: the remote co-op battle-command UI ─────────────────────────────
   The client answers a `battleCmd` directive with one BattleActionCmd per
   battler in `yours` (same order). A battler that can't act contributes a
   guard placeholder so the reply array stays index-aligned with `yours`
   (the authority re-checks and pushes its own "stunned" command). Skills and
   items read scope/effect from the client's OWN copy of the shared project
   (no wire round-trip); ally targeting picks among the client's own battlers
   (`idx` = the shared battle's merged battler index). Cancelling any submenu
   loops back to the main command list — the top menu is not cancellable, so
   the client always produces a command and a shared fight never hangs.

   R-3 (post-2.0): the whole render runs inside a CmdSession — at most one
   battleCmd's windows are ever live. When the authority escape-resolves a
   round at its AFK deadline and the next round's ask (or the battle `end`)
   arrives, the stale session dies: its windows close and the pending await
   lands here as SUPERSEDED. The abandoned render still resolves — with
   index-aligned guards — so its reply targets a dead directive id and the
   authority drops it (counted, harmless), exactly like the AFK escape it
   mirrors. */
async function renderBattleCmd(d: BattleCmdDirective): Promise<BattleActionCmd[]> {
  const sess = openCmdSession(d.round, removeUI);
  const cmds: BattleActionCmd[] = [];
  try {
    for (const me of d.yours) {
      if (!me.canAct) {
        cmds.push({ type: "guard" }); // authority sees this as "stunned"
        continue;
      }
      cmds.push(await pickBattleAction(me, d, sess));
    }
  } catch (e) {
    if (e !== SUPERSEDED) throw e;
  } finally {
    sess.done();
  }
  while (cmds.length < d.yours.length) cmds.push({ type: "guard" });
  return cmds;
}

/** showList, session-scoped (R-3): the opened window is tracked so a session
 *  teardown closes it, and the await unblocks — by throwing SUPERSEDED — when
 *  the session dies underneath it. Reads the window handle as top-of-stack,
 *  which showList guarantees by pushing synchronously before returning. */
async function sessList(
  sess: CmdSession,
  items: Parameters<typeof showList>[0],
  opts: Parameters<typeof showList>[1],
): Promise<number> {
  if (sess.dead) throw SUPERSEDED;
  const answer = showList(items, opts);
  sess.track(UIStack[UIStack.length - 1]);
  const i = await Promise.race([answer, sess.superseded]);
  if (sess.dead || i === SUPERSEDED) throw SUPERSEDED;
  return i;
}

/** Live enemies from the round view (targets). */
function liveEnemies(d: BattleCmdDirective): BattleEnemyView[] {
  return d.enemies.filter((e) => e.alive);
}

/** Pick one enemy target; returns the enemy's `.i`, or null on cancel. A lone
 *  enemy is chosen without a prompt (the solo battle's `pickTarget` behavior). */
async function pickEnemyTarget(d: BattleCmdDirective, sess: CmdSession): Promise<number | null> {
  const live = liveEnemies(d);
  if (!live.length) return null;
  if (live.length === 1) return live[0].i;
  const i = await sessList(
    sess,
    live.map((e) => ({ label: e.name + "  (HP " + e.hp + ")" })),
    { className: "targetwin" },
  );
  return i < 0 ? null : live[i].i;
}

/** Pick one of THIS client's own battlers as an ally target; returns its merged
 *  `idx`. `mode` filters to living (heals/items) or fallen (revives). */
async function pickOwnAlly(
  d: BattleCmdDirective,
  mode: "living" | "dead",
  sess: CmdSession,
): Promise<number | null> {
  const pool = d.yours.filter((a) => (mode === "dead" ? a.hp <= 0 : a.hp > 0));
  if (!pool.length) return null;
  const i = await sessList(
    sess,
    pool.map((a) => ({ label: a.name + "  (HP " + a.hp + "/" + a.mhp + ")" })),
    { className: "targetwin" },
  );
  return i < 0 ? null : pool[i].idx;
}

/** Just the item fields the command UI reads from the shared project. */
type UiItem = { id: number; name: string; revive?: boolean };

/** The command menu for one battler. Loops until it returns a command. */
async function pickBattleAction(
  me: BattleAllyView,
  d: BattleCmdDirective,
  sess: CmdSession,
): Promise<BattleActionCmd> {
  const proj = ctx.proj;
  const myItems: UiItem[] = (proj.items || []).filter((it: UiItem) => invCount("item", it.id) > 0);
  while (true) {
    const menu: { html: string; disabled?: boolean }[] = [
      { html: Assets.iconHtml(48, "menu-icon") + "Attack" },
      { html: Assets.iconHtml(8, "menu-icon") + "Skills", disabled: !me.skills.length },
      { html: Assets.iconHtml(24, "menu-icon") + "Items", disabled: !myItems.length },
      { html: Assets.iconHtml(22, "menu-icon") + "Guard" },
    ];
    if (d.canEscape) menu.push({ html: Assets.iconHtml(7, "menu-icon") + "Escape" });
    const i = await sessList(sess, menu, { title: me.name, className: "cmdwin", cancellable: false });
    if (i === 0) {
      const e = await pickEnemyTarget(d, sess);
      if (e != null) return { type: "attack", enemy: e };
    } else if (i === 1) {
      const si = await sessList(
        sess,
        me.skills.map((s) => ({
          html:
            esc(s.name) +
            ' <span class="cnt">' + s.mpCost + " MP" +
            (s.tpCost ? " · " + s.tpCost + " TP" : "") + "</span>",
          disabled: !s.usable,
        })),
        { title: "Skill", className: "cmdwin" },
      );
      if (si < 0) continue;
      const skill = me.skills[si];
      const def = RA.byId(proj.skills, skill.id);
      const scope = def && def.scope;
      if (scope === "enemy") {
        const e = await pickEnemyTarget(d, sess);
        if (e != null) return { type: "skill", id: skill.id, enemy: e };
      } else if (scope === "ally") {
        const ally = await pickOwnAlly(d, def && def.revive ? "dead" : "living", sess);
        if (ally != null) return { type: "skill", id: skill.id, ally };
      } else {
        return { type: "skill", id: skill.id };
      }
    } else if (i === 2) {
      const ii = await sessList(
        sess,
        myItems.map((it: UiItem) => ({
          html: esc(it.name) + ' <span class="cnt">×' + invCount("item", it.id) + "</span>",
        })),
        { title: "Item", className: "cmdwin" },
      );
      if (ii < 0) continue;
      const it = myItems[ii];
      const ally = await pickOwnAlly(d, it.revive ? "dead" : "living", sess);
      if (ally != null) return { type: "item", id: it.id, ally };
    } else if (d.canEscape && i === 4) {
      return { type: "escape" };
    } else if (i === 3) {
      return { type: "guard" };
    }
  }
}
