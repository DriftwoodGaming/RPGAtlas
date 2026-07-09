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
import { validateProject } from "../../shared/schema";
import { sanitizeFolderName } from "../../shared/project-name";
import { projectErrorCopy, type ProjectErrorCode } from "../../shared/project-errors";
import { annotateRecents, type Recent } from "../../shared/recents";
import { TEMPLATES, type TemplateId } from "../../shared/project-templates";
import type { ProjectBundle } from "../../platform/tauri/project-host";
import { runBootWith } from "../boot";
import { activeManagerHost, type ManagerHost } from "./manager-host";
import { isEditorBooted, setOpenProjectContext } from "./project-context";
import { buildTemplateDocument } from "./templates";

let overlay: HTMLElement | null = null;
let toastEl: HTMLElement | null = null;

// A game to open on the next fresh load (H2·C). File ▸ New/Open while a game is
// already open re-opens by *reloading* the window rather than re-running boot()
// in place — boot() binds many one-time listeners, so a second in-place boot
// would double-bind. sessionStorage survives location.reload() (same tab).
const PENDING_KEY = "atlas.pendingOpen";
function setPendingOpen(root: string): void {
  try {
    sessionStorage.setItem(PENDING_KEY, root);
  } catch {
    /* ignore */
  }
}
function takePendingOpen(): string | null {
  try {
    const v = sessionStorage.getItem(PENDING_KEY);
    if (v != null) sessionStorage.removeItem(PENDING_KEY);
    return v;
  } catch {
    return null;
  }
}

/** The desktop / ?fakehost entry point, called from boot.ts's start(). If a game
 *  is queued to open (a File ▸ New/Open reload), open it straight into the editor;
 *  otherwise show the launcher. */
export async function launchManager(): Promise<void> {
  const pending = takePendingOpen();
  if (pending) {
    const host = activeManagerHost();
    try {
      const bundle = await host.open(pending);
      await bootChosen(bundle, host);
      return;
    } catch {
      /* the queued game vanished — fall through to the launcher */
    }
  }
  showProjectManager();
}

/** Mount (or remount) the Project Manager over the main window. Idempotent.
 *  `initial === "new"` opens straight on the New Project view (File ▸ New). */
export function showProjectManager(initial?: "new"): void {
  closeManager();
  const host = activeManagerHost();
  const ov = h("div", { class: "pm-overlay" });
  const card = h("div", { class: "pm-card" });
  const toast = h("div", { class: "pm-toast", hidden: "" });
  ov.appendChild(card);
  ov.appendChild(toast);
  document.body.appendChild(ov);
  overlay = ov;
  toastEl = toast;
  if (initial === "new") renderNewForm(card, host);
  else renderLanding(card, host);
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
  const project = validateProject(RA.migrateProject(JSON.parse(bundle.document)), "load");
  const displayName = (project.system && project.system.title) || bundle.name;
  try {
    await host.recentsTouch(bundle.root, displayName);
  } catch {
    /* recents is a nicety — never block booting the game on it */
  }
  setOpenProjectContext({ root: bundle.root, name: displayName });
  closeManager();
  runBootWith(project);
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
