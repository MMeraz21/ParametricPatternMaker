import type { CutLineFailure } from './cutLine'
import { compileFormula, evaluateExpr, isValidName, referenceKey, type Axis, type Expr, type Reference } from './formula'
import { topologicalSort } from './graph'
import { visitPieceFormulas, type Id, type Pattern, type Piece, type PieceFormulaOwner, type SizeName } from './model'
import { allowanceKey, notchKey, resolveGeometry, type ResolvedPiece, type ResolvedSegment } from './outline'

/** Identifies the pattern item an issue is about, so the UI can point at it. */
export type ItemRef =
  | { kind: 'measurement'; name: string }
  | { kind: 'variable'; name: string }
  | { kind: 'point'; id: Id; name: string }
  | { kind: 'pointCoord'; id: Id; name: string; axis: Axis }
  | { kind: 'segment'; id: Id }
  | { kind: 'piece'; id: Id; name: string }
  | { kind: 'notch'; pieceId: Id; id: Id }
  /** A `segmentId` of null is the piece's default allowance. */
  | { kind: 'seamAllowance'; pieceId: Id; segmentId: Id | null }

/** Which of a piece's point references an issue is about. Absent when it isn't about one of them. */
export type PiecePointRole = 'grain-from' | 'grain-to' | 'stack-point'

export type EvaluationIssue =
  | { kind: 'unknown-size'; size: SizeName; message: string }
  | { kind: 'invalid-name'; item: ItemRef; message: string }
  | { kind: 'duplicate-name'; item: ItemRef; message: string }
  | { kind: 'duplicate-id'; item: ItemRef; message: string }
  | { kind: 'missing-measurement-value'; item: ItemRef; message: string }
  | { kind: 'parse-error'; item: ItemRef; message: string }
  | { kind: 'undefined-reference'; item: ItemRef; reference: string; message: string }
  | { kind: 'invalid-reference'; item: ItemRef; reference: string; message: string }
  | { kind: 'cycle'; item: ItemRef; cycle: string[]; message: string }
  | { kind: 'dependency-failed'; item: ItemRef; dependency: string; role?: PiecePointRole; message: string }
  | { kind: 'not-finite'; item: ItemRef; message: string }
  | { kind: 'missing-point'; item: ItemRef; pointId: Id; role?: PiecePointRole; message: string }
  | { kind: 'missing-segment'; item: ItemRef; segmentId: Id; message: string }
  | { kind: 'outline-empty'; item: ItemRef; message: string }
  | { kind: 'duplicate-outline-segment'; item: ItemRef; segmentId: Id; message: string }
  | {
      kind: 'outline-gap'
      item: ItemRef
      /** The edge whose end doesn't meet the next edge's start, and that next edge. */
      after: Id
      before: Id
      endPointId: Id
      startPointId: Id
      message: string
    }
  | { kind: 'degenerate-outline'; item: ItemRef; message: string }
  | { kind: 'notch-off-outline'; item: ItemRef; segmentId: Id; message: string }
  | { kind: 'notch-out-of-range'; item: ItemRef; distance: number; length: number; message: string }
  | { kind: 'notch-on-degenerate-segment'; item: ItemRef; message: string }
  | { kind: 'negative-seam-allowance'; item: ItemRef; value: number; message: string }
  | { kind: 'unknown-seam-allowance-edge'; item: ItemRef; segmentId: Id; message: string }
  | { kind: 'fold-edge-has-allowance'; item: ItemRef; segmentId: Id; message: string }
  | {
      kind: 'invalid-fold-edge'
      item: ItemRef
      segmentId: Id
      reason: 'not-in-outline' | 'not-straight' | 'piece-crosses-line'
      message: string
    }
  | { kind: 'degenerate-grainline'; item: ItemRef; message: string }
  | { kind: 'cut-line-failed'; item: ItemRef; failure: CutLineFailure; message: string }

/** Every issue except `unknown-size`, which graded evaluation cannot produce. */
export type LocatedIssue = Exclude<EvaluationIssue, { kind: 'unknown-size' }>

export interface ResolvedPoint {
  id: Id
  name: string
  x: number
  y: number
}

/** A pattern with every formula evaluated to concrete millimetre values for one size. */
export interface ResolvedPattern {
  size: SizeName
  measurements: Record<string, number>
  variables: Record<string, number>
  /** Keyed by id. Anything that failed to resolve is omitted and explained in `issues`. */
  points: Record<Id, ResolvedPoint>
  segments: Record<Id, ResolvedSegment>
  pieces: Record<Id, ResolvedPiece>
  issues: EvaluationIssue[]
}

type Entity =
  | { kind: 'measurement'; name: string }
  | { kind: 'variable'; name: string }
  | { kind: 'point'; id: Id; name: string }

/** A value in the dependency graph: a measurement, a variable or one coordinate of a point. */
interface GraphNode {
  key: string
  item: ItemRef
  label: string
}

interface FormulaNode extends GraphNode {
  source: string
  compiled?: { expr: Expr; deps: Map<string, string> }
  /** True when the formula itself is broken (parse error or bad reference). */
  failed: boolean
}

