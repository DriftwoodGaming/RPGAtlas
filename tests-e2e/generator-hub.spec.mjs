/* RPGAtlas - Generator Hub browser smoke test. */
import { test, expect } from "@playwright/test";

test("opens from the Generators menu and drives filters, batches, and saved names", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto("/index.html");
  await expect(page.locator("#save-ind")).toBeVisible();

  await page.locator("#menus .menu-label", { hasText: "Generators" }).dispatchEvent("mousedown");
  await expect(page.locator(".menu-drop .menu-item")).toHaveCount(13);
  await page.locator(".menu-drop .menu-item", { hasText: "Weapon Name Generator" }).click();

  const modal = page.locator(".modal.generator-hub-modal");
  await expect(modal).toBeVisible();
  await expect(modal.locator(".gen-choice")).toHaveCount(20);
  await expect(modal.locator(".gen-hero h2")).toHaveText("Weapon Name Generator");
  await expect(modal.locator(".gen-result")).toHaveCount(10);
  await expect(modal.getByLabel("Weapon family")).toBeVisible();
  await expect(modal.getByRole("button", { name: "Evocative" })).toHaveAttribute("aria-pressed", "true");

  await modal.getByLabel("Batch size").selectOption("20");
  await expect(modal.locator(".gen-result")).toHaveCount(20);

  await modal.getByLabel("World keyword").fill("Everbloom");
  await modal.getByLabel("World keyword").press("Enter");
  await expect(modal.locator(".gen-result-copy strong").first()).toContainText("Everbloom");
  expect(await modal.locator(".gen-result-copy strong").allTextContents())
    .toEqual(expect.arrayContaining([expect.stringContaining("Everbloom")]));

  await modal.locator(".gen-star").first().click();
  await expect(modal.getByRole("button", { name: "★ Saved (1)" })).toBeVisible();
  await modal.getByRole("button", { name: "★ Saved (1)" }).click();
  await expect(modal.locator(".gen-result")).toHaveCount(1);

  await modal.getByRole("button", { name: /^Spell\b/ }).click();
  await expect(modal.locator(".gen-hero h2")).toHaveText("Spell Name Generator");
  await expect(modal.getByLabel("Spell school")).toBeVisible();
  await expect(modal.locator(".gen-result")).toHaveCount(10);

  expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
});
