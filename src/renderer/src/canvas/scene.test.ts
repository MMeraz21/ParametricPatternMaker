import { describe, expect, it } from 'vitest'
import { applyEdit, evaluate, pathData, polygonPathData } from '@core'
import { raglanTee } from '@core/fixtures/raglan'
import { buildScene } from './scene'

const resolved = evaluate(raglanTee, 'M')

describe('buildScene', () => {
  it('draws each raglan piece closed, with every segment in a piece', () => {
    const scene = buildScene(raglanTee, resolved, null)
    const front = resolved.pieces['front']
    expect(scene.pieces.map((p) => p.id)).toEqual(['front', 'back', 'sleeve', 'neckband'])
    expect(scene.pieces[0]).toMatchObject({
      id: 'front',
      name: 'Front',
      d: pathData(front?.outline.map((edge) => edge.curve) ?? [], { closed: true })
    })
    expect(scene.segments.map((s) => s.id)).toEqual(raglanTee.segments.map((s) => s.id))
    expect(scene.segments.every((s) => s.inPiece && !s.highlighted)).toBe(true)
    expect(scene.segments[1]?.d).toBe('M 0 90 L 0 690')
  })

  it('adds two handles per bezier and puts control markers before anchors', () => {
    const scene = buildScene(raglanTee, resolved, null)
    expect(scene.handles).toHaveLength(14)
    expect(scene.handles.slice(0, 4).map((h) => h.key)).toEqual(['frontNeck:1', 'frontNeck:2', 'frontRaglan:1', 'frontRaglan:2'])
    expect(scene.handles[0]).toMatchObject({ anchor: { x: 70, y: 0 }, control: { x: 63, y: 54 } })
    expect(scene.markers.map((m) => m.role)).toEqual([...Array(13).fill('control'), ...Array(16).fill('anchor')])
  })

  it('marks the selected point and highlights the segments that use it', () => {
    const scene = buildScene(raglanTee, resolved, { kind: 'point', id: 'raglanC1' })
    expect(scene.markers.filter((m) => m.selected).map((m) => m.id)).toEqual(['raglanC1'])
    expect(scene.segments.filter((s) => s.highlighted).map((s) => s.id)).toEqual(['frontRaglan'])
    expect(scene.handles.filter((h) => h.highlighted)).toHaveLength(2)
  })

  it('draws a duplicated segment id once', () => {
    const pattern = { ...raglanTee, segments: [...raglanTee.segments, { id: 'frontCf', kind: 'line' as const, from: 'hps', to: 'cfHem' }] }
    const scene = buildScene(pattern, evaluate(pattern, 'M'), null)
    expect(scene.segments.filter((s) => s.id === 'frontCf')).toHaveLength(1)
  })

  it('bounds every point and every cut line', () => {
    const { bounds } = buildScene(raglanTee, resolved, null)
    const ringPoints = Object.values(resolved.pieces).flatMap((piece) => piece.cutLine?.ring ?? [])
    expect(ringPoints.length).toBeGreaterThan(0)
    expect(bounds?.min.x).toBe(Math.min(0, ...ringPoints.map((p) => p.x)))
    expect(bounds?.min.y).toBe(Math.min(-12, ...ringPoints.map((p) => p.y)))
    expect(bounds?.max.x).toBe(Math.max(997, ...ringPoints.map((p) => p.x)))
    expect(bounds?.max.y).toBe(Math.max(900, ...ringPoints.map((p) => p.y)))
    expect(bounds?.max.y).toBeGreaterThan(900)
  })

  describe('piece details', () => {
    const scene = buildScene(raglanTee, resolved, null)
    const piece = scene.pieces[0]
    const front = resolved.pieces['front']

    it('draws the cut line from its ring', () => {
      expect(piece?.cutD).toBe(polygonPathData(front?.cutLine?.ring ?? []))
      expect(piece?.cutD?.endsWith('Z')).toBe(true)
    })

    it('draws one mark per notch', () => {
      expect(piece?.notchMarks).toEqual(front?.cutLine?.notches.map((notch) => notch.mark))
      expect(piece?.notchMarks).toHaveLength(1)
    })

    it('draws the grainline with an arrowhead at its far end', () => {
      expect(piece?.grainlineD).toBe('M 0 90 L 0 690 M 4.8 678 L 0 690 L -4.8 678')
    })

    it('draws the fold along its edge', () => {
      expect(piece?.fold).toEqual([{ x: 0, y: 90 }, { x: 0, y: 690 }])
    })

    it('has nothing to draw for what failed, but keeps the piece', () => {
      const broken = applyEdit(raglanTee, { kind: 'setPiece', pieceId: 'front', patch: { seamAllowance: { default: 'nope' }, grainline: ['hps', 'ghost'], fold: null } })
      const failed = buildScene(broken, evaluate(broken, 'M'), null).pieces[0]
      expect(failed).toMatchObject({ id: 'front', cutD: null, notchMarks: [], grainlineD: null, fold: null })
      expect(failed?.d).toContain('M')
    })

    it('marks only the selected piece', () => {
      const selected = buildScene(raglanTee, resolved, { kind: 'piece', id: 'back' })
      expect(selected.pieces.filter((p) => p.selected).map((p) => p.id)).toEqual(['back'])
      expect(scene.pieces.some((p) => p.selected)).toBe(false)
    })
  })

  it('leaves out a broken point, its segments and its piece, but keeps the rest', () => {
    const pattern = applyEdit(raglanTee, { kind: 'setFormula', owner: { kind: 'point', id: 'cfHem', axis: 'y' }, formula: 'nope' })
    const scene = buildScene(pattern, evaluate(pattern, 'M'), { kind: 'point', id: 'cfHem' })
    expect(scene.pieces.map((p) => p.id)).toEqual(['sleeve', 'neckband'])
    expect(scene.markers.map((m) => m.id)).not.toContain('cfHem')
    expect(scene.segments.slice(0, 6).map((s) => [s.id, s.inPiece])).toEqual([
      ['frontNeck', false],
      ['frontSide', false],
      ['frontRaglan', false],
      ['backNeck', false],
      ['backRaglan', false],
      ['sleeveNeck', true]
    ])
  })
})
