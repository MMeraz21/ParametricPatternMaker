import { describe, expect, it } from 'vitest'
import { evaluate, type EvaluationIssue } from './evaluate'
import { raglanTee } from './fixtures/raglan'
import { curveLength, distance, vec } from './geometry'
import { CURRENT_SCHEMA_VERSION, type Pattern, type Piece } from './model'
import { flattenOutline } from './outline'

const kinds = (issues: EvaluationIssue[]) => issues.map((issue) => issue.kind)

/** A 100 x 50 rectangle a-b-c-d (clockwise on screen) with one line segment per side. */
function rectangle(piece: Partial<Piece> = {}, overrides: Partial<Pattern> = {}): Pattern {
  return {
    version: CURRENT_SCHEMA_VERSION,
    units: 'cm',
    sizes: ['S'],
    activeSize: 'S',
    measurements: [],
    variables: [{ name: 'notch_at', formula: '30' }],
    points: [
      { id: 'a', name: 'A', x: '0', y: '0' },
      { id: 'b', name: 'B', x: '100', y: '0' },
      { id: 'c', name: 'C', x: '100', y: '50' },
      { id: 'd', name: 'D', x: '0', y: '50' }
    ],
    segments: [
      { id: 'top', kind: 'line', from: 'a', to: 'b' },
      { id: 'right', kind: 'line', from: 'b', to: 'c' },
      { id: 'bottom', kind: 'line', from: 'c', to: 'd' },
      { id: 'left', kind: 'line', from: 'd', to: 'a' }
    ],
    pieces: [
      {
        id: 'p',
        name: 'Panel',
        outline: [{ segmentId: 'top' }, { segmentId: 'right' }, { segmentId: 'bottom' }, { segmentId: 'left' }],
        seamAllowance: { default: '10' },
        notches: [],
        grainline: ['a', 'd'],
        cutCount: 1,
        ...piece
      }
    ],
    ...overrides
  }
}

describe('segments', () => {
  it('resolves every segment with its curve and length', () => {
    const result = evaluate(rectangle(), 'S')
    expect(result.issues).toEqual([])
    expect(result.segments['top']).toEqual({
      id: 'top',
      curve: { kind: 'line', from: { id: 'a', name: 'A', x: 0, y: 0 }, to: { id: 'b', name: 'B', x: 100, y: 0 } },
      length: 100
    })
    expect(Object.keys(result.segments)).toEqual(['top', 'right', 'bottom', 'left'])
  })

  it('omits a segment whose point failed, naming the point', () => {
    const pattern = rectangle()
    pattern.points[1] = { id: 'b', name: 'B', x: 'nope', y: '0' }
    const result = evaluate(pattern, 'S')
    expect(result.segments['top']).toBeUndefined()
    expect(result.issues).toContainEqual(
      expect.objectContaining({ kind: 'dependency-failed', item: { kind: 'segment', id: 'top' }, dependency: 'B' })
    )
    // The piece can't close without it.
    expect(result.pieces).toEqual({})
    expect(result.issues).toContainEqual(
      expect.objectContaining({ kind: 'dependency-failed', item: { kind: 'piece', id: 'p', name: 'Panel' }, dependency: 'top' })
    )
  })

  it('reports duplicate segment ids, keeping the first', () => {
    const pattern = rectangle({}, {})
    pattern.segments.push({ id: 'top', kind: 'line', from: 'c', to: 'a' })
    const result = evaluate(pattern, 'S')
    expect(kinds(result.issues)).toEqual(['duplicate-id'])
    expect(result.segments['top']?.length).toBe(100)
  })
})

