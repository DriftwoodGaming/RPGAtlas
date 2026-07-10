/* RPGAtlas — tests-e2e/project-manager.spec.mjs
   Project Harbor H2: the desktop Project Manager launcher, driven in the browser
   build through the ?fakehost test host (src/editor/project-manager/test-host.ts).
   These specs are ADDITIVE — they always pass ?fakehost, so the manager mounts;
   the existing 70 specs never do, so they see no manager and run unchanged.

   The e2e boot gate (trap 1): while the manager is on screen the editor has NOT
   booted, so #save-ind stays hidden; it appears only after a game is chosen and
   boot() reveals it last. GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { atlasQuestJson } from "./fixtures/atlas-quest.mjs";

const SEED_ROOT = "/Games/Seed Game";

/** Seed the fake host's localStorage (docs + recents) with one openable game,
 *  then navigate to the manager. Mirrors the atlas-quest seed pattern: prime the
 *  origin, write storage, then load ?fakehost so start() installs the fake host
 *  and reads the seed. */
async function gotoManagerWithSeed(page, { recents = [], docs = {} } = {}) {
  // Prime the origin under ?fakehost so the manager mounts (as on desktop) instead of the
  // browser editor booting and writing a meta-less rpgatlas_project mirror — which the
  // H6·A migration offer would then read as a "legacy game" (see H6·A §1.1).
  await page.goto("/index.html?fakehost");
  await page.evaluate(
    ({ r, d }) => {
      localStorage.setItem("atlas.fakehost.recents", r);
      localStorage.setItem("atlas.fakehost.docs", d);
    },
    { r: JSON.stringify(recents), d: JSON.stringify(docs) },
  );
  await page.goto("/index.html?fakehost");
}

test.describe("Project Manager — surface & boot gate (H2·A)", () => {
  test("mounts on ?fakehost and keeps #save-ind hidden until a game is chosen", async ({ page }) => {
    await gotoManagerWithSeed(page);

    // The launcher is up, with both actions and the recents column.
    await expect(page.locator(".pm-overlay")).toBeVisible();
    await expect(page.locator(".pm-bigbtn", { hasText: "New Project" })).toBeVisible();
    await expect(page.locator(".pm-bigbtn", { hasText: "Open Project" })).toBeVisible();
    await expect(page.locator(".pm-recents-head")).toHaveText(/Recent games/i);

    // The gate: the editor has not booted, so its "ready" indicator is hidden.
    await expect(page.locator("#save-ind")).toBeHidden();
  });

  test("the New Project button reveals the create form", async ({ page }) => {
    await gotoManagerWithSeed(page);
    await page.locator(".pm-bigbtn", { hasText: "New Project" }).click();
    await expect(page.locator(".pm-form .pm-input")).toBeVisible();
    // Still no editor behind it.
    await expect(page.locator("#save-ind")).toBeHidden();
    // Back returns to the landing view.
    await page.locator(".pm-btn", { hasText: "Back" }).click();
    await expect(page.locator(".pm-bigbtn", { hasText: "Open Project" })).toBeVisible();
  });

  test("clicking a recent opens the game and boots the editor (title follows)", async ({ page }) => {
    await gotoManagerWithSeed(page, {
      recents: [{ name: "Seed Game", path: SEED_ROOT, lastOpened: 1 }],
      docs: { [SEED_ROOT]: atlasQuestJson() },
    });

    const recent = page.locator(".pm-recent", { hasText: "Seed Game" });
    await expect(recent).toBeVisible();
    await expect(page.locator("#save-ind")).toBeHidden(); // gate still closed

    await recent.click();

    // The editor boots: the manager is gone, the chrome is up, and #save-ind
    // finally appears (the boot gate the other 70 specs rely on).
    await expect(page.locator(".pm-overlay")).toHaveCount(0);
    await expect(page.locator("#save-ind")).toBeVisible();
    await expect(page.locator("#menubar")).toBeVisible();
    await expect(page.locator("#mapcanvas")).toBeVisible();
    // Window title tracks the opened game's display name (its system.title).
    await expect(page).toHaveTitle("Atlas Quest — RPGAtlas");
  });
});

