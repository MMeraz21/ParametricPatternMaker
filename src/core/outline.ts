import {
  DEGENERATE_LENGTH,
  curveLength,
  flatten,
  reverseCurve,
  sampleAtLength,
  scale,
  signedArea,
  type Curve,
  type Vec2
} from './geometry'
import type { EvaluationIssue, ItemRef, ResolvedPoint } from './evaluate'
import type { Id, Pattern, Piece, Segment } from './model'

/**
 * Geometry resolution: turns evaluated points into segment curves and closed, oriented piece
 * outlines with placed notches. Runs once at the end of evaluate(); all maths lives in geometry.ts.
 */

/** A segment whose points all resolved. */
export interface ResolvedSegment {
  readonly id: Id
  /** Exact geometry in the segment's own direction. */
  readonly curve: Curve
  /** Arc length in mm. */
  readonly length: number
}

/** One edge of a piece outline, already oriented in outline order. */
export interface OutlineEdge {
  readonly segmentId: Id
  /** True when the outline runs the segment backwards. `curve` is already reversed. */
  readonly reversed: boolean
  /** In outline direction: `curve.to` is the same object as the next edge's `curve.from`. */
  readonly curve: Curve
  readonly length: number
}

export type Orientation = 'clockwise' | 'counterclockwise'

export interface ResolvedNotch {
  readonly id: Id
  readonly segmentId: Id
  /** mm from the segment's own `from`, as the model defines it. */
  readonly distance: number
  readonly point: Vec2
  /** Unit tangent in outline direction. */
  readonly tangent: Vec2
  /** Unit normal pointing out of the piece. */
  readonly outward: Vec2
}

/** A piece whose outline is closed and fully resolved. */
export interface ResolvedPiece {
  readonly id: Id
  readonly name: string
  readonly outline: readonly [OutlineEdge, ...OutlineEdge[]]
  /** As seen on screen (y down). */
  readonly orientation: Orientation
  /** Enclosed area in mm². */
  readonly area: number
  /** Notches that placed successfully; the rest are issues. */
  readonly notches: readonly ResolvedNotch[]
}

export interface FlatEdge {
  readonly segmentId: Id
  /** At least 2 points in outline direction; the first equals the previous edge's last. */
  readonly points: readonly Vec2[]
}

export interface FlatOutline {
  readonly edges: readonly FlatEdge[]
  /** The whole outline as one closed ring without a repeated closing vertex (Clipper2 style). */
  readonly ring: readonly Vec2[]
}

/** Flatten a piece outline to polylines within `tolerance` mm of the true curves. */
export function flattenOutline(piece: ResolvedPiece, tolerance: number): FlatOutline {
  const edges = piece.outline.map((edge) => ({ segmentId: edge.segmentId, points: flatten(edge.curve, tolerance) }))
  return { edges, ring: edges.flatMap((edge) => edge.points.slice(0, -1)) }
}

export interface GeometryInput {
  readonly pattern: Pattern
  readonly points: Readonly<Record<Id, ResolvedPoint>>
  /** Name of every declared point, resolved or not, to tell a missing point from a failed one. */
  readonly pointNames: ReadonlyMap<Id, string>
  /** Evaluated notch distances keyed by `notchKey`. Absent means the formula failed (already reported). */
  readonly notchDistances: ReadonlyMap<string, number>
}

export interface GeometryOutput {
  readonly segments: Record<Id, ResolvedSegment>
  readonly pieces: Record<Id, ResolvedPiece>
  readonly issues: EvaluationIssue[]
}

export const notchKey = (pieceId: Id, notchId: Id): string => `notch:${pieceId}/${notchId}`

function segmentPointIds(segment: Segment): Id[] {
  switch (segment.kind) {
    case 'line':
      return [segment.from, segment.to]
    case 'bezier':
      return [segment.from, segment.c1, segment.c2, segment.to]
    default: {
      const _exhaustive: never = segment
      return _exhaustive
    }
  }
}