describe('piece outlines', () => {
  it('resolves a closed outline with orientation and area', () => {
    const piece = evaluate(rectangle(), 'S').pieces['p']
    expect(piece).toMatchObject({ id: 'p', name: 'Panel', orientation: 'clockwise', area: 5000, notches: [] })
    expect(piece?.outline.map((edge) => [edge.segmentId, edge.length])).toEqual([
      ['top', 100],
      ['right', 50],
      ['bottom', 100],
      ['left', 50]
    ])
  })

  it('joins consecutive edges on the same point object', () => {
    const outline = evaluate(rectangle(), 'S').pieces['p']?.outline ?? []
    outline.forEach((edge, i) => expect(edge.curve.to).toBe(outline[(i + 1) % outline.length]?.curve.from))
  })

  it('orients reversed segments in outline direction', () => {
    const pattern = rectangle({
      outline: [{ segmentId: 'top' }, { segmentId: 'right' }, { segmentId: 'bottom' }, { segmentId: 'left' }].reverse().map((ref) => ({ ...ref, reversed: true }))
    })
    const piece = evaluate(pattern, 'S').pieces['p']
    expect(piece?.orientation).toBe('counterclockwise')
    expect(piece?.outline[0]).toMatchObject({ segmentId: 'left', reversed: true, curve: { from: { id: 'a' }, to: { id: 'd' } } })
  })

  it('reports a gap with both point ids and omits the piece', () => {
    const result = evaluate(rectangle({ outline: [{ segmentId: 'top' }, { segmentId: 'bottom' }] }), 'S')
    expect(result.pieces).toEqual({})
    expect(result.issues).toMatchObject([
      { kind: 'outline-gap', after: 'top', before: 'bottom', endPointId: 'b', startPointId: 'c' },
      { kind: 'outline-gap', after: 'bottom', before: 'top', endPointId: 'd', startPointId: 'a' }
    ])
    // Its segments still render on their own.
    expect(Object.keys(result.segments)).toHaveLength(4)
  })

  it('reports empty outlines, missing and repeated segments', () => {
    expect(kinds(evaluate(rectangle({ outline: [] }), 'S').issues)).toEqual(['outline-empty'])
    expect(evaluate(rectangle({ outline: [{ segmentId: 'ghost' }] }), 'S').issues).toMatchObject([
      { kind: 'missing-segment', item: { kind: 'piece', id: 'p' }, segmentId: 'ghost' }
    ])
    expect(kinds(evaluate(rectangle({ outline: [{ segmentId: 'top' }, { segmentId: 'top' }] }), 'S').issues)).toEqual([
      'duplicate-outline-segment'
    ])
  })

  it('reports an outline that encloses no area', () => {
    const pattern = rectangle({ outline: [{ segmentId: 'top' }, { segmentId: 'back' }] })
    pattern.segments.push({ id: 'back', kind: 'line', from: 'b', to: 'a' })
    expect(kinds(evaluate(pattern, 'S').issues)).toEqual(['degenerate-outline'])
  })

  it('treats a nearly flat outline as enclosing no area', () => {
    // Rounding-level bulge: a real area of 1e-5 mm², far below anything you could cut.
    const pattern = rectangle({ outline: [{ segmentId: 'ab' }, { segmentId: 'bc' }, { segmentId: 'ca' }] })
    pattern.points = [
      { id: 'a', name: 'A', x: '0', y: '0' },
      { id: 'b', name: 'B', x: '100', y: '0.0000001' },
      { id: 'c', name: 'C', x: '200', y: '0' }
    ]
    pattern.segments = [
      { id: 'ab', kind: 'line', from: 'a', to: 'b' },
      { id: 'bc', kind: 'line', from: 'b', to: 'c' },
      { id: 'ca', kind: 'line', from: 'c', to: 'a' }
    ]
    const result = evaluate(pattern, 'S')
    expect(kinds(result.issues)).toEqual(['degenerate-outline'])
    expect(result.pieces).toEqual({})
  })

  it('reports duplicate piece ids', () => {
    const pattern = rectangle()
    const [first] = pattern.pieces
    if (first) pattern.pieces.push({ ...first, name: 'Copy' })
    const result = evaluate(pattern, 'S')
    expect(result.issues).toMatchObject([{ kind: 'duplicate-id', item: { kind: 'piece', name: 'Copy' } }])
    expect(result.pieces['p']?.name).toBe('Panel')
  })
})

