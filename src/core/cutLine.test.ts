import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCutLine, type CutLine, type CutSpan, type EdgeAllowance } from './cutLine'
import { curveLength, signedArea, vec, type Curve, type Vec2 } from './geometry'
import type { Orientation } from './outline'

type Xy = [number, number]

const lineCurve = (from: Vec2, to: Vec2): Curve => ({ kind: 'line', from, to })
const edgeOf = (segmentId: string, curve: Curve, allowance: number): EdgeAllowance => ({
  edge: { segmentId, reversed: false, curve, length: curveLength(curve) },
  allowance
})
const orientationOf = (edges: readonly EdgeAllowance[]): Orientation =>
  signedArea(edges.map(({ edge }) => edge.curve)) > 0 ? 'clockwise' : 'counterclockwise'

/** Edge i runs from point i to point i + 1, and is named e<i>. */
function polygon(points: readonly Xy[], allowances: readonly number[]): EdgeAllowance[] {
  return points.map(([x, y], i) => {
    const [nextX, nextY] = points[(i + 1) % points.length] ?? [x, y]
    return edgeOf(`e${i}`, lineCurve(vec(x, y), vec(nextX, nextY)), allowances[i] ?? 0)
  })
}

/** The same outline run the other way, each edge keeping its name and allowance. */
function reversedOutline(edges: readonly EdgeAllowance[]): EdgeAllowance[] {
  return edges
    .map(({ edge, allowance }) => {
      const curve: Curve =
        edge.curve.kind === 'line'
          ? { kind: 'line', from: edge.curve.to, to: edge.curve.from }
          : { kind: 'cubic', from: edge.curve.to, c1: edge.curve.c2, c2: edge.curve.c1, to: edge.curve.from }
      return edgeOf(edge.segmentId, curve, allowance)
    })
    .reverse()
}

const windings: [string, (edges: readonly EdgeAllowance[]) => EdgeAllowance[]][] = [
  ['as drafted', (edges) => [...edges]],
  ['reversed', reversedOutline]
]

function build(edges: readonly EdgeAllowance[]): Omit<CutLine, 'notches'> {
  const result = buildCutLine(edges, orientationOf(edges))
  if (!result.ok) throw new Error(`cut line failed: ${JSON.stringify(result.failure)}`)
  return result.line
}

/**
 * The corners of the ring, clockwise on screen, from the lexically lowest point, so expected rings don't
 * depend on winding, start, or the collinear vertices where a chain extends straight to its corner.
 */
function canonical(ring: readonly Vec2[]): Xy[] {
  const area = signedArea(ring.map((point, i) => lineCurve(point, ring[(i + 1) % ring.length] ?? point)))
  const directed = area >= 0 ? [...ring] : [...ring].reverse()
  const corners = directed.filter((point, i) => {
    const previous = directed[(i - 1 + directed.length) % directed.length] ?? point
    const next = directed[(i + 1) % directed.length] ?? point
    return Math.abs((point.x - previous.x) * (next.y - point.y) - (point.y - previous.y) * (next.x - point.x)) > 1e-6
  })
  const coordinates = corners.map(({ x, y }): Xy => [x, y])
  const lowest = coordinates.reduce((best, [x, y], i) => {
    const [bestX, bestY] = coordinates[best] ?? [x, y]
    return x < bestX || (x === bestX && y < bestY) ? i : best
  }, 0)
  return [...coordinates.slice(lowest), ...coordinates.slice(0, lowest)]
}

const edgeIds = (spans: readonly CutSpan[]): string[] => spans.flatMap((span) => (span.kind === 'edge' ? [span.segmentId] : []))

