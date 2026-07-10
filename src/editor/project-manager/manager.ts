/* RPGAtlas — src/editor/project-manager/manager.ts
   The Project Manager launcher (Project Harbor, Phase H2). A desktop-only pre-boot
   screen rendered INSIDE the main window (never a new webview — trap 2): make a new
   game or open one you already have, then the editor boots on it. Loaded through a
   dynamic import from boot.ts's start(), so the pure browser build never fetches it.

   The e2e boot gate (trap 1): this screen NEVER touches #save-ind — only boot()
   reveals it, last, once the editor itself is interactive. The manager being on
   screen is not the "booted" signal.
   docs/harbor-2-spec.md §1–§3. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { RA } from "../editor-state";
import { h } from "../dom";
import { validateProject, isProjectLike } from "../../shared/schema";
import { sanitizeFolderName } from "../../shared/project-name";
import { planFolderMigration, type FolderMigrationPlan } from "../../shared/folder-migration";
import { projectErrorCopy, type ProjectErrorCode } from "../../shared/project-errors";
import { annotateRecents, type Recent } from "../../shared/recents";
import { TEMPLATES, type TemplateId } from "../../shared/project-templates";
import type { ProjectBundle } from "../../platform/tauri/project-host";
import { runBootWith } from "../boot";
import { modal } from "../modals";
import { bindFolderProject, peekMirror, peekMirrorMeta, flushFolderNow } from "../persistence";
import { decideRecovery } from "../../shared/folder-sync";
import { activeManagerHost, type ManagerHost } from "./manager-host";
import { isEditorBooted, setOpenProjectContext } from "./project-context";
import { buildTemplateDocument } from "./templates";
// The "open this game on the next fresh load" handoff (H2·C reboot, H3·B reload).
// Extracted to its own module so persistence.ts can request a clean reboot for
// external-change recovery without importing the manager (which would form a cycle).
import { setPendingOpen, takePendingOpen } from "./pending-open";

let overlay: HTMLElement | null = null;
let toastEl: HTMLElement | null = null;

/** The desktop / ?fakehost entry point, called from boot.ts's start(). Decides what
 *  to open, in priority order:
 *  1. an in-session queued game (a File ▸ New/Open reload, an external-change reload) —
 *     `pendingOpen` (H2·C/H3·B);
 *  2. a project the exe was LAUNCHED with (a `.rpgatlas` double-click / `exe <path>`) —
 *     `takeLaunchPath` (H5·A); a bad path falls back to the launcher with a friendly note;
 *  3. otherwise, show the launcher.
 *  On a fresh cold launch (1) is empty, so (2) decides; a reload only ever hits (1). */
export async function launchManager(): Promise<void> {
  const host = activeManagerHost();
  // H5·B: from now on, a second launch (single-instance) can ask us to open a game.
  // Install the listener once per page load, whether we end on the launcher or the editor.
  installExternalOpen(host);

  const pending = takePendingOpen();
  if (pending) {
    try {
      await bootChosen(await host.open(pending), host);
      return;
    } catch {
      /* the queued game vanished — fall through */
    }
  }

  // H5·A: a project path from the command line / a double-clicked .rpgatlas file.
  let launchPath: string | null = null;
  try {
    launchPath = host.takeLaunchPath ? await host.takeLaunchPath() : null;
  } catch {
    launchPath = null; // a launch-path probe failure must never block the launcher
  }
  if (launchPath) {
    try {
      await bootChosen(await host.open(launchPath), host);
      return;
    } catch (e) {
      // Bad path (missing / not a project) → the launcher, with the same kid-friendly
      // copy the Browse flow shows. showProjectManager mounts the toast element first.
      showProjectManager();
      setToast(errText(e));
      return;
    }
  }

  // H6·A: a pre-Harbor game that still lives only in the localStorage mirror (no folder
  // yet) is now behind the launcher. Greet the child with the one-click "let's put your
  // game in a folder" wizard so the old path never strands anyone. "Not now" drops to the
  // normal launcher (where a banner keeps the offer available). Once migrated + booted the
  // folder game writes mirror meta, so the signal clears and this never fires again.
  const plan = currentMigrationPlan();
  if (plan) {
    showMigration(plan);
    return;
  }

  showProjectManager();
}

/** H6·A: the pending legacy → folder migration (or null). A folder game always carries
 *  mirror bookkeeping (`atlas.mirror.meta`); a mirror WITHOUT it is a pre-Harbor
 *  localStorage-only game worth moving into a folder. */
