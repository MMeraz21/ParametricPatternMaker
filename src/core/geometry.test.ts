import { describe, expect, it } from 'vitest'
import {
  LENGTH_TOLERANCE,
  curveLength,
  distance,
  flatten,
  pathData,
  pointAt,
  reverseCurve,
  sampleAtLength,
  sampleAtParameter,
  signedArea,
  vec,
  type CubicCurve,
  type Curve,
  type LineCurve
} from './geometry'

const line = (x0: number, y0: number, x1: number, y1: number): LineCurve => ({
  kind: 'line',
  from: vec(x0, y0),
  to: vec(x1, y1)
})

const cubic = (...c: [number, number, number, number, number, number, number, number]): CubicCurve => ({
  kind: 'cubic',
  from: vec(c[0], c[1]),
  c1: vec(c[2], c[3]),
  c2: vec(c[4], c[5]),
  to: vec(c[6], c[7])
})

// Quarter circle of radius 100 from (100, 0) to (0, 100), standard kappa approximation.
const K = 100 * 0.5522847498307936
const quarter = cubic(100, 0, 100, K, K, 100, 0, 100)

/** Reference arc length by brute-force chord sum. */
function chordSum(curve: Curve, steps: number): number {
  let sum = 0
  for (let i = 0; i < steps; i++) sum += distance(pointAt(curve, i / steps), pointAt(curve, (i + 1) / steps))
  return sum
}

describe('curveLength', () => {
  it('is exact for lines', () => {
    expect(curveLength(line(0, 0, 3, 4))).toBe(5)
  })

  it('equals the chord for a straight cubic with evenly spaced controls', () => {
    expect(curveLength(cubic(0, 0, 10, 0, 20, 0, 30, 0))).toBeCloseTo(30, 9)
  })

  it('matches a brute-force chord sum on a quarter circle', () => {
    const expected = chordSum(quarter, 200_000)
    expect(Math.abs(curveLength(quarter) - expected)).toBeLessThan(LENGTH_TOLERANCE * 10)
    // And it is the circle's arc to within the approximation's known 0.03%.
    expect(curveLength(quarter) / ((Math.PI / 2) * 100)).toBeCloseTo(1, 3)
  })

  it('handles a control point sitting on its anchor', () => {
    const c = cubic(0, 0, 0, 0, 50, 100, 100, 100)
    expect(Math.abs(curveLength(c) - chordSum(c, 200_000))).toBeLessThan(LENGTH_TOLERANCE * 10)
  })

  it('is unchanged by reversal', () => {
    expect(curveLength(reverseCurve(quarter))).toBeCloseTo(curveLength(quarter), 9)
  })
})

describe('sampleAtLength', () => {
  it('places points along a line exactly', () => {
    expect(sampleAtLength(line(0, 0, 0, 10), 4)).toEqual({ ok: true, sample: { point: vec(0, 4), tangent: vec(0, 1) } })
  })

  it('places a point at half the arc length at the midpoint of a symmetric curve', () => {
    const result = sampleAtLength(quarter, curveLength(quarter) / 2)
    if (!result.ok) throw new Error(result.reason)
    expect(result.sample.point.x).toBeCloseTo(result.sample.point.y, 6)
    expect(result.sample.tangent.x).toBeCloseTo(-Math.SQRT1_2, 6)
    expect(result.sample.tangent.y).toBeCloseTo(Math.SQRT1_2, 6)
  })

  it('round-trips: the arc up to the sampled point has the requested length', () => {
    const result = sampleAtLength(quarter, 40)
    if (!result.ok) throw new Error(result.reason)
    const { x, y } = result.sample.point
    // On a near-circle of radius 100 centred at the origin, arc length is about r * angle.
    expect(Math.atan2(y, x) * 100).toBeCloseTo(40, 1)
  })

  it('accepts both ends, including the full length', () => {
    expect(sampleAtLength(quarter, 0)).toMatchObject({ ok: true, sample: { point: vec(100, 0), tangent: vec(0, 1) } })
    expect(sampleAtLength(quarter, curveLength(quarter))).toMatchObject({ ok: true, sample: { tangent: vec(-1, 0) } })
  })

  it('reports out-of-range distances with the length', () => {
    expect(sampleAtLength(line(0, 0, 10, 0), 11)).toEqual({ ok: false, reason: 'out-of-range', length: 10 })
    expect(sampleAtLength(line(0, 0, 10, 0), -1)).toEqual({ ok: false, reason: 'out-of-range', length: 10 })
  })

  it('reports degenerate curves', () => {
    expect(sampleAtLength(line(5, 5, 5, 5), 0)).toEqual({ ok: false, reason: 'degenerate' })
  })

  it('finds a tangent where the derivative vanishes (control point on its anchor)', () => {
    const result = sampleAtLength(cubic(0, 0, 0, 0, 100, 0, 100, 100), 0)
    if (!result.ok) throw new Error(result.reason)
    expect(result.sample.tangent.x).toBeCloseTo(1, 4)
    expect(result.sample.tangent.y).toBeCloseTo(0, 4)
  })
})