describe('buildCutLine corners', () => {
  describe.each(windings)('%s', (_name, wind) => {
    describe('miter', () => {
      it('brings each edge to its own width at a right angle', () => {
        const line = build(wind(polygon([[0, 0], [100, 0], [100, 200], [0, 200]], [10, 10, 25, 0])))
        expect(canonical(line.ring)).toEqual([[0, -10], [110, -10], [110, 225], [0, 225]])
      })

      it('gives one edge span per edge, starting from the first edge in outline order', () => {
        const edges = wind(polygon([[0, 0], [100, 0], [100, 200], [0, 200]], [10, 10, 25, 5]))
        const line = build(edges)
        expect(edgeIds(line.spans)).toEqual(edges.map(({ edge }) => edge.segmentId))
        expect(line.spans.every((span) => span.kind === 'edge')).toBe(true)
        expect(line.spans.flatMap((span) => (span.kind === 'edge' ? [span.allowance] : []))).toEqual(edges.map(({ allowance }) => allowance))
      })

      it('makes the spans partition the ring in order, each starting where the last ended', () => {
        const line = build(wind(polygon([[0, 0], [100, 0], [100, 200], [0, 200]], [10, 10, 25, 5])))
        const first = line.spans[0]
        const last = line.spans.at(-1)
        expect(first?.points[0]).toEqual(line.ring[0])
        expect(last?.points.at(-1)).toEqual(line.ring[0])
        line.spans.forEach((span, i) => {
          if (i > 0) expect(span.points[0]).toEqual(line.spans[i - 1]?.points.at(-1))
        })
        expect(line.spans.flatMap((span) => span.points.slice(0, -1))).toEqual(line.ring)
      })

      it('clips a long acute tip at four times the wider allowance', () => {
        const edges = wind(polygon([[0, 0], [200, 0], [0, 73]], [10, 10, 10]))
        const line = build(edges)
        const joins = line.spans.flatMap((span) => (span.kind === 'join' ? [span] : []))
        expect(joins).toHaveLength(1)
        const [from, to] = joins[0]?.points ?? []
        if (!from || !to) throw new Error('join has two points')
        // The chord is perpendicular to the corner's bisector, so its midpoint is the nearest point to the corner.
        expect(distanceFromTip({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 })).toBeCloseTo(40, 2)
        expect([joins[0]?.after, joins[0]?.before].sort()).toEqual(['e0', 'e1'])
      })
    })

    describe('parallel tangents', () => {
      const collinear: Xy[] = [[0, 0], [100, 0], [200, 0], [200, 100], [0, 100]]

      it('joins unequal allowances with a step along the normal', () => {
        const line = build(wind(polygon(collinear, [25, 10, 10, 10, 10])))
        expect(canonical(line.ring)).toEqual([[-10, -25], [100, -25], [100, -10], [210, -10], [210, 110], [-10, 110]])
        const joins = line.spans.flatMap((span) => (span.kind === 'join' ? [span] : []))
        expect(joins).toHaveLength(1)
        expect(joins[0]?.points).toHaveLength(2)
      })

      it('needs no join for equal allowances', () => {
        const line = build(wind(polygon(collinear, [10, 10, 10, 10, 10])))
        expect(line.spans.every((span) => span.kind === 'edge')).toBe(true)
      })
    })

    describe('reflex corner', () => {
      const lShape: Xy[] = [[0, 0], [100, 0], [100, 50], [50, 50], [50, 100], [0, 100]]

      it('meets where the two offsets cross, at each edge own width', () => {
        const line = build(wind(polygon(lShape, [10, 10, 25, 5, 10, 10])))
        expect(canonical(line.ring)).toContainEqual([55, 75])
        expect(canonical(line.ring)).toEqual([[-10, -10], [110, -10], [110, 75], [55, 75], [55, 110], [-10, 110]])
      })

      it('leaves no join span, because the union removes the corner loop', () => {
        const line = build(wind(polygon(lShape, [10, 10, 25, 5, 10, 10])))
        expect(line.spans.every((span) => span.kind === 'edge')).toBe(true)
      })
    })

    describe('two zero allowances', () => {
      it('share the seam vertex', () => {
        const line = build(wind(polygon([[0, 0], [100, 0], [100, 100], [0, 100]], [10, 10, 0, 0])))
        expect(canonical(line.ring)).toEqual([[0, -10], [110, -10], [110, 100], [0, 100]])
      })
    })

    describe('landing on a zero edge', () => {
      const foldWithShallowNeck = (): EdgeAllowance[] => polygon([[0, 200], [0, 0], [100, -30], [100, 200]], [0, 10, 10, 25])

      it('trims the neighbour where it reaches the zero edge line, never crossing it', () => {
        const line = build(wind(foldWithShallowNeck()))
        expect(Math.min(...line.ring.map((p) => p.x))).toBe(0)
        const landing = line.ring.find((p) => p.x === 0 && p.y < 0)
        expect(landing?.y).toBeCloseTo(-10.4403, 3)
      })

      it('needs no join', () => {
        expect(build(wind(foldWithShallowNeck())).spans.every((span) => span.kind === 'edge')).toBe(true)
      })

      it('falls back to a connector if the edge itself crosses the zero edge line first', () => {
        const edges = [
          edgeOf('fold', lineCurve(vec(0, 200), vec(0, 0)), 0),
          edgeOf('neck', { kind: 'cubic', from: vec(0, 0), c1: vec(3, -60), c2: vec(-60, -60), to: vec(200, -100) }, 10),
          edgeOf('side', lineCurve(vec(200, -100), vec(200, 200)), 10),
          edgeOf('hem', lineCurve(vec(200, 200), vec(0, 200)), 10)
        ]
        const line = build(wind(edges))
        const join = line.spans.find((span) => span.kind === 'join')
        expect(join?.kind === 'join' && [join.after, join.before].sort()).toEqual(['fold', 'neck'])
        const outer = join?.points.find((p) => p.x !== 0)
        expect(outer?.x).toBeCloseTo(-9.988, 2)
        expect(outer?.y).toBeCloseTo(-0.499, 2)
      })
    })

    describe('connector', () => {
      it('keeps both edges at full width where a miter would shorten the wider one', () => {
        const line = build(wind(polygon([[0, 0], [100, 0], [186.6, 50], [186.6, 150], [0, 150]], [25, 10, 10, 10, 10])))
        const join = line.spans.find((span) => span.kind === 'join')
        expect(join?.points).toHaveLength(2)
        const [a, b] = [...(join?.points ?? [])].sort((p, q) => p.x - q.x)
        expect(a?.x).toBeCloseTo(100, 2)
        expect(a?.y).toBeCloseTo(-25, 2)
        expect(b?.x).toBeCloseTo(105, 2)
        expect(b?.y).toBeCloseTo(-8.66, 2)
      })

      it('makes a small step at a near-tangent corner, with no angle threshold', () => {
        const line = build(wind(polygon([[0, 0], [100, 0], [200, 0.873], [200, 100], [0, 100]], [25, 10, 10, 10, 10])))
        const [a, b] = [...(line.spans.find((span) => span.kind === 'join')?.points ?? [])].sort((p, q) => p.y - q.y)
        expect([a?.x, a?.y]).toEqual([100, -25])
        expect(b?.x).toBeCloseTo(100.087, 3)
        expect(b?.y).toBeCloseTo(-10, 2)
      })
    })
  })
})


