/* RPGAtlas — src/editor/tools/audio-manager.ts
   The Audio Manager modal: preview procedural sound effects and music themes.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 3):
   logic unchanged, closure vars routed through editor-state.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Music, Sfx } from "../editor-state";
import { h, SE_NAMES } from "../dom";
import { modal } from "../modals";
import { libraryMetas } from "../../shared/asset-library";

export function openAudioManager() {
  let playingTheme: any = null;
  const seGrid = h("div", { class: "audio-grid" });
  for (const n of SE_NAMES) seGrid.appendChild(h("button", { onclick() { Sfx.play(n); } }, "▶ " + n));
  const musGrid = h("div", { class: "audio-grid" });
  const musBtns: any[] = [];
  const stopMusic = () => { Music.stop(); playingTheme = null; musBtns.forEach((x) => x.b.classList.remove("playing")); };
  const musicBtn = (value: any, label: string) => {
    const b = h("button", { onclick() {
      if (playingTheme === value) { stopMusic(); return; }
      Music.play(value);
      playingTheme = value;
      musBtns.forEach((x) => x.b.classList.toggle("playing", x.t === playingTheme));
    } }, "♪ " + label);
    musBtns.push({ t: value, b });
    return b;
  };
  for (const t of Sfx.THEMES) musGrid.appendChild(musicBtn(t, t));

  // Imported library audio (Phase 6): previews route through the streamed
  // deck — bgm/bgs loop like themes, se/me one-shot like effects.
  const libAudio = libraryMetas().filter((m) => m.type === "audio");
  const libGrid = h("div", { class: "audio-grid" });
  for (const m of libAudio) {
    const kind = m.kind || "se";
    libGrid.appendChild(kind === "bgm" || kind === "bgs"
      ? musicBtn(m.key, m.name + " (" + kind.toUpperCase() + ")")
      : h("button", { onclick() { Sfx.play(m.key); } }, "▶ " + m.name + " (" + kind.toUpperCase() + ")"));
  }

  modal({
    title: "Audio Manager",
    wide: true,
    content: h("div", null,
      h("div", { class: "subhead" }, "Sound effects (used by the Play Sound event command)"),
      seGrid,
      h("div", { class: "subhead" }, "Music themes (click to preview, click again to stop)"),
      musGrid,
      h("div", { class: "subhead" }, "Imported audio (Tools ▸ Asset Browser)"),
      libAudio.length ? libGrid : h("div", { class: "dim" }, "No imported audio yet — drop OGG/MP3/WAV files on the Asset Browser."),
      h("div", { class: "dim", style: "margin-top:10px" },
        "Assign a theme per map in Map Properties (imported music appears there too, plus per-map ambience layers). Battles always use “battle”, the title screen “title”, defeat “gameover”. Built-in audio is generated procedurally — no files, no copyright."),
    ),
    onClose() { stopMusic(); },
  });
}
