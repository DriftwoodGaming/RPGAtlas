/* RPGAtlas — tests-unit/export-web.test.ts
   Phase 7 Stage E: the web/itch.io/PWA zip export — CRC-32 vectors, the
   STORE zip writer's byte layout (parsed back structurally), and the PWA
   pieces from js/standalone-template.mjs. GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import { buildWebZipEntries, buildZip, crc32 } from "../src/editor/export-web";
import {
  assembleStandaloneHtml,
  injectPwaHooks,
  serviceWorkerFor,
  webManifestFor,
} from "../js/standalone-template.mjs";

const enc = (s: string) => new TextEncoder().encode(s);

describe("crc32", () => {
  it("matches the IEEE test vectors", () => {
    expect(crc32(enc(""))).toBe(0);
    expect(crc32(enc("123456789"))).toBe(0xcbf43926);
    expect(crc32(enc("hello"))).toBe(0x3610a686);
  });
});

/** Minimal structural reader for STORE zips (test-side inverse of buildZip). */
function parseZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdAt = bytes.length - 22;
  expect(view.getUint32(eocdAt, true)).toBe(0x06054b50);
  const count = view.getUint16(eocdAt + 8, true);
  const centralOffset = view.getUint32(eocdAt + 16, true);
  const entries: Array<{ name: string; crc: number; size: number; offset: number; data: Uint8Array }> = [];
  let p = centralOffset;
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(p, true)).toBe(0x02014b50);
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const offset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    // Local header cross-check + data slice.
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    const localNameLen = view.getUint16(offset + 26, true);
    expect(localNameLen).toBe(nameLen);
    const dataStart = offset + 30 + nameLen;
    entries.push({ name, crc, size, offset, data: bytes.subarray(dataStart, dataStart + size) });
    p += 46 + nameLen;
  }
  return entries;
}

describe("buildZip", () => {
  it("writes a structurally valid STORE zip that round-trips content and CRCs", () => {
    const zip = buildZip([
      { name: "index.html", data: enc("<html>hi</html>") },
      { name: "sw.js", data: enc("// worker") },
    ]);
    const entries = parseZip(zip);
    expect(entries.map((e) => e.name)).toEqual(["index.html", "sw.js"]);
    expect(new TextDecoder().decode(entries[0].data)).toBe("<html>hi</html>");
    expect(entries[0].crc).toBe(crc32(enc("<html>hi</html>")));
    expect(entries[1].crc).toBe(crc32(enc("// worker")));
  });
  it("is deterministic for a fixed date", () => {
    const mk = () => buildZip([{ name: "a", data: enc("x") }], new Date(2026, 5, 1, 8, 30, 0));
    expect(Buffer.from(mk()).equals(Buffer.from(mk()))).toBe(true);
  });
});

describe("standalone template + PWA pieces", () => {
  const project = { system: { title: "Sea: Quest!" }, maps: [] };
  const files = ["/*css*/", "/*classic1*/", "/*classic2*/", "/*bundle*/"];
  const game = assembleStandaloneHtml(project, files, [{ type: "audio", name: "x", src: "data:" }], "data:icon");

  it("assembles the single-file game html (title, payloads, script order)", () => {
    expect(game.baseName).toBe("Sea_Quest");
    expect(game.gameId).toBe("sea_quest");
    expect(game.html).toContain("<title>Sea: Quest!</title>");
    expect(game.html).toContain('<style>/*css*/</style>');
    expect(game.html).toContain('id="rpgatlas-project"');
    expect(game.html).toContain('window.RPGATLAS_ICON_SET = "data:icon"');
    // classic scripts inline in order, bundle last as a module
    const c1 = game.html.indexOf("/*classic1*/");
    const c2 = game.html.indexOf("/*classic2*/");
    const bundle = game.html.indexOf('<script type="module">/*bundle*/');
    expect(c1).toBeGreaterThan(0);
    expect(c2).toBeGreaterThan(c1);
    expect(bundle).toBeGreaterThan(c2);
    // no PWA wiring in the plain single-file export
    expect(game.html).not.toContain("manifest.webmanifest");
  });

  it("injectPwaHooks adds manifest link + SW registration once, in <head>", () => {
    const wired = injectPwaHooks(game.html);
    expect(wired).toContain('<link rel="manifest" href="manifest.webmanifest">');
    expect(wired).toContain('navigator.serviceWorker.register("./sw.js")');
    expect(wired.indexOf("</head>")).toBeGreaterThan(wired.indexOf("manifest.webmanifest"));
    // file:// double-click of an extracted zip must not try to register
    expect(wired).toContain('location.protocol !== "file:"');
  });

  it("webManifestFor shapes an installable manifest", () => {
    const manifest = JSON.parse(webManifestFor("A Very Long Game Title"));
    expect(manifest.name).toBe("A Very Long Game Title");
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.start_url).toBe("./index.html");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons).toHaveLength(2);
  });

  it("serviceWorkerFor versions its cache by content", () => {
    const sw = serviceWorkerFor("abc123");
    expect(sw).toContain('"rpgatlas-game-abc123"');
    expect(sw).toContain('"./index.html"');
    expect(sw).toContain("caches.match");
  });

  it("buildWebZipEntries produces the itch.io layout with a content-versioned SW", () => {
    const template = { injectPwaHooks, webManifestFor, serviceWorkerFor };
    const entries = buildWebZipEntries(game.html, "Sea: Quest!", template, enc("png1"), enc("png2"));
    expect(entries.map((e) => e.name)).toEqual([
      "index.html", "manifest.webmanifest", "sw.js", "icon-192.png", "icon-512.png",
    ]);
    const swText = new TextDecoder().decode(entries[2].data);
    const expectedVersion = crc32(entries[0].data).toString(16);
    expect(swText).toContain("rpgatlas-game-" + expectedVersion);
  });
});
