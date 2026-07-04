/* RPGAtlas — src/editor/advanced/adv-dialogs.ts
   Small shared dialogs for the Advanced Map Editor (Phase 8). A single-field
   name prompt reused by the Layers panel (rename layer) and the Stamps rail
   (name/rename a stamp), so the modal wiring lives in one place. modal()
   localizes the Save/Cancel labels itself and detects Cancel by RAW label, so
   we pass label: "Save" / "Cancel" unlocalized (house rule).
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { t } from "../editor-state";
import { h } from "../dom";
import { modal } from "../modals";

/** Prompt for a single non-empty name. Calls onOk(name) on Save. */
export function nameDialog(title: string, initial: string, onOk: (name: string) => void) {
  const input = h("input", {
    type: "text", value: initial, placeholder: t("Name"),
    style: "width:100%", spellcheck: "false",
  }) as HTMLInputElement;
  modal({
    title,
    content: input,
    buttons: [
      { label: "Save", primary: true, onClick(c: any) {
        const name = input.value.trim();
        if (!name) return;
        onOk(name); c();
      } },
      { label: "Cancel" },
    ],
    dialogKeys: true,
  });
  setTimeout(() => { input.focus(); input.select(); }, 0);
}
