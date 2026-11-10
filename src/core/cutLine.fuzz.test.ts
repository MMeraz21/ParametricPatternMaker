import { describe, expect, it } from 'vitest'
import { CUT_LINE_BOUND, buildCutLine, type CutLineFailure, type EdgeAllowance } from './cutLine'
import { OFFSET_TOLERANCE, curveLength, flatten, offsetCurve, signedArea, type Curve, type Vec2 } from './geometry'
import type { Orientation } from './outline'
import { areaOutside, ringIsSimple } from './ringUnion'

/** Deterministic, so a failure here reproduces exactly. */
function randomSource(start: number): () => number {
  let seed = start
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
}

const ALLOWANCES = [0, 5, 10, 10, 10, 16, 25]

/** A star-ish outline around the origin, so it is usually simple, with each edge a line or a gentle cubic. */
function randomOutline(random: () => number): EdgeAllowance[] {
  const count = 3 + Math.floor(random() * 8)
  const corners = Array.from({ length: count }, (_, i): Vec2 => {
    const angle = (2 * Math.PI * i) / count + ((random() - 0.5) * Math.PI) / count / 1.5
    const radius = 120 + random() * 280
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }
  })
  return corners.flatMap((from, i) => {
    const to = corners[(i + 1) % count]
    if (!to) return []
    const [dx, dy] = [to.x - from.x, to.y - from.y]
    const allowance = ALLOWANCES[Math.floor(random() * ALLOWANCES.length)] ?? 10
    let curve: Curve = { kind: 'line', from, to }
    if (random() < 0.5) {
      const [bend1, bend2] = [(random() - 0.5) * 0.5, (random() - 0.5) * 0.5]
      curve = {
        kind: 'cubic',
        from,
        c1: { x: from.x + dx / 3 - dy * bend1, y: from.y + dy / 3 + dx * bend1 },
        c2: { x: from.x + (2 * dx) / 3 - dy * bend2, y: from.y + (2 * dy) / 3 + dx * bend2 },
        to
      }
    }
    return [{ edge: { segmentId: `e${i}`, reversed: false, curve, length: curveLength(curve) }, allowance }]
  })
}

function distanceToChain(point: Vec2, chain: readonly Vec2[]): number {
  let nearest = Infinity
  for (let i = 1; i < chain.length; i++) {
    const [a, b] = [chain[i - 1], chain[i]]
    if (!a || !b) continue
    const [dx, dy] = [b.x - a.x, b.y - a.y]
    const lengthSquared = dx * dx + dy * dy
    const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
    nearest = Math.min(nearest, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy))
  }
  return nearest
}

describe('buildCutLine on 4,000 random outlines', () => {
  it('builds valid cut lines, or fails with a reason', () => {
    const random = randomSource(12345)
    const outcomes = new Map<CutLineFailure['kind'] | 'built', number>()
    let eligible = 0
    let seamMiss = 0
    let bandMiss = 0
    let notSimple = 0
    let worstInteriorError = 0

    for (let shape = 0; shape < 4000; shape++) {
      const edges = randomOutline(random)
      const curves = edges.map(({ edge }) => edge.curve)
      const seam = curves.flatMap((curve) => flatten(curve, OFFSET_TOLERANCE).slice(0, -1))
      const check = ringIsSimple(seam)
      if (!check.ok || !check.simple) continue
      eligible++

      const orientation: Orientation = signedArea(curves) > 0 ? 'clockwise' : 'counterclockwise'
      const result = buildCutLine(edges, orientation)
      const outcome = result.ok ? 'built' : result.failure.kind
      outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1)
      if (!result.ok) continue

      const { ring, spans } = result.line
      const check2 = ringIsSimple(ring)
      if (!check2.ok || !check2.simple) notSimple++
      const perimeter = edges.reduce((sum, { edge }) => sum + edge.length, 0)
      const allowedMiss = perimeter * 0.05

      // Undershoot: nothing that should be inside the cut line is outside it.
      if (areaOutside(seam, ring) > allowedMiss) seamMiss++
      const outward = (t: Vec2): Vec2 => (orientation === 'clockwise' ? { x: t.y, y: -t.x } : { x: -t.y, y: t.x })
      // Landings trim a band on purpose where it meets a zero edge, so bands are checked without zero edges.
      if (edges.every(({ allowance }) => allowance > 0)) {
        for (const { edge, allowance } of edges) {
          const band = [...offsetCurve(edge.curve, allowance, outward).points, ...flatten(edge.curve, OFFSET_TOLERANCE).toReversed()]
          if (areaOutside(band, ring) > allowedMiss) bandMiss++
        }
      }

      // Overshoot: the interior of each edge span sits at that edge's own allowance.
      for (const span of spans) {
        if (span.kind !== 'edge' || span.points.length < 4) continue
        const edge = edges.find(({ edge: { segmentId } }) => segmentId === span.segmentId)
        if (!edge) continue
        const trueCurve = flatten(edge.edge.curve, 0.001)
        // The first and last chords may be straight extensions to a corner, which are further from the curve.
        for (const point of span.points.slice(2, -2)) {
          worstInteriorError = Math.max(worstInteriorError, Math.abs(distanceToChain(point, trueCurve) - span.allowance))
        }
      }
    }

    expect(eligible).toBeGreaterThan(3900)
    expect(outcomes.get('built')).toBeGreaterThan(eligible * 0.95)
    expect([...outcomes.keys()].filter((kind) => kind !== 'built' && kind !== 'edge-swallowed' && kind !== 'split')).toEqual([])
    expect({ seamMiss, bandMiss, notSimple }).toEqual({ seamMiss: 0, bandMiss: 0, notSimple: 0 })
    expect(worstInteriorError).toBeLessThanOrEqual(CUT_LINE_BOUND)
  }, 120_000)
})
