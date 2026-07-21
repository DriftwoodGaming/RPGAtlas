/* RPGAtlas — tests-unit/tutorials.test.ts
   Anti-rot gate for the Detailed Tutorials guides (Help ▸ Detailed Tutorials,
   src/editor/tutorials-data.ts). Asserts the guide set is complete and
   well-formed (unique ids, every field filled, balanced HTML), that the
   multiplayer-server guide teaches the same commands the Beacon server's own
   README documents (so the two can't drift apart silently), and that the
   dialog is actually reachable — registered in workspace.ts and on the Help
   menu (source-regex approach, like i18n-parity.test.ts). GPL-3.0-or-later. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TUTORIALS } from "../src/editor/tutorials-data";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("detailed tutorials", () => {
  it("ships the launch set, multiplayer server first", () => {
    expect(TUTORIALS.length).toBeGreaterThanOrEqual(6);
    expect(TUTORIALS[0].id).toBe("multiplayer-server");
    const ids = TUTORIALS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const wanted of ["play-together", "advanced-map-editor", "map-properties", "first-events", "share-your-game"]) {
      expect(ids).toContain(wanted);
    }
  });

  for (const tut of TUTORIALS) {
    it(`${tut.id}: every field filled, HTML balanced`, () => {
      for (const field of ["icon", "title", "blurb", "meta", "html"] as const) {
        expect(tut[field].trim(), `${tut.id}.${field}`).toBeTruthy();
      }
      // Hand-written HTML: assert every container tag we use is balanced so a
      // typo can't quietly swallow half a guide.
      for (const tag of ["p", "b", "i", "ol", "ul", "li", "h3", "div", "pre", "code", "kbd", "table", "tr", "th", "td"]) {
        const opens = (tut.html.match(new RegExp(`<${tag}[ >]`, "g")) || []).length;
        const closes = (tut.html.match(new RegExp(`</${tag}>`, "g")) || []).length;
        expect(opens, `${tut.id}: <${tag}> opens ${opens} vs closes ${closes}`).toBe(closes);
      }
      // Real steps, not a wall of prose.
      expect(tut.html).toContain("<ol>");
    });
  }

  it("the server guide teaches the commands the Beacon README documents", () => {
    const guide = TUTORIALS.find((t) => t.id === "multiplayer-server")!.html;
    const readme = read("server/README.md");
    expect(guide).toContain("npm install"); // README spells it "npm i" in one spot
    for (const cmd of ["npm run build", "node dist/beacon.mjs", "--port 8787", "--trust-proxy", "--max-players"]) {
      expect(guide, `guide teaches "${cmd}"`).toContain(cmd);
      expect(readme, `server README still documents "${cmd}"`).toContain(cmd);
    }
    // Same-machine testing uses loopback ws:// (socket-transport.ts refuses
    // plain ws:// off loopback, so the guide must not suggest it elsewhere).
    expect(guide).toContain("ws://localhost:8787");
    for (const worldFlag of ["--world", "--data", "--engine-events", "--zone-workers"]) {
      expect(guide, `guide covers ${worldFlag}`).toContain(worldFlag);
    }
  });

  it("is reachable: registered as a command and on the Help menu", () => {
    const workspace = read("src/editor/workspace.ts");
    expect(workspace).toMatch(/act\("tutorials", \{ label: "Detailed Tutorials"/);
    const helpMenu = workspace.match(/\{ label: "Help", items: \[([^\]]+)\] \}/);
    expect(helpMenu, "Help menu row exists").toBeTruthy();
    expect(helpMenu![1]).toContain('"tutorials"');
  });
});
