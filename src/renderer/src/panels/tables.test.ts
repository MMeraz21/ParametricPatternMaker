import { describe, expect, it } from 'vitest'
import { applyEdit, evaluate, type Pattern } from '@core'
import { raglanTee } from '@core/fixtures/raglan'
import { measurementTable, pointTable, variableTable, type Cell, type TableModel, type TextCell } from './tables'

const resolved = evaluate(raglanTee, 'M')

function cell(table: TableModel, row: string, columnId: string): Cell {
  const found = table.rows.find((r) => r.name === row)?.cells.find((c) => c.columnId === columnId)
  if (!found) throw new Error(`no cell ${row}/${columnId}`)
  return found
}

function text(table: TableModel, row: string, columnId: string): TextCell {
  const found = cell(table, row, columnId)
  if (found.kind !== 'text') throw new Error(`${row}/${columnId} is not editable`)
  return found
}

describe('measurementTable', () => {
  const table = measurementTable(raglanTee, resolved, null)

  it('has a column per size, highlighting the active one', () => {
    expect(table.columns.map((c) => [c.header, c.emphasis])).toEqual([
      ['Name', false],
      ['S', false],
      ['M', true],
      ['L', false],
      ['XL', false],
      ['XXL', false]
    ])
    expect(table.rows.map((r) => r.name)).toEqual(['chest', 'neck', 'shoulder_width', 'back_length', 'armhole_depth'])
    expect(table.title).toBe('Measurements (cm)')
    expect(text(table, 'chest', 'L')).toMatchObject({ label: 'chest L', text: '108' })
  })

  it('commits numbers in display units as setMeasurement in mm, and rejects anything else', () => {
    const chestM = text(table, 'chest', 'M')
    expect(chestM.commit('104')).toEqual({ ok: true, edit: { kind: 'setMeasurement', name: 'chest', size: 'M', value: 1040 } })
    expect(chestM.commit(' 100 ')).toEqual({ ok: true, edit: null })
    expect(chestM.commit('wide')).toEqual({ ok: false, message: "'wide' is not a number" })
    expect(chestM.commit('')).toMatchObject({ ok: false })
  })

  it('shows and reads inches, keeping exact mm when the rounded text is committed unchanged', () => {
    const inches: Pattern = { ...raglanTee, units: 'in' }
    const t = measurementTable(inches, evaluate(inches, 'M'), null)
    expect(t.title).toBe('Measurements (in)')
    const chestM = text(t, 'chest', 'M')
    expect(chestM.text).toBe('39.37')
    expect(chestM.commit('39.37')).toEqual({ ok: true, edit: null })
    expect(chestM.commit('40')).toEqual({ ok: true, edit: { kind: 'setMeasurement', name: 'chest', size: 'M', value: 1016 } })
  })

  it('renames through the name cell, refusing taken names', () => {
    const name = text(table, 'neck', 'name')
    expect(name.commit('neck_circ')).toEqual({ ok: true, edit: { kind: 'rename', item: { kind: 'measurement', name: 'neck' }, to: 'neck_circ' } })
    expect(name.commit('chest')).toEqual({ ok: false, message: "'chest' is already used by a measurement" })
    expect(name.commit('neck')).toEqual({ ok: true, edit: null })
  })

  it('offers add and remove edits', () => {
    expect(table.add.edit).toMatchObject({ kind: 'add', item: { kind: 'measurement', measurement: { name: 'measurement_1' } } })
    expect(table.rows[0]?.remove).toEqual({ kind: 'remove', item: { kind: 'measurement', name: 'chest' } })
  })

  it('flags a missing value on the active size', () => {
    const pattern: Pattern = { ...raglanTee, measurements: [{ name: 'chest', values: { S: 920 } }, ...raglanTee.measurements.slice(1)] }
    const t = measurementTable(pattern, evaluate(pattern, 'M'), null)
    expect(text(t, 'chest', 'M')).toMatchObject({ text: '', issues: [{ kind: 'missing-measurement-value' }] })
    expect(text(t, 'chest', 'L').issues).toEqual([])
  })
})

describe('variableTable', () => {
  it('shows formulas, values and the selected row', () => {
    const table = variableTable(raglanTee, resolved, { kind: 'variable', name: 'body_width' })
    expect(table.columns.map((c) => c.header)).toEqual(['Name', 'Formula', 'Value (cm)'])
    expect(text(table, 'body_width', 'formula').text).toBe('(chest + chest_ease) / 4')
    expect(cell(table, 'body_width', 'value')).toEqual({ kind: 'readout', columnId: 'value', label: 'body_width value', text: '27.5' })
    expect(table.rows.filter((r) => r.selected).map((r) => r.name)).toEqual(['body_width'])
  })

  it('commits formulas, even broken ones, and puts their issues on the formula cell', () => {
    const table = variableTable(raglanTee, resolved, null)
    expect(text(table, 'chest_ease', 'formula').commit('120')).toEqual({
      ok: true,
      edit: { kind: 'setFormula', owner: { kind: 'variable', name: 'chest_ease' }, formula: '120' }
    })
    const broken = applyEdit(raglanTee, { kind: 'setFormula', owner: { kind: 'variable', name: 'chest_ease' }, formula: '1 +' })
    const t = variableTable(broken, evaluate(broken, 'M'), null)
    expect(text(t, 'chest_ease', 'formula').issues.map((i) => i.kind)).toEqual(['parse-error'])
    expect(text(t, 'chest_ease', 'name').issues).toEqual([])
    expect(cell(t, 'body_width', 'value')).toMatchObject({ text: null })
  })
})

describe('pointTable', () => {
  it('lists points by name with editable formulas', () => {
    const table = pointTable(raglanTee, resolved, null)
    expect(table.rows.map((r) => r.name)).toEqual(['HPS', 'CFNeck', 'Underarm', 'SideHem', 'CFHem', 'NeckC1', 'NeckC2', 'RaglanC1', 'RaglanC2'])
    expect(text(table, 'HPS', 'x')).toMatchObject({ label: 'HPS x', text: 'neck_width' })
    expect(text(table, 'HPS', 'name').commit('Shoulder')).toEqual({ ok: true, edit: { kind: 'rename', item: { kind: 'point', id: 'hps' }, to: 'Shoulder' } })
    expect(table.add.edit).toMatchObject({ kind: 'add', item: { kind: 'point', point: { id: 'p1', name: 'P_1' } } })
  })
})
