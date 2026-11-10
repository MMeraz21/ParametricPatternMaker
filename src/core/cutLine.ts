import {
  OFFSET_TOLERANCE,
  add,
  cross,
  curveLength,
  curvePoints,
  distance,
  dot,
  endTangent,
  flatten,
  offsetCurve,
  scale,
  startTangent,
  sub,
  type Curve,
  type Vec2
} from './geometry'
import type { Id } from './model'
import type { Orientation, OutlineEdge } from './outline'
import { areaOutside, ringIsSimple, unionRing, type UnionVertex } from './ringUnion'

/**
 * The cut line of a piece: each edge offset by its own allowance, corners joined by one ordered rule, and
 * the assembled ring cleaned by a union. Imports no Clipper symbol; ringUnion.ts owns that.
 */

/** A sharp corner's allowance tip is clipped at this many times the wider of its two allowances. */
export const MITER_LIMIT = 4

/** How far, in mm, a cut line can be from the true offset of its edge in any size. */
export const CUT_LINE_BOUND = 0.025
/** In mm. A diagonal edge shorter than this can round to a single grid point, so it contributes no chain. */
export const MIN_EDGE_LENGTH = 0.0015
/** How far a notch mark is cut inward from the cut line, in mm. */
export const NOTCH_MARK_LENGTH = 6
/** A cut line point may sit this far past the fold, in mm: rounding to the grid moves it by under this. */
export const FOLD_TOLERANCE = 0.001

/** 100 m, in mm. Keeps every coordinate well inside the integer range of the union. */
const MAX_COORDINATE = 1e5
/** An allowance this small, in mm, is a zero edge. */
const ZERO_ALLOWANCE = 1e-6
/** Seam area outside the ring allowed per mm of edge with next to no allowance, in mm²: the two flattenings there differ. */
const SEAM_SLIVER_PER_MM = 0.05
/** An allowance under this, in mm, is thin enough for the seam's flattening to reach past the ring. */
const THIN_ALLOWANCE = 2 * OFFSET_TOLERANCE

/** A connector parallel to neither edge. Otherwise an owner is the edge's position in the outline. */
const JOIN = -1

export interface CutNotch {
  readonly notchId: Id
  readonly at: Vec2
  readonly mark: readonly [Vec2, Vec2]
}

export type CutSpan =
  /** Every chord is parallel to the edge at `allowance`, or on the straight extension to its corner. */
  | { readonly kind: 'edge'; readonly segmentId: Id; readonly allowance: number; readonly points: readonly Vec2[] }
  /** A connector parallel to neither edge: a clipped miter, a step, a reflex cap. */
  | { readonly kind: 'join'; readonly after: Id; readonly before: Id; readonly points: readonly Vec2[] }

/**
 * Invariants, so a consumer never re-checks: `ring` is one simple closed polygon in outline direction,
 * contains the seam outline, and is within CUT_LINE_BOUND mm of the corner rule. Every non-degenerate edge
 * has at least one 'edge' span. Spans partition the ring in ring order; each span's first point is the
 * previous span's last.
 */
export interface CutLine {
  /** No repeated closing vertex. */
  readonly ring: readonly Vec2[]
  readonly spans: readonly CutSpan[]
  /** One per seam notch. Built from the ring, so "no cut line, no marks" holds by construction. */
  readonly notches: readonly CutNotch[]
}

export interface EdgeAllowance {
  readonly edge: OutlineEdge
  readonly allowance: number
}

export type CutLineFailure =
  | { readonly kind: 'out-of-range' }
  | { readonly kind: 'source-self-intersects' }
  | { readonly kind: 'cusp'; readonly segmentId: Id }
  | { readonly kind: 'edge-swallowed'; readonly segmentId: Id }
  | { readonly kind: 'split'; readonly rings: number }
  | { readonly kind: 'crosses-fold'; readonly segmentId: Id }
  | { readonly kind: 'source-outside' }
  | { readonly kind: 'engine-failed'; readonly detail: string }

export type CutLineResult =
  | { readonly ok: true; readonly line: Omit<CutLine, 'notches'> }
  | { readonly ok: false; readonly failure: CutLineFailure }

interface WorkingEdge {
  readonly segmentId: Id
  readonly allowance: number
  readonly curve: Curve
  readonly startDirection: Vec2
  readonly endDirection: Vec2
  readonly points: readonly Vec2[]
  readonly source: readonly Vec2[]
}

/** Replace a chain's end with `crossing`, dropping this many of its points from that end. */
interface Trim {
  readonly crossing: Vec2
  readonly dropped: number
}

interface OwnedVertex {
  readonly point: Vec2
  /** Who owns the raw segment that ends at this vertex. */
  readonly owner: number
}

