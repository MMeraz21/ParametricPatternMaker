import { describe, expect, it } from 'vitest'
import { applyEdit, evaluateGraded, viewAt, type Pattern } from '@core'
import { raglanTee } from '@core/fixtures/raglan'
import { inspectPoint, pointRoles, selectionForIssue } from './inspect'
import { documentStatus, editorReducer, initEditorState, isDirty } from './state'

const viewOf = (pattern: Pattern, size = 'M') => viewAt(evaluateGraded(pattern), size)

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

describe('editorReducer with segments and pieces', () => {
  const initial = initEditorState(raglanTee)

  it('opens the tab of a selected segment or piece', () => {
    expect(editorReducer(initial, { type: 'select', selection: { kind: 'segment', id: 'frontCf' } }).panel).toBe('segment')
    expect(editorReducer(initial, { type: 'select', selection: { kind: 'piece', id: 'front' } }).panel).toBe('piece')
  })

  it('selects an added piece, keeps it through edits and clears it on remove', () => {
    const piece = { id: 'x', name: 'X', outline: [], seamAllowance: { default: '10' }, notches: [], grainline: ['hps', 'cfNeck'] as [string, string], cutCount: 1 }
    const added = editorReducer(initial, { type: 'edit', edit: { kind: 'add', item: { kind: 'piece', piece } } })
    expect(added.selection).toEqual({ kind: 'piece', id: 'x' })
    const renamed = editorReducer(added, { type: 'edit', edit: { kind: 'setPiece', pieceId: 'x', patch: { name: 'Y' } } })
    expect(renamed.selection).toEqual({ kind: 'piece', id: 'x' })
    expect(editorReducer(renamed, { type: 'edit', edit: { kind: 'remove', item: { kind: 'piece', id: 'x' } } }).selection).toBeNull()
  })

  it('keeps the selection when a segment is edited', () => {
    const selected = editorReducer(initial, { type: 'select', selection: { kind: 'segment', id: 'frontCf' } })
    const edited = editorReducer(selected, { type: 'edit', edit: { kind: 'setSegment', segment: { id: 'frontCf', kind: 'line', from: 'hps', to: 'cfHem' } } })
    expect(edited.selection).toEqual({ kind: 'segment', id: 'frontCf' })
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
    const inspection = inspectPoint(raglanTee, viewOf(raglanTee), 'underarm')
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
    const inspection = inspectPoint(pattern, viewOf(pattern), 'hps')
    expect(inspection).toMatchObject({ placed: false, axes: { x: { formula: 'nope', value: null }, y: { formula: '0', value: null } } })
    expect(inspection?.axes.x.issues.map((issue) => issue.kind)).toEqual(['undefined-reference'])
  })

  it('returns null for an id no longer in the pattern', () => {
    expect(inspectPoint(raglanTee, viewOf(raglanTee), 'ghost')).toBeNull()
  })
})

describe('selectionForIssue', () => {
  it('selects the item an issue is about', () => {
    const pattern = breakHps(raglanTee)
    const [first] = viewOf(pattern).issues
    if (!first) throw new Error('expected an issue')
    expect(selectionForIssue(first)).toEqual({ kind: 'point', id: 'hps' })
    expect(selectionForIssue({ kind: 'not-finite', item: { kind: 'variable', name: 'v' }, message: '' })).toEqual({ kind: 'variable', name: 'v' })
  })

  it.each([
    [{ kind: 'piece', id: 'p', name: 'P' }, { kind: 'piece', id: 'p' }],
    [{ kind: 'notch', pieceId: 'p', id: 'n' }, { kind: 'piece', id: 'p' }],
    [{ kind: 'seamAllowance', pieceId: 'p', segmentId: 's' }, { kind: 'piece', id: 'p' }],
    [{ kind: 'seamAllowance', pieceId: 'p', segmentId: null }, { kind: 'piece', id: 'p' }],
    [{ kind: 'segment', id: 's' }, { kind: 'segment', id: 's' }]
  ] as const)('takes an issue on %o to its tab', (item, selection) => {
    expect(selectionForIssue({ kind: 'not-finite', item, message: '' })).toEqual(selection)
  })
})

