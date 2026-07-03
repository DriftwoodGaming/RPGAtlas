/* RPGAtlas — tests-e2e/export-web.spec.mjs
   Phase 7 Stage E acceptance: the Web / itch.io zip export, end to end —
   the REAL modal button produces a download; the zip has the itch.io layout
   (index.html at the root); and the extracted site installs its service
   worker and REPLAYS FULLY OFFLINE (the PWA promise, machine-checked).
   GPL-3.0-or-later. */

import { createServer } from "node:http";
import { test, expect } from "@playwright/test";
import { atlasQuestJson } from "./fixtures/atlas-quest.mjs";

/** Minimal STORE-zip reader (mirrors the writer in src/editor/export-web.ts). */
function unzipStore(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdAt = bytes.length - 22;
  if (view.getUint32(eocdAt, true) !== 0x06054b50) throw new Error("no EOCD");
  const count = view.getUint16(eocdAt + 8, true);
  let p = view.getUint32(eocdAt + 16, true);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("bad central header");
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const offset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const localNameLen = view.getUint16(offset + 26, true);
    const start = offset + 30 + localNameLen;
    files.set(name, bytes.subarray(start, start + size));
    p += 46 + nameLen;
  }
  return files;
}

const MIME = {
  html: "text/html", webmanifest: "application/manifest+json",
  js: "text/javascript", png: "image/png",
};

test("Web zip export: itch.io layout, PWA install, full offline replay", async ({ page, context }) => {
  test.setTimeout(180_000);
  // 1. Export through the real UI: File ▸ Export Standalone Game… ▸ Web zip.
  await page.goto("/index.html");
  await page.evaluate((json) => localStorage.setItem("rpgatlas_project", json), atlasQuestJson());
  await page.goto("/index.html");
  await page.getByText("File", { exact: true }).click();
  await page.getByText("Export Standalone Game…").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Web / itch.io (.zip)" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Atlas_Quest-web.zip");
  const zipPath = await download.path();
  const { readFileSync } = await import("node:fs");
  const files = unzipStore(new Uint8Array(readFileSync(zipPath)));

  // 2. itch.io shape: index.html at the zip root plus the PWA pieces.
  expect([...files.keys()].sort()).toEqual(
    ["icon-192.png", "icon-512.png", "index.html", "manifest.webmanifest", "sw.js"].sort(),
  );
  const html = new TextDecoder().decode(files.get("index.html"));
  expect(html).toContain('<link rel="manifest" href="manifest.webmanifest">');
  expect(html).toContain("navigator.serviceWorker.register");
  expect(files.get("icon-192.png").slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47])); // PNG magic

  // 3. Serve the extracted zip and load it like a player would.
  const server = createServer((req, res) => {
    const name = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
    const body = files.get(name === "" ? "index.html" : name);
    if (!body) { res.writeHead(404); res.end(); return; }
    const ext = name.slice(name.lastIndexOf(".") + 1);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(Buffer.from(body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + server.address().port;

  try {
    const game = await context.newPage();
    await game.goto(origin + "/index.html");
    await expect(game.getByText("New Game", { exact: true })).toBeVisible({ timeout: 20_000 });
    // Wait for the service worker to install, activate, and claim the page.
    await expect
      .poll(() => game.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 })
      .toBe(true);

    // 4. The offline replay: no network, straight reload, game still boots.
    await context.setOffline(true);
    await game.reload();
    await expect(game.getByText("New Game", { exact: true })).toBeVisible({ timeout: 20_000 });
    await game.getByText("New Game", { exact: true }).click();
    await expect(game.locator(".titlewin")).toHaveCount(0, { timeout: 20_000 });
    await context.setOffline(false);
    await game.close();
  } finally {
    server.close();
  }
});
