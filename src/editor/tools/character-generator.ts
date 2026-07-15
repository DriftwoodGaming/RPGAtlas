/* RPGAtlas - Character Generator
   Builds original four- or eight-direction walking sprites, previews every
   facing, exports PNG sheets, and saves generated characters into the project.
   Copyright (C) 2026 RPGAtlas contributors - GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, RA, TILE, editorState as S } from "../editor-state";
import { h, field, row } from "../dom";
import { modal, confirmBox } from "../modals";
import { touch } from "../persistence";
import { renderMap } from "../map-editor/map-render";
import { flashStatus } from "../map-editor/status";

const DIRECTIONS = [
  { id: 0, short: "S", name: "Down", area: "south" },
  { id: 1, short: "W", name: "Left", area: "west" },
  { id: 2, short: "E", name: "Right", area: "east" },
  { id: 3, short: "N", name: "Up", area: "north" },
  { id: 4, short: "SW", name: "Down-left", area: "southwest" },
  { id: 5, short: "SE", name: "Down-right", area: "southeast" },
  { id: 6, short: "NW", name: "Up-left", area: "northwest" },
  { id: 7, short: "NE", name: "Up-right", area: "northeast" },
];

function downloadCanvas(canvas: HTMLCanvasElement, name: string): void {
  const anchor = document.createElement("a");
  anchor.href = canvas.toDataURL("image/png");
  anchor.download = name + ".png";
  anchor.click();
}

function fileSafeName(value: string): string {
  return String(value || "character").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "character";
}

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
    return {
      name: "New Hero", directions: 8, artStyle: artStyle || pick(ART_STYLES).id,
      bodyType: pick(BODY_TYPES), outfit: pick(OUTFITS), accessory: pick(ACCESSORIES),
      style: pick(Assets.HAIR_STYLES), skin: pick(SKINS), hair: pick(HAIR_COLORS), eyes: pick(EYE_COLORS),
      shirt: palette.shirt, pants: palette.pants, hat: palette.hat, accent: palette.accent,
    };
  }

  function normalizeWork(value: any) {
    const fallback = randomWork("classic");
    return Object.assign(fallback, value || {}, {
      directions: value?.directions === 8 ? 8 : 4,
      artStyle: ART_STYLES.some((style: any) => style.id === value?.artStyle) ? value.artStyle : "classic",
      bodyType: BODY_TYPES.includes(value?.bodyType) ? value.bodyType : "balanced",
      outfit: OUTFITS.includes(value?.outfit) ? value.outfit : "tunic",
      accessory: ACCESSORIES.includes(value?.accessory) ? value.accessory : "none",
    });
  }

  let editing: any = null;
  let work: any = randomWork();
  let selectedDir = 0;
  let animF = 0;
  const PV_KEY = "cg_preview";
  const directionCanvases = DIRECTIONS.map(() => {
    const canvas = document.createElement("canvas");
    canvas.width = TILE; canvas.height = TILE;
    return canvas;
  });
  const stageCanvas = document.createElement("canvas");
  stageCanvas.width = TILE; stageCanvas.height = TILE;

  function paramsOf(value: any) {
    return {
      directions: value.directions, artStyle: value.artStyle, bodyType: value.bodyType,
      outfit: value.outfit, accessory: value.accessory, skin: value.skin, hair: value.hair,
      eyes: value.eyes, style: value.style, shirt: value.shirt, pants: value.pants,
      hat: value.hat, accent: value.accent,
    };
  }

  function redrawPreview() {
    const idx = Assets.registerHuman(PV_KEY, "preview", paramsOf(work));
    const frame = [0, 1, 2, 1][animF % 4];
    directionCanvases.forEach((canvas, dir) => {
      const g = canvas.getContext("2d")!;
      g.clearRect(0, 0, TILE, TILE);
      // Show the potential diagonal art even while four-direction save mode is selected.
      g.drawImage(Assets.charFrameCanvas(idx, dir, frame, true), 0, 0);
    });
    const stageG = stageCanvas.getContext("2d")!;
    stageG.clearRect(0, 0, TILE, TILE);
    stageG.drawImage(Assets.charFrameCanvas(idx, selectedDir, frame, true), 0, 0);
  }

  const animTimer = setInterval(() => { animF++; redrawPreview(); }, 170);
  const formBox = h("div", { class: "cg-form" });
  const listEl = h("ul", { class: "dblist cg-saved-list" });

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

  function directionModeCard(count: number, title: string, description: string) {
    return h("button", {
      type: "button",
      class: "cg-direction-mode" + (work.directions === count ? " sel" : ""),
      "aria-label": count + " directions",
      "aria-pressed": work.directions === count ? "true" : "false",
      onclick() {
        work.directions = count;
        if (count === 4 && selectedDir >= 4) selectedDir = 0;
        redrawForm(); redrawPreview();
      },
    }, h("strong", null, title), h("span", null, description));
  }

  function directionGrid() {
    const grid = h("div", { class: "cg-direction-grid" });
    for (const direction of DIRECTIONS) {
      const diagonal = direction.id >= 4;
      grid.appendChild(h("button", {
        type: "button",
        class: "cg-direction-cell" + (selectedDir === direction.id ? " sel" : "") +
          (diagonal && work.directions !== 8 ? " disabled-preview" : ""),
        style: "grid-area:" + direction.area,
        title: direction.name + (diagonal && work.directions !== 8 ? " - select 8 directions to save this facing" : ""),
        onclick() {
          selectedDir = direction.id;
          if (diagonal && work.directions !== 8) work.directions = 8;
          redrawForm(); redrawPreview();
        },
      }, directionCanvases[direction.id], h("span", null, direction.short)));
    }
    grid.appendChild(h("div", { class: "cg-direction-center", style: "grid-area:center" },
      h("strong", null, work.directions + " DIR"), h("span", null, "3 frames each")));
    return grid;
  }

  function exportSheet(directions: 4 | 8) {
    const idx = Assets.registerHuman(PV_KEY, "preview", paramsOf(work));
    downloadCanvas(Assets.charSheetCanvas(idx, directions), fileSafeName(work.name) + "-" + directions + "dir");
    flashStatus("Exported " + directions + "-direction sprite sheet (3 x " + directions + " frames)");
  }

  function redrawForm() {
    formBox.innerHTML = "";
    const nameIn = h("input", { type: "text", value: work.name, oninput(e: any) { work.name = e.target.value; } });
    const skinSel = h("select", { onchange(e: any) {
      work.skin = e.target.value; redrawPreview(); redrawStyleThumbnails();
    } }, ...SKINS.map((skin, i) => h("option", {
      value: skin, ...(skin === work.skin ? { selected: "" } : {}),
    }, "Skin " + (i + 1))));

    const controls = h("div", { class: "cg-controls" });
    controls.appendChild(row(field("Character name", nameIn), field("Skin tone", skinSel)));
    controls.appendChild(field("Sprite directions", h("div", { class: "cg-direction-modes" },
      directionModeCard(4, "4 directions", "Classic D / L / R / U sheet"),
      directionModeCard(8, "8 directions", "Adds four true diagonal rows"),
    )));
    controls.appendChild(field("Sprite art style", h("div", { class: "cg-style-grid" },
      ...ART_STYLES.map(styleCard),
    )));
    controls.appendChild(h("div", { class: "cg-section-title" }, "Build & wardrobe"));
    controls.appendChild(row(field("Body", optionIn("bodyType", BODY_TYPES)),
      field("Hair", optionIn("style", Assets.HAIR_STYLES)), field("Outfit", optionIn("outfit", OUTFITS)),
      field("Accessory", optionIn("accessory", ACCESSORIES))));
    controls.appendChild(h("div", { class: "cg-section-title" }, "Palette"));
    controls.appendChild(row(field("Hair", colorIn("hair")), field("Eyes", colorIn("eyes")),
      field("Clothes", colorIn("shirt")), field("Pants", colorIn("pants")),
      field("Accent", colorIn("accent")), field("Hat / hood", colorIn("hat"))));

    const selected = DIRECTIONS[selectedDir];
    const previewPanel = h("div", { class: "cg-preview-panel" },
      h("div", { class: "cg-preview-heading" },
        h("div", null, h("strong", null, selected.name), h("span", null, "Animated walking preview")),
        h("span", { class: "cg-sheet-size" }, "144 x " + (work.directions * TILE) + " PNG")),
      h("div", { class: "cg-preview-stage" }, stageCanvas),
      directionGrid(),
      h("div", { class: "cg-export-box" },
        h("div", null, h("strong", null, "Export sprite sheet"),
          h("span", null, "Rows: D, L, R, U, DL, DR, UL, UR")),
        h("div", { class: "cg-export-actions" },
          h("button", { type: "button", onclick() { exportSheet(4); } }, "Export 4-dir PNG"),
          h("button", { type: "button", class: "primary", onclick() { exportSheet(8); } }, "Export 8-dir PNG"))),
    );

    formBox.appendChild(h("div", { class: "cg-studio" }, controls, previewPanel));
    formBox.appendChild(h("div", { class: "frow cg-actions" },
      h("button", { onclick() {
        const name = work.name, directions = work.directions;
        work = randomWork(work.artStyle); work.name = name; work.directions = directions;
        redrawForm(); redrawPreview();
      } }, "Randomize look"),
      h("button", { onclick() {
        const name = work.name, directions = work.directions;
        work = randomWork(); work.name = name; work.directions = directions;
        redrawForm(); redrawPreview();
      } }, "Surprise me"),
      h("span", { class: "cg-action-spacer" }),
      h("button", { class: "primary", onclick: save }, editing ? "Update " + editing.name : "Save as new character"),
      editing ? h("button", { onclick() { editing = null; work = randomWork(); redrawForm(); redrawPreview(); } }, "Cancel edit") : null,
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
    touch(); redrawList(); redrawForm(); redrawPreview();
    flashStatus(work.directions + "-direction character saved - available in every sprite picker");
  }

  function redrawList() {
    listEl.innerHTML = "";
    for (const character of S.proj.customChars) {
      const directions = character.params?.directions === 8 ? 8 : 4;
      listEl.appendChild(h("li", {
        class: character === editing ? "sel" : "",
        onclick() {
          editing = character;
          work = normalizeWork(Object.assign({ name: character.name }, character.params));
          selectedDir = 0;
          redrawForm(); redrawPreview();
        },
      }, h("span", null, character.name), h("small", null, directions + "-dir")));
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
        editing = null; work = randomWork();
        touch(); redrawList(); redrawForm(); redrawPreview(); renderMap();
      });
    } }, "Delete selected"),
    h("div", { class: "dim" }, "Saved characters appear in every sprite picker and are marked with a star in the Resource Manager."),
  );

  redrawList(); redrawForm(); redrawPreview();
  modal({
    title: "Character Generator",
    wide: true,
    dismissable: false,
    class: "character-generator-modal",
    content: h("div", { class: "cg-wrap" }, side, formBox),
    buttons: [{ label: "Close", primary: true }],
    onClose() {
      clearInterval(animTimer);
      Assets.removeCharset(PV_KEY);
      renderMap();
    },
  });
}
