import { describe, expect, it } from 'vitest'
import { applyEdit, evaluate, type Pattern } from '@core'
import { raglanTee } from '@core/fixtures/raglan'
import { edgeTable, measurementTable, notchTable, pieceTable, pointTable, segmentTable, tablesFor, variableTable, type Cell, type TableModel, type TextCell } from './tables'

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

describe('review fixes', () => {
  it('rejects a rename that core would refuse, with a message', () => {
    // `e2` is a free, valid name, but `2.ease2` would become `2.e2`, which reads as the number 200.
    const pattern: Pattern = { ...raglanTee, variables: [...raglanTee.variables, { name: 'ease2', formula: '1' }, { name: 'w', formula: '2.ease2' }] }
    const t = variableTable(pattern, evaluate(pattern, 'M'), null)
    expect(text(t, 'ease2', 'name').commit('e2')).toEqual({ ok: false, message: "Can't rename 'ease2' to 'e2' without changing what a formula means" })
    expect(text(t, 'ease2', 'name').commit('ease3')).toMatchObject({ ok: true })
  })

  it('shows one row per name when a pattern has duplicates', () => {
    const pattern: Pattern = { ...raglanTee, measurements: [...raglanTee.measurements, { name: 'chest', values: { M: 1 } }] }
    const t = measurementTable(pattern, evaluate(pattern, 'M'), null)
    expect(t.rows.filter((r) => r.name === 'chest')).toHaveLength(1)
    expect(text(t, 'chest', 'M').text).toBe('100')
  })
})

describe('pointTable', () => {
  it('lists points by name with editable formulas', () => {
    const table = pointTable(raglanTee, resolved, null)
    expect(table.rows.map((r) => r.name)).toEqual(raglanTee.points.map((p) => p.name))
    expect(table.rows.slice(0, 9).map((r) => r.name)).toEqual(['HPS', 'CFNeck', 'Underarm', 'SideHem', 'CFHem', 'NeckC1', 'NeckC2', 'RaglanC1', 'RaglanC2'])
    expect(text(table, 'HPS', 'x')).toMatchObject({ label: 'HPS x', text: 'neck_width' })
    expect(text(table, 'HPS', 'name').commit('Shoulder')).toEqual({ ok: true, edit: { kind: 'rename', item: { kind: 'point', id: 'hps' }, to: 'Shoulder' } })
    expect(table.add.edit).toMatchObject({ kind: 'add', item: { kind: 'point', point: { id: 'p1', name: 'P_1' } } })
  })
})

describe('segmentTable', () => {
  const table = segmentTable(raglanTee, resolved, null)
  const frontCf = { id: 'frontCf', kind: 'line', from: 'cfNeck', to: 'cfHem' } as const

  it('shows one row per segment, with points by name', () => {
    expect(table.columns.map((c) => c.header)).toEqual(['Id', 'Kind', 'From', 'C1', 'C2', 'To'])
    expect(table.rows.map((r) => r.name)).toEqual(raglanTee.segments.map((s) => s.id))
    expect(cell(table, 'frontCf', 'id')).toMatchObject({ kind: 'readout', text: 'frontCf' })
    expect(text(table, 'frontCf', 'kind').text).toBe('line')
    expect(text(table, 'frontCf', 'from')).toMatchObject({ label: 'frontCf from', text: 'CFNeck' })
  })

  it('has control point cells only for a bezier', () => {
    expect(cell(table, 'frontCf', 'c1')).toMatchObject({ kind: 'readout', text: null })
    expect(text(table, 'frontNeck', 'c1').text).toBe('NeckC1')
  })

  it('maps a typed point name to its id, and rejects a name that does not exist', () => {
    expect(text(table, 'frontCf', 'from').commit('HPS')).toEqual({ ok: true, edit: { kind: 'setSegment', segment: { ...frontCf, from: 'hps' } } })
    expect(text(table, 'frontCf', 'from').commit('Nope')).toEqual({ ok: false, message: "No point named 'Nope'" })
    expect(text(table, 'frontCf', 'from').commit('CFNeck')).toEqual({ ok: true, edit: null })
  })

  it('switches kind, starting a new bezier with its controls on its anchors', () => {
    expect(text(table, 'frontCf', 'kind').commit('bezier')).toEqual({
      ok: true,
      edit: { kind: 'setSegment', segment: { id: 'frontCf', kind: 'bezier', from: 'cfNeck', c1: 'cfNeck', c2: 'cfHem', to: 'cfHem' } }
    })
    expect(text(table, 'frontNeck', 'kind').commit('line')).toMatchObject({ ok: true, edit: { segment: { kind: 'line' } } })
    expect(text(table, 'frontCf', 'kind').commit('arc')).toEqual({ ok: false, message: "A segment is 'line' or 'bezier', not 'arc'" })
  })

  it('shows an id that matches no point, and puts the segment issues on the row', () => {
    const pattern = applyEdit(raglanTee, { kind: 'remove', item: { kind: 'point', id: 'cfNeck' } })
    const t = segmentTable(pattern, evaluate(pattern, 'M'), null)
    expect(text(t, 'frontCf', 'from')).toMatchObject({ text: 'cfNeck', issues: [{ kind: 'missing-point' }] })
  })

  it('offers add and remove edits', () => {
    expect(table.add.edit).toMatchObject({ kind: 'add', item: { kind: 'segment', segment: { id: 's1' } } })
    expect(table.rows[0]?.remove).toEqual({ kind: 'remove', item: { kind: 'segment', id: 'frontNeck' } })
  })
})