test.describe("Project Manager — New Project flow (H2·B)", () => {
  test("live folder preview sanitizes the typed name", async ({ page }) => {
    await gotoManagerWithSeed(page);
    await page.locator(".pm-bigbtn", { hasText: "New Project" }).click();

    const preview = page.locator(".pm-preview");
    const name = page.locator(".pm-form .pm-input");
    await name.fill("Hero:Quest?"); // ":" and "?" are reserved on Windows
    await expect(preview.locator("b")).toHaveText("Hero Quest"); // reserved chars → space, trimmed
    await name.fill("   ");
    await expect(preview.locator("b")).toHaveText("Untitled Game"); // empty → fallback
    await expect(page.locator(".pm-template")).toHaveCount(3); // Blank / Starter / Atlas Quest
  });

  test("name + folder + template creates the game and boots the editor", async ({ page }) => {
    await gotoManagerWithSeed(page);
    // Queue the directory the native picker would return.
    await page.evaluate(() => window.__ATLAS_TEST_HOST__.setNextDirectory("/Games"));

    await page.locator(".pm-bigbtn", { hasText: "New Project" }).click();
    await page.locator(".pm-form .pm-input").fill("Bug Quest");
    await page.locator(".pm-template", { hasText: "Empty map" }).click(); // Blank
    await page.locator(".pm-btn", { hasText: "Choose folder…" }).click();
    await expect(page.locator(".pm-folder-path")).toHaveText("/Games");

    await page.locator(".pm-btn", { hasText: "Make my game" }).click();

    // The editor boots on the freshly scaffolded game.
    await expect(page.locator(".pm-overlay")).toHaveCount(0);
    await expect(page.locator("#save-ind")).toBeVisible();
    await expect(page).toHaveTitle("Bug Quest — RPGAtlas");

    // The fake FS recorded the project folder + a recents entry.
    const state = await page.evaluate(() => ({
      docs: Object.keys(JSON.parse(localStorage.getItem("atlas.fakehost.docs") || "{}")),
      recents: JSON.parse(localStorage.getItem("atlas.fakehost.recents") || "[]"),
    }));
    expect(state.docs).toContain("/Games/Bug Quest");
    expect(state.recents[0]).toMatchObject({ name: "Bug Quest", path: "/Games/Bug Quest" });
  });

  test("a name that collides shows the kid-friendly 'already have a game' error", async ({ page }) => {
    // Seed a folder already taken, so project_create reports FOLDER_EXISTS.
    await gotoManagerWithSeed(page, { docs: { "/Games/Taken": "{}" } });
    await page.evaluate(() => window.__ATLAS_TEST_HOST__.setNextDirectory("/Games"));

    await page.locator(".pm-bigbtn", { hasText: "New Project" }).click();
    await page.locator(".pm-form .pm-input").fill("Taken");
    await page.locator(".pm-btn", { hasText: "Choose folder…" }).click();
    await page.locator(".pm-btn", { hasText: "Make my game" }).click();

    await expect(page.locator(".pm-error")).toContainText("already have a game with that name");
    // The child stays on the form to fix it — no boot happened.
    await expect(page.locator("#save-ind")).toBeHidden();
    await expect(page.locator(".pm-form")).toBeVisible();
  });
});

