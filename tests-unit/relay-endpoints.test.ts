/* RPGAtlas — tests-unit/relay-endpoints.test.ts
   Post-2.0 hotfix: the pure Worker-endpoint derivation (cfRelayEndpoints).
   Fast pool — no sockets, no DOM. GPL-3.0. */

import { describe, expect, it } from "vitest";
import { cfRelayEndpoints } from "../src/shared/net/relay-endpoints";

describe("cfRelayEndpoints", () => {
  it("derives /new (https) and /rt (wss) from a bare wss relay URL", () => {
    const eps = cfRelayEndpoints("wss://beacon.rpgatlas.app")!;
    expect(eps.newUrl).toBe("https://beacon.rpgatlas.app/new");
    expect(eps.rtUrl("ABC123XYZ")).toBe("wss://beacon.rpgatlas.app/rt?code=ABC123XYZ");
  });

  it("maps dev loopback ws:// to http:// for /new and keeps ws:// for /rt", () => {
    const eps = cfRelayEndpoints("ws://127.0.0.1:8787")!;
    expect(eps.newUrl).toBe("http://127.0.0.1:8787/new");
    expect(eps.rtUrl("XYZ")).toBe("ws://127.0.0.1:8787/rt?code=XYZ");
  });

  it("preserves an explicit port and a proxy path prefix; strips a trailing slash", () => {
    const eps = cfRelayEndpoints("wss://play.example.com:8443/beacon/")!;
    expect(eps.newUrl).toBe("https://play.example.com:8443/beacon/new");
    expect(eps.rtUrl("C0DE")).toBe("wss://play.example.com:8443/beacon/rt?code=C0DE");
  });

  it("drops query and hash from the base (the Worker routes on the path)", () => {
    const eps = cfRelayEndpoints("wss://h.example/?src=game#x")!;
    expect(eps.newUrl).toBe("https://h.example/new");
    expect(eps.rtUrl("C")).toBe("wss://h.example/rt?code=C");
  });

  it("URL-encodes the code defensively", () => {
    const eps = cfRelayEndpoints("wss://h.example")!;
    expect(eps.rtUrl("A B&C")).toBe("wss://h.example/rt?code=A%20B%26C");
  });

  it("returns null for non-WebSocket or unparseable URLs", () => {
    expect(cfRelayEndpoints("https://h.example")).toBeNull();
    expect(cfRelayEndpoints("not a url")).toBeNull();
    expect(cfRelayEndpoints("")).toBeNull();
  });
});