describe('notches', () => {
  it('places a notch by formula with tangent and outward normal', () => {
    const result = evaluate(rectangle({ notches: [{ id: 'n', segmentId: 'top', distance: 'notch_at * 2' }] }), 'S')
    expect(result.issues).toEqual([])
    expect(result.pieces['p']?.notches).toEqual([
      { id: 'n', segmentId: 'top', distance: 60, point: vec(60, 0), tangent: vec(1, 0), outward: vec(0, -1) }
    ])
  })

  it('measures from the segment start but points the tangent along a reversed outline', () => {
    const pattern = rectangle({
      outline: [{ segmentId: 'left', reversed: true }, { segmentId: 'bottom', reversed: true }, { segmentId: 'right', reversed: true }, { segmentId: 'top', reversed: true }],
      notches: [{ id: 'n', segmentId: 'top', distance: '10' }]
    })
    const notch = evaluate(pattern, 'S').pieces['p']?.notches[0]
    // 10 mm from top's own start (A), so near A; outward still points up, out of the piece.
    expect(notch).toMatchObject({ point: vec(10, 0), tangent: { x: -1 }, outward: { x: 0, y: -1 } })
  })

  it('reports notches past the end of their segment', () => {
    const result = evaluate(rectangle({ notches: [{ id: 'n', segmentId: 'right', distance: '60' }] }), 'S')
    expect(result.issues).toMatchObject([
      { kind: 'notch-out-of-range', item: { kind: 'notch', pieceId: 'p', id: 'n' }, distance: 60, length: 50 }
    ])
    expect(result.pieces['p']?.notches).toEqual([])
  })

  it('reports notches on a segment outside the outline', () => {
    const pattern = rectangle({ notches: [{ id: 'n', segmentId: 'diagonal', distance: '1' }] })
    pattern.segments.push({ id: 'diagonal', kind: 'line', from: 'a', to: 'c' })
    expect(kinds(evaluate(pattern, 'S').issues)).toEqual(['notch-off-outline'])
  })

  it('reports broken distance formulas against the notch', () => {
    const result = evaluate(rectangle({ notches: [{ id: 'n', segmentId: 'top', distance: 'nope' }] }), 'S')
    expect(result.issues).toMatchObject([{ kind: 'undefined-reference', item: { kind: 'notch', pieceId: 'p', id: 'n' } }])
    expect(result.pieces['p']?.notches).toEqual([])
  })
})