test.describe("Project Manager — Open flow & rewiring (H2·C)", () => {
  test("a vanished game shows a friendly 'can't find it' row with Remove", async ({ page }) => {
    // A recent whose folder isn't in the fake FS → exists() is false → missing.
    await gotoManagerWithSeed(page, { recents: [{ name: "Gone Game", path: "/Games/Gone", lastOpened: 1 }] });

    const row = page.locator(".pm-recent.missing", { hasText: "Gone Game" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("We can't find this game anymore");

    await row.locator(".pm-recent-remove").click();
    await expect(page.locator(".pm-recent.missing")).toHaveCount(0);
  });

  test("File ▸ Open routes back to the manager; Back returns to the open game", async ({ page }) => {
    const SEED = "/Games/Game A";
    await gotoManagerWithSeed(page, {
      recents: [{ name: "Game A", path: SEED, lastOpened: 1 }],
      docs: { [SEED]: atlasQuestJson() },
    });
    await page.locator(".pm-recent", { hasText: "Game A" }).click();
    await expect(page.locator("#save-ind")).toBeVisible();

    // File ▸ Open Project → confirm → the launcher returns over the editor.
    await page.locator("#menus .menu-label", { hasText: "File" }).dispatchEvent("mousedown");
    await page.locator(".menu-drop .menu-item", { hasText: "Open Project" }).click();
    await page.locator(".modal-btns button", { hasText: "OK" }).click();
    await expect(page.locator(".pm-overlay")).toBeVisible();
    await expect(page.locator(".pm-back-row")).toBeVisible();

    // Back to my game dismisses the manager — the editor is still there, booted.
    await page.locator(".pm-btn", { hasText: "Back to my game" }).click();
    await expect(page.locator(".pm-overlay")).toHaveCount(0);
    await expect(page.locator("#save-ind")).toBeVisible();
  });

  test("File ▸ New opens the New Project form", async ({ page }) => {
    const SEED = "/Games/Game A";
    await gotoManagerWithSeed(page, {
      recents: [{ name: "Game A", path: SEED, lastOpened: 1 }],
      docs: { [SEED]: atlasQuestJson() },
    });
    await page.locator(".pm-recent", { hasText: "Game A" }).click();
    await expect(page.locator("#save-ind")).toBeVisible();

    await page.locator("#menus .menu-label", { hasText: "File" }).dispatchEvent("mousedown");
    await page.locator(".menu-drop .menu-item", { hasText: "New Project" }).click();
    await page.locator(".modal-btns button", { hasText: "OK" }).click();
    await expect(page.locator(".pm-form .pm-input")).toBeVisible();
  });

  test("opening a different game from the File menu reloads cleanly into it", async ({ page }) => {
    const A = "/Games/Game A";
    const B = "/Games/Game B";
    const bDoc = (() => {
      const p = JSON.parse(atlasQuestJson());
      p.system.title = "Game Beta";
      return JSON.stringify(p);
    })();
    await gotoManagerWithSeed(page, {
      recents: [
        { name: "Game B", path: B, lastOpened: 2 },
        { name: "Game A", path: A, lastOpened: 1 },
      ],
      docs: { [A]: atlasQuestJson(), [B]: bDoc },
    });

    // Boot Game A.
    await page.locator(".pm-recent", { hasText: "Game A" }).click();
    await expect(page).toHaveTitle("Atlas Quest — RPGAtlas");

    // File ▸ Open → pick Game B from recents → the window reloads cleanly into B
    // (no double-bound listeners), title tracks B's display name.
    await page.locator("#menus .menu-label", { hasText: "File" }).dispatchEvent("mousedown");
    await page.locator(".menu-drop .menu-item", { hasText: "Open Project" }).click();
    await page.locator(".modal-btns button", { hasText: "OK" }).click();
    await page.locator(".pm-recent", { hasText: "Game B" }).click();

    await expect(page.locator("#save-ind")).toBeVisible();
    await expect(page).toHaveTitle("Game Beta — RPGAtlas");
    await expect(page.locator(".pm-overlay")).toHaveCount(0);
  });
});

test.describe("Project-scoped saving (H3·A)", () => {
  const SAVE_ROOT = "/Games/Saver";

  /** Boot a seeded game, then wait for the editor's first saved tick. */
  async function bootSeeded(page) {
    await gotoManagerWithSeed(page, {
      recents: [{ name: "Saver", path: SAVE_ROOT, lastOpened: 1 }],
      docs: { [SAVE_ROOT]: atlasQuestJson() },
    });
    await page.locator(".pm-recent", { hasText: "Saver" }).click();
    await expect(page.locator("#save-ind")).toBeVisible();
    await expect(page.locator("#save-ind")).toHaveText(/^✓ /);
  }

  const folderDoc = (page) =>
    page.evaluate(
      (root) => JSON.parse(localStorage.getItem("atlas.fakehost.docs"))[root],
      SAVE_ROOT,
    );

  test("opening a game does NOT rewrite the folder file until you edit (no spurious backup)", async ({ page }) => {
    const seed = atlasQuestJson();
    await bootSeeded(page);
    // Boot's saveNow skips the folder write when nothing changed, so the on-disk
    // game.rpgatlas is still byte-for-byte the seed (only the mirror was refreshed).
    expect(await folderDoc(page)).toBe(seed);
    // The mirror bookkeeping records the folder as holding current content.
    const meta = await page.evaluate(() => JSON.parse(localStorage.getItem("atlas.mirror.meta")));
    expect(meta).toMatchObject({ root: SAVE_ROOT, folderConfirmed: true });
  });

  test("an edit autosaves into <root>/game.rpgatlas, not just the localStorage mirror", async ({ page }) => {
    await bootSeeded(page);

    const startMapLayers = (doc) => {
      const p = JSON.parse(doc);
      const id = p.system.startMapId || p.maps[0].id;
      return JSON.stringify(p.maps.find((m) => m.id === id).layers);
    };
    const before = startMapLayers(await folderDoc(page));

    // Paint a tile (the canonical editor edit → touch() → debounced autosave).
    const palette = page.locator("#palette");
    const map = page.locator("#mapcanvas");
    const pBox = await palette.boundingBox();
    await page.mouse.click(pBox.x + pBox.width * 0.5, pBox.y + 8);
    const mBox = await map.boundingBox();
    await page.mouse.click(mBox.x + 10, mBox.y + 10);

    // Wait on the indicator's own unsaved → saved transition (its semantics are
    // unchanged: ● while dirty, ✓ once the folder write resolves).
    await expect(page.locator("#save-ind")).toHaveText(/^● /);
    await expect(page.locator("#save-ind")).toHaveText(/^✓ /, { timeout: 5000 });

    // The FOLDER file changed (autosave rebind), and the mirror stayed a live copy.
    const after = startMapLayers(await folderDoc(page));
    expect(after).not.toEqual(before);
    const mirror = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("rpgatlas_project")),
    );
    const mid = mirror.system.startMapId || mirror.maps[0].id;
    expect(JSON.stringify(mirror.maps.find((m) => m.id === mid).layers)).toEqual(after);
  });
});

