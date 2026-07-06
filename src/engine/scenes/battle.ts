/* RPGAtlas — src/engine/scenes/battle.ts
   The turn-based battle scene, extracted verbatim from the js/engine.js
   monolith (Phase 1 Stage B): troop setup (stale enemy ids filtered, `.i`
   indexed off the FILTERED list — the battle-index invariant), front/side
   view layout, command collection, agility-ordered resolution, damage/
   crit/element math, states (poison/stun/regen ticks, turn expiry,
   battle-end shedding), escape odds, victory EXP/gold + level-up log, and
   defeat bookkeeping. The visual effects live in ./battle-fx.ts (the one
   natural seam in the scene); everything else is unchanged. The module
   self-installs fns.Battle for the plugin runtime's atlas.startBattle and
   the map scene's random encounters. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, Music, RA, Sfx } from "../../shared/deps.js";
import { el, esc, sleep, clamp, rnd, rndf, sysSe, sysBgm } from "../util.js";
import { showList } from "../ui-stack.js";
import { ctx, fns } from "../state/engine-context.js";
import {
  G,
  actorEffCarrier,
  actorFormulaFacade,
  param,
  learnedSkills,
  skillBlocked,
  skillMpCost,
  skillPowerRate,
  actorIncomingRate,
  skillElement,
  stateTraitRows,
  gainExp,
  invCount,
  addInv,
  dbFor,
  onEnemyKilled,
  noteBattleFailure,
} from "../state/game-state.js";
import { getFormula, mzDamageValue, mzHitRoll } from "../../shared/formula.js";
import { useItemOn, iconEntryHtml, bar } from "./menus.js";
import { gaugeColors } from "../state/player-options.js";
import { createBattleFx } from "./battle-fx.js";
import { playAnimation } from "../../shared/anim-player.js";
import { playMe } from "../../shared/audio-deck.js";
import { resolvePlaybackSheet } from "../../shared/asset-library.js";
import { Interp } from "../interpreter/interp.js";
import { resolvePictureSrc } from "./presentation-runtime.js";
import {
  rowOf,
  rowDealtScale,
  rowTakenScale,
  applyRowScale,
  weightedTargetIndex,
  validEnemyActions,
  makeTroopPageRTs,
  troopPageShouldFire,
  atbRate,
  ATB_FULL,
  ctbCost,
  ctbForecast,
  buffRate,
  applyBuffOp,
  tickBuffDurations,
  MAX_TP,
  tpDamageCharge,
  lukEffectRate,
  extraActionRolls,
  mzEscapeChance,
  rollDrops,
} from "./battle-logic.js";

const TILE = Assets.TILE;

/** Victory/defeat jingle resolution (M4·B): the Change-ME command override
 *  (G.jingles, RM 133/139) wins over the imported System ME
 *  (system.music.victory/defeat); "" = silenced by the command; null = none
 *  configured → the caller plays its classic sting. */
function jingleKey(channel: "victory" | "defeat"): string | null {
  const ov = G.jingles && G.jingles[channel];
  if (ov != null) return ov;
  const m = (ctx.proj && ctx.proj.system && ctx.proj.system.music) || {};
  return m[channel] ? m[channel] : null;
}

