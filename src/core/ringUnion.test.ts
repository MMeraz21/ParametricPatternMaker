import { ClipType, Clipper64, FillRule, PathType, type Path64, type Paths64 } from 'clipper2-ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { vec, type Vec2 } from './geometry'
import { areaOutside, ringIsSimple, unionRing, type UnionVertex } from './ringUnion'

const ring = (...coordinates: [number, number][]): Vec2[] => coordinates.map(([x, y]) => vec(x, y))

/** Positive area in y-down coordinates, so clockwise on screen. */
const square = ring([0, 0], [100, 0], [100, 100], [0, 100])

/**
 * An L-shaped body with a tab that winds the other way. Segment 1 ((100,0) to (100,50)) crosses segment 4
 * ((150,25) to (50,25)) at (100,25), and a positive-winding union removes the tab.
 */
const bodyWithTab = ring([0, 0], [100, 0], [100, 50], [150, 50], [150, 25], [50, 25], [50, 100], [0, 100])
const bowTie = ring([0, 0], [100, 100], [100, 0], [0, 100])

/** Rotate so comparisons don't depend on which vertex the library happens to start at. */
function fromLowestPoint(vertices: readonly UnionVertex[]): UnionVertex[] {
  const key = ({ point }: UnionVertex): number => point.x * 1e7 + point.y
  const lowest = vertices.reduce((best, vertex, i) => (key(vertex) < key(vertices[best] ?? vertex) ? i : best), 0)
  return [...vertices.slice(lowest), ...vertices.slice(0, lowest)]
}

function singleRing(input: readonly Vec2[]): UnionVertex[] {
  const result = unionRing(input)
  if (!result.ok) throw new Error(result.detail)
  const [only, ...others] = result.rings
  if (!only || others.length > 0) throw new Error(`expected one ring, got ${result.rings.length}`)
  return fromLowestPoint(only)
}

const input = (x: number, y: number, index: number): UnionVertex => ({ point: vec(x, y), origin: { kind: 'input', index } })

describe('clipper2-ts behaviour we depend on', () => {
  function union(path: Path64, onCrossing?: (point: { z?: number }) => void): Paths64 {
    const clipper = new Clipper64()
    if (onCrossing) clipper.zCallback = (_bot1, _top1, _bot2, _top2, point) => onCrossing(point)
    clipper.addPaths([path], PathType.Subject, false)
    const out: Paths64 = []
    clipper.execute(ClipType.Union, FillRule.Positive, out)
    return out
  }
  const scaled = (points: readonly Vec2[]): Path64 => points.map(({ x, y }, i) => ({ x: x * 1000, y: y * 1000, z: i + 1 }))

  it('keeps each input vertex z through a union', () => {
    const [only] = union(scaled(square), () => undefined)
    expect(new Map(only?.map((p) => [`${p.x},${p.y}`, p.z]))).toEqual(
      new Map([
        ['0,0', 1],
        ['100000,0', 2],
        ['100000,100000', 3],
        ['0,100000', 4]
      ])
    )
  })

  it('calls zCallback for a crossing and keeps the z it sets', () => {
    const [only] = union(scaled(bodyWithTab), (point) => {
      point.z = -7
    })
    expect(only?.find((p) => p.x === 100000 && p.y === 25000)?.z).toBe(-7)
  })

  it('keeps a vertex in the middle of a straight run by default', () => {
    const [only] = union(scaled(ring([0, 0], [50, 0], [100, 0], [100, 100], [0, 100])))
    expect(only).toHaveLength(5)
  })
})

