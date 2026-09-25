/**
 * Small, DOM-independent camera math used by the Archify review embed.  The
 * iframe owns a fixed viewport; this module deliberately never models height
 * as a camera output.
 */
export interface CameraSize {
  width: number;
  height: number;
}

export interface CameraViewport extends CameraSize {
  left: number;
  top: number;
}

export interface CameraState {
  scale: number;
  /** Translation from the SVG's untransformed layout origin. */
  x: number;
  y: number;
}

export interface CameraBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function positive(value: number, fallback = 1): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** The exact translations that keep the content inside the stable viewport. */
export function cameraBounds(content: CameraSize, viewport: CameraViewport, scale: number): CameraBounds {
  const width = positive(content.width);
  const height = positive(content.height);
  const viewWidth = positive(viewport.width);
  const viewHeight = positive(viewport.height);
  const resolvedScale = positive(scale);
  const scaledWidth = width * resolvedScale;
  const scaledHeight = height * resolvedScale;
  const centeredX = viewport.left + (viewWidth - scaledWidth) / 2;
  const centeredY = viewport.top + (viewHeight - scaledHeight) / 2;
  return {
    minX: scaledWidth <= viewWidth ? centeredX : viewport.left + viewWidth - scaledWidth,
    maxX: scaledWidth <= viewWidth ? centeredX : viewport.left,
    minY: scaledHeight <= viewHeight ? centeredY : viewport.top + viewHeight - scaledHeight,
    maxY: scaledHeight <= viewHeight ? centeredY : viewport.top,
  };
}

export function clampCamera(state: CameraState, content: CameraSize, viewport: CameraViewport): CameraState {
  const bounds = cameraBounds(content, viewport, state.scale);
  return { scale: positive(state.scale), x: clamp(state.x, bounds.minX, bounds.maxX), y: clamp(state.y, bounds.minY, bounds.maxY) };
}

/**
 * Fits both axes without an arbitrary lower scale floor, but never magnifies a
 * naturally small diagram. Magnification is an explicit reviewer action, not
 * a surprising side effect of pressing Fit.
 */
export function fitCamera(content: CameraSize, viewport: CameraViewport): CameraState {
  const scale = Math.min(1, positive(viewport.width) / positive(content.width), positive(viewport.height) / positive(content.height));
  return clampCamera({ scale, x: viewport.left, y: viewport.top }, content, viewport);
}

/** True exactly when dragging can reveal clipped content on at least one axis. */
export function canPanCamera(state: CameraState, content: CameraSize, viewport: CameraViewport): boolean {
  return content.width * state.scale > viewport.width + 0.01 || content.height * state.scale > viewport.height + 0.01;
}

/** Zooms around a viewport-relative pointer, leaving the viewport dimensions unchanged. */
export function zoomCamera(state: CameraState, content: CameraSize, viewport: CameraViewport, nextScale: number, anchor: { x: number; y: number }): CameraState {
  const previousScale = positive(state.scale);
  const resolvedScale = positive(nextScale, previousScale);
  const logicalX = (anchor.x - state.x) / previousScale;
  const logicalY = (anchor.y - state.y) / previousScale;
  return clampCamera({ scale: resolvedScale, x: anchor.x - logicalX * resolvedScale, y: anchor.y - logicalY * resolvedScale }, content, viewport);
}

export function panCamera(state: CameraState, content: CameraSize, viewport: CameraViewport, delta: { x: number; y: number }): CameraState {
  return clampCamera({ ...state, x: state.x + delta.x, y: state.y + delta.y }, content, viewport);
}
