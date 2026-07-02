/* RPGAtlas — src/engine/ui-stack.ts
   The in-game UI stack and the generic selectable-list window, extracted
   verbatim from the js/engine.js monolith (Phase 1 Stage B). UIStack holds the
   open UI layers (menus, prompts); the input system routes key presses to the
   top layer's onKey. showList builds the reusable list/menu/slider window used
   by every in-game menu, shop, battle picker, options screen, etc.

   These reach the game's UI root (uiLayer, set at boot) through a provider the
   engine installs via initUiStack(), rather than the old shared closure.
   Logic — hover/click/drag handling, value rows, sliders, cyclers, keyboard
   nav — is unchanged. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { el, esc, sysSe } from "./util.js";

/** Open UI layers, top of stack = focused. Input routes presses to the top. */
export const UIStack: any[] = [];

let getUiLayer: () => any = () => null;
/** Install the accessor for the game UI root (uiLayer), done once at boot. */
export function initUiStack(uiLayerProvider: () => any): void {
  getUiLayer = uiLayerProvider;
}

export function pushUI(ui: any): void {
  UIStack.push(ui);
}
export function removeUI(ui: any): void {
  const i = UIStack.indexOf(ui);
  if (i >= 0) UIStack.splice(i, 1);
  if (ui.el && ui.el.parentNode) ui.el.parentNode.removeChild(ui.el);
}

