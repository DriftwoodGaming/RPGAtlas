/* RPGAtlas — tests-unit/event-graph.test.ts
   The Atlas Graph pure core (src/shared/event-graph.ts, Phase 4 Stage A):
   port shapes, deterministic compile (chains, branches, loops, merges by
   tail duplication), cycle/overflow rejection, validation lint, node edits
   (connect/delete/normalize), and the decompile → compile identity
   round-trip. GPL-3.0-or-later. */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, expect, it } from "vitest";
import {
  COMPILE_LIMIT, addNode, compileGraph, connect, decompileCommands,
  deleteNode, emptyGraph, normalizeOut, outPortLabels, validateGraph,
} from "../src/shared/event-graph";

// Convenience: build a graph from a chain of commands, returning the nodes.
function chainGraph(...cmds: any[]) {
  const g = emptyGraph();
  const nodes = cmds.map((c, i) => addNode(g, c, i * 100, 0));
  for (let i = 0; i + 1 < nodes.length; i++) nodes[i].out[0] = nodes[i + 1].id;
  g.entry = nodes.length ? nodes[0].id : null;
  return { g, nodes };
}

describe("outPortLabels", () => {
  it("shapes ports per node type", () => {
    const g = emptyGraph();
    expect(outPortLabels(addNode(g, { t: "text", text: "hi" }, 0, 0))).toEqual(["Next"]);
    expect(outPortLabels(addNode(g, { t: "if", cond: {}, then: [], else: [] }, 0, 0)))
      .toEqual(["Then", "Else", "After"]);
    expect(outPortLabels(addNode(g, { t: "choices", options: ["A", "B", "C"], branches: [[], [], []] }, 0, 0)))
      .toEqual(["A", "B", "C", "After"]);
    expect(outPortLabels(addNode(g, { t: "loop", body: [] }, 0, 0))).toEqual(["Body", "After"]);
    expect(outPortLabels(addNode(g, null, 0, 0, "reroute"))).toEqual(["Next"]);
    expect(outPortLabels(addNode(g, null, 0, 0, "comment"))).toEqual([]);
  });

  it("normalizeOut resizes out to the port count, keeping survivors", () => {
    const g = emptyGraph();
    const n = addNode(g, { t: "choices", options: ["A", "B"], branches: [[], []] }, 0, 0);
    n.out = [5, 6, 7]; // A, B, After
    (n.cmd as any).options = ["A", "B", "C"];
    normalizeOut(n);
    expect(n.out).toEqual([5, 6, 7, null]); // After slides to a new port
  });
});

