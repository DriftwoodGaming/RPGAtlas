import { test, expect } from "@playwright/test";

test("authors and previews a reusable dialogue tree", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource.*404/.test(message.text())) errors.push(message.text());
  });

  await page.goto("/index.html");
  await expect(page.locator("#save-ind")).toBeVisible();
  await page.locator('#toolbar button[title*="Dialogue workspace"]').click();

  const workspace = page.locator(".modal.dialogue-modal");
  await expect(workspace).toBeVisible();
  await workspace.getByRole("button", { name: "+ New Dialogue" }).click();
  await expect(workspace.locator(".dialogue-node-card.line")).toContainText("New dialogue line.");

  await workspace.getByRole("button", { name: "Speakers…" }).click();
  const speakers = page.locator(".modal").last();
  await speakers.getByRole("button", { name: "+ Add Speaker" }).click();
  await speakers.locator(".dialogue-speaker-row input").fill("Captain Mira");
  await speakers.getByRole("button", { name: "Close" }).click();

  await workspace.getByRole("button", { name: "+ Choice" }).click();
  await expect(workspace.locator(".dialogue-node-card.choice")).toContainText("What will you say?");
  await workspace.getByRole("button", { name: "Generate keys" }).click();
  await expect(workspace.locator(".dialogue-node-card.choice code")).toContainText("dialogue.dialogue.1.2");

  await workspace.getByRole("button", { name: "Preview" }).click();
  const preview = page.locator(".modal").last();
  await expect(preview.locator(".dialogue-preview-text")).toContainText("New dialogue line.");
  await preview.getByRole("button", { name: "Continue" }).click();
  await expect(preview.locator(".dialogue-preview-text")).toContainText("What will you say?");
  await expect(preview.locator(".dialogue-preview-choice")).toHaveCount(1);

  expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
});