interface Corner {
  /** Between the end of the first edge's chain and the start of the second's. */
  readonly vertices: readonly OwnedVertex[]
  /** Who owns the raw segment that arrives at the second edge's first point. */
  readonly arrivingOwner: number
  readonly trimEndOfFirst?: Trim
  readonly trimStartOfSecond?: Trim
}

/** The unit normal pointing out of a piece, for a unit tangent in outline direction. y is down. */
export function outwardNormal(tangent: Vec2, orientation: Orientation): Vec2 {
  return orientation === 'clockwise' ? { x: tangent.y, y: -tangent.x } : { x: -tangent.y, y: tangent.x }
}

/** Where a ray first crosses the ring. Undefined if it never does. */
function rayExit(origin: Vec2, direction: Vec2, ring: readonly Vec2[]): Vec2 | undefined {
  let nearest = Infinity
  ring.forEach((a, i) => {
    const edge = sub(ring[(i + 1) % ring.length] ?? a, a)
    const determinant = cross(direction, edge)
    if (determinant === 0) return
    const toEdge = sub(a, origin)
    const along = cross(toEdge, edge) / determinant
    const across = cross(toEdge, direction) / determinant
    if (along > 1e-9 && along < nearest && across >= 0 && across <= 1) nearest = along
  })
  return nearest === Infinity ? undefined : add(origin, scale(direction, nearest))
}

/** Where a seam notch reaches the cut line, and its mark. Every seam notch gets one. */
export function placeCutNotch(notchId: Id, point: Vec2, outward: Vec2, allowance: number, ring: readonly Vec2[]): CutNotch {
  // This close, the ring sits on the seam, so a ray from it would skip to whatever edge is next.
  const at = allowance < MIN_EDGE_LENGTH ? point : (rayExit(point, outward, ring) ?? add(point, scale(outward, allowance)))
  return { notchId, at, mark: [at, sub(at, scale(outward, NOTCH_MARK_LENGTH))] }
}

/** Where the two offset tangent lines meet. Undefined for parallel normals. */
function miterPoint(corner: Vec2, nA: Vec2, a: number, nB: Vec2, b: number): Vec2 | undefined {
  const determinant = cross(nA, nB)
  if (Math.abs(determinant) < 1e-9) return undefined
  return add(corner, { x: (a * nB.y - b * nA.y) / determinant, y: (b * nA.x - a * nB.x) / determinant })
}

/** The rule for where two edges' offsets meet. The first row that matches wins. Never changes its inputs. */
function joinCorner(a: WorkingEdge, b: WorkingEdge, ownerA: number, ownerB: number, orientation: Orientation): Corner {
  const corner = a.curve.to
  const [tA, tB] = [a.endDirection, b.startDirection]
  const [nA, nB] = [outwardNormal(tA, orientation), outwardNormal(tB, orientation)]
  const connector: Corner = { vertices: [], arrivingOwner: JOIN }
  const [aIsZero, bIsZero] = [a.allowance <= ZERO_ALLOWANCE, b.allowance <= ZERO_ALLOWANCE]
  // Row 1: two zero edges share the seam vertex.
  if (aIsZero && bIsZero) return { vertices: [], arrivingOwner: ownerB }

  // Row 2: parallel tangents.
  const miter = miterPoint(corner, nA, a.allowance, nB, b.allowance)
  if (!miter) return connector
  const turn = cross(tA, tB)
  const convex = orientation === 'clockwise' ? turn > 0 : turn < 0
  // Row 3: reflex, through the corner. The union removes the loop this makes.
  if (!convex) return { vertices: [{ point: corner, owner: JOIN }], arrivingOwner: JOIN }

  const endOfA = add(corner, scale(nA, a.allowance))
  const startOfB = add(corner, scale(nB, b.allowance))
  const s = dot(sub(miter, endOfA), tA)
  const r = dot(sub(startOfB, miter), tB)
  // Row 4: both chains extend straight to the miter, clipped at the limit.
  if (s >= -1e-9 && r >= -1e-9) {
    const reach = distance(miter, corner)
    const limit = MITER_LIMIT * Math.max(a.allowance, b.allowance)
    if (reach <= limit) return { vertices: [{ point: miter, owner: ownerA }], arrivingOwner: ownerB }
    const direction = scale(sub(miter, corner), 1 / reach)
    const clip = add(corner, scale(direction, limit))
    const onLine = (start: Vec2, tangent: Vec2): Vec2 => add(start, scale(tangent, dot(sub(clip, start), direction) / dot(tangent, direction)))
    return {
      vertices: [
        { point: onLine(endOfA, tA), owner: ownerA },
        { point: onLine(startOfB, tB), owner: JOIN }
      ],
      arrivingOwner: ownerB
    }
  }

  // Row 5: the non-zero chain shortens to land on the zero edge's line.
  if (aIsZero && r < 0) {
    const trimStartOfSecond = walkToLine(b.points, b.source, corner, nA)
    if (trimStartOfSecond) return { vertices: [], arrivingOwner: ownerA, trimStartOfSecond }
  }
  if (bIsZero && s < 0) {
    const trimEndOfFirst = walkToLine(a.points.toReversed(), a.source.toReversed(), corner, nB)
    if (trimEndOfFirst) return { vertices: [], arrivingOwner: ownerB, trimEndOfFirst }
  }
  // Row 6: a connector, so neither edge loses any of its allowance.
  return connector
}