describe("compileGraph", () => {
  it("compiles a plain chain in edge order", () => {
    const { g } = chainGraph({ t: "text", text: "a" }, { t: "wait", frames: 10 }, { t: "se", name: "ok" });
    const r = compileGraph(g);
    expect(r.issues).toEqual([]);
    expect(r.commands).toEqual([{ t: "text", text: "a" }, { t: "wait", frames: 10 }, { t: "se", name: "ok" }]);
  });

  it("compiles branch ports into nested arrays and continues on After", () => {
    const g = emptyGraph();
    const iff = addNode(g, { t: "if", cond: { kind: "switch", id: 1, val: true }, then: [], else: [] }, 0, 0);
    const yes = addNode(g, { t: "text", text: "yes" }, 1, 0);
    const no = addNode(g, { t: "text", text: "no" }, 1, 1);
    const after = addNode(g, { t: "text", text: "done" }, 2, 0);
    g.entry = iff.id;
    iff.out = [yes.id, no.id, after.id];
    const r = compileGraph(g);
    expect(r.issues).toEqual([]);
    expect(r.commands).toEqual([
      { t: "if", cond: { kind: "switch", id: 1, val: true }, then: [{ t: "text", text: "yes" }], else: [{ t: "text", text: "no" }] },
      { t: "text", text: "done" },
    ]);
  });

  it("compiles choices (per-option ports) and loop (Body port)", () => {
    const g = emptyGraph();
    const ch = addNode(g, { t: "choices", options: ["Buy", "Leave"], branches: [[], []] }, 0, 0);
    const buy = addNode(g, { t: "shop", goods: [] }, 1, 0);
    const lp = addNode(g, { t: "loop", body: [] }, 1, 1);
    const spin = addNode(g, { t: "wait", frames: 1 }, 2, 1);
    const brk = addNode(g, { t: "breakLoop" }, 3, 1);
    const end = addNode(g, { t: "totitle" }, 2, 0);
    g.entry = ch.id;
    ch.out = [buy.id, lp.id, end.id];
    lp.out = [spin.id, null];
    spin.out = [brk.id];
    const r = compileGraph(g);
    expect(r.issues).toEqual([]);
    expect(r.commands).toEqual([
      {
        t: "choices", options: ["Buy", "Leave"], branches: [
          [{ t: "shop", goods: [] }],
          [{ t: "loop", body: [{ t: "wait", frames: 1 }, { t: "breakLoop" }] }],
        ],
      },
      { t: "totitle" },
    ]);
  });

  it("passes through reroute dots", () => {
    const g = emptyGraph();
    const a = addNode(g, { t: "text", text: "a" }, 0, 0);
    const dot = addNode(g, null, 1, 0, "reroute");
    const b = addNode(g, { t: "text", text: "b" }, 2, 0);
    g.entry = a.id;
    a.out = [dot.id];
    dot.out = [b.id];
    expect(compileGraph(g).commands).toEqual([{ t: "text", text: "a" }, { t: "text", text: "b" }]);
  });

  it("duplicates a merged tail once per path (diamond)", () => {
    const g = emptyGraph();
    const iff = addNode(g, { t: "if", cond: { kind: "switch", id: 1 }, then: [], else: [] }, 0, 0);
    const shared = addNode(g, { t: "text", text: "both" }, 1, 0);
    g.entry = iff.id;
    iff.out = [shared.id, shared.id, null];
    const r = compileGraph(g);
    expect(r.issues).toEqual([]);
    expect(r.commands).toEqual([
      { t: "if", cond: { kind: "switch", id: 1 }, then: [{ t: "text", text: "both" }], else: [{ t: "text", text: "both" }] },
    ]);
  });

  it("rejects cycles with an error and empty output", () => {
    const { g, nodes } = chainGraph({ t: "text", text: "a" }, { t: "text", text: "b" });
    nodes[1].out[0] = nodes[0].id; // b → a: a true cycle
    const r = compileGraph(g);
    expect(r.commands).toEqual([]);
    expect(r.issues.some((i) => i.level === "error" && /cycle/i.test(i.msg))).toBe(true);
  });

  it("rejects exponential merge fan-out via the size guard", () => {
    // 13 stacked diamonds: Di.then and Di.else both → Ni, Ni → D(i+1).
    // Tail duplication doubles per level → > COMPILE_LIMIT commands.
    const g = emptyGraph();
    const ds = [], ns = [];
    for (let i = 0; i < 13; i++) {
      ds.push(addNode(g, { t: "if", cond: { kind: "switch", id: 1 }, then: [], else: [] }, i, 0));
      ns.push(addNode(g, { t: "text", text: "n" + i }, i, 1));
    }
    for (let i = 0; i < 13; i++) {
      ds[i].out = [ns[i].id, ns[i].id, null];
      ns[i].out = [i + 1 < 13 ? ds[i + 1].id : null];
    }
    g.entry = ds[0].id;
    const r = compileGraph(g);
    expect(r.commands).toEqual([]);
    expect(r.issues.some((i) => i.level === "error" && i.msg.includes(String(COMPILE_LIMIT)))).toBe(true);
  });

  it("warns on connections to deleted nodes and compiles the rest", () => {
    const { g, nodes } = chainGraph({ t: "text", text: "a" });
    nodes[0].out[0] = 999;
    const r = compileGraph(g);
    expect(r.commands).toEqual([{ t: "text", text: "a" }]);
    expect(r.issues.some((i) => i.level === "warning")).toBe(true);
  });
});

describe("validateGraph", () => {
  it("flags a missing Start connection and unreachable nodes", () => {
    const g = emptyGraph();
    addNode(g, { t: "text", text: "island" }, 0, 0);
    addNode(g, null, 1, 1, "comment"); // comments are exempt
    const issues = validateGraph(g);
    expect(issues.some((i) => i.level === "error" && /Start/.test(i.msg))).toBe(true);
    expect(issues.filter((i) => /Unreachable/.test(i.msg)).length).toBe(1);
  });

  it("is clean for a healthy graph", () => {
    const { g } = chainGraph({ t: "text", text: "a" }, { t: "gameover" });
    expect(validateGraph(g)).toEqual([]);
  });
});

