/* RPGAtlas — scripts/build-icon-set.mjs
   Extends img/system/icon_set.png from 64 to 128 icons (256x256 -> 256x512).
   Rows 0-7 are the original hand-tuned sheet and are copied through untouched;
   rows 8-15 are derived from them procedurally (recolors, flips, and
   element-glyph composites) inside headless Chromium via the repo's Playwright
   dependency — the same license-clean, project-generated approach as
   scripts/build-starter-pack.mjs. Idempotent: reruns read only the top 8 rows
   as the base, so the derived rows are always regenerated from the originals.

   Run: node scripts/build-icon-set.mjs
   GPL-3.0-or-later (see LICENSE). */

import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sheetPath = join(root, "img", "system", "icon_set.png");

// One entry per new icon, indices 64-127 in reading order. Ops:
//   re(src, filter)          — redraw icon `src` through a CSS canvas filter
//   ov(base, mini, corner)   — icon `base` with icon `mini` at half size in a
//                              corner ("br" default, "bl" for right-leaning art)
//   fv(src, filter)          — vertical flip, then optional filter
const GOLD = "sepia(1) saturate(2.3) brightness(1.1)";
const MYTHRIL = "sepia(0.7) hue-rotate(140deg) saturate(1.55) brightness(1.15)";
const PLAN = [
  // row 8 — class emblems & elemental sigils
  { name: "Paladin Helm", op: ["re", 0, "sepia(0.85) saturate(1.8) brightness(1.12)"] },
  { name: "Ranger Hood", op: ["re", 3, "hue-rotate(-65deg) saturate(1.05) brightness(1.02)"] },
  { name: "Dark Knight Helm", op: ["re", 0, "hue-rotate(265deg) saturate(1.1) brightness(0.78)"] },
  { name: "Sage Hat", op: ["re", 1, "hue-rotate(160deg) saturate(1.15) brightness(1.08)"] },
  { name: "Moon Sigil", op: ["re", 2, "hue-rotate(200deg) saturate(0.95)"] },
  { name: "Nature Sigil", op: ["re", 2, "hue-rotate(75deg)"] },
  { name: "Frost Sigil", op: ["re", 2, "hue-rotate(160deg) saturate(0.75) brightness(1.3)"] },
  { name: "Shadow Sigil", op: ["re", 2, "hue-rotate(235deg) saturate(0.95) brightness(0.82)"] },
  // row 9 — enchanted weapons (element-glyph composites)
  { name: "Flame Sword", op: ["ov", 49, 8] },
  { name: "Frost Sword", op: ["ov", 49, 9] },
  { name: "Storm Spear", op: ["ov", 50, 10] },
  { name: "Venom Dagger", op: ["ov", 4, 12] },
  { name: "Holy Mace", op: ["ov", 7, 11] },
  { name: "Ember Staff", op: ["ov", 51, 8, "bl"] },
  { name: "Tide Rod", op: ["ov", 52, 13, "bl"] },
  { name: "Gale Bow", op: ["ov", 53, 15] },
  // row 10 — tiered weapons
  { name: "Golden Sword", op: ["re", 49, GOLD] },
  { name: "Obsidian Sword", op: ["re", 49, "hue-rotate(250deg) saturate(0.7) brightness(0.52)"] },
  { name: "Mythril Sword", op: ["re", 49, MYTHRIL] },
  { name: "Crimson Axe", op: ["re", 6, "sepia(0.8) hue-rotate(-25deg) saturate(2.4) brightness(0.95)"] },
  { name: "Silver Spear", op: ["re", 50, "saturate(0.45) brightness(1.28)"] },
  { name: "Runic Staff", op: ["re", 51, "hue-rotate(115deg) saturate(1.2)"] },
  { name: "Golden Bow", op: ["re", 53, "sepia(0.9) saturate(2.2) brightness(1.1)"] },
  { name: "Steel Mace", op: ["re", 7, "saturate(0.75) brightness(1.55)"] },
  // row 11 — armor & accessories
  { name: "Golden Mail", op: ["re", 57, "sepia(1) saturate(2.2) brightness(1.02)"] },
  { name: "Mythril Mail", op: ["re", 57, "sepia(0.65) hue-rotate(140deg) saturate(1.5) brightness(1.12)"] },
  { name: "Shadow Cloak", op: ["re", 61, "hue-rotate(65deg) brightness(0.85)"] },
  { name: "Forest Garb", op: ["re", 58, "sepia(0.6) hue-rotate(55deg) saturate(1.5) brightness(0.95)"] },
  { name: "Golden Helm", op: ["re", 59, "sepia(1) saturate(2) brightness(1.1)"] },
  { name: "Silver Ring", op: ["re", 60, "saturate(0.3) brightness(1.18)"] },
  { name: "Ruby Amulet", op: ["re", 63, "hue-rotate(140deg) saturate(1.25)"] },
  { name: "Swift Boots", op: ["ov", 62, 15] },
  // row 12 — elemental scrolls & tomes
  { name: "Fire Scroll", op: ["ov", 44, 8] },
  { name: "Ice Scroll", op: ["ov", 44, 9] },
  { name: "Storm Scroll", op: ["ov", 44, 10] },
  { name: "Holy Scroll", op: ["ov", 44, 11] },
  { name: "Crimson Tome", op: ["re", 45, "sepia(0.9) hue-rotate(-30deg) saturate(2.2) brightness(0.9)"] },
  { name: "Emerald Tome", op: ["re", 45, "sepia(0.9) hue-rotate(60deg) saturate(1.8) brightness(0.95)"] },
  { name: "Violet Tome", op: ["re", 45, "hue-rotate(60deg)"] },
  { name: "Golden Tome", op: ["re", 45, "sepia(1) saturate(2) brightness(1.05)"] },
  // row 13 — consumables
  { name: "Golden Apple", op: ["re", 35, "sepia(1) saturate(2.4) brightness(1.15)"] },
  { name: "Frost Berries", op: ["re", 36, "hue-rotate(-45deg)"] },
  { name: "Nightshade", op: ["re", 37, "hue-rotate(150deg)"] },
  { name: "Frost Bomb", op: ["re", 38, "hue-rotate(165deg) saturate(1.3)"] },
  { name: "Mega Potion", op: ["ov", 24, 21] },
  { name: "Mega Ether", op: ["ov", 25, 11] },
  { name: "Herbal Tonic", op: ["ov", 26, 37] },
  { name: "Life Elixir", op: ["ov", 31, 18] },
  // row 14 — status & battle
  { name: "Weaken", op: ["fv", 21, "hue-rotate(240deg)"] },
  { name: "Fire Ward", op: ["re", 17, "hue-rotate(140deg) saturate(1.2)"] },
  { name: "Nature Ward", op: ["re", 17, "hue-rotate(-95deg)"] },
  { name: "Holy Ward", op: ["re", 17, "sepia(0.9) saturate(2.2) brightness(1.1)"] },
  { name: "Mana Heart", op: ["re", 18, "hue-rotate(-120deg)"] },
  { name: "Verdant Heart", op: ["re", 18, "hue-rotate(160deg)"] },
  { name: "Bone Skull", op: ["re", 22, "saturate(0.25) brightness(1.35)"] },
  { name: "Meteor", op: ["ov", 14, 8] },
  // row 15 — treasure
  { name: "Ruby Gem", op: ["re", 47, "hue-rotate(140deg) saturate(1.2)"] },
  { name: "Emerald Gem", op: ["re", 47, "hue-rotate(-95deg)"] },
  { name: "Amethyst Gem", op: ["re", 47, "hue-rotate(60deg)"] },
  { name: "Topaz Gem", op: ["re", 47, "sepia(1) saturate(2.6) brightness(1.15)"] },
  { name: "Silver Chest", op: ["re", 43, "saturate(0.2) brightness(1.35)"] },
  { name: "Shadow Chest", op: ["re", 43, "hue-rotate(250deg) saturate(0.7) brightness(0.6)"] },
  { name: "Silver Coins", op: ["re", 46, "saturate(0.3) brightness(1.25)"] },
  { name: "Crystal Key", op: ["re", 40, "sepia(0.75) hue-rotate(135deg) saturate(1.6) brightness(1.15)"] },
];

