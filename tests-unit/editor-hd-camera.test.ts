/* RPGAtlas — tests-unit/editor-hd-camera.test.ts
   The live-viewport camera math (src/editor/map-editor/hd-camera.ts, Phase 3
   Stage C). The gizmo placement is only correct if forward projection and
   ground unprojection are exact inverses on the y=0 plane — that round-trip is
   what these tests pin, across tilt/zoom/pan. GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import {
  makeCam, projectToScreen, screenToPlane, clampTilt, clampZoom,
} from "../src/editor/map-editor/hd-camera";

const CASES = [
  { camX: 0, camY: 0, w: 480, h: 360, zoom: 1, tilt: 50 },
  { camX: 120, camY: -40, w: 640, h: 400, zoom: 1.8, tilt: 25 },
  { camX: -60, camY: 200, w: 512, h: 512, zoom: 0.5, tilt: 89 },
  { camX: 300, camY: 300, w: 300, h: 700, zoom: 2.5, tilt: 65 },
];

describe("makeCam basis", () => {
  it("is orthonormal (right/up/fwd unit length, mutually perpendicular)", () => {
    for (const c of CASES) {
      const cam = makeCam(c.camX, c.camY, c.w, c.h, c.zoom, c.tilt);
      const len = (v: number[]) => Math.hypot(v[0], v[1], v[2]);
      const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      expect(len(cam.right)).toBeCloseTo(1, 6);
      expect(len(cam.up)).toBeCloseTo(1, 6);
      expect(len(cam.fwd)).toBeCloseTo(1, 6);
      expect(dot(cam.right, cam.up)).toBeCloseTo(0, 6);
      expect(dot(cam.right, cam.fwd)).toBeCloseTo(0, 6);
      expect(dot(cam.up, cam.fwd)).toBeCloseTo(0, 6);
    }
  });
});

describe("project / unproject round-trip on the ground plane", () => {
  it("a ground point projects to a pixel that unprojects back to itself", () => {
    for (const c of CASES) {
      const cam = makeCam(c.camX, c.camY, c.w, c.h, c.zoom, c.tilt);
      // Sample world points around the look-at center (all on y=0).
      for (const dx of [-200, 0, 150]) {
        for (const dz of [-160, 0, 220]) {
          const world: [number, number, number] = [cam.tX + dx, 0, cam.tZ + dz];
          const p = projectToScreen(cam, world);
          expect(p.visible).toBe(true);
          const g = screenToPlane(cam, p.sx, p.sy, 0);
          expect(g).not.toBeNull();
          expect(g!.wx).toBeCloseTo(world[0], 3);
          expect(g!.wz).toBeCloseTo(world[2], 3);
        }
      }
    }
  });

  it("the viewport center pixel maps to the camera look-at center", () => {
    const cam = makeCam(100, 50, 480, 360, 1, 50);
    const g = screenToPlane(cam, 240, 180, 0);
    expect(g).not.toBeNull();
    expect(g!.wx).toBeCloseTo(cam.tX, 3);
    expect(g!.wz).toBeCloseTo(cam.tZ, 3);
  });
});

describe("clamps match the renderer's limits", () => {
  it("tilt clamps to 25..89 and zoom to 0.25..4", () => {
    expect(clampTilt(10)).toBe(25);
    expect(clampTilt(120)).toBe(89);
    expect(clampTilt(50)).toBe(50);
    expect(clampZoom(0.1)).toBe(0.25);
    expect(clampZoom(9)).toBe(4);
    expect(clampZoom(1.5)).toBe(1.5);
  });
});

describe("points behind the camera are not visible", () => {
  it("a point far above/behind the eye reports visible=false", () => {
    const cam = makeCam(0, 0, 480, 360, 1, 50);
    // A point well behind the camera along +fwd's opposite is not projectable.
    const behind: [number, number, number] = [
      cam.eye[0] - cam.fwd[0] * 500,
      cam.eye[1] - cam.fwd[1] * 500,
      cam.eye[2] - cam.fwd[2] * 500,
    ];
    expect(projectToScreen(cam, behind).visible).toBe(false);
  });
});