describe('seam allowance formulas', () => {
  const issuesFor = (seamAllowance: Piece['seamAllowance']) => evaluate(rectangle({ seamAllowance }), 'S').issues

  it('accepts variables, units and zero', () => {
    expect(issuesFor({ default: 'notch_at', perEdge: { top: '5/8 * inch', left: '0' } })).toEqual([])
  })

  it('reports a negative default against the piece', () => {
    expect(issuesFor({ default: '-5' })).toEqual([
      {
        kind: 'negative-seam-allowance',
        item: { kind: 'seamAllowance', pieceId: 'p', segmentId: null },
        value: -5,
        message: "Seam allowance of 'Panel' is -5 mm; it can't be negative"
      }
    ])
  })

  it('reports a negative override against its edge', () => {
    expect(issuesFor({ default: '10', perEdge: { top: 'notch_at - 31' } })).toMatchObject([
      { kind: 'negative-seam-allowance', item: { kind: 'seamAllowance', pieceId: 'p', segmentId: 'top' }, value: -1 }
    ])
  })

  it('reports a broken formula against the edge that owns it', () => {
    expect(issuesFor({ default: '10', perEdge: { top: 'nope' } })).toMatchObject([
      { kind: 'undefined-reference', item: { kind: 'seamAllowance', pieceId: 'p', segmentId: 'top' }, reference: 'nope' }
    ])
  })

  it('keeps a piece usable when its allowance is broken', () => {
    const result = evaluate(rectangle({ seamAllowance: { default: 'nope' } }), 'S')
    expect(result.pieces['p']?.area).toBe(5000)
  })

  it('keeps allowances separate when ids contain the key separators', () => {
    const base = rectangle()
    const [piece] = base.pieces
    if (!piece) throw new Error('rectangle has a piece')
    const pattern: Pattern = {
      ...base,
      pieces: [
        { ...piece, id: 'a', seamAllowance: { default: '10', perEdge: { 'x/default': 'broken_one' } } },
        { ...piece, id: 'a/edge:x', seamAllowance: { default: 'broken_two' } }
      ]
    }
    const missing = evaluate(pattern, 'S').issues.flatMap((issue) => (issue.kind === 'undefined-reference' ? [issue.reference] : []))
    expect(missing).toEqual(['broken_one', 'broken_two'])
  })

  it('keeps notch distances separate when ids contain the key separators', () => {
    const base = rectangle()
    const [piece] = base.pieces
    if (!piece) throw new Error('rectangle has a piece')
    const notch = (id: string, distance: string) => ({ id, segmentId: 'top', distance })
    const pattern: Pattern = {
      ...base,
      pieces: [
        { ...piece, id: 'p', notches: [notch('a/b', '10')] },
        { ...piece, id: 'p/a', notches: [notch('b', '20')] }
      ]
    }
    const result = evaluate(pattern, 'S')
    expect(result.pieces['p']?.notches[0]?.distance).toBe(10)
    expect(result.pieces['p/a']?.notches[0]?.distance).toBe(20)
  })

  describe('which formulas block the cut line', () => {
    const cutLineFor = (seamAllowance: Piece['seamAllowance'], piece: Partial<Piece> = {}) =>
      evaluate(rectangle({ seamAllowance, ...piece }), 'S').pieces['p']?.cutLine

    it('builds no cut line when an edge override is broken, rather than using the default width', () => {
      expect(cutLineFor({ default: '10', perEdge: { top: 'nope' } })).toBeUndefined()
    })

    it('builds no cut line when an edge override is negative', () => {
      expect(cutLineFor({ default: '10', perEdge: { top: '-1' } })).toBeUndefined()
    })

    it('builds no cut line when a default that an edge uses is broken', () => {
      expect(cutLineFor({ default: 'nope', perEdge: { top: '5' } })).toBeUndefined()
    })

    it('still builds a cut line when a broken override names an edge outside the outline', () => {
      expect(cutLineFor({ default: '10', perEdge: { gone: 'nope' } })).toBeDefined()
    })

    it('still builds a cut line when every edge overrides a broken default', () => {
      expect(cutLineFor({ default: 'nope', perEdge: { top: '5', right: '5', bottom: '5', left: '5' } })).toBeDefined()
    })

    it('still builds a cut line when a broken override is on the fold edge', () => {
      expect(cutLineFor({ default: '10', perEdge: { left: 'nope' } }, { fold: 'left' })).toBeDefined()
    })
  })
})

/** A closed outline through the corners. Each edge is named after the two point ids it joins. */
function outlinePattern(corners: readonly [string, number, number][], piece: Partial<Piece>): Pattern {
  const ids = corners.map(([id], i) => `${id}${corners[(i + 1) % corners.length]?.[0] ?? id}`)
  return rectangle(
    { outline: ids.map((segmentId) => ({ segmentId })), grainline: ['a', 'b'], ...piece },
    {
      points: corners.map(([id, x, y]) => ({ id, name: id.toUpperCase(), x: String(x), y: String(y) })),
      segments: ids.map((id) => ({ id, kind: 'line' as const, from: id.charAt(0), to: id.charAt(1) }))
    }
  )
}