describe('pieceTable', () => {
  const table = pieceTable(raglanTee, resolved, { kind: 'piece', id: 'back' })
  const front = raglanTee.pieces[0]
  const set = (patch: object) => ({ ok: true, edit: { kind: 'setPiece', pieceId: 'front', patch } })

  it('shows one row per piece', () => {
    expect(table.columns.map((c) => c.header)).toEqual(['Name', 'Allowance', 'Grain from', 'Grain to', 'Fold', 'Cut count'])
    expect(table.rows.map((r) => r.name)).toEqual(['Front', 'Back', 'Sleeve', 'Neckband'])
    expect(table.rows.filter((r) => r.selected).map((r) => r.name)).toEqual(['Back'])
    expect(text(table, 'Front', 'allowance')).toMatchObject({ label: 'Front allowance', text: '10' })
    expect(text(table, 'Front', 'grainFrom').text).toBe('CFNeck')
    expect(text(table, 'Front', 'fold').text).toBe('frontCf')
    expect(text(table, 'Front', 'cutCount').text).toBe('1')
  })

  it('commits a default allowance formula and keeps the overrides', () => {
    expect(text(table, 'Front', 'allowance').commit('12')).toEqual(set({ seamAllowance: { default: '12', perEdge: front?.seamAllowance.perEdge } }))
    expect(text(table, 'Front', 'allowance').commit('10')).toEqual({ ok: true, edit: null })
  })

  it('commits the name, and a grainline by point name', () => {
    expect(text(table, 'Front', 'name').commit('Bodice')).toEqual(set({ name: 'Bodice' }))
    expect(text(table, 'Front', 'grainTo').commit('HPS')).toEqual(set({ grainline: ['cfNeck', 'hps'] }))
    expect(text(table, 'Front', 'grainFrom').commit('Nope')).toEqual({ ok: false, message: "No point named 'Nope'" })
  })

  it('sets the fold to an edge of the piece and clears it when blank', () => {
    expect(text(table, 'Front', 'fold').commit('frontHem')).toEqual(set({ fold: 'frontHem' }))
    expect(text(table, 'Front', 'fold').commit('')).toEqual(set({ fold: null }))
    expect(text(table, 'Front', 'fold').commit('sleeveHem')).toEqual({ ok: false, message: "'sleeveHem' is not an edge of Front" })
    expect(text(table, 'Sleeve', 'fold').commit('')).toEqual({ ok: true, edit: null })
  })

  it('takes a whole cut count of 1 or more', () => {
    expect(text(table, 'Front', 'cutCount').commit('2')).toEqual(set({ cutCount: 2 }))
    const rejected = { ok: false, message: 'Cut count must be a whole number of 1 or more' }
    for (const bad of ['two', '0', '1.5', '']) expect(text(table, 'Front', 'cutCount').commit(bad)).toEqual(rejected)
  })

  it('puts each issue on the cell it is about', () => {
    const broken = applyEdit(raglanTee, { kind: 'setPiece', pieceId: 'front', patch: { seamAllowance: { default: 'nope' } } })
    const t = pieceTable(broken, evaluate(broken, 'M'), null)
    expect(text(t, 'Front', 'allowance').issues.map((i) => i.kind)).toEqual(['undefined-reference'])

    const badFold = applyEdit(raglanTee, { kind: 'setPiece', pieceId: 'front', patch: { fold: 'frontNeck' } })
    const u = pieceTable(badFold, evaluate(badFold, 'M'), null)
    expect(text(u, 'Front', 'fold').issues.map((i) => i.kind)).toEqual(['invalid-fold-edge'])
    expect(text(u, 'Front', 'name').issues).toEqual([])

    const badGrain = applyEdit(raglanTee, { kind: 'setPiece', pieceId: 'front', patch: { grainline: ['hps', 'hps'] } })
    const v = pieceTable(badGrain, evaluate(badGrain, 'M'), null)
    expect(text(v, 'Front', 'grainFrom').issues.map((i) => i.kind)).toEqual(['degenerate-grainline'])

    const failed = applyEdit(raglanTee, { kind: 'setPiece', pieceId: 'front', patch: { seamAllowance: { default: '1e6' } } })
    const w = pieceTable(failed, evaluate(failed, 'M'), null)
    expect(text(w, 'Front', 'name').issues.map((i) => i.kind)).toEqual(['cut-line-failed'])
  })

  it('offers add and remove edits', () => {
    expect(table.add.edit).toMatchObject({ kind: 'add', item: { kind: 'piece', piece: { id: 'piece1' } } })
    expect(table.rows[0]?.remove).toEqual({ kind: 'remove', item: { kind: 'piece', id: 'front' } })
    expect(table.rows[0]?.key).toEqual({ kind: 'piece', id: 'front' })
  })
})

