# Battles & States

RPGAtlas ships a complete turn-based battle system. This page explains how fights are built, the two
battle views, status effects, and how to keep combat fun and fair.

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

## In-battle actions

Players choose from: **Attack**, **Skills**, **Items**, **Guard**, and **Escape**. Turn order follows
**agility**. Skills and items can hit one target, all enemies, one ally, or the whole party depending
on their **scope**. Combat is enriched with pooled particle effects for hits, magic, healing,
guarding, states, and defeats.

---

## Enemies

Each enemy (Database ▸ Enemies) defines:

- **Stats** — HP, MP, attack, defense, agility, etc.
- **Rewards** — EXP and gold granted on defeat.
- **A weighted action list** — what the enemy tends to do each turn (attack, cast, etc.), with some
  actions more likely than others.
- **A procedural sprite and color tint** — drawn from one of **twelve monster families**, each with a
  distinct silhouette, idle motion, and combat role. Re-tint and re-stat them to create many distinct
  foes from the same family.

Group enemies into **troops** to use them in battle.

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
| **Colors & icon** | How it's shown |

**Skills and items inflict or cure states.** A poison dagger applies *Poison*; an antidote removes it;
a healing spell might also cure *Stun*. Classic examples to build: Poison, Stun/Paralyze, Regen,
Sleep, Silence (block magic), and Berserk.

---

## Class traits

Combat depth largely comes from **classes** (Database ▸ Classes). Traits let you tune:

- **Stats and growth** per level.
- **Elemental resistances** (resist fire, weak to ice…), using the elements you defined in
  [Types](The-Database#types).
- **Skill bonuses** and which skills are learned, and when.
- **Equipment permissions** — which weapons/armors the class may wield.

Two characters of different classes will *feel* different in battle even with the same gear.

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
