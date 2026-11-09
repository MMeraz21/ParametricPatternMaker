import { curvePoints, pathData, segmentPointIds, type Id, type Pattern, type ResolvedPattern, type Segment, type Vec2 } from '@core'
import { pointRoles, type PointRole } from '../editor/inspect'
import type { Selection } from '../editor/state'
import { boundsOf, type Bounds } from './camera'

/**
 * Everything the canvas draws, as plain data in world mm. Rebuilt on edits and selection changes,
 * never on pan/zoom. Components map these arrays to SVG and add nothing but styling.
 */
export interface Scene {
  /** Closed outlines of pieces that resolved, drawn filled underneath everything else. */
  readonly pieces: readonly ScenePiece[]
  /** Every segment that resolved, including segments of broken pieces, so gaps are visible. */
  readonly segments: readonly SceneSegment[]
  /** Anchor-to-control lines for every resolved bezier. */
  readonly handles: readonly SceneHandle[]
  /** One per resolved point; controls first so anchors paint on top. */
  readonly markers: readonly SceneMarker[]
  /** Fit target: every point and curve control point. Null when nothing resolved. */
  readonly bounds: Bounds | null
}

export interface ScenePiece {
  readonly id: Id
  readonly name: string
  readonly d: string
}

export interface SceneSegment {
  readonly id: Id
  readonly d: string
  /** Touches the selected point. */
  readonly highlighted: boolean
  /** In the outline of a resolved piece; free segments are construction lines. */
  readonly inPiece: boolean
}

export interface SceneHandle {
  readonly key: string
  readonly anchor: Vec2
  readonly control: Vec2
  readonly highlighted: boolean
}

export interface SceneMarker {
  readonly id: Id
  readonly name: string
  readonly at: Vec2
  readonly role: PointRole
  readonly selected: boolean
}

export function buildScene(pattern: Pattern, resolved: ResolvedPattern, selection: Selection | null): Scene {
  const roles = pointRoles(pattern)
  const selectedId = selection?.kind === 'point' ? selection.id : null
  const touchesSelection = (segment: Segment): boolean => selectedId !== null && segmentPointIds(segment).includes(selectedId)

  const resolvedPieces = Object.values(resolved.pieces)
  const inPiece = new Set(resolvedPieces.flatMap((piece) => piece.outline.map((edge) => edge.segmentId)))
  const pieces = resolvedPieces.map((piece) => ({
    id: piece.id,
    name: piece.name,
    d: pathData(
      piece.outline.map((edge) => edge.curve),
      { closed: true }
    )
  }))

  // Author order from the pattern, not record key order.
  const segments: SceneSegment[] = []
  const handles: SceneHandle[] = []
  const seenSegments = new Set<Id>()
  for (const definition of pattern.segments) {
    const segment = resolved.segments[definition.id]
    // A duplicate id resolves to the first definition (and is reported), so draw it once.
    if (!segment || seenSegments.has(definition.id)) continue
    seenSegments.add(definition.id)
    const highlighted = touchesSelection(definition)
    segments.push({ id: segment.id, d: pathData([segment.curve]), highlighted, inPiece: inPiece.has(segment.id) })
    if (segment.curve.kind === 'cubic') {
      handles.push(
        { key: `${segment.id}:1`, anchor: segment.curve.from, control: segment.curve.c1, highlighted },
        { key: `${segment.id}:2`, anchor: segment.curve.to, control: segment.curve.c2, highlighted }
      )
    }
  }

  const markers: SceneMarker[] = []
  const seen = new Set<Id>()
  for (const point of pattern.points) {
    const at = resolved.points[point.id]
    if (!at || seen.has(point.id)) continue
    seen.add(point.id)
    markers.push({ id: point.id, name: point.name, at: { x: at.x, y: at.y }, role: roles.get(point.id) ?? 'anchor', selected: point.id === selectedId })
  }
  markers.sort((a, b) => Number(a.role === 'anchor') - Number(b.role === 'anchor'))

  const bounds = boundsOf([...markers.map((marker) => marker.at), ...Object.values(resolved.segments).flatMap((s) => curvePoints(s.curve))])
  return { pieces, segments, handles, markers, bounds }
}
