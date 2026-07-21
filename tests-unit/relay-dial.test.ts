/* RPGAtlas — tests-unit/relay-dial.test.ts
   Post-2.0 hotfix: the Node-first / Worker-fallback dial sequencing, headless.
   connect + fetchJson are injected fakes, so this proves the STATE MACHINE —
   which URLs get dialed, in what order, exactly once — in the fast pool. The
   real-socket proof against a CF-shaped server is relay-cf-fallback.test.ts
   (test:net). GPL-3.0. */

import { describe, expect, it } from "vitest";
import { dialRelay, type DialSocketHandlers } from "../src/engine/net/relay-dial";
import type { Transport } from "../src/shared/net/transport";

const CODE = "BCD123XYZ"; // canonical alphabet (room-code.ts: no vowels), 9 chars

interface Dialed {
  url: string;
  h: DialSocketHandlers;
  transport: Transport;
  closed: boolean;
}

/** A connect spy: records every dial and hands back an inert Transport. */
function fakeConnect(): { dials: Dialed[]; connect(url: string, h: DialSocketHandlers): Transport } {
  const dials: Dialed[] = [];
  return {
    dials,
    connect(url: string, h: DialSocketHandlers): Transport {
      const rec: Dialed = {
        url,
        h,
        closed: false,
        transport: {
          send(): void { /* inert */ },
          onMessage(): void { /* inert */ },
          close(): void { rec.closed = true; },
          isOpen: true,
        },
      };
      dials.push(rec);
      return rec.transport;
    },
  };
}

interface Harness {
  dials: Dialed[];
  attached: Array<{ transport: Transport; code: string | undefined }>;
  teardowns: number;
  offline: number;
  newFetches: string[];
  settle(): void;
}

/** Drive dialRelay with fakes. `fetchJson` resolves/rejects via `mint`. */
function dial(opts: { code?: string; mint?: () => Promise<unknown> }): Harness {
  const fc = fakeConnect();
  const h: Harness = {
    dials: fc.dials,
    attached: [],
    teardowns: 0,
    offline: 0,
    newFetches: [],
    settle: () => {},
  };
  const d = dialRelay({
    url: "wss://relay.example",
    code: opts.code,
    connect: fc.connect,
    fetchJson: (url) => {
      h.newFetches.push(url);
      return (opts.mint || (() => Promise.resolve({ code: CODE })))();
    },
    attach: (transport, code) => h.attached.push({ transport, code }),
    teardown: () => {
      h.teardowns++;
      // co-op's teardown closes the failed attempt's client → its transport.
      const last = h.dials[h.dials.length - 1];
      if (last) last.transport.close();
    },
    onOffline: () => h.offline++,
  });
  h.settle = () => d.settle();
  return h;
}

/** Let the fetch-then chain of the CREATE fallback run. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("relay-dial: Node-first, Worker fallback", () => {
  it("a healthy bare dial attaches once and never falls back", () => {
    const h = dial({});
    expect(h.dials.map((d) => d.url)).toEqual(["wss://relay.example"]);
    expect(h.attached).toHaveLength(1);
    expect(h.attached[0].code).toBeUndefined();
    h.settle(); // welcome arrived
    h.dials[0].h.onClose(); // a much later real disconnect
    expect(h.newFetches).toHaveLength(0);
    expect(h.offline).toBe(0);
    expect(h.attached).toHaveLength(1);
  });

  it("CREATE: bare failure mints a code via /new and re-dials /rt", async () => {
    const h = dial({});
    h.dials[0].h.onError(); // the Worker's 200 health answer kills the handshake
    h.dials[0].h.onClose(); // …and close follows; the fallback must run ONCE
    await tick();
    expect(h.teardowns).toBe(1);
    expect(h.newFetches).toEqual(["https://relay.example/new"]);
    expect(h.dials.map((d) => d.url)).toEqual([
      "wss://relay.example",
      "wss://relay.example/rt?code=" + CODE,
    ]);
    expect(h.attached).toHaveLength(2);
    expect(h.attached[1].code).toBe(CODE);
    expect(h.offline).toBe(0);
  });

  it("JOIN: bare failure re-dials /rt with the typed code, no /new fetch", () => {
    const h = dial({ code: CODE });
    expect(h.attached[0].code).toBe(CODE); // Node style carries the code too
    h.dials[0].h.onClose();
    expect(h.newFetches).toHaveLength(0);
    expect(h.dials[1].url).toBe("wss://relay.example/rt?code=" + CODE);
    expect(h.attached[1].code).toBe(CODE);
  });

  it("both dial styles dead ⇒ onOffline exactly once", () => {
    const h = dial({ code: CODE });
    h.dials[0].h.onError();
    h.dials[0].h.onClose();
    h.dials[1].h.onError();
    h.dials[1].h.onClose();
    expect(h.offline).toBe(1);
    expect(h.attached).toHaveLength(2);
  });

  it("CREATE with /new unreachable ⇒ onOffline", async () => {
    const h = dial({ mint: () => Promise.reject(new Error("refused")) });
    h.dials[0].h.onClose();
    await tick();
    expect(h.offline).toBe(1);
    expect(h.dials).toHaveLength(1); // no /rt dial without a code
  });

  it("CREATE with a garbage /new answer ⇒ onOffline (never dials a bad code)", async () => {
    for (const body of [{}, { code: 42 }, { code: "not-canonical!" }, "nope", null]) {
      const h = dial({ mint: () => Promise.resolve(body) });
      h.dials[0].h.onClose();
      await tick();
      expect(h.offline).toBe(1);
      expect(h.dials).toHaveLength(1);
    }
  });

  it("settle() during the /new fetch cancels the fallback dial", async () => {
    let release: (v: unknown) => void = () => {};
    const h = dial({ mint: () => new Promise((r) => { release = r; }) });
    h.dials[0].h.onClose();
    h.settle(); // e.g. the player cancelled / another path won
    release({ code: CODE });
    await tick();
    expect(h.dials).toHaveLength(1);
    expect(h.offline).toBe(0);
  });

  it("settle() before a socket event suppresses fallback and offline alike", () => {
    const h = dial({ code: CODE });
    h.settle(); // a server frame (e.g. `error`) decided the dial
    h.dials[0].h.onClose(); // the server closing the socket afterwards
    expect(h.dials).toHaveLength(1);
    expect(h.offline).toBe(0);
  });

  it("a connector that throws counts as a socket failure (both attempts)", () => {
    let calls = 0;
    const h: { offline: number } = { offline: 0 };
    dialRelay({
      url: "wss://relay.example",
      code: CODE,
      connect: () => { calls++; throw new Error("refused"); },
      fetchJson: () => Promise.resolve({}),
      attach: () => {},
      teardown: () => {},
      onOffline: () => h.offline++,
    });
    expect(calls).toBe(2); // bare, then /rt
    expect(h.offline).toBe(1);
  });
});