// generic selectable list. items: [{label|html, disabled, help}]
export function showList(items: any[], opts?: any): Promise<number> {
  opts = opts || {};
  return new Promise((resolve) => {
    const win = el("div", "win listwin " + (opts.className || ""));
    if (opts.titleHtml != null) win.appendChild(el("div", "win-title", opts.titleHtml));
    else if (opts.title) win.appendChild(el("div", "win-title", esc(opts.title)));
    const ul = el(
      "ul",
      "menu-list" + (opts.cols > 1 ? " cols" + opts.cols : ""),
    );
    win.appendChild(ul);
    const help = el("div", "win-help");
    if (items.some((it) => it.help)) win.appendChild(help);
    let idx = Math.max(0, Math.min(opts.start || 0, items.length - 1));
    let dragging = false; // true while click-dragging a slider — suppresses hover row-changes
    // A "value row" carries an adjust(dir) fn + get() display string; left/right (and
    // gamepad auto-repeat) change its value in place instead of selecting it. Rendered as
    // label-left / value-right so sliders and cyclers line up in one column.
    const isValueRow = (it: any) => it && typeof it.adjust === "function";
    // Inner HTML of the .opt-cur cell: sliders split into a bar + percent (so a bar click can
    // seek against the bar's own rect); cyclers show the centered word.
    const curHtml = (it: any) =>
      it.slider
        ? "<span class='opt-bar'>" + esc(it.bar()) + "</span>" +
          "<span class='opt-pct'>" + esc(it.pct()) + "</span>"
        : esc(it.get());
    const valueHtml = (it: any) =>
      "<span class='opt-label'>" + esc(it.label) + "</span>" +
      "<span class='opt-value'><span class='opt-arrow' data-d='-1'>◄</span>" +
      "<span class='opt-cur'>" + curHtml(it) + "</span>" +
      "<span class='opt-arrow' data-d='1'>►</span></span>";
    const lis = items.map((it, i) => {
      let cls = "";
      if (it.disabled) cls += " disabled";
      if (it.nav) cls += " navrow";   // Controls / Back: centered "go somewhere" rows
      if (it.divider) cls += " sep";  // separator rule above the first nav row
      const li = el(
        "li",
        cls.trim(),
        isValueRow(it) ? valueHtml(it) : it.html != null ? it.html : esc(it.label),
      );
      li.addEventListener("mouseenter", () => {
        if (dragging) return; // mid slider-drag: don't let vertical drift change the selected row
        idx = i;
        refresh(false); // hover never auto-scrolls (that caused the row-boundary bounce)
      });
      li.addEventListener("click", (e: any) => {
        e.stopPropagation();
        idx = i;
        refresh(false);
        const it2 = items[i];
        if (!isValueRow(it2)) { ok(); return; }
        // Arrows step; cycler word advances. (Slider-bar seek/drag is handled on mousedown below.)
        const arrow = e.target.closest(".opt-arrow");
        if (arrow) { adjust(i, Number(arrow.dataset.d) || 1); return; }
        if (!it2.slider) adjust(i, 1); // click the cycler word to advance; slider label = no-op
      });
      // Slider: press-and-drag along the bar to scrub the volume (a plain click jumps to that
      // block). Move/up live on the document so the drag keeps tracking outside the bar; the bar
      // is re-queried each step because updateValue() re-renders .opt-cur (the old node detaches).
      li.addEventListener("mousedown", (e: any) => {
        const it2 = items[i];
        if (!it2 || !it2.slider || typeof it2.seek !== "function") return;
        if (e.target.closest(".opt-arrow")) return; // arrows step via click
        if (!e.target.closest(".opt-cur")) return;  // only the value cell scrubs
        e.preventDefault();
        idx = i;
        refresh(false);
        dragging = true;
        let lastV: any = null;
        const seekTo = (clientX: number) => {
          const bar = li.querySelector(".opt-bar");
          const r = bar && bar.getBoundingClientRect();
          if (!r || r.width <= 0) return;
          const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
          const v = Math.ceil(frac * 10) / 10;
          if (v === lastV) return; // same block → skip the re-render and SE
          lastV = v;
          it2.seek(frac);
          updateValue(i);
          sysSe("cursor");
        };
        const onMove = (ev: any) => seekTo(ev.clientX);
        const onUp = () => {
          dragging = false;
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        seekTo(e.clientX);
      });
      ul.appendChild(li);
      return li;
    });
    win.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      cancel();
    });
    function refresh(scroll: boolean) {
      lis.forEach((li, i) => li.classList.toggle("sel", i === idx));
      if (help.parentNode)
        help.textContent = (items[idx] && items[idx].help) || "";
      const li = lis[idx];
      // Only auto-scroll on keyboard/gamepad nav — never on mouse hover, or hovering a row
      // edge would nudge the scroll and bounce the selection between neighboring rows.
      if (scroll && li && li.scrollIntoView) li.scrollIntoView({ block: "nearest" });
    }
    function move(d: number) {
      if (!items.length) return;
      idx = (idx + d + items.length) % items.length;
      sysSe("cursor");
      refresh(true);
    }
    // Re-read just one value row's display (no full rebuild → no flicker on adjust).
    function updateValue(i: number) {
      const it = items[i];
      const li = lis[i];
      if (!it || !li) return;
      const cur = li.querySelector(".opt-cur");
      if (cur) cur.innerHTML = curHtml(it);
    }
    function adjust(i: number, dir: number) {
      const it = items[i];
      if (!it || it.disabled || typeof it.adjust !== "function") return;
      it.adjust(dir);
      sysSe("cursor");
      updateValue(i);
    }
    function ok() {
      if (!items.length) return;
      if (items[idx].disabled) {
        sysSe("buzzer");
        return;
      }
      sysSe("ok");
      finish(idx);
    }
    function cancel() {
      if (opts.cancellable === false) return;
      sysSe("cancel");
      finish(-1);
    }
    function finish(v: number) {
      removeUI(ui);
      resolve(v);
    }
    const cols = opts.cols || 1;
    const ui = {
      el: win,
      onKey(k: string, repeat: boolean) {
        const it = items[idx];
        const valueRow = isValueRow(it) && !it.disabled;
        // Cyclers (Text Speed / Dash / Screen Shake) change once per press: ignore auto-repeat so
        // holding a direction can't blow through the options. Sliders still repeat (hold to ramp).
        const blockRepeat = repeat && valueRow && !it.slider;
        if (k === "up") move(-cols);
        else if (k === "down") move(cols);
        else if (k === "left") {
          if (valueRow) { if (!blockRepeat) adjust(idx, -1); }
          else if (cols > 1) move(-1);
        } else if (k === "right") {
          if (valueRow) { if (!blockRepeat) adjust(idx, 1); }
          else if (cols > 1) move(1);
        } else if (k === "ok") {
          if (valueRow) { if (!blockRepeat) adjust(idx, 1); }
          else ok();
        } else if (k === "cancel") cancel();
      },
    };
    getUiLayer().appendChild(win);
    pushUI(ui);
    refresh(true);
  });
}
