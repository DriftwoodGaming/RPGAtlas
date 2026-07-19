/* RPGAtlas — reusable Dialogue & Cutscenes authoring workspace.
   Conversation assets are trees of Line, Choice, and Cutscene nodes. The
   runtime walks them through the ordinary message/event interpreters, so the
   dedicated editor does not create a second gameplay system. GPL-3.0-or-later. */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, RA, Sfx, editorState as S } from "../editor-state";
import {
  h, tIn, nIn, sel, field, row, dbOpts, switchOpts, varOpts, cmpOpts,
  charsetOpts, typeSelOpts, SE_OPTS,
} from "../dom";
import { modal, confirmBox } from "../modals";
import { touch } from "../persistence";
import { beginEdit, endEdit } from "../edit-scope";
import type { ScopeSpec } from "../scoped-restore";
import { cmdListWidget } from "../event-editor/command-list";
import { cmdSummary } from "../event-editor/command-defs";
import { flashStatus } from "../map-editor/status";

let liveRefresh: null | (() => void) = null;
const dialogueScope: ScopeSpec = {
  label: "Dialogue edit",
  get: () => S.proj,
  skip: ["maps"],
  refresh() { if (liveRefresh) liveRefresh(); },
};

function facePreview(key: string): any {
  const box = h("span", { class: "dialogue-face-preview" });
  const index = Assets.charsetIndex(key || "");
  if (index >= 0) box.appendChild(Assets.faceCanvas(index));
  else box.appendChild(h("span", { class: "dim" }, "No portrait"));
  return box;
}

function targetOpts(dialogue: any): any[] {
  return [{ v: 0, l: "End conversation" }].concat((dialogue.nodes || []).map((node: any) => ({
    v: node.id,
    l: node.id + ": " + nodeLabel(dialogue, node),
  })));
}

function speakerOf(dialogue: any, node: any): any {
  return RA.byId(dialogue.speakers || [], Number(node.speakerId));
}

function nodeLabel(dialogue: any, node: any): string {
  if (!node) return "Missing node";
  if (node.kind === "choice") return "Choice · " + String(node.text || "Choose…").split("\n")[0].slice(0, 38);
  if (node.kind === "cutscene") return "Cutscene · " + (node.label || (node.commands || []).length + " commands");
  const speaker = speakerOf(dialogue, node);
  return (speaker ? speaker.name + " · " : "") + String(node.text || "Empty line").split("\n")[0].slice(0, 42);
}

function defaultCondition(kind: string): any {
  if (kind === "switch") return { kind, id: 1, val: true };
  if (kind === "var") return { kind, id: 1, cmp: ">=", val: 0 };
  if (kind === "quest") return { kind, questId: S.proj.quests[0] ? S.proj.quests[0].id : 0, status: "active" };
  if (kind === "item") return { kind, itemKind: "item", id: S.proj.items[0] ? S.proj.items[0].id : 0 };
  if (kind === "gold") return { kind, cmp: ">=", val: 0 };
  if (kind === "actor") return { kind, actorId: S.proj.actors[0] ? S.proj.actors[0].id : 0, check: "inParty" };
  if (kind === "region") return { kind, id: 0 };
  return { kind: "time", from: 6, to: 18 };
}

