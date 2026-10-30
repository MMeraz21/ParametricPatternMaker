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
        seamAllowance: { default: 10 },
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
