import {
  FOLD_TOLERANCE,
  buildCutLine,
  outwardNormal,
  placeCutNotch,
  type CutLine,
  type CutLineFailure,
  type EdgeAllowance
} from './cutLine'
import {
  DEGENERATE_LENGTH,
  OFFSET_TOLERANCE,
  cross,
  curveLength,
  curvePoints,
  distance,
  dot,
  flatten,
  norm,
  reverseCurve,
  sampleAtLength,
  scale,
  signedArea,
  sub,
  vec,
  type Curve,
  type Vec2
} from './geometry'
import type { EvaluationIssue, ItemRef, ResolvedPoint } from './evaluate'
import { segmentPointIds, type Id, type Pattern, type Piece, type Segment } from './model'

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
  readonly cutCount: number
  /** Absent only when an issue explains why. Present means safe to print. */
  readonly cutLine?: CutLine
  /** Absent only when an issue explains why. */
  readonly grainline?: ResolvedGrainline
  readonly fold?: ResolvedFold
}

export interface ResolvedGrainline {
  readonly from: Vec2
  readonly to: Vec2
  /** Radians, atan2(dy, dx), y down. */
  readonly angle: number
}

/** The edge a piece is cut on the fold along, in outline direction. */
export interface ResolvedFold {
  readonly segmentId: Id
  readonly from: Vec2
  readonly to: Vec2
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
  /** Evaluated seam allowances keyed by `allowanceKey`. Absent means the formula failed (already reported). */
  readonly allowances: ReadonlyMap<string, number>
}

export interface GeometryOutput {
  readonly segments: Record<Id, ResolvedSegment>
  readonly pieces: Record<Id, ResolvedPiece>
  readonly issues: EvaluationIssue[]
}

/** Outlines whose area is below this fraction of perimeter² enclose nothing. */
const DEGENERATE_AREA_RATIO = 1e-9
/** A fold's control points may be this far from its chord, in mm, and it still counts as straight. */
const STRAIGHT_TOLERANCE = 1e-6

// Ids are free text, so the parts are JSON-encoded: joining them with a separator lets two items collide.
export const notchKey = (pieceId: Id, notchId: Id): string => `notch:${JSON.stringify([pieceId, notchId])}`
/** A `segmentId` of null is the piece's default allowance. */
export const allowanceKey = (pieceId: Id, segmentId: Id | null): string => `allowance:${JSON.stringify([pieceId, segmentId])}`

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

export function resolveGeometry(input: GeometryInput): GeometryOutput {
  const { pattern, points, pointNames } = input
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
    const resolved = resolvePiece(piece, item, definitions, segments, input, issues)
    if (resolved) pieces[piece.id] = resolved
  }

  return { segments, pieces, issues }
}

function resolvePiece(
  piece: Piece,
  item: ItemRef,
  definitions: ReadonlyMap<Id, Segment>,
  segments: Readonly<Record<Id, ResolvedSegment>>,
  input: GeometryInput,
  issues: EvaluationIssue[]
): ResolvedPiece | undefined {
  const { notchDistances } = input
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
  // Compare like with like: an area against the square of the outline's size, so floating-point
  // noise on a flat outline can't pass as a real (and arbitrarily oriented) piece.
  const perimeter = outline.reduce((sum, edge) => sum + edge.length, 0)
  if (Math.abs(signed) <= DEGENERATE_AREA_RATIO * perimeter ** 2) {
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
    const outward = outwardNormal(tangent, orientation)
    notches.push({ id: notch.id, segmentId: notch.segmentId, distance, point: sample.sample.point, tangent, outward })
  }

  const grainline = resolveGrainline(piece, item, input, issues)
  const fold = resolveFold(piece, item, outline, orientation, issues)
  reportAllowanceEdges(piece, outline, fold, issues)
  const cutLine = resolveCutLine(piece, item, outline, orientation, notches, fold, input.allowances, issues)

  return {
    id: piece.id,
    name: piece.name,
    outline,
    orientation,
    area: Math.abs(signed),
    notches,
    cutCount: piece.cutCount,
    ...(cutLine ? { cutLine } : {}),
    ...(grainline ? { grainline } : {}),
    ...(fold ? { fold } : {})
  }
}

function resolveGrainline(
  piece: Piece,
  item: ItemRef,
  { points, pointNames }: GeometryInput,
  issues: EvaluationIssue[]
): ResolvedGrainline | undefined {
  // hasOwn: an id such as 'constructor' must not find what every object inherits.
  const resolve = (id: Id): ResolvedPoint | undefined => {
    if (Object.hasOwn(points, id) && points[id]) return points[id]
    const name = pointNames.get(id)
    if (name === undefined) {
      issues.push({ kind: 'missing-point', item, pointId: id, message: `Piece '${piece.name}' has a grainline on missing point '${id}'` })
    } else {
      issues.push({ kind: 'dependency-failed', item, dependency: name, message: `Piece '${piece.name}' has a grainline on '${name}', which could not be evaluated` })
    }
    return undefined
  }
  const [from, to] = [resolve(piece.grainline[0]), resolve(piece.grainline[1])]
  if (!from || !to) return undefined
  if (distance(from, to) < DEGENERATE_LENGTH) {
    issues.push({ kind: 'degenerate-grainline', item, message: `Piece '${piece.name}' has a grainline between two points in the same place` })
    return undefined
  }
  return { from: vec(from.x, from.y), to: vec(to.x, to.y), angle: Math.atan2(to.y - from.y, to.x - from.x) }
}