function conditionEditor(node: any, redraw: () => void): any {
  const wrap = h("div", { class: "dialogue-condition" });
  const kind = node.condition && node.condition.kind ? node.condition.kind : "";
  const kindSelect = h("select", { onchange(e: any) {
    const next = e.target.value;
    if (next) node.condition = defaultCondition(next);
    else delete node.condition;
    touch(); redraw();
  } },
  ...[
    ["", "Always"], ["switch", "Switch"], ["var", "Variable"], ["quest", "Quest status"],
    ["item", "Has item"], ["gold", "Gold"], ["actor", "Actor in party"],
    ["region", "Player region"], ["time", "Time of day"],
  ].map(([v, l]) => h("option", { value: v, ...(kind === v ? { selected: "" } : {}) }, l)));
  wrap.appendChild(field("Run when", kindSelect));
  const c = node.condition;
  if (!c) return wrap;
  if (c.kind === "switch") {
    const val = h("select", { onchange(e: any) { c.val = e.target.value === "true"; touch(); } },
      h("option", { value: "true", ...(c.val !== false ? { selected: "" } : {}) }, "ON"),
      h("option", { value: "false", ...(c.val === false ? { selected: "" } : {}) }, "OFF"));
    wrap.appendChild(row(field("Switch", sel(c, "id", switchOpts())), field("Is", val)));
  } else if (c.kind === "var") {
    wrap.appendChild(row(field("Variable", sel(c, "id", varOpts())), field("Compare", sel(c, "cmp", cmpOpts())), field("Value", nIn(c, "val"))));
  } else if (c.kind === "quest") {
    const statuses: any = ["inactive", "active", "completed", "failed", "abandoned"].map((v) => ({ v, l: v }));
    statuses.stringValues = true;
    wrap.appendChild(row(field("Quest", sel(c, "questId", dbOpts(S.proj.quests, "(none)"))), field("Status", sel(c, "status", statuses))));
  } else if (c.kind === "item") {
    const kinds: any = [{ v: "item", l: "Item" }, { v: "weapon", l: "Weapon" }, { v: "armor", l: "Armor" }];
    kinds.stringValues = true;
    const list = c.itemKind === "weapon" ? S.proj.weapons : c.itemKind === "armor" ? S.proj.armors : S.proj.items;
    wrap.appendChild(row(field("Kind", sel(c, "itemKind", kinds, redraw)), field("Entry", sel(c, "id", dbOpts(list, "(none)")))));
  } else if (c.kind === "gold") {
    // currencyId is kept only for wallet ids (≥ 2) — picking the classic gold
    // entry (id 1) restores the condition's pre-wallet shape.
    wrap.appendChild(row(
      field("Currency", sel(c, "currencyId", typeSelOpts("currencyTypes"), (v: any) => { if (Number(v) <= 1) delete c.currencyId; })),
      field("Is", sel(c, "cmp", cmpOpts())), field("Value", nIn(c, "val", 0))));
  } else if (c.kind === "actor") {
    wrap.appendChild(field("Actor", sel(c, "actorId", dbOpts(S.proj.actors, "(none)"))));
  } else if (c.kind === "region") {
    wrap.appendChild(field("Region id", nIn(c, "id", 0, 63)));
  } else if (c.kind === "time") {
    wrap.appendChild(row(field("From hour", nIn(c, "from", 0, 24)), field("Until hour", nIn(c, "to", 0, 24))));
  }
  return wrap;
}

function openSpeakerManager(dialogue: any, after: () => void): void {
  const content = h("div", { class: "dialogue-speakers" });
  function redraw() {
    content.innerHTML = "";
    content.appendChild(h("div", { class: "dim" }, "Speakers provide a reusable display name and default portrait. Individual lines can override the portrait."));
    for (const speaker of dialogue.speakers || []) {
      const portraitOpts = charsetOpts(true);
      const preview = facePreview(speaker.portrait);
      content.appendChild(h("div", { class: "dialogue-speaker-row" },
        field("Name", tIn(speaker, "name")),
        field("Portrait", sel(speaker, "portrait", portraitOpts, () => redraw())),
        preview,
        h("button", { class: "mini danger", onclick() {
          dialogue.speakers.splice(dialogue.speakers.indexOf(speaker), 1);
          for (const node of dialogue.nodes || []) if (node.speakerId === speaker.id) node.speakerId = 0;
          touch(); redraw(); after();
        } }, "Remove")));
    }
    content.appendChild(h("button", { class: "primary", onclick() {
      dialogue.speakers.push({ id: RA.nextId(dialogue.speakers), name: "Speaker", portrait: "" });
      touch(); redraw(); after();
    } }, "+ Add Speaker"));
  }
  redraw();
  modal({ title: "Dialogue Speakers", wide: true, content, onClose: after });
}