/** An Atlas Quest document with its display title overridden (to tell two versions apart). */
function docTitled(title) {
  const p = JSON.parse(atlasQuestJson());
  p.system.title = title;
  return JSON.stringify(p);
}
const titleOf = (doc) => JSON.parse(doc).system.title;

test.describe("Crash recovery (H3·B)", () => {
  const ROOT = "/Games/Crashed";

  /** Seed a folder game plus a crash signature: a mirror (rpgatlas_project) newer than
   *  the folder file, with meta.folderConfirmed flag as given. */
  async function seedCrash(page, { folderTitle, mirrorTitle, folderConfirmed }) {
    await page.goto("/index.html?fakehost"); // prime under ?fakehost (no browser-editor boot)
    await page.evaluate(
      ({ root, folderDoc, mirrorDoc, meta }) => {
        localStorage.setItem(
          "atlas.fakehost.recents",
          JSON.stringify([{ name: "Crashed", path: root, lastOpened: 1 }]),
        );
        localStorage.setItem("atlas.fakehost.docs", JSON.stringify({ [root]: folderDoc }));
        localStorage.setItem("rpgatlas_project", mirrorDoc);
        localStorage.setItem("atlas.mirror.meta", JSON.stringify(meta));
      },
      {
        root: ROOT,
        folderDoc: docTitled(folderTitle),
        mirrorDoc: docTitled(mirrorTitle),
        meta: { root: ROOT, savedAt: Date.now(), folderConfirmed },
      },
    );
    await page.goto("/index.html?fakehost");
    await page.locator(".pm-recent", { hasText: "Crashed" }).click();
  }

  const folderDocOf = (page) =>
    page.evaluate((root) => JSON.parse(localStorage.getItem("atlas.fakehost.docs"))[root], ROOT);

  test("a newer, unconfirmed mirror offers recovery; restoring boots + writes it to the folder", async ({ page }) => {
    await seedCrash(page, { folderTitle: "Saved To Disk", mirrorTitle: "Rescued Draft", folderConfirmed: false });

    // The friendly prompt appears (the editor is NOT booted yet — the gate holds).
    await expect(page.locator(".modal-title", { hasText: "Bring your changes back?" })).toBeVisible();
    await expect(page.locator("#save-ind")).toBeHidden();

    await page.locator(".modal-btns button", { hasText: "Bring my changes back" }).click();

    // Boots on the rescued mirror, and the recovered work is written back to the folder.
    await expect(page.locator("#save-ind")).toBeVisible();
    await expect(page).toHaveTitle("Rescued Draft — RPGAtlas");
    await expect(page.locator("#save-ind")).toHaveText(/^✓ /);
    expect(titleOf(await folderDocOf(page))).toBe("Rescued Draft");
  });

  test("choosing the saved game ignores the mirror and leaves the folder untouched", async ({ page }) => {
    const seed = docTitled("Saved To Disk");
    await seedCrash(page, { folderTitle: "Saved To Disk", mirrorTitle: "Rescued Draft", folderConfirmed: false });

    await page.locator(".modal-btns button", { hasText: "Use the saved game" }).click();
    await expect(page.locator("#save-ind")).toBeVisible();
    await expect(page).toHaveTitle("Saved To Disk — RPGAtlas");
    // The folder file was never rewritten (recovered=false → not dirty → no folder write).
    expect(await folderDocOf(page)).toBe(seed);
  });

  test("a confirmed mirror is NOT crash evidence — boots the folder with no prompt", async ({ page }) => {
    await seedCrash(page, { folderTitle: "Saved To Disk", mirrorTitle: "Stale Mirror", folderConfirmed: true });
    // No recovery prompt: the folder document boots straight through.
    await expect(page.locator("#save-ind")).toBeVisible();
    await expect(page).toHaveTitle("Saved To Disk — RPGAtlas");
    await expect(page.locator(".modal-title", { hasText: "Bring your changes back?" })).toHaveCount(0);
  });
});