export const Battle: any = {
  async run(troopId: any, canEscape: any, opts?: any) {
    const proj = ctx.proj;
    const troop = RA.byId(proj.troops, troopId);
    if (!troop) return "win";
    // M3·C: MZ battle pacing. `opts` comes only from the map's random-
    // encounter path (and only under system.mzBattleFlow) — event battles
    // never get a first strike, exactly like MZ.
    const mzFlow = !!proj.system.mzBattleFlow;
    const preemptive = !!(opts && opts.preemptive);
    const surprise = !!(opts && opts.surprise) && !preemptive;
    // Battle mode (Phase 5 Stage B): "turn" runs the Phase 1 loop verbatim;
    // "atb"/"ctb" run the timed scheduler over the same resolution core.
    const battleSystem =
      proj.system.battleSystem === "atb" || proj.system.battleSystem === "ctb"
        ? proj.system.battleSystem
        : "turn";
    const prevScene = ctx.scene,
      prevMusic = Music.current;
    ctx.scene = "battle";
    Music.play(sysBgm("battle"));

    // This statement stays verbatim, annotation-free JS: tests/battle-index.test.js
    // extracts its source text and executes it to pin the filtered-index invariant.
    const enemies = troop.enemies
      // @ts-expect-error -- untyped callback params, kept extractable as plain JS
      .map((eid) => {
        const d = RA.byId(proj.enemies, eid);
        return d ? { d, hp: d.stats.mhp, alive: true } : null;
      })
      .filter(Boolean)
      // @ts-expect-error -- untyped callback params, kept extractable as plain JS
      .map((en, i) => ((en.i = i), en));

    const sideView = proj.system.battleView === "side";
    // M3·C: hidden members (MZ `hidden`) — marked BELOW the `const sideView`
    // end-marker so the statement tests/battle-index.test.js extracts stays
    // byte-identical. A hidden enemy isn't targetable, doesn't act, and
    // doesn't block victory until an Enemy Appear command reveals it.
    for (const slot of troop.hiddenSlots || []) {
      const hid: any = enemies[Number(slot) || 0];
      if (hid) hid.hidden = true;
    }
    const win = el("div", "battlewin" + (sideView ? " side" : ""));
    // Battle backgrounds (Project Compass M4·A): override (RM 283, cleared on
    // map load) → per-map battleback → System default. Missing art resolves
    // null and the classic backdrop stays.
    const bb = G.battlebackOverride || (ctx.map && ctx.map.battleback) || proj.system.battleback;
    if (bb) {
      const urls = [bb.back2, bb.back1] // back2 (walls) paints over back1 (floor)
        .map((k: any) => (k ? resolvePictureSrc(String(k)) : null))
        .filter(Boolean)
        .map((u: any) => `url("${u}")`);
      if (urls.length) {
        win.classList.add("hasbb");
        win.style.backgroundImage = urls.join(",");
      }
    }
    const fxLayer = el("div", "battle-fx");
    const enemyArea = el("div", "battle-enemies");
    const log = el("div", "battle-log");
    const partyArea = el("div", "battle-party");
    win.appendChild(fxLayer);
    if (sideView) {
      const fieldRow = el("div", "battle-field");
      fieldRow.appendChild(enemyArea);
      win.appendChild(fieldRow);
    } else {
      win.appendChild(enemyArea);
    }
    win.appendChild(log);
    win.appendChild(partyArea);
    ctx.uiLayer.appendChild(win);

    const sprs = enemies.map((en: any) => {
      const spriteClass = String(en.d.sprite || "slime").replace(
        /[^a-z0-9_-]/gi,
        "-",
      );
      const wrap = el("div", "enemy-spr enemy-" + spriteClass);
      if (en.hidden) wrap.classList.add("hiddenmem"); // M3·C: revealed later
      const source = Assets.enemyCanvas(
        en.d.sprite,
        en.d.color,
        sideView ? 108 : 132,
      );
      const battlerCanvas = document.createElement("canvas");
      battlerCanvas.width = source.width;
      battlerCanvas.height = source.height;
      battlerCanvas.getContext("2d")!.drawImage(source, 0, 0);
      wrap.appendChild(battlerCanvas);
      wrap.appendChild(el("div", "enemy-name", esc(en.d.name)));
      wrap.appendChild(el("div", "battler-states"));
      enemyArea.appendChild(wrap);
      return wrap;
    });
    // side view: the party stands on the right, facing the enemies
    let actorSprs: any[] = [];
    if (sideView) {
      const actorArea = el("div", "battle-actors");
      win.querySelector(".battle-field")!.appendChild(actorArea);
      actorSprs = G.party.map((a: any) => {
        const wrap = el("div", "actor-spr");
        const ci = Assets.charsetIndex(a.charset);
        if (ci >= 0) {
          // copy the cached frame — the cache canvas itself must stay off-DOM
          const c = document.createElement("canvas");
          c.width = c.height = TILE;
          c.getContext("2d")!.drawImage(
            Assets.charFrameCanvas(ci, 1, 1),
            0,
            0,
          ); // facing left
          wrap.appendChild(c);
        }
        wrap.appendChild(el("div", "actor-name", esc(a.name)));
        wrap.appendChild(el("div", "battler-states"));
        actorArea.appendChild(wrap);
        return wrap;
      });
    }
    // Battle effects (particle pool, bursts, float text, projectiles) live in
    // ./battle-fx.ts — the factory closes over the same win/fxLayer nodes the
    // monolith's inner functions closed over.
    const fx = createBattleFx(win, fxLayer);
    const { burst, floatText, skillKind, travel, castFx } = fx;
    // ---- authored battle animations (Phase 5) ----
    // A skill/weapon with animationId plays its timeline INSTEAD of the legacy
    // castFx/travel/burst-Sfx effects; absent = the legacy path, verbatim.
    const animById = (id: any) => RA.byId(proj.animations || [], Number(id) || 0);
    function attackAnim(a: any) {
      const weapon = RA.byId(proj.weapons || [], Number(a.weaponId) || 0);
      return weapon ? animById(weapon.animationId) : null;
    }
    function battleShake() {
      win.classList.remove("shake");
      void win.offsetWidth;
      win.classList.add("shake");
    }
    function playBattleAnim(anim: any, sourceEl: any, targetEls: any[]) {
      return playAnimation(anim, {
        fx,
        source: sourceEl,
        targets: targetEls,
        onSound: (se: any) => Sfx.play(se),
        onShake: () => battleShake(),
        resolveSheet: resolvePlaybackSheet,
        drawIcon(index: any) {
          // copy the cached icon frame — the cache canvas must stay off-DOM
          const src = Assets.iconCanvas(index);
          const c2 = document.createElement("canvas");
          c2.width = src.width;
          c2.height = src.height;
          c2.getContext("2d")!.drawImage(src, 0, 0);
          return c2;
        },
      });
    }
    function actorElement(a: any) {
      const i = G.party.indexOf(a);
      return actorSprs[i] || partyArea.children[i] || partyArea;
    }
    function battlerElement(b: any) {
      return b && b.d ? sprs[b.i] : actorElement(b);
    }
    function refreshParty() {
      partyArea.innerHTML = G.party
        .map(
          (a: any) =>
            '<div class="brow' +
            (a.hp <= 0 ? " dead" : "") +
            '"><b>' +
            (rowOf(a) === "back" ? "▽ " : "") +
            esc(a.name) +
            "</b> " +
            "HP " +
            a.hp +
            "/" +
            param(a, "mhp") +
            " " +
            bar(a.hp, param(a, "mhp"), gaugeColors().hp) +
            " MP " +
            a.mp +
            "/" +
            param(a, "mmp") +
            " " +
            bar(a.mp, param(a, "mmp"), gaugeColors().mp) +
            (tpActive && proj.system.displayTp
              ? " TP " + tpOf(a) + " " + bar(tpOf(a), MAX_TP, "#d9a941")
              : "") +
            stateTagsHtml(a) +
            "</div>",
        )
        .join("");
      actorSprs.forEach((w: any, i: any) => {
        const a = G.party[i];
        if (a) w.classList.toggle("dead", a.hp <= 0);
      });
    }
    function refreshEnemies() {
      enemies.forEach((en: any, i: any) => {
        sprs[i].classList.toggle("dead", !en.alive);
        // M3·C: hidden members stay unrendered; escaped ones fade out.
        // Native enemies never carry either flag — classes stay off.
        sprs[i].classList.toggle("hiddenmem", !!en.hidden);
        sprs[i].classList.toggle("fled", !!en.escaped);
      });
    }
    async function say(text: any, ms?: any) {
      log.textContent = text;
      await sleep(ms == null ? 650 : ms);
    }
    function flash(i: any) {
      sprs[i].classList.remove("flash");
      void sprs[i].offsetWidth;
      sprs[i].classList.add("flash");
    }
    // Hidden (not yet appeared) and escaped enemies don't count (M3·C) —
    // native troops never set either flag, so this is the classic filter.
    const livingE = () =>
      enemies.filter((e: any) => e.alive && !e.hidden && !e.escaped);
    const livingP = () => G.party.filter((a: any) => a.hp > 0);
    function variance(v: any) {
      return Math.max(1, Math.floor(v * (0.85 + rndf() * 0.3)));
    }

    // ---- M3·A: the MZ damage-formula path (Project Compass, decision D1) ----
    // A skill with a compilable `formula` runs the sandboxed evaluator + the
    // MZ pipeline instead of the structured power curve; everything here is
    // absent on Atlas-native skills, whose paths (and RNG streams) stay
    // byte-identical. All randomness flows through the seedable rnd/rndf.
    function enemyMp(en: any): number {
      // Lazily seeded OUTSIDE the extracted troop-setup statement that
      // tests/battle-index.test.js pins by source text.
      if (en.mp == null) en.mp = Number(en.d.stats.mmp) || 0;
      return en.mp;
    }
    // ---- M3·B: effective traits (class/enemy + active-state rows) ----
    // Native projects: enemies and states carry no traits, so every eff* read
    // returns the exact pre-M3·B value and no gated roll ever fires.
    function effCarrier(b: any): any {
      if (!b || !b.d) return actorEffCarrier(b);
      const extra = stateTraitRows(b.states);
      const own = b.d.traits || [];
      return extra.length ? { traits: [...own, ...extra] } : { traits: own };
    }
    const effRate = (b: any, type: string, key: any, fb: number) =>
      RA.traitRate(effCarrier(b), type, key, fb);
    const effSum = (b: any, type: string, key: any) =>
      RA.traitSum(effCarrier(b), type, key, 0);
    const effHas = (b: any, type: string, key: any) =>
      RA.traitsOf(effCarrier(b), type, key).length > 0;
    // ---- M3·B: buffs/debuffs (±25% per level, battle-scoped) ----
    const buffsOf = (b: any) => b.buffs || (b.buffs = {});
    /** A battler's stat with its buff level applied (native: no buffs ⇒ the
     *  exact base value — floor(int × 1)). */
    function bStat(b: any, stat: string): number {
      const base = b && b.d ? Number(b.d.stats[stat]) || 0 : param(b, stat);
      const buff = b && b.buffs && b.buffs[stat];
      return buff ? Math.max(0, Math.floor(base * buffRate(buff.level))) : base;
    }
    /** A battler's Luck (post-1.1), buff-aware via bStat: enemy record stat
     *  or actor param — both read 0 when the project never set Luck, so
     *  lukEffectRate stays exactly 1 and no chance shifts. */
    const lukOf = (b: any) => (b ? bStat(b, "luk") : 0);
    /** Clamp vitals under (possibly buff-shrunk) maxima. */
    function clampVitalsB(b: any): void {
      if (isEnemy(b)) {
        b.hp = Math.min(b.hp, bStat(b, "mhp"));
        if (b.mp != null) b.mp = Math.min(b.mp, bStat(b, "mmp"));
      } else {
        b.hp = Math.min(b.hp, bStat(b, "mhp"));
        b.mp = Math.min(b.mp, bStat(b, "mmp"));
      }
    }
    // ---- M3·B: TP. Mechanics gate: the system flag or any TP-using skill/
    // item. Atlas-native projects: gate closed ⇒ zero draws, zero UI. ----
    const tpActive =
      !!proj.system.displayTp ||
      (proj.skills || []).some((s: any) => s && (s.tpCost || s.gainTp)) ||
      (proj.items || []).some((it: any) => it && it.gainTp);
    const tpOf = (b: any) => Number(b.tp) || 0;
    function gainTpTo(b: any, amount: number): void {
      if (!tpActive || !amount) return;
      b.tp = clamp(tpOf(b) + Math.round(amount), 0, MAX_TP);
      if (!isEnemy(b)) refreshParty();
    }
    /** Guarding check incl. the MZ Special-Flag Guard trait (62.1, M3·B). */
    function isGuardingB(b: any): boolean {
      return guards.has(b) || effHas(b, "special", "guardFlag");
    }
    function battlerFacade(b: any): any {
      let f: any;
      if (!b || !b.d) f = actorFormulaFacade(b);
      else {
        const s = b.d.stats;
        f = {
          atk: s.atk || 0, def: s.def || 0, mat: s.mat || 0, mdf: s.mdf || 0,
          agi: s.agi || 0, mhp: s.mhp || 0, mmp: s.mmp || 0,
          hp: b.hp, mp: enemyMp(b), level: 0, luk: s.luk || 0,
        };
      }
      // M3·B: formulas see buffed stats (MZ params include buff rates).
      if (b && b.buffs) {
        for (const k of ["atk", "def", "mat", "mdf", "agi", "mhp", "mmp", "luk"]) {
          const buff = b.buffs[k];
          if (buff) f[k] = Math.max(0, Math.floor(f[k] * buffRate(buff.level)));
        }
      }
      return f;
    }
    /** The skill's formula evaluated for attacker/target, or null → the
     *  structured path (no formula, or one that doesn't compile). */
    function formulaBase(skill: any, attacker: any, target: any): number | null {
      const f = skill && skill.formula ? getFormula(skill.formula) : null;
      if (!f) return null;
      return f.eval({
        a: battlerFacade(attacker),
        b: battlerFacade(target),
        v: (n: any) => Number(G.vars[n]) || 0,
        randomInt: rnd,
      });
    }
    /** MZ crit roll for a formula hit: gated on the skill's `critical` flag
     *  and the attacker's critChance trait sum, shaved by the target's
     *  critEvade (M3·B). Actors keep the M3·A draw pattern; enemies roll only
     *  when they actually carry critChance rows (draw-conserving). */
    function formulaCrit(skill: any, attacker: any, target?: any): boolean {
      if (!skill || !skill.critical) return false;
      if (attacker && attacker.d && !effHas(attacker, "special", "critChance"))
        return false;
      const cev = target ? effSum(target, "special", "critEvade") : 0;
      return rnd(100) < effSum(attacker, "special", "critChance") * (1 - cev / 100);
    }
    /** To-hit for physical actions: MZ-additive hitChance (attacker) and
     *  evadeChance (defender) trait sums over the EFFECTIVE carriers (M3·B —
     *  enemies and states join in). Rolls consume draws ONLY when the traits
     *  exist, so Atlas-native battles never miss and their seeded RNG streams
     *  don't shift by a single draw. */
    function physToHit(attacker: any, target: any): "hit" | "miss" | "evade" {
      const aC = effCarrier(attacker);
      const hasHit = RA.traitsOf(aC, "special", "hitChance").length > 0;
      return mzHitRoll({
        hitPct: hasHit ? RA.traitSum(aC, "special", "hitChance", 0) : null,
        evadePct: effSum(target, "special", "evadeChance"),
        rndf,
      });
    }
    /** Magic evade (MZ mev, M3·B): magical actions roll against the target's
     *  magicEvade sum — gated on the trait existing. */
    function magicEvaded(target: any): boolean {
      const pct = effSum(target, "special", "magicEvade");
      return pct > 0 && rndf() < pct / 100;
    }
    /** The attacker's attack-element keys (trait 31, `element`/`attack:*`). */
    function attackElementKeys(b: any): string[] {
      const rows: any[] = RA.traitsOf(effCarrier(b), "element", null);
      return rows
        .filter((t: any) => String(t.key).startsWith("attack:"))
        .map((t: any) => String(t.key).slice(7));
    }
    /** MZ calcElementRate against `target`: a fixed-element skill reads that
     *  element's rate; a basic attack / `attackElement` skill takes the MAX
     *  over the attacker's attack elements (MZ elementsMaxRate); no elements
     *  at all = neutral 1. */
    function elementRateVs(attacker: any, target: any, skill: any): number {
      if (skill && !skill.attackElement)
        return effRate(target, "element", skillElement(skill), 1);
      const keys = attackElementKeys(attacker);
      if (!keys.length) return 1;
      let best = -Infinity;
      for (const k of keys) best = Math.max(best, effRate(target, "element", k, 1));
      return best;
    }
    /** Target-side pdr/mdr (M3·B sp-params 6/7) for a skill's damage kind. */
    function dmgRateVs(target: any, skill: any): number {
      const phys = !skill || skill.type === "phys";
      return effRate(target, "special", phys ? "physDamage" : "magicDamage", 1);
    }
    /** MZ guard factor for ENEMY targets (actors route through
     *  actorIncomingRate): ÷(2·grd) while guarding, else 1. */
    function guardFactorE(t: any): number {
      if (!isGuardingB(t)) return 1;
      return 1 / (2 * Math.max(0.01, effRate(t, "special", "guardEffect", 1)));
    }
    /** Roll the attacker's on-attack states (trait 32) against a landed hit —
     *  draws only when rows exist; each chance is shaved by the target's
     *  state rate and blocked outright by a resist trait (in addStateTo). */
    async function applyAttackStates(attacker: any, target: any): Promise<void> {
      const rows: any[] = RA.traitsOf(effCarrier(attacker), "state", null);
      for (const row of rows) {
        if (!String(row.key).startsWith("attack:")) continue;
        if (!aliveB(target)) return;
        const id = Number(String(row.key).slice(7)) || 0;
        if (!id) continue;
        // Luck (post-1.1) shaves/boosts the chance — ×1 exactly when neither
        // side has Luck, so the roll count and outcome never change natively.
        const chance =
          (Number(row.value) || 0) *
          effRate(target, "state", String(id), 1) *
          lukEffectRate(lukOf(attacker), lukOf(target));
        if (rnd(100) < chance) await addStateTo(target, id);
      }
    }
    /** Shed states flagged removeByDamage after an HP hit (M3·B state
     *  timing) — a roll per FLAGGED state only. */
    async function shedStatesOnDamage(b: any): Promise<void> {
      for (const st of statesOf(b).slice()) {
        const d = stateDef(st.id);
        if (d && d.removeByDamage && rnd(100) < d.removeByDamage)
          await removeStateFrom(b, st.id);
      }
    }
    /** HP damage side-effects (M3·B): TP charge + damage-shed states. */
    async function afterHpDamage(b: any, dmg: number): Promise<void> {
      if (dmg <= 0) return;
      if (tpActive && aliveB(b))
        gainTpTo(b, tpDamageCharge(dmg, bStat(b, "mhp"), effRate(b, "special", "tpCharge", 1)));
      await shedStatesOnDamage(b);
    }
    /** Apply a skill/item's M3·B extras to one target: buffs/debuffs (with
     *  the debuff-rate trait), permanent growth, learned skills, and TP. */
    async function applySkillExtras(eff: any, target: any, user?: any): Promise<void> {
      if (!eff || !aliveB(target)) return;
      for (const be of eff.buffs || []) {
        if (be.op === "debuff") {
          // Debuff Rate (trait 12) × Luck (post-1.1) — one gated resistance
          // roll, drawn exactly when a debuff-rate trait exists (the M3·B
          // draw, unchanged) or a Luck gap shifts the odds (new, gated on
          // Luck values existing). Native projects: neither ⇒ zero draws.
          const hasRate = effHas(target, "param", "debuff:" + be.stat);
          const dr = hasRate ? effRate(target, "param", "debuff:" + be.stat, 1) : 1;
          const lr = user ? lukEffectRate(lukOf(user), lukOf(target)) : 1;
          if ((hasRate || lr !== 1) && rndf() >= dr * lr) {
            await say(nameOf(target) + " shrugs off the " + be.stat.toUpperCase() + " drop!", 500);
            continue;
          }
        }
        const outcome = applyBuffOp(buffsOf(target), be.stat, be.op, Number(be.turns) || 1);
        if (!outcome) continue;
        const arrow = outcome === "buff" ? "↑" : outcome === "debuff" ? "↓" : "—";
        floatText(battlerElement(target), be.stat.toUpperCase() + arrow, "state");
        clampVitalsB(target);
        refreshParty();
        await say(
          nameOf(target) +
            (outcome === "buff"
              ? "'s " + be.stat.toUpperCase() + " rises!"
              : outcome === "debuff"
                ? "'s " + be.stat.toUpperCase() + " falls!"
                : "'s " + be.stat.toUpperCase() + " returns to normal."),
          500,
        );
      }
      if (!isEnemy(target)) {
        for (const g of eff.grow || []) {
          const plus = target.paramPlus || (target.paramPlus = {});
          plus[g.stat] = (plus[g.stat] || 0) + (Number(g.amount) || 0);
          await say(
            nameOf(target) + "'s " + g.stat.toUpperCase() + " grew by " + g.amount + "!",
            550,
          );
        }
        for (const id of eff.learn || []) {
          const s = RA.byId(proj.skills, Number(id) || 0);
          if (!s) continue;
          const skills = target.skills || (target.skills = []);
          const forgot = target.forgot;
          if (forgot) { const fi = forgot.indexOf(s.id); if (fi >= 0) forgot.splice(fi, 1); }
          if (!skills.includes(s.id) && !learnedSkills(target).some((k: any) => k.id === s.id))
            skills.push(s.id);
          await say(nameOf(target) + " learned " + s.name + "!", 550);
        }
        refreshParty();
      }
      if (eff.gainTp) gainTpTo(target, Number(eff.gainTp) || 0);
    }

    async function pickTarget() {
      const live = livingE();
      if (live.length === 1) return live[0];
      const i = await showList(
        live.map((en: any) => ({ label: en.d.name + "  (HP " + en.hp + ")" })),
        { className: "targetwin" },
      );
      return i < 0 ? null : live[i];
    }
    // mode: "living" (ordinary heals/items) · "dead" (revive — only the
    // fallen are pickable) · "any". Empty pool returns null so the command
    // menu simply falls back to the previous prompt.
    async function pickAlly(mode: "living" | "dead" | "any" = "living") {
      const pool =
        mode === "any"
          ? G.party
          : mode === "dead"
            ? G.party.filter((a: any) => a.hp <= 0)
            : livingP();
      if (!pool.length) return null;
      const i = await showList(
        pool.map((a: any) => ({ label: a.name + "  (HP " + a.hp + ")" })),
        { className: "targetwin" },
      );
      return i < 0 ? null : pool[i];
    }

    async function actorCommand(a: any): Promise<any> {
      while (true) {
        const items = [
          { html: Assets.iconHtml(48, "menu-icon") + "Attack" },
          {
            html: Assets.iconHtml(8, "menu-icon") + "Skills",
            disabled: !learnedSkills(a).length,
          },
          {
            html: Assets.iconHtml(24, "menu-icon") + "Items",
            disabled: !proj.items.some((it: any) => invCount("item", it.id) > 0),
          },
          { html: Assets.iconHtml(22, "menu-icon") + "Guard" },
          {
            html: Assets.iconHtml(7, "menu-icon") + "Escape",
            disabled: !canEscape,
          },
        ];
        const i = await showList(items, {
          title: a.name,
          className: "cmdwin",
          cancellable: false,
        });
        if (i === 0) {
          const t = await pickTarget();
          if (t) return { type: "attack", target: t };
        } else if (i === 1) {
          const skills = learnedSkills(a);
          const si = await showList(
            skills.map((s: any) => ({
              html:
                iconEntryHtml(s) +
                ' <span class="cnt">' +
                skillMpCost(a, s) +
                " MP" +
                (tpActive && s.tpCost ? " · " + s.tpCost + " TP" : "") +
                "</span>",
              disabled:
                a.mp < skillMpCost(a, s) ||
                (tpActive && tpOf(a) < (Number(s.tpCost) || 0)) ||
                skillBlocked(a, s),
            })),
            { title: "Skill", className: "cmdwin" },
          );
          if (si < 0) continue;
          const s = skills[si];
          if (s.scope === "enemy") {
            const t = await pickTarget();
            if (t) return { type: "skill", skill: s, target: t };
          } else if (s.scope === "ally") {
            const t = await pickAlly(s.revive ? "dead" : "living");
            if (t) return { type: "skill", skill: s, target: t };
          } else {
            return { type: "skill", skill: s };
          }
        } else if (i === 2) {
          const list = proj.items.filter((it: any) => invCount("item", it.id) > 0);
          const ii = await showList(
            list.map((it: any) => ({
              html:
                iconEntryHtml(it) +
                ' <span class="cnt">×' +
                invCount("item", it.id) +
                "</span>",
            })),
            { title: "Item", className: "cmdwin" },
          );
          if (ii < 0) continue;
          const t = await pickAlly(list[ii].revive ? "dead" : "living");
          if (t) return { type: "item", item: list[ii], target: t };
        } else if (i === 3) {
          return { type: "guard" };
        } else if (i === 4) {
          return { type: "escape" };
        }
      }
    }

    function enemyAction(en: any): any {
      const raw =
        en.d.actions && en.d.actions.length
          ? en.d.actions
          : [{ skillId: 0, weight: 1 }];
      // M3·B: rows whose skill the enemy can't use right now — sealed by a
      // state's trait, or TP-short — drop out. Native rows always pass.
      const canUse = (a2: any) => {
        if (!a2.skillId) return true;
        const s = RA.byId(proj.skills, a2.skillId);
        if (!s) return true;
        if (tpActive && tpOf(en) < (Number(s.tpCost) || 0)) return false;
        const carrier = effCarrier(en);
        if (!(carrier.traits || []).length) return true;
        if (RA.traitsOf(carrier, "skill", "seal:" + s.id).length) return false;
        const gate = String(s.stype || s.type || "");
        if (gate && RA.traitsOf(carrier, "skill", "sealType:" + gate).length)
          return false;
        return true;
      };
      const usable = raw.filter(canUse);
      const all = usable.length ? usable : [{ skillId: 0, weight: 1 }];
      // Phase 5: condition-weighted AI — rows whose cond fails drop out of
      // the roll; rows without a cond are always valid (pre-Phase-5 data
      // picks identically). Nothing valid ⇒ basic attack.
      const valid = validEnemyActions(all, {
        turn: turnNumber,
        hpPct: (en.hp / Math.max(1, en.d.stats.mhp)) * 100,
        states: statesOf(en).map((st: any) => Number(st.id) || 0),
        rng: rndf,
        // M3·C condition refinements (MZ types 3/5/6) — computed draw-free.
        mpPct: (enemyMp(en) / Math.max(1, bStat(en, "mmp"))) * 100,
        partyLevel: G.party.reduce((m: any, a: any) => Math.max(m, a.level || 1), 1),
        switches: G.switches,
      });
      const acts = valid.length ? valid : [{ skillId: 0, weight: 1 }];
      const total = acts.reduce((s: any, a2: any) => s + (a2.weight || 1), 0);
      let roll = rndf() * total;
      let chosen = acts[0];
      for (const a2 of acts) {
        roll -= a2.weight || 1;
        if (roll <= 0) {
          chosen = a2;
          break;
        }
      }
      const skill = chosen.skillId
        ? RA.byId(proj.skills, chosen.skillId)
        : null;
      return { type: skill ? "skill" : "attack", skill, enemy: en };
    }

    async function dealToEnemy(en: any, dmg: any, idx: any, kind?: any) {
      const target = sprs[idx];
      const wasAlive = en.alive;
      en.hp -= dmg;
      flash(idx);
      burst(target, kind || "hit", {
        color: kind === "poison" ? "#a050d8" : null,
      });
      floatText(target, "-" + dmg, kind === "crit" ? "crit" : "damage");
      if (en.hp <= 0) {
        en.hp = 0;
        en.alive = false;
      }
      refreshEnemies();
      if (wasAlive && !en.alive) {
        onEnemyKilled(en.d.id);
        burst(target, "death", { count: 22, radius: 62, duration: 650 });
        floatText(target, "DEFEATED", "death");
      }
    }
    function actorDef(a: any) {
      return bStat(a, "def");
    }

    // ---- states (poison / stun / regen…) ----
    const stateDef = (id: any) => RA.byId(proj.states || [], id);
    const statesOf = (b: any) => {
      const list = b.states || (b.states = []);
      // M3·B: normalize stray numeric entries (pre-fix Change State saves)
      // into the {id, turns} shape the battle has always used.
      for (let i = 0; i < list.length; i++) {
        if (typeof list[i] === "number") {
          const d = stateDef(list[i]);
          list[i] = { id: list[i], turns: Math.max(1, (d && d.maxTurns) || 3) };
        }
      }
      return list;
    };
    const isEnemy = (b: any) => !!b.d;
    const nameOf = (b: any) => (isEnemy(b) ? b.d.name : b.name);
    // Buff-aware since M3·B (bStat == the classic read when no buffs exist).
    const maxHpOf = (b: any) => bStat(b, "mhp");
    const aliveB = (b: any) => (isEnemy(b) ? b.alive : b.hp > 0);
    function cannotAct(b: any) {
      return statesOf(b).some((st: any) => {
        const d = stateDef(st.id);
        return d && d.restrict === "act";
      });
    }
    function stateTagsHtml(b: any) {
      return statesOf(b)
        .map((st: any) => {
          const d = stateDef(st.id);
          return d
            ? ' <span class="state-tag" style="color:' +
                esc(d.color || "#e8e8f4") +
                '">' +
                esc(d.name) +
                "</span>"
            : "";
        })
        .join("");
    }
    function refreshStates() {
      enemies.forEach((en: any, i: any) => {
        const slot = sprs[i].querySelector(".battler-states");
        if (slot) slot.innerHTML = stateTagsHtml(en);
      });
      actorSprs.forEach((w: any, i: any) => {
        const a = G.party[i],
          slot = w.querySelector(".battler-states");
        if (a && slot) slot.innerHTML = stateTagsHtml(a);
      });
      refreshParty();
    }
    async function addStateTo(b: any, stateId: any) {
      const d = stateDef(stateId);
      if (!d || !aliveB(b)) return;
      // State Resist (M3·B trait 14): full immunity, no roll consumed.
      if (effHas(b, "state", "resist:" + stateId)) {
        floatText(battlerElement(b), "IMMUNE", "state");
        await say(nameOf(b) + " resists " + d.name + "!", 550);
        return;
      }
      const min = Math.max(1, d.minTurns || 1);
      const max = Math.max(min, d.maxTurns || min);
      const turns = min + rnd(max - min + 1);
      const list = statesOf(b);
      const ex = list.find((st: any) => st.id === stateId);
      if (ex) ex.turns = Math.max(ex.turns, turns);
      else list.push({ id: stateId, turns });
      burst(battlerElement(b), stateId === 1 ? "poison" : "status", {
        color: d.color,
      });
      floatText(battlerElement(b), d.name.toUpperCase(), "state");
      refreshStates();
      await say(nameOf(b) + " is afflicted by " + d.name + "!", 600);
      // M3·B state timing: a restricting state sheds flagged states.
      if (d.restrict === "act") {
        for (const st of list.slice()) {
          const sd = stateDef(st.id);
          if (sd && sd.removeByRestriction && st.id !== stateId)
            await removeStateFrom(b, st.id);
        }
      }
    }
    async function removeStateFrom(b: any, stateId: any) {
      const d = stateDef(stateId);
      const list = statesOf(b);
      const i = list.findIndex((st: any) => st.id === stateId);
      if (i < 0) return;
      list.splice(i, 1);
      burst(battlerElement(b), "heal", { color: d && d.color, count: 8 });
      refreshStates();
      if (d) await say(nameOf(b) + " is cured of " + d.name + ".", 600);
    }
    // roll a skill's state effect against a target
    async function applySkillState(skill: any, target: any, user?: any) {
      if (!skill || !skill.stateId || !aliveB(target)) return;
      if (skill.stateOp === "remove") {
        await removeStateFrom(target, skill.stateId);
        return;
      }
      let chance = skill.stateChance == null ? 100 : skill.stateChance;
      // M3·B: the state-rate read runs over the effective carrier, so enemy
      // records and state-carried traits count too (native: same value).
      chance *= effRate(target, "state", String(skill.stateId), 1);
      // Luck (post-1.1): ×1 exactly when neither side has Luck — the roll
      // below always happened for stateId skills, so no draw is added.
      if (user) chance *= lukEffectRate(lukOf(user), lukOf(target));
      if (rnd(100) < chance) await addStateTo(target, skill.stateId);
    }
    // end-of-round damage/regen ticks and turn-count expiry
    async function tickStates() {
      for (const b of [...livingP(), ...livingE()]) {
        for (const st of statesOf(b).slice()) {
          const d = stateDef(st.id);
          const list = statesOf(b);
          if (!d) {
            list.splice(list.indexOf(st), 1);
            continue;
          }
          if (d.hpTurn && aliveB(b)) {
            let amt = Math.max(
              1,
              Math.floor((maxHpOf(b) * Math.abs(d.hpTurn)) / 100),
            );
            if (d.hpTurn < 0) {
              if (isEnemy(b))
                await dealToEnemy(b, amt, b.i, d.id === 1 ? "poison" : "hit");
              else {
                const tickElement = d.id === 1 ? "poison" : "magic";
                amt = Math.max(
                  1,
                  Math.floor(amt * actorIncomingRate(b, tickElement, false)),
                );
                b.hp = Math.max(0, b.hp - amt);
                actorFlash(b);
                burst(battlerElement(b), d.id === 1 ? "poison" : "hit", {
                  color: d.color,
                });
                floatText(battlerElement(b), "-" + amt, "damage");
              }
              await say(
                nameOf(b) + " takes " + amt + " damage from " + d.name + "!",
                550,
              );
              if (isEnemy(b) && !b.alive)
                await say(b.d.name + " is defeated!", 450);
              if (!isEnemy(b) && b.hp <= 0)
                await say(b.name + " falls!", 500);
            } else {
              b.hp = Math.min(maxHpOf(b), b.hp + amt);
              burst(battlerElement(b), "heal", { color: d.color });
              floatText(battlerElement(b), "+" + amt, "heal");
              await say(
                nameOf(b) + " recovers " + amt + " HP from " + d.name + "!",
                550,
              );
            }
            refreshParty();
            refreshEnemies();
          }
          st.turns--;
          if (st.turns <= 0) {
            list.splice(list.indexOf(st), 1);
            await say(nameOf(b) + "'s " + d.name + " wore off.", 500);
          }
        }
      }
      // ---- M3·B round-end effects: trait regen, TP regen, buff expiry ----
      // All gated on the trait/buff existing — native rounds are untouched.
      for (const b of [...livingP(), ...livingE()]) {
        if (!aliveB(b)) continue;
        const hr = effSum(b, "special", "hpRegen");
        if (hr) {
          const amt = Math.max(1, Math.floor((maxHpOf(b) * Math.abs(hr)) / 100));
          if (hr > 0) {
            b.hp = Math.min(maxHpOf(b), b.hp + amt);
            floatText(battlerElement(b), "+" + amt, "heal");
            await say(nameOf(b) + " recovers " + amt + " HP.", 500);
          } else {
            b.hp = Math.max(0, b.hp - amt);
            floatText(battlerElement(b), "-" + amt, "damage");
            if (isEnemy(b) && b.hp <= 0) { b.alive = false; onEnemyKilled(b.d.id); }
            await say(nameOf(b) + " takes " + amt + " damage.", 500);
          }
          refreshParty();
          refreshEnemies();
        }
        const mr = effSum(b, "special", "mpRegen");
        if (mr) {
          const mmp = bStat(b, "mmp");
          const amt = Math.floor((mmp * mr) / 100);
          if (amt) {
            if (isEnemy(b)) b.mp = clamp(enemyMp(b) + amt, 0, mmp);
            else b.mp = clamp(b.mp + amt, 0, mmp);
            refreshParty();
          }
        }
        if (tpActive) {
          const tr = effSum(b, "special", "tpRegen");
          if (tr) gainTpTo(b, tr);
        }
        if (b.buffs) {
          for (const stat of tickBuffDurations(b.buffs)) {
            clampVitalsB(b);
            await say(nameOf(b) + "'s " + stat.toUpperCase() + " returns to normal.", 450);
          }
          refreshParty();
        }
      }
      refreshStates();
    }
    // ---- side-view battler animations ----
    function actorFlash(a: any) {
      const w = actorSprs[G.party.indexOf(a)];
      if (!w) return;
      w.classList.remove("hurt");
      void w.offsetWidth;
      w.classList.add("hurt");
    }
    function actorStep(a: any) {
      const w = actorSprs[G.party.indexOf(a)];
      if (!w) return;
      w.classList.add("acting");
      burst(w, "dust", { count: 5, radius: 20, size: 5, duration: 330 });
      setTimeout(() => w.classList.remove("acting"), 380);
    }
    function enemyStep(en: any) {
      if (!sideView || !sprs[en.i]) return;
      sprs[en.i].classList.add("acting");
      burst(sprs[en.i], "dust", {
        count: 5,
        radius: 20,
        size: 5,
        duration: 330,
      });
      setTimeout(() => sprs[en.i].classList.remove("acting"), 380);
    }

    // ---- battle v2 shared state (Phase 5 Stage B) ----
    // guards: per-round set in turn mode (built from the collected commands,
    // exactly as before); in ATB/CTB a guard lasts until the battler's next
    // turn comes around (added on act, cleared when they act again).
    let guards: any = new Set();
    let turnNumber = 1;
    // ---- M3·C battle-flow state ----
    // escapePending: an escape-effect skill/item resolved (party side);
    // abortPending: the Abort Battle command fired from a troop page. Both
    // end the battle as an "escape" at the next loop boundary.
    let escapePending = false;
    let abortPending = false;
    let escapeFails = 0; // MZ onEscapeFailure: +0.1 ratio per failed try
    /** Any party member carries this party-ability trait (MZ trait 64 —
     *  dead members count, like Game_Party.partyAbility). */
    const partyAbility = (key: string) =>
      G.party.some(
        (a: any) => RA.traitsOf(actorEffCarrier(a), "special", key).length > 0,
      );
    /** MZ substitute (trait 62.2): a healthy same-side battler with the trait
     *  covers a target below 25% max HP. Deterministic — no draws. */
    function substituteFor(target: any, pool: any[]): any {
      const dying = (b: any) => b.hp < bStat(b, "mhp") / 4;
      if (!aliveB(target) || !dying(target)) return null;
      for (const s of pool) {
        if (s === target || !aliveB(s) || dying(s)) continue;
        if (effHas(s, "special", "substitute")) return s;
      }
      return null;
    }
    /** One escape attempt (both battle loops). MZ ratio under mzBattleFlow
     *  (a preemptive battle always escapes — no draw, like MZ's short-
     *  circuit); the classic Atlas odds otherwise — same single rndf draw. */
    async function tryEscape(): Promise<boolean> {
      const lp = livingP(), le = livingE();
      const pa = lp.reduce((s: any, x: any) => s + bStat(x, "agi"), 0) / Math.max(1, lp.length);
      const ea = le.reduce((s: any, x: any) => s + bStat(x, "agi"), 0) / Math.max(1, le.length);
      const chance = mzFlow
        ? mzEscapeChance(pa, ea, escapeFails)
        : clamp(0.55 + (pa - ea) * 0.03, 0.2, 0.95);
      if ((mzFlow && preemptive) || rndf() < chance) {
        sysSe("escape");
        await say("Got away safely!", 800);
        return true;
      }
      escapeFails++;
      await say("Couldn't escape!", 700);
      return false;
    }
    // ---- troop battle events ----
    const pageRTs = makeTroopPageRTs(troop.pages || []);
    function troopPageView(atTurnEnd?: boolean): any {
      return {
        turn: turnNumber,
        enemies: enemies.map((en: any) => ({
          hpPct: (en.hp / Math.max(1, en.d.stats.mhp)) * 100,
          alive: en.alive,
        })),
        actors: livingP().map((a: any) => ({
          actorId: a.actorId,
          hpPct: (a.hp / Math.max(1, param(a, "mhp"))) * 100,
        })),
        switches: G.switches,
        // M3·C: only the between-turns boundary check can fire `turnEnd`
        // pages (native pages never set the condition — unaffected).
        atTurnEnd: !!atTurnEnd,
      };
    }
    async function checkTroopPages(atTurnEnd?: boolean): Promise<void> {
      if (!pageRTs.length) return;
      for (const rt of pageRTs) {
        if (!livingE().length || !livingP().length) return;
        if (troopPageShouldFire(rt, troopPageView(atTurnEnd))) {
          await new Interp(null).runList(rt.page.commands || []);
          refreshStates();
          refreshEnemies();
        }
      }
    }
    // ---- one command's resolution, extracted VERBATIM from the Phase 1
    // round loop (outer continue/break became return) so turn, ATB, and CTB
    // modes share damage math, states, FX, and animations exactly ----
    async function resolveAction(c: any): Promise<void> {
          if (c.actor && c.actor.hp <= 0) return;
          if (c.enemy && !c.enemy.alive) return;
          if (c.actor) {
            // ---------- party side ----------
            const a = c.actor;
            if (c.type === "stunned") {
              await say(a.name + " can't move!", 500);
              return;
            }
            if (c.type === "guard") {
              burst(actorElement(a), "status", {
                color: "#9ab8f0",
                count: 10,
                radius: 30,
              });
              floatText(actorElement(a), "GUARD", "state");
              await say(a.name + " guards.", 450);
              return;
            }
            if (c.type === "item") {
              if (invCount("item", c.item.id) <= 0) return;
              actorStep(a);
              const revived = c.item.revive && c.target.hp <= 0;
              const used = useItemOn(c.item, c.target);
              if (!used) return;
              burst(actorElement(c.target), revived ? "heal" : "item", {
                count: revived ? 18 : 13,
              });
              if (used.hp || used.mp)
                floatText(
                  actorElement(c.target),
                  used.hp ? "+" + used.hp : "+" + used.mp + " MP",
                  "heal",
                );
              refreshParty();
              refreshStates(); // M3·B: items can add/cure states now
              await say(
                a.name +
                  " uses " +
                  c.item.name +
                  (revived
                    ? " — " + c.target.name + " is revived!"
                    : " on " + c.target.name + "!"),
              );
              if (used.stateRemoved)
                await say(c.target.name + " is cured of " + used.stateRemoved + ".", 550);
              if (used.stateAdded)
                await say(c.target.name + " is afflicted by " + used.stateAdded + "!", 550);
              // M3·C: an escape item (MZ effect 41) — the party slips away.
              if (c.item.escapeBattle) escapePending = true;
              return;
            }
            // M3·C: an escape-effect skill (MZ effect 41), any scope — the
            // party slips away once the action resolves. Costs still apply.
            if (c.type === "skill" && c.skill && c.skill.escapeBattle) {
              if (!c.forced) {
                const cost = skillMpCost(a, c.skill);
                const tcost = tpActive ? Number(c.skill.tpCost) || 0 : 0;
                if (a.mp < cost || tpOf(a) < tcost) return;
                a.mp -= cost;
                if (tcost) a.tp = tpOf(a) - tcost;
              }
              actorStep(a);
              burst(actorElement(a), "status", { color: "#cfd8e8", count: 14, radius: 40 });
              refreshParty();
              await say(a.name + " uses " + c.skill.name + "!", 600);
              escapePending = true;
              return;
            }
            if (
              c.type === "attack" ||
              (c.type === "skill" && c.skill.scope === "enemy") ||
              (c.type === "skill" && c.skill.scope === "enemies")
            ) {
              let skill = c.type === "skill" ? c.skill : null;
              if (skill) {
                // Forced actions skip their costs (MZ Force Action, M3·C).
                if (!c.forced) {
                  const cost = skillMpCost(a, skill);
                  const tcost = tpActive ? Number(skill.tpCost) || 0 : 0;
                  if (a.mp < cost || tpOf(a) < tcost) return;
                  a.mp -= cost;
                  if (tcost) a.tp = tpOf(a) - tcost;
                }
              } else {
                // Attack Skill trait (M3·B, 35): the Attack command casts the
                // configured skill's damage/effects (never charging costs —
                // Attack always works).
                const rows: any[] = RA.traitsOf(effCarrier(a), "special", "attackSkill");
                if (rows.length) {
                  const s = RA.byId(proj.skills, Number(rows[rows.length - 1].value) || 0);
                  if (s && s.type !== "heal" && s.scope !== "ally" && s.scope !== "allies")
                    skill = s;
                }
              }
              const targets =
                skill && skill.scope === "enemies"
                  ? livingE().slice()
                  : [
                      c.target && c.target.alive ? c.target : livingE()[0],
                    ].filter(Boolean);
              const anim = skill ? animById(skill.animationId) : attackAnim(a);
              actorStep(a);
              if (skill && !anim) castFx(actorElement(a), skill, targets.length);
              if (anim)
                await playBattleAnim(
                  anim,
                  actorElement(a),
                  targets.map((t: any) => sprs[t.i]),
                );
              let hits = Math.max(1, Math.floor(Number(skill && skill.hits) || 1));
              // Attack Times+ (M3·B, 34): extra basic-attack strikes.
              if (c.type === "attack")
                hits += Math.max(0, Math.floor(effSum(a, "special", "attackTimes") / 100));
              for (let t of targets) {
                // M3·C substitute: a healthy enemy with the trait shields a
                // dying one (deterministic; native troops carry no flag).
                const sub = substituteFor(t, livingE());
                if (sub) {
                  await say(sub.d.name + " covers " + t.d.name + "!", 550);
                  t = sub;
                }
                // M3·B: a counterattack (physical) or magic reflection
                // preempts the whole hit — both rolls gated on the trait.
                if (!skill || skill.type === "phys") {
                  const cnt = effSum(t, "special", "counterAttack");
                  if (cnt > 0 && rndf() < cnt / 100) {
                    await say(t.d.name + " counters " + a.name + "'s attack!", 600);
                    let cdmg = variance(bStat(t, "atk") * 2 - bStat(a, "def") * 1.2);
                    cdmg = Math.max(
                      1,
                      Math.floor(cdmg * actorIncomingRate(a, "physical", isGuardingB(a), "phys")),
                    );
                    a.hp = Math.max(0, a.hp - cdmg);
                    actorFlash(a);
                    floatText(actorElement(a), "-" + cdmg, "damage");
                    refreshParty();
                    await say(a.name + " takes " + cdmg + "!", 550);
                    await afterHpDamage(a, cdmg);
                    if (a.hp <= 0) await say(a.name + " falls!", 500);
                    continue;
                  }
                } else if (skill.type !== "heal") {
                  const mrf = effSum(t, "special", "magicReflect");
                  if (mrf > 0 && rndf() < mrf / 100) {
                    await say(t.d.name + " reflects " + skill.name + "!", 600);
                    const rBase = formulaBase(skill, a, a);
                    const rdmg =
                      rBase != null
                        ? mzDamageValue({
                            base: rBase,
                            elementRate: 1,
                            critical: false,
                            variance: Number(skill.variance) || 0,
                            guarding: isGuardingB(a),
                            grd: effRate(a, "special", "guardEffect", 1),
                            randomInt: rnd,
                          })
                        : variance(
                            (Number(skill.power) || 0) + bStat(a, "mat") * 2 - bStat(a, "mdf") * 1.5,
                          );
                    a.hp = Math.max(0, a.hp - rdmg);
                    actorFlash(a);
                    floatText(actorElement(a), "-" + rdmg, "damage");
                    refreshParty();
                    await say(a.name + " takes " + rdmg + "!", 550);
                    await afterHpDamage(a, rdmg);
                    if (a.hp <= 0) await say(a.name + " falls!", 500);
                    continue;
                  }
                }
                let landed = false;
                for (let hit = 0; hit < hits; hit++) {
                  if (!t.alive) break;
                  // M3·A: physical actions can miss/evade when hit/evade
                  // traits exist (Atlas-native: no traits → no roll → always
                  // hits, exactly as before).
                  if (
                    (!skill || skill.type === "phys") &&
                    physToHit(a, t) !== "hit"
                  ) {
                    floatText(sprs[t.i], "MISS", "state");
                    await say(
                      a.name +
                        (skill ? "'s " + skill.name : "'s attack") +
                        " misses " +
                        t.d.name +
                        "!",
                      550,
                    );
                    continue;
                  }
                  // Magic evade (M3·B mev) — gated on the target's trait.
                  if (skill && skill.type !== "phys" && magicEvaded(t)) {
                    floatText(sprs[t.i], "MISS", "state");
                    await say(t.d.name + " evades " + skill.name + "!", 550);
                    continue;
                  }
                  landed = true;
                  let dmg;
                  let critical;
                  const fBase = skill ? formulaBase(skill, a, t) : null;
                  if (fBase != null) {
                    // MZ pipeline — element/pdr/mdr/guard now read the
                    // enemy's trait carrier (M3·B); neutral without one.
                    critical = formulaCrit(skill, a, t);
                    dmg = mzDamageValue({
                      base: fBase,
                      elementRate: elementRateVs(a, t, skill),
                      critical,
                      variance: Number(skill.variance) || 0,
                      guarding: isGuardingB(t),
                      grd: effRate(t, "special", "guardEffect", 1),
                      dmgRate: dmgRateVs(t, skill),
                      randomInt: rnd,
                    });
                    if (skill.type === "phys")
                      dmg = applyRowScale(dmg, rowDealtScale(rowOf(a)));
                    if (!anim)
                      Sfx.play(
                        critical ? "crit" : skill.type === "phys" ? "hit" : "magic",
                      );
                  } else {
                    critical =
                      (!skill || skill.type === "phys") &&
                      rnd(100) <
                        effSum(a, "special", "critChance") *
                          (1 - effSum(t, "special", "critEvade") / 100);
                    if (!skill) {
                      dmg = variance(bStat(a, "atk") * 2 - bStat(t, "def") * 1.2);
                      if (!anim) Sfx.play(critical ? "crit" : "hit");
                    } else if (skill.type === "phys") {
                      dmg = variance(
                        ((Number(skill.power) || 0) +
                          bStat(a, "atk") * 2 -
                          bStat(t, "def") * 1.2) *
                          skillPowerRate(a, skill),
                      );
                      if (!anim) Sfx.play("crit");
                    } else {
                      dmg = variance(
                        ((Number(skill.power) || 0) +
                          bStat(a, "mat") * 2 -
                          bStat(t, "mdf") * 1.5) *
                          skillPowerRate(a, skill),
                      );
                      if (!anim) Sfx.play("magic");
                    }
                    if (critical) dmg = Math.max(1, Math.floor(dmg * 1.5));
                    // M3·B: the enemy's element/pdr/mdr/guard rates fold into
                    // the structured path too (×1 without a trait carrier).
                    const mult =
                      elementRateVs(a, t, skill) * dmgRateVs(t, skill) * guardFactorE(t);
                    if (mult !== 1) dmg = Math.max(1, Math.floor(dmg * mult));
                    if (!skill || skill.type === "phys")
                      dmg = applyRowScale(dmg, rowDealtScale(rowOf(a)));
                  }
                  const dtype = skill && skill.dmgType;
                  if (dtype === "mp" || dtype === "mpDrain") {
                    // MP damage/drain (MZ types 2/6): lands on the enemy's MP
                    // pool, never KOs; a drain gives the dealt amount back.
                    const dealt = Math.min(enemyMp(t), dmg);
                    t.mp = enemyMp(t) - dealt;
                    flash(t.i);
                    burst(sprs[t.i], skillKind(skill));
                    floatText(sprs[t.i], "-" + dealt + " MP", "damage");
                    if (dtype === "mpDrain") {
                      a.mp = clamp(a.mp + dealt, 0, bStat(a, "mmp"));
                      floatText(actorElement(a), "+" + dealt + " MP", "heal");
                      refreshParty();
                    }
                    await say(
                      a.name +
                        " casts " +
                        skill.name +
                        " — " +
                        t.d.name +
                        " loses " +
                        dealt +
                        " MP!",
                      550,
                    );
                    continue;
                  }
                  // HP drain (MZ type 5): the attacker absorbs what was dealt
                  // (clamped to the HP the target actually had — MZ rule).
                  const drained =
                    dtype === "hpDrain" ? Math.min(t.hp, dmg) : 0;
                  if (!anim) await travel(actorElement(a), sprs[t.i], skill);
                  await dealToEnemy(
                    t,
                    dmg,
                    t.i,
                    critical ? "crit" : skillKind(skill),
                  );
                  await say(
                    a.name +
                      (skill ? " casts " + skill.name : " attacks") +
                      " — " +
                      t.d.name +
                      " takes " +
                      dmg +
                      "!",
                    550,
                  );
                  await afterHpDamage(t, dmg);
                  if (drained > 0 && a.hp > 0) {
                    a.hp = clamp(a.hp + drained, 0, bStat(a, "mhp"));
                    floatText(actorElement(a), "+" + drained, "heal");
                    refreshParty();
                    await say(a.name + " absorbs " + drained + " HP!", 450);
                  }
                  if (!t.alive) await say(t.d.name + " is defeated!", 450);
                }
                if (landed) {
                  await applySkillState(skill, t, a);
                  // On-attack states (M3·B, trait 32): basic attacks always
                  // roll them; skills only when flagged (MZ effect 21·0).
                  if (!skill || skill.attackStates) await applyAttackStates(a, t);
                  if (skill) await applySkillExtras(skill, t, a);
                }
              }
              if (skill && skill.commonEventId) {
                await new Interp(null).callCommonEvent(Number(skill.commonEventId));
                refreshStates();
              }
            } else if (
              c.type === "skill" &&
              (c.skill.scope === "ally" || c.skill.scope === "allies")
            ) {
              // Forced actions skip their costs (MZ Force Action, M3·C).
              if (!c.forced) {
                const cost = skillMpCost(a, c.skill);
                const tcost = tpActive ? Number(c.skill.tpCost) || 0 : 0;
                if (a.mp < cost || tpOf(a) < tcost) return;
                a.mp -= cost;
                if (tcost) a.tp = tpOf(a) - tcost;
              }
              // Revive skills reach the fallen: a mass revive raises every
              // downed member; ordinary group heals still touch the living
              // only. Single-target already picked its ally in actorCommand.
              const targets =
                c.skill.scope === "allies"
                  ? c.skill.revive
                    ? G.party.filter((m: any) => m.hp <= 0)
                    : livingP()
                  : [c.target];
              const healAnim = animById(c.skill.animationId);
              if (!healAnim) Sfx.play("heal");
              actorStep(a);
              if (!healAnim) castFx(actorElement(a), c.skill, targets.length);
              if (healAnim)
                await playBattleAnim(
                  healAnim,
                  actorElement(a),
                  targets.map((t: any) => actorElement(t)),
                );
              for (const t of targets) {
                const wasFallen = t.hp <= 0;
                // Guard: an ordinary heal never revives, so skip any fallen
                // ally that slipped into the list (target-picking already
                // excludes them — only a revive skill reaches the fallen).
                if (wasFallen && !c.skill.revive) continue;
                // M3·A: a formula heal runs the MZ pipeline (variance; crit
                // ×3 when flagged) and adds the flat power on top — MZ
                // recover effects stack with the formula.
                const fBase = formulaBase(c.skill, a, t);
                let amount;
                if (fBase != null) {
                  amount =
                    mzDamageValue({
                      base: fBase,
                      elementRate: 1,
                      critical: formulaCrit(c.skill, a, t),
                      variance: Number(c.skill.variance) || 0,
                      guarding: false,
                      // MZ rec: heals received scale by the target's
                      // recovery rate (M3·B sp-param 2; 1 natively).
                      dmgRate: effRate(t, "special", "recovery", 1),
                      randomInt: rnd,
                    }) + (Number(c.skill.power) || 0);
                } else {
                  amount = variance(
                    ((Number(c.skill.power) || 0) + bStat(a, "mat") * 1.2) *
                      skillPowerRate(a, c.skill),
                  );
                  const rec = effRate(t, "special", "recovery", 1);
                  if (rec !== 1) amount = Math.max(0, Math.floor(amount * rec));
                }
                if (c.skill.dmgType === "mp" && !wasFallen) {
                  // MP recover (MZ type 4): restores MP instead of HP.
                  t.mp = clamp(t.mp + amount, 0, bStat(t, "mmp"));
                  burst(actorElement(t), "heal", {
                    color: c.skill.color,
                    count: 14,
                  });
                  floatText(actorElement(t), "+" + amount + " MP", "heal");
                  await say(
                    a.name +
                      " casts " +
                      c.skill.name +
                      " — " +
                      t.name +
                      " recovers " +
                      amount +
                      " MP!",
                    550,
                  );
                  await applySkillState(c.skill, t, a);
                  await applySkillExtras(c.skill, t, a);
                  continue;
                }
                // %-of-max recovery (MZ Recover-HP effect value1, M3·A).
                if (c.skill.powerPct)
                  amount += Math.floor(
                    (bStat(t, "mhp") * c.skill.powerPct) / 100,
                  );
                t.hp = clamp(t.hp + amount, 0, bStat(t, "mhp"));
                burst(actorElement(t), "heal", {
                  color: c.skill.color,
                  count: wasFallen ? 18 : 14,
                });
                floatText(actorElement(t), "+" + amount, "heal");
                await say(
                  a.name +
                    " casts " +
                    c.skill.name +
                    " — " +
                    t.name +
                    (wasFallen
                      ? " is revived with " + amount + " HP!"
                      : " recovers " + amount + " HP!"),
                  550,
                );
                await applySkillState(c.skill, t, a);
                await applySkillExtras(c.skill, t, a);
              }
              refreshParty();
              if (c.skill.commonEventId) {
                await new Interp(null).callCommonEvent(Number(c.skill.commonEventId));
                refreshStates();
              }
            }
          } else {
            // ---------- enemy side ----------
            const en = c.enemy;
            if (cannotAct(en)) {
              await say(en.d.name + " can't move!", 500);
              return;
            }
            // M3·B: TP cost for the enemy's skill (validity checked at pick;
            // forced actions skip it — MZ, M3·C).
            if (tpActive && c.skill && !c.forced) {
              const tc = Number(c.skill.tpCost) || 0;
              if (tc) en.tp = Math.max(0, tpOf(en) - tc);
            }
            // M3·C: an enemy escape-effect skill (MZ effect 41) — THAT enemy
            // flees: no rewards from it, battle continues (or ends as a win
            // when nobody visible is left, exactly MZ's appeared-members rule).
            if (c.skill && c.skill.escapeBattle) {
              enemyStep(en);
              en.escaped = true;
              floatText(sprs[en.i], "FLED", "state");
              refreshEnemies();
              await say(en.d.name + " uses " + c.skill.name + " and slips away!", 650);
              return;
            }
            if (c.skill && c.skill.type === "heal") {
              // The Actions editor offers every skill, so heal-type ones must
              // work here too: heal the most-wounded living troop member (self
              // included), with the formula the editor documents (power + 1.2·MAT).
              let ally = en;
              for (const e2 of livingE()) {
                if (
                  e2.hp / Math.max(1, e2.d.stats.mhp) <
                  ally.hp / Math.max(1, ally.d.stats.mhp)
                )
                  ally = e2;
              }
              const healAnim = animById(c.skill.animationId);
              enemyStep(en);
              // M3·A: enemy formula heals run the MZ pipeline too (flat power
              // and %-of-max stack on top, as on the party side).
              const fBase = formulaBase(c.skill, en, ally);
              let amount =
                fBase != null
                  ? mzDamageValue({
                      base: fBase,
                      elementRate: 1,
                      critical: formulaCrit(c.skill, en, ally),
                      variance: Number(c.skill.variance) || 0,
                      guarding: false,
                      dmgRate: effRate(ally, "special", "recovery", 1),
                      randomInt: rnd,
                    }) + (Number(c.skill.power) || 0)
                  : variance(
                      (Number(c.skill.power) || 0) + bStat(en, "mat") * 1.2,
                    );
              if (fBase == null) {
                const rec = effRate(ally, "special", "recovery", 1);
                if (rec !== 1) amount = Math.max(0, Math.floor(amount * rec));
              }
              if (c.skill.powerPct)
                amount += Math.floor(
                  (bStat(ally, "mhp") * c.skill.powerPct) / 100,
                );
              ally.hp = Math.min(bStat(ally, "mhp"), ally.hp + amount);
              if (healAnim) {
                await playBattleAnim(healAnim, sprs[en.i], [sprs[ally.i]]);
              } else {
                Sfx.play("heal");
                castFx(sprs[en.i], c.skill, 1);
                burst(sprs[ally.i], "heal", { color: c.skill.color, count: 14 });
              }
              floatText(sprs[ally.i], "+" + amount, "heal");
              await say(
                en.d.name +
                  " casts " +
                  c.skill.name +
                  " — " +
                  ally.d.name +
                  " recovers " +
                  amount +
                  " HP!",
                550,
              );
              await applySkillState(c.skill, ally, en);
              await applySkillExtras(c.skill, ally, en);
              return;
            }
            const pool = livingP();
            if (!pool.length) return;
            // M3·B: the Target Rate trait (tgr) weighs the pick — same
            // single draw, classic 3:1 row weighting when no one carries it.
            let t = pool[
              weightedTargetIndex(pool, rndf(), (b: any) =>
                effRate(b, "special", "targetRate", 1),
              )
            ];
            // M3·C substitute: a healthy ally with the trait takes the hit
            // for a dying one (deterministic; native parties never redirect).
            const tSub = substituteFor(t, pool);
            if (tSub) {
              await say(tSub.name + " covers " + t.name + "!", 550);
              t = tSub;
            }
            const enemyAnim = c.skill ? animById(c.skill.animationId) : null;
            enemyStep(en);
            // M3·B: an actor's counterattack (physical actions) or magic
            // reflection preempts the enemy's hit — rolls gated on the trait.
            if (!c.skill || c.skill.type === "phys") {
              const cnt = effSum(t, "special", "counterAttack");
              if (cnt > 0 && rndf() < cnt / 100) {
                await say(t.name + " counters " + en.d.name + "'s attack!", 600);
                let cdmg = variance(bStat(t, "atk") * 2 - bStat(en, "def") * 1.2);
                const mult =
                  elementRateVs(t, en, null) *
                  effRate(en, "special", "physDamage", 1) *
                  guardFactorE(en);
                if (mult !== 1) cdmg = Math.max(1, Math.floor(cdmg * mult));
                await dealToEnemy(en, cdmg, en.i);
                await say(en.d.name + " takes " + cdmg + "!", 550);
                await afterHpDamage(en, cdmg);
                if (!en.alive) await say(en.d.name + " is defeated!", 450);
                return;
              }
            } else if (c.skill.type !== "heal") {
              const mrf = effSum(t, "special", "magicReflect");
              if (mrf > 0 && rndf() < mrf / 100) {
                await say(t.name + " reflects " + c.skill.name + "!", 600);
                const rBase = formulaBase(c.skill, en, en);
                const rdmg =
                  rBase != null
                    ? mzDamageValue({
                        base: rBase,
                        elementRate: elementRateVs(en, en, c.skill),
                        critical: false,
                        variance: Number(c.skill.variance) || 0,
                        guarding: isGuardingB(en),
                        grd: effRate(en, "special", "guardEffect", 1),
                        dmgRate: dmgRateVs(en, c.skill),
                        randomInt: rnd,
                      })
                    : Math.max(
                        1,
                        variance(
                          (Number(c.skill.power) || 0) +
                            bStat(en, "mat") * 2 -
                            bStat(en, "mdf") * 1.5,
                        ),
                      );
                await dealToEnemy(en, rdmg, en.i, skillKind(c.skill));
                await say(en.d.name + " takes " + rdmg + "!", 550);
                await afterHpDamage(en, rdmg);
                if (!en.alive) await say(en.d.name + " is defeated!", 450);
                return;
              }
            }
            // M3·A: the defender can evade physical actions when evadeChance
            // traits exist (Atlas-native: no traits → no roll → never evades).
            if (
              (!c.skill || c.skill.type === "phys") &&
              physToHit(en, t) !== "hit"
            ) {
              floatText(actorElement(t), "EVADED", "state");
              await say(
                en.d.name +
                  (c.skill ? " uses " + c.skill.name : " attacks") +
                  " — " +
                  t.name +
                  " evades!",
                550,
              );
              return;
            }
            // Magic evade (M3·B mev) — gated on the actor's trait.
            if (
              c.skill &&
              c.skill.type !== "phys" &&
              c.skill.type !== "heal" &&
              magicEvaded(t)
            ) {
              floatText(actorElement(t), "EVADED", "state");
              await say(
                en.d.name + " uses " + c.skill.name + " — " + t.name + " evades!",
                550,
              );
              return;
            }
            let dmg;
            let drainedE = 0;
            if (c.skill && c.skill.type !== "heal") {
              const fBase = formulaBase(c.skill, en, t);
              if (fBase != null) {
                // M3·A/B MZ pipeline: element (incl. attack elements), the
                // target's pdr/mdr and grd — all neutral without traits.
                dmg = mzDamageValue({
                  base: fBase,
                  elementRate: elementRateVs(en, t, c.skill),
                  critical: formulaCrit(c.skill, en, t),
                  variance: Number(c.skill.variance) || 0,
                  guarding: isGuardingB(t),
                  grd: effRate(t, "special", "guardEffect", 1),
                  dmgRate: dmgRateVs(t, c.skill),
                  randomInt: rnd,
                });
              } else {
                const atkStat =
                  c.skill.type === "phys" ? bStat(en, "atk") : bStat(en, "mat");
                const defStat =
                  c.skill.type === "phys" ? actorDef(t) : bStat(t, "mdf") * 1.5;
                dmg = variance(
                  (Number(c.skill.power) || 0) + atkStat * 2 - defStat,
                );
                dmg = Math.max(
                  1,
                  Math.floor(
                    dmg *
                      actorIncomingRate(
                        t,
                        skillElement(c.skill),
                        isGuardingB(t),
                        c.skill.type === "phys" ? "phys" : "magic",
                      ),
                  ),
                );
                // Attack-element skills (elementId −1) read the enemy's
                // attack elements against the actor's rates (M3·B, gated).
                if (c.skill.attackElement) {
                  const ae = elementRateVs(en, t, c.skill);
                  if (ae !== 1) dmg = Math.max(1, Math.floor(dmg * ae));
                }
              }
              if (c.skill.type === "phys")
                dmg = applyRowScale(dmg, rowTakenScale(rowOf(t)));
              if (!enemyAnim) Sfx.play(c.skill.type === "phys" ? "hit" : "magic");
              if (enemyAnim) {
                await playBattleAnim(enemyAnim, sprs[en.i], [actorElement(t)]);
              } else {
                castFx(sprs[en.i], c.skill, 1);
                await travel(sprs[en.i], actorElement(t), c.skill);
              }
              // MP damage/drain (MZ types 2/6) lands on MP and never KOs.
              const dtypeE = c.skill.dmgType;
              if (dtypeE === "mp" || dtypeE === "mpDrain") {
                const dealt = Math.min(t.mp, dmg);
                t.mp -= dealt;
                actorFlash(t);
                if (!enemyAnim)
                  burst(actorElement(t), skillKind(c.skill), {
                    color: c.skill.color,
                  });
                floatText(actorElement(t), "-" + dealt + " MP", "damage");
                if (dtypeE === "mpDrain")
                  en.mp = Math.min(en.d.stats.mmp || 0, enemyMp(en) + dealt);
                refreshParty();
                await say(
                  en.d.name +
                    " uses " +
                    c.skill.name +
                    " — " +
                    t.name +
                    " loses " +
                    dealt +
                    " MP!",
                  550,
                );
                await applySkillState(c.skill, t, en);
                return;
              }
              if (dtypeE === "hpDrain") drainedE = Math.min(t.hp, dmg);
              await say(
                en.d.name +
                  " uses " +
                  c.skill.name +
                  " — " +
                  t.name +
                  " takes " +
                  dmg +
                  "!",
                550,
              );
            } else {
              dmg = variance(bStat(en, "atk") * 2 - actorDef(t) * 1.2);
              dmg = Math.max(
                1,
                Math.floor(
                  dmg * actorIncomingRate(t, "physical", isGuardingB(t), "phys"),
                ),
              );
              // Attack elements on a basic attack (M3·B trait 31, gated).
              const ae = elementRateVs(en, t, null);
              if (ae !== 1) dmg = Math.max(1, Math.floor(dmg * ae));
              dmg = applyRowScale(dmg, rowTakenScale(rowOf(t)));
              Sfx.play("hit");
              await say(
                en.d.name + " attacks — " + t.name + " takes " + dmg + "!",
                550,
              );
            }
            t.hp = Math.max(0, t.hp - dmg);
            actorFlash(t);
            if (!enemyAnim)
              burst(actorElement(t), skillKind(c.skill), {
                color: c.skill && c.skill.color,
              });
            floatText(
              actorElement(t),
              "-" + dmg,
              c.skill && c.skill.type === "phys" ? "crit" : "damage",
            );
            if (t.hp <= 0) {
              burst(actorElement(t), "death", { count: 20, radius: 55 });
              floatText(actorElement(t), "FALLEN", "death");
            }
            win.classList.remove("shake");
            void win.offsetWidth;
            win.classList.add("shake");
            refreshParty();
            if (t.hp <= 0) await say(t.name + " falls!", 500);
            await afterHpDamage(t, dmg);
            if (drainedE > 0 && en.alive) {
              // HP drain (MZ type 5): the enemy absorbs what it dealt.
              en.hp = Math.min(bStat(en, "mhp"), en.hp + drainedE);
              floatText(sprs[en.i], "+" + drainedE, "heal");
              await say(en.d.name + " absorbs " + drainedE + " HP!", 450);
            }
            if (c.skill) await applySkillState(c.skill, t, en);
            // On-attack states (M3·B): basic attacks always roll them; skills
            // only when flagged. Then the skill's buff/grow/learn/TP extras.
            if (!c.skill || c.skill.attackStates) await applyAttackStates(en, t);
            if (c.skill) await applySkillExtras(c.skill, t, en);
          }
    }
    // ---- ATB / CTB (Phase 5 Stage B): timed scheduling over the core ----
    function updateGauges(battlers: any[], aliveB2: any): void {
      if (battleSystem !== "atb") return;
      for (const b of battlers) {
        const host = b.enemy
          ? sprs[b.enemy.i]
          : partyArea.children[G.party.indexOf(b.actor)];
        if (!host) continue;
        let gauge = host.querySelector(":scope > .atbbar");
        if (!gauge) {
          gauge = el("div", "atbbar");
          gauge.appendChild(el("i", "atb-fill"));
          host.appendChild(gauge);
        }
        const fill = gauge.firstChild as any;
        const pct = aliveB2(b) ? Math.min(100, (b.gauge / ATB_FULL) * 100) : 0;
        fill.style.width = pct + "%";
        fill.classList.toggle("full", pct >= 100);
      }
    }
    let ctbStrip: any = null;
    function updateCtbOrder(battlers: any[], aliveB2: any): void {
      if (battleSystem !== "ctb") return;
      if (!ctbStrip) {
        ctbStrip = el("div", "ctb-order");
        win.insertBefore(ctbStrip, win.firstChild);
      }
      const alive = battlers.filter(aliveB2);
      const order = ctbForecast(
        alive.map((b: any) => ({ counter: b.counter, agi: b.agi() })),
        8,
      );
      ctbStrip.innerHTML = "";
      order.forEach((bi: number, n: number) => {
        const b = alive[bi];
        ctbStrip.appendChild(
          el(
            "span",
            "ctb-chip" + (b.enemy ? " foe" : "") + (n === 0 ? " now" : ""),
            esc(b.enemy ? b.enemy.d.name : b.actor.name),
          ),
        );
      });
    }
    async function runTimedBattle(): Promise<any> {
      const battlers: any[] = [
        ...G.party.map((a: any) => ({ actor: a, agi: () => bStat(a, "agi") })),
        ...enemies.map((en: any) => ({ enemy: en, agi: () => bStat(en, "agi") })),
      ];
      for (const b of battlers) {
        b.gauge = rndf() * ATB_FULL * 0.35;
        b.counter = Math.round(ctbCost(b.agi()) * (0.5 + rndf() * 0.5));
      }
      // M3·C: a first strike / surprise in the timed modes is a deterministic
      // head start applied AFTER the usual seeding draws (same rndf stream):
      // the favored side opens near-ready, the other side starts cold.
      if (preemptive || surprise) {
        for (const b of battlers) {
          const favored = preemptive ? !b.enemy : !!b.enemy;
          if (favored) {
            b.gauge = ATB_FULL * 0.9 + b.gauge * 0.1;
            b.counter = Math.round(b.counter * 0.25);
          } else {
            b.gauge = 0;
            b.counter += ctbCost(b.agi());
          }
        }
      }
      // Hidden/escaped enemies sit out of the schedulers too (M3·C — the
      // flags never exist natively).
      const aliveB2 = (b: any) =>
        b.enemy
          ? b.enemy.alive && !b.enemy.hidden && !b.enemy.escaped
          : b.actor.hp > 0;
      let acts = 0;
      updateCtbOrder(battlers, aliveB2);
      while (true) {
        refreshParty();
        refreshEnemies();
        updateGauges(battlers, aliveB2);
        if (!livingP().length) return "lose";
        if (!livingE().length) return "win";
        // M3·C: escape effects / Abort Battle end the fight here.
        if (escapePending) {
          sysSe("escape");
          await say("The party slips away!", 700);
          return "escape";
        }
        if (abortPending) return "escape";
        // pick the next battler to act
        let next: any = null;
        if (battleSystem === "atb") {
          while (!next) {
            for (const b of battlers) {
              if (!aliveB2(b)) continue;
              // ×8 per 30ms tick ≈ ¾s per refill at agi 30 — agility still
              // scales linearly, the battle just isn't glacial
              b.gauge += atbRate(b.agi()) * 8;
              if (b.gauge >= ATB_FULL && (!next || b.gauge > next.gauge)) next = b;
            }
            updateGauges(battlers, aliveB2);
            if (!next) await sleep(30);
          }
          next.gauge = 0;
        } else {
          const alive = battlers.filter(aliveB2);
          const bi = ctbForecast(
            alive.map((b: any) => ({ counter: b.counter, agi: b.agi() })),
            1,
          )[0];
          next = alive[bi];
          const step = next.counter;
          for (const b of alive) b.counter -= step;
          next.counter = ctbCost(next.agi());
          updateCtbOrder(battlers, aliveB2);
        }
        // act (a guard lasts until the battler's next turn comes around)
        if (next.actor) {
          const a = next.actor;
          guards.delete(a);
          refreshParty();
          updateGauges(battlers, aliveB2); // refreshParty rebuilt the rows
          if (cannotAct(a)) {
            await say(a.name + " can't move!", 500);
          } else if (effHas(a, "special", "autoBattle")) {
            // M3·C autoBattle: no menu — attack a random living enemy (one
            // gated draw for the pick).
            const pool = livingE();
            if (pool.length)
              await resolveAction({ type: "attack", actor: a, target: pool[rnd(pool.length)] });
          } else {
            const c: any = await actorCommand(a);
            c.actor = a;
            if (c.type === "escape") {
              if (await tryEscape()) return "escape";
            } else {
              if (c.type === "guard") guards.add(a);
              await resolveAction(c);
              // Action Times+ (M3·B): gated rolls for immediate extras.
              const rows: any[] = RA.traitsOf(effCarrier(a), "special", "actionTimes");
              let extra = rows.length
                ? extraActionRolls(rows.map((r: any) => Number(r.value) || 0), rndf)
                : 0;
              while (extra-- > 0 && a.hp > 0 && livingE().length && !cannotAct(a)) {
                const c2: any = await actorCommand(a);
                c2.actor = a;
                if (c2.type === "escape") break; // extra actions can't flee
                if (c2.type === "guard") guards.add(a);
                await resolveAction(c2);
              }
            }
          }
        } else {
          const en = next.enemy;
          if (cannotAct(en)) await say(en.d.name + " can't move!", 500);
          else {
            const act = enemyAction(en);
            await resolveAction(act);
            // Attack Times+ (34): extra basic-attack strikes (M3·B).
            if (act.type === "attack") {
              let strikes = Math.floor(effSum(en, "special", "attackTimes") / 100);
              while (strikes-- > 0 && en.alive && livingP().length)
                await resolveAction({ type: "attack", enemy: en });
            }
            // Action Times+ (61): gated rolls for immediate extra actions.
            const rows: any[] = RA.traitsOf(effCarrier(en), "special", "actionTimes");
            let extra = rows.length
              ? extraActionRolls(rows.map((r: any) => Number(r.value) || 0), rndf)
              : 0;
            while (extra-- > 0 && en.alive && livingP().length && !cannotAct(en))
              await resolveAction(enemyAction(en));
          }
        }
        await checkTroopPages();
        // a "turn" = one act per living battler; states tick at the boundary
        acts++;
        if (acts >= Math.max(1, livingP().length + livingE().length)) {
          acts = 0;
          turnNumber++;
          if (livingE().length && livingP().length) await tickStates();
          await checkTroopPages(true); // M3·C: `turnEnd` pages fire here
        }
      }
    }

    let result = null;
    // M3·B: TP opens at 0–24 per battler (MZ initTp) — draws only when the
    // project actually uses TP; preserve-TP battlers keep what they carried.
    if (tpActive) {
      for (const a of G.party) if (!effHas(a, "special", "preserveTp")) a.tp = rnd(25);
      for (const en of enemies) if (!effHas(en, "special", "preserveTp")) en.tp = rnd(25);
    }
    // M3·B: the Change Enemy TP command (342) reaches the live troop here.
    fns.battleAddEnemyTp = (index: number, delta: number) => {
      const list = index < 0 ? enemies : [enemies[index]].filter(Boolean);
      for (const en of list) en.tp = clamp(tpOf(en) + delta, 0, MAX_TP);
    };
    // M3·C: the in-troop commands (RM 331–340) reach the live battle here;
    // the interpreter no-ops while the bridge is absent (outside battle).
    // Troop pages run inside the battle loop, so every op lands mid-fight.
    const opsList = (index: number) =>
      index < 0
        ? enemies.filter((e: any) => !e.escaped)
        : [enemies[index]].filter(Boolean);
    fns.battleEnemyOps = {
      async hp(index: number, delta: number, allowKo: boolean) {
        for (const en of opsList(index)) {
          if (!en.alive) continue;
          if (delta < 0) {
            // Without Allow-Knockout the value stops at 1 HP (RM).
            let dmg = -delta;
            if (!allowKo) dmg = Math.min(dmg, Math.max(0, en.hp - 1));
            if (dmg > 0) await dealToEnemy(en, dmg, en.i);
          } else if (delta > 0) {
            en.hp = Math.min(bStat(en, "mhp"), en.hp + delta);
            floatText(sprs[en.i], "+" + delta, "heal");
          }
        }
        refreshEnemies();
      },
      mp(index: number, delta: number) {
        for (const en of opsList(index)) {
          if (!en.alive) continue;
          en.mp = clamp(enemyMp(en) + delta, 0, bStat(en, "mmp"));
        }
      },
      async state(index: number, op: string, stateId: number) {
        for (const en of opsList(index)) {
          if (!en.alive) continue;
          if (op === "remove") await removeStateFrom(en, stateId);
          else await addStateTo(en, stateId);
        }
      },
      async recoverAll(index: number) {
        for (const en of opsList(index)) {
          en.alive = true; // MZ Recover All revives event-KO'd enemies
          en.hp = bStat(en, "mhp");
          en.mp = bStat(en, "mmp");
          en.states = [];
          delete en.buffs;
          burst(sprs[en.i], "heal", { count: 12 });
        }
        refreshStates();
        refreshEnemies();
      },
      async appear(index: number) {
        for (const en of opsList(index)) {
          if (!en.hidden) continue;
          en.hidden = false;
          refreshEnemies();
          burst(sprs[en.i], "status", { color: "#e8d078", count: 14, radius: 40 });
          await say(en.d.name + " appears!", 650);
        }
      },
      async transform(index: number, enemyId: number) {
        const d = RA.byId(proj.enemies, Number(enemyId) || 0);
        if (!d) return;
        for (const en of opsList(index)) {
          if (!en.alive) continue;
          const oldName = en.d.name;
          en.d = d;
          en.hp = Math.min(en.hp, bStat(en, "mhp"));
          if (en.mp != null) en.mp = Math.min(en.mp, bStat(en, "mmp"));
          // Redraw the battler art + name in place (states/buffs stay — MZ).
          const wrap = sprs[en.i];
          const canvas = wrap.querySelector("canvas");
          if (canvas) {
            const source = Assets.enemyCanvas(d.sprite, d.color, sideView ? 108 : 132);
            canvas.width = source.width;
            canvas.height = source.height;
            canvas.getContext("2d").drawImage(source, 0, 0);
          }
          const nameEl = wrap.querySelector(".enemy-name");
          if (nameEl) nameEl.textContent = d.name;
          await say(oldName + " transforms into " + d.name + "!", 700);
        }
        refreshEnemies();
        refreshStates();
      },
      async showAnim(index: number, animationId: number) {
        const anim = animById(animationId);
        if (!anim) return;
        const targets = (index < 0 ? livingE() : opsList(index).filter((e: any) => e.alive && !e.hidden))
          .map((e: any) => sprs[e.i]);
        if (targets.length) await playBattleAnim(anim, targets[0], targets);
      },
      async forceAction(side: string, index: number, skillId: number, target: number) {
        const skillRec = RA.byId(proj.skills, Number(skillId) || 0);
        if (side === "enemy") {
          const en = enemies[index];
          if (!en || !en.alive || en.hidden || en.escaped) return;
          await resolveAction({
            type: skillRec ? "skill" : "attack",
            skill: skillRec || null,
            enemy: en,
            forced: true,
          });
        } else {
          const a =
            Number(index) === 0
              ? livingP()[0]
              : G.party.find((m: any) => m.actorId === Number(index));
          if (!a || a.hp <= 0) return;
          const c: any = { actor: a, forced: true };
          if (skillRec && (skillRec.scope === "ally" || skillRec.scope === "allies")) {
            c.type = "skill";
            c.skill = skillRec;
            c.target = a;
          } else {
            const pool = livingE();
            if (!pool.length) return;
            c.target =
              target >= 0
                ? pool.find((e: any) => e.i === target) || pool[0]
                : target === -1
                  ? pool[rnd(pool.length)]
                  : pool[0];
            c.type = skillRec ? "skill" : "attack";
            // A scope-less skill still needs the enemy-target branch to fire.
            if (skillRec) c.skill = skillRec.scope ? skillRec : { ...skillRec, scope: "enemy" };
          }
          await resolveAction(c);
        }
        refreshParty();
        refreshStates();
        refreshEnemies();
      },
      abort() {
        abortPending = true;
      },
    };
    try {
      await say("Enemies appear!", 700);
      // M3·C: first-strike / surprise announcements (mzBattleFlow only).
      if (preemptive) await say("You caught them off guard!", 700);
      else if (surprise) await say("You were caught off guard!", 700);
      await checkTroopPages();
      if (battleSystem !== "turn") {
        result = await runTimedBattle();
      } else battleLoop: while (true) {
        refreshParty();
        refreshEnemies();
        // M3·C: Abort Battle from the opening troop-page check.
        if (abortPending) {
          result = "escape";
          break;
        }
        // ---- collect party commands ----
        // M3·C: a surprise round gives the party no commands on turn 1
        // (mzBattleFlow random encounters only — never Atlas-native flow).
        const cmds = [];
        collect: for (const a of surprise && turnNumber === 1 ? [] : livingP()) {
          refreshParty();
          if (cannotAct(a)) {
            cmds.push({ type: "stunned", actor: a });
            continue;
          }
          // Action Times+ (M3·B, trait 61): each row's percent is a gated
          // roll for one extra command this round (zero rows ⇒ zero draws).
          const atRows: any[] = RA.traitsOf(effCarrier(a), "special", "actionTimes");
          const times =
            1 +
            (atRows.length
              ? extraActionRolls(atRows.map((r: any) => Number(r.value) || 0), rndf)
              : 0);
          // M3·C autoBattle (trait 62.0): the actor fights on its own — no
          // menu; one gated draw per command for the target pick.
          if (effHas(a, "special", "autoBattle")) {
            for (let n = 0; n < times; n++) {
              const pool = livingE();
              if (!pool.length) break;
              cmds.push({ type: "attack", actor: a, target: pool[rnd(pool.length)] });
            }
            continue;
          }
          for (let n = 0; n < times; n++) {
            const c: any = await actorCommand(a);
            c.actor = a;
            if (c.type === "escape") {
              if (await tryEscape()) {
                result = "escape";
                break battleLoop;
              }
              cmds.length = 0;
              break collect; // enemies still act
            }
            cmds.push(c);
          }
        }
        guards = new Set(
          cmds.filter((c: any) => c.type === "guard").map((c: any) => c.actor),
        );
        // ---- enemy commands ----
        // M3·C: a preemptive round — the enemies are caught off guard and
        // give no commands on turn 1.
        for (const en of preemptive && turnNumber === 1 ? [] : livingE()) {
          const act = enemyAction(en);
          cmds.push(act);
          // Attack Times+ (34) on a basic attack: extra strikes, pushed as
          // extra attack commands (the target re-rolls per strike, M3·B).
          if (act.type === "attack") {
            const strikes = Math.floor(effSum(en, "special", "attackTimes") / 100);
            for (let n = 0; n < strikes; n++) cmds.push({ type: "attack", enemy: en });
          }
          // Action Times+ for enemies (M3·B, gated rolls).
          const rows: any[] = RA.traitsOf(effCarrier(en), "special", "actionTimes");
          const extra = rows.length
            ? extraActionRolls(rows.map((r: any) => Number(r.value) || 0), rndf)
            : 0;
          for (let n = 0; n < extra; n++) cmds.push(enemyAction(en));
        }
        // ---- sort by agility (buffed since M3·B; basic attacks add the
        // Attack Speed trait — both read 0/base natively) ----
        cmds.sort((x: any, y: any) => {
          const sp = (cmd: any) => {
            const b = cmd.actor || cmd.enemy;
            let v = bStat(b, "agi");
            if (cmd.type === "attack") v += effSum(b, "special", "attackSpeed");
            return v;
          };
          return (
            sp(y) * (0.8 + rndf() * 0.4) -
            sp(x) * (0.8 + rndf() * 0.4)
          );
        });

        for (const c of cmds) {
          await resolveAction(c);
          await checkTroopPages();
          // M3·C: an escape effect or Abort Battle ends the fight here.
          if (escapePending) {
            sysSe("escape");
            await say("The party slips away!", 700);
            result = "escape";
            break battleLoop;
          }
          if (abortPending) {
            result = "escape"; // MZ endBattle(1) — the If-Escape branch runs
            break battleLoop;
          }
          if (!livingE().length || !livingP().length) break;
        }
        if (livingE().length && livingP().length) await tickStates();
        turnNumber++;
        // The between-turns boundary check — the only spot `turnEnd` troop
        // pages can fire (M3·C); native pages see the same call as before.
        await checkTroopPages(true);
        if (abortPending) {
          result = "escape";
          break;
        }
        if (!livingP().length) {
          result = "lose";
          break;
        }
        if (!livingE().length) {
          result = "win";
          break;
        }
      }

      if (result === "win") {
        // M3·C: rewards come from DEFEATED enemies only (MZ dead-members
        // rule) — identical totals natively, where a win means everyone
        // died; hidden never-appeared and escaped enemies pay nothing.
        const defeated = enemies.filter((e: any) => !e.alive);
        const exp = defeated.reduce((s: any, e: any) => s + (e.d.exp || 0), 0);
        // Gold Double party ability (trait 64, M3·C) — ×1 natively.
        const gold =
          defeated.reduce((s: any, e: any) => s + (e.d.gold || 0), 0) *
          (partyAbility("goldDouble") ? 2 : 1);
        Music.stop();
        // Victory jingle (M4·B): the 133-command override wins over the
        // imported System ME; "" silences it; none configured = the classic
        // sting, exactly as before.
        const victoryJingle = jingleKey("victory");
        if (victoryJingle) void playMe(victoryJingle);
        else if (victoryJingle == null) sysSe("levelup");
        const lines: any[] = [];
        await say(
          "Victory!  +" + exp + " EXP, +" + gold + " " + proj.system.currency,
          900,
        );
        G.gold = clamp(G.gold + gold, 0, 9999999);
        // M3·B: the EXP Rate trait (exr) scales each member's share (×1 natively).
        for (const a of livingP())
          gainExp(a, Math.floor(exp * effRate(a, "special", "expRate", 1)), (m: any) =>
            lines.push(m),
          );
        refreshParty();
        for (const m of lines) await say(m, 800);
        // M3·C: victory drops (MZ makeDropItems) — one gated rndf draw per
        // authored drop row; enemies without rows roll nothing.
        const dropRate = partyAbility("dropDouble") ? 2 : 1;
        for (const e of defeated) {
          for (const loot of rollDrops(e.d.drops, dropRate, rndf)) {
            const rec = RA.byId(dbFor(loot.kind), loot.id);
            if (!rec) continue;
            addInv(loot.kind, loot.id, 1);
            await say("Found " + rec.name + "!", 700);
          }
        }
      } else if (result === "lose") {
        noteBattleFailure(troopId, troop.enemies.map((id: any) => Number(id) || 0));
        // Defeat jingle (M4·B): imported/overridden ME only — there was never
        // a native defeat sting here, so none configured plays nothing.
        const defeatJingle = jingleKey("defeat");
        if (defeatJingle) { Music.stop(); void playMe(defeatJingle); }
        await say("The party has fallen...", 1100);
      }
    } finally {
      delete fns.battleAddEnemyTp;
      delete fns.battleEnemyOps;
      // shed battle-only states (poison etc. configured to clear after battle)
      for (const a of G.party) {
        if (a.states)
          a.states = a.states.filter((st: any) => {
            const d = stateDef(st.id);
            return d && !d.removeAtEnd;
          });
        // M3·B: buffs are battle-scoped (MZ removes all buffs at battle end).
        delete a.buffs;
      }
      win.remove();
      ctx.scene = prevScene;
      if (result !== "lose")
        Music.play(prevMusic || (ctx.map && ctx.map.music) || "none");
    }
    return result || "win";
  },
};

// The plugin runtime's atlas.startBattle and the map scene's random
// encounters reach the battle scene through fns.
fns.Battle = Battle;