function openPreview(dialogue: any): void {
  const content = h("div", { class: "dialogue-preview" });
  let nodeId = Number(dialogue.startNodeId) || 0;
  function show(id: number) {
    nodeId = id;
    content.innerHTML = "";
    const node = RA.byId(dialogue.nodes || [], nodeId);
    if (!node) {
      content.appendChild(h("div", { class: "dialogue-preview-end" }, "End of conversation"));
      return;
    }
    if (node.condition) content.appendChild(h("div", { class: "dialogue-preview-condition" }, "Preview assumes this node's condition is true."));
    if (node.kind === "cutscene") {
      content.appendChild(h("div", { class: "dialogue-preview-cutscene" },
        h("b", null, node.label || "Cutscene commands"),
        h("div", { class: "dim" }, (node.commands || []).length + " event command(s)"),
        ...(node.commands || []).slice(0, 6).map((command: any) => h("div", { class: "dialogue-preview-command" }, cmdSummary(command)))));
      content.appendChild(h("button", { class: "primary", onclick: () => show(Number(node.nextId) || 0) }, "Continue"));
      return;
    }
    const speaker = speakerOf(dialogue, node);
    const portrait = node.portrait || (speaker && speaker.portrait) || "";
    const bubble = h("div", { class: "dialogue-preview-bubble" },
      facePreview(portrait),
      h("div", { class: "dialogue-preview-copy" },
        h("b", null, speaker ? speaker.name : "Narrator"),
        h("div", { class: "dialogue-preview-text" }, node.text || (node.kind === "choice" ? "Choose…" : "")),
        node.key ? h("code", null, node.key) : null));
    content.appendChild(bubble);
    if (node.voice) content.appendChild(h("button", { class: "mini", onclick: () => Sfx.play(node.voice) }, "▶ Voice cue"));
    if (node.kind === "choice") {
      const options = node.options || [];
      if (!options.length) content.appendChild(h("button", { onclick: () => show(Number(node.nextId) || 0) }, "Continue"));
      for (const option of options) content.appendChild(h("button", { class: "dialogue-preview-choice", onclick: () => show(Number(option.nextId) || Number(node.nextId) || 0) }, option.text || "Choice"));
    } else {
      content.appendChild(h("button", { class: "primary", onclick: () => show(Number(node.nextId) || 0) }, "Continue"));
    }
  }
  show(nodeId);
  modal({ title: "Dialogue Preview · " + dialogue.name, wide: true, content });
}

function generateKeys(dialogue: any): void {
  const slug = String(dialogue.name || "dialogue").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "") || "dialogue";
  for (const node of dialogue.nodes || []) {
    if ((node.kind === "line" || node.kind === "choice") && !node.key) node.key = "dialogue." + slug + "." + node.id;
    if (node.kind === "choice") {
      (node.options || []).forEach((option: any, index: number) => {
        if (!option.key) option.key = "dialogue." + slug + "." + node.id + ".choice." + (index + 1);
      });
    }
  }
  touch();
  flashStatus("Generated missing dialogue localization keys");
}

