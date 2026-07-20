/* RPGAtlas — scripts/build-coop-demo.mjs
   Project Beacon MP9·C: generate the Driftwood Shore co-op demo project by
   deriving it from the bundled Atlas Quest showcase (Atlas_Quest.json) via the
   shared applyCoopDemo transform (scripts/coop-demo-config.mjs). Writes
   Atlas_Quest_Coop.json — a ready-to-host demo world for the "hosted demo room"
   flow (see wiki/Making-Your-Game-Multiplayer.md "Try the co-op demo").

   Rerun after editing Atlas_Quest.json (the two stay in lock-step because the
   only difference is the shared system-level transform):
     node scripts/build-coop-demo.mjs
   GPL-3.0-or-later (see LICENSE). */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyCoopDemo } from "./coop-demo-config.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "Atlas_Quest.json");
const out = join(root, "Atlas_Quest_Coop.json");

const project = JSON.parse(readFileSync(src, "utf8"));
applyCoopDemo(project);
writeFileSync(out, JSON.stringify(project, null, 2) + "\n");

const mp = project.system.multiplayer;
process.stdout.write(
  `[coop-demo] wrote Atlas_Quest_Coop.json — "${project.system.title}"\n` +
  `[coop-demo] multiplayer: on · ${mp.maxPlayers} players · chat "${mp.chatMode}" · ` +
  `${mp.presets.length} presets · start on map ${project.system.startMapId} (Driftwood Shore)\n` +
  `[coop-demo] host it:  node server/dist/beacon.mjs --project Atlas_Quest_Coop.json\n`,
);
