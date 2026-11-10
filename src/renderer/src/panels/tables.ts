import {
  UNIT_LABEL,
  applyEdit,
  checkName,
  checkSizeName,
  freshId,
  formatLength,
  toMm,
  newItem,
  newSizeName,
  sameItem,
  withoutOverride,
  type ItemKey,
  type ItemRef,
  type NamedItemKey,
  type Pattern,
  type PatternEdit,
  type Piece,
  type PiecePatch,
  type Segment,
  type ShownIssue,
  type SizeView
} from '@core'
import type { PanelKind, Selection } from '../editor/state'

/**
 * The editor panels as plain data, rendered by one EditableTable. Every per-kind decision
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
  readonly issues: readonly ShownIssue[]
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
  /** React key, unique within its table. Positional where a commit changes what identifies the row. */
  readonly id: string
  /** What selecting this row selects. Null when a row isn't an item, like a size. */
  readonly key: ItemKey | null
  readonly name: string
  readonly selected: boolean
  readonly cells: readonly Cell[]
  /** Null when it can't be removed, like the last size. */
  readonly remove: PatternEdit | null
}

export interface TableModel {
  /** Stable across renames, and different for each piece's tables, so a draft can't carry between them. */
  readonly id: string
  readonly kind: PanelKind
  readonly title: string
  readonly columns: readonly Column[]
  readonly rows: readonly Row[]
  /** Null when there's nothing valid to add yet. */
  readonly add: { readonly label: string; readonly edit: PatternEdit } | null
}

const column = (id: string, header: string, options: Partial<Pick<Column, 'numeric' | 'emphasis'>> = {}): Column => ({
  id,
  header,
  numeric: options.numeric ?? false,
  emphasis: options.emphasis ?? false
})

const issuesAbout = (view: SizeView, matches: (item: ItemRef) => boolean): ShownIssue[] => view.issues.filter((issue) => matches(issue.item))

const NAME_ISSUES = new Set<ShownIssue['kind']>(['invalid-name', 'duplicate-name', 'duplicate-id'])

function nameCell(pattern: Pattern, key: NamedItemKey, name: string, issues: readonly ShownIssue[]): TextCell {
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
      if (problem) return { ok: false, message: problem.message }
      const edit: PatternEdit = { kind: 'rename', item: key, to }
      // Core also refuses a rename it can't apply to every formula safely; say so instead of silently reverting.
      if (applyEdit(pattern, edit) === pattern) {
        return { ok: false, message: `Can't rename '${name}' to '${to}' without changing what a formula means` }
      }
      return { ok: true, edit }
    }
  }
}

/** First item per name: duplicates are reported by evaluate, and edits by name only reach the first. */
const firstByName = <T extends { name: string }>(items: readonly T[]): T[] => {
  const seen = new Set<string>()
  return items.filter((item) => !seen.has(item.name) && Boolean(seen.add(item.name)))
}

const isSelected = (selection: Selection | null, key: ItemKey): boolean => selection !== null && sameItem(selection, key)