describe('edgeTable', () => {
  const front = raglanTee.pieces[0]
  if (!front) throw new Error('raglan has a front')
  const table = edgeTable(raglanTee, resolved, front)
  const setAllowance = (seamAllowance: object) => ({ ok: true, edit: { kind: 'setPiece', pieceId: 'front', patch: { seamAllowance } } })
  const others = { frontHem: '25' }

  it('shows one row per edge, in outline order', () => {
    expect(table.title).toBe('Edges of Front')
    expect(table.columns.map((c) => c.header)).toEqual(['Segment', 'Reversed', 'Allowance', 'Length (cm)'])
    expect(table.rows.map((r) => r.name)).toEqual(front.outline.map((e) => e.segmentId))
    expect(text(table, 'frontHem', 'allowance')).toMatchObject({ label: 'frontHem allowance', text: '25' })
    expect(text(table, 'frontSide', 'allowance').text).toBe('')
    expect(text(table, 'frontHem', 'reversed').text).toBe('no')
    expect(cell(table, 'frontCf', 'length')).toEqual({ kind: 'readout', columnId: 'length', label: 'frontCf length', text: '60' })
  })

  it('sets an override, and clears it when blank', () => {
    expect(text(table, 'frontSide', 'allowance').commit('5')).toEqual(setAllowance({ default: '10', perEdge: { ...others, frontSide: '5' } }))
    expect(text(table, 'frontHem', 'allowance').commit('')).toEqual(setAllowance({ default: '10' }))
    expect(text(table, 'frontSide', 'allowance').commit('')).toEqual({ ok: true, edit: null })
  })

  it('selects the piece, not the edge', () => {
    expect(table.rows[0]?.key).toEqual({ kind: 'piece', id: 'front' })
    expect(table.rows.some((r) => r.selected)).toBe(false)
  })

  it('changes the segment of an edge, refusing one that does not exist', () => {
    const outline = front.outline.map((e) => (e.segmentId === 'frontHem' ? { ...e, segmentId: 'backNeck' } : e))
    // The override follows the edge, or it would be stranded with no row left to clear it from.
    expect(text(table, 'frontHem', 'segment').commit('backNeck')).toEqual({
      ok: true,
      edit: { kind: 'setPiece', pieceId: 'front', patch: { outline, seamAllowance: { default: '10', perEdge: { backNeck: '25' } } } }
    })
    expect(text(table, 'frontSide', 'segment').commit('backNeck')).toMatchObject({ edit: { patch: { outline: expect.any(Array) } } })
    expect(text(table, 'frontHem', 'segment').commit('ghost')).toEqual({ ok: false, message: "No segment with id 'ghost'" })
  })

  it('reads reversed as yes or no', () => {
    const outline = front.outline.map((e) => (e.segmentId === 'frontHem' ? { ...e, reversed: true } : e))
    expect(text(table, 'frontHem', 'reversed').commit('yes')).toEqual({ ok: true, edit: { kind: 'setPiece', pieceId: 'front', patch: { outline } } })
    expect(text(table, 'frontHem', 'reversed').commit('no')).toEqual({ ok: true, edit: null })
    expect(text(table, 'frontHem', 'reversed').commit('maybe')).toEqual({ ok: false, message: "Reversed is 'yes' or 'no'" })
  })

  it('removes an edge, and adds the first segment not yet used', () => {
    expect(table.rows[0]?.remove).toEqual({ kind: 'setPiece', pieceId: 'front', patch: { outline: front.outline.slice(1) } })
    expect(table.add.edit).toEqual({ kind: 'setPiece', pieceId: 'front', patch: { outline: [...front.outline, { segmentId: 'backNeck' }] } })
    const hem = table.rows.find((r) => r.name === 'frontHem')
    expect(hem?.remove).toEqual({
      kind: 'setPiece',
      pieceId: 'front',
      patch: { outline: front.outline.filter((e) => e.segmentId !== 'frontHem'), seamAllowance: { default: '10' } }
    })
  })

  it('puts a stale or broken override on its cell', () => {
    const broken = applyEdit(raglanTee, { kind: 'setPiece', pieceId: 'front', patch: { seamAllowance: { default: '10', perEdge: { frontHem: 'nope' } } } })
    const t = edgeTable(broken, evaluate(broken, 'M'), broken.pieces[0] ?? front)
    expect(text(t, 'frontHem', 'allowance').issues.map((i) => i.kind)).toEqual(['undefined-reference'])
  })
})

