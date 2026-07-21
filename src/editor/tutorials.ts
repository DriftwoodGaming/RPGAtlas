/* RPGAtlas — src/editor/tutorials.ts
   Help ▸ Detailed Tutorials: a picker of long-form, step-by-step guides for
   newer developers (multiplayer server setup, Play Together, the Advanced Map
   Editor, Map Properties, first events, exporting). Content lives in
   tutorials-data.ts (pure data, node-testable); this module is only the
   dialog: an index of cards and a per-guide view with back navigation, both
   rendered into one modal body. Styling: .helpbox plus the .tut-* block in
   css/editor.css. Guide bodies are English-only by design (like Quick Help);
   the menu label is chrome, localized in js/editor/i18n.js.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

import { h } from "./dom";
import { modal } from "./modals";
import { TUTORIALS, Tutorial } from "./tutorials-data";

export function openTutorials(startId?: string) {
  const body = h("div", { class: "helpbox tutorials" });

  // The scrolling element is the .modal-body the dialog wraps around `body`;
  // jump it back to the top on every view switch (no-op before first mount).
  const scrollTop = () => { if (body.parentElement) body.parentElement.scrollTop = 0; };

  function showIndex() {
    body.innerHTML = "";
    scrollTop();
    body.appendChild(h("p", { class: "tut-intro" },
      "Pick a guide. Each one is small steps you can follow along with — no experience needed, ",
      "and you can't break anything (", h("kbd", null, "Ctrl+Z"), " undoes edits)."));
    for (const tut of TUTORIALS) {
      body.appendChild(h("button", { class: "tut-card", onclick: () => showGuide(tut) },
        h("span", { class: "tut-card-icon" }, tut.icon),
        h("span", { class: "tut-card-text" },
          h("span", { class: "tut-card-title" }, tut.title),
          h("span", { class: "tut-card-blurb" }, tut.blurb),
          h("span", { class: "tut-card-meta" }, tut.meta))));
    }
    body.appendChild(h("p", { class: "dim tut-outro" },
      "Want even more depth? The RPGAtlas wiki covers every corner of the editor — ",
      "and Quick Help (Help menu) is the one-page cheat sheet."));
  }

  function showGuide(tut: Tutorial) {
    body.innerHTML = "";
    scrollTop();
    body.appendChild(h("button", { class: "mini tut-back", onclick: showIndex }, "← All Tutorials"));
    body.appendChild(h("h2", { class: "tut-title" }, tut.icon + " " + tut.title));
    body.appendChild(h("div", { class: "tut-meta" }, tut.meta));
    body.appendChild(h("div", { html: tut.html }));
    body.appendChild(h("button", { class: "mini tut-back", onclick: showIndex }, "← All Tutorials"));
  }

  const start = startId && TUTORIALS.find((tut) => tut.id === startId);
  if (start) showGuide(start); else showIndex();

  modal({
    title: "Detailed Tutorials",
    wide: true,
    content: body,
    buttons: [{ label: "Close", primary: true }],
  });
}
