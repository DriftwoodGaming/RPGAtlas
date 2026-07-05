/* RPGAtlas — src/engine/scenes/input-scenes.ts
   Project Compass M2·B: the three RPG Maker player-input scenes that live
   alongside Show Text — Input Number (103), Select Item (104), and Name Input
   (303). Each is a self-contained UI-stack scene that resolves a value the
   interpreter command handler stores (a variable, or the actor's name), so it
   plugs into the same await-a-scene seam the message system uses.

   They are driven entirely through the named-action input system (UIStack
   onKey), so keyboard and gamepad both work — no raw key capture, matching the
   rest of the in-game UI. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets } from "../../shared/deps.js";
import { el, esc, sysSe } from "../util.js";
import { pushUI, removeUI, showList } from "../ui-stack.js";
import { ctx } from "../state/engine-context.js";
import { G } from "../state/game-state.js";

const clampi = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------------------
// Input Number (RM 103) — a fixed-width column of digits the player dials in.
// Up/Down change the selected digit, Left/Right move columns, OK confirms.
// ---------------------------------------------------------------------------
export function numberInputScene(digits: number, initial: number): Promise<number> {
  const n = clampi(Math.floor(digits) || 1, 1, 8);
  return new Promise((resolve) => {
    if (typeof document === "undefined" || !ctx.uiLayer) { resolve(0); return; }
    const max = Math.pow(10, n) - 1;
    const cells: number[] = [];
    const v = clampi(Math.floor(initial) || 0, 0, max);
    for (let i = n - 1; i >= 0; i--) cells[i] = Math.floor(v / Math.pow(10, n - 1 - i)) % 10;
    let sel = n - 1; // start on the least-significant digit, like RM

    const win = el("div", "win numinputwin");
    win.appendChild(el("div", "win-title", "Enter a number"));
    const rowEl = el("div", "numrow");
    win.appendChild(rowEl);
    win.appendChild(el("div", "win-help", "◄ ► pick a digit · ▲ ▼ change it · OK to confirm"));

    function redraw() {
      rowEl.innerHTML = "";
      for (let i = 0; i < n; i++) {
        rowEl.appendChild(el("span", "numcell" + (i === sel ? " sel" : ""), String(cells[i])));
      }
    }
    function value(): number { return cells.reduce((a, d) => a * 10 + d, 0); }
    function finish() { removeUI(ui); resolve(value()); }

    const ui = {
      el: win,
      onKey(k: string) {
        if (k === "up") { cells[sel] = (cells[sel] + 1) % 10; sysSe("cursor"); redraw(); }
        else if (k === "down") { cells[sel] = (cells[sel] + 9) % 10; sysSe("cursor"); redraw(); }
        else if (k === "left") { sel = (sel - 1 + n) % n; sysSe("cursor"); redraw(); }
        else if (k === "right") { sel = (sel + 1) % n; sysSe("cursor"); redraw(); }
        else if (k === "ok" || k === "cancel") { sysSe("ok"); finish(); }
      },
    };
    redraw();
    ctx.uiLayer.appendChild(win);
    pushUI(ui);
  });
}

// ---------------------------------------------------------------------------
// Select Item (RM 104) — pick one of the party's regular items. Returns the
// chosen item id, or 0 when there is nothing to pick / the player cancels.
// (RM's category param is preserved on the command but Atlas has one item bag.)
// ---------------------------------------------------------------------------
export async function selectItemScene(): Promise<number> {
  const bag = G.inv.item || {};
  const owned = Object.keys(bag)
    .map((id) => ({ id: Number(id), count: bag[id] }))
    .filter((e) => e.count > 0)
    .map((e) => ({ e, def: (ctx.proj.items || []).find((it: any) => it.id === e.id) }))
    .filter((x) => !!x.def);

  if (!owned.length) {
    // Nothing to choose — show a friendly, dismissable empty list (returns 0).
    await showList([{ label: "(no items)", disabled: true }], { title: "Select an item", className: "selitemwin" });
    return 0;
  }
  const items = owned.map(({ e, def }) => ({
    html: Assets.iconHtml(def.icon, "menu-icon") + esc(def.name) +
      (e.count > 1 ? " <span class='cnt'>×" + e.count + "</span>" : ""),
    help: def.desc || "",
  }));
  const idx = await showList(items, { title: "Select an item", className: "selitemwin", cancellable: true });
  return idx >= 0 ? owned[idx].e.id : 0;
}

// ---------------------------------------------------------------------------
// Name Input (RM 303) — an on-screen keyboard so the player renames an actor.
// All navigation is through named actions (works on pad + keyboard). Returns
// the typed name (empty string keeps the current name; the caller decides).
// ---------------------------------------------------------------------------
const KEY_ROWS: string[][] = [
  "ABCDEFGHIJKLM".split(""),
  "NOPQRSTUVWXYZ".split(""),
  "abcdefghijklm".split(""),
  "nopqrstuvwxyz".split(""),
  "0123456789 -.".split(""),
];
const CTRL_ROW = [{ a: "back", l: "⌫ Back" }, { a: "ok", l: "✓ OK" }];

export function nameInputScene(initialName: string, maxChars: number): Promise<string> {
  const cap = clampi(Math.floor(maxChars) || 1, 1, 16);
  return new Promise((resolve) => {
    if (typeof document === "undefined" || !ctx.uiLayer) { resolve(""); return; }
    let name = String(initialName || "").slice(0, cap);
    let r = 0, c = 0; // grid cursor: rows 0..KEY_ROWS.length (last = control row)
    const ctrlRowIdx = KEY_ROWS.length;

    const win = el("div", "win nameinputwin");
    win.appendChild(el("div", "win-title", "Enter a name"));
    const nameEl = el("div", "name-field");
    win.appendChild(nameEl);
    const gridEl = el("div", "name-grid");
    win.appendChild(gridEl);
    win.appendChild(el("div", "win-help", "Arrows to move · OK to type · Cancel to erase"));

    function rowLen(row: number): number { return row === ctrlRowIdx ? CTRL_ROW.length : KEY_ROWS[row].length; }
    function redraw() {
      nameEl.textContent = name + "_";
      gridEl.innerHTML = "";
      KEY_ROWS.forEach((row, ri) => {
        const rEl = el("div", "name-row");
        row.forEach((ch, ci) => {
          rEl.appendChild(el("span", "name-key" + (ri === r && ci === c ? " sel" : ""), ch === " " ? "␣" : ch));
        });
        gridEl.appendChild(rEl);
      });
      const cEl = el("div", "name-row name-ctrl");
      CTRL_ROW.forEach((k, ci) => {
        cEl.appendChild(el("span", "name-key wide" + (r === ctrlRowIdx && ci === c ? " sel" : ""), k.l));
      });
      gridEl.appendChild(cEl);
    }
    function finish() { removeUI(ui); resolve(name); }
    function activate() {
      if (r === ctrlRowIdx) {
        const k = CTRL_ROW[c];
        if (k.a === "ok") { sysSe("ok"); finish(); return; }
        if (k.a === "back") { name = name.slice(0, -1); sysSe("cancel"); redraw(); return; }
      } else {
        const ch = KEY_ROWS[r][c];
        if (name.length < cap) { name += ch; sysSe("ok"); }
        else sysSe("buzzer");
        redraw();
      }
    }

    const ui = {
      el: win,
      onKey(k: string) {
        if (k === "up") { r = (r - 1 + (ctrlRowIdx + 1)) % (ctrlRowIdx + 1); c = Math.min(c, rowLen(r) - 1); sysSe("cursor"); redraw(); }
        else if (k === "down") { r = (r + 1) % (ctrlRowIdx + 1); c = Math.min(c, rowLen(r) - 1); sysSe("cursor"); redraw(); }
        else if (k === "left") { c = (c - 1 + rowLen(r)) % rowLen(r); sysSe("cursor"); redraw(); }
        else if (k === "right") { c = (c + 1) % rowLen(r); sysSe("cursor"); redraw(); }
        else if (k === "ok") activate();
        else if (k === "cancel") { name = name.slice(0, -1); sysSe("cancel"); redraw(); }
      },
    };
    redraw();
    ctx.uiLayer.appendChild(win);
    pushUI(ui);
  });
}
