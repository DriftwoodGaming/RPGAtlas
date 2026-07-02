/* RPGAtlas — src/editor/map-editor/hd-camera.ts
   Pure camera math for the live HD-2D viewport (Phase 3 Stage C).

   The viewport drives the Phase 2 three.js renderer through its
   available/setMap/renderFrame surface. That renderer computes its own camera
   matrices internally (see three-renderer.ts renderFrame); it does not expose a
   world<->screen projection. To place draggable light gizmos over the WebGL
   canvas we replicate exactly the camera the renderer builds — a fixed-azimuth
   perspective looking down +Z with a variable pitch (tilt) and zoom — as a set
   of orthonormal basis vectors, then forward-project (world -> screen, for the
   handle positions) and unproject onto the ground plane (screen -> world, for
   dragging / placing lights).

   Everything here is pure and import-free so it is unit-tested in isolation
   (tests-unit/editor-hd-camera.test.ts) — the project/unproject round-trip is
   what makes the gizmos land where the light actually renders. The math mirrors
   renderFrame's `eye`/`lookAt` construction and the classic renderer's basis
   (right = worldUp x back, up = back x right).
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

export const HD_FOV = Math.PI / 4; // 45° vertical FOV — matches the renderer's FOV

export type Vec3 = [number, number, number];

export interface ViewCam {
  eye: Vec3;
  tX: number; // camera look-at center X (world px)
  tZ: number; // camera look-at center Z (world px)
  right: Vec3;
  up: Vec3;
  fwd: Vec3; // view forward, toward the scene (= -back)
  tanHalf: number;
  aspect: number;
  w: number;
  h: number;
}

function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

/** Clamp tilt/zoom the same way renderFrame does, so the gizmo camera and the
 *  rendered camera never diverge at the extremes. */
export function clampTilt(deg: number): number { return Math.min(89, Math.max(25, deg)); }
export function clampZoom(z: number): number { return Math.max(0.25, Math.min(4, z)); }

/** Build the viewport camera for a look-at center (camX, camY = top-left of the
 *  visible world box, matching renderFrame's camX/camY), viewport pixel size,
 *  zoom and tilt. */
export function makeCam(
  camX: number, camY: number, w: number, h: number, zoom: number, tiltDeg: number,
): ViewCam {
  const pitch = (clampTilt(tiltDeg) * Math.PI) / 180;
  const z = clampZoom(zoom);
  const dist = h / 2 / Math.tan(HD_FOV / 2) / z;
  const tX = camX + w / z / 2;
  const tZ = camY + h / z / 2;
  const eye: Vec3 = [tX, dist * Math.sin(pitch), tZ + dist * Math.cos(pitch)];

  // back = normalize(eye - target), target = (tX, 0, tZ)
  let bx = eye[0] - tX, by = eye[1], bz = eye[2] - tZ;
  const bl = Math.hypot(bx, by, bz) || 1;
  bx /= bl; by /= bl; bz /= bl;
  // right = normalize(worldUp x back) = normalize([bz, 0, -bx])
  let rx = bz, ry = 0, rz = -bx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  // up = back x right  (renderer's y = z x x)
  const ux = by * rz - bz * ry, uy = bz * rx - bx * rz, uz = bx * ry - by * rx;

  return {
    eye, tX, tZ,
    right: [rx, ry, rz], up: [ux, uy, uz], fwd: [-bx, -by, -bz],
    tanHalf: Math.tan(HD_FOV / 2), aspect: w / h, w, h,
  };
}

/** Forward-project a world point to viewport pixels. `visible` is false when
 *  the point is at/behind the camera plane. */
export function projectToScreen(cam: ViewCam, world: Vec3): { sx: number; sy: number; visible: boolean } {
  const rel: Vec3 = [world[0] - cam.eye[0], world[1] - cam.eye[1], world[2] - cam.eye[2]];
  const d = dot(rel, cam.fwd);
  if (d <= 1e-3) return { sx: 0, sy: 0, visible: false };
  const ndcX = dot(rel, cam.right) / (d * cam.tanHalf * cam.aspect);
  const ndcY = dot(rel, cam.up) / (d * cam.tanHalf);
  return {
    sx: (ndcX * 0.5 + 0.5) * cam.w,
    sy: (1 - (ndcY * 0.5 + 0.5)) * cam.h,
    visible: true,
  };
}

/** Unproject a viewport pixel onto a horizontal plane y=planeY, returning world
 *  (x, z). Returns null when the ray is parallel to the plane. Exact inverse of
 *  projectToScreen for points on that plane (the basis is orthonormal). */
export function screenToPlane(
  cam: ViewCam, sx: number, sy: number, planeY = 0,
): { wx: number; wz: number } | null {
  const ndcX = (sx / cam.w) * 2 - 1;
  const ndcY = 1 - (sy / cam.h) * 2;
  const vx = ndcX * cam.tanHalf * cam.aspect;
  const vy = ndcY * cam.tanHalf;
  const dir: Vec3 = [
    cam.fwd[0] + cam.right[0] * vx + cam.up[0] * vy,
    cam.fwd[1] + cam.right[1] * vx + cam.up[1] * vy,
    cam.fwd[2] + cam.right[2] * vx + cam.up[2] * vy,
  ];
  if (Math.abs(dir[1]) < 1e-9) return null;
  const t = (planeY - cam.eye[1]) / dir[1];
  if (t <= 0) return null; // plane is behind the camera
  return { wx: cam.eye[0] + dir[0] * t, wz: cam.eye[2] + dir[2] * t };
}