/** A C opening to the right. The edge 'ef' faces the upper arm across the opening, 30 mm away. */
const cShape = (piece: Partial<Piece>): Pattern =>
  outlinePattern([['a', 0, 0], ['b', 100, 0], ['c', 100, 30], ['d', 20, 30], ['e', 20, 60], ['f', 100, 60], ['g', 100, 100], ['h', 0, 100]], piece)

const lShape = (piece: Partial<Piece>): Pattern =>
  outlinePattern([['a', 0, 0], ['b', 100, 0], ['c', 100, 50], ['d', 50, 50], ['e', 50, 100], ['f', 0, 100]], piece)

describe('cut line on a piece', () => {
  const panel = (piece: Partial<Piece> = {}, overrides: Partial<Pattern> = {}) => {
    const result = evaluate(rectangle(piece, overrides), 'S')
    return { result, piece: result.pieces['p'] }
  }

  it('offsets each edge by its own allowance, and uses the default elsewhere', () => {
    const { result, piece } = panel({ seamAllowance: { default: '10', perEdge: { bottom: 'notch_at - 5' } } })
    expect(result.issues).toEqual([])
    expect(piece?.cutLine?.ring).toEqual(expect.arrayContaining([vec(-10, -10), vec(110, -10), vec(110, 75), vec(-10, 75)]))
    expect(piece?.cutLine?.spans.map((span) => span.kind === 'edge' && span.allowance)).toEqual([10, 10, 25, 10])
  })

  it('carries the cut count', () => {
    expect(panel({ cutCount: 2 }).piece?.cutCount).toBe(2)
  })

  it('uses the default for a segment whose id is a built-in object property', () => {
    const { result, piece } = panel(
      { outline: [{ segmentId: 'constructor' }, { segmentId: 'right' }, { segmentId: 'bottom' }, { segmentId: 'left' }], seamAllowance: { default: '10', perEdge: { right: '5' } } },
      {
        segments: [
          { id: 'constructor', kind: 'line', from: 'a', to: 'b' },
          { id: 'right', kind: 'line', from: 'b', to: 'c' },
          { id: 'bottom', kind: 'line', from: 'c', to: 'd' },
          { id: 'left', kind: 'line', from: 'd', to: 'a' }
        ]
      }
    )
    expect(result.issues).toEqual([])
    expect(piece?.cutLine?.ring).toContainEqual(vec(-10, -10))
  })

  describe('allowance issues that leave the cut line built', () => {
    it('reports an override on an edge outside the outline', () => {
      const { result, piece } = panel({ seamAllowance: { default: '10', perEdge: { gone: '5' } } })
      expect(result.issues).toMatchObject([
        { kind: 'unknown-seam-allowance-edge', item: { kind: 'seamAllowance', pieceId: 'p', segmentId: 'gone' }, segmentId: 'gone' }
      ])
      expect(piece?.cutLine).toBeDefined()
    })

    it('reports an allowance on the fold edge and builds it at zero', () => {
      const { result, piece } = panel({ seamAllowance: { default: '10', perEdge: { left: '5' } }, fold: 'left' })
      expect(result.issues).toMatchObject([{ kind: 'fold-edge-has-allowance', segmentId: 'left' }])
      expect(Math.min(...(piece?.cutLine?.ring.map((point) => point.x) ?? []))).toBe(0)
    })
  })

  describe('a failed cut line', () => {
    const tooBig: Partial<Pattern> = {
      points: [
        { id: 'a', name: 'A', x: '0', y: '0' },
        { id: 'b', name: 'B', x: '200000', y: '0' },
        { id: 'c', name: 'C', x: '200000', y: '50' },
        { id: 'd', name: 'D', x: '0', y: '50' }
      ]
    }

    it('is one typed issue against the piece, with a message to show', () => {
      expect(panel({}, tooBig).result.issues).toEqual([
        {
          kind: 'cut-line-failed',
          item: { kind: 'piece', id: 'p', name: 'Panel' },
          failure: { kind: 'out-of-range' },
          message: "Piece 'Panel' is too large for a cut line: the limit is 100 m"
        }
      ])
    })

    it('leaves the piece with its outline, notches and grainline', () => {
      const { piece } = panel({ notches: [{ id: 'n', segmentId: 'top', distance: '30' }] }, tooBig)
      expect(piece?.cutLine).toBeUndefined()
      expect(piece?.outline).toHaveLength(4)
      expect(piece?.notches).toHaveLength(1)
      expect(piece?.grainline).toBeDefined()
    })

    it('names the edge when one edge is to blame', () => {
      const result = evaluate(cShape({ seamAllowance: { default: '15' } }), 'S')
      const failed = result.issues.find((issue) => issue.kind === 'cut-line-failed')
      expect(failed).toMatchObject({ failure: { kind: 'edge-swallowed' } })
      expect(failed?.message).toMatch(/^Piece 'Panel': the allowances next to segment '\w+' cover it completely/)
    })
  })

  describe('grainline', () => {
    it('resolves its two points and its angle', () => {
      expect(panel({ grainline: ['a', 'd'] }).piece?.grainline).toEqual({ from: vec(0, 0), to: vec(0, 50), angle: Math.PI / 2 })
    })

    it('is omitted with an issue when a point does not exist', () => {
      const { result, piece } = panel({ grainline: ['a', 'ghost'] })
      expect(result.issues).toMatchObject([{ kind: 'missing-point', item: { kind: 'piece', id: 'p' }, pointId: 'ghost' }])
      expect(piece?.grainline).toBeUndefined()
      expect(piece?.cutLine).toBeDefined()
    })

    it('treats a built-in object property name as a point that does not exist', () => {
      expect(panel({ grainline: ['a', 'constructor'] }).result.issues).toMatchObject([{ kind: 'missing-point', pointId: 'constructor' }])
    })

    it('is omitted with an issue when a point failed to evaluate', () => {
      const points = [
        { id: 'a', name: 'A', x: '0', y: '0' },
        { id: 'b', name: 'B', x: '100', y: '0' },
        { id: 'c', name: 'C', x: '100', y: '50' },
        { id: 'd', name: 'D', x: '0', y: '50' },
        { id: 'g', name: 'G', x: 'nope', y: '0' }
      ]
      const { result, piece } = panel({ grainline: ['a', 'g'] }, { points })
      expect(result.issues).toMatchObject([{ kind: 'undefined-reference' }, { kind: 'dependency-failed', item: { kind: 'piece', id: 'p' }, dependency: 'G' }])
      expect(piece?.grainline).toBeUndefined()
    })

    it('is omitted with an issue when its points coincide', () => {
      const { result, piece } = panel({ grainline: ['a', 'a'] })
      expect(result.issues).toMatchObject([{ kind: 'degenerate-grainline', item: { kind: 'piece', id: 'p' } }])
      expect(piece?.grainline).toBeUndefined()
    })
  })

  describe('fold', () => {
    const invalid = (reason: string) => [{ kind: 'invalid-fold-edge', item: { kind: 'piece', id: 'p' }, reason }]

    it('resolves, sets the edge to zero and lands on it', () => {
      const { result, piece } = panel({ fold: 'left' })
      expect(result.issues).toEqual([])
      expect(piece?.fold).toEqual({ segmentId: 'left', from: vec(0, 50), to: vec(0, 0) })
      expect(Math.min(...(piece?.cutLine?.ring.map((point) => point.x) ?? []))).toBe(0)
    })

    it('accepts a bezier that runs straight', () => {
      const points = [
        { id: 'a', name: 'A', x: '0', y: '0' },
        { id: 'b', name: 'B', x: '100', y: '0' },
        { id: 'c', name: 'C', x: '100', y: '50' },
        { id: 'd', name: 'D', x: '0', y: '50' },
        { id: 'k1', name: 'K1', x: '0', y: '30' },
        { id: 'k2', name: 'K2', x: '0', y: '10' }
      ]
      const segments: Pattern['segments'] = [
        { id: 'top', kind: 'line', from: 'a', to: 'b' },
        { id: 'right', kind: 'line', from: 'b', to: 'c' },
        { id: 'bottom', kind: 'line', from: 'c', to: 'd' },
        { id: 'left', kind: 'bezier', from: 'd', c1: 'k1', c2: 'k2', to: 'a' }
      ]
      expect(panel({ fold: 'left' }, { points, segments }).piece?.fold?.segmentId).toBe('left')
    })

    it('is refused on an edge outside the outline, and the outline reads its own allowances', () => {
      const { result, piece } = panel({ fold: 'ghost' })
      expect(result.issues).toMatchObject(invalid('not-in-outline'))
      expect(piece?.fold).toBeUndefined()
      expect(Math.min(...(piece?.cutLine?.ring.map((point) => point.x) ?? []))).toBe(-10)
    })

    it('is refused on a curved edge', () => {
      const points = [
        { id: 'a', name: 'A', x: '0', y: '0' },
        { id: 'b', name: 'B', x: '100', y: '0' },
        { id: 'c', name: 'C', x: '100', y: '50' },
        { id: 'd', name: 'D', x: '0', y: '50' },
        { id: 'k1', name: 'K1', x: '-20', y: '30' },
        { id: 'k2', name: 'K2', x: '-20', y: '10' }
      ]
      const segments: Pattern['segments'] = [
        { id: 'top', kind: 'line', from: 'a', to: 'b' },
        { id: 'right', kind: 'line', from: 'b', to: 'c' },
        { id: 'bottom', kind: 'line', from: 'c', to: 'd' },
        { id: 'left', kind: 'bezier', from: 'd', c1: 'k1', c2: 'k2', to: 'a' }
      ]
      expect(panel({ fold: 'left' }, { points, segments }).result.issues).toMatchObject(invalid('not-straight'))
    })

    it('fails the cut line when an allowance elsewhere reaches past a valid fold', () => {
      // Every seam point is right of the fold, but the 20 mm offset of the edge at x = 10 lands at x = -10.
      const pattern = outlinePattern([['a', 0, 100], ['b', 0, 0], ['c', 10, -20], ['d', 10, -60], ['e', 100, -60], ['f', 100, 100]], { fold: 'ab', seamAllowance: { default: '20' } })
      const { issues, pieces } = evaluate(pattern, 'S')
      expect(issues).toMatchObject([{ kind: 'cut-line-failed', failure: { kind: 'crosses-fold', segmentId: 'ab' } }])
      expect(pieces['p']?.fold?.segmentId).toBe('ab')
      expect(pieces['p']?.cutLine).toBeUndefined()
    })

    it('is refused when the piece lies on both sides of the edge', () => {
      expect(evaluate(cShape({ fold: 'ef' }), 'S').issues).toMatchObject(invalid('piece-crosses-line'))
    })
  })

  describe('notches on the cut line', () => {
    const notched = { notches: [{ id: 'n', segmentId: 'top', distance: 'notch_at' }] }

    it('lands at the allowance from the seam, with a 6 mm mark cut inward', () => {
      expect(panel(notched).piece?.cutLine?.notches).toEqual([{ notchId: 'n', at: vec(30, -10), mark: [vec(30, -10), vec(30, -4)] }])
    })

    it('stays on the seam for a zero-allowance edge', () => {
      const { piece } = panel({ ...notched, seamAllowance: { default: '10', perEdge: { top: '0' } } })
      expect(piece?.cutLine?.notches[0]?.at).toEqual(vec(30, 0))
    })

    it.each(['0.0001', '0.0004'])('stays on its own edge at an allowance of %s, under one grid unit', (allowance) => {
      const pattern = cShape({ seamAllowance: { default: '5', perEdge: { ef: allowance } }, notches: [{ id: 'n', segmentId: 'ef', distance: '40' }] })
      const piece = evaluate(pattern, 'S').pieces['p']
      const at = piece?.cutLine?.notches[0]?.at
      expect(at).toEqual(vec(60, 60))
    })

    it('still reaches the cut line at a small allowance above one grid unit', () => {
      const pattern = cShape({ seamAllowance: { default: '5', perEdge: { ef: '1' } }, notches: [{ id: 'n', segmentId: 'ef', distance: '40' }] })
      expect(evaluate(pattern, 'S').pieces['p']?.cutLine?.notches[0]?.at).toEqual(vec(60, 59))
    })

    it('goes to where the ray first leaves the ring, when a wider neighbour covers the plain offset', () => {
      // (52, 55) would be inside the neighbour's 25 mm band, so it wouldn't be on the cut line at all.
      const pattern = lShape({ seamAllowance: { default: '10', perEdge: { cd: '5', de: '25' } }, notches: [{ id: 'n', segmentId: 'cd', distance: '48' }] })
      expect(evaluate(pattern, 'S').pieces['p']?.cutLine?.notches[0]?.at).toEqual(vec(52, 110))
    })

    it('gives no notch marks without a cut line', () => {
      const { piece } = panel({ ...notched, seamAllowance: { default: 'nope' } })
      expect(piece?.notches).toHaveLength(1)
      expect(piece?.cutLine).toBeUndefined()
    })
  })
})

