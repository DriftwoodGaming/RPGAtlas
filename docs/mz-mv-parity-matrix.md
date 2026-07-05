# RPG Maker MZ/MV → RPGAtlas Parity Matrix

**Status:** DRAFT for the M0·C Fable gate — authored M0·A (2026-07-04, Opus 4.8 High).
**Contract:** this file is the signed scope for Project Compass. Every `+` row below names
the phase (M2/M3/M4/M5) that ships the feature AND flips the corresponding
`translate-commands.ts` / DB-converter entry from `mzTodo` to a real translation. Phases
M1–M5 are graded against this document; M6·C audits "every `+` row landed or was
consciously re-scoped with a report line."

This matrix was written against the RPGAtlas codebase at `main` (commit `6cb48a9`) —
`src/shared/schema.ts` (the `Project`/`AnyCommand`/`Trait` vocabulary),
`src/editor/event-editor/command-defs.ts` (the 33 built-in commands + move-route steps +
text-code legend), `src/shared/tile-flags.ts` + `src/engine/scenes/map-runtime.ts`
(passability/`passOv` model), `src/shared/autotile-registry.ts` (autotile kinds), and
`src/editor/importers/sheet-math.ts` (48px slicer) — and against RPG Maker MV 1.6.x /
MZ 1.x data formats (`rmmv_*` / `rmmz_*` core). MV≈MZ unless a **[MV≠MZ]** note says
otherwise.

---

## Legend

| Symbol | Meaning |
|:--:|---|
| `=` | **Maps directly** to an existing Atlas thing. Importer converts it in M1; no engine work. |
| `+ Mn` | **New engine/editor feature**, assigned to phase **Mn**. Imports as `mzTodo` in M1, becomes real when Mn ships and flips the table entry. |
| `−` | **Skipped** with a plain-language import-report line (locked decision 6). No silent drops. |
| `≈` | **Partial / lossy** map — converts, but with a documented caveat noted in the report. |

**Atlas target vocabulary** (what `=` rows point at): the 33 `AnyCommand` types, `Project`
DB entities (`Actor`/`ClassDef`/`Skill`/`Item`/`Weapon`/`Armor`/`Enemy`/`Troop`/`StateDef`),
`SystemData`, `GameMap`/`MapLayers`/`layersAdv`, `Autotile` groups, `BattleAnimation`, the
`Trait` row (`type` ∈ param/element/state/skill/equip/special), and `passOv`
(0 auto · 1 force-pass · 2 block · 3 ledge).

**`mzTodo` placeholder** (defined fully in the mig-0 decision log, M0·B): an additive optional
command `{ t: "mzTodo", code: number, params: any[], label: string }` — raw MZ code + params
preserved, renders as a friendly yellow note in the event editor, no-ops in the engine, and
emits one report line. Re-importing after a phase ships picks up the real translation.

---

## 0. MV vs MZ deltas (top-level orientation)

| Area | MV | MZ | Atlas disposition |
|---|---|---|---|
| Tile size | 48px native | 48px native | `=` — both feed the existing 48px slicer; **no rescale** (confirmed in roadmap "already have"). |
| Battle animations | sheet-based `Animations.json` (5×… grid + timings) | Effekseer `.efkefc` refs in `Animations.json` | MV sheets **`+ M4·B`** (→ `BattleAnimation`); MZ Effekseer **`− → ≈ M4·B`** (skip the particle file, auto-fallback to nearest Atlas animation by name/element + report line). |
| Plugin command | code **356** — single text string `"PluginName arg arg"` | code **357** — structured `{pluginName, funcName, args:{}}` (+ legacy 356) | Both **`+ M5·A`** (parsed into the plugin report; never executed). |
| Encrypted assets | `.rpgmvp` (img) · `.rpgmvo` (audio) | `.png_` · `.ogg_` | `= (decrypt) M1·A` — same XOR-with-System-key scheme, different extensions; decrypt with the user's own `System.json` `encryptionKey`. |
| Autosave / fast-travel opts | absent | `optAutosave`, `optKeyItemsNumber` in System | `−` (report) — Atlas has no autosave-slot concept. |
| Core scripts | `rpg_*.js` | `rmmz_*.js` | n/a (never imported; JS is M5 guidance only). |
| Side-view default | `optSideView` | `optSideView` (SV is default) | `= partial` — Atlas `battleView:"side"` exists; SV **battler motions/sheets** are `−` (report: "Atlas uses its own battle FX"). |
| `data/System.json advanced{}` | absent | present (screen size, fonts) | `≈ M1·A` — map screen/UI size + font size to `SystemData`; drop the rest with a note. |
| Damage popups / TPB | ATB=TPB (MZ), front/side | same | Atlas `battleSystem` (turn/atb/ctb) covers scheduling; see §7. |

---

## 1. `data/System.json` — field by field

| MZ/MV field | Atlas target | Disp. | Notes |
|---|---|:--:|---|
| `gameTitle` | `system.title` | `=` | |
| `versionId` | — | `−` | editor cache-buster; no Atlas equivalent, silently dropped (not report-worthy). |
| `locale` (MZ) | — | `−` | maps to i18n later; report line if non-default. |
| `currencyUnit` | `system.currency` | `=` | |
| `switches[]` | `system.switches[]` | `=` | index = id−1 in both; Atlas drops MV's leading `null`. |
| `variables[]` | `system.variables[]` | `=` | as above. |
| `partyMembers[]` | `system.party[]` | `=` | actor ids. |
| `elements[]` | `system.types.elements[]` | `≈ M1·A` | MZ = string array (index-keyed); Atlas = `{key,name}` with **stable string keys**. Importer synthesizes `key` from a slug of the name (id 0 = "" / none). Traits that reference element **index** are remapped to the synthesized key. |
| `skillTypes[]` | `system.types.skillTypes[]` | `≈ M1·A` | same string-key synthesis as elements. |
| `weaponTypes[]` | `system.types.weaponTypes[]` (`IdType`) | `=` | Atlas keeps numeric ids here. |
| `armorTypes[]` | `system.types.armorTypes[]` (`IdType`) | `=` | |
| `equipTypes[]` | `system.types.equipTypes[]` (`IdType`) | `=` | |
| `currencyUnit` | `system.currency` | `=` | (dup of above) |
| `terms.basic[]` | help/terms strings | `≈ M2·B` | Atlas has no full term table; the handful the engine shows (Level/HP/MP…) map where present, rest → report. |
| `terms.commands[]` | menu labels | `≈ M2·B` | partial; Atlas menu is fixed-vocab. |
| `terms.params[]` | param labels | `≈ M2·B` | 8 params → Atlas's 7 (`luk` dropped, see §5). |
| `terms.messages{}` | battle/system message templates | `− (report)` | Atlas uses its own message copy; note in report. |
| `windowTone [r,g,b,gray]` | `system.windowColor` | `≈ M2·C` | RGB → `#rrggbb`; the gray channel is dropped (report). Window-color **command** is `+ M2·C`. |
| `boat`/`ship`/`airship {characterName,characterIndex,bgm,startMapId,startX,startY}` | `system.vehicles.{boat,ship,airship}` (`VehicleDef`) | `= M1·A` | charset name+index → Atlas `charset`; `bgm` → `music`; start pos maps 1:1. See §12. |
| `titleBgm` | `system.music.title` | `≈ M1·A` | Atlas music is procedural-theme-or-asset key; imported BGM becomes an `asset:audio/…` key. |
| `battleBgm` | `system.music.battle` | `≈ M1·A` | as above. |
| `victoryMe`/`defeatMe`/`gameoverMe` | `system.music.*` / `system.sounds.*` | `≈ M4·B` | ME channel semantics land in M4·B; M1 stores the asset keys. |
| `sounds[]` (24 system SEs) | `system.sounds{}` | `≈ M1·A` | MZ's fixed 24-entry array → Atlas's logical-key map; unmatched entries dropped with a count in the report. |
| `title1Name`/`title2Name` | title background asset | `≈ M1·A` | imported as an asset; Atlas title screen is themed, so it's a best-effort backdrop + report. |
| `optDrawTitle` | — | `−` | report if OFF. |
| `startMapId`/`startX`/`startY` | `system.startMapId/startX/startY` | `=` | |
| (start direction — not in System) | `system.startDir` | `=` | defaults to down (0). |
| `optTransparent` | `system.startTransparent` | `=` | |
| `optFollowers` | `system.followers` | `=` | see §12. |
| `optSideView` | `system.battleView` | `≈` | `"side"` set; SV sheets not imported (see §0). |
| `optDisplayTp` | (TP system) | `+ M3·B` | TP is a M3·B decision (see §5/§6); flag stored, honored when TP lands. |
| `optSlipDeath`/`optFloorDeath` | floor-damage lethality | `+ M4·A` | tied to damage-floor tiles (§11). |
| `optExtraExp` | — | `−` | report. |
| `optAutosave` (MZ) | — | `−` | Atlas has explicit-save only; report. |
| `optKeyItemsNumber` (MZ) | — | `−` | report. |
| `itemCategories` (MZ) | — | `−` | Atlas menu is fixed; report. |
| `menuCommands` (MZ) | — | `−` | report. |
| `battleback1Name`/`2Name` (default) | per-map battleback | `+ M4·A` | per-map battlebacks are M4·A; System default stored for the importer to apply. |
| `advanced.screenWidth/Height` | `system.screenWidth/Height` | `= M1·A` | |
| `advanced.uiAreaWidth/Height` | `system.uiWidth/uiHeight` | `= M1·A` | |
| `advanced.fontSize`/`mainFontFilename` | `system.fontSize`/`fontText` | `≈ M1·A` | font file → face name best-effort; embedded fonts not imported (report). |
| `advanced.gameId`/`numberFontFilename`/`fallbackFonts` | — | `−` | dropped silently (non-authoring). |
| `editMapId` | — | `−` | editor-only cursor state. |
| `attackMotions`/`magicSkills` (SV) | — | `−` | SV motion tables; report ("Atlas battle uses its own effects"). |
| `tileSize` (MZ, =48) | — | `=` (implicit) | Atlas is 48px; asserted, not stored. |

