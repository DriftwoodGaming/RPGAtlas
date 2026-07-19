/* RPGAtlas - Generator Hub editor UI.
   Browses original combinatorial name generators, produces batches, and keeps
   a small browser-local favorites shelf for convenient worldbuilding.
   Copyright (C) 2026 RPGAtlas contributors - GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { h } from "../dom";
import { modal } from "../modals";
import { flashStatus } from "../map-editor/status";
import {
  GENERATOR_DEFINITIONS, GeneratorDefinition, GeneratedName, GeneratorOptions,
  GeneratorStyle, definitionById, estimatePossibilities, generateNames,
} from "./name-generator-data";

const FAVORITES_KEY = "rpgatlas_generator_favorites";
const CATEGORIES = ["Gear", "Magic", "People", "Places", "Adventure"] as const;

interface HubOptions extends GeneratorOptions {
  count: number;
  storyHooks: boolean;
}

interface Favorite extends GeneratedName {
  generatorId: string;
}

const STYLE_INFO: Array<{ id: GeneratorStyle; label: string; description: string }> = [
  { id: "concise", label: "Concise", description: "Short, table-ready names" },
  { id: "evocative", label: "Evocative", description: "Layered names with lore" },
  { id: "legendary", label: "Legendary", description: "Titles and epic epithets" },
];

function defaultOptions(definition: GeneratorDefinition): HubOptions {
  return {
    subtype: "", tone: definition.tones[0], style: "evocative", worldWord: "",
    alliteration: false, prefixThe: false, count: 10, storyHooks: true,
  };
}

function loadFavorites(): Favorite[] {
  try {
    const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((entry) => entry && typeof entry.generatorId === "string" &&
      typeof entry.name === "string" && typeof entry.hook === "string").slice(0, 200);
  } catch {
    return [];
  }
}

function saveFavorites(favorites: Favorite[]): void {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites.slice(0, 200))); } catch { /* optional shelf */ }
}

async function copyText(value: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else {
      const area = h("textarea", { style: "position:fixed;left:-9999px;top:0" }, value);
      document.body.appendChild(area); area.select(); document.execCommand("copy"); area.remove();
    }
    flashStatus("Copied generator text to clipboard");
  } catch {
    flashStatus("Clipboard access was blocked by the browser");
  }
}