/** The only mapping from model segment kinds to kernel curves. Undefined if any point is unresolved. */
function toCurve(segment: Segment, points: Readonly<Record<Id, ResolvedPoint>>): Curve | undefined {
  switch (segment.kind) {
    case 'line': {
      const [from, to] = [points[segment.from], points[segment.to]]
      return from && to ? { kind: 'line', from, to } : undefined
    }
    case 'bezier': {
      const [from, c1, c2, to] = [points[segment.from], points[segment.c1], points[segment.c2], points[segment.to]]
      return from && c1 && c2 && to ? { kind: 'cubic', from, c1, c2, to } : undefined
    }
    default: {
      const _exhaustive: never = segment
      return _exhaustive
    }
  }
}

export function resolveGeometry({ pattern, points, pointNames, notchDistances }: GeometryInput): GeometryOutput {
  const issues: EvaluationIssue[] = []
  const definitions = new Map<Id, Segment>()
  const segments: Record<Id, ResolvedSegment> = {}

  for (const segment of pattern.segments) {
    const item: ItemRef = { kind: 'segment', id: segment.id }
    if (definitions.has(segment.id)) {
      issues.push({ kind: 'duplicate-id', item, message: `Segment id '${segment.id}' is used more than once` })
      continue
    }
    definitions.set(segment.id, segment)

    const ids = segmentPointIds(segment)
    const missing = ids.filter((id) => !pointNames.has(id))
    for (const pointId of missing) {
      issues.push({
        kind: 'missing-point',
        item,
        pointId,
        message: `Segment '${segment.id}' refers to missing point '${pointId}'`
      })
    }
    if (missing.length > 0) continue

    const curve = toCurve(segment, points)
    if (!curve) {
      const failed = ids.find((id) => points[id] === undefined) ?? segment.from
      const dependency = pointNames.get(failed) ?? failed
      issues.push({
        kind: 'dependency-failed',
        item,
        dependency,
        message: `Segment '${segment.id}' depends on point ${dependency}, which could not be evaluated`
      })
      continue
    }

    segments[segment.id] = { id: segment.id, curve, length: curveLength(curve) }
  }

  const pieces: Record<Id, ResolvedPiece> = {}
  const pieceIds = new Set<Id>()
  for (const piece of pattern.pieces) {
    const item: ItemRef = { kind: 'piece', id: piece.id, name: piece.name }
    if (pieceIds.has(piece.id)) {
      issues.push({ kind: 'duplicate-id', item, message: `Piece id '${piece.id}' is used more than once` })
      continue
    }
    pieceIds.add(piece.id)
    const resolved = resolvePiece(piece, item, definitions, segments, notchDistances, issues)
    if (resolved) pieces[piece.id] = resolved
  }

  return { segments, pieces, issues }
}