function currentMigrationPlan(): FolderMigrationPlan | null {
  return planFolderMigration(peekMirror(), !!peekMirrorMeta(), isProjectLike);
}

// H5·B: the single-instance "open this game" listener is installed once per page load.
let externalOpenInstalled = false;

/** Wire the host's second-launch open requests (H5·B) to `requestOpenProject`, once. */
function installExternalOpen(host: ManagerHost): void {
  if (externalOpenInstalled || !host.onOpenProjectRequest) return;
  externalOpenInstalled = true;
  host.onOpenProjectRequest((path) => {
    void requestOpenProject(path, activeManagerHost());
  });
}

/** Open a game a SECOND launch asked for (H5·B). If a game is already open, flush its
 *  unsaved edits into its folder FIRST (the unsaved-work guard), then reboot cleanly into
 *  the requested one (bootChosen handles the booted→reload handoff). On the launcher, it
 *  boots in place. A bad path leaves an open game untouched; on the launcher it surfaces
 *  the same friendly note the Browse flow shows. */
async function requestOpenProject(target: string, host: ManagerHost): Promise<void> {
  let bundle: ProjectBundle;
  try {
    bundle = await host.open(target);
  } catch (e) {
    // Don't disrupt the game the child is working on for a bad second-launch path; only
    // speak up when we're sitting on the launcher (nothing to lose).
    if (!isEditorBooted()) {
      showProjectManager();
      setToast(errText(e));
    }
    return;
  }
  if (isEditorBooted()) {
    // Guard unsaved work: make sure the current game's latest edits are on disk before we
    // switch away from it (bootChosen will reload the window into the requested game).
    try {
      await flushFolderNow();
    } catch {
      /* best-effort: a flush failure still shouldn't strand the open request */
    }
  }
  await bootChosen(bundle, host);
}

/** Mount a fresh manager overlay (card + toast) over the main window, returning the
 *  empty card for a view to fill. Idempotent — any existing overlay is torn down first. */
function mountManagerCard(): HTMLElement {
  closeManager();
  const ov = h("div", { class: "pm-overlay" });
  const card = h("div", { class: "pm-card" });
  const toast = h("div", { class: "pm-toast", hidden: "" });
  ov.appendChild(card);
  ov.appendChild(toast);
  document.body.appendChild(ov);
  overlay = ov;
  toastEl = toast;
  return card;
}

/** Mount (or remount) the Project Manager over the main window. Idempotent.
 *  `initial === "new"` opens straight on the New Project view (File ▸ New). */
export function showProjectManager(initial?: "new"): void {
  const host = activeManagerHost();
  const card = mountManagerCard();
  if (initial === "new") renderNewForm(card, host);
  else renderLanding(card, host);
}

/** H6·A: mount the legacy → folder migration wizard (the initial screen a returning
 *  pre-Harbor desktop user meets). */
export function showMigration(plan: FolderMigrationPlan): void {
  const host = activeManagerHost();
  const card = mountManagerCard();
  renderMigrateForm(card, host, plan);
}

/** Re-show the launcher over the running editor (File ▸ New/Open, H2·C). */
export function returnToManager(view?: "new" | "open"): void {
  showProjectManager(view === "new" ? "new" : undefined);
}

function closeManager(): void {
  if (overlay) overlay.remove();
  overlay = null;
  toastEl = null;
}

// --- views -----------------------------------------------------------------

function renderLanding(card: HTMLElement, host: ManagerHost): void {
  clearToast();
  card.innerHTML = "";
  card.appendChild(header());

  // H6·A: if a pre-Harbor game is still waiting to be moved into a folder, keep the offer
  // one click away here too (so "Not now" on the wizard isn't a dead end).
  const plan = currentMigrationPlan();
  if (plan) card.appendChild(migrateBanner(card, host, plan));

  const actions = h(
    "div",
    { class: "pm-actions" },
    bigButton("＋", "New Project", "Start a brand-new game", () => renderNewForm(card, host)),
    bigButton("📂", "Open Project", "Open a game folder you already have", () => browseOpen(host)),
  );

  const recents = h(
    "div",
    { class: "pm-recents" },
    h("div", { class: "pm-recents-head" }, "Recent games"),
    h("div", { class: "pm-recents-list" }),
  );

  card.appendChild(h("div", { class: "pm-cols" }, actions, recents));
  // Returning via File ▸ New/Open (H2·C) — offer a way back to the open game.
  if (isEditorBooted()) {
    card.appendChild(
      h(
        "div",
        { class: "pm-back-row" },
        h("button", { class: "pm-btn", type: "button", onclick: () => closeManager() }, "← Back to my game"),
      ),
    );
  }
  void loadRecents(recents, host);
}

