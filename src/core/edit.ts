import { isValidName, renameReferences, type Axis } from './formula'
import { isSizeName, visitPieceFormulas, type DisplayUnits, type Id, type Measurement, type Pattern, type Piece, type Point, type SeamAllowance, type Segment, type SizeName, type Variable } from './model'

/**
 * Pattern edits: the one way anything changes a Pattern (panels, inspector, undo and MCP later).
 *
 * `applyEdit` never mutates its input and shares everything it doesn't touch. A no-op or refused edit
 * returns the same reference, so `next === pattern` means "nothing changed". Bad formula text is a legal
 * edit (evaluate reports it); what is refused is anything that would lose information: an invalid or
 * taken name, a duplicate id, a non-finite measurement, a cut count that isn't a positive whole number. Edits carry every choice (ids, names), so
 * replaying one against the same pattern gives the same result.
 */

/** Identity of an item with a name formulas can use. Measurements and variables have no id, so their name is their key. */
export type NamedItemKey =
  | { readonly kind: 'measurement'; readonly name: string }
  | { readonly kind: 'variable'; readonly name: string }
  | { readonly kind: 'point'; readonly id: Id }

export type ItemKey = NamedItemKey | { readonly kind: 'segment'; readonly id: Id } | { readonly kind: 'piece'; readonly id: Id }

export type ItemKind = ItemKey['kind']

/** A complete item to append. */
export type NewItem =
  | { readonly kind: 'measurement'; readonly measurement: Measurement }
  | { readonly kind: 'variable'; readonly variable: Variable }
  | { readonly kind: 'point'; readonly point: Point }
  | { readonly kind: 'segment'; readonly segment: Segment }
  | { readonly kind: 'piece'; readonly piece: Piece }

/** A piece's fields to replace. A `fold` of null clears it; setting one deletes that edge's override. */
export type PiecePatch = Partial<Pick<Piece, 'name' | 'outline' | 'seamAllowance' | 'notches' | 'grainline' | 'cutCount'>> & { readonly fold?: Id | null; readonly stackPoint?: Id | null }

export type FormulaOwner =
  | { readonly kind: 'variable'; readonly name: string }
  | { readonly kind: 'point'; readonly id: Id; readonly axis: Axis }

export type PatternEdit =
  | { readonly kind: 'add'; readonly item: NewItem }
  /** Doesn't cascade: references to the item become issues that evaluate reports. */
  | { readonly kind: 'remove'; readonly item: ItemKey }
  /** Renames the item and rewrites every formula that refers to it, keeping the user's text. */
  | { readonly kind: 'rename'; readonly item: NamedItemKey; readonly to: string }
  | { readonly kind: 'setFormula'; readonly owner: FormulaOwner; readonly formula: string }
  | { readonly kind: 'setMeasurement'; readonly name: string; readonly size: SizeName; readonly value: number }
  | { readonly kind: 'setUnits'; readonly units: DisplayUnits }
  /** Replaces the segment with this id. Refused if there isn't one. */
  | { readonly kind: 'setSegment'; readonly segment: Segment }
  | { readonly kind: 'setPiece'; readonly pieceId: Id; readonly patch: PiecePatch }
  /** Points an outline edge at another segment. Its override, the fold and its notches go with it. */
  | { readonly kind: 'retargetEdge'; readonly pieceId: Id; readonly index: number; readonly segmentId: Id }
  /** Removes an outline edge, with its override, the fold if it was the fold, and its notches. */
  | { readonly kind: 'removeEdge'; readonly pieceId: Id; readonly index: number }
  /** Inserts after `after`, copying its value for every measurement that has one. Refused on a bad or taken name, or an unknown `after`. */
  | { readonly kind: 'addSize'; readonly name: SizeName; readonly after: SizeName }
  /** Deletes the column and each measurement's value for it. Refused for the last size or an unknown size. */
  | { readonly kind: 'removeSize'; readonly name: SizeName }
  /** Renames in `sizes` and every `values` key. Formulas never name a size. */
  | { readonly kind: 'renameSize'; readonly from: SizeName; readonly to: SizeName }

/** Why a name can't be used. Messages are ready to show. */
export type NameProblem = { readonly kind: 'invalid' | 'taken'; readonly message: string }

