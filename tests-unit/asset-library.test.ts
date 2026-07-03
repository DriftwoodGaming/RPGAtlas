/* RPGAtlas — tests-unit/asset-library.test.ts
   Phase 6 Stage A: the asset-library service — slugging/collisions, content-
   hash dedupe, the used-asset audit walker, rename reference rewriting, and
   the embed/strip/consume file round-trip — over a fake in-memory AssetStore.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, describe, expect, it } from "vitest";
import type { AssetMeta, AssetStore } from "../src/shared/services";
import {
  assetKeyOf,
  blobToDataUrl,
  collisionName,
  consumeEmbeddedAssets,
  dataUrlToBlob,
  embedUsedAssets,
  guessAudioKind,
  importAssets,
  initAssetLibrary,
  libraryMetas,
  parseAssetKey,
  removeAsset,
  renameAsset,
  rewriteAssetKey,
  slugName,
  stripEmbeddedAssets,
  usedAssetKeys,
} from "../src/shared/asset-library";

class FakeStore implements AssetStore {
  metas = new Map<string, AssetMeta>();
  blobs = new Map<string, Blob>();
  async list() {
    return Array.from(this.metas.values());
  }
  async get(key: string) {
    return this.blobs.get(key) || null;
  }
  async put(meta: AssetMeta, blob: Blob) {
    this.metas.set(meta.key, meta);
    this.blobs.set(meta.key, blob);
  }
  async remove(key: string) {
    this.metas.delete(key);
    this.blobs.delete(key);
  }
  async setMeta(meta: AssetMeta) {
    this.metas.set(meta.key, meta);
  }
}

const noProbe = async () => {};
const png = (text: string) => new Blob([text], { type: "image/png" });
const ogg = (text: string) => new Blob([text], { type: "audio/ogg" });

let store: FakeStore;
beforeEach(async () => {
  store = new FakeStore();
  await initAssetLibrary(store);
});

describe("naming", () => {
  it("slugs file names, stripping path + extension", () => {
    expect(slugName("C:\\art\\Hero Sprite (final).PNG")).toBe("hero-sprite-final");
    expect(slugName("cliff.pass.png")).toBe("cliff.pass");
    expect(slugName("../weird/..name..png")).toBe("name");
    expect(slugName("###.png")).toBe("asset");
  });
  it("suffixes collisions before the tile convention suffix", () => {
    const taken = new Set(["rock", "rock-2", "cliff.pass"]);
    expect(collisionName("rock", taken)).toBe("rock-3");
    expect(collisionName("cliff.pass", taken)).toBe("cliff-2.pass");
    expect(collisionName("new", taken)).toBe("new");
  });
  it("builds and parses keys", () => {
    expect(assetKeyOf("audio", "boom")).toBe("asset:audio/boom");
    expect(parseAssetKey("asset:tilesets/lava.pass")).toEqual({ type: "tilesets", name: "lava.pass" });
    expect(parseAssetKey("tile:grass")).toBeNull();
  });
  it("guesses audio kinds from names", () => {
    expect(guessAudioKind("forest-bgm.ogg")).toBe("bgm");
    expect(guessAudioKind("rain_ambience.ogg")).toBe("bgs");
    expect(guessAudioKind("victory-jingle.ogg")).toBe("me");
    expect(guessAudioKind("sword-hit.wav")).toBe("se");
  });
});

describe("data URLs", () => {
  it("round-trips blob → data URL → blob", async () => {
    const src = await blobToDataUrl(png("pixels!"));
    expect(src.startsWith("data:image/png;base64,")).toBe(true);
    const back = dataUrlToBlob(src);
    expect(back.type).toBe("image/png");
    expect(await back.text()).toBe("pixels!");
  });
});

describe("imports", () => {
  it("imports images under the given type with probing metadata", async () => {
    const [meta] = await importAssets(
      [{ blob: png("a"), name: "Hero.png", type: "characters", tags: ["hero"] }],
      { probe: noProbe },
    );
    expect(meta.key).toBe("asset:characters/hero");
    expect(meta.tags).toEqual(["hero"]);
    expect(meta.bytes).toBe(1);
    expect(store.metas.has(meta.key)).toBe(true);
  });
  it("routes audio by mime/extension without an explicit type", async () => {
    const [byMime] = await importAssets([{ blob: ogg("x"), name: "boom.ogg" }], { probe: noProbe });
    expect(byMime.type).toBe("audio");
    expect(byMime.kind).toBe("se");
    const [byExt] = await importAssets(
      [{ blob: new Blob(["y"]), name: "town-bgm.mp3" }],
      { probe: noProbe },
    );
    expect(byExt.type).toBe("audio");
    expect(byExt.kind).toBe("bgm");
  });
  it("rejects images without a target type", async () => {
    await expect(importAssets([{ blob: png("a"), name: "x.png" }], { probe: noProbe })).rejects.toThrow(
      /target type/,
    );
  });
  it("dedupes identical content by hash and merges tags", async () => {
    const [first] = await importAssets(
      [{ blob: png("same"), name: "one.png", type: "enemies", tags: ["a"] }],
      { probe: noProbe },
    );
    const [second] = await importAssets(
      [{ blob: png("same"), name: "two.png", type: "enemies", tags: ["b"] }],
      { probe: noProbe },
    );
    expect(second.key).toBe(first.key);
    expect(second.tags.sort()).toEqual(["a", "b"]);
    expect(libraryMetas()).toHaveLength(1);
  });
  it("suffixes a name collision with different content", async () => {
    await importAssets([{ blob: png("one"), name: "rock.png", type: "tilesets" }], { probe: noProbe });
    const [two] = await importAssets([{ blob: png("two"), name: "rock.png", type: "tilesets" }], {
      probe: noProbe,
    });
    expect(two.key).toBe("asset:tilesets/rock-2");
  });
});

function fixtureProject(): any {
  return {
    meta: { engine: "rpgatlas" },
    system: {
      vehicles: { boat: { charset: "asset:characters/boat-skin" } },
      sounds: { cursor: "asset:audio/click" },
    },
    assets: { tiles: { "asset:tilesets/lava": 41 } },
    actors: [{ charset: "asset:characters/hero" }],
    enemies: [{ sprite: "asset:enemies/dragon" }],
    animations: [{ items: [{ type: "flipbook", sheet: "asset:characters/fx-sheet" }] }],
    commonEvents: [{ commands: [{ t: "se", name: "asset:audio/boom" }] }],
    troops: [{ pages: [{ commands: [{ t: "music", theme: "asset:audio/boss-bgm" }] }] }],
    maps: [
      {
        music: "asset:audio/town-bgm",
        ambience: [{ key: "asset:audio/rain" }],
        layers: { ground: [0, 41, 3] },
        events: [
          {
            pages: [
              {
                charset: "asset:characters/npc",
                commands: [
                  {
                    t: "if",
                    then: [{ t: "text", face: "asset:characters/hero", msg: "hi" }],
                    else: [{ t: "choices", branches: [[{ t: "se", name: "asset:audio/ding" }]] }],
                  },
                  { t: "loop", body: [{ t: "music", theme: "field" }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("the used-asset audit", () => {
  it("collects every reference surface", () => {
    const used = usedAssetKeys(fixtureProject());
    expect(Array.from(used).sort()).toEqual([
      "asset:audio/boom",
      "asset:audio/boss-bgm",
      "asset:audio/click",
      "asset:audio/ding",
      "asset:audio/rain",
      "asset:audio/town-bgm",
      "asset:characters/boat-skin",
      "asset:characters/fx-sheet",
      "asset:characters/hero",
      "asset:characters/npc",
      "asset:enemies/dragon",
      "asset:tilesets/lava",
    ]);
  });
  it("does not flag procedural references or unpainted tile registrations", () => {
    const proj = fixtureProject();
    proj.maps[0].layers.ground = [0, 3]; // lava (41) not painted anywhere
    const used = usedAssetKeys(proj);
    expect(used.has("asset:tilesets/lava")).toBe(false);
    expect(used.has("field" as any)).toBe(false);
  });
  it("pairs a used character with its same-named faceset via the catalog", () => {
    const used = usedAssetKeys(fixtureProject(), [
      { key: "asset:characters/hero", type: "characters", name: "hero" },
      { key: "asset:facesets/hero", type: "facesets", name: "hero" },
      { key: "asset:facesets/villain", type: "facesets", name: "villain" },
    ]);
    expect(used.has("asset:facesets/hero")).toBe(true);
    expect(used.has("asset:facesets/villain")).toBe(false);
  });
});

describe("rename rewriting", () => {
  it("rewrites every reference including the tile id registry", () => {
    const proj = fixtureProject();
    const n = rewriteAssetKey(proj, "asset:audio/boom", "asset:audio/kaboom");
    expect(n).toBe(1);
    expect(proj.commonEvents[0].commands[0].name).toBe("asset:audio/kaboom");

    rewriteAssetKey(proj, "asset:tilesets/lava", "asset:tilesets/magma");
    expect(proj.assets.tiles["asset:tilesets/magma"]).toBe(41);
    expect(proj.assets.tiles["asset:tilesets/lava"]).toBeUndefined();

    rewriteAssetKey(proj, "asset:characters/hero", "asset:characters/lead");
    expect(proj.actors[0].charset).toBe("asset:characters/lead");
    expect(proj.maps[0].events[0].pages[0].commands[0].then[0].face).toBe("asset:characters/lead");
  });
  it("renameAsset re-keys the store and the open project", async () => {
    const proj = fixtureProject();
    await importAssets([{ blob: png("d"), name: "dragon.png", type: "enemies" }], { probe: noProbe });
    const next = await renameAsset("asset:enemies/dragon", "Wyrm King", proj);
    expect(next!.key).toBe("asset:enemies/wyrm-king");
    expect(store.metas.has("asset:enemies/wyrm-king")).toBe(true);
    expect(store.metas.has("asset:enemies/dragon")).toBe(false);
    expect(proj.enemies[0].sprite).toBe("asset:enemies/wyrm-king");
  });
});

describe("embedded assets (file round-trip)", () => {
  it("stripEmbeddedAssets returns the same object when clean", () => {
    const proj = fixtureProject();
    expect(stripEmbeddedAssets(proj)).toBe(proj);
    proj.assets.external = [{ type: "audio", name: "x", src: "data:,x" }];
    const stripped = stripEmbeddedAssets(proj);
    expect(stripped).not.toBe(proj);
    expect(stripped.assets.external).toBeUndefined();
    expect(stripped.assets.tiles).toBe(proj.assets.tiles);
  });
  it("embeds exactly the used library assets on file save", async () => {
    const proj = fixtureProject();
    await importAssets(
      [
        { blob: png("used"), name: "dragon.png", type: "enemies" },
        { blob: png("unused"), name: "slime.png", type: "enemies" },
        { blob: ogg("beep"), name: "boom.ogg", kind: "se" },
      ],
      { probe: noProbe },
    );
    const bundled: any = await embedUsedAssets(proj);
    const names = bundled.assets.external.map((e: any) => e.type + "/" + e.name).sort();
    expect(names).toEqual(["audio/boom", "enemies/dragon"]);
    expect(proj.assets.external).toBeUndefined(); // live project untouched
    expect(bundled.assets.external[0].src.startsWith("data:")).toBe(true);
  });
  it("consumes embedded assets into the library and strips the document", async () => {
    const proj = fixtureProject();
    proj.assets.external = [
      { type: "enemies", name: "dragon", src: await blobToDataUrl(png("art")) },
    ];
    const imported = await consumeEmbeddedAssets(proj);
    expect(imported).toHaveLength(1);
    expect(imported[0].key).toBe("asset:enemies/dragon");
    expect(proj.assets.external).toBeUndefined();
    expect(store.blobs.has("asset:enemies/dragon")).toBe(true);
  });
  it("rewrites references when an embedded name collides with different content", async () => {
    await importAssets([{ blob: png("mine"), name: "dragon.png", type: "enemies" }], { probe: noProbe });
    const proj = fixtureProject();
    proj.assets.external = [
      { type: "enemies", name: "dragon", src: await blobToDataUrl(png("theirs")) },
    ];
    const [meta] = await consumeEmbeddedAssets(proj);
    expect(meta.key).toBe("asset:enemies/dragon-2");
    expect(proj.enemies[0].sprite).toBe("asset:enemies/dragon-2");
  });
  it("dedupes an embedded asset onto an existing key and rewrites to it", async () => {
    await importAssets([{ blob: png("same"), name: "wyrm.png", type: "enemies" }], { probe: noProbe });
    const proj = fixtureProject();
    proj.assets.external = [
      { type: "enemies", name: "dragon", src: await blobToDataUrl(png("same")) },
    ];
    await consumeEmbeddedAssets(proj);
    expect(proj.enemies[0].sprite).toBe("asset:enemies/wyrm");
    expect(libraryMetas()).toHaveLength(1);
  });
  it("cleans up after a delete", async () => {
    await importAssets([{ blob: png("z"), name: "gone.png", type: "enemies" }], { probe: noProbe });
    await removeAsset("asset:enemies/gone");
    expect(libraryMetas()).toHaveLength(0);
    expect(store.metas.size).toBe(0);
  });
});
