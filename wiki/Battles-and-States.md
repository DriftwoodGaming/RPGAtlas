# Battles & States

RPGAtlas ships a complete battle system with three scheduling modes. This page explains how fights
are built, the battle views and systems, status effects, and how to keep combat fun and fair.

---

## How a battle happens

A battle always pits the party against a **troop** (a group of enemies defined in the
[Database](The-Database#troops)). You start one in two ways:

- **A fixed battle:** a **Start Battle** [event command](Events#battle-shops--audio) — for bosses and
  scripted fights.
- **Random encounters:** turn them on in **Map Properties** with a list of troops and a rate. See
  [Maps & Tiles](Maps-and-Tiles#random-encounters).

When the player wins they gain **EXP, levels, learned skills, and gold drops**. You decide per-battle
whether the party **can escape** and whether **losing** ends the game or lets the story continue.

---

## The two battle views

Set this in **Database ▸ System ▸ Battle view**:

- **Side view** — the party is shown as animated sprites facing the enemies, classic action-RPG style.
- **Front view** — you see the enemies head-on and the party is "behind the camera," classic
  dragon-questing style.

Both use the same data; it's purely how combat is presented.

---

## The three battle systems

Set this in **Database ▸ System ▸ Battle system** — all three share the exact same damage math,
states, and animations; only the *scheduling* differs:

- **Turn-based** (default) — classic rounds: everyone picks a command, then all actions resolve in
  agility order.
- **ATB** — every battler has an **active-time gauge** that fills with agility; they act the moment
  it's full. Gauges are shown on the party rows and under enemies, and pause while you're choosing a
  command.
- **CTB** — one battler acts at a time in an agility-driven order, previewed as a **turn-order
  strip** across the top of the battle (the highlighted chip acts now).

---

## In-battle actions

Players choose from: **Attack**, **Skills**, **Items**, **Guard**, and **Escape**. Turn order follows
**agility**. Skills and items can hit one target, all enemies, one ally, or the whole party depending
on their **scope**. Combat is enriched with pooled particle effects for hits, magic, healing,
guarding, states, and defeats — and skills/weapons can play authored
[battle animations](The-Database#animations).

**Formation:** the pause menu's **Formation** entry toggles each member between **front** and
**back row**. Back row deals and takes 25% less *physical* damage and is targeted less often —
put your mage there. Back-row members show a ▽ marker in battle.

---

## Damage formulas (advanced)

Every skill works fine with just **Power** — but if you want full control, open a skill's
**Effects & preview** tab and fill in the **Advanced damage** box:

- **Formula** — a little math expression that *replaces* Power, written the RPG Maker way:
  `a.atk * 4 - b.def * 2`. `a` is the user, `b` is the target, and `v[n]` reads game variable
  *n*. You can use the stats `atk def mat mdf agi mhp mmp hp mp level`, the operators
  `+ - * / %`, comparisons with `? :` choices, and `Math.min / max / floor / ceil / round /
  abs / pow / sqrt / randomInt`.
- **Variance %** — how much the result wiggles (20 means ±20%).
- **Can critical** — lets the hit critical for ×3 damage (the chance comes from the class's
  crit bonus).

Formula hits follow the classic order: element rate → critical → variance → guard (a guarding
target takes half). The box checks your formula as you type and explains, in plain words,
anything it can't accept — formulas are read by Atlas's own safe checker, never run as raw
code. Games imported from RPG Maker MV/MZ bring their formulas (and HP/MP drains, MP damage,
%-of-max heals, and hit/evade bonuses) across automatically.

---

## Troop battle events

Each troop (Database ▸ Troops) can carry **battle-event pages**: ordinary event commands that run
mid-battle when their condition hits — boss dialogue, phase-change switches, reinforcement flags,
scripted heals. Conditions: a **turn** pattern (`a + b·x`), an **enemy's HP** dropping to a
threshold, an **actor's HP** dropping to a threshold, or a **switch** being ON (set several — all
must hold). The **span** controls refiring: *once per battle*, *once per turn*, or *each time it
becomes true*.

---

## Enemies

Each enemy (Database ▸ Enemies) defines:

- **Stats** — HP, MP, attack, defense, agility, etc.
- **Rewards** — EXP and gold granted on defeat.
- **A weighted action list** — what the enemy tends to do each turn (attack, cast, etc.), with some
  actions more likely than others. Each row can also carry a **condition** — a turn pattern, own HP
  above/below a percentage, a random chance, or a state on itself — and rows whose condition fails
  drop out of that turn's pick. A dragon that breathes fire every third turn and heals under 30% HP
  is three rows.
- **A procedural sprite and color tint** — drawn from one of **twelve monster families**, each with a
  distinct silhouette, idle motion, and combat role. Re-tint and re-stat them to create many distinct
  foes from the same family.

Group enemies into **troops** to use them in battle.

The same enemy database entries can also power real-time **Action Combat** events on maps. See
[Events](Events#action-combat-events) for sword-swing enemies, touch damage, knockback, and defeat
self-switches.

---

## States

**States** are status effects — the spice of any battle system. Define them in **Database ▸ States**.
Each state controls:

| Property | Meaning |
|---|---|
| **Per-turn HP change (%)** | Poison drains; regen restores |
| **Action restriction** | Whether the afflicted can still act (e.g. stun = can't act) |
| **Duration** | How many turns it lasts |
| **Removed after battle** | Whether it wears off automatically when combat ends |
| **Removal rules** | Walk it off after N map steps, a chance to shake it off when hit, or shed it the moment a stun lands |
| **Traits** | Trait rows that apply *while the state is on* — a Silence that seals magic, a Blind that drops hit chance |
| **Colors & icon** | How it's shown |

**Skills and items inflict or cure states.** A poison dagger applies *Poison*; an antidote removes it
(set the item's **State effect** to *Cure state*); a healing spell might also cure *Stun*. Classic
examples to build: Poison, Stun/Paralyze, Regen, Sleep, Silence (seal the Magic type with a state
trait), and Berserk.

---

## Buffs, debuffs & extra effects

Skills and items can carry **Extra effects** (on their Effects panel):

- **Raise / Lower (buff/debuff)** — nudges a stat by ±25% per step (two steps max) for a few
  rounds, with an ↑/↓ pop-up. Buffs tick down at the end of each round and clear after battle.
  A battler's *Debuff chance* trait can resist incoming debuffs.
- **Permanent growth** — adds to a stat for good (the classic stat-seed item).
- **Teach a skill** — the target learns a skill permanently.
- Items can also grant **TP** and add or cure **states**.

## TP (optional)

Turn on **Show TP in battle** (Database ▸ System) or give any skill a **TP cost** and battles gain
a third resource: every battler opens with a little TP, charges more as they *take damage*, and
spends it on their big moves. Skills can also grant TP on use, traits can regenerate it each round
or keep it between battles, and the **Change TP** / **Change Enemy TP** event commands adjust it
mid-game. Leave the toggle off (and TP costs empty) for classic HP/MP battles.

---

## Traits (classes, enemies & states)

Combat depth largely comes from **traits** — and since the trait editor is shared, they live on
**Classes**, **Enemies**, and **States** alike (Database tabs each have a Traits panel):

- **Stats and growth** per level (classes), plus stat-rate and *debuff chance* rows.
- **Elemental resistances** (resist fire, weak to ice…) and **attack elements** (“Attack
  element: Fire” makes every basic attack burn), using the elements you defined in
  [Types](The-Database#types).
- **State rows**: infliction rates, outright **Resist** (immunity), and **Inflict on attack**
  (a poison blade).
- **Skill rows**: power bonuses per type, **grant/seal a skill or a whole type** — sealed skills
  grey out in battle and in the menu.
- **Equipment permissions** — which weapons/armors may be wielded, plus **lock** (can't change)
  and **seal** (slot forced empty) rows.
- **Special combat effects** — hit/evade/crit chances, critical dodge, magic evade,
  **counterattack**, **magic bounce-back**, HP/MP/TP regen, guard strength, healing received,
  physical/magic damage taken, EXP earned, how often enemies aim here, extra attack hits, extra
  actions per round, always-guarding, and more.

Two characters of different classes will *feel* different in battle even with the same gear — and
enemies with traits (an Ice-weak Slime that sometimes counterattacks) fight back with character.

---

## Tips for fun, fair combat

- **Start small.** Test fights against one weak enemy before assembling tough troops.
- **Give the player tools.** Make sure healing items/skills exist before you deploy poison enemies.
- **Telegraph difficulty.** Use safe (encounter-free) towns between dangerous areas.
- **Use states for variety**, not frustration — long stuns or unresisted instant-death feel unfair.
- **Reward exploration.** Put the best gear behind optional [chests](Events#recipes) and tough
  optional troops.
- **Playtest the curve.** Level a fresh party through your dungeon and watch where it spikes.

**Next:** [Characters & Custom Assets →](Characters-and-Custom-Assets)