const distanceFromTip = ({ x, y }: Vec2): number => Math.hypot(x - 200, y)

describe('buildCutLine failures', () => {
  function failureOf(edges: readonly EdgeAllowance[], fold?: string): unknown {
    const result = buildCutLine(edges, orientationOf(edges), fold)
    return result.ok ? 'built' : result.failure
  }
  const square = (allowance: number, size = 100): EdgeAllowance[] =>
    polygon([[0, 0], [size, 0], [size, size], [0, size]], [allowance, allowance, allowance, allowance])
  const uSlot: Xy[] = [[0, 0], [40, 0], [40, 150], [60, 150], [60, 0], [100, 0], [100, 200], [0, 200]]
  const keyhole: Xy[] = [
    [0, 0], [90, 0], [90, 20], [40, 20], [40, 120], [160, 120], [160, 20], [110, 20], [110, 0], [200, 0], [200, 200], [0, 200]
  ]
  const uniform = (points: readonly Xy[], allowance: number): EdgeAllowance[] => polygon(points, points.map(() => allowance))

  /** A flat top with a concave half circle of radius 15 bitten out of it, as two cubics. */
  function concaveArc(allowance: number): EdgeAllowance[] {
    const k = 0.5522847498307936 * 15
    const [left, top, right] = [vec(85, 0), vec(100, -15), vec(115, 0)]
    return [
      edgeOf('l', lineCurve(vec(0, 0), left), allowance),
      edgeOf('c1', { kind: 'cubic', from: left, c1: vec(85, -k), c2: vec(100 - k, -15), to: top }, allowance),
      edgeOf('c2', { kind: 'cubic', from: top, c1: vec(100 + k, -15), c2: vec(115, -k), to: right }, allowance),
      edgeOf('r', lineCurve(right, vec(200, 0)), allowance),
      edgeOf('b', lineCurve(vec(200, 0), vec(200, -100)), allowance),
      edgeOf('t', lineCurve(vec(200, -100), vec(0, -100)), allowance),
      edgeOf('f', lineCurve(vec(0, -100), vec(0, 0)), allowance)
    ]
  }

  describe.each(windings)('%s', (_name, wind) => {
    describe('out of range', () => {
      it.each([1e7, 1e300, Number.POSITIVE_INFINITY, Number.NaN])('refuses a coordinate of %d', (size) => {
        expect(failureOf(wind(square(10, size)))).toEqual({ kind: 'out-of-range' })
      })

      it('refuses an allowance that reaches past the range', () => {
        expect(failureOf(wind(polygon([[0, 0], [10, 0], [10, 10], [0, 10]], [1e12, 10, 10, 10])))).toEqual({ kind: 'out-of-range' })
      })

      it.each([-1, Number.NaN])('refuses an allowance of %d', (allowance) => {
        expect(failureOf(wind(polygon([[0, 0], [10, 0], [10, 10], [0, 10]], [allowance, 10, 10, 10])))).toEqual({ kind: 'out-of-range' })
      })

      it('accepts a piece just inside the range', () => {
        expect(failureOf(wind(square(10, 99_000)))).toBe('built')
      })
    })

    it('refuses a seam outline that crosses itself', () => {
      expect(failureOf(wind(uniform([[0, 0], [100, 100], [100, 0], [0, 100]], 10)))).toEqual({ kind: 'source-self-intersects' })
    })

    it('names the edge with a cusp', () => {
      const edges = [
        edgeOf('cusp', { kind: 'cubic', from: vec(0, 0), c1: vec(100, 100), c2: vec(0, 100), to: vec(100, 0) }, 10),
        edgeOf('r', lineCurve(vec(100, 0), vec(100, -100)), 10),
        edgeOf('b', lineCurve(vec(100, -100), vec(0, -100)), 10),
        edgeOf('l', lineCurve(vec(0, -100), vec(0, 0)), 10)
      ]
      expect(failureOf(wind(edges))).toEqual({ kind: 'cusp', segmentId: 'cusp' })
    })

    it('reports allowances that close a neck into a hole as a split', () => {
      expect(failureOf(wind(uniform(keyhole, 15)))).toEqual({ kind: 'split', rings: 2 })
    })

    describe('an edge consumed by its neighbours', () => {
      it('builds while a slot stays open', () => {
        expect(failureOf(wind(uniform(uSlot, 9.99)))).toBe('built')
      })

      it('is refused when the allowance reaches half the slot width', () => {
        // At half the width both walls offset onto one line, so any edge of the slot may be the one named.
        expect(failureOf(wind(uniform(uSlot, 10)))).toEqual({ kind: 'edge-swallowed', segmentId: expect.stringMatching(/^e[123]$/) })
      })

      it('builds on a concave arc while the allowance is below its radius', () => {
        expect(failureOf(wind(concaveArc(14)))).toBe('built')
      })

      it('is refused at the radius of a concave arc', () => {
        expect(failureOf(wind(concaveArc(15)))).toMatchObject({ kind: 'edge-swallowed' })
      })
    })

    it('builds an allowance larger than a convex piece', () => {
      expect(canonical(build(wind(square(500))).ring)).toEqual([[-500, -500], [600, -500], [600, 600], [-500, 600]])
    })

    describe('an edge too short to matter', () => {
      const withTinyEdge = (end: number): EdgeAllowance[] => polygon([[0, 0], [100, 0], [end, 0], [100, 100], [0, 100]], [10, 99, 20, 10, 10])

      it('gets no span at zero length, and its neighbours join directly', () => {
        const line = build(wind(withTinyEdge(100)))
        expect(edgeIds(line.spans).sort()).toEqual(['e0', 'e2', 'e3', 'e4'])
        expect(canonical(line.ring)).toEqual([[-10, -10], [120, -10], [120, 110], [-10, 110]])
      })

      it('gets no span below one grid unit, and its neighbours still meet at their own widths', () => {
        const line = build(wind(withTinyEdge(100.0005)))
        expect(edgeIds(line.spans).sort()).toEqual(['e0', 'e2', 'e3', 'e4'])
        expect(line.ring.some((p) => Math.abs(p.x - 120) < 0.01 && Math.abs(p.y + 10) < 0.01)).toBe(true)
      })
    })

    describe('a fold', () => {
      const crossesAtNeck = (): EdgeAllowance[] => [
        edgeOf('fold', lineCurve(vec(0, 200), vec(0, 0)), 0),
        edgeOf('neck', { kind: 'cubic', from: vec(0, 0), c1: vec(3, -60), c2: vec(-60, -60), to: vec(200, -100) }, 10),
        edgeOf('side', lineCurve(vec(200, -100), vec(200, 200)), 10),
        edgeOf('hem', lineCurve(vec(200, 200), vec(0, 200)), 10)
      ]

      it('is refused when the cut line leaves the fold line', () => {
        expect(failureOf(wind(crossesAtNeck()), 'fold')).toEqual({ kind: 'crosses-fold', segmentId: 'fold' })
      })

      it('is accepted when the cut line lands on the fold line', () => {
        expect(failureOf(wind(polygon([[0, 200], [0, 0], [100, -30], [100, 200]], [0, 10, 10, 25])), 'e0')).toBe('built')
      })

      it('is ignored when it names no edge of the outline', () => {
        expect(failureOf(wind(crossesAtNeck()), 'other')).toBe('built')
      })
    })
  })

  it('handles an outline of one closed curve', () => {
    const loop = [edgeOf('loop', { kind: 'cubic', from: vec(0, 0), c1: vec(150, -150), c2: vec(-150, -150), to: vec(0, 0) }, 10)]
    const line = build(loop)
    expect(edgeIds(line.spans)).toEqual(['loop'])
  })

  it('does not throw on an empty outline', () => {
    expect(failureOf([])).toEqual({ kind: 'source-self-intersects' })
  })

  it('is pure: the same input gives the same output and is left unchanged', () => {
    const edges = polygon([[0, 200], [0, 0], [100, -30], [100, 200]], [0, 10, 10, 25])
    const before = structuredClone(edges)
    expect(build(edges)).toEqual(build(edges))
    expect(edges).toEqual(before)
  })

  describe('when the union module reports a problem', () => {
    afterEach(() => {
      vi.doUnmock('./ringUnion')
      vi.resetModules()
    })

    async function withRingUnion(overrides: Partial<typeof import('./ringUnion')>) {
      vi.resetModules()
      vi.doMock('./ringUnion', async (importOriginal) => ({ ...(await importOriginal<typeof import('./ringUnion')>()), ...overrides }))
      return import('./cutLine')
    }
    const failureWith = (mocked: typeof import('./cutLine'), edges: readonly EdgeAllowance[]): unknown => {
      const result = mocked.buildCutLine(edges, orientationOf(edges))
      return result.ok ? 'built' : result.failure
    }

    it('turns a failed union into engine-failed', async () => {
      const mocked = await withRingUnion({ unionRing: () => ({ ok: false, detail: 'boom' }) })
      expect(failureWith(mocked, square(10))).toEqual({ kind: 'engine-failed', detail: 'boom' })
    })

    it('turns a failed simplicity check into engine-failed', async () => {
      const mocked = await withRingUnion({ ringIsSimple: () => ({ ok: false, detail: 'boom' }) })
      expect(failureWith(mocked, square(10))).toEqual({ kind: 'engine-failed', detail: 'boom' })
    })

    it('reports a seam outline escaping the ring', async () => {
      const mocked = await withRingUnion({ areaOutside: () => Number.POSITIVE_INFINITY })
      expect(failureWith(mocked, square(10))).toEqual({ kind: 'source-outside' })
    })
  })
})
