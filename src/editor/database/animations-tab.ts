/* RPGAtlas — src/editor/database/animations-tab.ts
   Database ▸ Animations (Phase 5 Stage A): the battle-animation timeline
   editor. Left: the standard list scaffold. Right, per animation: name +
   default anchor, a timeline strip (items as draggable chips on a tick
   ruler), the item table with per-type parameter forms, and a live preview
   arena driven by the REAL runtime (src/shared/anim-player.ts over a
   battle-fx pool), so what plays here is what plays in battle.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, Sfx, editorState as S } from "../editor-state";
import { h, nIn, sel, chk, field, row, SE_NAMES, stringSelOpts } from "../dom";
import { touch } from "../persistence";
import { listFormTab, nameRefresher } from "./shared";
import { createBattleFx } from "../../shared/battle-fx";
import { playAnimation, animDurationTicks } from "../../shared/anim-player";
import { libraryMetas, resolvePlaybackSheet } from "../../shared/asset-library";

const ITEM_TYPES = [
  { v: "particles", l: "Particles" },
  { v: "flash", l: "Flash" },
  { v: "shake", l: "Shake" },
  { v: "sound", l: "Sound" },
  { v: "projectile", l: "Projectile" },
  { v: "flipbook", l: "Flipbook" },
];
const TYPE_COLORS: any = {
  particles: "#e8a940", flash: "#f0f0b0", shake: "#d87070",
  sound: "#70c8e8", projectile: "#b088e8", flipbook: "#78d890",
};
const KIND_OPTS = ["", "hit", "crit", "fire", "ice", "thunder", "heal", "poison", "status", "death", "item", "dust"];
const ANCHOR_OPTS = [
  { v: "target", l: "Target" },
  { v: "source", l: "Source" },
  { v: "screen", l: "Screen" },
];

function defaultItem(type: string): any {
  switch (type) {
    case "flash": return { at: 0, type, color: "#ffffff", opacity: 0.6, duration: 300 };
    case "shake": return { at: 0, type, power: 5, speed: 5, duration: 20 };
    case "sound": return { at: 0, type, se: "hit" };
    case "projectile": return { at: 0, type, color: "#ffffff", size: 10, duration: 330, trail: true };
    case "flipbook": return { at: 0, type, sheet: "icons", from: 8, to: 11, fps: 10, scale: 1.4 };
    default: return { at: 0, type: "particles", kind: "hit", shape: "burst", count: 12, radius: 44, size: 7, duration: 470 };
  }
}

function itemLabel(item: any): string {
  switch (item.type) {
    case "particles": return "Particles" + (item.kind ? " · " + item.kind : "") + (item.shape && item.shape !== "burst" ? " · " + item.shape : "");
    case "flash": return "Flash" + ((item.anchor || "") === "screen" ? " · screen" : "");
    case "shake": return "Shake " + (item.power || 5);
    case "sound": return "Sound · " + (item.se || "?");
    case "projectile": return "Projectile";
    case "flipbook": return "Flipbook " + (item.from || 0) + "–" + (item.to || 0);
    default: return item.type;
  }
}

export const animationsTab = () => listFormTab({
  kind: "animations",
  list: () => (S.proj.animations = S.proj.animations || []),
  allowEmpty: true,
  blank: () => ({ id: 0, name: "Animation", target: "target", items: [defaultItem("particles")] }),
  form(e: any, box: any, redrawList: any) {
    if (!Array.isArray(e.items)) e.items = [];
    if (!e.target) e.target = "target";
    let selected: any = e.items[0] || null;

    box.appendChild(row(
      field("Name", nameRefresher(e, redrawList)),
      field("Default anchor", sel(e, "target", ANCHOR_OPTS))));

    // ---- timeline strip: items as chips on a tick ruler; drag to retime ----
    const strip = h("div", { class: "anim-strip" });
    function totalTicks() { return Math.max(60, animDurationTicks(e) + 12); }
    function redrawStrip() {
      strip.innerHTML = "";
      const total = totalTicks();
      // ruler marks every 15 ticks (quarter second)
      for (let tk = 0; tk <= total; tk += 15) {
        const mark = h("div", { class: "anim-tick" + (tk % 60 === 0 ? " sec" : "") });
        mark.style.left = (tk / total) * 100 + "%";
        if (tk % 60 === 0) mark.appendChild(h("span", { class: "anim-tick-lbl" }, String(tk / 60) + "s"));
        strip.appendChild(mark);
      }
      e.items.forEach((item: any, i: number) => {
        const chip = h("div", { class: "anim-chip" + (item === selected ? " sel" : ""), title: itemLabel(item) + " @ tick " + (item.at || 0) },
          itemLabel(item));
        chip.style.left = ((Number(item.at) || 0) / total) * 100 + "%";
        chip.style.top = 18 + (i % 4) * 22 + "px";
        chip.style.background = TYPE_COLORS[item.type] || "#999";
        chip.addEventListener("mousedown", (ev: any) => {
          ev.preventDefault();
          selected = item;
          const rect = strip.getBoundingClientRect();
          const startAt = Number(item.at) || 0;
          const startX = ev.clientX;
          let moved = false;
          function onMove(me: any) {
            const dt = Math.round(((me.clientX - startX) / rect.width) * total);
            const next = Math.max(0, Math.min(600, startAt + dt));
            if (next !== item.at) { item.at = next; moved = true; redrawStrip(); }
          }
          function onUp() {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            if (moved) { touch(); sortItems(); }
            redrawAll();
          }
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        });
        strip.appendChild(chip);
      });
    }

    // ---- item table + per-type parameter form ----
    const table = h("div", { class: "anim-items" });
    const params = h("div", { class: "anim-params" });
    function sortItems() {
      e.items.sort((a: any, b: any) => (Number(a.at) || 0) - (Number(b.at) || 0));
    }
    function redrawTable() {
      table.innerHTML = "";
      if (!e.items.length) {
        table.appendChild(h("div", { class: "dim", style: "padding:6px" }, "No items — add one below."));
      }
      e.items.forEach((item: any) => {
        const rowEl = h("div", { class: "anim-item-row" + (item === selected ? " sel" : ""),
          onclick() { selected = item; redrawAll(); } },
          h("span", { class: "anim-item-dot" }),
          h("span", { class: "anim-item-at" }, "@" + (item.at || 0)),
          h("span", null, itemLabel(item)),
          h("button", { class: "mini", title: "Duplicate", onclick(ev: any) {
            ev.stopPropagation();
            const copy = JSON.parse(JSON.stringify(item));
            e.items.push(copy); sortItems(); selected = copy; touch(); redrawAll();
          } }, "⧉"),
          h("button", { class: "mini danger", title: "Delete", onclick(ev: any) {
            ev.stopPropagation();
            e.items.splice(e.items.indexOf(item), 1);
            if (selected === item) selected = e.items[0] || null;
            touch(); redrawAll();
          } }, "×"));
        (rowEl.querySelector(".anim-item-dot") as any).style.background = TYPE_COLORS[item.type] || "#999";
        table.appendChild(rowEl);
      });
      const addRow = h("div", { class: "anim-add-row" }, h("span", { class: "dim" }, "Add:"));
      for (const tdef of ITEM_TYPES) {
        addRow.appendChild(h("button", { class: "mini", onclick() {
          const item = defaultItem(tdef.v);
          item.at = animDurationTicks(e);
          e.items.push(item); sortItems(); selected = item; touch(); redrawAll();
        } }, tdef.l));
      }
      table.appendChild(addRow);
    }
    function redrawParams() {
      params.innerHTML = "";
      const item = selected;
      if (!item) return;
      const onType = () => { Object.assign(item, { ...defaultItem(item.type), at: item.at }); redrawAll(); };
      params.appendChild(row(
        field("At (ticks, 60/s)", nIn(item, "at", 0, 600)),
        field("Type", sel(item, "type", ITEM_TYPES, onType))));
      if (item.type === "particles") {
        params.appendChild(row(
          field("Anchor", sel(item, "anchor", withDefaultAnchor())),
          field("Palette", sel(item, "kind", kindOpts())),
          colorField(item),
          field("Shape", sel(item, "shape", stringSelOpts(["burst", "ring", "rain", "spiral"])))));
        params.appendChild(row(
          field("Count", nIn(item, "count", 1, 60)),
          field("Radius (px)", nIn(item, "radius", 4, 300)),
          field("Size (px)", nIn(item, "size", 1, 40)),
          field("Duration (ms)", nIn(item, "duration", 50, 4000))));
      } else if (item.type === "flash") {
        params.appendChild(row(
          field("Anchor", sel(item, "anchor", withDefaultAnchor())),
          colorField(item),
          field("Opacity (0–1)", nIn(item, "opacity", 0.05, 1, 0.05)),
          field("Duration (ms)", nIn(item, "duration", 50, 4000))));
      } else if (item.type === "shake") {
        params.appendChild(row(
          field("Power (1-9)", nIn(item, "power", 1, 9)),
          field("Speed (1-9)", nIn(item, "speed", 1, 9)),
          field("Duration (frames)", nIn(item, "duration", 1, 600))));
      } else if (item.type === "sound") {
        const w = sel(item, "se", stringSelOpts(SE_NAMES));
        params.appendChild(row(field("Sound", w),
          h("button", { class: "mini", onclick() { Sfx.play(item.se); } }, "▶ test")));
      } else if (item.type === "projectile") {
        params.appendChild(row(
          colorField(item),
          field("Size (px)", nIn(item, "size", 2, 60)),
          field("Duration (ms)", nIn(item, "duration", 50, 4000)),
          field("Glow trail", chk(item, "trail"))));
        params.appendChild(h("div", { class: "dim" }, "Travels from the source battler to each target."));
      } else if (item.type === "flipbook") {
        // Sheet picker (Phase 6): icons · imported library sheets (asset keys,
        // with frame-tag ranges from the importer) · custom URL passthrough.
        const sheetAssets = libraryMetas().filter((m: any) => m.type === "characters" && m.meta && m.meta.charset === false);
        const cur = String(item.sheet || "icons");
        const isUrl = cur !== "icons" && !sheetAssets.some((m: any) => m.key === cur);
        const picker = h("select", { onchange(ev: any) {
          const v = ev.target.value;
          if (v === "__url") { item.sheet = ""; }
          else {
            item.sheet = v;
            delete item.tag;
            const meta = sheetAssets.find((m: any) => m.key === v);
            if (meta && meta.meta) {
              if (meta.meta.cols) item.cols = meta.meta.cols;
              if (meta.meta.rows) item.rows = meta.meta.rows;
            }
          }
          touch(); redrawParams(); redrawStrip();
        } });
        picker.appendChild(h("option", { value: "icons" }, "icons (built-in)"));
        for (const m of sheetAssets) picker.appendChild(h("option", { value: m.key }, m.name));
        picker.appendChild(h("option", { value: "__url" }, "(custom URL…)"));
        picker.value = isUrl ? "__url" : cur;
        const fields: any[] = [
          field("Anchor", sel(item, "anchor", withDefaultAnchor())),
          field("Sheet", picker),
        ];
        if (isUrl || picker.value === "__url") {
          fields.push(field("Image URL", h("input", { type: "text", value: cur === "icons" ? "" : cur,
            oninput(ev: any) { item.sheet = ev.target.value; touch(); } })));
        }
        const selectedSheet: any = sheetAssets.find((m: any) => m.key === item.sheet);
        const frames: any[] = (selectedSheet && selectedSheet.meta && selectedSheet.meta.frames) || [];
        if (frames.length) {
          const tagSel = h("select", { onchange(ev: any) {
            const tag = frames.find((f: any) => f.name === ev.target.value);
            if (tag) {
              item.tag = tag.name;
              item.from = tag.from;
              item.to = tag.to;
              if (tag.fps) item.fps = tag.fps;
            } else delete item.tag;
            touch(); redrawParams(); redrawStrip();
          } });
          tagSel.appendChild(h("option", { value: "" }, "(manual range)"));
          for (const f of frames) tagSel.appendChild(h("option", { value: f.name }, f.name + " (" + f.from + "–" + f.to + ")"));
          tagSel.value = item.tag && frames.some((f: any) => f.name === item.tag) ? item.tag : "";
          fields.push(field("Frame tag", tagSel));
        }
        fields.push(field("Cols", nIn(item, "cols", 1, 32)), field("Rows", nIn(item, "rows", 1, 32)));
        params.appendChild(row(...fields));
        params.appendChild(row(
          field("From frame", nIn(item, "from", 0, 4096)),
          field("To frame", nIn(item, "to", 0, 4096)),
          field("FPS", nIn(item, "fps", 1, 60)),
          field("Scale", nIn(item, "scale", 0.25, 8, 0.25))));
      }
      function withDefaultAnchor() {
        const o: any = [{ v: "", l: "(animation default)" }].concat(ANCHOR_OPTS as any);
        o.stringValues = true;
        return o;
      }
      function kindOpts() {
        const o: any = KIND_OPTS.map((k) => ({ v: k, l: k || "(color only)" }));
        o.stringValues = true;
        return o;
      }
      function colorField(it: any) {
        return field("Color", h("input", { type: "color", value: /^#[0-9a-fA-F]{6}$/.test(it.color || "") ? it.color : "#ffffff",
          oninput(ev: any) { it.color = ev.target.value; touch(); redrawStrip(); } }));
      }
    }
    let tableTimer: any = null;
    function redrawTableSoon() {
      clearTimeout(tableTimer);
      tableTimer = setTimeout(() => { sortItems(); redrawTable(); redrawStrip(); }, 350);
    }
    function redrawAll() { sortItems(); redrawStrip(); redrawTable(); redrawParams(); }
    // one listener for the whole param pane: any bound-input edit refreshes
    // the strip + table (debounced) so chips/labels track live
    params.addEventListener("input", () => { redrawStrip(); redrawTableSoon(); });

    // ---- live preview: the real player over a battle-fx pool ----
    const arena = h("div", { class: "anim-arena" });
    const fxLayer = h("div", { class: "anim-arena-fx" });
    const sourceCard = h("div", { class: "anim-battler src" }, h("span", null, "SOURCE"));
    const targetCard = h("div", { class: "anim-battler tgt" }, h("span", null, "TARGET"));
    arena.appendChild(sourceCard);
    arena.appendChild(targetCard);
    arena.appendChild(fxLayer);
    let fx: any = null;
    let playing = false;
    const playBtn = h("button", { async onclick() {
      if (playing) return;
      playing = true;
      playBtn.disabled = true;
      if (!fx) fx = createBattleFx(arena, fxLayer);
      try {
        await playAnimation(e, {
          fx,
          source: sourceCard,
          targets: [targetCard],
          onSound: (se: string) => Sfx.play(se),
          resolveSheet: resolvePlaybackSheet,
          onShake: () => {
            arena.classList.remove("shake");
            void arena.offsetWidth;
            arena.classList.add("shake");
          },
          drawIcon(index: number) {
            const src = Assets.iconCanvas(index);
            const c = document.createElement("canvas");
            c.width = src.width; c.height = src.height;
            c.getContext("2d")!.drawImage(src, 0, 0);
            return c;
          },
        });
      } finally {
        playing = false;
        playBtn.disabled = false;
      }
    } }, "▶ Play");

    box.appendChild(h("div", { class: "subhead" }, "Timeline"));
    box.appendChild(strip);
    box.appendChild(h("div", { class: "anim-editor" },
      h("div", null, h("div", { class: "subhead" }, "Items"), table),
      h("div", null, h("div", { class: "subhead" }, "Item settings"), params)));
    box.appendChild(h("div", { class: "subhead" }, "Preview"));
    box.appendChild(h("div", { class: "anim-preview" }, arena, playBtn));
    redrawAll();
  },
});