// The New Project view: name (with a live folder-safe preview via the H1
// sanitizer), a parent-directory picker, and the Blank/Starter/Atlas Quest
// template chooser — scaffolds via project_create, then boots the editor on it.
function renderNewForm(card: HTMLElement, host: ManagerHost): void {
  clearToast();
  card.innerHTML = "";
  card.appendChild(header());

  const state = { parentDir: null as string | null, template: "starter" as TemplateId };

  const nameInput = h("input", {
    class: "pm-input",
    type: "text",
    placeholder: "My Awesome Game",
    maxlength: "80",
  }) as HTMLInputElement;

  const err = h("div", { class: "pm-error", hidden: "" });
  const setErr = (msg: string) => {
    err.textContent = msg;
    err.hidden = !msg;
  };

  // Live preview: show the actual folder that will be made, so the child sees a
  // "My Game!!!" → "My Game" fix (or the Untitled Game fallback) before committing.
  const preview = h("div", { class: "pm-preview" });
  const updatePreview = () => {
    preview.replaceChildren(
      document.createTextNode("We'll make a folder called "),
      h("b", null, sanitizeFolderName(nameInput.value)),
    );
  };
  nameInput.addEventListener("input", () => {
    updatePreview();
    if (err.hidden === false) setErr("");
  });
  updatePreview();

  // Template chooser.
  const cardEls: Record<string, HTMLElement> = {};
  const templates = h("div", { class: "pm-templates" });
  for (const tpl of TEMPLATES) {
    const el = h(
      "button",
      {
        class: "pm-template" + (tpl.id === state.template ? " sel" : ""),
        type: "button",
        onclick() {
          state.template = tpl.id;
          for (const id of Object.keys(cardEls)) cardEls[id].classList.toggle("sel", id === tpl.id);
        },
      },
      h("div", { class: "pm-template-label" }, tpl.label),
      h("div", { class: "pm-template-desc" }, tpl.description),
    );
    cardEls[tpl.id] = el;
    templates.appendChild(el);
  }

  const folderPath = h("span", { class: "pm-folder-path" }, "No folder chosen yet");
  const chooseBtn = h(
    "button",
    {
      class: "pm-btn",
      type: "button",
      async onclick() {
        let dir: string | null = null;
        try {
          dir = await host.pickDirectory();
        } catch (e) {
          setErr(errText(e));
          return;
        }
        if (dir) {
          state.parentDir = dir;
          folderPath.textContent = dir;
          folderPath.classList.add("chosen");
          setErr("");
        }
      },
    },
    "Choose folder…",
  );

  const makeBtn = h(
    "button",
    {
      class: "pm-btn primary",
      type: "button",
      onclick() {
        const name = nameInput.value.trim();
        if (!name) {
          setErr("Please give your game a name.");
          return;
        }
        if (!state.parentDir) {
          setErr("Choose a folder to make your game in.");
          return;
        }
        void createProject(name, state.parentDir, state.template, host, setErr);
      },
    },
    "Make my game",
  );

  card.appendChild(
    h(
      "div",
      { class: "pm-form" },
      labeled("What's your game called?", h("div", null, nameInput, preview)),
      labeled("What kind of game?", templates),
      labeled("Where should it live?", h("div", { class: "pm-folder-row" }, chooseBtn, folderPath)),
      err,
      h(
        "div",
        { class: "pm-form-btns" },
        h("button", { class: "pm-btn", type: "button", onclick: () => renderLanding(card, host) }, "Back"),
        makeBtn,
      ),
    ),
  );
  nameInput.focus();
}

