/* RPGAtlas — tests-unit/editor-dock-layout.test.ts
   The pure dock layout tree + edits (src/editor/dock/layout.ts, Phase 3
   Stage B). Structure is asserted through summarize(): `row[tabs(a*)|tabs(b)]`,
   active panel starred, floats appended as `+float(...)`. GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import {
  tabs, split, defaultLayout, collectPanels, hasPanel, findTabsWith, normalize,
  dockSplit, dockTab, floatPanel, dockFloatTab, showPanel, closePanel,
  validateLayout, summarize, type DockLayout, type SplitNode, type TabsNode,
} from "../src/editor/dock/layout";

const clone = (l: DockLayout): DockLayout => JSON.parse(JSON.stringify(l));
const KNOWN = ["maps", "tiles", "map", "hd", "world"];

describe("defaultLayout", () => {
  it("is the left-column-beside-map arrangement", () => {
    expect(summarize(defaultLayout())).toBe("row[col[tabs(maps*)|tabs(tiles*)]|tabs(map*)]");
    expect(collectPanels(defaultLayout()).sort()).toEqual(["map", "maps", "tiles"]);
  });
});

describe("normalize", () => {
  it("collapses single-child splits", () => {
    expect(summarize(normalize(split("row", [tabs(["a"])]))!)).toBe("tabs(a*)");
  });
  it("drops empty tabs and prunes empty splits", () => {
    const n = normalize(split("row", [tabs([]), tabs(["b"])]));
    expect(summarize(n!)).toBe("tabs(b*)");
  });
  it("flattens nested same-direction splits, scaling sizes", () => {
    const inner = split("row", [tabs(["b"]), tabs(["c"])], [1, 1]);
    const outer = split("row", [tabs(["a"]), inner], [2, 2]);
    const n = normalize(outer) as SplitNode;
    expect(summarize(n)).toBe("row[tabs(a*)|tabs(b*)|tabs(c*)]");
    expect(n.sizes[0]).toBeCloseTo(2);
    expect(n.sizes[1]).toBeCloseTo(1); // 2 * (1/2)
    expect(n.sizes[2]).toBeCloseTo(1);
  });
  it("repairs an invalid active pointer", () => {
    const t = tabs(["a", "b"]);
    t.active = "gone";
    expect((normalize(t) as TabsNode).active).toBe("a");
  });
});

describe("dockSplit", () => {
  it("splits a target tabs, dragged panel before/after by side", () => {
    const l = defaultLayout();
    const mapTabs = findTabsWith(l.root, "map")!;
    dockSplit(l, mapTabs, "tiles", "S"); // move Tiles below Map
    expect(summarize(l)).toBe("row[tabs(maps*)|col[tabs(map*)|tabs(tiles*)]]");
    // Tiles left its old home and the single-child column collapsed.
  });
  it("places the panel first when side is N or W (and same-dir nesting flattens)", () => {
    const l = defaultLayout();
    dockSplit(l, findTabsWith(l.root, "map")!, "hd", "W");
    // A row-split dropped inside the outer row flattens: hd becomes a column
    // between the left stack and the map.
    expect(summarize(l)).toBe("row[col[tabs(maps*)|tabs(tiles*)]|tabs(hd*)|tabs(map*)]");
  });
});

describe("dockTab", () => {
  it("adds the dragged panel as an active tab in the target", () => {
    const l = defaultLayout();
    dockTab(l, findTabsWith(l.root, "map")!, "tiles");
    expect(summarize(l)).toBe("row[tabs(maps*)|tabs(map,tiles*)]");
  });
  it("moving the last panel out of a region removes the empty region", () => {
    const l = defaultLayout();
    dockTab(l, findTabsWith(l.root, "maps")!, "map"); // map joins maps' group; map's old group empties
    // The map's now-empty right region is pruned, so the outer row collapses to
    // just the left column.
    expect(summarize(l)).toBe("col[tabs(maps,map*)|tabs(tiles*)]");
  });
});

describe("floats", () => {
  it("detaches a panel into a floating window and can re-tab into it", () => {
    const l = defaultLayout();
    floatPanel(l, "tiles", { x: 100, y: 120, w: 400, h: 300 }, "fl0");
    expect(summarize(l)).toBe("row[tabs(maps*)|tabs(map*)]+float(tiles*)");
    dockFloatTab(l, "fl0", "maps");
    expect(summarize(l)).toBe("tabs(map*)+float(tiles,maps*)");
  });
  it("closing the last float panel drops the window", () => {
    const l = defaultLayout();
    floatPanel(l, "tiles", { x: 0, y: 0, w: 1, h: 1 }, "fl0");
    closePanel(l, "tiles");
    expect(l.floats.length).toBe(0);
    expect(hasPanel(l, "tiles")).toBe(false);
  });
});

describe("showPanel", () => {
  it("adds a missing panel beside map and reports it added", () => {
    const l = defaultLayout();
    expect(showPanel(l, "hd")).toBe(true);
    expect(summarize(l)).toBe("row[col[tabs(maps*)|tabs(tiles*)]|tabs(map,hd*)]");
  });
  it("is a no-op-activate when the panel already exists", () => {
    const l = defaultLayout();
    dockTab(l, findTabsWith(l.root, "map")!, "tiles"); // map,tiles* ; active tiles
    expect(showPanel(l, "map")).toBe(false);
    expect(summarize(l)).toBe("row[tabs(maps*)|tabs(map*,tiles)]"); // map re-activated
  });
});

describe("validateLayout", () => {
  it("round-trips a real layout through JSON", () => {
    const l = defaultLayout();
    dockTab(l, findTabsWith(l.root, "map")!, "tiles");
    floatPanel(l, "maps", { x: 10, y: 20, w: 300, h: 200 }, "fl0");
    const back = validateLayout(clone(l), KNOWN)!;
    expect(summarize(back)).toBe(summarize(l));
  });
  it("drops unknown panels and duplicates, keeping first occurrence", () => {
    const raw = { root: split("row", [tabs(["map", "bogus"]), tabs(["map", "tiles"])]), floats: [] };
    const back = validateLayout(raw, KNOWN)!;
    // "bogus" is unknown; the second "map" is a duplicate — both dropped.
    expect(summarize(back)).toBe("row[tabs(map*)|tabs(tiles*)]");
  });
  it("returns null for junk so the caller can fall back", () => {
    expect(validateLayout(null, KNOWN)).toBeNull();
    expect(validateLayout({ root: { type: "tabs", panels: ["nope"] } }, KNOWN)).toBeNull();
    expect(validateLayout("garbage", KNOWN)).toBeNull();
  });
});
