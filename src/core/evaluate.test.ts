import { describe, expect, it } from 'vitest'
import { evaluate, type EvaluationIssue } from './evaluate'
import { raglanTee } from './fixtures/raglan'
import { CURRENT_SCHEMA_VERSION, type Pattern } from './model'

function pattern(overrides: Partial<Pattern> = {}): Pattern {
  return {
    version: CURRENT_SCHEMA_VERSION,
    units: 'cm',
    sizes: ['S', 'M'],
    activeSize: 'S',
    measurements: [{ name: 'chest', values: { S: 900, M: 1000 } }],
    variables: [],
    points: [],
    segments: [],
    pieces: [],
    ...overrides
  }
}

const kinds = (issues: EvaluationIssue[]) => issues.map((issue) => issue.kind)

describe('evaluate', () => {
  it('evaluates variables that reference measurements and other variables', () => {
    const result = evaluate(
      pattern({
        variables: [
          { name: 'body_width', formula: 'chest / 4 + ease' },
          { name: 'ease', formula: '10' }
        ]
      }),
      'M'
    )
    expect(result.issues).toEqual([])
    expect(result.measurements).toEqual({ chest: 1000 })
    expect(result.variables).toEqual({ body_width: 260, ease: 10 })
  })

  it('evaluates points that reference other points, in any declaration order', () => {
    const result = evaluate(
      pattern({
        points: [
          { id: 'b', name: 'B', x: 'A.x + 10', y: 'A.y * 2' },
          { id: 'a', name: 'A', x: 'chest / 10', y: '5' }
        ]
      }),
      'S'
    )
    expect(result.issues).toEqual([])
    expect(result.points).toEqual({
      a: { id: 'a', name: 'A', x: 90, y: 5 },
      b: { id: 'b', name: 'B', x: 100, y: 10 }
    })
  })

  it('tracks x and y separately, so cross-axis references are not cycles', () => {
    const result = evaluate(
      pattern({
        points: [
          { id: 'a', name: 'A', x: '1', y: 'B.y' },
          { id: 'b', name: 'B', x: 'A.x', y: '2' }
        ]
      }),
      'S'
    )
    expect(result.issues).toEqual([])
    expect(result.points['a']).toMatchObject({ x: 1, y: 2 })
  })

  it('reports cycles on every member with a readable path', () => {
    const result = evaluate(
      pattern({
        variables: [
          { name: 'a', formula: 'b + 1' },
          { name: 'b', formula: 'a + 1' },
          { name: 'c', formula: 'chest' }
        ]
      }),
      'S'
    )
    const cycles = result.issues.filter((issue) => issue.kind === 'cycle')
    expect(cycles.map((issue) => issue.item)).toEqual([
      { kind: 'variable', name: 'a' },
      { kind: 'variable', name: 'b' }
    ])
    expect(cycles[0]?.message).toBe('Circular reference: a → b → a')
    expect(result.variables).toEqual({ c: 900 })
  })

  it('reports a self-referencing point coordinate', () => {
    const result = evaluate(pattern({ points: [{ id: 'p', name: 'P', x: 'P.x + 1', y: '0' }] }), 'S')
    expect(result.issues).toMatchObject([
      { kind: 'cycle', item: { kind: 'pointCoord', id: 'p', axis: 'x' }, cycle: ['P.x', 'P.x'] }
    ])
    expect(result.points).toEqual({})
  })

  it('marks values downstream of a failure as dependency-failed', () => {
    const result = evaluate(
      pattern({
        variables: [
          { name: 'a', formula: 'nope * 2' },
          { name: 'b', formula: 'a + 1' }
        ]
      }),
      'S'
    )
    expect(result.issues).toMatchObject([
      { kind: 'undefined-reference', item: { kind: 'variable', name: 'a' }, reference: 'nope' },
      { kind: 'dependency-failed', item: { kind: 'variable', name: 'b' }, dependency: 'a' }
    ])
    expect(result.variables).toEqual({})
  })

  it('reports undefined point references', () => {
    const result = evaluate(pattern({ points: [{ id: 'p', name: 'P', x: 'Q.x', y: '0' }] }), 'S')
    expect(result.issues).toMatchObject([{ kind: 'undefined-reference', reference: 'Q.x' }])
  })

  it('rejects using a point as a number and a variable as a point', () => {
    const result = evaluate(
      pattern({
        variables: [{ name: 'v', formula: 'P + 1' }],
        points: [{ id: 'p', name: 'P', x: 'chest.x', y: '0' }]
      }),
      'S'
    )
    expect(kinds(result.issues)).toEqual(['invalid-reference', 'invalid-reference'])
    expect(result.issues[0]?.message).toContain('use P.x or P.y')
  })

  it('reports parse errors against the offending item', () => {
    const result = evaluate(pattern({ points: [{ id: 'p', name: 'P', x: '1 +', y: '2' }] }), 'S')
    expect(result.issues).toMatchObject([{ kind: 'parse-error', item: { kind: 'pointCoord', id: 'p', axis: 'x' } }])
    expect(result.issues[0]?.message).toMatch(/^P\.x: /)
  })

  it('reports non-finite results', () => {
    const result = evaluate(pattern({ variables: [{ name: 'v', formula: 'chest / 0' }] }), 'S')
    expect(result.issues).toMatchObject([{ kind: 'not-finite', item: { kind: 'variable', name: 'v' } }])
  })

  it('reports measurements missing a value for the size', () => {
    const result = evaluate(
      pattern({
        measurements: [{ name: 'chest', values: { S: 900 } }],
        variables: [{ name: 'half', formula: 'chest / 2' }]
      }),
      'M'
    )
    expect(kinds(result.issues)).toEqual(['missing-measurement-value', 'dependency-failed'])
  })

  it('reports an unknown size', () => {
    expect(kinds(evaluate(pattern(), 'XS').issues)).toContain('unknown-size')
  })

  it('reports duplicate and invalid names, keeping the first definition', () => {
    const result = evaluate(
      pattern({
        variables: [
          { name: 'chest', formula: '1' },
          { name: 'pi', formula: '3' },
          { name: '2fast', formula: '3' }
        ],
        points: [
          { id: 'a', name: 'A', x: '0', y: '0' },
          { id: 'a', name: 'A2', x: '0', y: '0' }
        ]
      }),
      'S'
    )
    expect(kinds(result.issues)).toEqual(['duplicate-name', 'invalid-name', 'invalid-name', 'duplicate-id'])
    expect(result.measurements).toEqual({ chest: 900 })
    expect(Object.keys(result.points)).toEqual(['a'])
  })

  it('reports segments that refer to missing points', () => {
    const result = evaluate(
      pattern({
        points: [{ id: 'a', name: 'A', x: '0', y: '0' }],
        segments: [{ id: 's', kind: 'line', from: 'a', to: 'ghost' }]
      }),
      'S'
    )
    expect(result.issues).toMatchObject([{ kind: 'missing-point', item: { kind: 'segment', id: 's' }, pointId: 'ghost' }])
    expect(result.segments).toEqual({})
  })

  it('does not mutate its input', () => {
    const input = structuredClone(raglanTee)
    evaluate(input, 'L')
    expect(input).toEqual(raglanTee)
  })
})

describe('raglan fixture', () => {
  it.each(raglanTee.sizes)('evaluates cleanly in size %s', (size) => {
    const result = evaluate(raglanTee, size)
    expect(result.issues).toEqual([])
    expect(Object.keys(result.points)).toHaveLength(raglanTee.points.length)
  })

  it('computes the expected body width for M', () => {
    const result = evaluate(raglanTee, 'M')
    expect(result.variables['body_width']).toBe(275)
    expect(result.points['underarm']).toMatchObject({ x: 275, y: 250 })
  })

  it('grades: every size is wider and longer than the one before', () => {
    const resolved = raglanTee.sizes.map((size) => evaluate(raglanTee, size).points)
    for (let i = 1; i < resolved.length; i++) {
      expect(resolved[i]?.['sideHem']?.x).toBeGreaterThan(resolved[i - 1]?.['sideHem']?.x ?? Infinity)
      expect(resolved[i]?.['sideHem']?.y).toBeGreaterThan(resolved[i - 1]?.['sideHem']?.y ?? Infinity)
    }
  })
})
