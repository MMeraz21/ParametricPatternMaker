import { describe, expect, it } from 'vitest'
import { evaluate } from './evaluate'
import { raglanTee } from './fixtures/raglan'
import {
  LENGTH_TOLERANCE,
  OFFSET_TOLERANCE,
  add,
  curveLength,
  derivativeAt,
  distance,
  endTangent,
  flatten,
  norm,
  offsetCurve,
  pathData,
  pointAt,
  reverseCurve,
  sampleAtLength,
  sampleAtParameter,
  scale,
  signedArea,
  startTangent,
  vec,
  type CubicCurve,
  type Curve,
  type LineCurve,
  type OffsetChain,
  type Vec2
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

describe('offsetCurve', () => {
  // y down: for the quarter arc, which runs clockwise on screen, these point away from and towards its centre.
  const away = (t: Vec2): Vec2 => vec(t.y, -t.x)
  const towards = (t: Vec2): Vec2 => vec(-t.y, t.x)

  function distanceToChord(p: Vec2, a: Vec2, b: Vec2): number {
    const [dx, dy] = [b.x - a.x, b.y - a.y]
    const lengthSquared = dx * dx + dy * dy
    const u = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
    return Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy)
  }

  /** The furthest any densely sampled point of the true offset P(t) + d*N(t) lies from the chain. */
  function maxDeviation(curve: Curve, offset: number, outward: (t: Vec2) => Vec2, chain: OffsetChain): number {
    let worst = 0
    for (let i = 0; i <= 2000; i++) {
      const t = i / 2000
      const derivative = derivativeAt(curve, t)
      const speed = norm(derivative)
      if (speed === 0) continue
      const onOffset = add(pointAt(curve, t), scale(outward(scale(derivative, 1 / speed)), offset))
      let nearest = Infinity
      for (let k = 1; k < chain.points.length; k++) {
        const [a, b] = [chain.points[k - 1], chain.points[k]]
        if (a && b) nearest = Math.min(nearest, distanceToChord(onOffset, a, b))
      }
      worst = Math.max(worst, nearest)
    }
    return worst
  }

  describe('accuracy on a quarter arc', () => {
    it.each([1, 10, 25, 100])('stays within tolerance of the true offset %d mm outside the arc', (offset) => {
      expect(maxDeviation(quarter, offset, away, offsetCurve(quarter, offset, away))).toBeLessThanOrEqual(OFFSET_TOLERANCE)
    })

    it.each([1, 10, 25, 90])('stays within tolerance of the true offset %d mm inside the arc', (offset) => {
      expect(maxDeviation(quarter, offset, towards, offsetCurve(quarter, offset, towards))).toBeLessThanOrEqual(OFFSET_TOLERANCE)
    })

    it('starts and ends exactly on the offset of the end points', () => {
      const { points } = offsetCurve(quarter, 10, away)
      expect(points[0]?.x).toBeCloseTo(110, 12)
      expect(points[0]?.y).toBeCloseTo(0, 12)
      expect(points.at(-1)?.x).toBeCloseTo(0, 12)
      expect(points.at(-1)?.y).toBeCloseTo(110, 12)
    })
  })

  describe('the chain', () => {
    it('is two exact points for a line', () => {
      const curve = line(0, 0, 100, 0)
      expect(offsetCurve(curve, 5, away)).toEqual({ points: [vec(0, -5), vec(100, -5)], source: [curve.from, curve.to], regular: true })
    })

    it('is two points for a cubic that runs straight', () => {
      expect(offsetCurve(cubic(0, 0, 30, 0, 60, 0, 100, 0), 5, away).points).toHaveLength(2)
    })

    it('is two points for a cubic with both controls on their anchors', () => {
      expect(offsetCurve(cubic(0, 0, 0, 0, 100, 0, 100, 0), 5, away).points).toHaveLength(2)
    })

    it('keeps every vertex the offset distance from the curve point it came from', () => {
      const { points, source } = offsetCurve(quarter, 10, away)
      expect(points).toHaveLength(source.length)
      source.forEach((from, i) => {
        const to = points[i]
        if (!to) throw new Error('points and source differ in length')
        expect(distance(from, to)).toBeCloseTo(10, 9)
      })
      expect(source[0]).toBe(quarter.from)
      expect(source.at(-1)).toBe(quarter.to)
    })

    it('lies on the curve at zero offset', () => {
      const { points, source } = offsetCurve(quarter, 0, away)
      expect(points).toEqual(source)
      expect(maxDeviation(quarter, 0, away, { points, source, regular: true })).toBeLessThanOrEqual(OFFSET_TOLERANCE)
    })

    it('is empty for a curve with no tangent', () => {
      expect(offsetCurve(cubic(5, 5, 5, 5, 5, 5, 5, 5), 10, away)).toEqual({ points: [], source: [], regular: true })
      expect(offsetCurve(line(1, 1, 1 + 5e-10, 1), 10, away)).toEqual({ points: [], source: [], regular: true })
    })
  })

  describe('awkward curves', () => {
    /** Control points of (s^2, s^3 + bend * s) for s from -0.3 to 0.7, scaled by 200: a cusp at s = 0 when bend is 0. */
    function cuspLike(bend: number): CubicCurve {
      const control = (u: number, v: number, w: number): Vec2 =>
        vec((200 * (u * v + v * w + u * w)) / 3, 200 * (u * v * w + (bend * (u + v + w)) / 3))
      const [a, b] = [-0.3, 0.7]
      return { kind: 'cubic', from: control(a, a, a), c1: control(a, a, b), c2: control(a, b, b), to: control(b, b, b) }
    }

    it('flags a cusp at the middle of the curve', () => {
      expect(offsetCurve(cubic(0, 0, 100, 100, 0, 100, 100, 0), 10, away).regular).toBe(false)
    })

    it('flags a cusp away from the middle of the curve', () => {
      expect(offsetCurve(cuspLike(0), 10, away).regular).toBe(false)
    })

    it('flags a curve that doubles back on itself', () => {
      expect(offsetCurve(cubic(0, 0, 100, 0, -50, 0, 50, 0), 10, away).regular).toBe(false)
    })

    it('accepts a sharp curve that has no cusp, within tolerance on the outside of the turn', () => {
      const curve = cuspLike(0.01)
      const chain = offsetCurve(curve, 2, towards)
      expect(chain.regular).toBe(true)
      expect(maxDeviation(curve, 2, towards, chain)).toBeLessThanOrEqual(OFFSET_TOLERANCE)
    })

    it('accepts a control point on its anchor, within tolerance', () => {
      const curve = cubic(0, 0, 0, 0, 50, 100, 100, 0)
      const chain = offsetCurve(curve, 10, away)
      expect(chain.regular).toBe(true)
      expect(maxDeviation(curve, 10, away, chain)).toBeLessThanOrEqual(OFFSET_TOLERANCE)
    })

    it('follows an S curve through its inflection, within tolerance', () => {
      const curve = cubic(0, 0, 100, 0, 0, 100, 100, 100)
      const chain = offsetCurve(curve, 15, away)
      expect(chain.regular).toBe(true)
      expect(maxDeviation(curve, 15, away, chain)).toBeLessThanOrEqual(OFFSET_TOLERANCE)
    })

    it('still ends exactly when the offset passes the centre of curvature', () => {
      const chain = offsetCurve(quarter, 150, towards)
      expect(chain.regular).toBe(true)
      expect(chain.points[0]?.x).toBeCloseTo(-50, 12)
      expect(chain.points.at(-1)?.y).toBeCloseTo(-50, 12)
    })
  })

  describe('grading', () => {
    it.each(raglanTee.sizes)('stays within tolerance on every raglan curve in size %s', (size) => {
      const curves = Object.values(evaluate(raglanTee, size).segments).flatMap((s) => (s.curve.kind === 'cubic' ? [s.curve] : []))
      expect(curves.length).toBeGreaterThan(0)
      for (const curve of curves) {
        for (const offset of [10, 25]) {
          for (const side of [away, towards]) {
            const chain = offsetCurve(curve, offset, side)
            expect(chain.regular).toBe(true)
            expect(maxDeviation(curve, offset, side, chain)).toBeLessThanOrEqual(OFFSET_TOLERANCE)
          }
        }
      }
    })
  })
})

