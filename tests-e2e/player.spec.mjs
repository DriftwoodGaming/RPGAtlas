/* RPGAtlas — tests-e2e/player.spec.mjs
   Player smoke tests: boots to the title screen, starts a new game, and
   round-trips a save through the engine's own save-slot UI.
   GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { gotoWithAtlasQuest, atlasQuestJson } from "./fixtures/atlas-quest.mjs";

// A screenshot of a genuinely blank/uniform region PNG-compresses to a very
// small buffer (long runs of identical pixels compress extremely well); a
// rendered map (tiles + player sprite, or the HD-2D WebGL scene) has enough
// visual variety that it does not. This avoids pulling in a PNG-decoding
// dependency just for a smoke check, and doesn't need pixel-level access
// (which for the HD-2D path is a separate WebGL "#glcanvas" and for classic
// play.html-2D is the "#gamecanvas" 2D context) — a screenshot of the whole
// #stage is composited by the browser regardless of which path is drawing.
const BLANK_SCREENSHOT_BYTES = 2048;
function isNonBlankPng(buffer) {
  return buffer.length > BLANK_SCREENSHOT_BYTES;
}

test.describe("player boot", () => {
  test("reaches the Atlas Quest title screen with no console errors", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      // Same benign asset-discovery 404 noise as the editor boot spec (see
      // js/assets.js discoverExternalAssets()) — expected, not a real error.
      if (/Failed to load resource.*404/.test(msg.text())) return;
      errors.push(msg.text());
    });

    await gotoWithAtlasQuest(page, "/play.html");

    // showTitle() renders a `.titlewin` with the project's system.title and a
    // `.titlemenu` list containing "New Game" — wait for both rather than a
    // fixed sleep (asset loads + Plugins.runAll() happen before this).
    await expect(page.locator(".titlewin .title-name")).toHaveText("Atlas Quest");
    await expect(page.locator(".titlemenu")).toBeVisible();
    await expect(page.getByText("New Game", { exact: true })).toBeVisible();

    expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});

test.describe("built-in plugins", () => {
  // Phase 1 exit criterion: the plugin API surface is frozen and all four
  // built-in plugins must load through the extracted plugin runtime
  // (src/engine/plugin-runtime.ts). Plugins.status is published to
  // window.AtlasPluginStatus after loadAll(); "loaded" means the plugin's
  // fn executed and its hooks registered without error.
  test("all four built-in plugins report loaded", async ({ page }) => {
    await gotoWithAtlasQuest(page, "/play.html");
    await expect(page.locator(".titlewin .title-name")).toHaveText("Atlas Quest");

    const status = await page.evaluate(() =>
      (window.AtlasPluginStatus || []).map((p) => ({ pluginId: p.pluginId, status: p.status })),
    );
    const byId = Object.fromEntries(status.map((p) => [p.pluginId, p.status]));
    for (const id of ["atlas.core", "atlas.text-codes", "atlas.transitions", "atlas.weather"]) {
      expect(byId[id], `plugin ${id} should load (got: ${JSON.stringify(status)})`).toBe("loaded");
    }
  });
});

test.describe("player start", () => {
  test("starting a new game places the player on a map", async ({ page }) => {
    await gotoWithAtlasQuest(page, "/play.html");

    await expect(page.getByText("New Game", { exact: true })).toBeVisible();
    await page.getByText("New Game", { exact: true }).click();

    // newGame() -> loadMap() -> scene = "map" transitions the title window
    // out and clears the UI stack; the titlewin unmounts once play begins.
    await expect(page.locator(".titlewin")).toHaveCount(0);

    // The engine has no exposed debug globals (js/engine.js is a closed
    // IIFE), so we assert the map actually loaded via the same signal the
    // player sees: the stage renders non-blank pixels (a map render, not a
    // blank boot screen). The sample project's start map (Meridian Village)
    // has HD-2D enabled, which draws through a separate WebGL2 "#glcanvas"
    // that the renderer inserts behind the engine's own #gamecanvas (see
    // js/renderer.js Renderer.available() — "#gamecanvas ... the engine
    // leaves transparent over the map" in HD-2D mode). Screenshotting the
    // whole #stage rather than reading one canvas's pixels covers both the
    // HD-2D and classic-2D render paths uniformly.
    const stage = page.locator("#stage");
    await expect(stage).toBeVisible();
    await expect(page.locator("#gamecanvas")).toBeVisible();

    const canvasSize = await page.locator("#gamecanvas").evaluate((el) => ({ w: el.width, h: el.height }));
    expect(canvasSize.w).toBeGreaterThan(0);
    expect(canvasSize.h).toBeGreaterThan(0);

    // Poll (no fixed sleep) until the renderer has actually painted a frame
    // after the map swap — real wall-clock rAF here (this spec doesn't
    // install a fake clock; see renderer-golden.spec.mjs for that), so the
    // exact number of frames needed isn't knowable up front.
    await expect
      .poll(async () => isNonBlankPng(await stage.screenshot()), { timeout: 5000 })
      .toBe(true);
  });
});

test.describe("battle v2 (phase 5)", () => {
  // Drive a real battle in each timed mode via the plugin API
  // (window.Atlas.atlas.startBattle) and the same keyboard the player uses.
  async function startGame(page, battleSystem) {
    await gotoWithAtlasQuest(page, "/play.html", {
      transformProject(project) {
        project.system.battleSystem = battleSystem;
        return project;
      },
    });
    await page.getByText("New Game", { exact: true }).click();
    await expect(page.locator(".titlewin")).toHaveCount(0);
    // wait until the map scene is live (fade-in finished)
    await expect
      .poll(() => page.evaluate(() => window.Atlas && window.Atlas.atlas.scene), { timeout: 10_000 })
      .toBe("map");
    await page.evaluate(() => {
      window.__battleResult = null;
      window.__battleError = null;
      window.Atlas.atlas
        .startBattle(1, true) // troop 1: Slime x2
        .then((r) => { window.__battleResult = r; })
        .catch((e) => { window.__battleError = String((e && e.stack) || e); });
    });
    await expect(page.locator(".battlewin")).toBeVisible();
  }

  async function attackUntilOver(page) {
    // Whenever a command or target window is up, press Enter (Attack → pick
    // first target — spamming is safe: showList ignores keys it doesn't
    // handle, and both windows accept Enter).
    await expect
      .poll(
        async () => {
          const done = await page.evaluate(
            () => window.__battleResult || window.__battleError,
          );
          if (done) return done;
          if (await page.locator(".cmdwin, .targetwin").count()) {
            await page.keyboard.press("Enter");
          }
          return null;
        },
        { timeout: 60_000, intervals: [250] },
      )
      .not.toBeNull();
    const outcome = await page.evaluate(() => ({
      result: window.__battleResult,
      error: window.__battleError,
    }));
    expect(outcome.error).toBeNull();
    expect(["win", "lose", "escape"]).toContain(outcome.result);
    return outcome;
  }

  test("ATB: gauges render and a battle resolves through the shared core", async ({ page }) => {
    test.setTimeout(90_000); // a real battle at player pacing (~25s) + boot
    await startGame(page, "atb");
    // gauges appear on party rows and enemy sprites once the scheduler runs
    await expect(page.locator(".battle-party .atbbar").first()).toBeVisible();
    await expect(page.locator(".enemy-spr .atbbar").first()).toBeVisible();
    const outcome = await attackUntilOver(page);
    expect(outcome.result).toBe("win"); // slimes can't out-damage the party
    await expect(page.locator(".battlewin")).toHaveCount(0);
  });

  test("CTB: the turn-order strip renders and a battle resolves", async ({ page }) => {
    test.setTimeout(90_000);
    await startGame(page, "ctb");
    await expect(page.locator(".ctb-order .ctb-chip").first()).toBeVisible();
    // the strip forecasts up to 8 upcoming acts, highlighted current first
    expect(await page.locator(".ctb-order .ctb-chip").count()).toBeGreaterThanOrEqual(4);
    await expect(page.locator(".ctb-order .ctb-chip.now")).toHaveCount(1);
    const outcome = await attackUntilOver(page);
    expect(outcome.result).toBe("win");
  });
});

test.describe("hud (phase 5)", () => {
  test("minimap + quest tracker render and the M key toggles them", async ({ page }) => {
    await gotoWithAtlasQuest(page, "/play.html", {
      transformProject(project) {
        project.system.minimap = true;
        return project;
      },
    });
    await page.getByText("New Game", { exact: true }).click();
    await expect(page.locator(".titlewin")).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.Atlas && window.Atlas.atlas.scene), { timeout: 10_000 })
      .toBe("map");

    // the minimap builds from the map prerender on the first rendered frame
    const hud = page.locator(".hud-root");
    await expect(hud).toBeVisible();
    const miniSize = await page.locator(".minimap canvas").first().evaluate((c) => c.width);
    expect(miniSize).toBeGreaterThan(20);

    // starting a quest populates the tracker
    await page.evaluate(() => window.Atlas.game.startQuest(1));
    await expect(page.locator(".quest-hud .qh-name")).toHaveText("Market Introduction");
    await expect(page.locator(".quest-hud .qh-obj")).toContainText("Report to the merchant");

    // M hides the whole HUD; M again restores it (persisted player option)
    await page.keyboard.press("KeyM");
    await expect(hud).toBeHidden();
    await page.keyboard.press("KeyM");
    await expect(hud).toBeVisible();
  });
});

test.describe("save/load round-trip", () => {
  test("saving in slot 1 and loading it back restores the game", async ({ page }) => {
    await gotoWithAtlasQuest(page, "/play.html");

    await page.getByText("New Game", { exact: true }).click();
    await expect(page.locator(".titlewin")).toHaveCount(0);

    // newGame() fades in, loads the map, then fades back out (js/engine.js
    // showTitle(): fadeTo(1,300) -> newGame() -> render() -> fadeTo(0,300))
    // before the map loop's input handling is actually reading "cancel"
    // presses. Rather than sleep for a guessed duration, retry Escape until
    // the pause menu opens — deterministic (bounded by expect's timeout)
    // and robust to boot being slower on a loaded CI runner.
    await expect(async () => {
      await page.keyboard.press("Escape");
      await expect(page.locator(".mainmenu")).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 10_000 });
    await page.getByText("Save", { exact: false }).click();
    await expect(page.locator(".savewin")).toBeVisible();
    await page.getByText("Slot 1", { exact: false }).click();

    // Saving writes rpgatlas_<gameId>_save_1 (or rpgatlas_save_1) synchronously.
    const slotSaved = await page.evaluate(() => {
      return Object.keys(localStorage).some(
        (k) => /^rpgatlas(_.+)?_save_1$/.test(k) || /^driftwood_save_1$/.test(k),
      );
    });
    expect(slotSaved).toBe(true);

    // A successful save shows a ".msgwin" confirmation ("Game saved to slot
    // 1.") on top of the menu (see js/engine.js saveLoadMenu()); dismiss it
    // (click advances the typewriter, a second click/press closes it) before
    // interacting with the menu underneath.
    const confirmMsg = page.locator(".msgwin");
    await expect(confirmMsg).toBeVisible();
    // First click finishes the typewriter reveal if still typing, second
    // click dismisses; retry-click until it's actually gone rather than
    // assuming which case applies.
    await expect(async () => {
      await confirmMsg.click();
      await expect(confirmMsg).toHaveCount(0, { timeout: 300 });
    }).toPass({ timeout: 5_000 });

    // Back to the title screen, then load slot 1 back. "To Title" opens a
    // "Return to title" / "Cancel" confirmation sub-list before it actually
    // navigates (see js/engine.js openMenu(), the i === 8 branch).
    await expect(page.locator(".mainmenu")).toBeVisible();
    await page.getByText("To Title", { exact: false }).click();
    await expect(page.getByText("Return to title", { exact: true })).toBeVisible();
    await page.getByText("Return to title", { exact: true }).click();
    await expect(page.locator(".titlewin")).toBeVisible();

    await page.getByText("Continue", { exact: true }).click();
    await expect(page.locator(".savewin")).toBeVisible();
    await page.getByText("Slot 1", { exact: false }).click();

    // Loading a slot dismisses both the save list and the title window,
    // dropping the player back onto the map.
    await expect(page.locator(".titlewin")).toHaveCount(0);
    await expect(page.locator("#gamecanvas")).toBeVisible();
  });
});

test.describe("audio v2 (phase 6)", () => {
  test("an imported BGM + ambience layer stream through the deck on map entry", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      if (/Failed to load resource.*404/.test(msg.text())) return;
      errors.push(msg.text());
    });

    // Prime the origin, seed the project (start map wired to imported audio)
    // and write two tiny WAV assets into the IndexedDB library the engine
    // shares with the editor.
    await page.goto("/play.html");
    const json = atlasQuestJson();
    await page.evaluate(async (seeded) => {
      const project = JSON.parse(seeded);
      const startMap = project.maps.find((m) => m.id === (project.system.startMapId || project.maps[0].id));
      startMap.music = "asset:audio/test-bgm";
      startMap.ambience = [{ key: "asset:audio/test-rain", vol: 0.5 }];
      localStorage.setItem("rpgatlas_project", JSON.stringify(project));

      // 0.25s 440Hz sine, 8kHz mono 16-bit PCM WAV.
      function makeWav() {
        const rate = 8000, n = Math.floor(rate * 0.25);
        const buf = new ArrayBuffer(44 + n * 2);
        const v = new DataView(buf);
        const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
        str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE");
        str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
        str(36, "data"); v.setUint32(40, n * 2, true);
        for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin((i / rate) * 440 * 2 * Math.PI) * 12000), true);
        return new Blob([buf], { type: "audio/wav" });
      }
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("rpgatlas_library", 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "key" });
          if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["meta", "blobs"], "readwrite");
        for (const [name, kind, hash] of [["test-bgm", "bgm", "e2e1"], ["test-rain", "bgs", "e2e2"]]) {
          const key = "asset:audio/" + name;
          const blob = makeWav();
          tx.objectStore("meta").put({ key, type: "audio", name, tags: [], bytes: blob.size, hash, addedAt: Date.now(), mime: "audio/wav", kind });
          tx.objectStore("blobs").put(blob, key);
        }
        tx.oncomplete = () => resolve(null);
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, json);

    await page.goto("/play.html");
    await expect(page.getByText("New Game", { exact: true })).toBeVisible();
    await page.getByText("New Game", { exact: true }).click();
    await expect(page.locator(".titlewin")).toHaveCount(0);

    // The deck owns the streamed BGM and the diffed ambience layer. (Autoplay
    // may hold actual playback until a gesture; ownership is the signal.)
    await expect.poll(async () => page.evaluate(() => window.AtlasAudioDeck.deckState())).toEqual({
      bgmKey: "asset:audio/test-bgm",
      ambience: [{ key: "asset:audio/test-rain", vol: 0.5 }],
    });

    // Positional playback path stays quiet on errors too.
    await page.evaluate(() => window.Sfx.playAt("asset:audio/test-bgm", 0.5, 0.4));
    expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});