// The legacy → folder migration wizard (Project Harbor H6·A). A pre-Harbor game lives
// only in the localStorage mirror, with no folder on disk. This puts it in a real folder
// of its own: the name is prefilled from the game's title, and project_create scaffolds
// the folder straight from the stored document — the H4 legacy bridge then copies the
// game's used global-library pictures and sounds into the new folder as it boots, so the
// result is fully self-contained. "Not now" drops to the normal launcher.
function renderMigrateForm(card: HTMLElement, host: ManagerHost, plan: FolderMigrationPlan): void {
  clearToast();
  card.innerHTML = "";
  card.appendChild(header());

  card.appendChild(
    h(
      "div",
      { class: "pm-intro" },
      h("p", null, "Welcome back! We found a game you were making."),
      h(
        "p",
        { class: "dim" },
        "Let's give it a folder of its own — then you can find it, back it up, zip it, and open it on any computer, just like the big game-makers.",
      ),
    ),
  );

  const state = { parentDir: null as string | null };

  const nameInput = h("input", {
    class: "pm-input",
    type: "text",
    placeholder: "My Awesome Game",
    maxlength: "80",
  }) as HTMLInputElement;
  nameInput.value = plan.title; // prefilled from the game's own title

  const err = h("div", { class: "pm-error", hidden: "" });
  const setErr = (msg: string) => {
    err.textContent = msg;
    err.hidden = !msg;
  };

  const preview = h("div", { class: "pm-preview" });
  const updatePreview = () => {
    preview.replaceChildren(
      document.createTextNode("We'll make a folder called "),
      h("b", null, sanitizeFolderName(nameInput.value)),
    );
  };
  nameInput.addEventListener("input", () => {
    updatePreview();
    if (err.hidden === false) setErr("");
  });
  updatePreview();

  const folderPath = h("span", { class: "pm-folder-path" }, "No folder chosen yet");
  const chooseBtn = h(
    "button",
    {
      class: "pm-btn",
      type: "button",
      async onclick() {
        let dir: string | null = null;
        try {
          dir = await host.pickDirectory();
        } catch (e) {
          setErr(errText(e));
          return;
        }
        if (dir) {
          state.parentDir = dir;
          folderPath.textContent = dir;
          folderPath.classList.add("chosen");
          setErr("");
        }
      },
    },
    "Choose folder…",
  );

  const makeBtn = h(
    "button",
    {
      class: "pm-btn primary",
      type: "button",
      onclick() {
        const name = nameInput.value.trim();
        if (!name) {
          setErr("Please give your game a name.");
          return;
        }
        if (!state.parentDir) {
          setErr("Choose a folder to put your game in.");
          return;
        }
        void migrateToFolder(name, state.parentDir, plan, host, setErr);
      },
    },
    "Put my game in a folder",
  );

  card.appendChild(
    h(
      "div",
      { class: "pm-form" },
      labeled("What's your game called?", h("div", null, nameInput, preview)),
      labeled("Where should it live?", h("div", { class: "pm-folder-row" }, chooseBtn, folderPath)),
      err,
      h(
        "div",
        { class: "pm-form-btns" },
        h("button", { class: "pm-btn", type: "button", onclick: () => renderLanding(card, host) }, "Not now"),
        makeBtn,
      ),
    ),
  );
  nameInput.focus();
}

/** The landing-view banner that keeps the migration offer one click away (H6·A). */
function migrateBanner(card: HTMLElement, host: ManagerHost, plan: FolderMigrationPlan): HTMLElement {
  return h(
    "button",
    {
      class: "pm-migrate",
      type: "button",
      onclick: () => renderMigrateForm(card, host, plan),
    },
    h("span", { class: "pm-migrate-icon" }, "📦"),
    h(
      "span",
      { class: "pm-migrate-text" },
      h("span", { class: "pm-migrate-label" }, "Put your old game in a folder"),
      h("span", { class: "pm-migrate-sub" }, `We found “${plan.title}” — move it into a folder of its own.`),
    ),
  );
}

// --- flows -----------------------------------------------------------------

async function loadRecents(container: HTMLElement, host: ManagerHost): Promise<void> {
  const listEl = (container.querySelector(".pm-recents-list") as HTMLElement) || container;
  listEl.innerHTML = "";

  let list: Recent[];
  try {
    list = await host.recentsList();
  } catch {
    list = [];
  }
  if (!list.length) {
    listEl.appendChild(h("div", { class: "pm-recents-empty" }, "No games yet. Make one to see it here."));
    return;
  }

  // If the host can stat the filesystem (the fake host; the real desktop host
  // cannot — see §1.1), flag rows whose folder has vanished up front. Otherwise a
  // vanished game surfaces on click (open() → MISSING). annotateRecents (H1 core)
  // keeps ordering + the display-time "never auto-prune" rule.
  const existsMap = new Map<string, boolean>();
  if (host.exists) {
    await Promise.all(
      list.map(async (r) => {
        try {
          existsMap.set(r.path, await host.exists!(r.path));
        } catch {
          existsMap.set(r.path, true); // don't cry "missing" on a probe failure
        }
      }),
    );
  }
  const rows = annotateRecents(list, (p) => (host.exists ? (existsMap.get(p) ?? true) : true));
  for (const r of rows) {
    listEl.appendChild(recentRow(r, host, container));
  }
}