describe('sampleAtParameter', () => {
  it('samples by parameter and rejects t outside [0, 1]', () => {
    expect(sampleAtParameter(line(0, 0, 10, 0), 0.25)).toEqual({ ok: true, sample: { point: vec(2.5, 0), tangent: vec(1, 0) } })
    expect(sampleAtParameter(line(0, 0, 10, 0), 1.5)).toEqual({ ok: false, reason: 'out-of-range', length: 10 })
  })
})

describe('flatten', () => {
  it('returns the endpoints of a line', () => {
    const l = line(0, 0, 10, 0)
    expect(flatten(l, 0.1)).toEqual([l.from, l.to])
  })

  it('starts and ends on the exact endpoint objects', () => {
    const points = flatten(quarter, 0.05)
    expect(points[0]).toBe(quarter.from)
    expect(points.at(-1)).toBe(quarter.to)
  })

  it('stays within tolerance of the curve', () => {
    const points = flatten(quarter, 0.05)
    expect(points.length).toBeGreaterThan(4)
    // Every curve sample is within tolerance of the polyline.
    for (let i = 0; i <= 1000; i++) {
      const p = pointAt(quarter, i / 1000)
      const nearest = Math.min(
        ...points.slice(1).map((b, j) => {
          const a = points[j] ?? b
          const ab = { x: b.x - a.x, y: b.y - a.y }
          const t = Math.min(Math.max(((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / (ab.x ** 2 + ab.y ** 2), 0), 1)
          return distance(p, { x: a.x + ab.x * t, y: a.y + ab.y * t })
        })
      )
      expect(nearest).toBeLessThanOrEqual(0.05)
    }
  })

  it('uses fewer points at a looser tolerance', () => {
    expect(flatten(quarter, 1).length).toBeLessThan(flatten(quarter, 0.01).length)
  })
})

describe('signedArea', () => {
  const square: Curve[] = [line(0, 0, 10, 0), line(10, 0, 10, 10), line(10, 10, 0, 10), line(0, 10, 0, 0)]

  it('is positive for a clockwise (on screen, y down) square', () => {
    expect(signedArea(square)).toBe(100)
  })

  it('is negative when reversed', () => {
    expect(signedArea([...square].reverse().map(reverseCurve))).toBe(-100)
  })

  it('is exact for cubic edges', () => {
    // Quarter disc: two radii plus the arc. Compare against a finely flattened shoelace.
    const chain: Curve[] = [line(0, 0, 100, 0), quarter, line(0, 100, 0, 0)]
    const ring = [vec(0, 0), ...flatten(quarter, 1e-4)]
    let shoelace = 0
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] ?? vec(0, 0)
      const b = ring[(i + 1) % ring.length] ?? vec(0, 0)
      shoelace += a.x * b.y - b.x * a.y
    }
    expect(signedArea(chain)).toBeCloseTo(shoelace / 2, 1)
    expect(signedArea(chain)).toBeCloseTo((Math.PI / 4) * 100 * 100, -1)
  })
})

describe('pathData', () => {
  it('emits one move, then line and curve commands', () => {
    expect(pathData([line(0, 0, 10, 0), cubic(10, 0, 10, 5, 5, 10, 0, 10)], { closed: true })).toBe(
      'M 0 0 L 10 0 C 10 5 5 10 0 10 Z'
    )
  })

  it('rounds to micrometres and is empty for an empty chain', () => {
    expect(pathData([line(0, 0, 1 / 3, 0)])).toBe('M 0 0 L 0.333333 0')
    expect(pathData([])).toBe('')
  })
})