/**
 * Walk a chain from its start to where it first comes back across the line through `onLine` with normal
 * `normal`. Refuses if the source edge crosses the line before the chain does: then the line isn't a boundary.
 */
function walkToLine(points: readonly Vec2[], source: readonly Vec2[], onLine: Vec2, normal: Vec2): Trim | undefined {
  const side = (point: Vec2): number => dot(normal, sub(point, onLine))
  for (let i = 0; i + 1 < points.length; i++) {
    const [from, to, sourceTo] = [points[i], points[i + 1], source[i + 1]]
    if (!from || !to || !sourceTo || side(sourceTo) > 1e-9) return undefined
    const [before, after] = [side(from), side(to)]
    if (before > 0 && after <= 0) return { crossing: add(from, scale(sub(to, from), before / (before - after))), dropped: i + 1 }
  }
  return undefined
}

/** Each edge's chain with its corners' trims applied. All corners decide first, so their order can't matter. */
function trimmedChains(edges: readonly WorkingEdge[], corners: readonly Corner[]): Vec2[][] {
  return edges.map(({ points }, i) => {
    const start = corners[(i - 1 + edges.length) % edges.length]?.trimStartOfSecond
    const end = corners[i]?.trimEndOfFirst
    const kept = points.slice(start?.dropped ?? 0, points.length - (end?.dropped ?? 0))
    return [...(start ? [start.crossing] : []), ...kept, ...(end ? [end.crossing] : [])]
  })
}

/** The raw ring, and who owns each raw segment (segment k runs from vertex k to vertex k + 1). */
function assembleRing(chains: readonly (readonly Vec2[])[], corners: readonly Corner[]): { ring: Vec2[]; owners: number[] } {
  const ring: Vec2[] = []
  const owners: number[] = []
  const push = (point: Vec2, owner: number): void => {
    if (ring.length > 0) owners.push(owner)
    ring.push(point)
  }
  chains.forEach((chain, i) => {
    chain.forEach((point, k) => {
      push(point, k === 0 ? (corners[(i - 1 + chains.length) % chains.length]?.arrivingOwner ?? JOIN) : i)
    })
    for (const { point, owner } of corners[i]?.vertices ?? []) push(point, owner)
  })
  owners.push(corners.at(-1)?.arrivingOwner ?? JOIN)
  return { ring, owners }
}

/** Who owns the chord from `p` to `q`: the raw segment both ends lie on, else an owner they share, else a join. */
export function chordOwner(p: UnionVertex, q: UnionVertex, owners: readonly number[]): number {
  const count = owners.length
  const ownerOf = (segment: number): number => owners[segment] ?? JOIN
  const leaving = p.origin.kind === 'input' ? [p.origin.last] : p.origin.segments
  const arriving = q.origin.kind === 'input' ? [(q.origin.first - 1 + count) % count] : q.origin.segments
  const shared = leaving.find((segment) => arriving.includes(segment))
  if (shared !== undefined) return ownerOf(shared)
  const arrivingOwners = arriving.map(ownerOf)
  return leaving.map(ownerOf).find((owner) => arrivingOwners.includes(owner)) ?? JOIN
}