/** One recents row: a clickable "open me" button when present, or a plain-language
 *  "can't find this game anymore" row with a Remove control when its folder is
 *  gone (never auto-dropped — the child removes it explicitly). */
function recentRow(
  r: Recent & { missing: boolean },
  host: ManagerHost,
  container: HTMLElement,
): HTMLElement {
  if (r.missing) {
    return h(
      "div",
      { class: "pm-recent missing", title: r.path },
      h("span", { class: "pm-recent-name" }, r.name || leafOf(r.path)),
      h("span", { class: "pm-recent-missing" }, projectErrorCopy("MISSING").title),
      h(
        "button",
        {
          class: "pm-btn pm-recent-remove",
          type: "button",
          async onclick() {
            try {
              await host.recentsRemove(r.path);
            } catch {
              /* ignore */
            }
            void loadRecents(container, host);
          },
        },
        "Remove",
      ),
    );
  }
  return h(
    "button",
    { class: "pm-recent", type: "button", title: r.path, onclick: () => openTarget(r.path, host) },
    h("span", { class: "pm-recent-name" }, r.name || leafOf(r.path)),
    h("span", { class: "pm-recent-path" }, r.path),
  );
}

async function browseOpen(host: ManagerHost): Promise<void> {
  let folder: string | null = null;
  try {
    folder = await host.pickFolder();
  } catch (e) {
    setToast(errText(e));
    return;
  }
  if (!folder) return; // cancelled
  await openTarget(folder, host);
}

async function openTarget(target: string, host: ManagerHost): Promise<void> {
  try {
    const bundle = await host.open(target);
    await bootChosen(bundle, host);
  } catch (e) {
    setToast(errText(e));
  }
}

async function createProject(
  name: string,
  parentDir: string,
  templateId: TemplateId,
  host: ManagerHost,
  setErr: (msg: string) => void,
): Promise<void> {
  const leaf = sanitizeFolderName(name);
  let doc: any;
  try {
    doc = buildTemplateDocument(templateId, name);
  } catch {
    setErr("Couldn't build that game. Try a different template.");
    return;
  }
  try {
    const bundle = await host.create(parentDir, leaf, JSON.stringify(doc));
    await bootChosen(bundle, host);
  } catch (e) {
    setErr(errText(e));
  }
}

/** H6·A: scaffold a folder from the stored (pre-Harbor) document and boot into it. The
 *  same bootChosen pipeline the New/Open flows use runs the H4 legacy asset bridge on
 *  boot, so the game's used global-library pictures/sounds are copied into the new folder
 *  and it ends up self-contained. The mirror is left in place (it becomes this folder
 *  game's crash-recovery copy); the first save writes the folder bookkeeping that
 *  extinguishes the migration offer. */
async function migrateToFolder(
  name: string,
  parentDir: string,
  plan: FolderMigrationPlan,
  host: ManagerHost,
  setErr: (msg: string) => void,
): Promise<void> {
  const leaf = sanitizeFolderName(name);
  try {
    const bundle = await host.create(parentDir, leaf, plan.documentJson);
    await bootChosen(bundle, host);
  } catch (e) {
    setErr(errText(e));
  }
}

/** The shared "a game was chosen" pipeline: validate the document, record it in
 *  recents + the open-project context (which sets the window title), tear down the
 *  manager, and boot the editor — which reveals #save-ind last (the gate). */