export function openDialogueWorkspace(initialDialogueId?: number, initialNodeId?: number): void {
  S.proj.dialogues = Array.isArray(S.proj.dialogues) ? S.proj.dialogues : [];
  const wrap = h("div", { class: "dialogue-workspace" });
  const assetPane = h("aside", { class: "dialogue-assets" });
  const treePane = h("section", { class: "dialogue-tree-pane" });
  const inspector = h("aside", { class: "dialogue-inspector" });
  wrap.append(assetPane, treePane, inspector);
  let dialogue: any = RA.byId(S.proj.dialogues, Number(initialDialogueId)) || S.proj.dialogues[0] || null;
  let node: any = dialogue && (RA.byId(dialogue.nodes, Number(initialNodeId)) || RA.byId(dialogue.nodes, dialogue.startNodeId));

  function selectDialogue(next: any) {
    dialogue = next;
    node = dialogue ? RA.byId(dialogue.nodes, dialogue.startNodeId) || dialogue.nodes[0] || null : null;
    redraw();
  }

  function addDialogue() {
    const next = RA.defaultDialogue();
    next.id = RA.nextId(S.proj.dialogues);
    next.name = "Dialogue " + next.id;
    S.proj.dialogues.push(next);
    touch(); selectDialogue(next);
  }

  function addNode(kind: string) {
    if (!dialogue) return;
    const id = RA.nextId(dialogue.nodes);
    const next: any = kind === "choice"
      ? { id, kind, speakerId: 0, portrait: "", voice: "", text: "What will you say?", key: "", nextId: 0, options: [{ text: "Choice", key: "", nextId: 0 }] }
      : kind === "cutscene"
        ? { id, kind, label: "Cutscene commands", commands: [], nextId: 0 }
        : { id, kind: "line", speakerId: 0, portrait: "", voice: "", text: "New dialogue line.", key: "", nextId: 0 };
    dialogue.nodes.push(next);
    if (!dialogue.startNodeId) dialogue.startNodeId = id;
    else if (node && !node.nextId) node.nextId = id;
    node = next;
    touch(); redraw();
  }

  function deleteNode(target: any) {
    if (!dialogue || !target) return;
    dialogue.nodes.splice(dialogue.nodes.indexOf(target), 1);
    for (const other of dialogue.nodes) {
      if (other.nextId === target.id) other.nextId = 0;
      for (const option of other.options || []) if (option.nextId === target.id) option.nextId = 0;
    }
    if (dialogue.startNodeId === target.id) dialogue.startNodeId = dialogue.nodes[0] ? dialogue.nodes[0].id : 0;
    node = RA.byId(dialogue.nodes, dialogue.startNodeId) || dialogue.nodes[0] || null;
    touch(); redraw();
  }

  function redrawAssets() {
    assetPane.innerHTML = "";
    assetPane.appendChild(h("div", { class: "dialogue-pane-title" }, "Dialogue Assets"));
    assetPane.appendChild(h("button", { class: "primary", onclick: addDialogue }, "+ New Dialogue"));
    const list = h("div", { class: "dialogue-asset-list" });
    for (const entry of S.proj.dialogues) list.appendChild(h("button", {
      class: "dialogue-asset" + (entry === dialogue ? " sel" : ""), onclick: () => selectDialogue(entry),
    }, h("b", null, entry.name || "Dialogue"), h("span", { class: "dim" }, (entry.nodes || []).length + " nodes")));
    if (!S.proj.dialogues.length) list.appendChild(h("div", { class: "dim dialogue-empty" }, "Create a reusable conversation or cutscene to begin."));
    assetPane.appendChild(list);
  }

  function redrawTree() {
    treePane.innerHTML = "";
    if (!dialogue) {
      treePane.appendChild(h("div", { class: "dialogue-empty" }, "No dialogue asset selected."));
      return;
    }
    const nameInput = tIn(dialogue, "name");
    nameInput.addEventListener("input", redrawAssets);
    treePane.appendChild(h("div", { class: "dialogue-asset-head" },
      field("Asset name", nameInput),
      h("button", { onclick: () => openSpeakerManager(dialogue, redraw) }, "Speakers…"),
      h("button", { onclick() { generateKeys(dialogue); redraw(); } }, "Generate keys"),
      h("button", { class: "primary", onclick: () => openPreview(dialogue) }, "▶ Preview"),
      h("button", { class: "danger", onclick() {
        confirmBox("Delete dialogue \"" + dialogue.name + "\"? Play Dialogue commands that reference it will become empty references.", () => {
          S.proj.dialogues.splice(S.proj.dialogues.indexOf(dialogue), 1); touch(); selectDialogue(S.proj.dialogues[0] || null);
        });
      } }, "Delete")));
    treePane.appendChild(field("Production notes", tIn(dialogue, "description")));
    treePane.appendChild(h("div", { class: "dialogue-node-toolbar" },
      h("b", null, "Conversation tree"),
      h("button", { onclick: () => addNode("line") }, "+ Line"),
      h("button", { onclick: () => addNode("choice") }, "+ Choice"),
      h("button", { onclick: () => addNode("cutscene") }, "+ Cutscene")));
    const tree = h("div", { class: "dialogue-tree" });
    const rendered = new Set<number>();
    const visiting = new Set<number>();
    const renderBranch = (id: number, depth: number, branchLabel?: string) => {
      if (!id) {
        tree.appendChild(h("div", { class: "dialogue-end", style: "--depth:" + depth }, branchLabel ? branchLabel + " → End" : "End"));
        return;
      }
      const current = RA.byId(dialogue.nodes, id);
      if (!current) {
        tree.appendChild(h("div", { class: "dialogue-end warning", style: "--depth:" + depth }, "Missing node #" + id));
        return;
      }
      if (visiting.has(id) || rendered.has(id)) {
        tree.appendChild(h("button", { class: "dialogue-node-ref", style: "--depth:" + depth, onclick: () => { node = current; redraw(); } }, (branchLabel ? branchLabel + " → " : "") + "↪ Node " + id));
        return;
      }
      visiting.add(id); rendered.add(id);
      const speaker = speakerOf(dialogue, current);
      const card = h("button", {
        class: "dialogue-node-card " + current.kind + (current === node ? " sel" : ""),
        style: "--depth:" + depth,
        onclick: () => { node = current; redraw(); },
      },
      h("span", { class: "dialogue-node-id" }, (current.id === dialogue.startNodeId ? "START · " : "") + "#" + current.id),
      branchLabel ? h("span", { class: "dialogue-branch-label" }, branchLabel) : null,
      h("b", null, current.kind === "cutscene" ? (current.label || "Cutscene") : current.kind === "choice" ? "Choice" : (speaker ? speaker.name : "Narrator")),
      h("span", null, current.kind === "cutscene" ? (current.commands || []).length + " command(s)" : String(current.text || "").split("\n")[0].slice(0, 70)),
      current.condition ? h("span", { class: "dialogue-node-badge" }, "Conditional") : null,
      current.voice ? h("span", { class: "dialogue-node-badge" }, "Voice") : null,
      current.key ? h("code", null, current.key) : null);
      tree.appendChild(card);
      if (current.kind === "choice") {
        const options = current.options || [];
        if (!options.length) renderBranch(Number(current.nextId) || 0, depth + 1, "No options");
        options.forEach((option: any) => renderBranch(Number(option.nextId) || Number(current.nextId) || 0, depth + 1, option.text || "Choice"));
      } else renderBranch(Number(current.nextId) || 0, depth, undefined);
      visiting.delete(id);
    };
    renderBranch(Number(dialogue.startNodeId) || 0, 0);
    const unreachable = dialogue.nodes.filter((entry: any) => !rendered.has(entry.id));
    if (unreachable.length) {
      tree.appendChild(h("div", { class: "dialogue-unreachable-title" }, "Unlinked nodes"));
      for (const entry of unreachable) tree.appendChild(h("button", { class: "dialogue-node-card unlinked" + (entry === node ? " sel" : ""), onclick: () => { node = entry; redraw(); } }, "#" + entry.id + " · " + nodeLabel(dialogue, entry)));
    }
    treePane.appendChild(tree);
  }

  function redrawInspector() {
    inspector.innerHTML = "";
    inspector.appendChild(h("div", { class: "dialogue-pane-title" }, "Node Inspector"));
    if (!dialogue || !node) {
      inspector.appendChild(h("div", { class: "dim dialogue-empty" }, "Select a node to edit its dialogue, routing, conditions, portrait, voice, or cutscene commands."));
      return;
    }
    inspector.appendChild(h("div", { class: "dialogue-inspector-actions" },
      h("button", { class: node.id === dialogue.startNodeId ? "sel" : "", onclick() { dialogue.startNodeId = node.id; touch(); redraw(); } }, node.id === dialogue.startNodeId ? "✓ Start node" : "Make start"),
      h("button", { class: "danger", onclick: () => confirmBox("Delete node #" + node.id + "?", () => deleteNode(node)) }, "Delete node")));
    inspector.appendChild(conditionEditor(node, redrawInspector));
    if (node.kind === "cutscene") {
      inspector.appendChild(field("Label", tIn(node, "label")));
      inspector.appendChild(field("After commands", sel(node, "nextId", targetOpts(dialogue), redrawTree)));
      inspector.appendChild(h("div", { class: "subhead" }, "Event commands"));
      inspector.appendChild(h("div", { class: "dim" }, "Use the same movement, camera, pictures, audio, waits, switches, and other commands available on event pages and Atlas Graph."));
      node.commands = Array.isArray(node.commands) ? node.commands : [];
      inspector.appendChild(cmdListWidget(() => node.commands, { snapshot() {} }).el);
      return;
    }
    const speakers = [{ v: 0, l: "Narrator / no speaker" }].concat((dialogue.speakers || []).map((speaker: any) => ({ v: speaker.id, l: speaker.name })));
    const portraits = charsetOpts(true);
    const voices: any = SE_OPTS();
    voices.unshift({ v: "", l: "(none)" });
    inspector.appendChild(field("Speaker", sel(node, "speakerId", speakers, redraw)));
    inspector.appendChild(row(field("Portrait override", sel(node, "portrait", portraits, redrawInspector)), facePreview(node.portrait || (speakerOf(dialogue, node) || {}).portrait || "")));
    inspector.appendChild(row(field("Voice cue", sel(node, "voice", voices)), node.voice ? h("button", { class: "mini", onclick: () => Sfx.play(node.voice) }, "▶") : null));
    const textarea = h("textarea", { rows: node.kind === "choice" ? 3 : 6, oninput(e: any) { node.text = e.target.value; touch(); redrawTree(); } }, node.text || "");
    inspector.appendChild(field(node.kind === "choice" ? "Prompt" : "Dialogue text", textarea));
    inspector.appendChild(field("Localization key", tIn(node, "key")));
    inspector.appendChild(field(node.kind === "choice" ? "Fallback when no option is linked" : "Next node", sel(node, "nextId", targetOpts(dialogue), redrawTree)));
    if (node.kind === "choice") {
      inspector.appendChild(h("div", { class: "subhead" }, "Player choices"));
      node.options = Array.isArray(node.options) ? node.options : [];
      const options = h("div", { class: "dialogue-choice-options" });
      node.options.forEach((option: any, index: number) => options.appendChild(h("div", { class: "dialogue-choice-row" },
        h("span", { class: "dialogue-choice-number" }, String(index + 1)),
        field("Text", tIn(option, "text")),
        field("Localization key", tIn(option, "key")),
        field("Goes to", sel(option, "nextId", targetOpts(dialogue), redrawTree)),
        h("button", { class: "mini danger", onclick() { node.options.splice(index, 1); touch(); redraw(); } }, "×"))));
      options.appendChild(h("button", { onclick() { node.options.push({ text: "Choice", key: "", nextId: 0 }); touch(); redraw(); } }, "+ Add choice"));
      inspector.appendChild(options);
    }
  }

  function redraw() { redrawAssets(); redrawTree(); redrawInspector(); }
  liveRefresh = redraw;
  redraw();
  beginEdit(dialogueScope);
  modal({
    title: "Dialogue & Cutscenes",
    content: wrap,
    class: "dialogue-modal",
    dismissable: false,
    onClose() { liveRefresh = null; endEdit(); },
    buttons: [{ label: "Close", primary: true }],
  });
}