/** Runs of chords with one owner, starting at the first run of the lowest-numbered edge. */
function toSpans(vertices: readonly UnionVertex[], owners: readonly number[], edges: readonly WorkingEdge[]): Omit<CutLine, 'notches'> {
  const count = vertices.length
  const chordOwners = vertices.map((vertex, k) => chordOwner(vertex, vertices[(k + 1) % count] ?? vertex, owners))

  let start = 0
  let lowest = Infinity
  chordOwners.forEach((owner, k) => {
    if (owner !== JOIN && owner !== chordOwners[(k - 1 + count) % count] && owner < lowest) {
      lowest = owner
      start = k
    }
  })
  const rotate = <T>(items: readonly T[]): T[] => [...items.slice(start), ...items.slice(0, start)]
  const orderedOwners = rotate(chordOwners)
  const ring = rotate(vertices.map((vertex) => vertex.point))

  const runs: { owner: number; from: number; to: number }[] = []
  orderedOwners.forEach((owner, k) => {
    const current = runs.at(-1)
    if (current && current.owner === owner) current.to = k + 1
    else runs.push({ owner, from: k, to: k + 1 })
  })

  const edgeRunOwner = (index: number, step: 1 | -1): number => {
    for (let offset = 1; offset <= runs.length; offset++) {
      const owner = runs[(index + step * offset + runs.length * 2) % runs.length]?.owner
      if (owner !== undefined && owner !== JOIN) return owner
    }
    return JOIN
  }
  const idOf = (owner: number): Id => edges[owner]?.segmentId ?? ''
  const spans = runs.map(({ owner, from, to }, index): CutSpan => {
    const points = [...ring, ...ring].slice(from, to + 1)
    const edge = edges[owner]
    if (edge) return { kind: 'edge', segmentId: edge.segmentId, allowance: edge.allowance, points }
    return { kind: 'join', after: idOf(edgeRunOwner(index, -1)), before: idOf(edgeRunOwner(index, 1)), points }
  })
  return { ring, spans }
}

const inRange = ({ edge, allowance }: EdgeAllowance): boolean =>
  allowance >= 0 && curvePoints(edge.curve).every(({ x, y }) => Math.abs(x) + allowance <= MAX_COORDINATE && Math.abs(y) + allowance <= MAX_COORDINATE)

/** Total and pure: every input yields a result. Never throws. `fold` is the id of the edge cut on the fold. */
export function buildCutLine(input: readonly EdgeAllowance[], orientation: Orientation, fold?: Id): CutLineResult {
  const failed = (failure: CutLineFailure): CutLineResult => ({ ok: false, failure })
  const outward = (tangent: Vec2): Vec2 => outwardNormal(tangent, orientation)

  if (!input.every(inRange)) return failed({ kind: 'out-of-range' })

  const usable = input.filter(({ edge }) => curveLength(edge.curve) >= MIN_EDGE_LENGTH)
  const seam = usable.flatMap(({ edge }) => flatten(edge.curve, OFFSET_TOLERANCE).slice(0, -1))
  const seamCheck = ringIsSimple(seam)
  if (!seamCheck.ok) return failed({ kind: 'engine-failed', detail: seamCheck.detail })
  if (!seamCheck.simple) return failed({ kind: 'source-self-intersects' })

  const edges: WorkingEdge[] = []
  for (const { edge, allowance } of usable) {
    const startDirection = startTangent(edge.curve)
    const endDirection = endTangent(edge.curve)
    if (!startDirection || !endDirection) continue
    const { points, source, regular } = offsetCurve(edge.curve, allowance, outward)
    // At zero the chain is the curve itself, so a cusp in it needs no offset.
    if (!regular && allowance > ZERO_ALLOWANCE) return failed({ kind: 'cusp', segmentId: edge.segmentId })
    edges.push({ segmentId: edge.segmentId, allowance, curve: edge.curve, startDirection, endDirection, points, source })
  }

  const corners = edges.map((edge, i) => {
    const j = (i + 1) % edges.length
    return joinCorner(edge, edges[j] ?? edge, i, j, orientation)
  })
  const { ring, owners } = assembleRing(trimmedChains(edges, corners), corners)

  const union = unionRing(ring)
  if (!union.ok) return failed({ kind: 'engine-failed', detail: union.detail })
  const [only, ...others] = union.rings
  if (!only || others.length > 0) return failed({ kind: 'split', rings: union.rings.length })
  const line = toSpans(only, owners, edges)

  const swallowed = edges.find(({ segmentId }) => !line.spans.some((span) => span.kind === 'edge' && span.segmentId === segmentId))
  if (swallowed) return failed({ kind: 'edge-swallowed', segmentId: swallowed.segmentId })

  const foldEdge = edges.find(({ segmentId }) => segmentId === fold)
  if (foldEdge) {
    const normal = outward(foldEdge.startDirection)
    const beyond = line.ring.some((point) => dot(normal, sub(point, foldEdge.curve.from)) > FOLD_TOLERANCE)
    if (beyond) return failed({ kind: 'crosses-fold', segmentId: foldEdge.segmentId })
  }

  const thinLength = usable.reduce((sum, { edge, allowance }) => (allowance < THIN_ALLOWANCE ? sum + edge.length : sum), 0)
  if (areaOutside(seam, line.ring) > SEAM_SLIVER_PER_MM * thinLength) return failed({ kind: 'source-outside' })

  return { ok: true, line }
}