describe('unionRing', () => {
  it('returns a simple ring unchanged, with every vertex traced to its input', () => {
    expect(singleRing(square)).toEqual([input(0, 0, 0), input(100, 0, 1), input(100, 100, 2), input(0, 100, 3)])
  })

  it('keeps the direction of the ring it was given', () => {
    const cycle = (vertices: UnionVertex[]) => vertices.map((v) => [v.point.x, v.point.y])
    expect(cycle(singleRing(square))).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100]
    ])
    expect(cycle(singleRing([...square].reverse()))).toEqual([
      [0, 0],
      [0, 100],
      [100, 100],
      [100, 0]
    ])
  })

  it('removes a loop that winds the other way and names the segments that cross', () => {
    expect(singleRing(bodyWithTab)).toEqual([
      input(0, 0, 0),
      input(100, 0, 1),
      { point: vec(100, 25), origin: { kind: 'crossing', segments: [1, 4] } },
      input(50, 25, 5),
      input(50, 100, 6),
      input(0, 100, 7)
    ])
  })

  it('removes the same loop in a ring that runs the other way', () => {
    const reversed = [...bodyWithTab].reverse()
    const crossing = singleRing(reversed).find((vertex) => vertex.origin.kind === 'crossing')
    // Reversed, the segments are 2 ((50,25) to (150,25)) and 5 ((100,50) to (100,0)).
    expect(crossing).toEqual({ point: vec(100, 25), origin: { kind: 'crossing', segments: [2, 5] } })
  })

  it('returns one ring per region when the ring pinches into separate parts', () => {
    const twoSquaresAndBridge = ring(
      [0, 0], [10, 0], [10, 5], [20, 5], [20, 0], [30, 0], [30, 10], [20, 10], [20, 5], [10, 5], [10, 10], [0, 10]
    )
    const result = unionRing(twoSquaresAndBridge)
    expect(result.ok && result.rings.length).toBe(2)
  })

  it('keeps a vertex in the middle of a straight edge', () => {
    expect(singleRing(ring([0, 0], [50, 0], [100, 0], [100, 100], [0, 100]))).toHaveLength(5)
  })

  it('works on a 1 micrometre grid', () => {
    expect(singleRing(ring([0.0004, -0.0004], [1.23449, 0], [1.23449, 1.23451], [0, 1.23451])).map((v) => v.point)).toEqual([
      vec(0, 0),
      vec(1.234, 0),
      vec(1.234, 1.235),
      vec(0, 1.235)
    ])
  })

  describe('vertices that land on one grid point', () => {
    it('merge, and report the first of them', () => {
      const vertices = singleRing(ring([0, 0], [100, 0], [100.0001, 0], [100, 100], [0, 100]))
      expect(vertices.find((v) => v.point.x === 100 && v.point.y === 0)?.origin).toEqual({ kind: 'input', index: 1 })
      expect(vertices).toHaveLength(4)
    })

    it('still number the crossing segments by their input position', () => {
      const withRepeat = ring([0, 0], [100, 0], [100.0001, 0], [100, 50], [150, 50], [150, 25], [50, 25], [50, 100], [0, 100])
      expect(singleRing(withRepeat).find((v) => v.origin.kind === 'crossing')?.origin).toEqual({ kind: 'crossing', segments: [2, 5] })
    })

    it('merge across the closing edge of the ring, reporting the first in ring order', () => {
      const vertices = singleRing(ring([0, 0], [100, 0], [100, 100], [0, 100], [0, 0]))
      expect(vertices).toHaveLength(4)
      expect(vertices[0]).toEqual(input(0, 0, 4))
    })
  })

  it('never returns negative zero', () => {
    const vertices = singleRing(ring([-0.0004, -0.0004], [100, -0.0004], [100, 100], [-0.0004, 100]))
    expect(vertices.flatMap((v) => [v.point.x, v.point.y]).some((value) => Object.is(value, -0))).toBe(false)
  })

  it('has no rings for fewer than three distinct points', () => {
    expect(unionRing([])).toEqual({ ok: true, rings: [] })
    expect(unionRing(ring([1, 1], [2, 2]))).toEqual({ ok: true, rings: [] })
    expect(unionRing(ring([1, 1], [1, 1], [1, 1]))).toEqual({ ok: true, rings: [] })
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1e300])('fails rather than throws for a coordinate of %d', (bad) => {
    expect(unionRing(ring([0, 0], [bad, 0], [0, 100]))).toMatchObject({ ok: false })
  })
})

