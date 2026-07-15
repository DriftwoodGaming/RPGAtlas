/* RPGAtlas — Character Generator style-picker browser smoke test. */
import { test, expect } from "@playwright/test";

test("builds visibly distinct characters with intact eyes and saves every generator choice", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto("/index.html");
  await expect(page.locator("#save-ind")).toBeVisible();

  await page.locator("#menus .menu-label", { hasText: "Tools" }).dispatchEvent("mousedown");
  await page.locator(".menu-drop .menu-item", { hasText: "Character Generator" }).click();

  const modal = page.locator(".modal", { hasText: "Character Generator" });
  await expect(modal).toBeVisible();
  await expect(modal.locator(".cg-style-card")).toHaveCount(4);
  await expect(modal.locator(".cg-style-thumb")).toHaveCount(4);
  await expect(modal.locator(".cg-direction-cell canvas")).toHaveCount(8);
  await expect(modal.locator(".cg-preview-stage canvas")).toHaveCount(1);
  await expect(modal.getByRole("button", { name: "8 directions", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(modal.getByRole("button", { name: "Export 4-dir PNG" })).toBeVisible();
  await expect(modal.getByRole("button", { name: "Export 8-dir PNG" })).toBeVisible();
  await expect(modal.getByLabel("Body")).toBeVisible();
  await expect(modal.getByLabel("Outfit")).toBeVisible();
  await expect(modal.getByLabel("Accessory")).toBeVisible();

  const styleImages = await modal.locator(".cg-style-thumb").evaluateAll((canvases) =>
    canvases.map((canvas) => canvas.toDataURL()));
  expect(new Set(styleImages).size).toBe(4);

  const eyePixelCounts = await page.evaluate(() => {
    const params = {
      bodyType: "balanced", outfit: "tunic", accessory: "none",
      skin: "#f0c8a0", hair: "#75442b", eyes: "#00ff00", style: "short",
      shirt: "#3567a5", pants: "#273b5c", hat: "#d1a84b", accent: "#e2b84e",
    };
    return window.Assets.CHARACTER_ART_STYLES.map((style) => {
      const canvas = window.Assets.humanPreviewCanvas({ ...params, artStyle: style.id }, 0, 1);
      const pixels = canvas.getContext("2d").getImageData(0, 0, 48, 48).data;
      let eyes = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] === 0 && pixels[i + 1] === 255 && pixels[i + 2] === 0 && pixels[i + 3] === 255) eyes++;
      }
      return { style: style.id, eyes };
    });
  });
  expect(eyePixelCounts.every(({ eyes }) => eyes > 0)).toBe(true);

  const firstPreview = modal.locator(".cg-preview-stage canvas");
  await modal.locator(".cg-style-card", { hasText: "Classic Pixel" }).click();
  const classicPixels = await firstPreview.evaluate((canvas) => canvas.toDataURL());
  const heroic = modal.locator(".cg-style-card", { hasText: "Heroic" });
  await heroic.click();
  await expect(heroic).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => firstPreview.evaluate((canvas) => canvas.toDataURL()))
    .not.toBe(classicPixels);

  await modal.getByLabel("Body").selectOption("broad");
  await modal.getByLabel("Outfit").selectOption("armor");
  await modal.getByLabel("Accessory").selectOption("cape");
  await modal.getByRole("button", { name: "Randomize look" }).click();
  await expect(modal.locator(".cg-style-card", { hasText: "Heroic" }))
    .toHaveAttribute("aria-pressed", "true");

  await modal.getByLabel("Body").selectOption("broad");
  await modal.getByLabel("Outfit").selectOption("armor");
  await modal.getByLabel("Accessory").selectOption("cape");
  await modal.locator('input[type="text"]').fill("Heroic Test Hero");
  await modal.getByRole("button", { name: "Save as new character" }).click();
  await expect(modal.getByRole("button", { name: /Update/ })).toBeVisible();

  await expect.poll(() => page.evaluate(() => {
    const project = JSON.parse(localStorage.getItem("rpgatlas_project"));
    return project.customChars.find((entry) => entry.name === "Heroic Test Hero")?.params;
  })).toMatchObject({ artStyle: "heroic", bodyType: "broad", outfit: "armor", accessory: "cape", directions: 8 });

  const savedSheetHeight = await page.evaluate(() => {
    const entry = window.Assets.charsets.find((character) => character.name === "Heroic Test Hero");
    return window.Assets.charSheetCanvas(window.Assets.charsets.indexOf(entry)).height;
  });
  expect(savedSheetHeight).toBe(384);

  expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
});
