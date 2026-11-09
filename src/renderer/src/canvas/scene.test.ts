import { describe, expect, it } from 'vitest'
import { applyEdit, evaluate, pathData } from '@core'
import { raglanTee } from '@core/fixtures/raglan'
import { buildScene } from './scene'

const resolved = evaluate(raglanTee, 'M')

describe('buildScene', () => {
  it('draws the raglan front as one closed piece with every segment', () => {
    const scene = buildScene(raglanTee, resolved, null)
    const front = resolved.pieces['front']
    expect(scene.pieces).toEqual([
      { id: 'front', name: 'Front', d: pathData(front?.outline.map((edge) => edge.curve) ?? [], { closed: true }) }
    ])
    expect(scene.segments.map((s) => [s.id, s.inPiece, s.highlighted])).toEqual([
      ['frontNeck', true, false],
      ['frontCf', true, false],
      ['frontHem', true, false],
      ['frontSide', true, false],
      ['frontRaglan', true, false]
    ])
    expect(scene.segments[1]?.d).toBe('M 0 90 L 0 690')
  })

  it('adds two handles per bezier and puts control markers before anchors', () => {
    const scene = buildScene(raglanTee, resolved, null)
    expect(scene.handles.map((h) => h.key)).toEqual(['frontNeck:1', 'frontNeck:2', 'frontRaglan:1', 'frontRaglan:2'])
    expect(scene.handles[0]).toMatchObject({ anchor: { x: 70, y: 0 }, control: { x: 63, y: 54 } })
    expect(scene.markers.map((m) => m.role)).toEqual([...Array(4).fill('control'), ...Array(5).fill('anchor')])
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

  it('bounds every point', () => {
    expect(buildScene(raglanTee, resolved, null).bounds).toEqual({ min: { x: 0, y: 0 }, max: { x: 275, y: 690 } })
  })

  it('leaves out a broken point, its segments and its piece, but keeps the rest', () => {
    const pattern = applyEdit(raglanTee, { kind: 'setFormula', owner: { kind: 'point', id: 'cfHem', axis: 'y' }, formula: 'nope' })
    const scene = buildScene(pattern, evaluate(pattern, 'M'), { kind: 'point', id: 'cfHem' })
    expect(scene.pieces).toEqual([])
    expect(scene.markers.map((m) => m.id)).not.toContain('cfHem')
    expect(scene.segments.map((s) => [s.id, s.inPiece])).toEqual([
      ['frontNeck', false],
      ['frontSide', false],
      ['frontRaglan', false]
    ])
  })
})
