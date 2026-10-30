import { describe, expect, it } from 'vitest'
import { applyEdit, checkName, keyOf, newItem } from './edit'
import { evaluate } from './evaluate'
import { raglanTee } from './fixtures/raglan'
import type { Pattern } from './model'

const hpsX = (formula: string) => ({ kind: 'setFormula', owner: { kind: 'point', id: 'hps', axis: 'x' }, formula }) as const

describe('setFormula', () => {
  it('replaces one point formula and shares everything else', () => {
    const next = applyEdit(raglanTee, hpsX('neck_width + 10'))
    expect(next.points[0]).toEqual({ id: 'hps', name: 'HPS', x: 'neck_width + 10', y: '0' })
    expect(next.points[1]).toBe(raglanTee.points[1])
    expect(next.segments).toBe(raglanTee.segments)
    expect(raglanTee.points[0]?.x).toBe('neck_width')
  })

  it('moves dependent points when re-evaluated', () => {
    const before = evaluate(raglanTee, 'M').points
    const after = evaluate(applyEdit(raglanTee, hpsX('neck_width + 10')), 'M').points
    expect(after['hps']?.x).toBe((before['hps']?.x ?? 0) + 10)
    expect(after['neckC1']?.x).toBeCloseTo((before['neckC1']?.x ?? 0) + 9, 9)
  })

  it('sets variable formulas', () => {
    const next = applyEdit(raglanTee, { kind: 'setFormula', owner: { kind: 'variable', name: 'chest_ease' }, formula: '120' })
    expect(evaluate(next, 'M').variables['body_width']).toBe(280)
  })

  it('returns the same reference for no-ops', () => {
    expect(applyEdit(raglanTee, { kind: 'setFormula', owner: { kind: 'point', id: 'ghost', axis: 'x' }, formula: '1' })).toBe(raglanTee)
    expect(applyEdit(raglanTee, hpsX('neck_width'))).toBe(raglanTee)
  })

  it('accepts broken formulas, which evaluate reports as issues', () => {
    expect(evaluate(applyEdit(raglanTee, hpsX('1 +')), 'M').issues[0]).toMatchObject({
      kind: 'parse-error',
      item: { kind: 'pointCoord', id: 'hps', axis: 'x' }
    })
  })
})

describe('setMeasurement', () => {
  it('sets one size and redraws', () => {
    const next = applyEdit(raglanTee, { kind: 'setMeasurement', name: 'chest', size: 'M', value: 1040 })
    expect(next.measurements[0]?.values).toEqual({ S: 920, M: 1040, L: 1080, XL: 1160, XXL: 1260 })
    expect(evaluate(next, 'M').points['underarm']?.x).toBe(285)
  })

  it('refuses unknown sizes, non-finite values and unknown names', () => {
    expect(applyEdit(raglanTee, { kind: 'setMeasurement', name: 'chest', size: 'Q', value: 1 })).toBe(raglanTee)
    expect(applyEdit(raglanTee, { kind: 'setMeasurement', name: 'chest', size: 'M', value: Number.NaN })).toBe(raglanTee)
    expect(applyEdit(raglanTee, { kind: 'setMeasurement', name: 'ghost', size: 'M', value: 1 })).toBe(raglanTee)
    expect(applyEdit(raglanTee, { kind: 'setMeasurement', name: 'chest', size: 'M', value: 1000 })).toBe(raglanTee)
  })
})