test.describe("External changes on focus (H3·B)", () => {
  const ROOT = "/Games/Focus";

  async function bootGame(page, title) {
    await gotoManagerWithSeed(page, {
      recents: [{ name: "Focus", path: ROOT, lastOpened: 1 }],
      docs: { [ROOT]: docTitled(title) },
    });
    await page.locator(".pm-recent", { hasText: "Focus" }).click();
    await expect(page.locator("#save-ind")).toBeVisible();
    await expect(page.locator("#save-ind")).toHaveText(/^✓ /);
  }

  const folderDocOf = (page) =>
    page.evaluate((root) => JSON.parse(localStorage.getItem("atlas.fakehost.docs"))[root], ROOT);

  test("an external edit with no local changes offers a plain reload into the newer version", async ({ page }) => {
    await bootGame(page, "Version One");

    // Something else rewrote game.rpgatlas; focus the window.
    await page.evaluate(
      ({ root, doc }) => {
        window.__ATLAS_TEST_HOST__.seedDoc(root, doc);
        window.dispatchEvent(new Event("focus"));
      },
      { root: ROOT, doc: docTitled("Version Two") },
    );

    await expect(page.locator(".modal-title", { hasText: "changed on your computer" })).toBeVisible();
    await page.locator(".modal-btns button", { hasText: "Load the newer version" }).click();

    // Reloads cleanly into the newer version.
    await expect(page.locator("#save-ind")).toBeVisible();
    await expect(page).toHaveTitle("Version Two — RPGAtlas");
  });

  test("an external edit while YOU have unsaved changes → conflict; Keep my version wins", async ({ page }) => {
    await bootGame(page, "Mine Base");

    // Make an unsaved local edit (paint a tile), then — while still ● unsaved — the file
    // changes on disk and the window regains focus.
    const palette = page.locator("#palette");
    const map = page.locator("#mapcanvas");
    const pBox = await palette.boundingBox();
    await page.mouse.click(pBox.x + pBox.width * 0.5, pBox.y + 8);
    const mBox = await map.boundingBox();
    await page.mouse.click(mBox.x + 10, mBox.y + 10);
    await expect(page.locator("#save-ind")).toHaveText(/^● /); // dirty, autosave not yet flushed

    const painted = await folderDocOf(page); // still the pre-paint bytes (no save yet)
    await page.evaluate(
      ({ root, doc }) => {
        window.__ATLAS_TEST_HOST__.seedDoc(root, doc);
        window.dispatchEvent(new Event("focus"));
      },
      { root: ROOT, doc: docTitled("Theirs") },
    );

    // The conflict prompt names the unsaved-edits case.
    await expect(page.locator(".modal-body", { hasText: "aren't saved yet" })).toBeVisible();
    await page.locator(".modal-btns button", { hasText: "Keep my version" }).click();

    // Our version wins: the folder holds our title (not "Theirs"), and our paint persisted.
    await expect(page.locator("#save-ind")).toHaveText(/^✓ /, { timeout: 5000 });
    const after = await folderDocOf(page);
    expect(titleOf(after)).toBe("Mine Base");
    expect(after).not.toBe(painted); // the painted layer change is in the folder file
  });
});

