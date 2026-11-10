import { describe, expect, it } from 'vitest'
import { applyEdit, type PatternEdit } from './edit'
import { evaluate } from './evaluate'
import { raglanFailingInXXL, raglanTee } from './fixtures/raglan'
import { evaluateGraded, viewAt, type GradedPattern } from './graded'
import type { Pattern, Piece } from './model'

const edited = (...edits: readonly PatternEdit[]): Pattern => edits.reduce<Pattern>(applyEdit, raglanTee)
const variable = (name: string, formula: string): PatternEdit => ({ kind: 'setFormula', owner: { kind: 'variable', name }, formula })
const front = raglanTee.pieces[0] as Piece

function withoutChestIn(size: string): Pattern {
  return {
    ...raglanTee,
    measurements: raglanTee.measurements.map((measurement) =>
      measurement.name === 'armhole_depth' ? { ...measurement, values: Object.fromEntries(Object.entries(measurement.values).filter(([key]) => key !== size)) } : measurement
    )
  }
}

const notchOutOfRangeInXXL = edited({ kind: 'setPiece', pieceId: 'front', patch: { notches: [{ id: 'frontRaglanNotch', segmentId: 'frontRaglan', distance: 'chest > 1200 ? 9999 : 100' }] } })
const notFiniteInM = edited(variable('chest_ease', 'chest == 1000 ? 1 / 0 : 100'))
const brokenEverywhere = edited(variable('hem_length', 'nope'))

/** The issues a graded pattern says one size has, as `evaluate` would report them. */
const flattenedFor = (graded: GradedPattern, size: string): unknown[] =>
  graded.issues.flatMap((issue) => issue.instances.filter((instance) => instance.size === size).map((instance) => instance.issue))

const sorted = (issues: readonly unknown[]): string[] => issues.map((issue) => JSON.stringify(issue)).sort()

