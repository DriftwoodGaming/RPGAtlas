/* RPGAtlas — Visual UI/HUD Designer.
   Authors arrange screen-relative widgets directly on a game-screen preview,
   bind text/gauges to live state, compose on-map custom menus, and place the
   message window. GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { RA, editorState as S } from "../editor-state";
import { h, field, row, dbOpts, varOpts } from "../dom";
import { modal, confirmBox } from "../modals";
import { touch } from "../persistence";

const TYPE_LABELS: Record<string, string> = {
  minimap: "Minimap",
  quests: "Quest tracker",
  text: "Bound text",
  gauge: "Gauge",
  menu: "Custom menu",
};

const BINDINGS = [
  ["none", "None / static text"], ["variable", "Variable"], ["switch", "Switch"],
  ["gold", "Gold"], ["actorHp", "Party leader HP"], ["actorMp", "Party leader MP"],
  ["actorTp", "Party leader TP"], ["actorLevel", "Party leader level"],
  ["steps", "Steps"], ["mapName", "Map name"],
].map(([v, l]) => ({ v, l }));
(BINDINGS as any).stringValues = true;

function input(type: string, value: any, onChange: (value: any) => void, attrs: any = {}) {
  return h("input", {
    type, value,
    ...attrs,
    oninput(e: any) {
      const next = type === "number" || type === "range" ? Number(e.target.value) : e.target.value;
      onChange(next);
    },
  });
}

function select(value: any, options: any[], onChange: (value: any) => void) {
  const out = h("select", { onchange(e: any) { onChange(e.target.value); } });
  for (const option of options) out.appendChild(h("option", { value: option.v }, option.l));
  out.value = String(value == null ? "" : value);
  return out;
}

function checkbox(value: boolean, onChange: (value: boolean) => void) {
  return h("input", {
    type: "checkbox", ...(value ? { checked: "" } : {}),
    onchange(e: any) { onChange(!!e.target.checked); },
  });
}

export function openHudDesigner(): void {
  const system: any = S.proj.system;
  system.hudDesign = RA.normalizeHudDesign(system.hudDesign);
  const design: any = system.hudDesign;
  let selected: any = design.widgets[0] ? { kind: "widget", id: design.widgets[0].id } : { kind: "message" };

  const shell = h("div", { class: "hud-designer" });
  const toolbar = h("div", { class: "hud-design-toolbar" });
  const workspace = h("div", { class: "hud-design-workspace" });
  const screenWrap = h("div", { class: "hud-design-screen-wrap" });
  const inspector = h("div", { class: "hud-design-inspector" });
  const screen = h("div", {
    class: "hud-design-screen",
    style: `aspect-ratio:${Math.max(1, Number(system.screenWidth) || 816)} / ${Math.max(1, Number(system.screenHeight) || 624)}`,
  });
  screenWrap.appendChild(screen);
  workspace.appendChild(screenWrap);
  workspace.appendChild(inspector);
  shell.appendChild(toolbar);
  shell.appendChild(workspace);

  function changed(render = true) {
    touch();
    if (render) renderAll();
  }

  function uniqueId(type: string) {
    let n = 1;
    while (design.widgets.some((w: any) => w.id === `${type}-${n}`)) n++;
    return `${type}-${n}`;
  }

  function addWidget(type: string) {
    const widget: any = {
      id: uniqueId(type), type, x: 4, y: 4, w: type === "minimap" ? 20 : 28,
      h: type === "quests" ? 30 : type === "menu" ? 24 : 16, visible: true,
      label: TYPE_LABELS[type], binding: type === "gauge" ? "actorHp" : "none",
      max: 100, color: "#6aa6ff", questLimit: 3, menuItems: [], text: "Value",
    };
    if (type === "menu") widget.menuItems = [{ label: "Open menu", action: "menu", commonEventId: 0 }];
    design.widgets.push(widget);
    selected = { kind: "widget", id: widget.id };
    changed();
  }

  function selectedWidget() {
    return selected.kind === "widget" ? design.widgets.find((w: any) => w.id === selected.id) : null;
  }

  function previewText(widget: any) {
    if (widget.type === "minimap") return "▦  Minimap";
    if (widget.type === "quests") return "Quests\n◆ Find the waystone\n◇ Return to the village";
    if (widget.type === "gauge") return `${widget.label || "Gauge"}\n██████░░░ 68 / 100`;
    if (widget.type === "menu") return (widget.label ? widget.label + "\n" : "") + (widget.menuItems || []).map((item: any) => `[ ${item.label} ]`).join("  ");
    return `${widget.label ? widget.label + ": " : ""}${widget.text || "42"}`;
  }

  function attachDrag(node: any, target: any, kind: "move" | "resize") {
    node.addEventListener("pointerdown", (event: any) => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      selected = target === design.messageWindow ? { kind: "message" } : { kind: "widget", id: target.id };
      const rect = screen.getBoundingClientRect();
      const startX = event.clientX, startY = event.clientY;
      const start = { x: target.x, y: target.y, w: target.w, h: target.h };
      node.setPointerCapture(event.pointerId);
      const move = (ev: any) => {
        const dx = ((ev.clientX - startX) / rect.width) * 100;
        const dy = ((ev.clientY - startY) / rect.height) * 100;
        if (kind === "move") {
          target.x = Math.max(0, Math.min(100 - target.w, start.x + dx));
          target.y = Math.max(0, Math.min(100 - target.h, start.y + dy));
        } else {
          target.w = Math.max(4, Math.min(100 - target.x, start.w + dx));
          target.h = Math.max(4, Math.min(100 - target.y, start.h + dy));
        }
        target.x = Math.round(target.x * 10) / 10; target.y = Math.round(target.y * 10) / 10;
        target.w = Math.round(target.w * 10) / 10; target.h = Math.round(target.h * 10) / 10;
        const parent = node.parentElement;
        parent.style.left = target.x + "%"; parent.style.top = target.y + "%";
        parent.style.width = target.w + "%"; parent.style.height = target.h + "%";
      };
      const up = () => {
        node.removeEventListener("pointermove", move);
        node.removeEventListener("pointerup", up);
        changed();
      };
      node.addEventListener("pointermove", move);
      node.addEventListener("pointerup", up);
      renderInspector();
    });
  }

  function renderScreen() {
    screen.innerHTML = "";
    const theme = design.theme;
    screen.style.setProperty("--hud-preview-panel", theme.panel);
    screen.style.setProperty("--hud-preview-border", theme.border);
    screen.style.setProperty("--hud-preview-text", theme.text);
    screen.style.setProperty("--hud-preview-accent", theme.accent);
    for (const widget of design.widgets) {
      const node = h("div", {
        class: "hud-design-node" + (selected.kind === "widget" && selected.id === widget.id ? " sel" : "") + (widget.visible ? "" : " hidden-widget"),
        style: `left:${widget.x}%;top:${widget.y}%;width:${widget.w}%;height:${widget.h}%`,
      }, h("div", { class: "hud-design-node-label" }, TYPE_LABELS[widget.type] || widget.type),
      h("div", { class: "hud-design-node-preview" }, previewText(widget)));
      const handle = h("span", { class: "hud-design-resize", title: "Drag to resize" });
      node.appendChild(handle);
      node.addEventListener("click", (event: any) => { event.stopPropagation(); selected = { kind: "widget", id: widget.id }; renderAll(); });
      attachDrag(node, widget, "move");
      attachDrag(handle, widget, "resize");
      screen.appendChild(node);
    }
    const msg = design.messageWindow;
    const msgNode = h("div", {
      class: "hud-design-node hud-design-message" + (selected.kind === "message" ? " sel" : "") + (msg.enabled ? "" : " disabled-layout"),
      style: `left:${msg.x}%;top:${msg.y}%;width:${msg.w}%;height:${msg.h}%`,
    }, h("div", { class: "hud-design-node-label" }, "Message window"), h("div", { class: "hud-design-node-preview" }, "Speaker\nYour dialogue appears here…"));
    const msgHandle = h("span", { class: "hud-design-resize", title: "Drag to resize" });
    msgNode.appendChild(msgHandle);
    msgNode.addEventListener("click", (event: any) => { event.stopPropagation(); selected = { kind: "message" }; renderAll(); });
    attachDrag(msgNode, msg, "move"); attachDrag(msgHandle, msg, "resize");
    screen.appendChild(msgNode);
    screen.addEventListener("click", () => { selected = { kind: "message" }; renderAll(); }, { once: true });
  }

  function positionFields(target: any) {
    const changeNum = (key: string, lo: number, hi: number) => (value: number) => {
      target[key] = Math.max(lo, Math.min(hi, value)); changed();
    };
    return row(
      field("X %", input("number", target.x, changeNum("x", 0, 98), { min: 0, max: 98, step: .5 })),
      field("Y %", input("number", target.y, changeNum("y", 0, 98), { min: 0, max: 98, step: .5 })),
      field("Width %", input("number", target.w, changeNum("w", 4, 100), { min: 4, max: 100, step: .5 })),
      field("Height %", input("number", target.h, changeNum("h", 4, 100), { min: 4, max: 100, step: .5 })),
    );
  }

  function bindingIdControl(widget: any) {
    if (widget.binding === "variable") {
      const opts: any = varOpts();
      return field("Variable", select(widget.bindingId || 0, opts, (v) => { widget.bindingId = Number(v) || 0; changed(); }));
    }
    if (widget.binding === "switch") {
      const opts = [{ v: 0, l: "(none)" }].concat((system.switches || []).map((name: string, i: number) => ({ v: i + 1, l: `${i + 1}: ${name || "—"}` })));
      return field("Switch", select(widget.bindingId || 0, opts, (v) => { widget.bindingId = Number(v) || 0; changed(); }));
    }
    return null;
  }

  function renderMenuItems(widget: any, host: any) {
    host.appendChild(h("div", { class: "subhead" }, "Menu commands"));
    (widget.menuItems || []).forEach((item: any, index: number) => {
      const itemRow = h("div", { class: "hud-menu-item-row" },
        input("text", item.label, (v) => { item.label = v; changed(false); }, { placeholder: "Command label" }),
        select(item.action, [{ v: "menu", l: "Open pause menu" }, { v: "commonEvent", l: "Run common event" }], (v) => { item.action = v; changed(); }),
      );
      if (item.action === "commonEvent") itemRow.appendChild(select(item.commonEventId || 0, dbOpts(S.proj.commonEvents, "(none)"), (v) => { item.commonEventId = Number(v) || 0; changed(false); }));
      itemRow.appendChild(h("button", { class: "mini danger", onclick() { widget.menuItems.splice(index, 1); changed(); } }, "Remove"));
      host.appendChild(itemRow);
    });
    host.appendChild(h("button", { class: "mini", onclick() { widget.menuItems.push({ label: "Command", action: "menu", commonEventId: 0 }); changed(); } }, "+ Add command"));
  }

  function renderInspector() {
    inspector.innerHTML = "";
    if (selected.kind === "message") {
      const msg = design.messageWindow;
      inspector.appendChild(h("h3", null, "Message window layout"));
      inspector.appendChild(field("Use custom layout", checkbox(msg.enabled, (v) => { msg.enabled = v; changed(); })));
      inspector.appendChild(positionFields(msg));
      inspector.appendChild(row(
        field("Padding (px)", input("number", msg.padding, (v) => { msg.padding = Math.max(0, Math.min(48, v)); changed(); }, { min: 0, max: 48 })),
        field("Text alignment", select(msg.textAlign, [{ v: "left", l: "Left" }, { v: "center", l: "Center" }, { v: "right", l: "Right" }], (v) => { msg.textAlign = v; changed(); })),
      ));
      inspector.appendChild(h("div", { class: "dim" }, "When enabled, this rectangle replaces the default top/middle/bottom message positions so every dialogue uses the authored layout."));
      return;
    }
    const widget = selectedWidget();
    if (!widget) return;
    inspector.appendChild(h("h3", null, TYPE_LABELS[widget.type] || "HUD widget"));
    inspector.appendChild(row(
      field("Visible", checkbox(widget.visible, (v) => { widget.visible = v; changed(); })),
      field("Label", input("text", widget.label || "", (v) => { widget.label = v; changed(); })),
    ));
    inspector.appendChild(positionFields(widget));
    if (widget.type === "quests") {
      inspector.appendChild(field("Maximum quests", input("number", widget.questLimit || 3, (v) => { widget.questLimit = Math.max(1, Math.min(10, v)); changed(); }, { min: 1, max: 10 })));
    } else if (widget.type === "text" || widget.type === "gauge") {
      if (widget.type === "text") inspector.appendChild(field("Static text / prefix", input("text", widget.text || "", (v) => { widget.text = v; changed(); })));
      inspector.appendChild(field("Value binding", select(widget.binding || "none", BINDINGS, (v) => { widget.binding = v; changed(); })));
      const idControl = bindingIdControl(widget); if (idControl) inspector.appendChild(idControl);
      if (widget.type === "gauge") inspector.appendChild(row(
        field("Maximum (variables/gold)", input("number", widget.max || 100, (v) => { widget.max = Math.max(1, v); changed(); }, { min: 1 })),
        field("Fill color", input("color", widget.color || "#6aa6ff", (v) => { widget.color = v; changed(); })),
      ));
    } else if (widget.type === "menu") {
      renderMenuItems(widget, inspector);
    }
    inspector.appendChild(h("button", { class: "danger hud-delete-widget", onclick() {
      confirmBox(`Delete ${TYPE_LABELS[widget.type] || "widget"}?`, () => {
        design.widgets = design.widgets.filter((entry: any) => entry !== widget);
        selected = design.widgets[0] ? { kind: "widget", id: design.widgets[0].id } : { kind: "message" };
        changed();
      });
    } }, "Delete widget"));
  }

  function applyTheme(name: string) {
    design.theme = { ...RA.HUD_THEMES[name] };
    const windowColors: Record<string, string> = { atlas: "#12182e", parchment: "#3b2b1f", neon: "#071522" };
    system.windowColor = windowColors[name];
    changed();
  }

  function renderToolbar() {
    toolbar.innerHTML = "";
    toolbar.appendChild(field("HUD visible", checkbox(design.enabled, (v) => { design.enabled = v; changed(); })));
    toolbar.appendChild(h("span", { class: "hud-toolbar-label" }, "Add"));
    for (const type of ["minimap", "quests", "text", "gauge", "menu"]) {
      toolbar.appendChild(h("button", { class: "mini", onclick() { addWidget(type); } }, "+ " + TYPE_LABELS[type]));
    }
    toolbar.appendChild(h("span", { class: "hud-toolbar-spacer" }));
    toolbar.appendChild(h("span", { class: "hud-toolbar-label" }, "Theme"));
    for (const name of ["atlas", "parchment", "neon"]) {
      toolbar.appendChild(h("button", { class: "mini hud-theme-button" + (design.theme.preset === name ? " sel" : ""), onclick() { applyTheme(name); } }, name[0].toUpperCase() + name.slice(1)));
    }
    toolbar.appendChild(h("button", { class: "mini", onclick() {
      confirmBox("Reset the HUD, message layout, and theme to the Atlas defaults?", () => {
        const fresh = RA.defaultHudDesign();
        for (const key of Object.keys(design)) delete design[key];
        Object.assign(design, fresh);
        system.hudDesign = design;
        selected = { kind: "widget", id: "minimap" };
        changed();
      });
    } }, "Reset"));
  }

  function renderAll() { renderToolbar(); renderScreen(); renderInspector(); }
  renderAll();
  modal({ title: "Visual UI / HUD Designer", content: shell, wide: true, resizable: true, class: "hud-designer-modal", buttons: [{ label: "Done", primary: true }] });
}
