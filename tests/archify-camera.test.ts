import { expect, test } from "bun:test";
import { canPanCamera, fitCamera, panCamera, zoomCamera } from "../src/archify-camera.ts";

test("Fit includes an entire tall map without changing the viewport", () => {
  const viewport = { left: 24, top: 16, width: 800, height: 500 };
  const fitted = fitCamera({ width: 600, height: 2_400 }, viewport);

  expect(fitted.scale).toBeCloseTo(500 / 2_400);
  expect(fitted.y).toBe(16);
  expect(fitted.x).toBeCloseTo(24 + (800 - 600 * fitted.scale) / 2);
  // The viewport object is input-only camera geometry, not a zoom result.
  expect(viewport).toEqual({ left: 24, top: 16, width: 800, height: 500 });
});

test("Fit includes both ends of a wide map and resize recomputes the fit", () => {
  const content = { width: 2_400, height: 600 };
  const wide = fitCamera(content, { left: 24, top: 16, width: 800, height: 500 });
  const narrow = fitCamera(content, { left: 24, top: 16, width: 420, height: 500 });

  expect(wide.scale).toBeCloseTo(800 / 2_400);
  expect(wide.x).toBe(24);
  expect(narrow.scale).toBeCloseTo(420 / 2_400);
  expect(narrow.x).toBe(24);
});

test("Fit does not enlarge a naturally small map", () => {
  const fitted = fitCamera({ width: 300, height: 200 }, { left: 24, top: 16, width: 800, height: 500 });

  expect(fitted.scale).toBe(1);
  expect(fitted.x).toBe(274);
  expect(fitted.y).toBe(166);
});

test("zoom anchors content while leaving a fixed camera viewport unchanged", () => {
  const content = { width: 1_600, height: 900 };
  const viewport = { left: 24, top: 16, width: 800, height: 500 };
  const fitted = fitCamera(content, viewport);
  const zoomed = zoomCamera(fitted, content, viewport, fitted.scale + 0.5, { x: 424, y: 266 });

  expect(zoomed.scale).toBeGreaterThan(fitted.scale);
  expect(viewport.width).toBe(800);
  expect(viewport.height).toBe(500);
  // The pointer remains over the same logical content coordinate.
  expect((424 - zoomed.x) / zoomed.scale).toBeCloseTo((424 - fitted.x) / fitted.scale);
  expect((266 - zoomed.y) / zoomed.scale).toBeCloseTo((266 - fitted.y) / fitted.scale);
});

test("a sub-100% map can still pan whenever it overflows", () => {
  const content = { width: 2_400, height: 600 };
  const viewport = { left: 24, top: 16, width: 800, height: 500 };
  const state = { scale: 0.5, x: 24, y: 16 };

  expect(canPanCamera(state, content, viewport)).toBe(true);
  const panned = panCamera(state, content, viewport, { x: -240, y: 0 });
  expect(panned.x).toBe(-216);
  expect(panned.y).toBe(116);
});
