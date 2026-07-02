/* RPGAtlas — src/editor/event-editor/event-editor.ts
   The full event editor modal: page tabs (rename/reorder/copy/paste), the
   three-pane IDE (conditions/appearance/behaviour · command list · inspector),
   per-page command undo/redo, and OK/Cancel commit of the working clone.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 2):
   logic unchanged, closure vars routed through editor-state.ts. The header
   event glyph (ICONS.event) is imported directly from icons.ts (Package 3);
   the editorHooks.eventIcon slot it used to read through is dissolved.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, DataDefaults, RA, t, editorState as S } from "../editor-state";
import { ICONS } from "../icons";
import {
  h, tIn, sel, chk, nIn, esc,
  dbOpts, switchOpts, varOpts, cmpOpts, charsetOpts, DIR_OPTS, stringSelOpts,
} from "../dom";
import { modalRoot, modal, confirmBox } from "../modals";
import { touch } from "../persistence";
import { renderMap } from "../map-editor/map-render";
import { pushUndo } from "../map-editor/history";
import { flashStatus } from "../map-editor/status";
import { cmdListWidget } from "./command-list";
import { mountForm } from "./command-defs";

  // ============================ event editor ============================
  // onCommitNew (optional): for a brand-new, not-yet-inserted event, called on OK after the edited
  // clone is written back — inserts it into the map. Omitted when editing an existing event.
  export function openEventEditor(evOriginal: any, onCommitNew?: any) {
    const ev = RA.clone(evOriginal);
    let pageIdx = 0;

    // Per-page command undo/redo, keyed by page object; discarded with `ev` when the editor closes.
    const cmdHist = new Map();                 // page -> { undo, redo }
    function histFor(p: any): any {
      let hst = cmdHist.get(p);
      if (!hst) { hst = { undo: [], redo: [] }; cmdHist.set(p, hst); }
      return hst;
    }
    const curPage = () => ev.pages[pageIdx];
    function cmdSnapshot() {                    // call before mutating the current page's commands
      const hst = histFor(curPage());
      hst.undo.push(RA.clone(curPage().commands));
      if (hst.undo.length > 60) hst.undo.shift();
      hst.redo.length = 0;
    }
    function cmdStep(from: any, to: any) {
      const hst = histFor(curPage());
      if (!hst[from].length) { flashStatus(from === "undo" ? "Nothing to undo" : "Nothing to redo"); return false; }
      hst[to].push(RA.clone(curPage().commands));
      curPage().commands = RA.clone(hst[from].pop());   // re-clone so the archived entry stays immutable
      touch();
      return true;
    }
    const undoApi = {
      snapshot: cmdSnapshot,
      undo: () => cmdStep("undo", "redo"),
      redo: () => cmdStep("redo", "undo"),
    };
    // Editor-wide keys (selection ≠ focus): Ctrl+Z/Y/Shift+Z undo/redo commands, Delete removes
    // the highlighted page (the command list handles its own Delete), and 1–9 jump to a page.
    // Defers to native field editing; inert while a nested Add/Edit dialog is the topmost modal.
    let evOverlay: any = null;
    function onEvKey(e: any) {
      if (modalRoot().lastElementChild !== evOverlay) return;
      if (pageMenuEl) return;                    // a page context menu is open — let it own the keys
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      const inCmdList = t && t.closest && t.closest(".cmdlist");   // the command list owns its own Delete/keys
      if (e.ctrlKey || e.metaKey) {
        if (e.code === "KeyZ" && e.shiftKey) { e.preventDefault(); if (undoApi.redo()) redrawPage(); }
        else if (e.code === "KeyZ") { e.preventDefault(); if (undoApi.undo()) redrawPage(); }
        else if (e.code === "KeyY") { e.preventDefault(); if (undoApi.redo()) redrawPage(); }
        return;
      }
      if (e.code === "Delete" && !inCmdList) {
        e.preventDefault(); deletePage(pageIdx); return;
      }
      if (e.key >= "1" && e.key <= "9" && !inCmdList) {   // jump to page 1–9 if it exists
        const p = +e.key - 1;
        if (p < ev.pages.length) { e.preventDefault(); pageIdx = p; redrawTabs(); redrawPage(); }
      }
    }
    document.addEventListener("keydown", onEvKey);

    const head = h("div", { class: "event-head" });
    const tabs = h("div", { class: "tabs" });
    const pageBox = h("div", { class: "event-pagebox" });

    function deletePage(i: any) {
      if (ev.pages.length <= 1) return;
      const del = () => {
        ev.pages.splice(i, 1);
        if (pageIdx > i) pageIdx--;
        pageIdx = Math.min(pageIdx, ev.pages.length - 1);
        redrawTabs(); redrawPage();
      };
      const n = ev.pages[i].commands.length;   // confirm only if there are commands to lose (can't be undone)
      if (n) confirmBox("This page has " + n + " command" + (n === 1 ? "" : "s") + " that will be permanently lost. Delete this page?", del);
      else del();
    }
    function addPageAt(i: any) { ev.pages.splice(i, 0, DataDefaults.newPage()); pageIdx = i; redrawTabs(); redrawPage(); }
    function copyPage(i: any) { S.clipPage = RA.clone(ev.pages[i]); flashStatus("Copied page " + (i + 1)); }
    function pastePage(i: any) { if (!S.clipPage) return; ev.pages.splice(i + 1, 0, RA.clone(S.clipPage)); pageIdx = i + 1; redrawTabs(); redrawPage(); }
    function movePage(i: any, d: any) {
      const j = i + d;
      if (j < 0 || j >= ev.pages.length) return;
      ev.pages.splice(j, 0, ev.pages.splice(i, 1)[0]);
      pageIdx = j; redrawTabs(); redrawPage();
    }

    // Page tabs: rename (double-click or menu), right-click menu, and drag-reorder.
    let pageMenuEl: any = null, dragPageFrom: any = null, editingPage: any = null;
    function startRename(i: any) { editingPage = i; redrawTabs(); }
    function commitRename(i: any, value: any) { ev.pages[i].name = value.trim(); editingPage = null; touch(); redrawTabs(); redrawPage(); }
    function closePageMenu() {
      if (!pageMenuEl) return;
      pageMenuEl.remove(); pageMenuEl = null;
      document.removeEventListener("mousedown", onPageMenuOutside, true);
      document.removeEventListener("keydown", onPageMenuKey, true);
    }
    function onPageMenuOutside(e: any) { if (pageMenuEl && !pageMenuEl.contains(e.target)) closePageMenu(); }
    function onPageMenuKey(e: any) { if (e.key === "Escape") { e.preventDefault(); closePageMenu(); } }
    function openPageMenu(e: any, i: any) {
      e.preventDefault();
      const x = e.clientX, y = e.clientY, last = ev.pages.length - 1;
      pageIdx = i; redrawTabs(); redrawPage();   // right-click selects the tab first
      closePageMenu();
      const menu = h("div", { class: "menu-drop" });
      const item = (label: any, on: any, fn: any) => menu.appendChild(h("div", {
        class: "menu-item" + (on ? "" : " disabled"),
        onclick() { if (!on) return; closePageMenu(); fn(); },
      }, h("span", { class: "mi-label" }, label)));
      const sep = () => menu.appendChild(h("div", { class: "menu-sep" }));
      item("Add page", true, () => addPageAt(i + 1));   // to the right, like Paste
      item("Rename", true, () => startRename(i));
      item("Move left", i > 0, () => movePage(i, -1));
      item("Move right", i < last, () => movePage(i, 1));
      sep();
      item("Copy", true, () => copyPage(i));
      item("Paste", !!S.clipPage, () => pastePage(i));
      item("Delete", ev.pages.length > 1, () => deletePage(i));
      document.body.appendChild(menu);
      menu.style.left = Math.max(4, Math.min(x, window.innerWidth - menu.offsetWidth - 4)) + "px";
      menu.style.top = Math.max(4, Math.min(y, window.innerHeight - menu.offsetHeight - 4)) + "px";
      pageMenuEl = menu;
      document.addEventListener("mousedown", onPageMenuOutside, true);
      document.addEventListener("keydown", onPageMenuKey, true);
    }
    function clearTabDrops() { tabs.querySelectorAll(".drop-left, .drop-right").forEach((b: any) => b.classList.remove("drop-left", "drop-right")); }
    function redrawTabs() {
      tabs.innerHTML = "";
      tabs.appendChild(h("button", { class: "mini tab-add", title: "Add a page", onclick() { ev.pages.push(DataDefaults.newPage()); pageIdx = ev.pages.length - 1; redrawTabs(); redrawPage(); } }, "+"));
      ev.pages.forEach((_: any, i: any) => {
        if (editingPage === i) {                  // inline rename: an input replaces the tab button
          const inp = h("input", { class: "tab-rename", value: ev.pages[i].name || "",
            onkeydown(e: any) {
              if (e.key === "Enter") { e.preventDefault(); commitRename(i, inp.value); }
              else if (e.key === "Escape") { e.preventDefault(); editingPage = null; redrawTabs(); }
            },
            onblur() { if (editingPage === i) commitRename(i, inp.value); },
          });
          tabs.appendChild(inp);
          setTimeout(() => { inp.focus(); inp.select(); }, 0);
          return;
        }
        const btn = h("button", {
          class: i === pageIdx ? "sel" : "",
          onclick() { pageIdx = i; redrawTabs(); redrawPage(); },
          ondblclick() { startRename(i); },
          oncontextmenu(e: any) { openPageMenu(e, i); },
        }, ev.pages[i].name || ("Page " + (i + 1)));
        btn.draggable = true;
        btn.addEventListener("dragstart", (e: any) => { dragPageFrom = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "page"); btn.classList.add("dragging"); });
        btn.addEventListener("dragend", () => { btn.classList.remove("dragging"); clearTabDrops(); dragPageFrom = null; });
        btn.addEventListener("dragover", (e: any) => {
          if (dragPageFrom === null || dragPageFrom === i) return;
          e.preventDefault(); e.dataTransfer.dropEffect = "move"; clearTabDrops();
          const r = btn.getBoundingClientRect();
          btn.classList.add(e.clientX - r.left < r.width / 2 ? "drop-left" : "drop-right");
        });
        btn.addEventListener("dragleave", () => btn.classList.remove("drop-left", "drop-right"));
        btn.addEventListener("drop", (e: any) => {
          if (dragPageFrom === null || dragPageFrom === i) return;
          e.preventDefault();
          const r = btn.getBoundingClientRect();
          let to = e.clientX - r.left < r.width / 2 ? i : i + 1;
          const from = dragPageFrom; dragPageFrom = null; clearTabDrops();
          if (from < to) to--;                   // the removed page shifts later indices down
          ev.pages.splice(to, 0, ev.pages.splice(from, 1)[0]);
          pageIdx = to; redrawTabs(); redrawPage();
        });
        tabs.appendChild(btn);
      });
    }
    function redrawPage() {
      const pg = ev.pages[pageIdx];
      pageBox.innerHTML = "";
      // ---- right pane: live inspector (Show Text inline; placeholder otherwise) ----
      const inspector = h("div", { class: "event-inspector" });
      let mountedCmd: any = null, dirtySinceMount = false, selfCommitting = false;
      // eslint-disable-next-line prefer-const -- assigned later (after `commit` closes over it); kept `let` verbatim
      let cw: any;   // command-list widget, assigned below; inline commits trigger cw.redraw()
      function showPlaceholder() {
        mountedCmd = null;
        inspector.innerHTML = "";
        inspector.appendChild(h("div", { class: "ev-insp-empty" },
          t("Select a command to edit here, or double-click any command to edit in the dialog.")));
      }
      function mountInspector(c: any) {
        mountedCmd = c; dirtySinceMount = false;
        inspector.innerHTML = "";
        const formBox = h("div", { class: "ev-insp-form" });
        const apply = mountForm(c, formBox);   // reuse the command's own form builder verbatim
        inspector.appendChild(formBox);
        if (!formBox.childNodes.length)        // no-parameter commands (erase/save/gameover/totitle)
          formBox.appendChild(h("div", { class: "ev-insp-empty" }, t("This command has no parameters.")));
        if (c.t === "choices" || c.t === "if") // nested branches are authored in the command tree, not here
          inspector.appendChild(h("div", { class: "ev-insp-hint" }, t("Branch contents are edited in the command list.")));
        function commit() {
          if (!dirtySinceMount) { undoApi.snapshot(); dirtySinceMount = true; }  // one undo step per mount
          apply();
          touch();   // explicit: some forms (e.g. the message textarea) don't call touch() themselves
          selfCommitting = true;
          cw.redraw();   // refresh the command's list-row summary (same-identity → no remount)
          selfCommitting = false;
        }
        formBox.addEventListener("input", commit);
        formBox.addEventListener("change", commit);
      }
      // Selection → inspector. Same command during our own inline commit is a no-op (keeps
      // focus); the same command from any OTHER cause (modal edit, undo/redo) force-remounts
      // so the inspector re-reads a fresh working copy and never overwrites external edits.
      function onSelect(cmd: any) {
        if (cmd) {
          if (cmd === mountedCmd && selfCommitting) return;
          mountInspector(cmd);
        } else {
          showPlaceholder();
        }
      }
      showPlaceholder();

      // ---- left pane: Conditions + Appearance + Behaviour (always expanded) ----
      function section(title: any, bodyKids: any, badge?: any) {
        const secHead = h("div", { class: "ev-sec-head" }, h("span", { class: "ev-sec-title" }, t(title)), badge || null);
        return h("div", { class: "ev-section" }, secHead, h("div", { class: "ev-sec-body" }, ...bodyKids));
      }

      // Shared label-left / control-right row, used by Conditions, Appearance, and Behaviour.
      function propRow(label: any, control: any) {
        return h("div", { class: "prop-row" }, h("span", { class: "prop-label" }, t(label)), h("div", { class: "prop-ctrl" }, control));
      }

      const condBadge = h("span", { class: "ev-badge" });
      function refreshConditions() {
        const n = (pg.cond.switchId ? 1 : 0) + (pg.cond.varId ? 1 : 0) + (pg.cond.selfSw ? 1 : 0)
          + (pg.cond.questId ? 1 : 0) + (pg.cond.objectiveQuestId ? 1 : 0);
        condBadge.textContent = n ? n + " active" : "";
        condBadge.style.display = n ? "" : "none";
      }
      // Quest objective condition: the objective dropdown depends on the chosen quest, so it
      // rebuilds whenever the objective-quest selection changes (preserved from the quest system).
      const objWrap = h("div", { class: "prop-ctrl" });
      function redrawObjectiveList() {
        const q = RA.byId(S.proj.quests, pg.cond.objectiveQuestId);
        const opts = [{ v: 0, l: "(none)" }].concat(((q && q.objectives) || []).map((obj: any, i: any) => ({ v: i, l: (i + 1) + ": " + (obj.label || obj.kind || "Objective") })));
        objWrap.innerHTML = "";
        objWrap.appendChild(sel(pg.cond, "objectiveIndex", opts));
      }
      redrawObjectiveList();
      const condSection = section("Conditions", [
        h("div", { class: "prop-rows" },
          propRow("Switch", sel(pg.cond, "switchId", switchOpts(), refreshConditions)),
          propRow("Variable", h("div", { class: "cond-var" },
            sel(pg.cond, "varId", varOpts(), refreshConditions),
            sel(pg.cond, "cmp", cmpOpts(), refreshConditions),
            nIn(pg.cond, "varVal"))),
          propRow("Self-Switch", sel(pg.cond, "selfSw",
            [{ v: "", l: "(none)" }, { v: "A", l: "A" }, { v: "B", l: "B" }, { v: "C", l: "C" }, { v: "D", l: "D" }],
            refreshConditions)),
          propRow("Quest", sel(pg.cond, "questId", dbOpts(S.proj.quests, "(none)"), refreshConditions)),
          propRow("Status", sel(pg.cond, "questStatus", stringSelOpts(["inactive", "active", "completed", "failed", "abandoned"]))),
          propRow("Obj. quest", sel(pg.cond, "objectiveQuestId", dbOpts(S.proj.quests, "(none)"),
            () => { refreshConditions(); redrawObjectiveList(); })),
          h("div", { class: "prop-row" }, h("span", { class: "prop-label" }, t("Objective")), objWrap),
          propRow("Obj. is", sel(pg.cond, "objectiveStatus", stringSelOpts(["incomplete", "completed"])))),
      ], condBadge);
      refreshConditions();

      const preview = h("span", { class: "char-preview" });
      function redrawPreview() {
        preview.innerHTML = "";
        const ci = Assets.charsetIndex(pg.charset);
        if (ci >= 0) preview.appendChild(Assets.charFrameCanvas(ci, pg.dir || 0, 1));
      }
      redrawPreview();
      const appSection = section("Appearance", [
        h("div", { class: "appearance-row" },
          h("div", { class: "prop-rows appearance-fields" },
            propRow("Graphic", sel(pg, "charset", charsetOpts(), redrawPreview)),
            propRow("Facing", sel(pg, "dir", DIR_OPTS, redrawPreview))),
          preview),
      ]);
      const behSection = section("Behaviour", [
        h("div", { class: "prop-rows" },
          propRow("Trigger", sel(pg, "trigger", [
            { v: "action", l: "Action button" }, { v: "touch", l: "Player touch" },
            { v: "auto", l: "Autorun" }, { v: "parallel", l: "Parallel" }])),
          propRow("Movement", sel(pg, "moveType", [{ v: "fixed", l: "Fixed" }, { v: "random", l: "Random" }])),
          propRow("Priority", sel(pg, "priority", [{ v: "below", l: "Below player" }, { v: "same", l: "Same as player" }, { v: "above", l: "Above player" }])),
          propRow("Through", chk(pg, "through"))),
      ]);
      pg.combat = Object.assign(RA.defaultActionCombat(), pg.combat || {});
      const combatBadge = h("span", { class: "ev-badge" }, pg.combat.enabled ? "enabled" : "");
      combatBadge.style.display = pg.combat.enabled ? "" : "none";
      const refreshCombatBadge = () => {
        combatBadge.textContent = pg.combat.enabled ? "enabled" : "";
        combatBadge.style.display = pg.combat.enabled ? "" : "none";
      };
      const combatSection = section("Action Combat", [
        h("div", { class: "prop-rows" },
          propRow("Enabled", chk(pg.combat, "enabled")),
          propRow("Enemy", sel(pg.combat, "enemyId", dbOpts(S.proj.enemies, "(none)"))),
          h("div", { class: "subhead" }, "Enemy AI"),
          propRow("AI", sel(pg.combat, "ai", RA.ACTION_COMBAT_AI || [{ v: "none", l: "None" }])),
          propRow("HP override", nIn(pg.combat, "hp", 0, 9999)),
          propRow("Touch damage", nIn(pg.combat, "touchDamage", 0, 999)),
          propRow("Knockback", nIn(pg.combat, "knockbackTiles", 0, 4)),
          propRow("Invuln frames", nIn(pg.combat, "invulnFrames", 0, 180)),
          propRow("Defeat switch", sel(pg.combat, "defeatSelfSwitch",
            [{ v: "", l: "(erase event)" }, { v: "A", l: "Self-Switch A" }, { v: "B", l: "Self-Switch B" }, { v: "C", l: "Self-Switch C" }, { v: "D", l: "Self-Switch D" }])),
          h("div", { class: "dim" },
            "Players use the remappable Attack action to swing. Enemy AI controls extra movement such as chasing; Touch damage controls adjacent strikes. In messages, use \\input[attack] for an input-aware prompt. HP 0 uses the selected enemy's database HP.")),
      ], combatBadge);
      combatSection.addEventListener("change", refreshCombatBadge);

      const left = h("div", { class: "event-ide-col event-ide-left" }, condSection, appSection, behSection, combatSection);

      // ---- center pane: command list ----
      cw = cmdListWidget(() => ev.pages[pageIdx].commands, undoApi, onSelect);
      const center = h("div", { class: "event-ide-col event-ide-center" }, cw.el);

      // ---- right pane: inspector ----
      const right = h("div", { class: "event-ide-col event-ide-right" }, inspector);

      pageBox.appendChild(h("div", { class: "event-ide" }, left, center, right));
    }

    const evIcon = h("span", { class: "event-icon" });
    evIcon.innerHTML = ICONS.event;   // the person glyph used by the Event tool in the main editor
    const closeX = h("button", { class: "event-close", title: t("Close") }, "✕");
    head.appendChild(h("div", { class: "event-topbar" },
      h("div", { class: "event-topbar-id" },
        evIcon,
        tIn(ev, "name", "event-name-input")),
      tabs,
      closeX));
    head.appendChild(pageBox);
    redrawTabs(); redrawPage();

    // Footer: map position pinned far left, OK/Cancel right-aligned like every other dialog.
    const okBtn = h("button", { class: "primary" }, t("OK"));
    const cancelBtn = h("button", null, t("Cancel"));
    const footer = h("div", { class: "modal-btns event-footer" },
      h("div", { class: "ef-left" },
        h("span", { class: "event-pos-foot" },
          h("span", { class: "epf-label" }, t("Map Position:")),
          h("span", { class: "epf-val" }, ev.x + ", " + ev.y))),
      h("div", { class: "ef-right" }, okBtn, cancelBtn));

    const evModal = modal({
      title: "Event — " + esc(evOriginal.name),
      content: head,
      wide: true,
      class: "event-modal",
      dismissable: false,
      onClose() { closePageMenu(); document.removeEventListener("keydown", onEvKey); },
      footer,
    });
    okBtn.onclick = () => {
      pushUndo("Event edit");
      Object.assign(evOriginal, ev);
      if (onCommitNew) onCommitNew(evOriginal);   // new event: insert into the map now (not before)
      touch(); renderMap(); evModal.close();
    };
    cancelBtn.onclick = () => evModal.close();
    evOverlay = evModal.el.parentElement;
    closeX.onclick = () => evModal.close();   // ✕ in the header = Cancel (discard the working clone)
  }