function compactNumber(value: number): string {
  if (value < 100_000) return value.toLocaleString();
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function selectInput(label: string, value: string, options: Array<{ value: string; label: string }>, onChange: (value: string) => void) {
  const input = h("select", { "aria-label": label, onchange(e: any) { onChange(e.target.value); } },
    ...options.map((option) => h("option", {
      value: option.value, ...(option.value === value ? { selected: "" } : {}),
    }, option.label)));
  return h("label", { class: "gen-field" }, h("span", null, label), input);
}

function toggle(label: string, description: string, checked: boolean, onChange: (checked: boolean) => void) {
  return h("label", { class: "gen-toggle" },
    h("input", {
      type: "checkbox", ...(checked ? { checked: "" } : {}),
      onchange(e: any) { onChange(e.target.checked); },
    }),
    h("span", null, h("strong", null, label), h("small", null, description)));
}

export function openGeneratorHub(initialId = "weapon"): void {
  let selected = definitionById(initialId);
  const favorites = loadFavorites();
  let showFavorites = false;
  const optionsById = new Map<string, HubOptions>();
  const resultsById = new Map<string, GeneratedName[]>();

  const railList = h("div", { class: "gen-rail-list" });
  const searchInput = h("input", {
    type: "search", class: "gen-search", placeholder: "Find a generator...", "aria-label": "Find a generator",
    oninput(e: any) { renderRail(e.target.value); },
  });
  const rail = h("aside", { class: "gen-rail" },
    h("div", { class: "gen-rail-head" },
      h("strong", null, GENERATOR_DEFINITIONS.length + " creative generators"),
      h("span", null, "Names, lore hooks, and millions of combinations")),
    searchInput, railList);
  const main = h("section", { class: "gen-main" });
  const root = h("div", { class: "gen-hub" }, rail, main);

  function options(): HubOptions {
    let value = optionsById.get(selected.id);
    if (!value) { value = defaultOptions(selected); optionsById.set(selected.id, value); }
    return value;
  }

  function ensureResults(): GeneratedName[] {
    let results = resultsById.get(selected.id);
    if (!results) {
      results = generateNames(selected, options(), options().count);
      resultsById.set(selected.id, results);
    }
    return results;
  }

  function generateCurrent(): void {
    showFavorites = false;
    resultsById.set(selected.id, generateNames(selected, options(), options().count));
    renderMain();
  }

  function choose(definition: GeneratorDefinition): void {
    selected = definition;
    showFavorites = false;
    ensureResults();
    renderRail(searchInput.value);
    renderMain();
  }

  function renderRail(query = ""): void {
    railList.innerHTML = "";
    const needle = query.trim().toLowerCase();
    for (const category of CATEGORIES) {
      const matches = GENERATOR_DEFINITIONS.filter((definition) => definition.category === category &&
        (!needle || (definition.name + " " + definition.description).toLowerCase().includes(needle)));
      if (!matches.length) continue;
      railList.appendChild(h("div", { class: "gen-category" }, category));
      for (const definition of matches) {
        railList.appendChild(h("button", {
          type: "button", class: "gen-choice" + (definition.id === selected.id ? " sel" : ""),
          "aria-pressed": definition.id === selected.id ? "true" : "false",
          onclick() { choose(definition); },
        }, h("span", { class: "gen-choice-icon", "aria-hidden": "true" }, definition.symbol),
        h("span", null, h("strong", null, definition.shortName), h("small", null, definition.description))));
      }
    }
    if (!railList.childElementCount) railList.appendChild(h("div", { class: "gen-empty" }, "No generators match that search."));
  }

  function isFavorite(output: GeneratedName): boolean {
    return favorites.some((favorite) => favorite.generatorId === selected.id && favorite.name === output.name);
  }

  function toggleFavorite(output: GeneratedName): void {
    const index = favorites.findIndex((favorite) => favorite.generatorId === selected.id && favorite.name === output.name);
    if (index >= 0) favorites.splice(index, 1);
    else favorites.unshift({ generatorId: selected.id, name: output.name, hook: output.hook });
    saveFavorites(favorites);
    renderMain();
  }

  function surprise(): void {
    selected = GENERATOR_DEFINITIONS[Math.floor(Math.random() * GENERATOR_DEFINITIONS.length)];
    const value = defaultOptions(selected);
    value.subtype = selected.types[Math.floor(Math.random() * selected.types.length)].id;
    value.tone = selected.tones[Math.floor(Math.random() * selected.tones.length)];
    value.style = STYLE_INFO[Math.floor(Math.random() * STYLE_INFO.length)].id;
    value.alliteration = Math.random() > 0.65;
    value.prefixThe = Math.random() > 0.75;
    optionsById.set(selected.id, value);
    resultsById.set(selected.id, generateNames(selected, value, value.count));
    showFavorites = false;
    renderRail(searchInput.value); renderMain();
  }

  function renderMain(): void {
    main.innerHTML = "";
    const value = options();
    const savedForGenerator = favorites.filter((favorite) => favorite.generatorId === selected.id);
    const outputs: GeneratedName[] = showFavorites ? savedForGenerator : ensureResults();
    const possibilityCount = estimatePossibilities(selected, value);

    const hero = h("div", { class: "gen-hero" },
      h("div", { class: "gen-hero-symbol", "aria-hidden": "true" }, selected.symbol),
      h("div", { class: "gen-hero-copy" }, h("span", null, selected.category), h("h2", null, selected.name),
        h("p", null, selected.description)),
      h("div", { class: "gen-possibilities", title: possibilityCount.toLocaleString() + " template combinations with the current filters" },
        h("strong", null, compactNumber(possibilityCount) + "+"), h("span", null, "possibilities")));

    const subtypeOptions = [{ value: "", label: "Any " + selected.typeLabel.toLowerCase() }]
      .concat(selected.types.map((entry) => ({ value: entry.id, label: entry.label })));
    const toneOptions = selected.tones.map((tone) => ({ value: tone, label: tone[0].toUpperCase() + tone.slice(1) }));
    const batchOptions = [5, 10, 20].map((count) => ({ value: String(count), label: count + " results" }));

    const styleCards = h("div", { class: "gen-style-grid", role: "group", "aria-label": "Naming style" },
      ...STYLE_INFO.map((style) => h("button", {
        type: "button", class: "gen-style" + (value.style === style.id ? " sel" : ""),
        "aria-pressed": value.style === style.id ? "true" : "false",
        onclick() { value.style = style.id; generateCurrent(); },
      }, h("strong", null, style.label), h("span", null, style.description))));

    const keyword = h("input", {
      type: "text", value: value.worldWord || "", maxlength: "48", placeholder: "e.g. Everbloom, Red Moon, House Veyr",
      "aria-label": "World keyword",
      onchange(e: any) { value.worldWord = e.target.value; },
      onkeydown(e: KeyboardEvent) { if (e.key === "Enter") { e.preventDefault(); value.worldWord = (e.target as HTMLInputElement).value; generateCurrent(); } },
    });

    const controls = h("div", { class: "gen-controls" },
      h("div", { class: "gen-control-grid" },
        selectInput(selected.typeLabel, value.subtype || "", subtypeOptions, (next) => { value.subtype = next; generateCurrent(); }),
        selectInput("Tone", String(value.tone), toneOptions, (next) => { value.tone = next as any; generateCurrent(); }),
        selectInput("Batch size", String(value.count), batchOptions, (next) => { value.count = Number(next); generateCurrent(); }),
        h("label", { class: "gen-field gen-keyword" }, h("span", null, "World keyword (optional)"), keyword)),
      styleCards,
      h("div", { class: "gen-toggle-grid" },
        toggle("Alliteration", "Match the main words when the word bank allows it.", !!value.alliteration, (checked) => { value.alliteration = checked; generateCurrent(); }),
        toggle('Prefix "The"', "Give every result a formal title treatment.", !!value.prefixThe, (checked) => { value.prefixThe = checked; generateCurrent(); }),
        toggle("Story hooks", "Show a ready-to-use detail beneath every name.", value.storyHooks, (checked) => { value.storyHooks = checked; renderMain(); })));

    const resultActions = h("div", { class: "gen-result-actions" },
      h("button", { type: "button", class: "primary gen-generate", onclick: generateCurrent }, "Generate " + value.count),
      h("button", { type: "button", onclick: surprise }, "Surprise me"),
      h("button", {
        type: "button", class: showFavorites ? "sel" : "", "aria-pressed": showFavorites ? "true" : "false",
        onclick() { showFavorites = !showFavorites; renderMain(); },
      }, "★ Saved (" + savedForGenerator.length + ")"),
      h("span", { class: "gen-action-spacer" }),
      h("button", {
        type: "button", ...(outputs.length ? {} : { disabled: "" }), onclick() {
          const text = outputs.map((output) => value.storyHooks ? output.name + " — " + output.hook : output.name).join("\n");
          void copyText(text);
        },
      }, "Copy batch"));

    const resultList = h("div", { class: "gen-results", "aria-live": "polite" });
    if (!outputs.length) {
      resultList.appendChild(h("div", { class: "gen-empty gen-empty-results" },
        showFavorites ? "No saved names for this generator yet. Star a result to keep it here." : "Generate a batch to begin."));
    } else {
      outputs.forEach((output, index) => {
        const favorite = isFavorite(output);
        resultList.appendChild(h("article", { class: "gen-result" },
          h("span", { class: "gen-result-number" }, String(index + 1).padStart(2, "0")),
          h("div", { class: "gen-result-copy" }, h("strong", null, output.name),
            value.storyHooks ? h("p", null, output.hook) : null),
          h("button", {
            type: "button", class: "gen-star" + (favorite ? " saved" : ""),
            title: favorite ? "Remove saved name" : "Save name", "aria-label": favorite ? "Remove saved name" : "Save name",
            "aria-pressed": favorite ? "true" : "false", onclick() { toggleFavorite(output); },
          }, favorite ? "★" : "☆"),
          h("button", { type: "button", class: "gen-copy", "aria-label": "Copy " + output.name, onclick() {
            void copyText(value.storyHooks ? output.name + " — " + output.hook : output.name);
          } }, "Copy")));
      });
    }

    main.append(hero, controls, resultActions, resultList);
  }

  renderRail(); ensureResults(); renderMain();
  modal({
    title: "Generator Hub", wide: true, class: "generator-hub-modal", content: root,
    buttons: [{ label: "Close", primary: true }],
  });
}