describe('rename', () => {
  it('renames a measurement and every formula that uses it, keeping the text', () => {
    const next = applyEdit(raglanTee, { kind: 'rename', item: { kind: 'measurement', name: 'neck' }, to: 'neck_circ' })
    expect(next.measurements.map((m) => m.name)).toContain('neck_circ')
    expect(next.variables.find((v) => v.name === 'neck_width')?.formula).toBe('neck_circ / 6 + 5')
    expect(evaluate(next, 'M').issues).toEqual([])
    expect(next.points).toBe(raglanTee.points)
  })

  it('renames a point and its Name.x references, keeping its id', () => {
    const next = applyEdit(raglanTee, { kind: 'rename', item: { kind: 'point', id: 'hps' }, to: 'Shoulder' })
    expect(next.points[0]).toEqual({ id: 'hps', name: 'Shoulder', x: 'neck_width', y: '0' })
    expect(next.points.find((p) => p.id === 'raglanC1')?.x).toBe('Shoulder.x + (Underarm.x - Shoulder.x) * 0.55')
    expect(evaluate(next, 'M').issues).toEqual([])
  })

  it('rewrites notch distances', () => {
    const withNotch: Pattern = {
      ...raglanTee,
      pieces: raglanTee.pieces.map((p) => ({ ...p, notches: [{ id: 'n', segmentId: 'frontRaglan', distance: 'chest_ease' }] }))
    }
    const next = applyEdit(withNotch, { kind: 'rename', item: { kind: 'variable', name: 'chest_ease' }, to: 'ease' })
    expect(next.pieces[0]?.notches[0]?.distance).toBe('ease')
  })

  it('refuses invalid or taken names', () => {
    const neck = { kind: 'measurement', name: 'neck' } as const
    expect(applyEdit(raglanTee, { kind: 'rename', item: neck, to: 'chest' })).toBe(raglanTee)
    expect(applyEdit(raglanTee, { kind: 'rename', item: neck, to: '2neck' })).toBe(raglanTee)
    expect(applyEdit(raglanTee, { kind: 'rename', item: neck, to: 'HPS' })).toBe(raglanTee)
    expect(applyEdit(raglanTee, { kind: 'rename', item: neck, to: 'neck' })).toBe(raglanTee)
  })
})

describe('add and remove', () => {
  it('adds new items with unique names and ids', () => {
    const point = newItem(raglanTee, 'point')
    expect(point).toEqual({ kind: 'point', point: { id: 'p1', name: 'P_1', x: '0', y: '0' } })
    const next = applyEdit(raglanTee, { kind: 'add', item: point })
    expect(next.points.at(-1)).toEqual({ id: 'p1', name: 'P_1', x: '0', y: '0' })
    expect(newItem(next, 'point')).toEqual({ kind: 'point', point: { id: 'p2', name: 'P_2', x: '0', y: '0' } })
    expect(keyOf(point)).toEqual({ kind: 'point', id: 'p1' })
  })

  it('gives new measurements a value of 0 for every size', () => {
    expect(newItem(raglanTee, 'measurement')).toEqual({
      kind: 'measurement',
      measurement: { name: 'measurement_1', values: { S: 0, M: 0, L: 0, XL: 0, XXL: 0 } }
    })
  })

  it('refuses adding a taken name or id', () => {
    expect(applyEdit(raglanTee, { kind: 'add', item: { kind: 'variable', variable: { name: 'chest', formula: '1' } } })).toBe(raglanTee)
    expect(applyEdit(raglanTee, { kind: 'add', item: { kind: 'point', point: { id: 'hps', name: 'Q', x: '0', y: '0' } } })).toBe(
      raglanTee
    )
  })

  it('removes without cascading, so dependents report issues', () => {
    const next = applyEdit(raglanTee, { kind: 'remove', item: { kind: 'variable', name: 'chest_ease' } })
    expect(next.variables.map((v) => v.name)).not.toContain('chest_ease')
    expect(evaluate(next, 'M').issues[0]).toMatchObject({ kind: 'undefined-reference', reference: 'chest_ease' })
    expect(applyEdit(raglanTee, { kind: 'remove', item: { kind: 'point', id: 'ghost' } })).toBe(raglanTee)
  })
})

describe('checkName', () => {
  it('explains invalid and taken names, allowing an item to keep its own', () => {
    expect(checkName(raglanTee, 'waist')).toBeNull()
    expect(checkName(raglanTee, 'not')?.kind).toBe('invalid')
    expect(checkName(raglanTee, 'HPS')).toEqual({ kind: 'taken', message: "'HPS' is already used by a point" })
    expect(checkName(raglanTee, 'HPS', { kind: 'point', id: 'hps' })).toBeNull()
  })
})