const identity = (key: ItemKey): string => ('name' in key ? key.name : key.id)

export const sameItem = (a: ItemKey, b: ItemKey): boolean => a.kind === b.kind && identity(a) === identity(b)

/** Measurements, variables and points share one namespace. */
function nameOwner(pattern: Pattern, name: string): NamedItemKey | undefined {
  if (pattern.measurements.some((m) => m.name === name)) return { kind: 'measurement', name }
  if (pattern.variables.some((v) => v.name === name)) return { kind: 'variable', name }
  const point = pattern.points.find((p) => p.name === name)
  return point && { kind: 'point', id: point.id }
}

/**
 * The single name check for adding and renaming. `except` is the item being renamed, so keeping its
 * own name is fine. The UI calls it to show a message; applyEdit calls it again, so they can't disagree.
 */
export function checkName(pattern: Pattern, name: string, except?: ItemKey): NameProblem | null {
  if (!isValidName(name)) {
    return {
      kind: 'invalid',
      message: `'${name}' is not a valid name: use letters, digits and _, not starting with a digit or using a built-in word`
    }
  }
  const owner = nameOwner(pattern, name)
  if (owner && !(except && sameItem(owner, except))) return { kind: 'taken', message: `'${name}' is already used by a ${owner.kind}` }
  return null
}

/** The single size-name rule. `except` is the size being renamed. The UI shows the message; applyEdit calls it again. */
export function checkSizeName(pattern: Pattern, name: string, except?: SizeName): NameProblem | null {
  if (!isSizeName(name)) return { kind: 'invalid', message: `'${name}' can't be a size name: it can't be empty, have spaces at either end, or be a word programs reserve` }
  const taken = pattern.sizes.find((size) => size !== except && size.toLowerCase() === name.toLowerCase())
  return taken === undefined ? null : { kind: 'taken', message: `There is already a size named '${taken}'` }
}

/** The smallest unused `Size <N>`. Deterministic, so the edit carries the name. */
export function newSizeName(pattern: Pattern): SizeName {
  let n = 1
  while (checkSizeName(pattern, `Size ${n}`)) n++
  return `Size ${n}`
}

function uniqueName(pattern: Pattern, base: string): string {
  let n = 1
  while (nameOwner(pattern, `${base}_${n}`)) n++
  return `${base}_${n}`
}

/** The smallest `<prefix><N>` not in `taken`. */
export function freshId(prefix: string, taken: readonly { id: Id }[]): { id: Id; n: number } {
  const ids = new Set(taken.map((item) => item.id))
  let n = 1
  while (ids.has(`${prefix}${n}`)) n++
  return { id: `${prefix}${n}`, n }
}

/**
 * A new item with a unique name (`variable_1`, `P_2`, ...) or a fresh id (`p<N>`, `s<N>`, `piece<N>`).
 * Deterministic, so the caller knows its key before dispatching and can select the new row.
 */