describe('flattenOutline', () => {
  it('gives per-edge polylines and a ring without the closing vertex', () => {
    const piece = evaluate(rectangle(), 'S').pieces['p']
    if (!piece) throw new Error('piece did not resolve')
    const flat = flattenOutline(piece, 0.05)
    expect(flat.edges.map((edge) => edge.points.length)).toEqual([2, 2, 2, 2])
    expect(flat.ring.map(({ x, y }) => [x, y])).toEqual([
      [0, 0],
      [100, 0],
      [100, 50],
      [0, 50]
    ])
  })
})

describe('raglan front', () => {
  it.each(raglanTee.sizes)('resolves a closed piece with its notch in size %s', (size) => {
    const result = evaluate(raglanTee, size)
    expect(result.issues).toEqual([])
    const front = result.pieces['front']
    expect(front?.orientation).toBe('counterclockwise')
    expect(front?.notches.map((notch) => notch.id)).toEqual(['frontRaglanNotch'])
  })

  it('measures lines exactly and curves between chord and control polygon (M)', () => {
    const { segments, points } = evaluate(raglanTee, 'M')
    expect(segments['frontCf']?.length).toBe(600)
    expect(segments['frontHem']?.length).toBe(275)
    expect(segments['frontSide']?.length).toBe(440)
    for (const id of ['frontNeck', 'frontRaglan']) {
      const segment = segments[id]
      if (segment?.curve.kind !== 'cubic') throw new Error(`${id} is not a cubic`)
      const { from, c1, c2, to } = segment.curve
      expect(segment.length).toBeGreaterThan(distance(from, to))
      expect(segment.length).toBeLessThan(distance(from, c1) + distance(c1, c2) + distance(c2, to))
      expect(segment.length).toBe(curveLength(segment.curve))
    }
    expect(points['hps']).toMatchObject({ x: 70, y: 0 })
  })

  it('places the raglan notch 100 mm from the underarm, pointing out of the piece', () => {
    const notch = evaluate(raglanTee, 'M').pieces['front']?.notches[0]
    if (!notch) throw new Error('notch did not place')
    expect(notch.distance).toBe(100)
    // The raglan is the right-hand edge rising to the neck; outward is to the right.
    expect(notch.outward.x).toBeGreaterThan(0)
    expect(notch.tangent.y).toBeLessThan(0)
  })

  it('grades: the raglan seam gets longer with each size', () => {
    const lengths = raglanTee.sizes.map((size) => evaluate(raglanTee, size).segments['frontRaglan']?.length ?? 0)
    for (let i = 1; i < lengths.length; i++) expect(lengths[i]).toBeGreaterThan(lengths[i - 1] ?? Infinity)
  })
})
