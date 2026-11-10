import { describe, expect, it } from 'vitest'
import { CUT_LINE_BOUND, type CutLine } from '../cutLine'
import { evaluate } from '../evaluate'
import { add, derivativeAt, distance, flatten, norm, pointAt, scale, signedArea, type Vec2 } from '../geometry'
import type { ResolvedPiece } from '../outline'
import { areaOutside, ringIsSimple } from '../ringUnion'
import { raglanFailingInXXL, raglanTee } from './raglan'

/**
 * The raglan as the milestone 5 acceptance test. docs/design/m5-pieces.md says what each check asserts.
 */
const sizes = raglanTee.sizes
const resolvedFor = (size: string) => evaluate(raglanTee, size)

describe('raglan tee fixture', () => {
  it.each(sizes)('resolves all four pieces with no issues in size %s', (size) => {
    const resolved = resolvedFor(size)
    expect(resolved.issues).toEqual([])
    expect(Object.keys(resolved.pieces)).toEqual(['front', 'back', 'sleeve', 'neckband'])
  })

  it.each([
    ['frontRaglan', 'sleeveFrontRaglan'],
    ['backRaglan', 'sleeveBackRaglan']
  ])('sews %s to %s at the same length in every size', (body, sleeve) => {
    for (const size of sizes) {
      const { segments } = resolvedFor(size)
      expect(segments[sleeve]?.length).toBeCloseTo(segments[body]?.length ?? Number.NaN, 6)
    }
  })

  it.each(['front', 'back', 'sleeve', 'neckband'])('grades %s larger at every step', (id) => {
    const areas = sizes.map((size) => resolvedFor(size).pieces[id]?.area ?? Number.NaN)
    for (const [i, area] of areas.entries()) {
      if (i > 0) expect(area).toBeGreaterThan(areas[i - 1] ?? Number.POSITIVE_INFINITY)
    }
  })

  it('winds the neckband the other way from the body', () => {
    const { pieces } = resolvedFor('M')
    expect(pieces['neckband']?.orientation).not.toBe(pieces['front']?.orientation)
  })

  describe('cut line (milestone 5)', () => {
    const pieceIds = ['front', 'back', 'sleeve', 'neckband']
    const onGrid = (value: number): number => Math.round(value * 1000) / 1000

    /** Every built piece in every size, for checks that hold for all of them. */
    function forEachPiece(check: (piece: ResolvedPiece, line: CutLine, size: string) => void): void {
      for (const size of sizes) {
        for (const piece of Object.values(resolvedFor(size).pieces)) {
          if (!piece.cutLine) throw new Error(`${piece.id} has no cut line in ${size}`)
          check(piece, piece.cutLine, size)
        }
      }
    }

    function distanceToChain(point: Vec2, chain: readonly Vec2[]): number {
      let nearest = Infinity
      chain.forEach((a, i) => {
        const b = chain[i + 1]
        if (!b) return
        const [dx, dy] = [b.x - a.x, b.y - a.y]
        const lengthSquared = dx * dx + dy * dy
        const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
        nearest = Math.min(nearest, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy))
      })
      return nearest
    }
    const edgeSpans = (line: CutLine, segmentId: string): Vec2[] =>
      line.spans.flatMap((span) => (span.kind === 'edge' && span.segmentId === segmentId ? [...span.points] : []))
    const closed = (ring: readonly Vec2[]): Vec2[] => (ring[0] ? [...ring, ring[0]] : [])

    it('builds a cut line and grainline for every piece in every size', () => {
      for (const size of sizes) {
        const { pieces, issues } = resolvedFor(size)
        expect(issues).toEqual([])
        for (const id of pieceIds) {
          expect(pieces[id]?.cutLine).toBeDefined()
          expect(pieces[id]?.grainline).toBeDefined()
        }
      }
    })

    it.each([
      ['front', 'frontCf'],
      ['back', 'backCb']
    ])('lands %s exactly on the fold along %s, with min x equal to 0', (id, fold) => {
      for (const size of sizes) {
        const piece = resolvedFor(size).pieces[id]
        expect(piece?.fold?.segmentId).toBe(fold)
        if (!piece?.cutLine) throw new Error('no cut line')
        expect(edgeSpans(piece.cutLine, fold).every((point) => point.x === 0)).toBe(true)
        expect(Math.min(...piece.cutLine.ring.map((point) => point.x))).toBe(0)
      }
    })

    it.each(['front', 'back'])('keeps every %s hem point at hem_length + 25 and every side point at body_width + 10', (id) => {
      for (const size of sizes) {
        const { pieces, variables } = resolvedFor(size)
        const line = pieces[id]?.cutLine
        if (!line) throw new Error('no cut line')
        expect([...new Set(edgeSpans(line, 'frontHem').map((point) => point.y))]).toEqual([onGrid((variables['hem_length'] ?? 0) + 25)])
        expect([...new Set(edgeSpans(line, 'frontSide').map((point) => point.x))]).toEqual([onGrid((variables['body_width'] ?? 0) + 10)])
      }
    })

    it('keeps curved spans within CUT_LINE_BOUND of the true offset, with the bound checked both ways', () => {
      forEachPiece((piece, line) => {
        const outward = (t: Vec2): Vec2 => (piece.orientation === 'clockwise' ? { x: t.y, y: -t.x } : { x: -t.y, y: t.x })
        for (const span of line.spans) {
          if (span.kind !== 'edge') continue
          const edge = piece.outline.find(({ segmentId }) => segmentId === span.segmentId)
          if (!edge || edge.curve.kind !== 'cubic') continue
          const curve = flatten(edge.curve, 0.001)
          // Span to curve. The first and last chords may be straight extensions to a corner.
          span.points.slice(1, -2).forEach((a, i) => {
            const b = span.points[i + 2]
            if (!b) return
            for (const t of [0.25, 0.5, 0.75]) {
              const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
              expect(Math.abs(distanceToChain(point, curve) - span.allowance)).toBeLessThanOrEqual(CUT_LINE_BOUND)
            }
          })
          // Curve to ring.
          const ring = closed(line.ring)
          for (let i = 0; i <= 200; i++) {
            const derivative = derivativeAt(edge.curve, i / 200)
            const speed = norm(derivative)
            if (speed === 0) continue
            const onOffset = add(pointAt(edge.curve, i / 200), scale(outward(scale(derivative, 1 / speed)), span.allowance))
            expect(distanceToChain(onOffset, ring)).toBeLessThanOrEqual(CUT_LINE_BOUND)
          }
        }
      })
    })

    it('gives one edge span per outline edge, in outline order, with joins only at the sleeve hem', () => {
      forEachPiece((piece, line) => {
        expect(line.spans.flatMap((span) => (span.kind === 'edge' ? [span.segmentId] : []))).toEqual(piece.outline.map((edge) => edge.segmentId))
        for (const span of line.spans) {
          if (span.kind !== 'join') continue
          expect(piece.id).toBe('sleeve')
          expect([span.after, span.before]).toContain('sleeveHem')
        }
      })
    })

    it('contains every source point inside a simple ring', () => {
      forEachPiece((piece, line) => {
        expect(ringIsSimple(line.ring)).toEqual({ ok: true, simple: true })
        const seam = piece.outline.flatMap((edge) => flatten(edge.curve, 0.02).slice(0, -1))
        expect(areaOutside(seam, line.ring)).toBeLessThanOrEqual(piece.outline.reduce((sum, edge) => sum + edge.length, 0) * 0.05)
      })
    })

    it('lands each notch on the cut line at its edge allowance from the seam', () => {
      let checked = 0
      forEachPiece((piece, line) => {
        expect(line.notches).toHaveLength(piece.notches.length)
        for (const notch of line.notches) {
          const seam = piece.notches.find(({ id }) => id === notch.notchId)
          if (!seam) throw new Error('notch has no seam point')
          expect(distanceToChain(notch.at, closed(line.ring))).toBeLessThanOrEqual(CUT_LINE_BOUND)
          expect(distance(notch.at, seam.point)).toBeCloseTo(10, 1)
          checked++
        }
      })
      expect(checked).toBe(sizes.length * 2)
    })

    it.each(pieceIds)('grows the %s cut area at every size step', (id) => {
      const areaOf = (size: string): number => {
        const ring = resolvedFor(size).pieces[id]?.cutLine?.ring ?? []
        return Math.abs(signedArea(ring.map((from, i) => ({ kind: 'line' as const, from, to: ring[(i + 1) % ring.length] ?? from }))))
      }
      const areas = sizes.map(areaOf)
      areas.forEach((area, i) => {
        if (i > 0) expect(area).toBeGreaterThan(areas[i - 1] ?? Number.POSITIVE_INFINITY)
      })
    })

    it('gives deep-equal cut lines from two evaluate calls', () => {
      expect(resolvedFor('L').pieces).toEqual(resolvedFor('L').pieces)
    })
  })
})

describe('raglan failing only in XXL', () => {
  it.each(['S', 'M', 'L', 'XL'])('has every piece, cut line and no issues in size %s', (size) => {
    const resolved = evaluate(raglanFailingInXXL, size)
    expect(resolved.issues).toEqual([])
    expect(Object.values(resolved.pieces).map((piece) => [piece.id, piece.cutLine !== undefined])).toEqual([
      ['front', true],
      ['back', true],
      ['sleeve', true],
      ['neckband', true]
    ])
  })

  it('loses the Neckband outline and the Front cut line in XXL, and nothing else', () => {
    const resolved = evaluate(raglanFailingInXXL, 'XXL')
    expect(resolved.issues.map((issue) => (issue.kind === 'unknown-size' ? issue.kind : [issue.kind, issue.item]))).toEqual([
      ['cut-line-failed', { kind: 'piece', id: 'front', name: 'Front' }],
      ['degenerate-outline', { kind: 'piece', id: 'neckband', name: 'Neckband' }]
    ])
    expect(Object.values(resolved.pieces).map((piece) => [piece.id, piece.cutLine !== undefined])).toEqual([
      ['front', false],
      ['back', true],
      ['sleeve', true]
    ])
  })
})
