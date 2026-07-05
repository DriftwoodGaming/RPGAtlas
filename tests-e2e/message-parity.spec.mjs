/* RPGAtlas — tests-e2e/message-parity.spec.mjs
   Project Compass M2·B: end-to-end proof of the message system in the live
   player — escape-code rendering in a real Show Text window and the Input Number
   scene storing a value the game reads back. A gated parallel common event runs:
   set var 1, show a message using \v \$ \{ \}  and a \. pause, then Input Number
   into var 2, then show "Got \v[2]". We drive the number scene from the keyboard
   and confirm the follow-up message reflects the entered value. Map 1 (Driftwood
   Shore goldens) is untouched — the project is transformed in memory to add the
   common event. GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { gotoWithAtlasQuest } from "./fixtures/atlas-quest.mjs";

const DONE = 951; // free switch id, gates the one-shot common event

function addMessageCommonEvent(project) {
  const nextId = (project.commonEvents || []).reduce((m, ce) => Math.max(m, ce.id), 0) + 1;
  const body = [
    { t: "var", id: 1, op: "set", val: 42 },
    { t: "text", text: "Score \\v[1] gold \\$ \\{big\\} wait\\.end", background: 0, position: 2 },
    { t: "inputNumber", varId: 2, digits: 3 },
    { t: "text", text: "Got \\v[2]" },
    { t: "switch", id: DONE, val: true },
  ];
  project.commonEvents = project.commonEvents || [];
  project.commonEvents.push({
    id: nextId,
    name: "M2B Message Probe",
    trigger: "parallel",
    switchId: 0,
    commands: [{ t: "if", cond: { kind: "switch", id: DONE, val: false }, then: body, else: [] }],
  });
  return project;
}

async function startGame(page, transform) {
  await gotoWithAtlasQuest(page, "/play.html", { transformProject: transform });
  await expect(page.getByText("New Game", { exact: true })).toBeVisible();
  await page.getByText("New Game", { exact: true }).click();
  await expect(page.locator(".titlewin")).toHaveCount(0);
  await expect(page.locator("#gamecanvas")).toBeVisible();
}

test.describe("M2·B message parity — escape codes + Input Number", () => {
  test("a message renders escape codes and Input Number feeds a variable", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      if (/Failed to load resource.*404/.test(msg.text())) return; // benign asset-discovery 404s
      errors.push(msg.text());
    });

    await startGame(page, addMessageCommonEvent);

    // The first message window opens; its structure exists immediately (before
    // the typewriter finishes) — an inline gold badge, a bigger-size span, and a
    // zero-width pacing marker for the \. pause.
    const msg = page.locator(".msgwin").first();
    await expect(msg).toBeVisible();
    await expect(msg.locator(".msg-gold")).toHaveCount(1);
    await expect(msg.locator('.msg-ctl[data-wait="15"]')).toHaveCount(1);
    await expect(msg.locator('.msg-text span[style*="font-size"]')).toHaveCount(1);

    // Wait for the full reveal (msg-done), then the substituted variable shows.
    await expect(msg).toHaveClass(/msg-done/, { timeout: 6000 });
    await expect(msg.locator(".msg-text")).toContainText("Score 42");
    await expect(msg.locator(".msg-text")).toContainText("big");

    // Dismiss the message → the Input Number scene opens.
    await msg.click();
    await expect(page.locator(".msgwin")).toHaveCount(0);
    const num = page.locator(".numinputwin");
    await expect(num).toBeVisible();
    await expect(num.locator(".numcell")).toHaveCount(3);

    // Dial the least-significant digit 0 → 1 and confirm; var 2 becomes 1.
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expect(num).toHaveCount(0);

    // The follow-up message reflects the entered value via \v[2].
    const got = page.locator(".msgwin").first();
    await expect(got).toBeVisible();
    await expect(got).toHaveClass(/msg-done/, { timeout: 6000 });
    await expect(got.locator(".msg-text")).toContainText("Got 1");

    expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});
