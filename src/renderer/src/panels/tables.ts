import {
  UNIT_LABEL,
  checkName,
  formatLength,
  toMm,
  newItem,
  sameItem,
  type EvaluationIssue,
  type ItemKey,
  type ItemKind,
  type ItemRef,
  type Pattern,
  type PatternEdit,
  type ResolvedPattern
} from '@core'
import type { Selection } from '../editor/state'

/**
 * The three editor panels as plain data, rendered by one EditableTable. Every per-kind decision
 * (columns, labels, validation, which edit a cell produces) lives here, where vitest can see it.
 */

export interface Column {
  readonly id: string
  readonly header: string
  readonly numeric: boolean
  /** Highlighted, e.g. the active size. */
  readonly emphasis: boolean
}

/** Rejections keep the draft and show the message; they never reach the reducer. */
export type CommitResult = { readonly ok: true; readonly edit: PatternEdit | null } | { readonly ok: false; readonly message: string }

export interface TextCell {
  readonly kind: 'text'
  readonly columnId: string
  /** Accessible name, '<row> <column>', e.g. 'chest M'. */
  readonly label: string
  readonly text: string
  readonly issues: readonly EvaluationIssue[]
  readonly commit: (draft: string) => CommitResult
}

export interface ReadoutCell {
  readonly kind: 'readout'
  readonly columnId: string
  readonly label: string
  /** Null when the item did not resolve. */
  readonly text: string | null
}

export type Cell = TextCell | ReadoutCell

export interface Row {
  readonly key: ItemKey
  readonly name: string
  readonly selected: boolean
  readonly cells: readonly Cell[]
  readonly remove: PatternEdit
}

export interface TableModel {
  readonly kind: ItemKind
  readonly title: string
  readonly columns: readonly Column[]
  readonly rows: readonly Row[]
  readonly add: { readonly label: string; readonly edit: PatternEdit }
}

const column = (id: string, header: string, options: Partial<Pick<Column, 'numeric' | 'emphasis'>> = {}): Column => ({
  id,
  header,
  numeric: options.numeric ?? false,
  emphasis: options.emphasis ?? false
})

const issuesAbout = (resolved: ResolvedPattern, matches: (item: ItemRef) => boolean): EvaluationIssue[] =>
  resolved.issues.filter((issue) => issue.kind !== 'unknown-size' && matches(issue.item))

const NAME_ISSUES = new Set<EvaluationIssue['kind']>(['invalid-name', 'duplicate-name', 'duplicate-id'])

function nameCell(pattern: Pattern, key: ItemKey, name: string, issues: readonly EvaluationIssue[]): TextCell {
  return {
    kind: 'text',
    columnId: 'name',
    label: `${name} name`,
    text: name,
    issues: issues.filter((issue) => NAME_ISSUES.has(issue.kind)),
    commit: (draft) => {
      const to = draft.trim()
      if (to === name) return { ok: true, edit: null }
      const problem = checkName(pattern, to, key)
      return problem ? { ok: false, message: problem.message } : { ok: true, edit: { kind: 'rename', item: key, to } }
    }
  }
}

const isSelected = (selection: Selection | null, key: ItemKey): boolean => selection !== null && sameItem(selection, key)

export function measurementTable(pattern: Pattern, resolved: ResolvedPattern, selection: Selection | null): TableModel {
  const columns = [
    column('name', 'Name'),
    ...pattern.sizes.map((size) => column(size, size, { numeric: true, emphasis: size === pattern.activeSize }))
  ]
  const rows = pattern.measurements.map((measurement): Row => {
    const key: ItemKey = { kind: 'measurement', name: measurement.name }
    const issues = issuesAbout(resolved, (item) => item.kind === 'measurement' && item.name === measurement.name)
    const valueCells = pattern.sizes.map((size): TextCell => {
      const mm = measurement.values[size]
      const text = mm === undefined ? '' : formatLength(mm, pattern.units)
      return {
        kind: 'text',
        columnId: size,
        label: `${measurement.name} ${size}`,
        text,
        // missing-measurement-value is reported for the active size only.
        issues: size === pattern.activeSize ? issues.filter((issue) => issue.kind === 'missing-measurement-value') : [],
        commit: (draft) => {
          // Typed in display units. Committing the displayed (rounded) text unchanged keeps the exact mm.
          if (draft.trim() === text) return { ok: true, edit: null }
          const value = Number(draft.trim())
          if (draft.trim() === '' || !Number.isFinite(value)) return { ok: false, message: `'${draft}' is not a number` }
          return { ok: true, edit: { kind: 'setMeasurement', name: measurement.name, size, value: toMm(value, pattern.units) } }
        }
      }
    })
    return {
      key,
      name: measurement.name,
      selected: isSelected(selection, key),
      cells: [nameCell(pattern, key, measurement.name, issues), ...valueCells],
      remove: { kind: 'remove', item: key }
    }
  })
  return { kind: 'measurement', title: `Measurements (${UNIT_LABEL[pattern.units]})`, columns, rows, add: { label: 'Add measurement', edit: { kind: 'add', item: newItem(pattern, 'measurement') } } }
}

