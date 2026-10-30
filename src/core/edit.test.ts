import { describe, expect, it } from 'vitest'
import { applyEdit } from './edit'
import { evaluate } from './evaluate'
import { raglanTee } from './fixtures/raglan'

describe('applyEdit setPointFormula', () => {
  it('replaces one formula and shares everything else', () => {
    const next = applyEdit(raglanTee, { kind: 'setPointFormula', pointId: 'hps', axis: 'x', formula: 'neck_width + 10' })
    expect(next.points[0]).toEqual({ id: 'hps', name: 'HPS', x: 'neck_width + 10', y: '0' })
    expect(next.points.slice(1)).toEqual(raglanTee.points.slice(1))
    expect(next.points[1]).toBe(raglanTee.points[1])
    expect(next.segments).toBe(raglanTee.segments)
    expect(raglanTee.points[0]?.x).toBe('neck_width')
  })

  it('moves dependent points when re-evaluated', () => {
    const next = applyEdit(raglanTee, { kind: 'setPointFormula', pointId: 'hps', axis: 'x', formula: 'neck_width + 10' })
    const before = evaluate(raglanTee, 'M').points
    const after = evaluate(next, 'M').points
    expect(after['hps']?.x).toBe((before['hps']?.x ?? 0) + 10)
    expect(after['neckC1']?.x).toBeCloseTo((before['neckC1']?.x ?? 0) + 9, 9)
  })

  it('returns the same reference for no-ops', () => {
    expect(applyEdit(raglanTee, { kind: 'setPointFormula', pointId: 'ghost', axis: 'x', formula: '1' })).toBe(raglanTee)
    expect(applyEdit(raglanTee, { kind: 'setPointFormula', pointId: 'hps', axis: 'y', formula: '0' })).toBe(raglanTee)
  })

  it('accepts broken formulas, which evaluate reports as issues', () => {
    const next = applyEdit(raglanTee, { kind: 'setPointFormula', pointId: 'hps', axis: 'x', formula: '1 +' })
    expect(evaluate(next, 'M').issues[0]).toMatchObject({ kind: 'parse-error', item: { kind: 'pointCoord', id: 'hps', axis: 'x' } })
  })
})
