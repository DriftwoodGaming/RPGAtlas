/* RPGAtlas — src/editor/event-editor/command-list.ts
   The event command-list widget: nested command tree, multi-select, drag-reorder,
   cut/copy/paste, and the right-click command menu.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 2):
   logic unchanged, closure vars routed through editor-state.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars -- dragFromIdx is write-only
   in the original monolith source; preserved verbatim, so keep the dead assign. */

import { RA, t, editorState as S } from "../editor-state";
import { h } from "../dom";
import { touch } from "../persistence";
import { flashStatus } from "../map-editor/status";
import { cmdSummary, editCommand, pickCommand } from "./command-defs";

  // Depth-first walk of a command list (recursing into if/choices branches),
  // calling cb for every command. Shared by the event searcher and map-delete
  // dangling-transfer scan. (Was in the editor.js event-searcher section.)
  export function walkCommands(list: any, cb: any) {
    for (const c of list || []) {
      cb(c);
      if (c.t === "if") { walkCommands(c.then, cb); walkCommands(c.else, cb); }
      else if (c.t === "choices") (c.branches || []).forEach((b: any) => walkCommands(b, cb));
      else if (c.t === "loop") walkCommands(c.body, cb);
      else if (c.t === "battle") { // M3·C battle-result branches
        walkCommands(c.onWin, cb); walkCommands(c.onEscape, cb); walkCommands(c.onLose, cb);
      }
    }
  }

  // ============================ command list widget ============================
  export function buildCmdRows(list: any, depth: any, out: any) {
    list.forEach((c: any, i: any) => {
      out.push({ arr: list, idx: i, cmd: c, depth });
      if (c.t === "if") {
        out.push({ label: "▸ Then", depth: depth });
        buildCmdRows(c.then, depth + 1, out);
        out.push({ arr: c.then, idx: c.then.length, depth: depth + 1, slot: true });
        out.push({ label: "▸ Else", depth: depth });
        buildCmdRows(c.else, depth + 1, out);
        out.push({ arr: c.else, idx: c.else.length, depth: depth + 1, slot: true });
      } else if (c.t === "choices") {
        c.options.forEach((o: any, bi: any) => {
          out.push({ label: "▸ When [" + o + "]", depth });
          buildCmdRows(c.branches[bi], depth + 1, out);
          out.push({ arr: c.branches[bi], idx: c.branches[bi].length, depth: depth + 1, slot: true });
        });
      } else if (c.t === "loop") {
        if (!c.body) c.body = [];
        out.push({ label: "▸ Repeat", depth: depth });
        buildCmdRows(c.body, depth + 1, out);
        out.push({ arr: c.body, idx: c.body.length, depth: depth + 1, slot: true });
      } else if (c.t === "battle") {
        // M3·C: optional result branches (toggled in the Start Battle form).
        for (const [key, lbl] of [["onWin", "If Win"], ["onEscape", "If Escape"], ["onLose", "If Lose"]] as const) {
          if (!c[key]) continue;
          out.push({ label: "▸ " + lbl, depth });
          buildCmdRows(c[key], depth + 1, out);
          out.push({ arr: c[key], idx: c[key].length, depth: depth + 1, slot: true });
        }
      }
    });
  }
  export function cmdListWidget(getList: any, undoApi: any, onSelect?: any) {
    const wrap = h("div", { class: "cmdlist-wrap" });
    const listEl = h("div", { class: "cmdlist", tabindex: "0" });
    const cmdCount = h("span", { class: "ev-cmd-count" });   // lives in the banner; updated in redraw()
    const snap = undoApi.snapshot;             // snapshot before a mutation
    let selRow: any = null, anchorRow: any = null, rows: any[] = [], dragFromIdx: any = null, cmdMenuEl: any = null;
    let dragBlock: any = null, dragFromArr: any = null, dragFrom = 0, dragCount = 0;
    function clearDropMarks() {
      listEl.querySelectorAll(".drop-before, .drop-after").forEach((d: any) => d.classList.remove("drop-before", "drop-after"));
    }
    // True when `arr` is one of cmd's own branch arrays, or nested inside one —
    // so a container command (if/choices) is never dropped into its own subtree.
    function ownsArray(cmd: any, arr: any) {
      if (!cmd) return false;
      const branches = cmd.t === "if" ? [cmd.then, cmd.else]
        : cmd.t === "choices" ? (cmd.branches || [])
        : cmd.t === "loop" ? [cmd.body || []]
        : cmd.t === "battle" ? [cmd.onWin, cmd.onEscape, cmd.onLose].filter(Boolean) : [];
      for (const b of branches) {
        if (b === arr) return true;
        for (const c of b) if (ownsArray(c, arr)) return true;
      }
      return false;
    }
    // A command may be dropped onto any command row or end-of-branch slot, at any
    // nesting level in this event — except onto itself or inside its own subtree.
    function dropOk(target: any) {
      if (!dragBlock) return false;
      if (!target.arr || !(target.cmd || target.slot)) return false;
      if (dragBlock.includes(target.cmd)) return false;            // not onto a member of the dragged block
      return !dragBlock.some((c: any) => ownsArray(c, target.arr));     // not into any block member's own subtree
    }
    function redraw(reselect?: any) {
      rows = [];
      buildCmdRows(getList(), 0, rows);
      rows.push({ arr: getList(), idx: getList().length, depth: 0, slot: true });
      if (reselect) { // re-find the moved/pasted command(s) by identity so the selection follows them
        const cmds = Array.isArray(reselect) ? reselect : [reselect];
        let first = -1, last = -1;
        rows.forEach((r3, i) => { if (r3.cmd && cmds.indexOf(r3.cmd) >= 0) { if (first < 0) first = i; last = i; } });
        if (first >= 0) { anchorRow = first; selRow = last; } // focus = last → repeated paste/move stacks
      }
      listEl.innerHTML = "";
      const blk = selBlock(); // the contiguous multi-selection (or the single focused command)
      rows.forEach((r2, i) => {
        const inBlk = blk && r2.cmd && r2.arr === blk.arr && r2.idx >= blk.lo && r2.idx <= blk.hi;
        const div = h("div", {
          class: "cmdrow" + (r2.label ? " branch" : "") + (r2.slot ? " slot" : "")
            + (i === selRow ? " sel" : (inBlk ? " cmd-selected" : "")),
          style: "padding-left:" + (8 + r2.depth * 18) + "px",
          onclick(e: any) {
            if (e.shiftKey && anchorRow != null && rows[anchorRow] && r2.cmd && r2.arr === rows[anchorRow].arr)
              selRow = i;                    // extend the range within one sibling list
            else anchorRow = selRow = i;     // plain click / re-anchor (foreign branch, label, slot, ctrl)
            redraw(); listEl.focus({ preventScroll: true });
          },
          ondblclick() { anchorRow = selRow = i; if (r2.slot) addAt(r2); else if (r2.cmd) editAt(r2); },
          oncontextmenu(e: any) { openCmdMenu(e, i); },
        }, r2.label ? r2.label : r2.slot ? "◇ " + t("Add command…") : "◆ " + cmdSummary(r2.cmd));
        if (r2.cmd) {
          div.draggable = true;
          div.addEventListener("dragstart", (e: any) => {
            const b = selBlock();
            const inB = b && r2.arr === b.arr && r2.idx >= b.lo && r2.idx <= b.hi;
            if (inB) { dragBlock = b.cmds; dragFromArr = b.arr; dragFrom = b.lo; dragCount = b.count; }
            else { anchorRow = selRow = i; dragBlock = [r2.cmd]; dragFromArr = r2.arr; dragFrom = r2.idx; dragCount = 1; }
            dragFromIdx = i;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", "cmd"); // Firefox needs data to start a drag
            div.classList.add("dragging");
          });
          div.addEventListener("dragend", () => { div.classList.remove("dragging"); clearDropMarks(); dragFromIdx = null; dragBlock = null; });
        }
        div.addEventListener("dragover", (e: any) => {
          if (!dropOk(r2)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          clearDropMarks();
          if (r2.slot) { div.classList.add("drop-before"); return; } // slot = drop at end of level
          const rect = div.getBoundingClientRect();
          div.classList.add(e.clientY - rect.top < rect.height / 2 ? "drop-before" : "drop-after");
        });
        div.addEventListener("dragleave", () => div.classList.remove("drop-before", "drop-after"));
        div.addEventListener("drop", (e: any) => {
          if (!dropOk(r2)) return;
          e.preventDefault();
          const toArr = r2.arr;
          let to = r2.idx; // slot => end of branch (idx == length)
          if (!r2.slot) {
            const rect = div.getBoundingClientRect();
            to = e.clientY - rect.top < rect.height / 2 ? r2.idx : r2.idx + 1;
          }
          clearDropMarks();
          if (dragFromArr === toArr && to >= dragFrom && to <= dragFrom + dragCount) { dragBlock = null; dragFromIdx = null; return; } // lands inside itself
          snap();
          dragFromArr.splice(dragFrom, dragCount);
          if (dragFromArr === toArr && to > dragFrom) to -= dragCount; // adjust for the gap we just removed
          toArr.splice(to, 0, ...dragBlock);
          const moved = dragBlock; dragBlock = null; dragFromIdx = null;
          touch(); redraw(moved); // keep the moved block selected
        });
        listEl.appendChild(div);
      });
      // One notification site for the inspector: report the single focused command
      // (or null for none/multi-select/label/slot). Every selection change that should
      // update the inspector funnels through redraw(); ondblclick/dragstart are the two
      // deliberate exceptions that settle on the next redraw.
      cmdCount.textContent = "(" + getList().length + ")";
      if (onSelect) { const b = selBlock(); onSelect(b && b.count === 1 ? b.cmds[0] : null); }
    }
    function cur() { return selRow != null ? rows[selRow] : null; }
    // The current selection as a contiguous block within ONE sibling array: the run between
    // anchorRow and the focused row, or just the focused command. Null if nothing usable is selected.
    function selBlock() {
      const a = rows[anchorRow], f = cur();
      if (a && f && a.cmd && f.cmd && a.arr === f.arr) {
        const arr = a.arr, lo = Math.min(a.idx, f.idx), hi = Math.max(a.idx, f.idx);
        return { arr, lo, hi, count: hi - lo + 1, cmds: arr.slice(lo, hi + 1) };
      }
      return (f && f.cmd) ? { arr: f.arr, lo: f.idx, hi: f.idx, count: 1, cmds: [f.cmd] } : null;
    }
    function addAt(r2?: any) {
      let target = r2 || cur();
      if (!target || (!target.slot && !target.cmd)) target = { arr: getList(), idx: getList().length };
      pickCommand((nc: any) => {
        // Edit the new command in its own dialog FIRST; only insert it on OK, so Cancel adds nothing.
        editCommand(nc, () => {
          snap();                                   // snapshot pre-insertion state (one clean "add" undo step)
          target.arr.splice(target.idx, 0, nc);
          touch();
          redraw(nc);
          listEl.focus({ preventScroll: true });    // so Delete works immediately on the new row
        }, true, null, () => {});                    // skipSnapshot + no-op Cancel: nothing happens unless OK
      });
    }
    function editAt(r2?: any) {
      const target = r2 || cur();
      if (!target || !target.cmd) return;
      editCommand(target.cmd, redraw, false, snap);   // edit path snapshots on OK (before apply)
    }
    function delAt() {
      const b = selBlock();
      if (!b) return;
      snap();
      b.arr.splice(b.lo, b.count);
      touch();
      const survivor = b.arr.length ? b.arr[Math.min(b.lo, b.arr.length - 1)] : null;
      anchorRow = selRow = null;
      redraw(survivor || undefined);
    }
    function moveSel(d: any) {
      const b = selBlock();
      if (!b) return;
      if (d < 0 && b.lo <= 0) return;
      if (d > 0 && b.hi >= b.arr.length - 1) return;
      snap();
      const blk = b.arr.splice(b.lo, b.count);
      b.arr.splice(b.lo + d, 0, ...blk);
      touch();
      redraw(blk); // the whole block follows so ↑/↓ can be tapped repeatedly
    }
    function copySel(cut: any) {
      const b = selBlock();
      if (!b) return;
      S.clipCmd = b.cmds.map((c: any) => RA.clone(c));
      flashStatus((cut ? "Cut " : "Copied ") + b.count + (b.count > 1 ? " commands" : " command"));
      if (cut) {
        snap();
        b.arr.splice(b.lo, b.count);
        touch();
        const survivor = b.arr.length ? b.arr[Math.min(b.lo, b.arr.length - 1)] : null;
        anchorRow = selRow = null;
        redraw(survivor || undefined);
      }
    }
    function pasteSel() {
      const block = Array.isArray(S.clipCmd) ? S.clipCmd : (S.clipCmd ? [S.clipCmd] : null);
      if (!block || !block.length) { flashStatus("Clipboard is empty — copy a command first"); return; }
      const target = cur();
      let arr, idx;
      if (target && target.cmd) { arr = target.arr; idx = target.idx + 1; }   // after the focused command
      else if (target && target.slot) { arr = target.arr; idx = target.idx; } // at the insertion slot
      else { arr = getList(); idx = getList().length; }                       // nothing selected → end of list
      const clones = block.map((c: any) => RA.clone(c));
      snap();
      arr.splice(idx, 0, ...clones);
      touch(); redraw(clones); // select the pasted block so repeated Ctrl+V stacks
    }
    function closeCmdMenu() {
      if (!cmdMenuEl) return;
      cmdMenuEl.remove(); cmdMenuEl = null;
      document.removeEventListener("mousedown", onCmdMenuOutside, true);
      document.removeEventListener("keydown", onCmdMenuKey, true);
    }
    function onCmdMenuOutside(ev: any) { if (cmdMenuEl && !cmdMenuEl.contains(ev.target)) closeCmdMenu(); }
    function onCmdMenuKey(ev: any) { if (ev.key === "Escape") { ev.preventDefault(); closeCmdMenu(); } }
    // Right-click a command (or insertion slot) for the same actions as the toolbar buttons.
    function openCmdMenu(e: any, i: any) {
      e.preventDefault();
      if (!rows[i] || (!rows[i].cmd && !rows[i].slot)) return; // labels: just suppress the native menu
      const x = e.clientX, y = e.clientY;
      const b0 = selBlock(); // keep an existing multi-selection if the right-click lands inside it
      const inBlk = b0 && rows[i].cmd && rows[i].arr === b0.arr && rows[i].idx >= b0.lo && rows[i].idx <= b0.hi;
      if (!inBlk) anchorRow = selRow = i;
      redraw(); listEl.focus({ preventScroll: true });
      closeCmdMenu();
      const b = selBlock(), isCmd = !!b, n = b ? b.count : 0, sfx = n > 1 ? " " + n : "";
      const canPaste = Array.isArray(S.clipCmd) ? S.clipCmd.length > 0 : !!S.clipCmd;
      const canUp = !!b && b.lo > 0, canDown = !!b && b.hi < b.arr.length - 1;
      const menu = h("div", { class: "menu-drop" });
      const item = (label: any, key: any, on: any, fn: any) => menu.appendChild(h("div", {
        class: "menu-item" + (on ? "" : " disabled"),
        onclick() { if (!on) return; closeCmdMenu(); fn(); },
      }, h("span", { class: "mi-label" }, label), key ? h("span", { class: "mi-key" }, key) : null));
      const sep = () => menu.appendChild(h("div", { class: "menu-sep" }));
      item("Add…", "", true, () => addAt());
      item("Edit", "", isCmd, () => editAt());
      sep();
      item("Cut" + sfx, "Ctrl+X", isCmd, () => copySel(true));
      item("Copy" + sfx, "Ctrl+C", isCmd, () => copySel(false));
      item("Paste", "Ctrl+V", canPaste, () => pasteSel());
      item("Delete" + sfx, "", isCmd, () => delAt());
      sep();
      item("Move Up", "", canUp, () => moveSel(-1));
      item("Move Down", "", canDown, () => moveSel(1));
      menu.style.left = x + "px"; menu.style.top = y + "px";
      document.body.appendChild(menu);
      menu.style.left = Math.max(4, Math.min(x, window.innerWidth - menu.offsetWidth - 4)) + "px";
      menu.style.top = Math.max(4, Math.min(y, window.innerHeight - menu.offsetHeight - 4)) + "px";
      cmdMenuEl = menu;
      document.addEventListener("mousedown", onCmdMenuOutside, true);
      document.addEventListener("keydown", onCmdMenuKey, true);
    }
    // Banner: "Commands N" on the left, actions on the right. Copy/Cut/Paste/move keep working
    // via Ctrl+C/X/V, drag-reorder, and the right-click menu — they just lost their buttons.
    const btns = h("div", { class: "cmdbtns" },
      h("div", { class: "cmdbanner-title" }, h("span", null, t("Commands")), cmdCount),
      h("div", { class: "cmdbtns-actions" },
        h("button", { onclick: () => addAt() }, "+ Add"),
        h("button", { onclick: () => editAt() }, "Edit"),
        h("button", { onclick: delAt }, "Delete")),
    );
    // Ctrl+C/X/V and Delete work when the command list has focus. The global editor shortcuts
    // are suppressed while a modal is open, so there's no collision with map copy/paste.
    listEl.addEventListener("keydown", (e: any) => {
      if (e.code === "Delete") { e.preventDefault(); delAt(); return; }
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.code === "KeyC") { e.preventDefault(); copySel(false); }
      else if (e.code === "KeyX") { e.preventDefault(); copySel(true); }
      else if (e.code === "KeyV") { e.preventDefault(); pasteSel(); }
    });
    wrap.appendChild(btns);
    wrap.appendChild(listEl);
    redraw();
    return { el: wrap, redraw };
  }