---

## 2. Database files — record shapes

### `data/Actors.json` → `Actor`
| MZ/MV | Atlas | Disp. | Notes |
|---|---|:--:|---|
| `id`,`name` | `id`,`name` | `=` | |
| `classId` | `classId` | `=` | |
| `initialLevel` | `level` | `=` | |
| `characterName`+`characterIndex` | `charset` | `= M1·A` | name+index → Atlas single-charset key (importer slices the 8-block MV/MZ `$`-less sheet, or uses `$name` big-charset directly). |
| `faceName`+`faceIndex` | face (Assets) | `≈ M1·A` | imported into the face library; index preserved via naming. |
| `battlerName` (SV) | — | `−` | SV battler; report. |
| `equips[]` | `weaponId`,`armorId` | `≈ M1·A` | Atlas actor carries one weapon + one armor id; MZ's multi-slot equip array is reduced to first weapon + first armor, **rest → report line** per actor. Full equip slots are **not** a planned feature. |
| `nickname`,`profile` | — | `− (report)` | Atlas actor has no nickname/profile field; the **commands** that change them are `+ M2·C`, but the static values are report-only. |
| `traits[]` | — (actors have no traits in Atlas) | `+ M3·B` | Atlas puts traits on `ClassDef` only. Actor-level traits are folded into a synthesized per-actor note or merged onto the class at import — **decision deferred to M0·B decision log**; provisionally `≈` merge-onto-class with report. |
| `initialLevel`/`maxLevel` | `level` / — | `≈` | maxLevel dropped (Atlas caps elsewhere); report if <99. |
| `icon` (n/a in MZ) | `icon` | n/a | Atlas-only optional. |

### `data/Classes.json` → `ClassDef`
| MZ/MV | Atlas | Disp. | Notes |
|---|---|:--:|---|
| `id`,`name` | `id`,`name` | `=` | |
| `params[8][100]` | `base`+`growth` (`Params`) | `≈ M1·A` | MZ stores a full 100-level curve for 8 params; Atlas stores `base`+linear `growth` for **7** params (`luk` dropped, §5). Importer fits base(=lvl1)+growth(=slope) and notes the curve is linearized in the report (`≈`). |
| `expParams[4]` (basis,extra,accA,accB) | exp curve | `≈ M1·A` | Atlas has a simpler exp model; importer approximates and reports. |
| `learnings[]` `{level,skillId,note}` | `learnings[]` `{level,skillId}` | `= M1·A` | note dropped. |
| `traits[]` | `traits[]` (`Trait`) | `+ M3·B` | the primary trait carrier — see §5 for per-code mapping. M1 imports the codes it can (`param`/`element`/`state`/`skill`/`equip`) and `mzTodo`-notes the rest until M3·B. |

### `data/Skills.json` → `Skill`
| MZ/MV | Atlas | Disp. | Notes |
|---|---|:--:|---|
| `id`,`name`,`iconIndex` | `id`,`name`,`icon` | `=` | |
| `stypeId` | `type` (skillType key) | `= M1·A` | numeric → synthesized string key (§1 elements). |
| `mpCost` | `mp` | `=` | |
| `tpCost` | — | `+ M3·B` | TP; stored, honored when TP lands. |
| `scope` (0–11) | `scope` | `≈ M1·A` | Atlas scope vocab is `enemy/enemies/ally/allies`; MZ's 12 scopes fold: 1→enemy,2→enemies,7→ally,8→allies,9→ally(dead),10→allies(dead),11→user. Dead-target scopes → `revive:true` when effect is HP recover (§6). Random-target scopes (3–6) `≈` collapse to `enemies` + report. |
| `occasion` (0–3) | — | `≈` | 0 always, 1 battle, 2 menu, 3 never; battle-only/menu-only honored where Atlas allows, else report. |
| `damage{type,elementId,formula,variance,critical}` | `power`/`element`/`color` + **`formula`** | `+ M3·A` | structured `power` maps for simple cases; the **formula string** needs the M3·A evaluator → stored verbatim in a new optional `Skill.formula` field for M3 to consume. `type` (§7), `variance`, `critical` → M3·A. |
| `effects[]` | `stateId`/`stateChance`/`stateOp`/`commonEventId`/`hits` + more | `+ M3·B` | per-effect-code table §6. HP/MP recover, add/remove state, common-event already have Atlas fields; buffs/debuffs/grow/learn are `+ M3·B`. |
| `animationId` | `animationId` | `= M1·A` | resolves after animations convert (§ Animations); −1 ("normal attack") noted. |
| `repeats` | `hits` | `=` | |
| `message1`/`message2` | — | `− (report)` | custom use-messages; Atlas uses its own copy. |
| `requiredWtypeId1/2` | — | `− (report)` | weapon-type gating not modeled. |
| `note` | — | `− (report)` | notetags are plugin territory (§14). |

### `data/Items.json` → `Item`
| MZ/MV | Atlas | Disp. | Notes |
|---|---|:--:|---|
| `id`,`name`,`iconIndex`,`price`,`description` | `id`,`name`,`icon`,`price`,`desc` | `=` | |
| `itypeId` (1 regular, 2 key) | — | `≈` | key-item flag dropped (report if key item); Atlas has no key-item bucket. |
| `consumable` | — | `≈` | non-consumable → report; Atlas items are consumable. |
| `scope`,`occasion` | (as Skills) | `≈`/`+` | §Skills. |
| `damage{}` / `effects[]` | `hp`/`mp`/`revive` + formula | `+ M3·A/B` | recover-HP/MP effects → `hp`/`mp`; dead-scope + recover → `revive:true`; formula → §7 evaluator. |
| `note` | — | `−` | §14. |

