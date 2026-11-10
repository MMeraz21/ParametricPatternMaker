import type { Axis, Id, LocatedIssue, Pattern, ShownIssue, SizeView } from '@core'
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
  readonly issues: readonly ShownIssue[]
}

export interface PointInspection {
  readonly id: Id
  readonly name: string
  readonly role: PointRole
  /** False when the point is not drawn on the canvas. The inspector works either way. */
  readonly placed: boolean
  readonly axes: Readonly<Record<Axis, AxisInspection>>
  /** Issues on the point as a whole (invalid or duplicate name or id). */
  readonly pointIssues: readonly ShownIssue[]
}

/** Everything the inspector shows for one point; null when the id is no longer in the pattern. */
export function inspectPoint(pattern: Pattern, view: SizeView, id: Id): PointInspection | null {
  const point = pattern.points.find((p) => p.id === id)
  if (!point) return null
  const placed = view.resolved.points[id]

  const axisIssues = (axis: Axis): ShownIssue[] => view.issues.filter(({ item }) => item.kind === 'pointCoord' && item.id === id && item.axis === axis)
  const axis = (a: Axis): AxisInspection => ({ formula: point[a], value: placed ? placed[a] : null, issues: axisIssues(a) })

  return {
    id,
    name: point.name,
    role: pointRoles(pattern).get(id) ?? 'anchor',
    placed: placed !== undefined,
    axes: { x: axis('x'), y: axis('y') },
    pointIssues: view.issues.filter(({ item }) => item.kind === 'point' && item.id === id)
  }
}

/** Red for a problem in the size on screen, amber for one only in other sizes. */
export function issueTone(issues: readonly ShownIssue[]): 'here' | 'elsewhere' | 'none' {
  if (issues.length === 0) return 'none'
  return issues.some((issue) => issue.here) ? 'here' : 'elsewhere'
}

export const issueTextClass = (issue: ShownIssue): string => (issue.here ? 'text-red-700' : 'text-amber-700')

export const ISSUE_BORDER_CLASS = { here: 'border-red-400 focus:ring-red-200', elsewhere: 'border-amber-400 focus:ring-amber-200' } as const

/** Where clicking an issue takes you: the measurement, variable or point it is about. */
export function selectionForIssue({ item }: LocatedIssue): Selection {
  switch (item.kind) {
    case 'measurement':
    case 'variable':
      return { kind: item.kind, name: item.name }
    case 'point':
    case 'pointCoord':
      return { kind: 'point', id: item.id }
    case 'segment':
    case 'piece':
      return { kind: item.kind, id: item.id }
    case 'notch':
    case 'seamAllowance':
      return { kind: 'piece', id: item.pieceId }
    default: {
      const _exhaustive: never = item
      return _exhaustive
    }
  }
}
