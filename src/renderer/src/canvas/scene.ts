import {
  add,
  curvePoints,
  distance,
  pathData,
  polygonPathData,
  scale,
  segmentPointIds,
  sub,
  type Id,
  type Pattern,
  type NestGap,
  type NestGhost,
  type ResolvedGrainline,
  type Segment,
  type SizeName,
  type SizeView,
  type Vec2
} from '@core'
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
  /** Every other size, stacked on the shown one. Empty unless the nest is shown. */
  readonly ghosts: readonly SceneGhost[]
  /** One entry per size. Empty unless the nest is shown. */
  readonly legend: readonly LegendEntry[]
  /** Fit target: everything drawn, including the nest when it's shown. Null when nothing resolved. */
  readonly bounds: Bounds | null
  /** The same for the shown size alone. */
  readonly shownBounds: Bounds | null
}

export interface SceneGhost {
  readonly key: string
  readonly size: SizeName
  readonly pieceName: string
  readonly d: string
  readonly cutD: string | null
  readonly offset: Vec2
  readonly tint: string
}

export interface LegendEntry {
  readonly size: SizeName
  readonly tint: string
  readonly shown: boolean
  /** 'Neckband: no outline', 'Front: no cut line'. */
  readonly gaps: readonly string[]
}

export interface ScenePiece {
  readonly id: Id
  readonly name: string
  readonly d: string
  /** Null when the piece has no cut line; an issue says why. */
  readonly cutD: string | null
  readonly notchMarks: readonly (readonly [Vec2, Vec2])[]
  readonly grainlineD: string | null
  readonly fold: readonly [Vec2, Vec2] | null
  readonly selected: boolean
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

/** How far back the two barbs of a grainline arrowhead reach, in mm. */
const GRAINLINE_HEAD_LENGTH = 12
/** Each barb's offset from the shaft, as a fraction of the head length. */
const GRAINLINE_HEAD_WIDTH = 0.4

/** The shaft, then a barb, the tip and the other barb. */
function grainlinePath({ from, to }: ResolvedGrainline): string {
  const along = scale(sub(from, to), 1 / distance(from, to))
  const across = { x: -along.y, y: along.x }
  const back = add(to, scale(along, GRAINLINE_HEAD_LENGTH))
  const barb = (side: 1 | -1): Vec2 => add(back, scale(across, side * GRAINLINE_HEAD_LENGTH * GRAINLINE_HEAD_WIDTH))
  return `${pathData([{ kind: 'line', from, to }])} ${pathData([
    { kind: 'line', from: barb(1), to },
    { kind: 'line', from: to, to: barb(-1) }
  ])}`
}

const GAP_TEXT: Readonly<Record<NestGap['reason'], string>> = { 'no-outline': 'no outline', 'no-cut-line': 'no cut line', 'no-stack-point': 'no stack point' }

/** Small sizes cool, large sizes warm, so a size reads by its place in the run. */
function sizeTint(index: number, count: number): string {
  const hue = 215 + (count > 1 ? index / (count - 1) : 0) * 145
  return `hsl(${Math.round(hue)} 65% 45%)`
}

function ghostPoints({ piece, offset }: NestGhost): Vec2[] {
  return [...piece.outline.flatMap((edge) => curvePoints(edge.curve)), ...(piece.cutLine?.ring ?? [])].map((point) => add(point, offset))
}

function sceneGhost(ghost: NestGhost, count: number): SceneGhost {
  const { size, sizeIndex, piece, offset } = ghost
  return {
    key: `${size}:${piece.id}`,
    size,
    pieceName: piece.name,
    d: pathData(
      piece.outline.map((edge) => edge.curve),
      { closed: true }
    ),
    cutD: piece.cutLine ? polygonPathData(piece.cutLine.ring) : null,
    offset,
    tint: sizeTint(sizeIndex, count)
  }
}

export function buildScene(pattern: Pattern, view: SizeView, selection: Selection | null, nestShown: boolean): Scene {
  const { resolved } = view
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
    ),
    cutD: piece.cutLine ? polygonPathData(piece.cutLine.ring) : null,
    notchMarks: piece.cutLine?.notches.map((notch) => notch.mark) ?? [],
    grainlineD: piece.grainline ? grainlinePath(piece.grainline) : null,
    fold: piece.fold ? ([piece.fold.from, piece.fold.to] as const) : null,
    selected: selection?.kind === 'piece' && selection.id === piece.id
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

  const shownPoints = [
    ...markers.map((marker) => marker.at),
    ...Object.values(resolved.segments).flatMap((s) => curvePoints(s.curve)),
    ...resolvedPieces.flatMap((piece) => piece.cutLine?.ring ?? [])
  ]
  const shownBounds = boundsOf(shownPoints)
  if (!nestShown) return { pieces, segments, handles, markers, ghosts: [], legend: [], bounds: shownBounds, shownBounds }

  const ghosts = view.nest.ghosts.map((ghost) => sceneGhost(ghost, view.sizes.length))
  const legend = view.sizes.map(
    ({ name }, index): LegendEntry => ({
      size: name,
      tint: sizeTint(index, view.sizes.length),
      shown: name === view.size,
      gaps: view.nest.gaps.filter((gap) => gap.size === name).map((gap) => `${gap.pieceName}: ${GAP_TEXT[gap.reason]}`)
    })
  )
  return { pieces, segments, handles, markers, ghosts, legend, bounds: boundsOf([...shownPoints, ...view.nest.ghosts.flatMap(ghostPoints)]), shownBounds }
}