describe('evaluateGraded', () => {
  it('has one clean result per size for the raglan', () => {
    const graded = evaluateGraded(raglanTee)
    expect(graded.bySize.map(({ size }) => size)).toEqual(raglanTee.sizes)
    expect(graded.issues).toEqual([])
    expect(graded.bySize[1]?.resolved).toEqual(evaluate(raglanTee, 'M'))
    expect(graded.pieces.map(({ id, name }) => [id, name])).toEqual([
      ['front', 'Front'],
      ['back', 'Back'],
      ['sleeve', 'Sleeve'],
      ['neckband', 'Neckband']
    ])
  })

  it('reports the failing fixture exactly, once each, with the sizes that have it', () => {
    const graded = evaluateGraded(raglanFailingInXXL)
    expect(graded.issues.map((issue) => [issue.kind, issue.sizes, issue.inEverySize])).toEqual([
      ['cut-line-failed', ['XXL'], false],
      ['degenerate-outline', ['XXL'], false]
    ])
    expect(graded.pieces.find(({ id }) => id === 'neckband')?.atSizes.map(({ kind }) => kind)).toEqual(['placed', 'placed', 'placed', 'placed', 'no-outline'])
  })

  it.each([
    ['band_width degenerate in XXL', edited(variable('band_width', 'chest > 1200 ? 0 : 60')), 1, 1, ['XXL']],
    ['a notch out of range in XXL', notchOutOfRangeInXXL, 1, 1, ['XXL']],
    ['chest_ease not finite in M', notFiniteInM, 33, 33, ['M']],
    ['armhole_depth deleted for XXL', withoutChestIn('XXL'), 25, 25, ['XXL']],
    ['hem_length broken everywhere', brokenEverywhere, 95, 19, raglanTee.sizes]
  ])('groups %s', (_label, pattern, raw, findings, sizes) => {
    const graded = evaluateGraded(pattern)
    expect(graded.bySize.reduce((sum, { resolved }) => sum + resolved.issues.length, 0)).toBe(raw)
    expect(graded.issues).toHaveLength(findings)
    expect(new Set(graded.issues.map((issue) => issue.sizes.join()))).toEqual(new Set([sizes.join()]))
  })

  it.each([
    ['failing fixture', raglanFailingInXXL],
    ['not finite in M', notFiniteInM],
    ['missing value', withoutChestIn('XXL')],
    ['broken everywhere', brokenEverywhere]
  ])('loses nothing for any size: %s', (_label, pattern) => {
    const graded = evaluateGraded(pattern)
    for (const size of pattern.sizes) expect(sorted(flattenedFor(graded, size))).toEqual(sorted(evaluate(pattern, size).issues))
  })

  it('treats a problem as the same one when only its dependency changes per size', () => {
    // Which dependency failed first depends on the size, so `dependency` can't be part of the identity.
    const pattern = edited(variable('body_width', 'chest > 1000 ? nope : neck_width'), variable('neck_width', 'chest > 1000 ? 1 / 0 : 1 / 0'))
    const { issues } = evaluateGraded(pattern)
    const dependents = issues.filter((issue) => issue.kind === 'dependency-failed' && issue.item.kind === 'pointCoord' && issue.item.id === 'underarm' && issue.item.axis === 'x')
    expect(dependents).toHaveLength(1)
  })

  it('keeps two identical reports apart by their order', () => {
    const pattern: Pattern = { ...raglanTee, measurements: [...raglanTee.measurements, { name: 'chest', values: {} }, { name: 'chest', values: {} }] }
    const issues = evaluateGraded(pattern).issues.filter((issue) => issue.kind === 'duplicate-name')
    expect(issues).toHaveLength(2)
    expect(new Set(issues.map((issue) => issue.key)).size).toBe(2)
    expect(issues.every((issue) => issue.inEverySize)).toBe(true)
  })

  it('keeps a stack point failure apart from a grainline failure on the same piece', () => {
    const base: Pattern = {
      ...raglanTee,
      points: [...raglanTee.points, { id: 'stackAlways', name: 'StackAlways', x: 'nope', y: '0' }, { id: 'grainXxl', name: 'GrainXxl', x: 'chest > 1200 ? 1 / 0 : 5', y: '0' }]
    }
    const pattern = applyEdit(base, { kind: 'setPiece', pieceId: 'front', patch: { stackPoint: 'stackAlways', grainline: ['grainXxl', 'cfHem'] } })
    const about = evaluateGraded(pattern).issues.filter((issue) => issue.kind === 'dependency-failed' && issue.item.kind === 'piece')
    expect(about.map((issue) => [issue.kind === 'dependency-failed' && issue.dependency, issue.sizes.join()])).toEqual([
      ['StackAlways', 'S,M,L,XL,XXL'],
      ['GrainXxl', 'XXL']
    ])
  })

  it('has keys that do not change between evaluations', () => {
    expect(evaluateGraded(raglanFailingInXXL).issues.map((issue) => issue.key)).toEqual(evaluateGraded(raglanFailingInXXL).issues.map((issue) => issue.key))
  })

  it('lists a duplicated piece id once', () => {
    const pattern: Pattern = { ...raglanTee, pieces: [...raglanTee.pieces, { ...front, name: 'Twin' }] }
    expect(evaluateGraded(pattern).pieces.filter(({ id }) => id === 'front')).toMatchObject([{ name: 'Front' }])
  })
})