test.describe("Playtest bridge (H3·C)", () => {
  const ROOT = "/Games/Player";

  test("Playtest writes the latest edits to the same-origin mirror, then opens the reload player", async ({ page }) => {
    await gotoManagerWithSeed(page, {
      recents: [{ name: "Player", path: ROOT, lastOpened: 1 }],
      docs: { [ROOT]: atlasQuestJson() },
    });
    await page.locator(".pm-recent", { hasText: "Player" }).click();
    await expect(page.locator("#save-ind")).toBeVisible();
    await expect(page.locator("#save-ind")).toHaveText(/^✓ /);

    // Record play-window opens instead of spawning a real popup.
    await page.evaluate(() => {
      window.__opened = [];
      window.open = (u) => { window.__opened.push(String(u)); return null; };
    });

    // Make an unsaved edit, then Playtest while still ● (autosave not yet flushed), so
    // the mirror the player reads can only be current if the play action wrote it.
    const palette = page.locator("#palette");
    const map = page.locator("#mapcanvas");
    const pBox = await palette.boundingBox();
    await page.mouse.click(pBox.x + pBox.width * 0.5, pBox.y + 8);
    const mBox = await map.boundingBox();
    await page.mouse.click(mBox.x + 10, mBox.y + 10);
    await expect(page.locator("#save-ind")).toHaveText(/^● /);

    await page.locator("button.play-btn").click();

    // The player URL was opened (the reload-only, same-origin browser bridge)...
    const opened = await page.evaluate(() => window.__opened);
    expect(opened.some((u) => /play\.html\?playtest=/.test(u))).toBe(true);

    // ...and the mirror play.html reads already carries the just-painted edit.
    const layersOf = (proj) => {
      const id = proj.system.startMapId || proj.maps[0].id;
      return JSON.stringify(proj.maps.find((m) => m.id === id).layers);
    };
    const mirror = await page.evaluate(() => JSON.parse(localStorage.getItem("rpgatlas_project")));
    expect(layersOf(mirror)).not.toEqual(layersOf(JSON.parse(atlasQuestJson())));
  });
});