describe("graph edits", () => {
  it("connect wires ports and refuses comments as targets", () => {
    const g = emptyGraph();
    const a = addNode(g, { t: "text", text: "a" }, 0, 0);
    const b = addNode(g, { t: "text", text: "b" }, 1, 0);
    const note = addNode(g, null, 2, 0, "comment");
    expect(connect(g, a.id, 0, b.id)).toBe(true);
    expect(a.out[0]).toBe(b.id);
    expect(connect(g, a.id, 0, note.id)).toBe(false);
    expect(connect(g, a.id, 5, b.id)).toBe(false); // no such port
    expect(connect(g, a.id, 0, null)).toBe(true);  // disconnect
    expect(a.out[0]).toBe(null);
  });

  it("deleteNode heals single-output nodes and severs branch nodes", () => {
    const { g, nodes } = chainGraph({ t: "text", text: "a" }, { t: "wait", frames: 1 }, { t: "text", text: "b" });
    deleteNode(g, nodes[1].id); // single-out: a → b heals
    expect(nodes[0].out[0]).toBe(nodes[2].id);
    expect(g.nodes.length).toBe(2);

    const g2 = emptyGraph();
    const pre = addNode(g2, { t: "text", text: "pre" }, 0, 0);
    const iff = addNode(g2, { t: "if", cond: {}, then: [], else: [] }, 1, 0);
    const post = addNode(g2, { t: "text", text: "post" }, 2, 0);
    g2.entry = pre.id;
    pre.out = [iff.id];
    iff.out = [post.id, post.id, null];
    deleteNode(g2, iff.id); // multi-out: no heal, reference severed
    expect(pre.out[0]).toBe(null);

    const g3 = emptyGraph();
    const solo = addNode(g3, { t: "text", text: "s" }, 0, 0);
    g3.entry = solo.id;
    solo.out[0] = solo.id; // self-loop: heal must not resurrect the id
    deleteNode(g3, solo.id);
    expect(g3.entry).toBe(null);
  });
});

describe("decompileCommands round-trip", () => {
  // A normalized page exercising every structure: nested if inside a choices
  // branch, a loop with a nested break, plain chains before and after.
  const rich = [
    { t: "text", name: "Elder", face: "", text: "Welcome!" },
    {
      t: "choices", options: ["Fight", "Flee"], branches: [
        [
          {
            t: "if", cond: { kind: "gold", cmp: ">=", val: 50 }, then: [
              { t: "battle", troopId: 2, escape: true, lose: false },
              { t: "heal", full: true, hp: 0, mp: 0 },
            ], else: [{ t: "text", text: "Too poor." }],
          },
          { t: "se", name: "ok" },
        ],
        [],
      ],
    },
    {
      t: "loop", body: [
        { t: "var", id: 3, op: "add", val: 1, val2: 0 },
        { t: "if", cond: { kind: "var", id: 3, cmp: ">=", val: 5 }, then: [{ t: "breakLoop" }], else: [] },
        { t: "wait", frames: 6 },
      ],
    },
    { t: "transfer", mapId: 2, x: 4, y: 5, dir: 0 },
  ];

  it("compile(decompile(cmds)) is identity on normalized lists", () => {
    const g = decompileCommands(rich as any);
    const r = compileGraph(g);
    expect(r.issues).toEqual([]);
    expect(r.commands).toEqual(rich);
  });

  it("keeps branch arrays EMPTY inside graph node payloads", () => {
    const g = decompileCommands(rich as any);
    for (const n of g.nodes) {
      const c: any = n.cmd;
      if (!c) continue;
      if (c.t === "if") { expect(c.then).toEqual([]); expect(c.else).toEqual([]); }
      if (c.t === "choices") for (const b of c.branches) expect(b).toEqual([]);
      if (c.t === "loop") expect(c.body).toEqual([]);
    }
  });

  it("lays out deterministically: chains flow right, branches stack down", () => {
    const g = decompileCommands([
      { t: "text", text: "a" },
      { t: "if", cond: {}, then: [{ t: "text", text: "t" }], else: [{ t: "text", text: "e" }] },
      { t: "text", text: "z" },
    ] as any);
    const g2 = decompileCommands([
      { t: "text", text: "a" },
      { t: "if", cond: {}, then: [{ t: "text", text: "t" }], else: [{ t: "text", text: "e" }] },
      { t: "text", text: "z" },
    ] as any);
    expect(g).toEqual(g2); // fully deterministic
    const [a, iff, t, e, z] = g.nodes;
    expect(iff.x).toBeGreaterThan(a.x);
    expect(t.x).toBeGreaterThan(iff.x);
    expect(e.y).toBeGreaterThan(t.y);   // else stacks below then
    expect(z.x).toBeGreaterThan(t.x);   // After continues right of the branches
    expect(z.y).toBe(a.y);              // the spine stays straight
  });

  it("handles the empty page", () => {
    const g = decompileCommands([]);
    expect(g.entry).toBe(null);
    expect(compileGraph(g).commands).toEqual([]);
  });
});
