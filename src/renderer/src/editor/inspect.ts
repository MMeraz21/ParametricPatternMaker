import type { Axis, EvaluationIssue, Id, Pattern, ResolvedPattern } from '@core'
import type { Selection } from './state'

/** A point used as an endpoint by any segment is an anchor; one used only as c1/c2 is a control. */
export type PointRole = 'anchor' | 'control'

/** Role of every point. Shared by the scene and the inspector so styling and badge agree. */
export function pointRoles(pattern: Pattern): ReadonlyMap<Id, PointRole> {
  const roles = new Map<Id, PointRole>(pattern.points.map((point) => [point.id, 'anchor']))
  const anchors = new Set<Id>()
  for (const segment of pattern.segments) {
    anchors.add(segment.from)
    anchors.add(segment.to)
    if (segment.kind === 'bezier') {
      roles.set(segment.c1, 'control')
      roles.set(segment.c2, 'control')
    }
  }
  for (const id of anchors) roles.set(id, 'anchor')
  return roles
}

export interface AxisInspection {
  readonly formula: string
  /** Null when the point did not resolve (both axes are dropped if either fails). */
  readonly value: number | null
  /** Issues about this coordinate. */
  readonly issues: readonly EvaluationIssue[]
}

export interface PointInspection {
  readonly id: Id
  readonly name: string
  readonly role: PointRole
  /** False when the point is not drawn on the canvas. The inspector works either way. */
  readonly placed: boolean
  readonly axes: Readonly<Record<Axis, AxisInspection>>
  /** Issues on the point as a whole (invalid or duplicate name or id). */
  readonly pointIssues: readonly EvaluationIssue[]
}

/** Everything the inspector shows for one point; null when the id is no longer in the pattern. */
export function inspectPoint(pattern: Pattern, resolved: ResolvedPattern, id: Id): PointInspection | null {
  const point = pattern.points.find((p) => p.id === id)
  if (!point) return null
  const placed = resolved.points[id]

  const axisIssues = (axis: Axis): EvaluationIssue[] =>
    resolved.issues.filter(
      (issue) => issue.kind !== 'unknown-size' && issue.item.kind === 'pointCoord' && issue.item.id === id && issue.item.axis === axis
    )
  const axis = (a: Axis): AxisInspection => ({ formula: point[a], value: placed ? placed[a] : null, issues: axisIssues(a) })

  return {
    id,
    name: point.name,
    role: pointRoles(pattern).get(id) ?? 'anchor',
    placed: placed !== undefined,
    axes: { x: axis('x'), y: axis('y') },
    pointIssues: resolved.issues.filter((issue) => issue.kind !== 'unknown-size' && issue.item.kind === 'point' && issue.item.id === id)
  }
}

/** Where clicking an issue takes you. Point issues select the point; others have nothing selectable yet. */
export function selectionForIssue(issue: EvaluationIssue): Selection | null {
  if (issue.kind === 'unknown-size') return null
  const { item } = issue
  switch (item.kind) {
    case 'point':
    case 'pointCoord':
      return { kind: 'point', id: item.id }
    case 'measurement':
    case 'variable':
    case 'segment':
    case 'piece':
    case 'notch':
      return null
    default: {
      const _exhaustive: never = item
      return _exhaustive
    }
  }
}