describe('viewAt', () => {
  const failing = evaluateGraded(raglanFailingInXXL)

  it('shows the size it is asked for, with every size and its issue count', () => {
    const view = viewAt(failing, 'M')
    expect(view.size).toBe('M')
    expect(view.resolved.pieces['neckband']).toBeDefined()
    expect(view.sizes).toEqual([
      { name: 'S', issueCount: 0 },
      { name: 'M', issueCount: 0 },
      { name: 'L', issueCount: 0 },
      { name: 'XL', issueCount: 0 },
      { name: 'XXL', issueCount: 2 }
    ])
  })

  it('falls back to the first size for a size that no longer exists', () => {
    expect(viewAt(failing, 'gone').size).toBe('S')
  })

  it('marks problems from another size as not here, opening at the size that has them', () => {
    expect(viewAt(failing, 'M').issues.map((issue) => [issue.kind, issue.sizes, issue.here, issue.openAt, issue.scope])).toEqual([
      ['cut-line-failed', ['XXL'], false, 'XXL', 'XXL'],
      ['degenerate-outline', ['XXL'], false, 'XXL', 'XXL']
    ])
    expect(viewAt(failing, 'XXL').issues.map((issue) => [issue.here, issue.openAt])).toEqual([
      [true, 'XXL'],
      [true, 'XXL']
    ])
  })

  it('reads an issue in every size exactly as evaluate does, with no scope', () => {
    const view = viewAt(evaluateGraded(brokenEverywhere), 'L')
    const [first] = view.issues
    expect(first?.scope).toBeNull()
    expect(first?.text).toBe(first?.message)
    expect(first?.openAt).toBe('L')
  })

  it("puts the shown size's own problems first", () => {
    const pattern = edited(variable('chest_ease', 'chest == 920 ? 1 / 0 : 100'), { kind: 'setPiece', pieceId: 'front', patch: { notches: [{ id: 'frontRaglanNotch', segmentId: 'frontRaglan', distance: 'chest > 1200 ? 9999 : 100' }] } })
    const view = viewAt(evaluateGraded(pattern), 'XXL')
    expect(view.issues[0]).toMatchObject({ kind: 'notch-out-of-range', here: true })
    expect(view.issues.slice(1).every((issue) => !issue.here)).toBe(true)
  })

  describe('wording when values differ per size', () => {
    const pattern = edited({ kind: 'setPiece', pieceId: 'front', patch: { notches: [{ id: 'frontRaglanNotch', segmentId: 'frontRaglan', distance: 'chest > 1100 ? 9000 + chest : 100' }] } })
    const graded = evaluateGraded(pattern)
    const notch = (size: string) => viewAt(graded, size).issues.find((issue) => issue.kind === 'notch-out-of-range')

    it("reads as the shown size's own report", () => {
      expect(notch('XL')).toMatchObject({ distance: 10160, here: true, openAt: 'XL', scope: 'XL, XXL' })
      expect(notch('XXL')).toMatchObject({ distance: 10260, here: true, openAt: 'XXL' })
    })

    it('reads as the first affected size when the shown size has no such problem', () => {
      expect(notch('M')).toMatchObject({ distance: 10160, here: false, openAt: 'XL' })
    })

    it('names only the sizes its message is true for', () => {
      const issue = notch('XXL')
      expect(issue?.text).toBe(`XXL: ${issue?.message} (also in XL)`)
    })
  })

  it('leads with the size a problem is in', () => {
    const issue = viewAt(failing, 'M').issues[0]
    expect(issue?.text).toBe(`XXL: ${issue?.message}`)
  })
})

