import type { Vec2 } from '@core'

/**
 * Pure 2D camera. World units are mm (y down, like SVG and core); screen units are CSS px relative to
 * the canvas element's top-left.
 */
export interface Camera {
  /** World point (mm) at the centre of the viewport. */
  readonly center: Vec2
  /** Screen px per mm. */
  readonly scale: number
}

export interface Viewport {
  readonly width: number
  readonly height: number
}

export interface Bounds {
  readonly min: Vec2
  readonly max: Vec2
}

export const MIN_SCALE = 0.05
export const MAX_SCALE = 200
/** CSS px per mm at 96 dpi. The zoom readout is scale / this; true 1:1 is export's job, not the canvas's. */
export const CSS_PX_PER_MM = 96 / 25.4

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

export function worldToScreen(camera: Camera, viewport: Viewport, p: Vec2): Vec2 {
  return {
    x: (p.x - camera.center.x) * camera.scale + viewport.width / 2,
    y: (p.y - camera.center.y) * camera.scale + viewport.height / 2
  }
}

export function screenToWorld(camera: Camera, viewport: Viewport, p: Vec2): Vec2 {
  return {
    x: (p.x - viewport.width / 2) / camera.scale + camera.center.x,
    y: (p.y - viewport.height / 2) / camera.scale + camera.center.y
  }
}

/** SVG transform for the world layer. Paths stay in mm; only this string changes on pan/zoom. */
export function worldTransform(camera: Camera, viewport: Viewport): string {
  const tx = viewport.width / 2 - camera.center.x * camera.scale
  const ty = viewport.height / 2 - camera.center.y * camera.scale
  return `matrix(${camera.scale} 0 0 ${camera.scale} ${tx} ${ty})`
}

/** Zoom by `factor`, keeping the world point under `anchor` (screen px) fixed on screen. */
export function zoomAbout(camera: Camera, viewport: Viewport, anchor: Vec2, factor: number): Camera {
  // Clamp before solving for the centre, so the anchor stays fixed at the limits too.
  const scale = clamp(camera.scale * factor, MIN_SCALE, MAX_SCALE)
  if (scale === camera.scale) return camera
  const world = screenToWorld(camera, viewport, anchor)
  return {
    scale,
    center: {
      x: world.x - (anchor.x - viewport.width / 2) / scale,
      y: world.y - (anchor.y - viewport.height / 2) / scale
    }
  }
}

/** Move the view so content follows the pointer by `delta` screen px. */
export function panBy(camera: Camera, delta: Vec2): Camera {
  return { scale: camera.scale, center: { x: camera.center.x - delta.x / camera.scale, y: camera.center.y - delta.y / camera.scale } }
}

const DEFAULT_EXTENT_MM = 100

/**
 * Smallest camera showing all of `bounds` with `padding` px on every side. An empty axis (a single
 * point, a straight line) counts as 100 mm so the scale stays finite; no bounds centre the origin.
 */
export function fitBounds(bounds: Bounds | null, viewport: Viewport, padding = 32): Camera {
  if (!bounds) return { center: { x: 0, y: 0 }, scale: CSS_PX_PER_MM }
  const width = bounds.max.x - bounds.min.x || DEFAULT_EXTENT_MM
  const height = bounds.max.y - bounds.min.y || DEFAULT_EXTENT_MM
  const available = { x: Math.max(viewport.width - 2 * padding, 1), y: Math.max(viewport.height - 2 * padding, 1) }
  return {
    center: { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2 },
    scale: clamp(Math.min(available.x / width, available.y / height), MIN_SCALE, MAX_SCALE)
  }
}

export function boundsOf(points: Iterable<Vec2>): Bounds | null {
  let bounds: Bounds | null = null
  for (const { x, y } of points) {
    bounds = bounds
      ? { min: { x: Math.min(bounds.min.x, x), y: Math.min(bounds.min.y, y) }, max: { x: Math.max(bounds.max.x, x), y: Math.max(bounds.max.y, y) } }
      : { min: { x, y }, max: { x, y } }
  }
  return bounds
}

/** View state owned by the Canvas: never saved, never undone. */
export interface CameraState {
  readonly viewport: Viewport | null
  /** Null until the first resize, which fits the pattern. */
  readonly camera: Camera | null
}

export type CameraAction =
  /** First resize fits `bounds`; later ones keep centre and scale. */
  | { readonly type: 'resize'; readonly viewport: Viewport; readonly bounds: Bounds | null }
  /** `anchor` defaults to the viewport centre (toolbar buttons). */
  | { readonly type: 'zoom'; readonly factor: number; readonly anchor?: Vec2 }
  | { readonly type: 'pan'; readonly delta: Vec2 }
  | { readonly type: 'fit'; readonly bounds: Bounds | null }

export const initialCameraState: CameraState = { viewport: null, camera: null }

export function cameraReducer(state: CameraState, action: CameraAction): CameraState {
  if (action.type === 'resize') {
    const { width, height } = action.viewport
    if (state.viewport?.width === width && state.viewport.height === height) return state
    return { viewport: action.viewport, camera: state.camera ?? fitBounds(action.bounds, action.viewport) }
  }
  const { viewport, camera } = state
  if (!viewport || !camera) return state
  switch (action.type) {
    case 'zoom': {
      const anchor = action.anchor ?? { x: viewport.width / 2, y: viewport.height / 2 }
      const next = zoomAbout(camera, viewport, anchor, action.factor)
      return next === camera ? state : { viewport, camera: next }
    }
    case 'pan':
      return { viewport, camera: panBy(camera, action.delta) }
    case 'fit':
      return { viewport, camera: fitBounds(action.bounds, viewport) }
    default: {
      const _exhaustive: never = action
      return _exhaustive
    }
  }
}
