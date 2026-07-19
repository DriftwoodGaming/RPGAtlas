/* RPGAtlas — tests-e2e/currency-wallet.spec.mjs
   Multi-currency wallet, end to end in the live player: a gated parallel
   common event grants 7 + 3 Gems (Change Gold with currencyId 2), an If
   condition on the Gems balance proves testCond reads the wallet, and an
   Open Shop priced in Gems shows "Gems" amounts, gates buying on the Gems
   balance, and deducts from it. The pause menu then lists the remaining
   Gems beside classic gold. Map 1 (Driftwood Shore goldens) is untouched —
   the project is transformed in memory. GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { gotoWithAtlasQuest } from "./fixtures/atlas-quest.mjs";

const DONE = 952; // free switch id, gates the one-shot common event

function addWalletCommonEvent(project) {
  const ware = project.items[0];
  ware.price = 4; // predictable price for the Gems math below
  const nextId = (project.commonEvents || []).reduce((m, ce) => Math.max(m, ce.id), 0) + 1;
  const body = [
    { t: "gold", op: "add", val: 7, currencyId: 2 },
    { t: "gold", op: "add", val: 3, currencyId: 2 },
    { t: "if", cond: { kind: "gold", currencyId: 2, cmp: ">=", val: 10 },
      then: [{ t: "text", text: "Gems check passed" }],
      else: [{ t: "text", text: "Gems check FAILED" }] },
    { t: "shop", goods: [{ kind: "item", id: ware.id }], currencyId: 2 },
    { t: "switch", id: DONE, val: true },
  ];
  project.commonEvents = project.commonEvents || [];
  project.commonEvents.push({
    id: nextId,
    name: "Wallet Probe",
    trigger: "parallel",
    switchId: 0,
    commands: [{ t: "if", cond: { kind: "switch", id: DONE, val: false }, then: body, else: [] }],
  });
  return project;
}

test.describe("multi-currency wallet", () => {
  test("Gems are granted, gate an If, price a shop, and show in the menu", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      if (/Failed to load resource.*404/.test(msg.text())) return; // benign asset-discovery 404s
      errors.push(msg.text());
    });

    await gotoWithAtlasQuest(page, "/play.html", { transformProject: addWalletCommonEvent });
    await expect(page.getByText("New Game", { exact: true })).toBeVisible();
    await page.getByText("New Game", { exact: true }).click();
    await expect(page.locator("#gamecanvas")).toBeVisible();

    // The If on the Gems balance (7 + 3 ≥ 10) took the then-branch.
    const msg = page.locator(".msgwin").first();
    await expect(msg).toBeVisible();
    await expect(msg).toHaveClass(/msg-done/, { timeout: 6000 });
    await expect(msg.locator(".msg-text")).toContainText("Gems check passed");
    await msg.click();

    // The shop trades in Gems: its running balance line uses the currency name.
    const shop = page.locator(".shopwin");
    await expect(shop.first()).toBeVisible();
    await expect(shop.first().locator(".win-title")).toContainText("Gems: 10");

    // Buy once: the 4-Gem price shows per entry and the balance drops to 6.
    await shop.first().locator("li", { hasText: "Buy" }).first().click();
    const buyWin = page.locator(".shopwin", { hasText: "Buy —" });
    await expect(buyWin.locator(".win-title")).toContainText("Gems: 10");
    await expect(buyWin.locator("li .cnt").first()).toContainText("4 Gems");
    await buyWin.locator("li").first().click();
    const buyAfter = page.locator(".shopwin", { hasText: "Buy —" });
    await expect(buyAfter.locator(".win-title")).toContainText("Gems: 6");
    await expect(buyAfter.locator("li .cnt").first()).toContainText("own ×1");

    // Leave the buy list and the shop, then open the pause menu: the Gems
    // balance joins the classic gold line.
    await page.keyboard.press("Escape");
    await page.locator(".shopwin li", { hasText: "Leave" }).first().click();
    await expect(page.locator(".shopwin")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator(".menu-gold")).toContainText("6 Gems");

    expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("defeated enemies pay their per-enemy currency rewards", async ({ page }) => {
    test.setTimeout(90_000); // a real battle at player pacing + boot
    let troopSize = 0;
    function addCurrencyRewards(project) {
      // Every enemy def used by troop 1 pays 2 Gems + 1 Token per defeat and
      // dies to one hit so the battle stays short. Totals scale with the
      // troop size, whatever the fixture ships.
      const troop = project.troops.find((t) => t.id === 1);
      troopSize = troop.enemies.length;
      for (const id of new Set(troop.enemies.map(Number))) {
        const def = project.enemies.find((en) => en.id === id);
        def.stats.mhp = 1;
        def.currencyRewards = [
          { currencyId: 2, amount: 2 },
          { currencyId: 3, amount: 1 },
        ];
      }
      return project;
    }

    await gotoWithAtlasQuest(page, "/play.html", { transformProject: addCurrencyRewards });
    await page.getByText("New Game", { exact: true }).click();
    await expect(page.locator(".titlewin")).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.Atlas && window.Atlas.atlas.scene), { timeout: 10_000 })
      .toBe("map");

    // Start troop 1 through the plugin API (the player.spec.mjs battle
    // harness) and Enter-spam Attack/first-target until it resolves.
    await page.evaluate(() => {
      window.__battleResult = null;
      window.Atlas.atlas.startBattle(1, true).then((r) => { window.__battleResult = r; });
    });
    await expect(page.locator(".battlewin")).toBeVisible();
    await expect
      .poll(
        async () => {
          const done = await page.evaluate(() => window.__battleResult);
          if (done) return done;
          if (await page.locator(".cmdwin, .targetwin").count()) {
            await page.keyboard.press("Enter");
          }
          return null;
        },
        { timeout: 60_000, intervals: [250] },
      )
      .toBe("win");
    await expect(page.locator(".battlewin")).toHaveCount(0);

    // Every defeated troop member paid its rows: the pause menu wallet line
    // shows the summed Gems and Tokens.
    await page.keyboard.press("Escape");
    await expect(page.locator(".menu-gold")).toContainText(2 * troopSize + " Gems");
    await expect(page.locator(".menu-gold")).toContainText(troopSize + " Tokens");
  });
});