export function variableTable(pattern: Pattern, resolved: ResolvedPattern, selection: Selection | null): TableModel {
  const columns = [column('name', 'Name'), column('formula', 'Formula'), column('value', `Value (${UNIT_LABEL[pattern.units]})`, { numeric: true })]
  const rows = pattern.variables.map((variable): Row => {
    const key: ItemKey = { kind: 'variable', name: variable.name }
    const issues = issuesAbout(resolved, (item) => item.kind === 'variable' && item.name === variable.name)
    const value = resolved.variables[variable.name]
    return {
      key,
      name: variable.name,
      selected: isSelected(selection, key),
      cells: [
        nameCell(pattern, key, variable.name, issues),
        {
          kind: 'text',
          columnId: 'formula',
          label: `${variable.name} formula`,
          text: variable.formula,
          issues: issues.filter((issue) => !NAME_ISSUES.has(issue.kind)),
          commit: (draft) =>
            draft === variable.formula
              ? { ok: true, edit: null }
              : { ok: true, edit: { kind: 'setFormula', owner: { kind: 'variable', name: variable.name }, formula: draft } }
        },
        { kind: 'readout', columnId: 'value', label: `${variable.name} value`, text: value === undefined ? null : formatLength(value, pattern.units) }
      ],
      remove: { kind: 'remove', item: key }
    }
  })
  return { kind: 'variable', title: 'Variables', columns, rows, add: { label: 'Add variable', edit: { kind: 'add', item: newItem(pattern, 'variable') } } }
}

export function pointTable(pattern: Pattern, resolved: ResolvedPattern, selection: Selection | null): TableModel {
  const columns = [column('name', 'Name'), column('x', 'x'), column('y', 'y')]
  const seen = new Set<string>()
  const rows: Row[] = []
  for (const point of pattern.points) {
    // Rows are keyed by id; a duplicate id is reported as an issue on the first row.
    if (seen.has(point.id)) continue
    seen.add(point.id)
    const key: ItemKey = { kind: 'point', id: point.id }
    const issues = issuesAbout(resolved, (item) => (item.kind === 'point' || item.kind === 'pointCoord') && item.id === point.id)
    const axisCell = (axis: 'x' | 'y'): TextCell => ({
      kind: 'text',
      columnId: axis,
      label: `${point.name} ${axis}`,
      text: point[axis],
      issues: issues.filter((issue) => issue.kind !== 'unknown-size' && issue.item.kind === 'pointCoord' && issue.item.axis === axis),
      commit: (draft) =>
        draft === point[axis]
          ? { ok: true, edit: null }
          : { ok: true, edit: { kind: 'setFormula', owner: { kind: 'point', id: point.id, axis }, formula: draft } }
    })
    rows.push({
      key,
      name: point.name,
      selected: isSelected(selection, key),
      cells: [nameCell(pattern, key, point.name, issues), axisCell('x'), axisCell('y')],
      remove: { kind: 'remove', item: key }
    })
  }
  return { kind: 'point', title: 'Points', columns, rows, add: { label: 'Add point', edit: { kind: 'add', item: newItem(pattern, 'point') } } }
}

export function tableFor(kind: ItemKind, pattern: Pattern, resolved: ResolvedPattern, selection: Selection | null): TableModel {
  switch (kind) {
    case 'measurement':
      return measurementTable(pattern, resolved, selection)
    case 'variable':
      return variableTable(pattern, resolved, selection)
    case 'point':
      return pointTable(pattern, resolved, selection)
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}
