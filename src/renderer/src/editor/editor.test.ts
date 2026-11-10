import { describe, expect, it } from 'vitest'
import { applyEdit, evaluate, type Pattern } from '@core'
import { raglanTee } from '@core/fixtures/raglan'
import { inspectPoint, pointRoles, selectionForIssue } from './inspect'
import { editorReducer, initEditorState } from './state'

const breakHps = (pattern: Pattern): Pattern =>
  applyEdit(pattern, { kind: 'setFormula', owner: { kind: 'point', id: 'hps', axis: 'x' }, formula: 'nope' })

describe('editorReducer', () => {
  const initial = initEditorState(raglanTee)

  it('selects by id and keeps the same state for the same selection', () => {
    const selected = editorReducer(initial, { type: 'select', selection: { kind: 'point', id: 'hps' } })
    expect(selected.selection).toEqual({ kind: 'point', id: 'hps' })
    expect(editorReducer(selected, { type: 'select', selection: { kind: 'point', id: 'hps' } })).toBe(selected)
    expect(editorReducer(selected, { type: 'select', selection: null }).selection).toBeNull()
  })

  it('applies edits and returns the same state for no-ops', () => {
    const edited = editorReducer(initial, { type: 'edit', edit: { kind: 'setFormula', owner: { kind: 'point', id: 'hps', axis: 'y' }, formula: '5' } })
    expect(edited.pattern.points[0]?.y).toBe('5')
    expect(editorReducer(edited, { type: 'edit', edit: { kind: 'setFormula', owner: { kind: 'point', id: 'hps', axis: 'y' }, formula: '5' } })).toBe(edited)
  })

  it('keeps a point selected after its formula breaks', () => {
    const selected = editorReducer(initial, { type: 'select', selection: { kind: 'point', id: 'hps' } })
    const broken = editorReducer(selected, { type: 'edit', edit: { kind: 'setFormula', owner: { kind: 'point', id: 'hps', axis: 'x' }, formula: 'nope' } })
    expect(broken.selection).toEqual({ kind: 'point', id: 'hps' })
  })
  it('switches the panel to the selected kind', () => {
    const selected = editorReducer(initial, { type: 'select', selection: { kind: 'variable', name: 'body_width' } })
    expect(selected.panel).toBe('variable')
    expect(editorReducer(selected, { type: 'showPanel', panel: 'point' }).panel).toBe('point')
  })

  it('selects added items, follows renames and clears on remove', () => {
    const added = editorReducer(initial, {
      type: 'edit',
      edit: { kind: 'add', item: { kind: 'variable', variable: { name: 'ease', formula: '5' } } }
    })
    expect(added.selection).toEqual({ kind: 'variable', name: 'ease' })
    const renamed = editorReducer(added, { type: 'edit', edit: { kind: 'rename', item: { kind: 'variable', name: 'ease' }, to: 'ease2' } })
    expect(renamed.selection).toEqual({ kind: 'variable', name: 'ease2' })
    const removed = editorReducer(renamed, { type: 'edit', edit: { kind: 'remove', item: { kind: 'variable', name: 'ease2' } } })
    expect(removed.selection).toBeNull()
  })
})

describe('pointRoles', () => {
  it('marks bezier controls as controls and every endpoint as an anchor', () => {
    const roles = pointRoles(raglanTee)
    expect(roles.get('hps')).toBe('anchor')
    expect(roles.get('neckC1')).toBe('control')
    expect(roles.get('raglanC2')).toBe('control')
    expect([...roles.values()].filter((role) => role === 'control')).toHaveLength(13)
  })
})

describe('inspectPoint', () => {
  it('shows formulas and values of a placed point', () => {
    const inspection = inspectPoint(raglanTee, evaluate(raglanTee, 'M'), 'underarm')
    expect(inspection).toEqual({
      id: 'underarm',
      name: 'Underarm',
      role: 'anchor',
      placed: true,
      axes: {
        x: { formula: 'body_width', value: 275, issues: [] },
        y: { formula: 'armhole_depth + 30', value: 250, issues: [] }
      },
      pointIssues: []
    })
  })

  it('shows formulas and issues of a point that failed to resolve', () => {
    const pattern = breakHps(raglanTee)
    const inspection = inspectPoint(pattern, evaluate(pattern, 'M'), 'hps')
    expect(inspection).toMatchObject({ placed: false, axes: { x: { formula: 'nope', value: null }, y: { formula: '0', value: null } } })
    expect(inspection?.axes.x.issues.map((issue) => issue.kind)).toEqual(['undefined-reference'])
  })

  it('returns null for an id no longer in the pattern', () => {
    expect(inspectPoint(raglanTee, evaluate(raglanTee, 'M'), 'ghost')).toBeNull()
  })
})

describe('selectionForIssue', () => {
  it('selects the item an issue is about', () => {
    const pattern = breakHps(raglanTee)
    const [first] = evaluate(pattern, 'M').issues
    if (!first) throw new Error('expected an issue')
    expect(selectionForIssue(first)).toEqual({ kind: 'point', id: 'hps' })
    expect(selectionForIssue({ kind: 'unknown-size', size: 'Q', message: '' })).toBeNull()
    expect(selectionForIssue({ kind: 'not-finite', item: { kind: 'variable', name: 'v' }, message: '' })).toEqual({ kind: 'variable', name: 'v' })
  })
})