describe('the size on screen', () => {
  const initial = initEditorState(raglanTee, 'M')

  it('opens at the first size unless told otherwise', () => {
    expect(initEditorState(raglanTee).wantedSize).toBe('S')
    expect(initial.wantedSize).toBe('M')
    expect(initial.nestShown).toBe(false)
  })

  it('switches size without touching the document, and repeats as a no-op', () => {
    const switched = editorReducer(initial, { type: 'showSize', size: 'XXL' })
    expect(switched.wantedSize).toBe('XXL')
    expect(switched.pattern).toBe(initial.pattern)
    expect(editorReducer(switched, { type: 'showSize', size: 'XXL' })).toBe(switched)
  })

  it('toggles the nest without touching the document', () => {
    const on = editorReducer(initial, { type: 'showNest', shown: true })
    expect(on.nestShown).toBe(true)
    expect(on.pattern).toBe(initial.pattern)
    expect(editorReducer(on, { type: 'showNest', shown: true })).toBe(on)
  })

  it('shows a new size', () => {
    expect(editorReducer(initial, { type: 'edit', edit: { kind: 'addSize', name: 'M2', after: 'M' } }).wantedSize).toBe('M2')
  })

  it('stays on the size when a refused edit changes nothing', () => {
    expect(editorReducer(initial, { type: 'edit', edit: { kind: 'addSize', name: 'xl', after: 'M' } })).toBe(initial)
  })

  it('follows a rename of the size on screen, and ignores others', () => {
    expect(editorReducer(initial, { type: 'edit', edit: { kind: 'renameSize', from: 'M', to: 'Medium' } }).wantedSize).toBe('Medium')
    expect(editorReducer(initial, { type: 'edit', edit: { kind: 'renameSize', from: 'L', to: 'Large' } }).wantedSize).toBe('M')
  })

  it('moves to the next size when the one on screen is removed, or the previous at the end', () => {
    expect(editorReducer(initial, { type: 'edit', edit: { kind: 'removeSize', name: 'M' } }).wantedSize).toBe('L')
    const last = initEditorState(raglanTee, 'XXL')
    expect(editorReducer(last, { type: 'edit', edit: { kind: 'removeSize', name: 'XXL' } }).wantedSize).toBe('XL')
    expect(editorReducer(initial, { type: 'edit', edit: { kind: 'removeSize', name: 'S' } }).wantedSize).toBe('M')
  })

  it('stays on the Sizes tab when a size edit happens with an item selected', () => {
    const selected = editorReducer(initial, { type: 'select', selection: { kind: 'variable', name: 'body_width' } })
    const onSizes = editorReducer(selected, { type: 'showPanel', panel: 'size' })
    const renamed = editorReducer(onSizes, { type: 'edit', edit: { kind: 'renameSize', from: 'L', to: 'Large' } })
    expect(renamed.panel).toBe('size')
    expect(renamed.selection).toEqual({ kind: 'variable', name: 'body_width' })
  })

  it('can select and switch size in one step, and keeps the size when none is given', () => {
    const opened = editorReducer(initial, { type: 'select', selection: { kind: 'piece', id: 'neckband' }, size: 'XXL' })
    expect(opened).toMatchObject({ selection: { kind: 'piece', id: 'neckband' }, wantedSize: 'XXL', panel: 'piece' })
    expect(editorReducer(opened, { type: 'select', selection: null }).wantedSize).toBe('XXL')
  })
})

describe('the saved document', () => {
  const file = { path: '/home/me/Raglan.json', name: 'Raglan' }
  const edit = { type: 'edit', edit: { kind: 'setFormula', owner: { kind: 'variable', name: 'chest_ease' }, formula: '120' } } as const

  it('starts saved, and an edit makes it unsaved', () => {
    const initial = initEditorState(raglanTee, 'M', file)
    expect(isDirty(initial)).toBe(false)
    expect(documentStatus(initial)).toEqual({ name: 'Raglan', path: file.path, dirty: false })
    expect(isDirty(editorReducer(initial, edit))).toBe(true)
  })

  it('stays saved through an edit that changes nothing', () => {
    const initial = initEditorState(raglanTee)
    expect(isDirty(editorReducer(initial, { type: 'edit', edit: { ...edit.edit, formula: '100' } }))).toBe(false)
  })

  it('reads as saved when the pattern goes back to the saved one, which is what undo will do', () => {
    const edited = editorReducer(initEditorState(raglanTee), edit)
    expect(isDirty({ ...edited, pattern: edited.saved })).toBe(false)
  })

  it('keeps a newer edit unsaved when an older pattern is the one saved', () => {
    const initial = initEditorState(raglanTee, 'M')
    const first = editorReducer(initial, edit)
    const second = editorReducer(first, { type: 'edit', edit: { ...edit.edit, formula: '130' } })
    const saved = editorReducer(second, { type: 'saved', pattern: first.pattern, file })
    expect(isDirty(saved)).toBe(true)
    expect(saved).toMatchObject({ pattern: second.pattern, file, wantedSize: 'M', selection: second.selection })
  })

  it('starts over on replace: selection, panel and size reset, saved, with the notice given', () => {
    const busy = editorReducer(editorReducer(initEditorState(raglanTee, 'XL'), edit), { type: 'select', selection: { kind: 'point', id: 'hps' } })
    const notice = { tone: 'info', text: 'Upgraded.' } as const
    const replaced = editorReducer(busy, { type: 'replace', pattern: raglanTee, file, notice })
    expect(replaced).toEqual({ ...initEditorState(raglanTee, undefined, file), notice })
    expect(isDirty(replaced)).toBe(false)
  })
})