function resolvePiece(
  piece: Piece,
  item: ItemRef,
  definitions: ReadonlyMap<Id, Segment>,
  segments: Readonly<Record<Id, ResolvedSegment>>,
  notchDistances: ReadonlyMap<string, number>,
  issues: EvaluationIssue[]
): ResolvedPiece | undefined {
  const issueCount = issues.length

  if (piece.outline.length === 0) {
    issues.push({ kind: 'outline-empty', item, message: `Piece '${piece.name}' has no outline` })
    return undefined
  }

  // Static checks on ids first: they hold in every size, so a piece is closed in all sizes or none.
  const seen = new Set<Id>()
  const ends: { segmentId: Id; start: Id; end: Id }[] = []
  for (const ref of piece.outline) {
    const definition = definitions.get(ref.segmentId)
    if (!definition) {
      issues.push({
        kind: 'missing-segment',
        item,
        segmentId: ref.segmentId,
        message: `Piece '${piece.name}' refers to missing segment '${ref.segmentId}'`
      })
      continue
    }
    if (seen.has(ref.segmentId)) {
      issues.push({
        kind: 'duplicate-outline-segment',
        item,
        segmentId: ref.segmentId,
        message: `Piece '${piece.name}' uses segment '${ref.segmentId}' more than once`
      })
      continue
    }
    seen.add(ref.segmentId)
    const [start, end] = ref.reversed ? [definition.to, definition.from] : [definition.from, definition.to]
    ends.push({ segmentId: ref.segmentId, start, end })
  }
  if (issues.length > issueCount) return undefined

  ends.forEach((current, i) => {
    const next = ends[(i + 1) % ends.length]
    if (next && current.end !== next.start) {
      issues.push({
        kind: 'outline-gap',
        item,
        after: current.segmentId,
        before: next.segmentId,
        endPointId: current.end,
        startPointId: next.start,
        message: `Piece '${piece.name}': segment '${current.segmentId}' ends at '${current.end}' but '${next.segmentId}' starts at '${next.start}'`
      })
    }
  })
  if (issues.length > issueCount) return undefined

  const edges: OutlineEdge[] = []
  for (const ref of piece.outline) {
    const segment = segments[ref.segmentId]
    if (!segment) {
      issues.push({
        kind: 'dependency-failed',
        item,
        dependency: ref.segmentId,
        message: `Piece '${piece.name}' depends on segment '${ref.segmentId}', which could not be resolved`
      })
      return undefined
    }
    const reversed = ref.reversed ?? false
    edges.push({
      segmentId: ref.segmentId,
      reversed,
      curve: reversed ? reverseCurve(segment.curve) : segment.curve,
      length: segment.length
    })
  }
  const [first, ...rest] = edges
  if (!first) return undefined
  const outline: [OutlineEdge, ...OutlineEdge[]] = [first, ...rest]

  const signed = signedArea(outline.map((edge) => edge.curve))
  if (Math.abs(signed) < DEGENERATE_LENGTH) {
    issues.push({ kind: 'degenerate-outline', item, message: `Piece '${piece.name}' encloses no area` })
    return undefined
  }
  const orientation: Orientation = signed > 0 ? 'clockwise' : 'counterclockwise'

  const notches: ResolvedNotch[] = []
  const notchIds = new Set<Id>()
  for (const notch of piece.notches) {
    const notchItem: ItemRef = { kind: 'notch', pieceId: piece.id, id: notch.id }
    if (notchIds.has(notch.id)) {
      issues.push({ kind: 'duplicate-id', item: notchItem, message: `Notch id '${notch.id}' is used more than once` })
      continue
    }
    notchIds.add(notch.id)

    const edge = outline.find((e) => e.segmentId === notch.segmentId)
    const segment = segments[notch.segmentId]
    if (!edge || !segment) {
      issues.push({
        kind: 'notch-off-outline',
        item: notchItem,
        segmentId: notch.segmentId,
        message: `Notch '${notch.id}' is on segment '${notch.segmentId}', which is not in the outline of '${piece.name}'`
      })
      continue
    }
    const distance = notchDistances.get(notchKey(piece.id, notch.id))
    if (distance === undefined) continue

    const sample = sampleAtLength(segment.curve, distance)
    if (!sample.ok) {
      issues.push(
        sample.reason === 'out-of-range'
          ? {
              kind: 'notch-out-of-range',
              item: notchItem,
              distance,
              length: sample.length,
              message: `Notch '${notch.id}' is at ${distance} mm but segment '${notch.segmentId}' is only ${sample.length.toFixed(1)} mm long`
            }
          : {
              kind: 'notch-on-degenerate-segment',
              item: notchItem,
              message: `Notch '${notch.id}' is on segment '${notch.segmentId}', which has zero length`
            }
      )
      continue
    }
    const tangent = edge.reversed ? scale(sample.sample.tangent, -1) : sample.sample.tangent
    // y down: for a clockwise outline the interior is to the right of travel, so outward is to the left.
    const outward = orientation === 'clockwise' ? { x: tangent.y, y: -tangent.x } : { x: -tangent.y, y: tangent.x }
    notches.push({ id: notch.id, segmentId: notch.segmentId, distance, point: sample.sample.point, tangent, outward })
  }

  return { id: piece.id, name: piece.name, outline, orientation, area: Math.abs(signed), notches }
}