test.describe("Project Manager — fake-host coverage (H2·D)", () => {
  test("create → relaunch → the game is in recents and reopens", async ({ page }) => {
    await gotoManagerWithSeed(page);
    await page.evaluate(() => window.__ATLAS_TEST_HOST__.setNextDirectory("/Games"));

    // Make a game (Starter template by default).
    await page.locator(".pm-bigbtn", { hasText: "New Project" }).click();
    await page.locator(".pm-form .pm-input").fill("Reopen Me");
    await page.locator(".pm-btn", { hasText: "Choose folder…" }).click();
    await page.locator(".pm-btn", { hasText: "Make my game" }).click();
    await expect(page.locator("#save-ind")).toBeVisible();

    // Relaunch the manager (fresh load) — the game persisted into recents.
    await page.goto("/index.html?fakehost");
    const recent = page.locator(".pm-recent", { hasText: "Reopen Me" });
    await expect(recent).toBeVisible();
    await recent.click();
    await expect(page.locator("#save-ind")).toBeVisible();
    await expect(page).toHaveTitle("Reopen Me — RPGAtlas");
  });

  test("Open Project → Browse opens the chosen game folder", async ({ page }) => {
    const SEED = "/Games/Browsed";
    await gotoManagerWithSeed(page, { docs: { [SEED]: atlasQuestJson() } });
    await page.evaluate((p) => window.__ATLAS_TEST_HOST__.setNextFolder(p), SEED);

    await page.locator(".pm-bigbtn", { hasText: "Open Project" }).click();
    await expect(page.locator("#save-ind")).toBeVisible();
    await expect(page).toHaveTitle("Atlas Quest — RPGAtlas");
  });

  test("Browse into a folder with no game shows the friendly not-a-project message", async ({ page }) => {
    await gotoManagerWithSeed(page);
    await page.evaluate(() => {
      window.__ATLAS_TEST_HOST__.seedEmptyFolder("/Games/Empty");
      window.__ATLAS_TEST_HOST__.setNextFolder("/Games/Empty");
    });

    await page.locator(".pm-bigbtn", { hasText: "Open Project" }).click();
    await expect(page.locator(".pm-toast")).toContainText("isn't an RPGAtlas game");
    await expect(page.locator("#save-ind")).toBeHidden(); // nothing booted
  });
});

