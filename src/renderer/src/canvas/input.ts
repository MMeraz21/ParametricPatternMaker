import { distance, type Id, type Vec2 } from '@core'
import type { CameraAction } from './camera'
import type { PointRole } from '../editor/inspect'

/**
 * Input policy as pure functions: raw wheel/pointer facts in, camera actions or a click out. The
 * Canvas component copies event fields into these plain inputs.
 */

export interface WheelInput {
  readonly deltaX: number
  readonly deltaY: number
  /** WheelEvent.deltaMode: 0 pixel, 1 line, 2 page. */
  readonly deltaMode: number
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  /** Cursor position relative to the canvas element. */
  readonly at: Vec2
}

const LINE_PX = 16
const PAGE_PX = 800
/** Pinch deltas are small and fine-grained, mouse notches are ~100 px; both come out near 10-20%. */
const PINCH_GAIN = 0.01
const WHEEL_ZOOM_GAIN = 0.002

/**
 * macOS-first, Figma-style:
 * - Trackpad pinch arrives in Chromium as a wheel event with ctrlKey set, so ctrl (or cmd) + wheel
 *   zooms about the cursor.
 * - A plain wheel (two-finger scroll, mouse wheel) pans.
 * The caller must preventDefault, which needs a native `{ passive: false }` listener.
 */
export function interpretWheel(input: WheelInput): CameraAction {
  const unit = input.deltaMode === 1 ? LINE_PX : input.deltaMode === 2 ? PAGE_PX : 1
  const dx = input.deltaX * unit
  const dy = input.deltaY * unit
  if (input.ctrlKey || input.metaKey) {
    const gain = Math.abs(dy) >= 50 ? WHEEL_ZOOM_GAIN : PINCH_GAIN
    // exp makes zooming in then out by the same delta exactly cancel.
    return { type: 'zoom', anchor: input.at, factor: Math.exp(-dy * gain) }
  }
  return { type: 'pan', delta: { x: -dx, y: -dy } }
}

/** Movement under this many px between down and up is a click, not a pan. */
export const CLICK_SLOP_PX = 3

/** Primary-button down starts 'pending'; moving past the slop pans; up while pending is a click. */
export type PointerGesture =
  | { readonly mode: 'idle' }
  | { readonly mode: 'pending'; readonly pointerId: number; readonly down: Vec2 }
  | { readonly mode: 'panning'; readonly pointerId: number; readonly last: Vec2 }

export type PointerInput =
  | { readonly type: 'down'; readonly pointerId: number; readonly at: Vec2; readonly button: number }
  /** `buttons` is PointerEvent.buttons: 0 means nothing is held. */
  | { readonly type: 'move'; readonly pointerId: number; readonly at: Vec2; readonly buttons: number }
  | { readonly type: 'up'; readonly pointerId: number; readonly at: Vec2 }
  | { readonly type: 'cancel'; readonly pointerId: number }

export type PointerOutput =
  | { readonly kind: 'none' }
  | { readonly kind: 'pan'; readonly delta: Vec2 }
  | { readonly kind: 'click'; readonly at: Vec2 }

export interface PointerStep {
  readonly gesture: PointerGesture
  readonly output: PointerOutput
}

export const idleGesture: PointerGesture = { mode: 'idle' }
const NONE: PointerOutput = { kind: 'none' }

export function stepPointer(gesture: PointerGesture, input: PointerInput): PointerStep {
  if (input.type === 'down') {
    if (gesture.mode !== 'idle') return { gesture, output: NONE }
    // Middle button pans straight away; primary waits to see if it's a click.
    if (input.button === 1) return { gesture: { mode: 'panning', pointerId: input.pointerId, last: input.at }, output: NONE }
    if (input.button === 0) return { gesture: { mode: 'pending', pointerId: input.pointerId, down: input.at }, output: NONE }
    return { gesture, output: NONE }
  }
  // Ignore other pointers (a second finger, pen plus mouse).
  if (gesture.mode === 'idle' || gesture.pointerId !== input.pointerId) return { gesture, output: NONE }

  switch (input.type) {
    case 'move': {
      // No button held means the press is over, even if the release never reached us.
      if (input.buttons === 0) return { gesture: idleGesture, output: NONE }
      if (gesture.mode === 'pending') {
        if (distance(gesture.down, input.at) < CLICK_SLOP_PX) return { gesture, output: NONE }
        const delta = { x: input.at.x - gesture.down.x, y: input.at.y - gesture.down.y }
        return { gesture: { mode: 'panning', pointerId: gesture.pointerId, last: input.at }, output: { kind: 'pan', delta } }
      }
      const delta = { x: input.at.x - gesture.last.x, y: input.at.y - gesture.last.y }
      return { gesture: { ...gesture, last: input.at }, output: { kind: 'pan', delta } }
    }
    case 'up':
      return { gesture: idleGesture, output: gesture.mode === 'pending' ? { kind: 'click', at: gesture.down } : NONE }
    case 'cancel':
      return { gesture: idleGesture, output: NONE }
    default: {
      const _exhaustive: never = input
      return _exhaustive
    }
  }
}

/** Picking tolerance in screen px: markers are tiny and trackpad clicks are imprecise. */
export const HIT_RADIUS_PX = 10

export interface PickTarget {
  readonly id: Id
  readonly role: PointRole
  /** Screen position. */
  readonly at: Vec2
}

/**
 * The point a click at `at` selects, or null for empty canvas. Nearest wins rather than the topmost
 * DOM element, because markers cluster (a control point on its anchor). Within half a pixel, an
 * anchor beats a control point: zoom in to reach the control.
 */
export function pickMarker(targets: readonly PickTarget[], at: Vec2): Id | null {
  let best: { target: PickTarget; d: number } | null = null
  for (const target of targets) {
    const d = distance(target.at, at)
    if (d > HIT_RADIUS_PX) continue
    const closer = !best || d < best.d - 0.5
    const tieToAnchor = best && Math.abs(d - best.d) <= 0.5 && target.role === 'anchor' && best.target.role === 'control'
    if (closer || tieToAnchor) best = { target, d }
  }
  return best?.target.id ?? null
}