const measurementKey = (name: string): string => `measurement:${name}`
const variableKey = (name: string): string => `variable:${name}`
const pointCoordKey = (id: Id, axis: Axis): string => `point:${id}.${axis}`

function describe(item: ItemRef): string {
  switch (item.kind) {
    case 'measurement':
      return `measurement '${item.name}'`
    case 'variable':
      return `variable '${item.name}'`
    case 'point':
      return `point '${item.name}'`
    case 'pointCoord':
      return `${item.name}.${item.axis}`
    case 'segment':
      return `segment '${item.id}'`
    case 'piece':
      return `piece '${item.name}'`
    case 'notch':
      return `notch '${item.id}'`
    case 'seamAllowance':
      return `the seam allowance of piece '${item.pieceId}'`
    default: {
      const _exhaustive: never = item
      return _exhaustive
    }
  }
}

function pieceFormulaNode(piece: Piece, owner: PieceFormulaOwner, source: string): FormulaNode {
  switch (owner.kind) {
    case 'notch':
      return {
        key: notchKey(piece.id, owner.id),
        item: { kind: 'notch', pieceId: piece.id, id: owner.id },
        label: `notch ${owner.id}`,
        source,
        failed: false
      }
    case 'seamAllowance':
      return {
        key: allowanceKey(piece.id, owner.segmentId),
        item: { kind: 'seamAllowance', pieceId: piece.id, segmentId: owner.segmentId },
        label: `Seam allowance of '${piece.name}'${owner.segmentId === null ? '' : ` on '${owner.segmentId}'`}`,
        source,
        failed: false
      }
    default: {
      const _exhaustive: never = owner
      return _exhaustive
    }
  }
}

/**
 * Evaluate every formula in `pattern` for `size`. Pure: never throws on bad pattern content; problems
 * are reported in `issues` and the affected values are left out of the result.
 */