describe('notchTable', () => {
  const front = raglanTee.pieces[0]
  if (!front) throw new Error('raglan has a front')
  const table = notchTable(raglanTee, resolved, front)
  const patch = (notches: object[]) => ({ kind: 'setPiece', pieceId: 'front', patch: { notches } })
  const [notch] = front.notches
  if (!notch) throw new Error('front has a notch')

  it('shows one row per notch', () => {
    expect(table.title).toBe('Notches of Front')
    expect(table.columns.map((c) => c.header)).toEqual(['Segment', 'Distance'])
    expect(table.rows.map((r) => r.name)).toEqual(['frontRaglanNotch'])
    expect(text(table, 'frontRaglanNotch', 'distance')).toMatchObject({ label: 'frontRaglanNotch distance', text: '100' })
  })

  it('commits a distance formula, and an edge of the piece', () => {
    expect(text(table, 'frontRaglanNotch', 'distance').commit('50')).toEqual({ ok: true, edit: patch([{ ...notch, distance: '50' }]) })
    expect(text(table, 'frontRaglanNotch', 'segment').commit('frontHem')).toEqual({ ok: true, edit: patch([{ ...notch, segmentId: 'frontHem' }]) })
    expect(text(table, 'frontRaglanNotch', 'segment').commit('sleeveHem')).toEqual({ ok: false, message: "'sleeveHem' is not an edge of Front" })
  })

  it('adds a notch on the first edge with a fresh id, and removes one', () => {
    expect(table.add.edit).toEqual(patch([notch, { id: 'n1', segmentId: 'frontNeck', distance: '0' }]))
    expect(table.rows[0]?.remove).toEqual(patch([]))
  })

  it('puts a notch issue on its distance', () => {
    const broken = applyEdit(raglanTee, { kind: 'setPiece', pieceId: 'front', patch: { notches: [{ ...notch, distance: 'nope' }] } })
    const t = notchTable(broken, evaluate(broken, 'M'), broken.pieces[0] ?? front)
    expect(text(t, 'frontRaglanNotch', 'distance').issues.map((i) => i.kind)).toEqual(['undefined-reference'])
  })
})

describe('tablesFor', () => {
  it('gives one table for the other tabs', () => {
    expect(tablesFor('segment', raglanTee, resolved, null).map((t) => t.title)).toEqual(['Segments'])
    expect(tablesFor('variable', raglanTee, resolved, null).map((t) => t.title)).toEqual(['Variables'])
  })

  it('adds the edges and notches of the selected piece', () => {
    expect(tablesFor('piece', raglanTee, resolved, null).map((t) => t.title)).toEqual(['Pieces'])
    expect(tablesFor('piece', raglanTee, resolved, { kind: 'piece', id: 'front' }).map((t) => t.title)).toEqual(['Pieces', 'Edges of Front', 'Notches of Front'])
    expect(tablesFor('piece', raglanTee, resolved, { kind: 'piece', id: 'ghost' }).map((t) => t.title)).toEqual(['Pieces'])
    expect(tablesFor('piece', raglanTee, resolved, { kind: 'point', id: 'hps' }).map((t) => t.title)).toEqual(['Pieces'])
  })

  it('gives every row a key unique within its table', () => {
    const tables = tablesFor('piece', raglanTee, resolved, { kind: 'piece', id: 'front' })
    for (const table of tables) expect(new Set(table.rows.map((r) => r.id)).size).toBe(table.rows.length)
  })
})
