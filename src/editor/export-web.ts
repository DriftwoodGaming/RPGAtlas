/* RPGAtlas — src/editor/export-web.ts
   The web/itch.io/PWA zip export (Phase 7 Stage E). A minimal STORE-method
   zip writer (local headers + central directory + CRC-32) — dependency-free,
   deterministic given a fixed date, vitest-covered — plus the icon renderer
   and the export orchestrator. The zip layout is exactly what itch.io's
   HTML5 uploader wants (index.html at the root) and doubles as an
   installable, offline-capable PWA (manifest + service worker + icons from
   js/standalone-template.mjs). GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- CRC-32 (standard IEEE 802.3 polynomial, table-driven) ----
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: (((date.getFullYear() - 1980) & 0x7f) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Build a STORE-method (uncompressed) zip. Game HTML is one big string that
 *  zips poorly anyway once assets are data-URLs; STORE keeps this writer tiny
 *  and dependency-free, and itch.io/browsers don't care. */
export function buildZip(entries: ZipEntry[], date: Date = new Date(2026, 0, 1, 12, 0, 0)): Uint8Array {
  const { time, date: dosDate } = dosDateTime(date);
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  let centralSize = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // method: STORE
    local.setUint16(10, time, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, entry.data.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);

    const cdir = new DataView(new ArrayBuffer(46));
    cdir.setUint32(0, 0x02014b50, true);
    cdir.setUint16(4, 20, true); // version made by
    cdir.setUint16(6, 20, true); // version needed
    cdir.setUint16(8, 0x0800, true);
    cdir.setUint16(10, 0, true);
    cdir.setUint16(12, time, true);
    cdir.setUint16(14, dosDate, true);
    cdir.setUint32(16, crc, true);
    cdir.setUint32(20, entry.data.length, true);
    cdir.setUint32(24, entry.data.length, true);
    cdir.setUint16(28, nameBytes.length, true);
    cdir.setUint32(42, offset, true); // local header offset (30..41 stay 0)

    chunks.push(new Uint8Array(local.buffer), nameBytes, entry.data);
    central.push(new Uint8Array(cdir.buffer), nameBytes);
    offset += 30 + nameBytes.length + entry.data.length;
    centralSize += 46 + nameBytes.length;
  }

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, offset, true);
  chunks.push(...central, new Uint8Array(eocd.buffer));

  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

/** Render the PWA icon at the given size: dark rounded tile, warm ring, and
 *  the game title's initial in the title-screen gold. */
export function renderGameIcon(title: string, size: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  const r = size * 0.18;
  g.fillStyle = "#101018";
  g.beginPath();
  g.moveTo(r, 0);
  g.arcTo(size, 0, size, size, r);
  g.arcTo(size, size, 0, size, r);
  g.arcTo(0, size, 0, 0, r);
  g.arcTo(0, 0, size, 0, r);
  g.fill();
  g.strokeStyle = "rgba(255,216,106,0.85)";
  g.lineWidth = Math.max(2, size * 0.02);
  g.beginPath();
  g.arc(size / 2, size / 2, size * 0.38, 0, Math.PI * 2);
  g.stroke();
  const initial = (String(title).trim()[0] || "A").toUpperCase();
  g.fillStyle = "#ffd86a";
  g.font = "900 " + Math.round(size * 0.44) + "px 'Segoe UI', system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(initial, size / 2, size / 2 + size * 0.02);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("icon render failed"))), "image/png"),
  );
}

/** Assemble the web zip: index.html (PWA-wired game), manifest, service
 *  worker (cache version = content CRC so re-exports update installs), and
 *  the two icons. Pure over its inputs — the orchestrator below feeds it. */
export function buildWebZipEntries(
  gameHtml: string,
  title: string,
  template: any, // js/standalone-template.mjs namespace
  icon192: Uint8Array,
  icon512: Uint8Array,
): ZipEntry[] {
  const encoder = new TextEncoder();
  const htmlBytes = encoder.encode(template.injectPwaHooks(gameHtml));
  const version = crc32(htmlBytes).toString(16);
  return [
    { name: "index.html", data: htmlBytes },
    { name: "manifest.webmanifest", data: encoder.encode(template.webManifestFor(title)) },
    { name: "sw.js", data: encoder.encode(template.serviceWorkerFor(version)) },
    { name: "icon-192.png", data: icon192 },
    { name: "icon-512.png", data: icon512 },
  ];
}