export function evaluate(pattern: Pattern, size: SizeName): ResolvedPattern {
  const issues: EvaluationIssue[] = []
  if (!pattern.sizes.includes(size)) {
    issues.push({ kind: 'unknown-size', size, message: `Size '${size}' is not one of: ${pattern.sizes.join(', ')}` })
  }

  // Measurements, variables and points share one namespace, since formulas refer to all of them by name.
  const entities = new Map<string, Entity>()
  const register = (entity: Entity, item: ItemRef): boolean => {
    if (!isValidName(entity.name)) {
      issues.push({
        kind: 'invalid-name',
        item,
        message: `'${entity.name}' is not a valid name (letters, digits and _, not starting with a digit, not a built-in)`
      })
      return false
    }
    const existing = entities.get(entity.name)
    if (existing) {
      issues.push({
        kind: 'duplicate-name',
        item,
        message: `'${entity.name}' is already used by ${describe(existing)}`
      })
      return false
    }
    entities.set(entity.name, entity)
    return true
  }

  const values = new Map<string, number>()
  const resolvedMeasurements: Record<string, number> = {}
  for (const { name, values: bySize } of pattern.measurements) {
    const item: ItemRef = { kind: 'measurement', name }
    if (!register({ kind: 'measurement', name }, item)) continue
    const value = bySize[size]
    if (value === undefined || !Number.isFinite(value)) {
      issues.push({ kind: 'missing-measurement-value', item, message: `Measurement '${name}' has no value for size '${size}'` })
      continue
    }
    values.set(measurementKey(name), value)
    resolvedMeasurements[name] = value
  }

  const formulaNodes: FormulaNode[] = []
  for (const { name, formula } of pattern.variables) {
    const item: ItemRef = { kind: 'variable', name }
    if (!register({ kind: 'variable', name }, item)) continue
    formulaNodes.push({ key: variableKey(name), item, label: name, source: formula, failed: false })
  }

  const pointIds = new Set<Id>()
  for (const point of pattern.points) {
    const item: ItemRef = { kind: 'point', id: point.id, name: point.name }
    if (pointIds.has(point.id)) {
      issues.push({ kind: 'duplicate-id', item, message: `Point id '${point.id}' is used more than once` })
      continue
    }
    pointIds.add(point.id)
    if (!register({ kind: 'point', id: point.id, name: point.name }, item)) continue
    for (const axis of ['x', 'y'] as const) {
      formulaNodes.push({
        key: pointCoordKey(point.id, axis),
        item: { kind: 'pointCoord', id: point.id, name: point.name, axis },
        label: `${point.name}.${axis}`,
        source: point[axis],
        failed: false
      })
    }
  }

  // Notch distances and seam allowances are formulas too. They are leaves (nothing can reference them), so
  // they cannot form cycles. Duplicate piece or notch ids are reported by resolveGeometry.
  const pieceFormulaKeys = new Set<string>()
  for (const piece of pattern.pieces) {
    visitPieceFormulas(piece, (owner, source) => {
      const node = pieceFormulaNode(piece, owner, source)
      if (!pieceFormulaKeys.has(node.key)) {
        pieceFormulaKeys.add(node.key)
        formulaNodes.push(node)
      }
      return source
    })
  }

  const resolveReference = (node: FormulaNode, ref: Reference): string | undefined => {
    const reference = referenceKey(ref)
    const entity = entities.get(ref.name)
    if (!entity) {
      issues.push({ kind: 'undefined-reference', item: node.item, reference, message: `'${ref.name}' is not defined` })
      return undefined
    }
    if (ref.kind === 'symbol') {
      if (entity.kind === 'measurement') return measurementKey(entity.name)
      if (entity.kind === 'variable') return variableKey(entity.name)
      issues.push({
        kind: 'invalid-reference',
        item: node.item,
        reference,
        message: `'${ref.name}' is a point; use ${ref.name}.x or ${ref.name}.y`
      })
      return undefined
    }
    if (entity.kind === 'point') return pointCoordKey(entity.id, ref.axis)
    issues.push({
      kind: 'invalid-reference',
      item: node.item,
      reference,
      message: `'${ref.name}' is a ${entity.kind}, not a point, so it has no .${ref.axis}`
    })
    return undefined
  }

  for (const node of formulaNodes) {
    const result = compileFormula(node.source)
    if (!result.ok) {
      issues.push({ kind: 'parse-error', item: node.item, message: `${node.label}: ${result.message}` })
      node.failed = true
      continue
    }
    const deps = new Map<string, string>()
    for (const ref of result.formula.references) {
      const key = resolveReference(node, ref)
      if (key === undefined) node.failed = true
      else deps.set(referenceKey(ref), key)
    }
    node.compiled = { expr: result.formula.expr, deps }
  }

  const nodesByKey = new Map<string, FormulaNode>(formulaNodes.map((node) => [node.key, node]))
  const labelOf = (key: string): string => nodesByKey.get(key)?.label ?? key.slice(key.indexOf(':') + 1)

  const { order, cycles } = topologicalSort(
    formulaNodes.map((node) => node.key),
    (key) => [...(nodesByKey.get(key)?.compiled?.deps.values() ?? [])]
  )

  for (const { members, path } of cycles) {
    const cycle = path.map(labelOf)
    for (const key of members) {
      const node = nodesByKey.get(key)
      if (!node) continue
      issues.push({ kind: 'cycle', item: node.item, cycle, message: `Circular reference: ${cycle.join(' → ')}` })
    }
  }

  for (const key of order) {
    const node = nodesByKey.get(key)
    if (!node?.compiled || node.failed) continue

    const scope = new Map<string, number>()
    let failedDependency: string | undefined
    for (const [reference, depKey] of node.compiled.deps) {
      const value = values.get(depKey)
      if (value === undefined) {
        failedDependency = labelOf(depKey)
        break
      }
      scope.set(reference, value)
    }
    if (failedDependency !== undefined) {
      issues.push({
        kind: 'dependency-failed',
        item: node.item,
        dependency: failedDependency,
        message: `${node.label} depends on ${failedDependency}, which could not be evaluated`
      })
      continue
    }

    // Every reference in the expression is in scope by construction; NaN would surface as not-finite.
    const value = evaluateExpr(node.compiled.expr, (ref) => scope.get(referenceKey(ref)) ?? Number.NaN)
    if (!Number.isFinite(value)) {
      issues.push({ kind: 'not-finite', item: node.item, message: `${node.label} evaluated to ${value}` })
      continue
    }
    if (node.item.kind === 'seamAllowance' && value < 0) {
      issues.push({
        kind: 'negative-seam-allowance',
        item: node.item,
        value,
        message: `${node.label} is ${value} mm; it can't be negative`
      })
      continue
    }
    values.set(key, value)
  }

  const variables: Record<string, number> = {}
  for (const { name } of pattern.variables) {
    const value = values.get(variableKey(name))
    if (value !== undefined) variables[name] = value
  }

  const points: Record<Id, ResolvedPoint> = {}
  for (const { id, name } of pattern.points) {
    const x = values.get(pointCoordKey(id, 'x'))
    const y = values.get(pointCoordKey(id, 'y'))
    if (x !== undefined && y !== undefined && points[id] === undefined) points[id] = { id, name, x, y }
  }

  const pointNames = new Map<Id, string>()
  for (const { id, name } of pattern.points) if (!pointNames.has(id)) pointNames.set(id, name)
  const notchDistances = new Map<string, number>()
  const allowances = new Map<string, number>()
  for (const { key, item } of formulaNodes) {
    const value = values.get(key)
    if (value === undefined) continue
    if (item.kind === 'notch') notchDistances.set(key, value)
    else if (item.kind === 'seamAllowance') allowances.set(key, value)
  }
  const geometry = resolveGeometry({ pattern, points, pointNames, notchDistances, allowances })
  issues.push(...geometry.issues)

  return {
    size,
    measurements: resolvedMeasurements,
    variables,
    points,
    segments: geometry.segments,
    pieces: geometry.pieces,
    issues
  }
}