describe('ringIsSimple', () => {
  it('accepts a simple ring in either direction', () => {
    expect(ringIsSimple(square)).toEqual({ ok: true, simple: true })
    expect(ringIsSimple([...square].reverse())).toEqual({ ok: true, simple: true })
  })

  it('accepts an irregular ring 100 m across, where floating-point area would lose the units', () => {
    const large = ring([0.001, 0.003], [99999.997, 0.007], [99999.991, 99999.989], [50000.123, 99999.999], [0.011, 99999.993])
    expect(ringIsSimple(large)).toEqual({ ok: true, simple: true })
  })

  it('rejects a figure of eight', () => {
    expect(ringIsSimple(bowTie)).toEqual({ ok: true, simple: false })
  })

  it('rejects a ring that crosses itself and winds back', () => {
    expect(ringIsSimple(bodyWithTab)).toEqual({ ok: true, simple: false })
  })

  it('rejects a ring that covers part of itself twice', () => {
    const doubledBack = ring([0, 0], [100, 0], [100, 100], [0, 100], [0, 20], [60, 20], [60, 60], [20, 60], [20, 10], [0, 10])
    expect(ringIsSimple(doubledBack)).toEqual({ ok: true, simple: false })
  })

  it('rejects a ring that pinches into two parts, even though its area is unchanged', () => {
    const twoSquaresAndBridge = ring(
      [0, 0], [10, 0], [10, 5], [20, 5], [20, 0], [30, 0], [30, 10], [20, 10], [20, 5], [10, 5], [10, 10], [0, 10]
    )
    expect(ringIsSimple(twoSquaresAndBridge)).toEqual({ ok: true, simple: false })
  })

  it('reports too few points as not simple', () => {
    expect(ringIsSimple(ring([1, 1], [2, 2]))).toEqual({ ok: true, simple: false })
  })

  it('fails rather than throws for a coordinate it cannot place on the grid', () => {
    expect(ringIsSimple(ring([0, 0], [Number.NaN, 0], [0, 100]))).toMatchObject({ ok: false })
  })
})

describe('areaOutside', () => {
  const box = (x0: number, y0: number, x1: number, y1: number): Vec2[] => ring([x0, y0], [x1, y0], [x1, y1], [x0, y1])

  it('is zero when the inner ring is inside', () => {
    expect(areaOutside(box(10, 10, 20, 20), square)).toBe(0)
  })

  it('is the part that sticks out', () => {
    expect(areaOutside(box(90, 0, 110, 10), square)).toBe(100)
  })

  it('is the whole ring when the two are apart', () => {
    expect(areaOutside(box(200, 200, 210, 220), square)).toBe(200)
  })

  it('subtracts a hole the outer ring cuts from the inner one', () => {
    expect(areaOutside(square, box(10, 10, 20, 20))).toBe(9900)
  })

  it('does not depend on the direction of either ring', () => {
    expect(areaOutside([...box(90, 0, 110, 10)].reverse(), [...square].reverse())).toBe(100)
  })

  it('reports everything as outside when it cannot compute', () => {
    expect(areaOutside(ring([0, 0], [Number.NaN, 0], [0, 100]), square)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('when the library throws', () => {
  afterEach(() => {
    vi.doUnmock('clipper2-ts')
    vi.resetModules()
  })

  async function withThrowingLibrary(thrown: unknown) {
    vi.resetModules()
    vi.doMock('clipper2-ts', async (importOriginal) => {
      const real = await importOriginal<typeof import('clipper2-ts')>()
      class ThrowingClipper extends real.Clipper64 {
        override execute(): boolean {
          throw thrown
        }
      }
      return { ...real, Clipper64: ThrowingClipper }
    })
    return import('./ringUnion')
  }

  it('reports an Error as a failure, with its message', async () => {
    const mocked = await withThrowingLibrary(new RangeError('coordinate overflow'))
    expect(mocked.unionRing(square)).toEqual({ ok: false, detail: 'coordinate overflow' })
    expect(mocked.ringIsSimple(square)).toEqual({ ok: false, detail: 'coordinate overflow' })
    expect(mocked.areaOutside(square, square)).toBe(Number.POSITIVE_INFINITY)
  })

  it('reports anything else that is thrown as a failure too', async () => {
    const mocked = await withThrowingLibrary('not an error object')
    expect(mocked.unionRing(square)).toEqual({ ok: false, detail: 'not an error object' })
  })
})
