import { describe, expect, it } from 'vitest'
import { idleGesture, interpretWheel, pickMarker, stepPointer, type PointerGesture, type PointerInput } from './input'

const wheel = { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, at: { x: 50, y: 60 } }

describe('interpretWheel', () => {
  it('pans on a plain wheel, scaling line deltas to px', () => {
    expect(interpretWheel({ ...wheel, deltaX: 5, deltaY: -10 })).toEqual({ type: 'pan', delta: { x: -5, y: 10 } })
    expect(interpretWheel({ ...wheel, deltaY: 3, deltaMode: 1 })).toEqual({ type: 'pan', delta: { x: -0, y: -48 } })
  })

  it('zooms about the cursor on pinch (ctrl) and cmd, in for negative deltas', () => {
    const pinch = interpretWheel({ ...wheel, deltaY: -10, ctrlKey: true })
    expect(pinch).toEqual({ type: 'zoom', anchor: { x: 50, y: 60 }, factor: Math.exp(0.1) })
    const mouse = interpretWheel({ ...wheel, deltaY: 100, metaKey: true })
    expect(mouse).toEqual({ type: 'zoom', anchor: { x: 50, y: 60 }, factor: Math.exp(-0.2) })
  })
})

function run(inputs: PointerInput[]) {
  let gesture: PointerGesture = idleGesture
  return inputs.map((input) => {
    const step = stepPointer(gesture, input)
    gesture = step.gesture
    return step.output
  })
}

describe('stepPointer', () => {
  it('turns a still press into a click at the down position', () => {
    expect(
      run([
        { type: 'down', pointerId: 1, at: { x: 10, y: 10 }, button: 0 },
        { type: 'move', pointerId: 1, at: { x: 11, y: 11 }, buttons: 1 },
        { type: 'up', pointerId: 1, at: { x: 11, y: 11 } }
      ])
    ).toEqual([{ kind: 'none' }, { kind: 'none' }, { kind: 'click', at: { x: 10, y: 10 } }])
  })

  it('pans once the pointer moves past the slop, and never clicks', () => {
    expect(
      run([
        { type: 'down', pointerId: 1, at: { x: 10, y: 10 }, button: 0 },
        { type: 'move', pointerId: 1, at: { x: 20, y: 10 }, buttons: 1 },
        { type: 'move', pointerId: 1, at: { x: 25, y: 13 }, buttons: 1 },
        { type: 'up', pointerId: 1, at: { x: 25, y: 13 } }
      ])
    ).toEqual([{ kind: 'none' }, { kind: 'pan', delta: { x: 10, y: 0 } }, { kind: 'pan', delta: { x: 5, y: 3 } }, { kind: 'none' }])
  })

  it('pans straight away with the middle button and ignores other pointers', () => {
    expect(
      run([
        { type: 'down', pointerId: 1, at: { x: 0, y: 0 }, button: 1 },
        { type: 'move', pointerId: 2, at: { x: 50, y: 50 }, buttons: 1 },
        { type: 'move', pointerId: 1, at: { x: 1, y: 0 }, buttons: 1 }
      ])
    ).toEqual([{ kind: 'none' }, { kind: 'none' }, { kind: 'pan', delta: { x: 1, y: 0 } }])
  })

  it('ends a drag when a move reports no buttons held, so hovering can never pan', () => {
    expect(
      run([
        { type: 'down', pointerId: 1, at: { x: 0, y: 0 }, button: 0 },
        { type: 'move', pointerId: 1, at: { x: 10, y: 0 }, buttons: 1 },
        // The release was never delivered (focus moved mid-drag), or another input moved the pointer.
        { type: 'move', pointerId: 1, at: { x: 500, y: 300 }, buttons: 0 },
        { type: 'move', pointerId: 1, at: { x: 520, y: 300 }, buttons: 0 },
        { type: 'up', pointerId: 1, at: { x: 520, y: 300 } }
      ])
    ).toEqual([{ kind: 'none' }, { kind: 'pan', delta: { x: 10, y: 0 } }, { kind: 'none' }, { kind: 'none' }, { kind: 'none' }])
  })

  it('does not click when the press ended without a release', () => {
    expect(
      run([
        { type: 'down', pointerId: 1, at: { x: 0, y: 0 }, button: 0 },
        { type: 'move', pointerId: 1, at: { x: 0, y: 0 }, buttons: 0 },
        { type: 'up', pointerId: 1, at: { x: 0, y: 0 } }
      ])
    ).toEqual([{ kind: 'none' }, { kind: 'none' }, { kind: 'none' }])
  })

  it('drops a cancelled press without clicking', () => {
    expect(
      run([
        { type: 'down', pointerId: 1, at: { x: 0, y: 0 }, button: 0 },
        { type: 'cancel', pointerId: 1 },
        { type: 'up', pointerId: 1, at: { x: 0, y: 0 } }
      ])
    ).toEqual([{ kind: 'none' }, { kind: 'none' }, { kind: 'none' }])
  })
})

describe('pickMarker', () => {
  const targets = [
    { id: 'c', role: 'control' as const, at: { x: 100, y: 100 } },
    { id: 'a', role: 'anchor' as const, at: { x: 100.3, y: 100 } },
    { id: 'far', role: 'anchor' as const, at: { x: 130, y: 100 } }
  ]

  it('picks the nearest within the hit radius, or nothing', () => {
    expect(pickMarker(targets, { x: 128, y: 100 })).toBe('far')
    expect(pickMarker(targets, { x: 115, y: 100 })).toBeNull()
  })

  it('prefers the anchor when a control point sits on it', () => {
    expect(pickMarker(targets, { x: 100, y: 100 })).toBe('a')
    expect(pickMarker([...targets].reverse(), { x: 100, y: 100 })).toBe('a')
  })
})