test.describe("Legacy → folder migration (H6·A)", () => {
  // A 1×1 transparent PNG (decodes in a real browser) — a global-library asset to copy in.
  const PNG_B64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

  /** Seed a pre-Harbor game: the localStorage mirror (`rpgatlas_project`) with NO folder
   *  bookkeeping (`atlas.mirror.meta`) — a game that lived only in the browser store and
   *  never got a folder. Optionally seed the legacy global library the bridge copies from. */
  async function seedLegacy(page, { docJson, globalLib } = {}) {
    // Prime under ?fakehost so no browser-editor boot pollutes the mirror; then seed the
    // pre-Harbor mirror ourselves (race-free — the prior load booted no editor).
    await page.goto("/index.html?fakehost");
    await page.evaluate(
      ({ doc, gl }) => {
        localStorage.setItem("rpgatlas_project", doc);
        localStorage.removeItem("atlas.mirror.meta"); // the "no folder yet" signal
        if (gl) localStorage.setItem("atlas.fakehost.global", gl);
      },
      { doc: docJson, gl: globalLib ? JSON.stringify(globalLib) : null },
    );
    await page.goto("/index.html?fakehost");
  }

  test("a pre-Harbor localStorage game is met by the migration wizard, name prefilled", async ({ page }) => {
    await seedLegacy(page, { docJson: atlasQuestJson() });

    // The wizard — not the plain launcher — greets the child, with the game's own title.
    await expect(page.locator(".pm-intro")).toContainText("We found a game you were making");
    await expect(page.locator(".pm-form .pm-input")).toHaveValue("Atlas Quest");
    await expect(page.locator(".pm-btn", { hasText: "Put my game in a folder" })).toBeVisible();
    // The editor hasn't booted yet — the gate stays closed (trap 1).
    await expect(page.locator("#save-ind")).toBeHidden();
  });

  test("Put my game in a folder scaffolds the folder from the stored game, copies assets, and boots", async ({ page }) => {
    const doc = JSON.parse(atlasQuestJson());
    doc.actors[0].charset = "asset:characters/hero"; // references a global-library asset
    await seedLegacy(page, {
      docJson: JSON.stringify(doc),
      globalLib: {
        metas: [{ key: "asset:characters/hero", type: "characters", name: "hero", hash: "h", mime: "image/png" }],
        blobs: { "asset:characters/hero": PNG_B64 },
      },
    });

    await page.evaluate(() => window.__ATLAS_TEST_HOST__.setNextDirectory("/Games"));
    await page.locator(".pm-btn", { hasText: "Choose folder…" }).click();
    await expect(page.locator(".pm-folder-path")).toHaveText("/Games");
    await page.locator(".pm-btn", { hasText: "Put my game in a folder" }).click();

    // The editor boots on the freshly scaffolded folder game (title tracks it, gate opens).
    await expect(page.locator("#save-ind")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveTitle("Atlas Quest — RPGAtlas");
    // The H4 bridge copied the used global-library asset into the new folder (self-contained).
    await expect(page.locator(".modal-title", { hasText: "We tidied up your game" })).toBeVisible({
      timeout: 20_000,
    });
    const state = await page.evaluate(() => ({
      docs: Object.keys(JSON.parse(localStorage.getItem("atlas.fakehost.docs") || "{}")),
      keys: window.__ATLAS_TEST_HOST__.readAssetIndex("/Games/Atlas Quest").map((m) => m.key),
    }));
    expect(state.docs).toContain("/Games/Atlas Quest");
    expect(state.keys).toContain("asset:characters/hero");
  });

  test('"Not now" drops to the normal launcher, which keeps the offer as a banner', async ({ page }) => {
    await seedLegacy(page, { docJson: atlasQuestJson() });
    await page.locator(".pm-btn", { hasText: "Not now" }).click();

    // The plain launcher, plus a banner to migrate later — never a dead end.
    await expect(page.locator(".pm-bigbtn", { hasText: "New Project" })).toBeVisible();
    await expect(page.locator(".pm-migrate")).toContainText("Put your old game in a folder");
    await expect(page.locator("#save-ind")).toBeHidden();

    // The banner re-opens the wizard.
    await page.locator(".pm-migrate").click();
    await expect(page.locator(".pm-btn", { hasText: "Put my game in a folder" })).toBeVisible();
  });

  test("a folder game (mirror WITH bookkeeping) is never offered migration", async ({ page }) => {
    // A post-Harbor mirror carries meta pointing at its folder; that is not a legacy game.
    await page.goto("/index.html?fakehost"); // prime under ?fakehost (no browser-editor boot)
    await page.evaluate(
      ({ doc }) => {
        localStorage.setItem("rpgatlas_project", doc);
        localStorage.setItem(
          "atlas.mirror.meta",
          JSON.stringify({ root: "/Games/Already", savedAt: Date.now(), folderConfirmed: true }),
        );
      },
      { doc: atlasQuestJson() },
    );
    await page.goto("/index.html?fakehost");

    // The plain launcher, with no migration wizard and no banner.
    await expect(page.locator(".pm-bigbtn", { hasText: "New Project" })).toBeVisible();
    await expect(page.locator(".pm-intro")).toHaveCount(0);
    await expect(page.locator(".pm-migrate")).toHaveCount(0);
  });
});