async function bootChosen(bundle: ProjectBundle, host: ManagerHost): Promise<void> {
  // Returning via File ▸ New/Open while a game is already open: reboot cleanly by
  // reloading with this game queued, rather than re-running boot() over the live
  // editor (which would double-bind its one-time listeners). The folder already
  // exists (create/open just succeeded), so the fresh load re-opens it.
  if (isEditorBooted()) {
    setPendingOpen(bundle.root);
    location.reload();
    return;
  }
  // Project Harbor H3·B: crash recovery. If the localStorage mirror holds changes the
  // folder file never confirmed (a kill between the mirror write and the folder write),
  // offer to bring them back. Every other case (no mirror, a different game's mirror, a
  // confirmed save, matching content) → open the folder document as normal, so an
  // external edit made while closed is respected, not clobbered by a stale mirror.
  let documentJson = bundle.document;
  let recovered = false;
  if (
    decideRecovery({
      root: bundle.root,
      folderDoc: bundle.document,
      mirrorDoc: peekMirror(),
      mirrorMeta: peekMirrorMeta(),
    }) === "offer-mirror"
  ) {
    // Close the launcher first so nothing covers the prompt; boot fills the chrome
    // right after the child chooses. #save-ind stays hidden until then (the gate).
    closeManager();
    const mirror = peekMirror();
    if (mirror && (await confirmRecovery())) {
      documentJson = mirror;
      recovered = true;
    }
  }
  const project = validateProject(RA.migrateProject(JSON.parse(documentJson)), "load");
  const displayName = (project.system && project.system.title) || bundle.name;
  try {
    await host.recentsTouch(bundle.root, displayName);
  } catch {
    /* recents is a nicety — never block booting the game on it */
  }
  setOpenProjectContext({ root: bundle.root, name: displayName });
  // Project Harbor H3·A: bind autosave to this folder. The baseline is the exact bytes
  // read from disk, so a later focus re-read (H3·B) compares like-for-like and opening a
  // game never rolls a backup for content the folder already holds. When we recovered a
  // newer mirror, mark it dirty so the recovered work is written back to the folder on
  // the next autosave (the in-memory project intentionally differs from disk).
  bindFolderProject(bundle.root, bundle.document, recovered);
  closeManager();
  runBootWith(project);
}

/** The crash-recovery prompt (H3·B). Resolves true = restore the unsaved mirror, false =
 *  open the version saved in the folder. Kid-friendly; not dismissable (a clear choice). */
function confirmRecovery(): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    modal({
      title: "Bring your changes back?",
      content: h(
        "div",
        null,
        h("p", null, "Last time, some changes to this game didn't finish saving into its folder."),
        h("p", null, "Want to bring those changes back, or open the version saved in the folder?"),
      ),
      buttons: [
        { label: "Bring my changes back", primary: true, onClick(c: any) { c(); finish(true); } },
        { label: "Use the saved game", onClick(c: any) { c(); finish(false); } },
      ],
      dismissable: false,
    });
  });
}

// --- small helpers ---------------------------------------------------------

function header(): HTMLElement {
  return h(
    "div",
    { class: "pm-header" },
    h("img", { class: "pm-logo", src: "img/system/rpgatlas-logo.svg", alt: "" }),
    h(
      "div",
      { class: "pm-titles" },
      h("div", { class: "pm-title" }, "RPGAtlas"),
      h("div", { class: "pm-tag" }, "Let's make a game — start a new one, or open one you already have."),
    ),
  );
}

function bigButton(icon: string, label: string, sub: string, onClick: () => void): HTMLElement {
  return h(
    "button",
    { class: "pm-bigbtn", type: "button", onclick: onClick },
    h("span", { class: "pm-bigbtn-icon" }, icon),
    h(
      "span",
      { class: "pm-bigbtn-text" },
      h("span", { class: "pm-bigbtn-label" }, label),
      h("span", { class: "pm-bigbtn-sub" }, sub),
    ),
  );
}

function labeled(labelText: string, control: HTMLElement): HTMLElement {
  return h(
    "div",
    { class: "pm-field" },
    h("label", { class: "pm-field-label" }, labelText),
    control,
  );
}

function leafOf(path: string): string {
  const parts = String(path).split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(path);
}

/** Map a thrown host error (carrying a ProjectErrorCode) to one kid-friendly line. */
function errText(e: unknown): string {
  const code: ProjectErrorCode =
    e && typeof e === "object" && typeof (e as any).code === "string"
      ? ((e as any).code as ProjectErrorCode)
      : "IO";
  const copy = projectErrorCopy(code);
  return `${copy.title}. ${copy.body}`;
}

function setToast(text: string): void {
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.hidden = false;
}

function clearToast(): void {
  if (!toastEl) return;
  toastEl.textContent = "";
  toastEl.hidden = true;
}