export function newItem(pattern: Pattern, kind: ItemKind): NewItem {
  // New segments and grainlines start on the first two points, ready to be retyped.
  const firstPoint = pattern.points[0]?.id ?? 'p1'
  const secondPoint = pattern.points[1]?.id ?? firstPoint
  switch (kind) {
    case 'measurement':
      return { kind, measurement: { name: uniqueName(pattern, 'measurement'), values: Object.fromEntries(pattern.sizes.map((size) => [size, 0])) } }
    case 'variable':
      return { kind, variable: { name: uniqueName(pattern, 'variable'), formula: '0' } }
    case 'point':
      return { kind, point: { id: freshId('p', pattern.points).id, name: uniqueName(pattern, 'P'), x: '0', y: '0' } }
    case 'segment':
      return { kind, segment: { id: freshId('s', pattern.segments).id, kind: 'line', from: firstPoint, to: secondPoint } }
    case 'piece': {
      const { id, n } = freshId('piece', pattern.pieces)
      return { kind, piece: { id, name: `Piece ${n}`, outline: [], seamAllowance: { default: '10' }, notches: [], grainline: [firstPoint, secondPoint], cutCount: 1 } }
    }
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

/** The key of an item being added. */
export function keyOf(item: NewItem): ItemKey {
  switch (item.kind) {
    case 'measurement':
      return { kind: 'measurement', name: item.measurement.name }
    case 'variable':
      return { kind: 'variable', name: item.variable.name }
    case 'point':
      return { kind: 'point', id: item.point.id }
    case 'segment':
      return { kind: 'segment', id: item.segment.id }
    case 'piece':
      return { kind: 'piece', id: item.piece.id }
    default: {
      const _exhaustive: never = item
      return _exhaustive
    }
  }
}

/** Replace the first element matching `match`; same array when nothing matches or nothing changes. */
function replaceFirst<T>(items: T[], match: (item: T) => boolean, update: (item: T) => T): T[] | undefined {
  const index = items.findIndex(match)
  const current = items[index]
  if (current === undefined) return undefined
  const next = update(current)
  return next === current ? undefined : items.with(index, next)
}

export function applyEdit(pattern: Pattern, edit: PatternEdit): Pattern {
  switch (edit.kind) {
    case 'add':
      return add(pattern, edit.item)
    case 'remove':
      return remove(pattern, edit.item)
    case 'rename':
      return rename(pattern, edit.item, edit.to)
    case 'setFormula':
      return setFormula(pattern, edit.owner, edit.formula)
    case 'setMeasurement': {
      if (!Number.isFinite(edit.value) || !pattern.sizes.includes(edit.size)) return pattern
      const measurements = replaceFirst(
        pattern.measurements,
        (m) => m.name === edit.name,
        (m) => (m.values[edit.size] === edit.value ? m : { ...m, values: { ...m.values, [edit.size]: edit.value } })
      )
      return measurements ? { ...pattern, measurements } : pattern
    }
    case 'setUnits':
      return pattern.units === edit.units ? pattern : { ...pattern, units: edit.units }
    case 'setSegment': {
      const segments = replaceFirst(
        pattern.segments,
        (s) => s.id === edit.segment.id,
        (s) => (unchanged(s, edit.segment) ? s : edit.segment)
      )
      return segments ? { ...pattern, segments } : pattern
    }
    case 'setPiece': {
      const { cutCount } = edit.patch
      if (cutCount !== undefined && !(Number.isInteger(cutCount) && cutCount > 0)) return pattern
      return updatePiece(pattern, edit.pieceId, (piece) => patchPiece(piece, edit.patch))
    }
    case 'retargetEdge':
      return updatePiece(pattern, edit.pieceId, (piece) => retargetEdge(piece, edit.index, edit.segmentId))
    case 'removeEdge':
      return updatePiece(pattern, edit.pieceId, (piece) => removeEdge(piece, edit.index))
    case 'addSize':
      return addSize(pattern, edit.name, edit.after)
    case 'removeSize':
      return removeSize(pattern, edit.name)
    case 'renameSize':
      return renameSize(pattern, edit.from, edit.to)
    default: {
      const _exhaustive: never = edit
      return _exhaustive
    }
  }
}

function updatePiece(pattern: Pattern, pieceId: Id, update: (piece: Piece) => Piece): Pattern {
  const pieces = replaceFirst(pattern.pieces, (piece) => piece.id === pieceId, update)
  return pieces ? { ...pattern, pieces } : pattern
}

const unchanged = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** The allowance with one edge's override removed. An empty `perEdge` collapses to just the default. */
export function withoutOverride(seamAllowance: SeamAllowance, segmentId: Id): SeamAllowance {
  const { default: width, perEdge = {} } = seamAllowance
  const others = Object.entries(perEdge).filter(([id]) => id !== segmentId)
  return others.length > 0 ? { default: width, perEdge: Object.fromEntries(others) } : { default: width }
}

function retargetEdge(piece: Piece, index: number, to: Id): Piece {
  const edge = piece.outline[index]
  if (!edge || piece.outline.some(({ segmentId }) => segmentId === to)) return piece
  const from = edge.segmentId
  const { perEdge } = piece.seamAllowance
  const override = perEdge && Object.hasOwn(perEdge, from) ? perEdge[from] : undefined
  const remaining = withoutOverride(withoutOverride(piece.seamAllowance, from), to)
  return {
    ...piece,
    outline: piece.outline.with(index, { ...edge, segmentId: to }),
    seamAllowance: override === undefined ? piece.seamAllowance : { default: remaining.default, perEdge: { ...remaining.perEdge, [to]: override } },
    notches: piece.notches.map((notch) => (notch.segmentId === from ? { ...notch, segmentId: to } : notch)),
    ...(piece.fold === from ? { fold: to } : {})
  }
}

function removeEdge(piece: Piece, index: number): Piece {
  const edge = piece.outline[index]
  if (!edge) return piece
  const { segmentId } = edge
  return patchPiece(piece, {
    outline: piece.outline.toSpliced(index, 1),
    seamAllowance: withoutOverride(piece.seamAllowance, segmentId),
    notches: piece.notches.filter((notch) => notch.segmentId !== segmentId),
    ...(piece.fold === segmentId ? { fold: null } : {})
  })
}

function patchPiece(piece: Piece, { fold, stackPoint, ...fields }: PiecePatch): Piece {
  const patched: Piece = { ...piece, ...fields }
  let next = patched
  if (stackPoint === null) {
    const { stackPoint: _cleared, ...rest } = next
    next = rest
  } else if (stackPoint !== undefined) {
    next = { ...next, stackPoint }
  }
  if (fold === null) {
    const { fold: _cleared, ...rest } = next
    next = rest
  } else if (fold !== undefined) {
    next = { ...next, seamAllowance: withoutOverride(next.seamAllowance, fold), fold }
  }
  return unchanged(next, piece) ? piece : next
}

function addSize(pattern: Pattern, name: SizeName, after: SizeName): Pattern {
  const index = pattern.sizes.indexOf(after)
  if (index === -1 || checkSizeName(pattern, name)) return pattern
  const [first, ...rest] = pattern.sizes.toSpliced(index + 1, 0, name)
  if (first === undefined) return pattern
  const measurements = pattern.measurements.map((measurement) => {
    const value = measurement.values[after]
    // Dropping a leftover key first, so a measurement with nothing to copy stays without a value.
    const others = Object.entries(measurement.values).filter(([size]) => size !== name)
    return { ...measurement, values: Object.fromEntries(value === undefined ? others : [...others, [name, value]]) }
  })
  return { ...pattern, sizes: [first, ...rest], measurements }
}

function removeSize(pattern: Pattern, name: SizeName): Pattern {
  const [first, ...rest] = pattern.sizes.filter((size) => size !== name)
  if (first === undefined || rest.length + 1 === pattern.sizes.length) return pattern
  const measurements = pattern.measurements.map((measurement) => ({
    ...measurement,
    values: Object.fromEntries(Object.entries(measurement.values).filter(([size]) => size !== name))
  }))
  return { ...pattern, sizes: [first, ...rest], measurements }
}

function renameSize(pattern: Pattern, from: SizeName, to: SizeName): Pattern {
  if (from === to || !pattern.sizes.includes(from) || checkSizeName(pattern, to, from)) return pattern
  const [first, ...rest] = pattern.sizes.map((size) => (size === from ? to : size))
  if (first === undefined) return pattern
  const measurements = pattern.measurements.map((measurement) => ({
    ...measurement,
    values: Object.fromEntries(
      Object.entries(measurement.values)
        .filter(([size]) => size !== to)
        .map(([size, value]) => [size === from ? to : size, value])
    )
  }))
  return { ...pattern, sizes: [first, ...rest], measurements }
}

function add(pattern: Pattern, item: NewItem): Pattern {
  switch (item.kind) {
    case 'measurement': {
      const { measurement } = item
      if (checkName(pattern, measurement.name) || !Object.values(measurement.values).every(Number.isFinite)) return pattern
      return { ...pattern, measurements: [...pattern.measurements, measurement] }
    }
    case 'variable':
      if (checkName(pattern, item.variable.name)) return pattern
      return { ...pattern, variables: [...pattern.variables, item.variable] }
    case 'point': {
      const { point } = item
      if (checkName(pattern, point.name) || pattern.points.some((p) => p.id === point.id)) return pattern
      return { ...pattern, points: [...pattern.points, point] }
    }
    case 'segment':
      return pattern.segments.some((s) => s.id === item.segment.id) ? pattern : { ...pattern, segments: [...pattern.segments, item.segment] }
    case 'piece':
      return pattern.pieces.some((p) => p.id === item.piece.id) ? pattern : { ...pattern, pieces: [...pattern.pieces, item.piece] }
    default: {
      const _exhaustive: never = item
      return _exhaustive
    }
  }
}

function remove(pattern: Pattern, item: ItemKey): Pattern {
  switch (item.kind) {
    case 'measurement': {
      const index = pattern.measurements.findIndex((m) => m.name === item.name)
      return index === -1 ? pattern : { ...pattern, measurements: pattern.measurements.toSpliced(index, 1) }
    }
    case 'variable': {
      const index = pattern.variables.findIndex((v) => v.name === item.name)
      return index === -1 ? pattern : { ...pattern, variables: pattern.variables.toSpliced(index, 1) }
    }
    case 'point': {
      const index = pattern.points.findIndex((p) => p.id === item.id)
      return index === -1 ? pattern : { ...pattern, points: pattern.points.toSpliced(index, 1) }
    }
    case 'segment': {
      const index = pattern.segments.findIndex((s) => s.id === item.id)
      return index === -1 ? pattern : { ...pattern, segments: pattern.segments.toSpliced(index, 1) }
    }
    case 'piece': {
      const index = pattern.pieces.findIndex((p) => p.id === item.id)
      return index === -1 ? pattern : { ...pattern, pieces: pattern.pieces.toSpliced(index, 1) }
    }
    default: {
      const _exhaustive: never = item
      return _exhaustive
    }
  }
}

function currentName(pattern: Pattern, item: NamedItemKey): string | undefined {
  switch (item.kind) {
    case 'measurement':
      return pattern.measurements.find((m) => m.name === item.name)?.name
    case 'variable':
      return pattern.variables.find((v) => v.name === item.name)?.name
    case 'point':
      return pattern.points.find((p) => p.id === item.id)?.name
    default: {
      const _exhaustive: never = item
      return _exhaustive
    }
  }
}

function rename(pattern: Pattern, item: NamedItemKey, to: string): Pattern {
  const from = currentName(pattern, item)
  if (from === undefined || from === to || checkName(pattern, to, item)) return pattern

  // Rewrite every formula first; refuse the whole rename if any rewrite would change a formula's meaning.
  let refused = false
  const rewrite = (source: string): string => {
    const next = renameReferences(source, from, to)
    if (next === undefined) refused = true
    return next ?? source
  }
  const variables = pattern.variables.map((v) => {
    const formula = rewrite(v.formula)
    const name = item.kind === 'variable' && v.name === from ? to : v.name
    return formula === v.formula && name === v.name ? v : { ...v, name, formula }
  })
  const points = pattern.points.map((p) => {
    const x = rewrite(p.x)
    const y = rewrite(p.y)
    const name = item.kind === 'point' && p.id === item.id ? to : p.name
    return x === p.x && y === p.y && name === p.name ? p : { ...p, name, x, y }
  })
  const pieces = pattern.pieces.map((piece) => visitPieceFormulas(piece, (_owner, source) => rewrite(source)))
  const measurements =
    item.kind === 'measurement' ? pattern.measurements.map((m) => (m.name === from ? { ...m, name: to } : m)) : pattern.measurements
  if (refused) return pattern

  const same = <T>(next: T[], prev: T[]): T[] => (next.every((x, i) => x === prev[i]) ? prev : next)
  return {
    ...pattern,
    measurements,
    variables: same(variables, pattern.variables),
    points: same(points, pattern.points),
    pieces: same(pieces, pattern.pieces)
  }
}

function setFormula(pattern: Pattern, owner: FormulaOwner, formula: string): Pattern {
  switch (owner.kind) {
    case 'variable': {
      const variables = replaceFirst(
        pattern.variables,
        (v) => v.name === owner.name,
        (v) => (v.formula === formula ? v : { ...v, formula })
      )
      return variables ? { ...pattern, variables } : pattern
    }
    case 'point': {
      // Duplicate ids: edit the first, matching evaluate(), which resolves the first.
      const points = replaceFirst(
        pattern.points,
        (p) => p.id === owner.id,
        (p) => (p[owner.axis] === formula ? p : { ...p, [owner.axis]: formula })
      )
      return points ? { ...pattern, points } : pattern
    }
    default: {
      const _exhaustive: never = owner
      return _exhaustive
    }
  }
}
