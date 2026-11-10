import { describe, expect, it } from 'vitest'
import { evaluate } from './evaluate'
import { raglanTee } from './fixtures/raglan'
import { flatten } from './geometry'
import type { Pattern, Piece } from './model'
import { areaOutside, ringIsSimple } from './ringUnion'

/** Deterministic, so a failure here reproduces exactly. */
function randomSource(start: number): () => number {
  let seed = start
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
}

const HOSTILE_FORMULAS = ['0', '-5', '1e300', '1e9', '1e12', '1e-12', '1/0', 'nope', '', '(', 'HPS', 'HPS.x', 'HPS.y * 1e200', '100000', '99999', '5', '25', '500', 'chest', 'chest * 1000']
const HOSTILE_IDS = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'ghost', 'a/b', '["x"]']

/** The raglan with a few of its formulas, ids and references replaced by something hostile. */
function mutate(random: () => number): Pattern {
  const pick = <T>(items: readonly T[], fallback: T): T => items[Math.floor(random() * items.length)] ?? fallback
  const formula = (): string => pick(HOSTILE_FORMULAS, '0')
  const hostileId = (): string => pick(HOSTILE_IDS, 'ghost')
  const segmentId = (): string => (random() < 0.5 ? pick(raglanTee.segments, undefined)?.id ?? 'ghost' : hostileId())
  const pointId = (): string => (random() < 0.5 ? pick(raglanTee.points, undefined)?.id ?? 'ghost' : hostileId())

  const pattern: Pattern = structuredClone(raglanTee)
  const edits = 1 + Math.floor(random() * 5)
  for (let edit = 0; edit < edits; edit++) {
    const piece: Piece | undefined = pick(pattern.pieces, undefined)
    const point = pick(pattern.points, undefined)
    const variable = pick(pattern.variables, undefined)
    const segment = pick(pattern.segments, undefined)
    if (!piece || !point || !variable || !segment) continue
    switch (Math.floor(random() * 11)) {
      case 0:
        piece.seamAllowance.default = formula()
        break
      case 1:
        piece.seamAllowance.perEdge = { ...piece.seamAllowance.perEdge, [segmentId()]: formula() }
        break
      case 2:
        piece.fold = segmentId()
        break
      case 3:
        delete piece.fold
        break
      case 4:
        piece.grainline = [pointId(), pointId()]
        break
      case 5:
        point.x = formula()
        break
      case 6:
        point.y = formula()
        break
      case 7:
        variable.formula = formula()
        break
      case 8:
        piece.notches = [{ id: random() < 0.5 ? 'n' : hostileId(), segmentId: segmentId(), distance: formula() }]
        break
      case 9:
        point.id = hostileId()
        break
      default:
        segment.id = hostileId()
    }
  }
  return pattern
}

describe('evaluate on 2,000 hostile patterns', () => {
  it('never throws, and every cut line it returns is usable', () => {
    const random = randomSource(777)
    let cutLines = 0
    let cutLineFailures = 0
    const problems: string[] = []

    for (let trial = 0; trial < 2000; trial++) {
      const size = raglanTee.sizes[Math.floor(random() * raglanTee.sizes.length)] ?? 'M'
      const resolved = evaluate(mutate(random), size)
      cutLineFailures += resolved.issues.filter((issue) => issue.kind === 'cut-line-failed').length

      for (const piece of Object.values(resolved.pieces)) {
        const grainline = piece.grainline
        if (grainline && ![grainline.from.x, grainline.from.y, grainline.to.x, grainline.to.y, grainline.angle].every(Number.isFinite)) {
          problems.push(`trial ${trial}: ${piece.id} has a non-finite grainline`)
        }
        const line = piece.cutLine
        if (!line) continue
        cutLines++
        if (!line.ring.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))) problems.push(`trial ${trial}: ${piece.id} has a non-finite ring`)
        const simple = ringIsSimple(line.ring)
        if (!simple.ok || !simple.simple) problems.push(`trial ${trial}: ${piece.id} ring is not simple`)
        const seam = piece.outline.flatMap((edge) => flatten(edge.curve, 0.02).slice(0, -1))
        if (areaOutside(seam, line.ring) > piece.outline.reduce((sum, edge) => sum + edge.length, 0) * 0.05) problems.push(`trial ${trial}: ${piece.id} seam is outside the ring`)
        if (line.notches.length !== piece.notches.length) problems.push(`trial ${trial}: ${piece.id} lost a notch`)
      }
    }

    expect(problems).toEqual([])
    // The run has to reach both outcomes, or it isn't testing what it says.
    expect(cutLines).toBeGreaterThan(1000)
    expect(cutLineFailures).toBeGreaterThan(100)
  }, 120_000)
})