describe('end tangents', () => {
  const threeFourFive = { x: expect.closeTo(0.6, 12), y: expect.closeTo(0.8, 12) }

  it('reads a line and the outer controls of a cubic', () => {
    expect(startTangent(line(0, 0, 0, 5))).toEqual(vec(0, 1))
    expect(endTangent(line(0, 0, 0, 5))).toEqual(vec(0, 1))
    expect(startTangent(cubic(0, 0, 3, 4, 9, 9, 10, 0))).toEqual(threeFourFive)
    expect(endTangent(cubic(0, 0, 3, 4, 7, 3, 10, 7))).toEqual(threeFourFive)
  })

  it('uses the next control when one sits on its anchor', () => {
    expect(startTangent(cubic(0, 0, 0, 0, 3, 4, 10, 0))).toEqual(threeFourFive)
    expect(endTangent(cubic(0, 0, 7, 3, 10, 7, 10, 7))).toEqual(threeFourFive)
  })

  it('treats a control a rounding error from its anchor as on it', () => {
    expect(startTangent(cubic(0, 0, 1e-12, -1e-12, 3, 4, 10, 0))).toEqual(threeFourFive)
  })

  it('uses the chord when both controls sit on their anchors', () => {
    const curve = cubic(0, 0, 0, 0, 3, 4, 3, 4)
    expect(startTangent(curve)).toEqual(threeFourFive)
    expect(endTangent(curve)).toEqual(threeFourFive)
  })

  it('agrees with the opposite end of the reversed curve', () => {
    const curve = cubic(0, 0, 10, 2, 30, 40, 50, 10)
    const reversedStart = startTangent(reverseCurve(curve))
    const end = endTangent(curve)
    expect(reversedStart?.x).toBeCloseTo(-(end?.x ?? 0), 12)
    expect(reversedStart?.y).toBeCloseTo(-(end?.y ?? 0), 12)
  })

  it('has none for a point or anything shorter than the degenerate length', () => {
    expect(startTangent(cubic(5, 5, 5, 5, 5, 5, 5, 5))).toBeUndefined()
    expect(endTangent(line(2, 2, 2, 2))).toBeUndefined()
    expect(startTangent(line(1, 1, 1 + 5e-10, 1))).toBeUndefined()
    expect(endTangent(cubic(0, 0, 1e-10, 0, 2e-10, 0, 3e-10, 0))).toBeUndefined()
  })
})