async function main() {
  if (PLAN.length !== 64) throw new Error("PLAN must hold exactly 64 icons, got " + PLAN.length);
  const baseDataUrl = "data:image/png;base64," + readFileSync(sheetPath).toString("base64");

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<!DOCTYPE html><html><body></body></html>");

  const outDataUrl = await page.evaluate(async ({ baseDataUrl, plan }) => {
    const SIZE = 32, COLS = 8, BASE_ROWS = 8;
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("could not decode icon_set.png"));
      img.src = baseDataUrl;
    });

    const sheet = document.createElement("canvas");
    sheet.width = COLS * SIZE;
    sheet.height = (BASE_ROWS + plan.length / COLS) * SIZE;
    const g = sheet.getContext("2d");
    g.imageSmoothingEnabled = false;
    // base rows only, so a rerun never re-derives from derived icons
    g.drawImage(img, 0, 0, COLS * SIZE, BASE_ROWS * SIZE, 0, 0, COLS * SIZE, BASE_ROWS * SIZE);

    const src = (i) => [(i % COLS) * SIZE, Math.floor(i / COLS) * SIZE];
    function cell(i, filter, flipV) {
      const c = document.createElement("canvas");
      c.width = c.height = SIZE;
      const cg = c.getContext("2d");
      cg.imageSmoothingEnabled = false;
      if (filter) cg.filter = filter;
      const [sx, sy] = src(i);
      if (flipV) {
        cg.translate(0, SIZE);
        cg.scale(1, -1);
      }
      cg.drawImage(img, sx, sy, SIZE, SIZE, 0, 0, SIZE, SIZE);
      return c;
    }

    plan.forEach((spec, n) => {
      const [kind, a, b, corner] = spec.op;
      const dx = ((BASE_ROWS * COLS + n) % COLS) * SIZE;
      const dy = Math.floor((BASE_ROWS * COLS + n) / COLS) * SIZE;
      if (kind === "re") {
        g.drawImage(cell(a, b), dx, dy);
      } else if (kind === "fv") {
        g.drawImage(cell(a, b, true), dx, dy);
      } else if (kind === "ov") {
        g.drawImage(cell(a), dx, dy);
        const mini = cell(b);
        const mx = corner === "bl" ? 0 : SIZE / 2;
        g.drawImage(mini, 0, 0, SIZE, SIZE, dx + mx, dy + SIZE / 2, SIZE / 2, SIZE / 2);
      } else {
        throw new Error("unknown op " + kind);
      }
    });
    return sheet.toDataURL("image/png");
  }, { baseDataUrl, plan: PLAN });

  await browser.close();
  writeFileSync(sheetPath, Buffer.from(outDataUrl.split(",")[1], "base64"));
  console.log("wrote " + sheetPath + " (" + (64 + PLAN.length) + " icons)");
  PLAN.forEach((spec, n) => console.log("  " + (64 + n) + "  " + spec.name));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