describe('the nest', () => {
  const stacked: Pattern = {
    ...raglanTee,
    pieces: raglanTee.pieces.map((piece) => (piece.id === 'sleeve' ? { ...piece, stackPoint: 'sleeveNeckC' } : piece.id === 'neckband' ? { ...piece, stackPoint: 'bandA' } : piece))
  }

  it('holds every other size of every piece, and not the shown one', () => {
    const { ghosts, gaps } = viewAt(evaluateGraded(raglanTee), 'M').nest
    expect(ghosts).toHaveLength(16)
    expect(ghosts.some((ghost) => ghost.size === 'M')).toBe(false)
    expect(ghosts[0]).toMatchObject({ size: 'S', sizeIndex: 0, offset: { x: 0, y: 0 } })
    expect(gaps).toEqual([])
  })

  it.each([
    ['sleeve', 'S', { x: 40, y: 0 }],
    ['sleeve', 'XXL', { x: -130, y: 0 }],
    ['neckband', 'S', { x: 0, y: 20 }],
    ['neckband', 'XXL', { x: 0, y: -60 }]
  ])('stacks %s in size %s on the shown size', (id, size, offset) => {
    const ghost = viewAt(evaluateGraded(raglanTee), 'M').nest.ghosts.find((candidate) => candidate.piece.id === id && candidate.size === size)
    expect(ghost?.offset).toEqual(offset)
  })

  it.each(['S', 'M', 'XXL'])('nests every size inside the next against reference %s', (reference) => {
    const { ghosts } = viewAt(evaluateGraded(stacked), reference).nest
    const shown = evaluateGraded(stacked).bySize.find(({ size }) => size === reference)
    for (const id of ['front', 'back', 'sleeve', 'neckband']) {
      const boxes = raglanTee.sizes.map((size) => {
        const ghost = ghosts.find((candidate) => candidate.size === size && candidate.piece.id === id)
        const piece = ghost?.piece ?? shown?.resolved.pieces[id]
        const offset = ghost?.offset ?? { x: 0, y: 0 }
        const points = piece?.outline.flatMap((edge) => [edge.curve.from, edge.curve.to]).map((point) => ({ x: point.x + offset.x, y: point.y + offset.y })) ?? []
        return { minX: Math.min(...points.map((p) => p.x)), maxX: Math.max(...points.map((p) => p.x)), minY: Math.min(...points.map((p) => p.y)), maxY: Math.max(...points.map((p) => p.y)) }
      })
      boxes.forEach((box, i) => {
        const previous = boxes[i - 1]
        if (!previous) return
        expect(box.minX).toBeLessThanOrEqual(previous.minX + 1e-9)
        expect(box.minY).toBeLessThanOrEqual(previous.minY + 1e-9)
        expect(box.maxX).toBeGreaterThanOrEqual(previous.maxX - 1e-9)
        expect(box.maxY).toBeGreaterThanOrEqual(previous.maxY - 1e-9)
      })
    }
  })

  it('draws what exists and says what does not, for the failing fixture', () => {
    const { ghosts, gaps } = viewAt(evaluateGraded(raglanFailingInXXL), 'M').nest
    expect(ghosts).toHaveLength(15)
    expect(ghosts.filter((ghost) => ghost.piece.cutLine)).toHaveLength(14)
    expect(gaps).toEqual([
      { size: 'XXL', pieceId: 'front', pieceName: 'Front', reason: 'no-cut-line' },
      { size: 'XXL', pieceId: 'neckband', pieceName: 'Neckband', reason: 'no-outline' }
    ])
  })

  it('uses the first size that placed a piece when the shown size lost it', () => {
    const { ghosts } = viewAt(evaluateGraded(raglanFailingInXXL), 'XXL').nest
    const neckbands = ghosts.filter((ghost) => ghost.piece.id === 'neckband')
    expect(neckbands.map((ghost) => [ghost.size, ghost.offset])).toEqual([
      ['S', { x: 0, y: 0 }],
      ['M', { x: 0, y: -20 }],
      ['L', { x: 0, y: -40 }],
      ['XL', { x: 0, y: -60 }]
    ])
  })

  it('draws no ghosts around a shown piece that has nothing to stack on', () => {
    const base: Pattern = {
      ...raglanTee,
      variables: [...raglanTee.variables, { name: 'stack_x', formula: 'chest == 1000 ? 1 / 0 : 5' }],
      points: [...raglanTee.points, { id: 'stackHere', name: 'StackHere', x: 'stack_x', y: '0' }],
      pieces: raglanTee.pieces.map((piece) => (piece.id === 'front' ? { ...piece, stackPoint: 'stackHere' } : piece))
    }
    const { ghosts, gaps } = viewAt(evaluateGraded(base), 'M').nest
    expect(ghosts.filter((ghost) => ghost.piece.id === 'front')).toEqual([])
    expect(ghosts.filter((ghost) => ghost.piece.id === 'back')).toHaveLength(4)
    expect(gaps).toEqual([{ size: 'M', pieceId: 'front', pieceName: 'Front', reason: 'no-stack-point' }])
  })

  it('reports a stack point that fails in one size as a gap without moving the rest', () => {
    const base: Pattern = {
      ...raglanTee,
      variables: [...raglanTee.variables, { name: 'stack_x', formula: 'chest > 1200 ? 1 / 0 : 5' }],
      points: [...raglanTee.points, { id: 'stackHere', name: 'StackHere', x: 'stack_x', y: '0' }],
      pieces: raglanTee.pieces.map((piece) => (piece.id === 'front' ? { ...piece, stackPoint: 'stackHere' } : piece))
    }
    const view = viewAt(evaluateGraded(base), 'M')
    expect(view.nest.gaps).toEqual([{ size: 'XXL', pieceId: 'front', pieceName: 'Front', reason: 'no-stack-point' }])
    expect(view.nest.ghosts.filter((ghost) => ghost.piece.id === 'front').map((ghost) => ghost.size)).toEqual(['S', 'L', 'XL'])
  })
})