export function measurementTable(pattern: Pattern, view: SizeView, selection: Selection | null): TableModel {
  const columns = [
    column('name', 'Name'),
    // The prefix keeps a size called 'name' from colliding with the name column.
    ...pattern.sizes.map((size) => column(`size:${size}`, size, { numeric: true, emphasis: size === view.size }))
  ]
  const rows = firstByName(pattern.measurements).map((measurement, index): Row => {
    const key: NamedItemKey = { kind: 'measurement', name: measurement.name }
    const issues = issuesAbout(view, (item) => item.kind === 'measurement' && item.name === measurement.name)
    const valueCells = pattern.sizes.map((size): TextCell => {
      const mm = measurement.values[size]
      const text = mm === undefined ? '' : formatLength(mm, pattern.units)
      return {
        kind: 'text',
        columnId: `size:${size}`,
        label: `${measurement.name} ${size}`,
        text,
        issues: issues.filter((issue) => issue.kind === 'missing-measurement-value' && issue.sizes.includes(size)),
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
      id: String(index),
      key,
      name: measurement.name,
      selected: isSelected(selection, key),
      cells: [nameCell(pattern, key, measurement.name, issues), ...valueCells],
      remove: { kind: 'remove', item: key }
    }
  })
  return { id: 'measurement', kind: 'measurement', title: `Measurements (${UNIT_LABEL[pattern.units]})`, columns, rows, add: { label: 'Add measurement', edit: { kind: 'add', item: newItem(pattern, 'measurement') } } }
}

export function variableTable(pattern: Pattern, view: SizeView, selection: Selection | null): TableModel {
  const columns = [column('name', 'Name'), column('formula', 'Formula'), column('value', `Value (${UNIT_LABEL[pattern.units]})`, { numeric: true })]
  const rows = firstByName(pattern.variables).map((variable, index): Row => {
    const key: NamedItemKey = { kind: 'variable', name: variable.name }
    const issues = issuesAbout(view, (item) => item.kind === 'variable' && item.name === variable.name)
    const value = view.resolved.variables[variable.name]
    return {
      id: String(index),
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
  return { id: 'variable', kind: 'variable', title: 'Variables', columns, rows, add: { label: 'Add variable', edit: { kind: 'add', item: newItem(pattern, 'variable') } } }
}

export function pointTable(pattern: Pattern, view: SizeView, selection: Selection | null): TableModel {
  const columns = [column('name', 'Name'), column('x', 'x'), column('y', 'y')]
  const seen = new Set<string>()
  const rows: Row[] = []
  for (const point of pattern.points) {
    // Rows are keyed by id; a duplicate id is reported as an issue on the first row.
    if (seen.has(point.id)) continue
    seen.add(point.id)
    const key: NamedItemKey = { kind: 'point', id: point.id }
    const issues = issuesAbout(view, (item) => (item.kind === 'point' || item.kind === 'pointCoord') && item.id === point.id)
    const axisCell = (axis: 'x' | 'y'): TextCell => ({
      kind: 'text',
      columnId: axis,
      label: `${point.name} ${axis}`,
      text: point[axis],
      issues: issues.filter(({ item }) => item.kind === 'pointCoord' && item.axis === axis),
      commit: (draft) =>
        draft === point[axis]
          ? { ok: true, edit: null }
          : { ok: true, edit: { kind: 'setFormula', owner: { kind: 'point', id: point.id, axis }, formula: draft } }
    })
    rows.push({
      id: point.id,
      key,
      name: point.name,
      selected: isSelected(selection, key),
      cells: [nameCell(pattern, key, point.name, issues), axisCell('x'), axisCell('y')],
      remove: { kind: 'remove', item: key }
    })
  }
  return { id: 'point', kind: 'point', title: 'Points', columns, rows, add: { label: 'Add point', edit: { kind: 'add', item: newItem(pattern, 'point') } } }
}

const pointLabel = (pattern: Pattern, id: string): string => pattern.points.find((point) => point.id === id)?.name ?? id

/** Reads a typed point name as an id, for the cells that show points by name. */
function commitPoint(pattern: Pattern, draft: string, current: string, edit: (id: string) => PatternEdit): CommitResult {
  const name = draft.trim()
  if (name === pointLabel(pattern, current)) return { ok: true, edit: null }
  const point = pattern.points.find((candidate) => candidate.name === name)
  return point ? { ok: true, edit: edit(point.id) } : { ok: false, message: `No point named '${name}'` }
}

function withSegmentKind(segment: Segment, kind: Segment['kind']): Segment {
  if (kind === segment.kind) return segment
  const { id, from, to } = segment
  return kind === 'line' ? { id, kind, from, to } : { id, kind, from, c1: from, c2: to, to }
}

export function segmentTable(pattern: Pattern, view: SizeView, selection: Selection | null): TableModel {
  const columns = [column('id', 'Id'), column('kind', 'Kind'), column('from', 'From'), column('c1', 'C1'), column('c2', 'C2'), column('to', 'To')]
  const seen = new Set<string>()
  const rows: Row[] = []
  for (const segment of pattern.segments) {
    if (seen.has(segment.id)) continue
    seen.add(segment.id)
    const key: ItemKey = { kind: 'segment', id: segment.id }
    const issues = issuesAbout(view, (item) => item.kind === 'segment' && item.id === segment.id)
    const pointCell = (columnId: string, current: string, update: (id: string) => Segment, cellIssues: readonly ShownIssue[] = []): TextCell => ({
      kind: 'text',
      columnId,
      label: `${segment.id} ${columnId}`,
      text: pointLabel(pattern, current),
      issues: cellIssues,
      commit: (draft) => commitPoint(pattern, draft, current, (id) => ({ kind: 'setSegment', segment: update(id) }))
    })
    const controls: readonly Cell[] =
      segment.kind === 'bezier'
        ? [pointCell('c1', segment.c1, (c1) => ({ ...segment, c1 })), pointCell('c2', segment.c2, (c2) => ({ ...segment, c2 }))]
        : ['c1', 'c2'].map((columnId): Cell => ({ kind: 'readout', columnId, label: `${segment.id} ${columnId}`, text: null }))
    rows.push({
      id: segment.id,
      key,
      name: segment.id,
      selected: isSelected(selection, key),
      cells: [
        { kind: 'readout', columnId: 'id', label: `${segment.id} id`, text: segment.id },
        {
          kind: 'text',
          columnId: 'kind',
          label: `${segment.id} kind`,
          text: segment.kind,
          issues: [],
          commit: (draft) => {
            const kind = draft.trim()
            if (kind !== 'line' && kind !== 'bezier') return { ok: false, message: `A segment is 'line' or 'bezier', not '${kind}'` }
            return { ok: true, edit: kind === segment.kind ? null : { kind: 'setSegment', segment: withSegmentKind(segment, kind) } }
          }
        },
        pointCell('from', segment.from, (from) => ({ ...segment, from }), issues),
        ...controls,
        pointCell('to', segment.to, (to) => ({ ...segment, to }))
      ],
      remove: { kind: 'remove', item: key }
    })
  }
  return { id: 'segment', kind: 'segment', title: 'Segments', columns, rows, add: { label: 'Add segment', edit: { kind: 'add', item: newItem(pattern, 'segment') } } }
}

const setPiece = (piece: Piece, patch: PiecePatch): PatternEdit => ({ kind: 'setPiece', pieceId: piece.id, patch })

/** A cell that replaces part of a piece. Committing the text unchanged is never an edit. */
function pieceCell(columnId: string, label: string, text: string, issues: readonly ShownIssue[], commit: (draft: string) => CommitResult): TextCell {
  return { kind: 'text', columnId, label, text, issues, commit: (draft) => (draft === text ? { ok: true, edit: null } : commit(draft)) }
}

/** Whether an issue about a piece is that one of the points it refers to failed. */
const failsOnPoint = (pattern: Pattern, issue: ShownIssue, id: string): boolean =>
  (issue.kind === 'missing-point' && issue.pointId === id) || (issue.kind === 'dependency-failed' && issue.dependency === pointLabel(pattern, id))

/** Which column of the piece table an issue about the piece belongs in. */
function pieceIssueColumn(pattern: Pattern, piece: Piece, issue: ShownIssue): 'grainFrom' | 'grainTo' | 'fold' | 'stackPoint' | 'name' {
  const [from, to] = piece.grainline
  if (issue.kind === 'invalid-fold-edge') return 'fold'
  if (issue.kind === 'degenerate-grainline' || failsOnPoint(pattern, issue, from)) return 'grainFrom'
  if (failsOnPoint(pattern, issue, to)) return 'grainTo'
  return piece.stackPoint !== undefined && failsOnPoint(pattern, issue, piece.stackPoint) ? 'stackPoint' : 'name'
}

const notAnEdge = (piece: Piece, segmentId: string): CommitResult => ({ ok: false, message: `'${segmentId}' is not an edge of ${piece.name}` })
const hasEdge = (piece: Piece, segmentId: string): boolean => piece.outline.some((edge) => edge.segmentId === segmentId)

export function pieceTable(pattern: Pattern, view: SizeView, selection: Selection | null): TableModel {
  const columns = [
    column('name', 'Name'),
    column('allowance', 'Allowance'),
    column('grainFrom', 'Grain from'),
    column('grainTo', 'Grain to'),
    column('fold', 'Fold'),
    column('stackPoint', 'Stack point'),
    column('cutCount', 'Cut count', { numeric: true })
  ]
  const seen = new Set<string>()
  const rows: Row[] = []
  for (const piece of pattern.pieces) {
    if (seen.has(piece.id)) continue
    seen.add(piece.id)
    const key: ItemKey = { kind: 'piece', id: piece.id }
    const pieceIssues = issuesAbout(view, (item) => item.kind === 'piece' && item.id === piece.id)
    const issuesIn = (columnId: ReturnType<typeof pieceIssueColumn>): ShownIssue[] => pieceIssues.filter((issue) => pieceIssueColumn(pattern, piece, issue) === columnId)
    const [grainFrom, grainTo] = piece.grainline
    const grainCell = (columnId: 'grainFrom' | 'grainTo', label: string, current: string, update: (id: string) => [string, string]): TextCell => ({
      kind: 'text',
      columnId,
      label: `${piece.name} ${label}`,
      text: pointLabel(pattern, current),
      issues: issuesIn(columnId),
      commit: (draft) => commitPoint(pattern, draft, current, (id) => setPiece(piece, { grainline: update(id) }))
    })
    rows.push({
      id: piece.id,
      key,
      name: piece.name,
      selected: isSelected(selection, key),
      cells: [
        pieceCell('name', `${piece.name} name`, piece.name, issuesIn('name'), (draft) => ({ ok: true, edit: setPiece(piece, { name: draft }) })),
        pieceCell(
          'allowance',
          `${piece.name} allowance`,
          piece.seamAllowance.default,
          issuesAbout(view, (item) => item.kind === 'seamAllowance' && item.pieceId === piece.id && item.segmentId === null),
          (draft) => ({ ok: true, edit: setPiece(piece, { seamAllowance: { ...piece.seamAllowance, default: draft } }) })
        ),
        grainCell('grainFrom', 'grain from', grainFrom, (id) => [id, grainTo]),
        grainCell('grainTo', 'grain to', grainTo, (id) => [grainFrom, id]),
        pieceCell('fold', `${piece.name} fold`, piece.fold ?? '', issuesIn('fold'), (draft) => {
          const segmentId = draft.trim()
          if (segmentId === '') return { ok: true, edit: setPiece(piece, { fold: null }) }
          return hasEdge(piece, segmentId) ? { ok: true, edit: setPiece(piece, { fold: segmentId }) } : notAnEdge(piece, segmentId)
        }),
        pieceCell(
          'stackPoint',
          `${piece.name} stack point`,
          piece.stackPoint === undefined ? '' : pointLabel(pattern, piece.stackPoint),
          // A stack point can share a point with the grainline, so a failure there is shown in both.
          pieceIssues.filter((issue) => piece.stackPoint !== undefined && failsOnPoint(pattern, issue, piece.stackPoint)),
          (draft) => {
            if (draft.trim() === '') return { ok: true, edit: setPiece(piece, { stackPoint: null }) }
            return commitPoint(pattern, draft, piece.stackPoint ?? '', (id) => setPiece(piece, { stackPoint: id }))
          }
        ),
        pieceCell('cutCount', `${piece.name} cut count`, String(piece.cutCount), [], (draft) => {
          const cutCount = Number(draft.trim())
          if (draft.trim() === '' || !Number.isInteger(cutCount) || cutCount < 1) return { ok: false, message: 'Cut count must be a whole number of 1 or more' }
          return { ok: true, edit: setPiece(piece, { cutCount }) }
        })
      ],
      remove: { kind: 'remove', item: key }
    })
  }
  return { id: 'piece', kind: 'piece', title: 'Pieces', columns, rows, add: { label: 'Add piece', edit: { kind: 'add', item: newItem(pattern, 'piece') } } }
}

export function edgeTable(pattern: Pattern, view: SizeView, piece: Piece): TableModel {
  const columns = [column('segment', 'Segment'), column('reversed', 'Reversed'), column('allowance', 'Allowance'), column('length', `Length (${UNIT_LABEL[pattern.units]})`, { numeric: true })]
  const key: ItemKey = { kind: 'piece', id: piece.id }
  const perEdge = piece.seamAllowance.perEdge ?? {}
  const rows = piece.outline.map((edge, index): Row => {
    const { segmentId } = edge
    const override = Object.hasOwn(perEdge, segmentId) ? perEdge[segmentId] : undefined
    const { segments } = view.resolved
    const length = Object.hasOwn(segments, segmentId) ? segments[segmentId]?.length : undefined
    return {
      id: String(index),
      key,
      name: segmentId,
      selected: false,
      cells: [
        pieceCell('segment', `${segmentId} segment`, segmentId, [], (draft) => {
          const to = draft.trim()
          if (!pattern.segments.some((segment) => segment.id === to)) return { ok: false, message: `No segment with id '${to}'` }
          if (hasEdge(piece, to)) return { ok: false, message: `'${to}' is already an edge of ${piece.name}` }
          return { ok: true, edit: { kind: 'retargetEdge', pieceId: piece.id, index, segmentId: to } }
        }),
        pieceCell('reversed', `${segmentId} reversed`, edge.reversed ? 'yes' : 'no', [], (draft) => {
          const answer = draft.trim()
          if (answer !== 'yes' && answer !== 'no') return { ok: false, message: "Reversed is 'yes' or 'no'" }
          if ((answer === 'yes') === (edge.reversed ?? false)) return { ok: true, edit: null }
          return { ok: true, edit: setPiece(piece, { outline: piece.outline.with(index, { ...edge, reversed: answer === 'yes' }) }) }
        }),
        pieceCell(
          'allowance',
          `${segmentId} allowance`,
          override ?? '',
          issuesAbout(view, (item) => item.kind === 'seamAllowance' && item.pieceId === piece.id && item.segmentId === segmentId),
          (draft) => {
            const seamAllowance = draft.trim() === '' ? withoutOverride(piece.seamAllowance, segmentId) : { ...piece.seamAllowance, perEdge: { ...perEdge, [segmentId]: draft } }
            return { ok: true, edit: setPiece(piece, { seamAllowance }) }
          }
        ),
        { kind: 'readout', columnId: 'length', label: `${segmentId} length`, text: length === undefined ? null : formatLength(length, pattern.units) }
      ],
      remove: { kind: 'removeEdge', pieceId: piece.id, index }
    }
  })
  const unused = pattern.segments.find((segment) => !hasEdge(piece, segment.id)) ?? pattern.segments[0]
  return {
    id: `edges:${piece.id}`,
    kind: 'piece',
    title: `Edges of ${piece.name}`,
    columns,
    rows,
    add: unused ? { label: 'Add edge', edit: setPiece(piece, { outline: [...piece.outline, { segmentId: unused.id }] }) } : null
  }
}

export function notchTable(pattern: Pattern, view: SizeView, piece: Piece): TableModel {
  const columns = [column('segment', 'Segment'), column('distance', 'Distance')]
  const key: ItemKey = { kind: 'piece', id: piece.id }
  const rows = piece.notches.map((notch, index): Row => {
    const setNotch = (next: Piece['notches'][number]): PatternEdit => setPiece(piece, { notches: piece.notches.with(index, next) })
    return {
      id: String(index),
      key,
      name: notch.id,
      selected: false,
      cells: [
        pieceCell('segment', `${notch.id} segment`, notch.segmentId, [], (draft) => {
          const segmentId = draft.trim()
          return hasEdge(piece, segmentId) ? { ok: true, edit: setNotch({ ...notch, segmentId }) } : notAnEdge(piece, segmentId)
        }),
        pieceCell(
          'distance',
          `${notch.id} distance`,
          notch.distance,
          issuesAbout(view, (item) => item.kind === 'notch' && item.pieceId === piece.id && item.id === notch.id),
          (draft) => ({ ok: true, edit: setNotch({ ...notch, distance: draft }) })
        )
      ],
      remove: setPiece(piece, { notches: piece.notches.toSpliced(index, 1) })
    }
  })
  // A notch has to sit on an edge, so a piece with no outline can't have one yet.
  const firstEdge = piece.outline[0]
  const add = firstEdge
    ? { label: 'Add notch', edit: setPiece(piece, { notches: [...piece.notches, { id: freshId('n', piece.notches).id, segmentId: firstEdge.segmentId, distance: '0' }] }) }
    : null
  return { id: `notches:${piece.id}`, kind: 'piece', title: `Notches of ${piece.name}`, columns, rows, add }
}

export function sizeTable(pattern: Pattern, view: SizeView): TableModel {
  const rows = pattern.sizes.map((size, index): Row => ({
    id: String(index),
    key: null,
    name: size,
    selected: size === view.size,
    cells: [
      {
        kind: 'text',
        columnId: 'name',
        label: `${size} name`,
        text: size,
        issues: [],
        commit: (draft) => {
          const to = draft.trim()
          if (to === size) return { ok: true, edit: null }
          const problem = checkSizeName(pattern, to, size)
          return problem ? { ok: false, message: problem.message } : { ok: true, edit: { kind: 'renameSize', from: size, to } }
        }
      }
    ],
    remove: pattern.sizes.length > 1 ? { kind: 'removeSize', name: size } : null
  }))
  return { id: 'size', kind: 'size', title: 'Sizes', columns: [column('name', 'Name')], rows, add: { label: 'Add size', edit: { kind: 'addSize', name: newSizeName(pattern), after: view.size } } }
}

/** The tables a tab shows. The Pieces tab grows the selected piece's edges and notches. */
export function tablesFor(kind: PanelKind, pattern: Pattern, view: SizeView, selection: Selection | null): readonly TableModel[] {
  switch (kind) {
    case 'measurement':
      return [measurementTable(pattern, view, selection)]
    case 'variable':
      return [variableTable(pattern, view, selection)]
    case 'point':
      return [pointTable(pattern, view, selection)]
    case 'segment':
      return [segmentTable(pattern, view, selection)]
    case 'size':
      return [sizeTable(pattern, view)]
    case 'piece': {
      const piece = selection?.kind === 'piece' ? pattern.pieces.find((candidate) => candidate.id === selection.id) : undefined
      const pieces = pieceTable(pattern, view, selection)
      return piece ? [pieces, edgeTable(pattern, view, piece), notchTable(pattern, view, piece)] : [pieces]
    }
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}