/** The piece's fold, if the edge can be one: in the outline, straight, and with the whole piece on one side. */
function resolveFold(
  piece: Piece,
  item: ItemRef,
  outline: readonly OutlineEdge[],
  orientation: Orientation,
  issues: EvaluationIssue[]
): ResolvedFold | undefined {
  const segmentId = piece.fold
  if (segmentId === undefined) return undefined
  const refuse = (reason: 'not-in-outline' | 'not-straight' | 'piece-crosses-line', problem: string): undefined => {
    issues.push({ kind: 'invalid-fold-edge', item, segmentId, reason, message: `Piece '${piece.name}' can't be cut on the fold along '${segmentId}': ${problem}` })
    return undefined
  }

  const edge = outline.find((candidate) => candidate.segmentId === segmentId)
  if (!edge) return refuse('not-in-outline', "it isn't in the outline")
  const { from, to } = edge.curve
  const chord = sub(to, from)
  const length = norm(chord)
  const straight = length >= DEGENERATE_LENGTH && curvePoints(edge.curve).every((point) => Math.abs(cross(chord, sub(point, from))) / length <= STRAIGHT_TOLERANCE)
  if (!straight) return refuse('not-straight', "it isn't straight")

  const outward = outwardNormal(scale(chord, 1 / length), orientation)
  const crosses = outline.some(({ curve }) => flatten(curve, OFFSET_TOLERANCE).some((point) => dot(outward, sub(point, from)) > FOLD_TOLERANCE))
  if (crosses) return refuse('piece-crosses-line', 'the piece lies on both sides of it')
  return { segmentId, from: vec(from.x, from.y), to: vec(to.x, to.y) }
}

/** Overrides that don't take effect: on an edge that isn't in the outline, or on the fold, which is always 0. */
function reportAllowanceEdges(piece: Piece, outline: readonly OutlineEdge[], fold: ResolvedFold | undefined, issues: EvaluationIssue[]): void {
  const inOutline = new Set(outline.map((edge) => edge.segmentId))
  for (const segmentId of Object.keys(piece.seamAllowance.perEdge ?? {})) {
    const item: ItemRef = { kind: 'seamAllowance', pieceId: piece.id, segmentId }
    if (!inOutline.has(segmentId)) {
      issues.push({ kind: 'unknown-seam-allowance-edge', item, segmentId, message: `Piece '${piece.name}' has an allowance for '${segmentId}', which isn't in its outline` })
    } else if (segmentId === fold?.segmentId) {
      issues.push({ kind: 'fold-edge-has-allowance', item, segmentId, message: `Piece '${piece.name}' has an allowance on '${segmentId}', but it's cut on the fold, so its allowance is 0` })
    }
  }
}

/**
 * Each edge's width, or undefined if a formula an edge actually uses failed. An override is found by
 * hasOwn, never by its value: failed formulas have no value, so falling back to the default on a missing
 * value would silently print a broken override at the default width.
 */
function edgeWidths(
  piece: Piece,
  outline: readonly OutlineEdge[],
  fold: ResolvedFold | undefined,
  allowances: ReadonlyMap<string, number>
): EdgeAllowance[] | undefined {
  const widths: EdgeAllowance[] = []
  const perEdge = piece.seamAllowance.perEdge ?? {}
  for (const edge of outline) {
    if (edge.segmentId === fold?.segmentId) {
      widths.push({ edge, allowance: 0 })
      continue
    }
    const allowance = allowances.get(allowanceKey(piece.id, Object.hasOwn(perEdge, edge.segmentId) ? edge.segmentId : null))
    if (allowance === undefined) return undefined
    widths.push({ edge, allowance })
  }
  return widths
}

function resolveCutLine(
  piece: Piece,
  item: ItemRef,
  outline: readonly OutlineEdge[],
  orientation: Orientation,
  notches: readonly ResolvedNotch[],
  fold: ResolvedFold | undefined,
  allowances: ReadonlyMap<string, number>,
  issues: EvaluationIssue[]
): CutLine | undefined {
  const widths = edgeWidths(piece, outline, fold, allowances)
  if (!widths) return undefined
  const built = buildCutLine(widths, orientation, fold?.segmentId)
  if (!built.ok) {
    issues.push({ kind: 'cut-line-failed', item, failure: built.failure, message: cutLineFailureMessage(piece.name, built.failure) })
    return undefined
  }
  const widthOf = new Map(widths.map(({ edge, allowance }) => [edge.segmentId, allowance]))
  return {
    ...built.line,
    notches: notches.map((notch) => placeCutNotch(notch.id, notch.point, notch.outward, widthOf.get(notch.segmentId) ?? 0, built.line.ring))
  }
}

/** The one place cut line failures become words. */
function cutLineFailureMessage(pieceName: string, failure: CutLineFailure): string {
  switch (failure.kind) {
    case 'out-of-range':
      return `Piece '${pieceName}' is too large for a cut line: the limit is 100 m`
    case 'source-self-intersects':
      return `Piece '${pieceName}': the seam line crosses itself, so it has no cut line`
    case 'cusp':
      return `Piece '${pieceName}': segment '${failure.segmentId}' has a cusp, so its allowance can't be drawn`
    case 'edge-swallowed':
      return `Piece '${pieceName}': the allowances next to segment '${failure.segmentId}' cover it completely; make them narrower`
    case 'split':
      return `Piece '${pieceName}': the allowances close part of the outline, which splits the cut line into ${failure.rings} parts`
    case 'crosses-fold':
      return `Piece '${pieceName}': the cut line goes past the fold along '${failure.segmentId}'`
    case 'source-outside':
      return `Piece '${pieceName}': the cut line doesn't contain the seam line`
    case 'engine-failed':
      return `Piece '${pieceName}': the cut line couldn't be built (${failure.detail})`
    default: {
      const _exhaustive: never = failure
      return _exhaustive
    }
  }
}