### `data/Weapons.json` → `Weapon`
| MZ/MV | Atlas | Disp. | Notes |
|---|---|:--:|---|
| `id`,`name`,`iconIndex`,`price` | same | `=` | |
| `wtypeId` | `wtypeId` | `=` | |
| `params[8]` | `params` (`Params`, 7) | `≈` | luk dropped (§5). |
| `animationId` (attack anim) | `animationId` | `= M1·A` | |
| `traits[]` | — | `+ M3·B` | weapon traits (attack element/state/etc.) → §5; M1 `mzTodo`-notes. |
| `etypeId` (=1) | — | `=` (implicit) | weapons are the weapon slot. |
| `note` | — | `−` | §14. |

### `data/Armors.json` → `Armor`
| MZ/MV | Atlas | Disp. | Notes |
|---|---|:--:|---|
| `id`,`name`,`iconIndex`,`price` | same | `=` | |
| `atypeId` | `atypeId` | `=` | |
| `etypeId` | `etypeId` | `=` | |
| `params[8]` | `params` (7) | `≈` | luk dropped. |
| `traits[]` | — | `+ M3·B` | §5. |
| `note` | — | `−` | §14. |

### `data/Enemies.json` → `Enemy`
| MZ/MV | Atlas | Disp. | Notes |
|---|---|:--:|---|
| `id`,`name` | `id`,`name` | `=` | |
| `battlerName`+`battlerHue` | `sprite`+`color` | `≈ M1·A` | battler image imported as `sprite`; hue → nearest `color` tint (report exact hue). |
| `params[8]` | `stats` (`Params`, 7) | `≈` | luk dropped. |
| `exp`,`gold` | `exp`,`gold` | `=` | |
| `dropItems[3] {kind,dataId,denominator}` | — | `+ M3·C` | Atlas enemy has no drop field yet; **new optional `Enemy.drops[]`** in M3·C; M1 stores as `mzTodo`-note. |
| `actions[] {skillId,conditionType,conditionParam1/2,rating}` | `actions[]` (`EnemyAction`+`EnemyActionCond`) | `≈ M1·A / + M3·C` | `skillId`+`rating`→`weight` map now; **condition types** map to `EnemyActionCond.kind` per §8 (turn/hp/state/always exist; `switch`/`party-level`/`turn-valid` refinements are `+ M3·C`). |
| `traits[]` | — | `+ M3·B` | §5. |
| `note` | — | `−` | §14. |

### `data/Troops.json` → `Troop`
| MZ/MV | Atlas | Disp. | Notes |
|---|---|:--:|---|
| `id`,`name` | `id`,`name` | `=` | |
| `members[] {enemyId,x,y,hidden}` | `enemies[]` (ids) | `≈ M1·A` | Atlas stores enemy ids only; battler x/y position is dropped (Atlas lays out its own formation — report if custom); `hidden` (appear-midbattle) → `+ M3·C`. |
| `pages[] {conditions,span,list}` | `pages[]` (`TroopPage`) | `≈ M1·A / + M3·C` | span maps 1:1 (battle/turn/moment); `list` (commands) runs through §8 translation; **conditions** map to `TroopPageCond` per §8.5 (turn/enemyHp/actorHp/switch exist). |

