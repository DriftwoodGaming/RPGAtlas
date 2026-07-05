# MZ/MV importer fixtures — "Cove Test"

Two hand-authored RPG Maker projects the Project Compass importer (phases M1+)
is built and tested against:

- `mv-project/` — RPG Maker **MV** 1.6.x format (`Game.rpgproject`)
- `mz-project/` — RPG Maker **MZ** 1.x format (`Game.rmmzproject`)

Both hold the **same** micro-game so the importer's MV-vs-MZ delta handling
(§0 of the parity matrix) is tested against a controlled diff. Every byte is
self-made per locked decision 5 — **no RTP, no DLC, no RPG Maker-exported
data**. The generator `scripts/build-migration-fixtures.mjs` is the readable
source of truth; it is deterministic + idempotent (rerun ⇒ byte-identical), and
the emitted files are committed so tests/CI never need to run it. Edit the
generator, not the JSON.

## Placeholder assets

Images are a 1×1 transparent PNG swatch; audio is an `OggS`-tagged stub (a byte
fixture for intake/decryption, **not** a playable stream). This keeps the
fixtures tiny; slicer/render fidelity is not what these projects test.

Each project ships **one encrypted sample**: `img/pictures/Sign.rpgmvp` (MV) /
`Sign.png_` (MZ) — the "Sign" picture the Show Picture command (231) references.
It decrypts with `System.json → encryptionKey` (MV/MZ 16-byte fake header, then
first 16 bytes XORed with the key). All other assets ship plain so the slicer
has plain input; the importer detects encryption by file extension.
`hasEncryptedImages` is `true` and `encryptionKey` is present in both.

## Requirement → fixture element (M0·B checklist)

| M0·B requirement | Where it lives |
|---|---|
| 2 maps + transfer | `Map001` (Harbor) ↔ `Map002` (Cave); events `ToCave`/`Return` use command 201 |
| Autotiles + ugly cases | Tileset `World` A1–A5; `Map001` water bay (A1) with a **single-tile island**, a **peninsula**, edge tiles; `Map002` A4 wall ring |
| Four DB "battler" record kinds | `Actors`, `Classes`, `Enemies`, `States` each carry traits/params (plus Weapons/Armors/Skills/Items) |
| Troop with page conditions | `Troops[1]` "Slimes": page 0 `turnValid` (turn 2), page 1 `enemyValid` (Slime HP ≤ 50%); spans turn/battle; a `hidden` member |
| Common event | `CommonEvents[1]` "Heal Flash" (called by Heal skill), `[2]` "Rain Ambience" (parallel, script write) |
| Damage formula | `Skills[2]` Firebolt `damage.formula = "a.mat * 2 - b.mdf + v[3]"`; also Attack `"a.atk*4-b.def*2"`, Heal `"(a.mat*2)+50"` |
| Show Picture | `Map001` event `Sign`: commands 231/230/235 → the encrypted `Sign` asset |
| Plugin entry | `js/plugins.js` (4 entries); `Banner` event runs **356** (MV) / **357** (MZ) plugin command |
| MV-format quirk | `Animations.json` **sheet-based** (MV `frames[][]`) vs **Effekseer** (MZ `effectName`); + the 356/357 and System deltas below |
| Encrypted-asset sample + key | `img/pictures/Sign.{rpgmvp,png_}` + `System.encryptionKey` |

## MV vs MZ deltas exercised (§0)

| Area | MV fixture | MZ fixture |
|---|---|---|
| Marker | `Game.rpgproject` | `Game.rmmzproject` |
| Animations | sheet (`animation1Name`, `frames`, `timings`) | Effekseer (`effectName`, `flashTimings`, `soundTimings`) |
| Plugin command | code **356** (single string) | code **357** (structured `{pluginName,func,args}`) |
| Encryption ext | `.rpgmvp` / `.rpgmvo` | `.png_` / `.ogg_` |
| System-only fields | — | `locale`, `tileSize`, `advanced{}`, `optAutosave`, `optKeyItemsNumber`, `itemCategories`, `menuCommands` |
| Show Text params | 4 params | 5 params (trailing speaker name) |

## Deliberate "hard" cases seeded for later phases

- **`luk` param** present in class curves, equip params, enemy stats, and a param
  trait (Class 1 code 21 dataId 7) → locked-skip + aggregated report (§5).
- **Multi-slot equips** (`Actors[1].equips` = 5 slots) → 1 weapon + 1 armor kept,
  rest reported.
- **Actor-level trait** (`Actors[1]` Element Rate) → merge-onto-battler decision.
- **Tileset flag bits** on sample tiles: terrain-tag (A2), ladder (A4), bush/
  counter/star (B), damage-floor (A5), full-block + partial-passage (A1). Bit
  values are the **real** RPG Maker ones (see the generator + decision log note).
- **Region 64** on one `Map001` tile → exceeds Atlas 1–63 → clamp + report.
- **MapInfos nesting**: Cave `parentId = 1` → folder synthesis.
- **Move route** (`Mover` event): jump, diagonal, change-speed, inline SE, script
  step → the ugly §9 conversions.
- **Battle branches** (`Ambush` event): 301 + win/escape/lose (601–604) → M3·C.
- **Script** commands (355/655, move-route 45, common event 2) → M5·B adapter.
- **Notetags** (`Enemies[1]` `<Boss>`, `Skills[2]` `<Cooldown:3>`, map notes) → §14.
- **Key item + non-consumable** (`Items[3]` Rusty Key) → report lines.
