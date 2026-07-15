/* RPGAtlas — src/editor/tools/character-generator.ts
   The Character Generator modal: build original walking sprites (hair/skin/
   colours), preview them animated, and save them into proj.customChars so they
   appear in every sprite picker.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 3):
   logic unchanged, closure vars routed through editor-state.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, RA, TILE, editorState as S } from "../editor-state";
import { h, field, row } from "../dom";
import { modal, confirmBox } from "../modals";
import { touch } from "../persistence";
import { renderMap } from "../map-editor/map-render";
import { flashStatus } from "../map-editor/status";

export function openCharGenerator() {
  const SKINS = ["#f0c8a0", "#e8b890", "#d8a070", "#c08858", "#9a6a40", "#f0d0b0"];
  const HAIR_COLORS = ["#241b18", "#4a2d1c", "#75442b", "#a65e32", "#c49a62", "#d7d0c4", "#7a3048", "#37527a"];
  const WARDROBE_PALETTES = [
    { shirt: "#3567a5", pants: "#273b5c", hat: "#d1a84b", accent: "#e2b84e" },
    { shirt: "#7f3f62", pants: "#392d4f", hat: "#c67a46", accent: "#e6a64f" },
    { shirt: "#39785b", pants: "#384b35", hat: "#b4934c", accent: "#d2bd67" },
    { shirt: "#a84a3f", pants: "#49352f", hat: "#d5b968", accent: "#e6c760" },
    { shirt: "#6a55a0", pants: "#30395e", hat: "#4fb0a0", accent: "#62cbb8" },
    { shirt: "#c5bda8", pants: "#59606b", hat: "#8b6046", accent: "#b97c4f" },
  ];
  const EYE_COLORS = ["#2d3348", "#315d78", "#3f6b42", "#724f2d", "#6a3c73"];
  const ART_STYLES = Assets.CHARACTER_ART_STYLES || [
    { id: "classic", name: "Classic Pixel", description: "The original RPGAtlas style." },
  ];
  const BODY_TYPES = Assets.CHARACTER_BODY_TYPES || ["balanced"];
  const OUTFITS = Assets.CHARACTER_OUTFITS || ["tunic"];
  const ACCESSORIES = Assets.CHARACTER_ACCESSORIES || ["none"];
  const pick = (arr: any) => arr[Math.floor(Math.random() * arr.length)];
  const labelOf = (value: string) => value[0].toUpperCase() + value.slice(1);
  function randomWork(artStyle?: string) {
    const palette = pick(WARDROBE_PALETTES);
    return { name: "New Hero", artStyle: artStyle || pick(ART_STYLES).id,
      bodyType: pick(BODY_TYPES), outfit: pick(OUTFITS), accessory: pick(ACCESSORIES),
      style: pick(Assets.HAIR_STYLES), skin: pick(SKINS), hair: pick(HAIR_COLORS), eyes: pick(EYE_COLORS),
      shirt: palette.shirt, pants: palette.pants, hat: palette.hat, accent: palette.accent };
  }
  function normalizeWork(value: any) {
    const fallback = randomWork("classic");
    return Object.assign(fallback, value || {}, {
      artStyle: ART_STYLES.some((style: any) => style.id === value?.artStyle) ? value.artStyle : "classic",
      bodyType: BODY_TYPES.includes(value?.bodyType) ? value.bodyType : "balanced",
      outfit: OUTFITS.includes(value?.outfit) ? value.outfit : "tunic",
      accessory: ACCESSORIES.includes(value?.accessory) ? value.accessory : "none",
    });
  }
  let editing: any = null; // entry in proj.customChars being edited, or null for a new one
  let work: any = randomWork();
  const PV_KEY = "cg_preview";
  let animF = 0;

  const previews = [0, 1, 2, 3].map(() => {
    const c = document.createElement("canvas");
    c.width = TILE; c.height = TILE;
    return c;
  });
  function paramsOf(w: any) { return { artStyle: w.artStyle, bodyType: w.bodyType, outfit: w.outfit,
    accessory: w.accessory, skin: w.skin, hair: w.hair, eyes: w.eyes, style: w.style,
    shirt: w.shirt, pants: w.pants, hat: w.hat, accent: w.accent }; }
  function redrawPreview() {
    const idx = Assets.registerHuman(PV_KEY, "preview", paramsOf(work));
    const frame = [0, 1, 2, 1][animF % 4];
    previews.forEach((c, dir) => {
      const g = c.getContext("2d")!;
      g.clearRect(0, 0, TILE, TILE);
      g.drawImage(Assets.charFrameCanvas(idx, dir, frame), 0, 0);
    });
  }
  const animTimer = setInterval(() => { animF++; redrawPreview(); }, 170);

  const formBox = h("div", { class: "cg-form" });
  const listEl = h("ul", { class: "dblist" });
  function redrawStyleThumbnails() {
    for (const canvas of formBox.querySelectorAll(".cg-style-thumb") as any) {
      const sample = Assets.humanPreviewCanvas(
        Object.assign(paramsOf(work), { artStyle: canvas.getAttribute("data-art-style") }), 0, 1,
      );
      const g = canvas.getContext("2d");
      g.clearRect(0, 0, TILE, TILE);
      g.drawImage(sample, 0, 0);
    }
  }
  function colorIn(key: any) {
    return h("input", { type: "color", value: work[key], oninput(e: any) {
      work[key] = e.target.value; redrawPreview(); redrawStyleThumbnails();
    } });
  }
  function optionIn(key: string, values: string[]) {
    return h("select", { onchange(e: any) {
      work[key] = e.target.value; redrawForm(); redrawPreview();
    } }, ...values.map((value) => h("option", {
      value, ...(value === work[key] ? { selected: "" } : {}),
    }, labelOf(value))));
  }
  function styleCard(style: any) {
    const thumb = Assets.humanPreviewCanvas(Object.assign(paramsOf(work), { artStyle: style.id }), 0, 1);
    thumb.className = "cg-style-thumb";
    thumb.setAttribute("data-art-style", style.id);
    return h("button", {
      type: "button",
      class: "cg-style-card" + (style.id === work.artStyle ? " sel" : ""),
      "aria-pressed": style.id === work.artStyle ? "true" : "false",
      onclick() { work.artStyle = style.id; redrawForm(); redrawPreview(); },
    }, thumb, h("span", { class: "cg-style-copy" },
      h("strong", null, style.name), h("span", null, style.description)));
  }
  function redrawForm() {
    formBox.innerHTML = "";
    const nameIn = h("input", { type: "text", value: work.name, oninput(e: any) { work.name = e.target.value; } });
    const skinSel = h("select", { onchange(e: any) { work.skin = e.target.value; redrawPreview(); redrawStyleThumbnails(); } },
      ...SKINS.map((s, i) => h("option", { value: s, ...(s === work.skin ? { selected: "" } : {}) }, "skin " + (i + 1))));
    formBox.appendChild(row(field("Name", nameIn), field("Skin tone", skinSel)));
    formBox.appendChild(field("Sprite art style", h("div", { class: "cg-style-grid" },
      ...ART_STYLES.map(styleCard),
    )));
    formBox.appendChild(h("div", { class: "cg-section-title" }, "Build & wardrobe"));
    formBox.appendChild(row(field("Body", optionIn("bodyType", BODY_TYPES)),
      field("Hair", optionIn("style", Assets.HAIR_STYLES)), field("Outfit", optionIn("outfit", OUTFITS)),
      field("Accessory", optionIn("accessory", ACCESSORIES))));
    formBox.appendChild(h("div", { class: "cg-section-title" }, "Palette"));
    formBox.appendChild(row(field("Hair", colorIn("hair")), field("Eyes", colorIn("eyes")),
      field("Clothes", colorIn("shirt")), field("Pants", colorIn("pants")),
      field("Accent", colorIn("accent")), field("Hat / hood", colorIn("hat"))));
    formBox.appendChild(h("div", { class: "cg-preview" }, ...previews));
    formBox.appendChild(h("div", { class: "frow", style: "margin-top:8px; gap:6px" },
      h("button", { onclick() { const n = work.name; work = randomWork(work.artStyle); work.name = n; redrawForm(); redrawPreview(); } }, "🎨 Randomize look"),
      h("button", { onclick() { const n = work.name; work = randomWork(); work.name = n; redrawForm(); redrawPreview(); } }, "🎲 Surprise me"),
      h("button", { class: "primary", onclick: save }, editing ? "Update “" + editing.name + "”" : "Save as new character"),
      editing ? h("button", { onclick() { editing = null; redrawForm(); } }, "Cancel edit") : null,
    ));
  }
  function save() {
    if (!work.name.trim()) work.name = "Hero";
    if (editing) {
      editing.name = work.name;
      editing.params = paramsOf(work);
      Assets.registerHuman(editing.key, editing.name, editing.params);
    } else {
      const id = RA.nextId(S.proj.customChars.length ? S.proj.customChars : [{ id: 0 }]);
      const entry = { id, key: "cg" + id, name: work.name, params: paramsOf(work) };
      S.proj.customChars.push(entry);
      Assets.registerHuman(entry.key, entry.name, entry.params);
      editing = entry;
    }
    touch();
    redrawList(); redrawForm();
    flashStatus("Character saved — pick it as a sprite for actors and events");
  }
  function redrawList() {
    listEl.innerHTML = "";
    for (const c of S.proj.customChars) {
      listEl.appendChild(h("li", { class: c === editing ? "sel" : "", onclick() {
        editing = c;
        work = normalizeWork(Object.assign({ name: c.name }, c.params));
        redrawForm(); redrawPreview();
      } }, c.name));
    }
    if (!S.proj.customChars.length) listEl.appendChild(h("li", { class: "dim" }, "(none yet)"));
  }
  const side = h("div", { class: "cg-side" },
    h("div", { class: "subhead", style: "margin:0" }, "Saved characters"),
    listEl,
    h("button", { onclick() {
      if (!editing) return;
      confirmBox('Delete "' + editing.name + '"? Actors/events using it will show no sprite.', () => {
        Assets.removeCharset(editing.key);
        S.proj.customChars.splice(S.proj.customChars.indexOf(editing), 1);
        editing = null;
        touch(); redrawList(); redrawForm(); renderMap();
      });
    } }, "Delete selected"),
    h("div", { class: "dim" }, "Saved characters appear in every sprite picker (marked ★ in the Resource Manager)."),
  );
  redrawList(); redrawForm(); redrawPreview();
  modal({
    title: "Character Generator",
    wide: true,
    dismissable: false,
    content: h("div", { class: "cg-wrap" }, side, formBox),
    buttons: [{ label: "Close", primary: true }],
    onClose() {
      clearInterval(animTimer);
      Assets.removeCharset(PV_KEY);
      renderMap();
    },
  });
}