### `data/States.json` → `StateDef`
| MZ/MV | Atlas | Disp. | Notes |
|---|---|:--:|---|
| `id`,`name`,`iconIndex` | `id`,`name`,`icon` | `=` | |
| `restriction` (0–4) | `restrict` (`none`/`act`) | `≈ M1·A` | 0→none; 1/2/3 (attack enemy/anyone/ally) → `act`+report; 4 (can't move) → `act`. |
| `motion`/`overlay` (SV) | — | `−` | SV; report. |
| `autoRemovalTiming`+`minTurns`+`maxTurns` | `minTurns`/`maxTurns`/`removeAtEnd` | `= M1·A` | timing 2 (turn end) → `removeAtEnd:true`. |
| `stepsToRemove`/`removeByWalking` | — | `+ M3·B` | walk-off states → `+ M3·B`; M1 report. |
| `removeByDamage`+`chanceByDamage` | — | `+ M3·B` | damage-removal → §6; M1 report. |
| `removeByRestriction`,`removeAtBattleEnd` | — | `+ M3·B` | state timing set, §5. |
| `hpRegen`-ish (via traits) | `hpTurn` | `≈` | Atlas `hpTurn` covers slip-damage states; from state trait code 22 hrg/state note. |
| `color` | `color` | `=` | Atlas-only nicety; from icon palette or note. |
| `traits[]` | — | `+ M3·B` | §5. |
| `note` | — | `−` | §14. |

### `data/Animations.json` → `BattleAnimation`
See §10 (its own section — MV sheet vs MZ Effekseer).

### `data/Tilesets.json` → `Tileset` + `Autotile[]`
See §11 (flag bits) and §12b (A1–A5 autotile conversion).

### `data/CommonEvents.json` → `CommonEvent`
| MZ/MV | Atlas | Disp. | Notes |
|---|---|:--:|---|
| `id`,`name` | `id`,`name` | `=` | |
| `trigger` (0 none,1 autorun,2 parallel) | `trigger` (`none`/`auto`/`parallel`) | `= M1·A` | 1→auto. |
| `switchId` | `switchId` | `=` | |
| `list[]` | `commands[]` | via §8 | full command translation. |

### `data/MapInfos.json` → map-tree ordering
| MZ/MV | Atlas | Disp. | Notes |
|---|---|:--:|---|
| `id`,`name`,`order` | `GameMap.id`/`name` + list order | `= M1·B` | |
| `parentId` | `MapFolder` nesting / `folderId` | `≈ M1·B` | MZ maps nest under maps; Atlas nests maps under **folders**. Importer synthesizes a `MapFolder` per parent map (or maps parent→`folderId`) — decision noted in mig-1 spec. |
| `expanded`,`scrollX/Y` | — | `−` | editor UI state. |

### `data/Map###.json` → `GameMap`
| MZ/MV | Atlas | Disp. | Notes |
|---|---|:--:|---|
| `width`,`height` | `width`,`height` | `=` | |
| `data[]` (w·h·6 z-layers) | `layers` (ground/decor/decor2/over) + `layersAdv` | `≈ M1·B` | MZ's 6 layers (0–3 tiles A+B–E, 4 shadow, 5 region) fold: z0→ground, z1→decor, z2→decor2, z3→over, z4→`shadows`, z5→`regions`. Tile-id remap per §11/§12b. `≈` because 4 tile planes → 4 Atlas roles is a rebucket (report if a map used >4 meaningfully). |
| `tilesetId` | `tilesetId` | `=` | |
| `bgm`/`bgs` (autoplay) | `music` / `ambience[]` | `≈ M1·B / + M4·B` | BGM autoplay → `music`; BGS → `ambience[]`; **autoplay-on-enter + interrupt/resume semantics** are `+ M4·B`. |
| `encounterList[]`+`encounterStep` | `encounters` (`MapEncounters`) | `≈ M1·B` | troop ids → `troops[]`; step → `rate`. **Region-scoped encounters** (`regionSet` on an encounter) → `byRegion` `+ M4·A`. |
| `parallaxName`+loop/sx/sy | parallax (map bg) | `+ M4·A` | Atlas parallax handling → M4·A; M1 stores name + report. |
| `scrollType` (0–3 loop) | looping map | `+ M4·A` | loop V/H/both → M4·A; M1 report. |
| `battleback1/2Name` | per-map battleback | `+ M4·A` | §1. |
| `note` | `GameMap.notes` | `= M1·B` | preserved verbatim (editor-only field). |
| `autoplayBgm`/`autoplayBgs` | (as bgm/bgs) | `≈` | flags honored in M1·B (store) / M4·B (semantics). |
| `disableDashing` | — | `−` | report. |
| `events[]` | `events[]` (`MapEvent`) | via §8/§9 | see events + pages below. |

### `data/Map###.json events[].pages[]` → `EventPage`
| MZ/MV | Atlas | Disp. | Notes |
|---|---|:--:|---|
| page `conditions {switch1/2Id,variableId,variableValue,selfSwitchCh,itemId,actorId}` | `EventPageCondition` | `≈ M1·C` | switch1/2 → Atlas has one `switchId`; **two-switch AND** → synthesize (report or fold: first switch + note). variable/self-switch map 1:1. `itemId`/`actorId` conditions → `+ M2·C` (Atlas page cond lacks them) → M1 `mzTodo`-note. |
| page `image {characterName,characterIndex,direction,pattern,tileId}` | `charset`+`dir` | `≈ M1·C` | tile-image events (`tileId`) → a note/placeholder charset + report. |
| page `moveType` (0 fixed,1 random,2 approach,3 custom) | `moveType` (`fixed`/`random`) | `≈ M1·C` | 2 approach → `random`+report; 3 custom route → converted via §9. |
| page `moveSpeed`,`moveFrequency` | — | `≈` | folded into route step cadence; report if unusual. |
| page `priorityType` (0 below,1 same,2 above) | `priority` | `= M1·C` | |
| page `trigger` (0 action,1 touch(player),2 touch(event),3 autorun,4 parallel) | `trigger` | `≈ M1·C` | 0→action,1/2→touch,3→auto,4→parallel. |
| page `walkAnime`/`stepAnime`/`directionFix`/`through` | `through` + move-route flags | `≈` | `through`→`through`; anim flags folded into route (§9). |
| page `list[]` | `commands[]` | via §8 | |

---

## 3. (reserved — see §5–§12 for codes)

---

## 5. Trait codes (11–64)

Atlas `Trait` = `{ type: param|element|state|skill|equip|special, key, value }`. Carried on
`ClassDef` only (actor/weapon/armor/enemy/state traits are **merged onto the effective
battler at import** — merge strategy in the M0·B decision log). All non-`=` rows land in
**M3·B** (trait & effect coverage); M1·A imports the five directly-representable codes and
`mzTodo`-notes the rest.

| Code | MZ name | Atlas | Disp. | Notes |
|:--:|---|---|:--:|---|
| 11 | Element Rate | `type:"element"` | `= M1·A` | key = synthesized element key; value = rate. |
| 12 | Debuff Rate | — | `+ M3·B` | needs debuff model. |
| 13 | State Rate | `type:"state"` | `= M1·A` | key = state id; value = rate. |
| 14 | State Resist | `type:"special"` (resist) | `+ M3·B` | full immunity flag. |
| 21 | Parameter (×8) | `type:"param"` | `≈ M1·A` | 7 of 8 params map (mhp/mmp/atk/def/mat/mdf/agi); **`luk` (param 7) dropped** — no Atlas param. Report per luk trait. |
| 22 | Ex-Param (hit/eva/cri/cev/mev/mrf/cnt/hrg/mrg/trg) | — | `+ M3·B` | Atlas has no ex-params today; hit/eva/cri feed the M3·A formula path, rest → M3·B special traits. |
| 23 | Sp-Param (tgr/grd/rec/pha/mcr/tcr/pdr/mdr/fdr/exr) | — | `+ M3·B` | pdr/mdr/rec are the common ones; all → M3·B. |
| 31 | Attack Element | `type:"element"` (attack) | `+ M3·B` | needs "on attack" semantics. |
| 32 | Attack State | `type:"state"` (attack) | `+ M3·B` | on-hit state infliction. |
| 33 | Attack Speed | — | `+ M3·B` | |
| 34 | Attack Times+ | — | `+ M3·B` | extra hits per attack. |
| 35 | Attack Skill (MZ) | — | `+ M3·B` | replaces normal-attack skill. |
| 41 | Add Skill Type | `type:"skill"` (stype add) | `+ M3·B` | Atlas `skill` trait exists but stype-vs-skill distinction → M3·B. |
| 42 | Seal Skill Type | `type:"skill"` (seal) | `+ M3·B` | |
| 43 | Add Skill | `type:"skill"` | `≈ M1·A` | key = skill id; simplest add-skill maps now. |
| 44 | Seal Skill | `type:"skill"` (seal) | `+ M3·B` | |
| 51 | Equip Weapon Type | `type:"equip"` | `≈ M1·A` | key = weapon type id. |
| 52 | Equip Armor Type | `type:"equip"` | `≈ M1·A` | key = armor type id. |
| 53 | Lock Equip | `type:"equip"` (lock) | `+ M3·B` | |
| 54 | Seal Equip | `type:"equip"` (seal) | `+ M3·B` | |
| 55 | Slot Type (dual wield) | — | `+ M3·B` | Atlas single-weapon; dual-wield → report if unmappable. |
| 61 | Action Times+ | — | `+ M3·B` | extra turns. |
| 62 | Special Flag (autoBattle/guard/substitute/preserveTp) | `type:"special"` | `+ M3·B` | substitute/guard feed M3·C battle flow. |
| 63 | Collapse Effect | — | `− (report)` | visual death effect; Atlas uses its own. |
| 64 | Party Ability (encHalf/encNone/cancelSurprise/raisePreempt/goldDouble/dropDouble) | — | `+ M3·C` | encounter + preemptive/surprise abilities land with battle parity (M3·C). |

**Param index → Atlas note:** MZ params `[mhp,mmp,atk,def,mat,mdf,agi,luk]` (0–7) → Atlas
`Params{mhp,mmp,atk,def,mat,mdf,agi}`. **`luk` has no Atlas home** and is dropped everywhere
(class curves, equip params, enemy stats, param traits) with an aggregated report line
("Luck isn't a stat in Atlas — N places used it"). This is a **locked skip**, not a `+`.

---

## 6. Item/Skill effect codes (11–44)

Effects live in MZ `data.effects[]`. All non-`=` → **M3·B** (or M3·A for formula-driven).
M1·A maps the recover/state/common-event codes onto existing `Skill`/`Item` fields.

| Code | MZ name | Atlas | Disp. | Notes |
|:--:|---|---|:--:|---|
| 11 | Recover HP (value1 %+ value2 flat) | `Skill.power`/`Item.hp` (+ formula) | `≈ M1·A / + M3·A` | flat → `hp`; %-of-max → needs formula (M3·A). Heal-type skill. |
| 12 | Recover MP | `Skill.mp`/`Item.mp` | `≈ M1·A` | as above. |
| 13 | Gain TP | — | `+ M3·B` | TP system. |
| 21 | Add State | `stateId`+`stateChance`+`stateOp:"add"` | `= M1·A` | state 0 = "normal attack death" special → `+ M3·B`. |
| 22 | Remove State | `stateId`+`stateOp:"remove"` | `= M1·A` | |
| 31 | Add Buff | — | `+ M3·B` | param buff (turns). |
| 32 | Add Debuff | — | `+ M3·B` | |
| 33 | Remove Buff | — | `+ M3·B` | |
| 34 | Remove Debuff | — | `+ M3·B` | |
| 41 | Special Effect (escape) | — | `+ M3·C` | "escape from battle" effect. |
| 42 | Grow (permanent param +) | — | `+ M3·B` | |
| 43 | Learn Skill | — | `+ M3·B` | |
| 44 | Common Event | `commonEventId` | `= M1·A` | Atlas `Skill.commonEventId` already exists. |

---

## 7. Damage object & formula (`data.damage`)

| MZ field | Atlas | Disp. | Notes |
|---|---|:--:|---|
| `type` (0 none,1 HP dmg,2 MP dmg,3 HP rec,4 MP rec,5 HP drain,6 MP drain) | heal/damage skill kind | `≈ M1·A / + M3·A` | 1→damage, 3→heal (`type:"heal"`), 2/4→MP variants; **5/6 drain** → `+ M3·A`. |
| `elementId` (−1 normal attack, 0 none, n element) | `Skill.element` | `= M1·A` | −1 → uses attacker's attack element (§5 code 31). |
| `formula` (`"a.atk * 4 - b.def * 2"`) | **new `Skill.formula`** (optional) | `+ M3·A` | the flagship M3·A feature. Stored **verbatim** in M1·A; the sandboxed evaluator (`a`/`b`/`v[n]`/`Math`) lands in M3·A. Structured `power` kept as a fallback for simple curves. |
| `variance` (%) | — | `+ M3·A` | |
| `critical` (bool) | — | `+ M3·A` | crit chance from ex-param `cri`. |

**Battle scheduling:** MZ TPB (`optSideView`+battle system) → Atlas `system.battleSystem`
(`turn`/`atb`/`ctb`). Front/side view → `battleView`. Wait-mode → `atbWait`. `= M1·A`
(best-effort; TPB "active" vs "wait" mapped, report if custom).

---

## 8. Event command codes (101–657)

The spine (`translate-commands.ts`). Each code translates to Atlas `AnyCommand`(s) or becomes
`mzTodo`. Continuation codes (4xx/6xx) are folded into their opener by the parser. **M1·C**
builds this table and its per-code vitest; the `+ Mn` rows flip from `mzTodo` to real when
Mn ships.

### 8.1 Messages & text
| Code | Command | Atlas | Disp. | Phase |
|:--:|---|---|:--:|---|
| 101 | Show Text (settings) | `CmdText` | `≈` | M1·C sets name/face/text; **background & position** → M2·B. |
| 401 | Text line | (folds into 101) | `=` | M1·C |
| 102 | Show Choices | `CmdChoices` | `= ` | M1·C |
| 402 | When [choice] | branch → `CmdChoices.branches[i]` | `=` | M1·C |
| 403 | When Cancel | last branch / cancel handling | `≈` | M1·C (fold; report if cancel-branch used) |
| 404 | End Choices | (structural) | `=` | M1·C |
| 103 | Input Number | — | `+` | **M2·B** |
| 104 | Select Item | — | `+` | **M2·B** |
| 105 | Show Scrolling Text | — | `+` | **M2·A** |
| 405 | Scrolling Text line | (folds into 105) | `+` | M2·A |
| 108 | Comment | (editor comment node / dropped) | `≈` | M1·C — becomes a graph comment or dropped; not report-worthy. |
| 408 | Comment line | (folds into 108) | `≈` | M1·C |

### 8.2 Flow control
| Code | Command | Atlas | Disp. | Phase |
|:--:|---|---|:--:|---|
| 111 | Conditional Branch | `CmdIf` | `≈` | M1·C — see §8.6 for condition-type coverage. |
| 411 | Else | `CmdIf.else` | `=` | M1·C |
| 412 | End (branch) | (structural) | `=` | M1·C |
| 112 | Loop | `CmdLoop` | `=` | M1·C |
| 413 | Repeat Above (loop end) | (structural) | `=` | M1·C |
| 113 | Break Loop | `CmdBreakLoop` | `=` | M1·C |
| 115 | Exit Event Processing | end current list (empty `breakLoop`-like) | `≈` | M1·C — translate to a terminal marker; report if mid-branch. |
| 117 | Common Event | `CmdCommonEvent` | `=` | M1·C |
| 118 | Label | — | `+` | **M2·C** (if matrix keeps labels as real; else flatten) — **decision: real support in M2·C.** |
| 119 | Jump to Label | — | `+` | **M2·C** |

### 8.3 Party / progression
| Code | Command | Atlas | Disp. | Phase |
|:--:|---|---|:--:|---|
| 121 | Control Switches | `CmdSwitch` (×range) | `= ` | M1·C — a range expands to N `CmdSwitch`. |
| 122 | Control Variables | `CmdVar` | `≈` | M1·C for const/rnd/var ops; **game-data operands** (item count, actor param, map x/y…) → `+ M2·C`/report. |
| 123 | Control Self Switch | `CmdSelfSw` | `=` | M1·C |
| 124 | Control Timer | — | `+` | **M2·A** |
| 125 | Change Gold | `CmdGold` | `=` | M1·C |
| 126 | Change Items | `CmdItem` (kind item) | `=` | M1·C |
| 127 | Change Weapons | `CmdItem` (kind weapon) | `=` | M1·C |
| 128 | Change Armors | `CmdItem` (kind armor) | `=` | M1·C |
| 129 | Change Party Member | `CmdParty` | `=` | M1·C |

### 8.4 System settings
| Code | Command | Atlas | Disp. | Phase |
|:--:|---|---|:--:|---|
| 132 | Change Battle BGM | `system.music.battle` set | `≈` | M2·C (or report) |
| 133 | Change Victory ME | music set | `≈ M4·B` | |
| 134 | Change Save Access | — | `+` | **M2·C** |
| 135 | Change Menu Access | — | `+` | **M2·C** |
| 136 | Change Encounter (toggle) | — | `+` | **M2·C** (encounter enable/disable) |
| 137 | Change Formation Access | — | `+` | **M2·C** |
| 138 | Change Window Color | — | `+` | **M2·C** |
| 139 | Change Defeat ME | music set | `≈ M4·B` | |
| 140 | Change Vehicle BGM | vehicle `music` set | `≈` | M2·C/report |

### 8.5 Movement & map
| Code | Command | Atlas | Disp. | Phase |
|:--:|---|---|:--:|---|
| 201 | Transfer Player | `CmdTransfer` | `= ` | M1·C — direct/variable-designated; variable form → resolve or report. |
| 202 | Set Vehicle Location | — | `+` | **M4·A** (vehicle exists; the command → M4·A/report) |
| 203 | Set Event Location | `CmdMove`-ish / — | `≈` | M1·C best-effort teleport; swap-with-event → report. |
| 204 | Scroll Map | — | `+` | **M2·A** |
| 205 | Set Movement Route | `CmdMove` | `≈` | M1·C — route steps per §9. |
| 505 | (move-route step payload) | (folds into 205) | `=` | M1·C |
| 206 | Get on/off Vehicle | — | `≈` | M4·A — Atlas vehicles board via touch; command → report/M4·A. |
| 211 | Change Transparency | `CmdTransparency` | `=` | M1·C |
| 212 | Show Animation | `CmdPlayAnim` | `= ` | M1·C — target player/this/event; on-event → `this`. |
| 213 | Show Balloon Icon | — | `+` | **M2·A** |
| 214 | Erase Event | `CmdErase` | `=` | M1·C |
| 216 | Change Player Followers (show/hide) | `system.followers` toggle | `≈` | M2·C/report |
| 217 | Gather Followers | — | `≈` | report (Atlas followers auto-gather) |
| 281 | Change Map Name Display | — | `−` | report |
| 282 | Change Tileset | — | `+` | **M4·A** (or report) |
| 283 | Change Battle Back | — | `+` | **M4·A** |
| 284 | Change Parallax | — | `+` | **M4·A** |
| 285 | Get Location Info | — | `+` | **M2·C** |

### 8.6 Screen effects
| Code | Command | Atlas | Disp. | Phase |
|:--:|---|---|:--:|---|
| 221 | Fadeout Screen | `CmdFlash`-ish / — | `≈` | M2·A — fade to black; map to a tint/flash or `+ M2·A` tint. |
| 222 | Fadein Screen | — | `≈` | M2·A |
| 223 | Tint Screen | — | `+` | **M2·A** |
| 224 | Flash Screen | `CmdFlash` | `= ` | M1·C — color+duration map; MZ intensity → opacity. |
| 225 | Shake Screen | `CmdShake` | `= ` | M1·C — power/speed/duration map 1:1. |
| 236 | Set Weather Effect | `CmdWeather` | `≈` | M1·C — rain/storm/snow map; MZ has no fog (Atlas adds) — fine. |

### 8.7 Timing
| Code | Command | Atlas | Disp. | Phase |
|:--:|---|---|:--:|---|
| 230 | Wait | `CmdWait` | `=` | M1·C (frames 1:1, 60=1s). |

### 8.8 Pictures
| Code | Command | Atlas | Disp. | Phase |
|:--:|---|---|:--:|---|
| 231 | Show Picture | — | `+` | **M2·A** |
| 232 | Move Picture | — | `+` | **M2·A** |
| 233 | Rotate Picture | — | `+` | **M2·A** |
| 234 | Tint Picture | — | `+` | **M2·A** |
| 235 | Erase Picture | — | `+` | **M2·A** |

### 8.9 Audio & video
| Code | Command | Atlas | Disp. | Phase |
|:--:|---|---|:--:|---|
| 241 | Play BGM | `CmdMusic` | `≈` | M1·C — theme/asset key; **fade/pos/pitch** → M4·B. |
| 242 | Fadeout BGM | `CmdMusic{theme:"none"}` + fade | `≈` | M1·C stop; timed fade → M4·B. |
| 243 | Save BGM | — | `+` | **M4·B** (BGM save/resume across ME) |
| 244 | Resume BGM | — | `+` | **M4·B** |
| 245 | Play BGS | `ambience[]`-ish | `+` | **M4·B** |
| 246 | Fadeout BGS | — | `+` | **M4·B** |
| 249 | Play ME | — | `+` | **M4·B** (ME channel: interrupt BGM, resume) |
| 250 | Play SE | `CmdSe` | `≈` | M1·C — asset SE key; pitch/pan → M4·B. |
| 251 | Stop SE | — | `≈` | M4·B/report |
| 261 | Play Movie | — | `−` | report (Atlas has no video). |

### 8.10 Scene control
| Code | Command | Atlas | Disp. | Phase |
|:--:|---|---|:--:|---|
| 301 | Battle Processing | `CmdBattle` | `≈` | M1·C — troop id direct; variable/random troop → resolve or report. win/escape/lose branches (601/602/603/604) → `+ M3·C`. |
| 601 | If Win | battle branch | `+` | **M3·C** |
| 602 | If Escape | battle branch | `+` | **M3·C** |
| 603 | If Lose | `CmdBattle.lose` branch | `≈` | M1·C (lose flag) / M3·C (branch body) |
| 604 | End Battle branches | (structural) | `=` | M1·C |
| 302 | Shop Processing | `CmdShop` | `≈` | M1·C — goods list; **purchase-only / price override** → report. |
| 605 | (shop goods continuation) | folds into 302 | `=` | M1·C |
| 303 | Name Input Processing | — | `+` | **M2·B** |
| 351 | Open Menu Screen | — | `≈` | report (Atlas opens its own menu) |
| 352 | Open Save Screen | `CmdSave` | `=` | M1·C |
| 353 | Game Over | `CmdGameover` | `=` | M1·C |
| 354 | Return to Title | `CmdToTitle` | `=` | M1·C |

### 8.11 Actor/party data (the "change" family)
All `+ M2·C` unless an Atlas command already exists.
| Code | Command | Atlas | Disp. | Phase |
|:--:|---|---|:--:|---|
| 311 | Change HP | `CmdHeal` (partial) / — | `≈` | M1·C for +HP party heal; targeted/var → M2·C. |
| 312 | Change MP | `CmdHeal` (mp) | `≈` | M1·C / M2·C |
| 313 | Change State | — | `+` | **M2·C** (out-of-battle state) |
| 314 | Recover All | `CmdHeal{full:true}` | `=` | M1·C |
| 315 | Change EXP | — | `+` | **M2·C** |
| 316 | Change Level | — | `+` | **M2·C** |
| 317 | Change Parameters | — | `+` | **M2·C** |
| 318 | Change Skills | — | `+` | **M2·C** |
| 319 | Change Equipment | — | `+` | **M2·C** |
| 320 | Change Name | — | `+` | **M2·C** |
| 321 | Change Class | — | `+` | **M2·C** |
| 322 | Change Actor Images | — | `+` | **M2·C** (charset/face swap) |
| 323 | Change Vehicle Image | — | `+` | **M4·A** |
| 324 | Change Nickname | — | `+` | **M2·C** |
| 325 | Change Profile | — | `+` | **M2·C** |
| 326 | Change TP | — | `+` | **M3·B** (TP) |

### 8.12 Enemy/battle (in-troop) commands
| Code | Command | Atlas | Disp. | Phase |
|:--:|---|---|:--:|---|
| 331 | Change Enemy HP | — | `+` | **M3·C** |
| 332 | Change Enemy MP | — | `+` | **M3·C** |
| 333 | Change Enemy State | — | `+` | **M3·C** |
| 334 | Enemy Recover All | — | `+` | **M3·C** |
| 335 | Enemy Appear | — | `+` | **M3·C** (hidden member reveal) |
| 336 | Enemy Transform | — | `+` | **M3·C** |
| 337 | Show Battle Animation | `CmdPlayAnim` (battle) | `≈` | M3·C |
| 339 | Force Action | — | `+` | **M3·C** |
| 340 | Abort Battle | — | `+` | **M3·C** |
| 342 | Change Enemy TP (MZ) | — | `+` | **M3·B** |

### 8.13 Advanced / script / plugin
| Code | Command | Atlas | Disp. | Phase |
|:--:|---|---|:--:|---|
| 355 | Script | `CmdScript` | `≈` | M1·C wraps the JS in a `mzTodo` OR `CmdScript`; **runnable subset** (`$gameSwitches`/`$gameVariables`/`$gameParty` reads) → `+ M5·B` adapter. |
| 655 | Script line | folds into 355 | `≈` | M1·C |
| 356 | Plugin Command (MV) | — | `+` | **M5·A** (parsed to report; never run) |
| 357 | Plugin Command (MZ) | — | `+` | **M5·A** |
| 108/408 | Comment | (see 8.1) | `≈` | M1·C |

**Any code not listed above** (custom/plugin-injected list codes) → `mzTodo` + report, by
construction. The M1·C vitest is table-driven: one assertion per code in this section.

---

## 9. Move-route codes (1–45)

MZ `Game_Character` route commands → Atlas `CmdMove.steps[]` vocabulary
(`up`/`down`/`left`/`right`/`jump`/`forward`/`turn_up`/`turn_down`/`turn_left`/`turn_right`/
`wait15`/`wait60`). Non-representable steps → dropped-with-report or `mzTodo` route note.
Route conversion is **M1·C**; a few gameplay-affecting steps escalate.

| Code | MZ step | Atlas step | Disp. |
|:--:|---|---|:--:|
| 1 | Move Down | `down` | `=` |
| 2 | Move Left | `left` | `=` |
| 3 | Move Right | `right` | `=` |
| 4 | Move Up | `up` | `=` |
| 5–8 | Move diagonals (LL/LR/UL/UR) | — | `≈` (decompose to two orthogonals + report) |
| 9 | Move at Random | (random moveType) | `≈` |
| 10 | Move toward Player | — | `≈` (report; Atlas has approach moveType at page level) |
| 11 | Move away from Player | — | `≈` (report) |
| 12 | Move Forward | `forward` | `=` |
| 13 | Move Backward | — | `≈` (turn 180 + forward + turn back; report) |
| 14 | Jump | `jump` | `≈` (Atlas jump has no dx/dy args — report if offset) |
| 15 | Wait | `wait15`/`wait60` | `≈` (nearest bucket) |
| 16–19 | Turn Down/Left/Right/Up | `turn_*` | `=` |
| 20–26 | Turn 90°R/90°L/180/90°R-or-L/random/toward/away | `turn_*` (approx) | `≈` |
| 27/28 | Switch ON/OFF | (emit `CmdSwitch` inline) | `≈` (route→command extraction; report) |
| 29 | Change Speed | — | `− (report)` |
| 30 | Change Frequency | — | `− (report)` |
| 31–34 | Walk/Step Anim ON/OFF | — | `−` (silent; cosmetic) |
| 35/36 | Direction Fix ON/OFF | — | `≈` (page-level dir; report) |
| 37/38 | Through ON/OFF | `page.through` | `≈` |
| 39/40 | Transparent ON/OFF | `CmdTransparency` (if player) | `≈` |
| 41 | Change Image | — | `+ M2·C` (Change Actor Images path) / report |
| 42 | Change Opacity | — | `− (report)` |
| 43 | Change Blend Mode | — | `− (report)` |
| 44 | Play SE | `CmdSe` (inline) | `≈` |
| 45 | Script | — | `+ M5·B` / `mzTodo` |

---

## 10. Animations (`data/Animations.json`)

| Aspect | MV | MZ | Atlas | Disp. |
|---|---|---|---|:--:|
| Data model | sheet-based: `frames[][]`, `timings[]` (flash/SE), `animation1/2Name` (image), `position` | Effekseer: `effectName` (`.efkefc`), `flashTimings`, `soundTimings`, `rotation` | `BattleAnimation` (`items[]` timeline: particles/flash/shake/sound/projectile/flipbook) | — |
| MV → Atlas | frames+timings → `AnimItem[]` (flipbook `sheet` from the imported anim image, `flash` items from flash timings, `sound` from SE timings, position→`target`) | — | `+ M4·B` — the MV animation-sheet converter. |
| MZ → Atlas | — | Effekseer particle files **cannot** convert (proprietary binary) | nearest Atlas anim by **name/element heuristic** + report line | `≈ → + M4·B` (auto-fallback + report; Effekseer file itself `−`). |
| `animationId` refs (skills/weapons/commands) | resolve to converted anim | resolve to fallback anim | `animationId` | `= M1·A` (id preserved; resolves once anims convert). |

M1 imports leave `animationId` intact and `mzTodo`-note the animation content; M4·B builds
the actual `BattleAnimation`s and flips these.

---

## 11. Tileset flag bits (`data/Tilesets.json flags[]`)

MZ packs per-tile behavior into a 16-bit `flags` value per tile id. Atlas's model is
`passOv` (0 auto · 1 pass · 2 block · 3 ledge) + autotile-group `pass` + per-tile-def `pass`,
with **no** native ladder/bush/counter/damage/terrain-tag concept yet — those are the M4·A
gaps.

| MZ flag bits | MZ meaning | Atlas | Disp. | Phase |
|---|---|---|:--:|---|
| 0x000F (bits 0–3) | Passage (down/left/right/up quad-dir "4-dir passage") | `passOv` (1 pass / 2 block) + tile-def `pass` | `≈ M1·B` | Atlas passability is **whole-tile**, not 4-directional. All-blocked→`passOv 2`; all-open→pass; **partial (some dirs)** → block + report ("one-way/partial passage simplified"). |
| 0x0010 (bit 4) | Ladder | — | `+` | **M4·A** — new tile behavior. M1·B report. |
| 0x0020 (bit 5) | Bush | — | `+` | **M4·A** |
| 0x0040 (bit 6) | Counter | — | `+` | **M4·A** (talk-over-counter) |
| 0x0080 (bit 7) | Damage Floor | — | `+` | **M4·A** (+ `optFloorDeath`/`optSlipDeath`, §1) |
| 0x0F00 (bits 8–11) | Terrain Tag (0–7) | — | `+` | **M4·A** — terrain-tag gameplay hooks. Stored on the tile/region during M1·B for M4·A to consume. |
| 0x1000+ (bit 12, "★") | Star / above-player priority | `over` layer placement | `≈ M1·B` | ★ tiles route to the `over` role during data-plane rebucket. |

**Region ids (map z-layer 5, 1–255):** MZ regions 1–255 → Atlas `regions[]` (**1–63** —
Atlas's documented range). Regions 64–255 → clamped/report ("region N exceeds Atlas's 63").
`≈ M1·B`.

---

## 12. Vehicles, followers & autotiles

### 12a. Vehicle / follower semantics diff
| Concept | MZ/MV | Atlas | Disp. |
|---|---|---|:--:|
| Vehicle defs | System `boat/ship/airship` | `system.vehicles.{boat,ship,airship}` (`VehicleDef`) | `= M1·A` (charset+start+bgm). |
| Boarding | action button near vehicle / `Get on/off` cmd (206) | touch-to-board (Atlas Phase 5) | `≈` — auto-board works; explicit 206 command → report/M4·A. |
| Vehicle passability | per-vehicle tile passage tables | Atlas vehicle movement rules | `≈` (best-effort; report if custom vehicle passage). |
| Followers | `optFollowers` + gather/spread | `system.followers` (Phase 5 trail) | `= M1·A` for on/off; gather/spread commands (217) → report. |

### 12b. Autotile conversion (A1–A5, 47-pattern)
Atlas `Autotile.kind` ∈ `blob47`(A2) · `edge16` · `corner16` · `a1` · `a3` · `a4`, decoded by
`autotile-registry.ts` from a source block; the map stores one reserved id
(`AUTOTILE_BASE+id`). Conversion is **M1·B** (pure + vitest-covered per the risk register).

| MZ tile family | Content | Atlas `Autotile.kind` | Disp. |
|---|---|---|:--:|
| **A1** | Animated water/waterfall (auto-animated) | `kind:"a1"` + `anim:{frames,fps}` | `≈ M1·B` — sheet → a1 resolver; animation frames preserved. |
| **A2** | Ground autotiles (47-blob) | `kind:"blob47"` | `= M1·B` — the native case; A2 2×3 block → the existing blob47 resolver. |
| **A3** | Building roofs/walls (2×2 repeating) | `kind:"a3"` | `≈ M1·B` |
| **A4** | Wall autotiles (top blob + wall face) | `kind:"a4"` | `≈ M1·B` — split top (47-blob) + wall (vertical repeat). |
| **A5** | Normal single ground tiles (no autotiling) | plain tiles (via 48px slicer) | `= M1·B` — B–E-style single-cell tiles. |
| **B–E** | Object/decoration single tiles (256 each) | plain tiles (48px slicer) | `= M1·B` — straight through `sheet-math.gridCells`. |

The **47-pattern → Atlas pattern set** math is the M1·B risk item: MZ's shape index is derived
from a 4-corner minitile arrangement; Atlas resolves shape from 8-neighbour connectivity at
draw time. The importer only needs to hand Atlas the **source block** in the layout each
`kind` resolver expects — it does **not** pre-bake the 47 shapes. Fixture maps (M0·B) include
the ugly cases (peninsulas, single-tile islands, diagonal junctions).

---

## 13. Message escape codes

Atlas renders escape codes via the **Atlas_TextCodes** plugin (on by default); supported today:
`\v[n]`, `\n[n]`, `\g`, `\i[n]`, `\c[n]`/`\c[#hex]`, `\input[action]`, plus `[b]/[i]/[color]/[size]`
tags (see `command-defs.ts textCodesHelp`). Escape-code **parity** (the full MZ set) is **M2·B**.

| MZ code | Meaning | Atlas | Disp. | Phase |
|---|---|---|:--:|---|
| `\V[n]` | variable value | `\v[n]` | `= M1·C` | (already supported) |
| `\N[n]` | actor name | `\n[n]` | `= M1·C` | |
| `\P[n]` | party-member name | — | `+` | **M2·B** |
| `\G` | currency unit | `\g` | `= M1·C` | |
| `\C[n]` | text color (palette) | `\c[n]` | `≈ M1·C` | MZ palette index → Atlas color; palette map in M2·B. |
| `\I[n]` | icon | `\i[n]` | `= M1·C` | |
| `\{` / `\}` | bigger / smaller text | `[size=n]` | `≈` | **M2·B** (relative-size stack) |
| `\$` | open gold window | — | `+` | **M2·B** |
| `\.` | wait ¼s | — | `+` | **M2·B** (message pacing) |
| `\|` | wait 1s | — | `+` | **M2·B** |
| `\!` | wait for button | — | `+` | **M2·B** |
| `\>` / `\<` | show rest of line instantly / off | — | `+` | **M2·B** |
| `\^` | no input wait after page | — | `+` | **M2·B** |
| `\\` | literal backslash | `\\` | `= M1·C` | |
| `\PX[n]`/`\PY[n]`/`\FS[n]` (MZ) | x/y position, font size | `[size]`/— | `≈` | **M2·B** |
| Name box (MZ `\n<Name>` via base? / plugin) | speaker name | `CmdText.name` | `≈ M2·B` | Atlas has a native name field; a leading name-box escape → `CmdText.name`. |

M1·C passes text through verbatim (unknown escapes render literally — noted in report);
M2·B implements the missing codes and flips them.

---

## 14. Plugins, scripts & notetags

| Source | Atlas | Disp. | Phase |
|---|---|:--:|---|
| `js/plugins.js` (list, params, on/off) | **plugin report section** + guidance table | `+` | **M5·A** — parsed, never executed; top-~20 community plugins get a "Atlas has this / closest thing / not supported" line. |
| `note` fields (actors/items/skills/enemies/states/…) | — | `−`/`+` | notetags are plugin config → surfaced in the M5·A report if they match a known plugin; otherwise `−` with a "notes not imported" line. |
| Script command (355/655) & Conditional-Branch script | minimal read adapter | `+` | **M5·B** — `$gameSwitches.value(n)`, `$gameVariables.value(n)`, `$gameParty` basics only; anything else → `mzTodo` + report. Sandbox rules == Atlas `script` command. |
| `.js` plugin code | — | `−` | never converted; honesty over magic (locked decision, phase M5 intro). |

---

## 15. Assets & decryption

| Asset | MV | MZ | Atlas | Disp. |
|---|---|---|---|:--:|
| Images | `.png`, `.rpgmvp` (enc) | `.png`, `.png_` (enc) | asset library (characters/faces/enemies/tilesets/parallax) | `= (decrypt) M1·A` — XOR header with `System.json encryptionKey`; user's own project only (locked decision 5). |
| Audio | `.ogg`/`.m4a`, `.rpgmvo` (enc) | `.ogg`/`.m4a`, `.ogg_` (enc) | audio library (`asset:audio/…`) | `= (decrypt) M1·A` — `.m4a` fallback → report if no `.ogg`. |
| Fonts | `fonts/*.ttf` + `gamefont.css` | `fonts/` + `advanced.mainFontFilename` | `system.fontText/fontMenu` | `≈` — face name mapped; **font file not embedded** (report: "install the font / uses Atlas default"). |
| Movies | `movies/*.webm/.mp4` | same | — | `−` (no video; report). |
| Effekseer | — | `effects/*.efkefc` | — | `−` (→ animation fallback, §10). |

Encryption detail: MV/MZ prepend a 16-byte fake PNG/OGG header, then XOR the **first 16 bytes**
of real data with the 16-byte key (hex string in `System.json`, split from
`$dataSystem.encryptionKey`). Decryption is symmetric; the M1·A unit tests use a self-made
tiny encrypted sample per fixture (M0·B).

---

## 16. Phase assignment roll-up (`+` rows by phase)

Everything the matrix marks `+` (the final M2–M5 scope). M1 imports each as `mzTodo` / report;
the named phase flips it. **This roll-up is the scope contract graded at M6·C.**

**M2·A — presentation:** Show/Move/Rotate/Tint/Erase Picture (231–235), Tint Screen (223),
Fadeout/in Screen (221/222), Timer (124), Scroll Map (204), Balloon Icon (213), Scrolling Text
(105/405).

**M2·B — messages:** escape-code parity (`\P \{ \} \$ \. \| \! \> \< \^ \PX \PY \FS`, palette
map, name-box), Input Number (103), Select Item (104), Name Input (303), message
background/position (101 options), terms partial.

**M2·C — actor/flow/system:** change-actor family (313,315–325), Labels/Jump (118/119),
Save/Menu/Formation/Encounter access (134–137), Change Window Color (138), Get Location Info
(285), variable game-data operands (122), Change Actor Images route step (41), item/actor page
conditions.

**M3·A — formula:** damage `formula` string evaluator, `variance`, `critical`, drain types
(5/6), %-based HP recover, hit/eva/cri from ex-params.

**M3·B — traits/effects:** trait codes 12,14,22,23,31–35,41,42,44,53–55,61,62; effect codes
13,31–34,42,43; TP system (326/342, `tpCost`, `optDisplayTp`, gain-TP); state timing
(walk-off, damage-removal, restriction-removal); buffs/debuffs; grow/learn.

**M3·C — battle parity:** battle branches (601/602), enemy commands (331–340), Force Action
(339), Abort Battle (340), Enemy Appear/Transform (335/336), enemy `dropItems`, troop `hidden`
members, action-condition refinements, party abilities (trait 64: encounter/preemptive/
surprise), escape effect (41)/escape formula.

**M4·A — map features:** tile flags Ladder/Bush/Counter/Damage-Floor (bits 4–7), Terrain Tag
(bits 8–11), region-scoped encounters, looping maps (`scrollType`), parallax (284 + map
parallax), per-map battlebacks (283 + map/System), Change Tileset (282), vehicle commands
(202/206/323), floor-death opts.

**M4·B — audio-visual:** MV animation-sheet → `BattleAnimation` converter, MZ Effekseer
fallback + report, ME channel (249/243/244, victory/defeat ME), BGS (245/246), BGM
fade/pitch/pan (241 options/242 timed), SE pitch/pan (250 options/251).

**M5·A — plugins:** `plugins.js` parse + guidance table (356/357 in report), notetag surfacing.

**M5·B — scripts:** read-only `$gameVariables`/`$gameSwitches`/`$gameParty` adapter for
Script (355) and Conditional-Branch-Script; everything else `mzTodo` + report.

**Locked skips (`−`, never a phase):** `luk` param everywhere, Play Movie (261), Effekseer
particle files, SV battler sheets/motions, plugin `.js` execution, autosave/key-item-number
opts, map-name-display toggle (281), collapse effect (trait 63), move-route speed/frequency/
opacity/blend steps, editor-only System/MapInfo fields.

---

*End of parity matrix. Amendments at the M0·C Fable gate are made directly in this file and
signed in `docs/mig-0-spec.md`.*
