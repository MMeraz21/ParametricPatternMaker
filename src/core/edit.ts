import { isValidName, renameReferences, type Axis } from './formula'
import type { DisplayUnits, Id, Measurement, Pattern, Point, SizeName, Variable } from './model'

/**
 * Pattern edits: the one way anything changes a Pattern (panels, inspector, undo and MCP later).
 *
 * `applyEdit` never mutates its input and shares everything it doesn't touch. A no-op or refused edit
 * returns the same reference, so `next === pattern` means "nothing changed". Bad formula text is a legal
 * edit (evaluate reports it); what is refused is anything that would lose information: an invalid or
 * taken name, a duplicate id, a non-finite measurement. Edits carry every choice (ids, names), so
 * replaying one against the same pattern gives the same result.
 */

/** Identity of a named item. Measurements and variables have no id, so their name is their key. */
export type ItemKey =
  | { readonly kind: 'measurement'; readonly name: string }
  | { readonly kind: 'variable'; readonly name: string }
  | { readonly kind: 'point'; readonly id: Id }

export type ItemKind = ItemKey['kind']

/** A complete item to append. */
export type NewItem =
  | { readonly kind: 'measurement'; readonly measurement: Measurement }
  | { readonly kind: 'variable'; readonly variable: Variable }
  | { readonly kind: 'point'; readonly point: Point }

export type FormulaOwner =
  | { readonly kind: 'variable'; readonly name: string }
  | { readonly kind: 'point'; readonly id: Id; readonly axis: Axis }

export type PatternEdit =
  | { readonly kind: 'add'; readonly item: NewItem }
  /** Doesn't cascade: references to the item become issues that evaluate reports. */
  | { readonly kind: 'remove'; readonly item: ItemKey }
  /** Renames the item and rewrites every formula that refers to it, keeping the user's text. */
  | { readonly kind: 'rename'; readonly item: ItemKey; readonly to: string }
  | { readonly kind: 'setFormula'; readonly owner: FormulaOwner; readonly formula: string }
  | { readonly kind: 'setMeasurement'; readonly name: string; readonly size: SizeName; readonly value: number }
  | { readonly kind: 'setUnits'; readonly units: DisplayUnits }

/** Why a name can't be used. Messages are ready to show. */
export type NameProblem = { readonly kind: 'invalid' | 'taken'; readonly message: string }

export const sameItem = (a: ItemKey, b: ItemKey): boolean =>
  a.kind === b.kind && (a.kind === 'point' ? b.kind === 'point' && a.id === b.id : b.kind !== 'point' && a.name === b.name)

/** Measurements, variables and points share one namespace. */
function nameOwner(pattern: Pattern, name: string): ItemKey | undefined {
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

const BLANK_NAMES: Record<ItemKind, string> = { measurement: 'measurement', variable: 'variable', point: 'P' }

/**
 * A new item with a unique name (`variable_1`, `P_2`, ...) and, for points, a fresh id `p<N>`.
 * Deterministic, so the caller knows the id before dispatching and can select the new row.
 */
export function newItem(pattern: Pattern, kind: ItemKind): NewItem {
  const base = BLANK_NAMES[kind]
  let n = 1
  while (nameOwner(pattern, `${base}_${n}`)) n++
  const name = `${base}_${n}`
  switch (kind) {
    case 'measurement':
      return { kind, measurement: { name, values: Object.fromEntries(pattern.sizes.map((size) => [size, 0])) } }
    case 'variable':
      return { kind, variable: { name, formula: '0' } }
    case 'point': {
      const ids = new Set(pattern.points.map((p) => p.id))
      let k = 1
      while (ids.has(`p${k}`)) k++
      return { kind, point: { id: `p${k}`, name, x: '0', y: '0' } }
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
    default: {
      const _exhaustive: never = edit
      return _exhaustive
    }
  }
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
    default: {
      const _exhaustive: never = item
      return _exhaustive
    }
  }
}

function currentName(pattern: Pattern, item: ItemKey): string | undefined {
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

function rename(pattern: Pattern, item: ItemKey, to: string): Pattern {
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
  const pieces = pattern.pieces.map((piece) => {
    const notches = piece.notches.map((n) => {
      const distance = rewrite(n.distance)
      return distance === n.distance ? n : { ...n, distance }
    })
    return notches.every((n, i) => n === piece.notches[i]) ? piece : { ...piece, notches }
  })
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
