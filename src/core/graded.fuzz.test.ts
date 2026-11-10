import { describe, expect, it } from 'vitest'
import { evaluate } from './evaluate'
import { raglanTee } from './fixtures/raglan'
import { evaluateGraded, viewAt } from './graded'
import type { Pattern } from './model'

function randomSource(start: number): () => number {
  let seed = start
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
}

const HOSTILE_FORMULAS = ['0', '-5', '1e300', '1/0', 'nope', '', '(', 'HPS', 'chest > 1200 ? nope : 10', 'chest > 1000 ? 1 / 0 : 5', 'chest * 1000']
const HOSTILE_IDS = ['constructor', '__proto__', 'toString', 'ghost']

function mutate(random: () => number): Pattern {
  const pick = <T>(items: readonly T[]): T | undefined => items[Math.floor(random() * items.length)]
  const pattern: Pattern = structuredClone(raglanTee)
  const edits = 1 + Math.floor(random() * 5)
  for (let edit = 0; edit < edits; edit++) {
    const formula = pick(HOSTILE_FORMULAS) ?? '0'
    const id = pick(HOSTILE_IDS) ?? 'ghost'
    const piece = pick(pattern.pieces)
    const point = pick(pattern.points)
    const variable = pick(pattern.variables)
    if (!piece || !point || !variable) continue
    switch (Math.floor(random() * 6)) {
      case 0:
        point.x = formula
        break
      case 1:
        variable.formula = formula
        break
      case 2:
        piece.stackPoint = random() < 0.5 ? id : point.id
        break
      case 3:
        piece.seamAllowance.default = formula
        break
      case 4:
        point.id = id
        break
      default:
        piece.notches = [{ id: 'n', segmentId: id, distance: formula }]
    }
  }
  return pattern
}

const sorted = (issues: readonly unknown[]): string[] => issues.map((issue) => JSON.stringify(issue)).sort()

describe('evaluateGraded on 500 hostile patterns', () => {
  it('never throws, loses nothing, and every view is usable', () => {
    const random = randomSource(4242)
    let withIssues = 0
    for (let trial = 0; trial < 500; trial++) {
      const pattern = mutate(random)
      const graded = evaluateGraded(pattern)
      if (graded.issues.length > 0) withIssues++
      for (const size of pattern.sizes) {
        const flattened = graded.issues.flatMap((issue) => issue.instances.filter((instance) => instance.size === size).map((instance) => instance.issue))
        expect(sorted(flattened)).toEqual(sorted(evaluate(pattern, size).issues))
        const view = viewAt(graded, size)
        expect(view.size).toBe(size)
        expect(view.nest.ghosts.every(({ offset }) => Number.isFinite(offset.x) && Number.isFinite(offset.y))).toBe(true)
      }
    }
    expect(withIssues).toBeGreaterThan(400)
  }, 120_000)
})
