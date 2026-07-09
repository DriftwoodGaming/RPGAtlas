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
import type { Recent } from "../../shared/recents";
import type { TemplateId } from "../../shared/project-templates";
import type { ProjectBundle } from "../../platform/tauri/project-host";
import { runBootWith } from "../boot";
import { activeManagerHost, type ManagerHost } from "./manager-host";
import { isEditorBooted, setOpenProjectContext } from "./project-context";
import { buildTemplateDocument } from "./templates";

let overlay: HTMLElement | null = null;
let toastEl: HTMLElement | null = null;

/** Mount (or remount) the Project Manager over the main window. Idempotent. */
export function showProjectManager(): void {
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
  renderLanding(card, host);
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

// H2·A ships the New Project view as a working name + folder + create; the live
// folder-name preview and the three template cards are added in H2·B.
function renderNewForm(card: HTMLElement, host: ManagerHost): void {
  clearToast();
  card.innerHTML = "";
  card.appendChild(header());

  const template: TemplateId = "starter";
  const state = { parentDir: null as string | null };

  const nameInput = h("input", {
    class: "pm-input",
    type: "text",
    placeholder: "My Awesome Game",
    maxlength: "80",
  }) as HTMLInputElement;

  const folderPath = h("span", { class: "pm-folder-path" }, "No folder chosen yet");
  const err = h("div", { class: "pm-error", hidden: "" });
  const setErr = (msg: string) => {
    err.textContent = msg;
    err.hidden = !msg;
  };

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
        void createProject(name, state.parentDir, template, host, setErr);
      },
    },
    "Make my game",
  );

  card.appendChild(
    h(
      "div",
      { class: "pm-form" },
      labeled("What's your game called?", nameInput),
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
  let list: Recent[];
  try {
    list = await host.recentsList();
  } catch {
    list = [];
  }
  if (!list.length) {
    container.appendChild(h("div", { class: "pm-recents-empty" }, "No games yet. Make one to see it here."));
    return;
  }
  for (const r of list) {
    container.appendChild(
      h(
        "button",
        { class: "pm-recent", type: "button", title: r.path, onclick: () => openTarget(r.path, host) },
        h("span", { class: "pm-recent-name" }, r.name || leafOf(r.path)),
        h("span", { class: "pm-recent-path" }, r.path),
      ),
    );
  }
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
