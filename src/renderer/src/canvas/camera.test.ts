import { describe, expect, it } from 'vitest'
import {
  MAX_SCALE,
  boundsOf,
  cameraReducer,
  containsBounds,
  fitBounds,
  initialCameraState,
  panBy,
  screenToWorld,
  worldToScreen,
  worldTransform,
  zoomAbout,
  type Camera
} from './camera'

const viewport = { width: 800, height: 600 }
const camera: Camera = { center: { x: 100, y: 200 }, scale: 2 }

describe('camera transforms', () => {
  it('puts the centre in the middle of the viewport and round-trips', () => {
    expect(worldToScreen(camera, viewport, { x: 100, y: 200 })).toEqual({ x: 400, y: 300 })
    expect(worldToScreen(camera, viewport, { x: 110, y: 205 })).toEqual({ x: 420, y: 310 })
    expect(screenToWorld(camera, viewport, { x: 420, y: 310 })).toEqual({ x: 110, y: 205 })
  })

  it('builds the matching SVG transform', () => {
    expect(worldTransform(camera, viewport)).toBe('matrix(2 0 0 2 200 -100)')
  })
})

describe('zoomAbout', () => {
  it('keeps the world point under the anchor fixed', () => {
    const anchor = { x: 650, y: 120 }
    const before = screenToWorld(camera, viewport, anchor)
    const zoomed = zoomAbout(camera, viewport, anchor, 3)
    expect(zoomed.scale).toBe(6)
    const after = screenToWorld(zoomed, viewport, anchor)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
  })

  it('clamps at the limit, still keeping the anchor fixed, then returns the same camera', () => {
    const anchor = { x: 10, y: 10 }
    const before = screenToWorld(camera, viewport, anchor)
    const zoomed = zoomAbout(camera, viewport, anchor, 1e6)
    expect(zoomed.scale).toBe(MAX_SCALE)
    expect(screenToWorld(zoomed, viewport, anchor).x).toBeCloseTo(before.x, 9)
    expect(zoomAbout(zoomed, viewport, anchor, 2)).toBe(zoomed)
  })
})

describe('panBy', () => {
  it('moves content with the pointer', () => {
    const panned = panBy(camera, { x: 20, y: -10 })
    expect(worldToScreen(panned, viewport, { x: 100, y: 200 })).toEqual({ x: 420, y: 290 })
  })
})

describe('fitBounds', () => {
  it('fits the limiting axis inside the padding', () => {
    const fitted = fitBounds({ min: { x: 0, y: 0 }, max: { x: 100, y: 1000 } }, viewport, 50)
    expect(fitted).toEqual({ center: { x: 50, y: 500 }, scale: 0.5 })
  })

  it('stays finite for a single point and centres the origin for nothing', () => {
    expect(fitBounds({ min: { x: 5, y: 5 }, max: { x: 5, y: 5 } }, viewport, 0).scale).toBe(6)
    expect(fitBounds(null, viewport).center).toEqual({ x: 0, y: 0 })
  })

  it('takes the bounds of points', () => {
    expect(boundsOf([{ x: 3, y: -1 }, { x: -2, y: 4 }])).toEqual({ min: { x: -2, y: -1 }, max: { x: 3, y: 4 } })
    expect(boundsOf([])).toBeNull()
  })
})

describe('cameraReducer', () => {
  const bounds = { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } }

  it('ignores camera actions before the first resize, which fits', () => {
    expect(cameraReducer(initialCameraState, { type: 'pan', delta: { x: 1, y: 1 } })).toBe(initialCameraState)
    const sized = cameraReducer(initialCameraState, { type: 'resize', viewport, bounds })
    expect(sized.camera).toEqual(fitBounds(bounds, viewport))
  })

  it('keeps the camera on later resizes and zooms about the centre by default', () => {
    const sized = cameraReducer(initialCameraState, { type: 'resize', viewport, bounds })
    const resized = cameraReducer(sized, { type: 'resize', viewport: { width: 1000, height: 600 }, bounds: null })
    expect(resized.camera).toBe(sized.camera)
    const zoomed = cameraReducer(sized, { type: 'zoom', factor: 2 })
    expect(zoomed.camera?.center).toEqual(sized.camera?.center)
    expect(zoomed.camera?.scale).toBe((sized.camera?.scale ?? 0) * 2)
  })
})

describe('reveal', () => {
  const viewport = { width: 400, height: 400 }
  const shown = { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } }
  const all = { min: { x: 0, y: 0 }, max: { x: 200, y: 100 } }
  const fitted = cameraReducer(cameraReducer(initialCameraState, { type: 'resize', viewport, bounds: shown }), { type: 'fit', bounds: shown })

  it('fits everything when the whole shown size was in view and the rest is not', () => {
    const next = cameraReducer(fitted, { type: 'reveal', shown, all })
    expect(next.camera).toEqual(fitBounds(all, viewport))
  })

  it('stays put when everything already fits', () => {
    expect(cameraReducer(fitted, { type: 'reveal', shown, all: shown })).toBe(fitted)
  })

  it('does not lose a zoomed-in view', () => {
    const zoomed = cameraReducer(fitted, { type: 'zoom', factor: 4 })
    expect(cameraReducer(zoomed, { type: 'reveal', shown, all })).toBe(zoomed)
  })

  it('does nothing before there is a camera, or with nothing to show', () => {
    expect(cameraReducer(initialCameraState, { type: 'reveal', shown, all })).toBe(initialCameraState)
    expect(cameraReducer(fitted, { type: 'reveal', shown: null, all })).toBe(fitted)
  })
})

describe('containsBounds', () => {
  const viewport = { width: 100, height: 100 }
  const camera = { center: { x: 50, y: 50 }, scale: 1 }

  it('is true only when every edge is on screen, inside the padding', () => {
    const bounds = { min: { x: 10, y: 10 }, max: { x: 90, y: 90 } }
    expect(containsBounds(camera, viewport, bounds)).toBe(true)
    expect(containsBounds(camera, viewport, bounds, 11)).toBe(false)
    expect(containsBounds(camera, viewport, { min: { x: -1, y: 0 }, max: { x: 50, y: 50 } })).toBe(false)
  })
})
