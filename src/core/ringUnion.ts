import { ClipType, Clipper64, FillRule, PathType, type Path64, type Paths64, type Point64 } from 'clipper2-ts'
import type { Vec2 } from './geometry'

/**
 * The only file that knows Clipper2, integers or fill rules. Every function is total: a library throw or
 * a coordinate that can't go on the grid becomes a failure value, so evaluate() can never throw from here.
 */

/** Integer grid units per mm: 1 micrometre. */
const GRID = 1000

export type RingVertexOrigin =
  /**
   * Input vertices `first` to `last`, merged because they land on one grid point; they're equal unless a
   * merge happened. The output segment arriving here is input segment first - 1, and the one leaving is `last`.
   */
  | { readonly kind: 'input'; readonly first: number; readonly last: number }
  /** Where two input segments cross, ascending. Segment i runs from vertex i to vertex i + 1. */
  | { readonly kind: 'crossing'; readonly segments: readonly [number, number] }

export interface UnionVertex {
  readonly point: Vec2
  readonly origin: RingVertexOrigin
}

export type UnionResult =
  | { readonly ok: true; readonly rings: readonly (readonly UnionVertex[])[] }
  | { readonly ok: false; readonly detail: string }

export type SimplicityResult = { readonly ok: true; readonly simple: boolean } | { readonly ok: false; readonly detail: string }

const OFF_GRID = "a coordinate can't be placed on the grid"

const failureDetail = (thrown: unknown): string => (thrown instanceof Error ? thrown.message : String(thrown))

/** On the grid, or undefined if any coordinate isn't representable there. `+ 0` turns -0 into 0. */
function toGrid(ring: readonly Vec2[]): Path64 | undefined {
  const path: Path64 = []
  for (const { x, y } of ring) {
    const point = { x: Math.round(x * GRID) + 0, y: Math.round(y * GRID) + 0 }
    if (!Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y)) return undefined
    path.push(point)
  }
  return path
}

const samePoint = (a: Point64 | undefined, b: Point64 | undefined): boolean => a !== undefined && b !== undefined && a.x === b.x && a.y === b.y

interface MergedRing {
  /** No two consecutive points equal, closing edge included. Each z is its position in this path + 1. */
  readonly path: Path64
  /** For each path position, the first and last input vertices merged into it. */
  readonly firstInput: number[]
  readonly lastInput: number[]
}

function mergeRepeats(grid: Path64): MergedRing {
  const path: Path64 = []
  const firstInput: number[] = []
  const lastInput: number[] = []
  grid.forEach((point, index) => {
    if (samePoint(path.at(-1), point)) {
      lastInput[lastInput.length - 1] = index
      return
    }
    path.push({ ...point, z: path.length + 1 })
    firstInput.push(index)
    lastInput.push(index)
  })
  const closingFirst = firstInput.at(-1)
  if (path.length > 1 && samePoint(path.at(-1), path[0]) && closingFirst !== undefined) {
    path.pop()
    firstInput.pop()
    lastInput.pop()
    firstInput[0] = closingFirst
  }
  return { path, firstInput, lastInput }
}

/** Twice the signed area of a grid path, exactly: 100 m is 1e8 grid units, whose products overflow a double. */
function doubledArea(path: Path64): bigint {
  let sum = 0n
  path.forEach((point, i) => {
    const next = path[(i + 1) % path.length]
    if (next) sum += BigInt(point.x) * BigInt(next.y) - BigInt(next.x) * BigInt(point.y)
  })
  return sum
}

const absolute = (value: bigint): bigint => (value < 0n ? -value : value)

/** The input segments that meet at a vertex of the merged path: the one leaving it and the one arriving. */
function segmentsAtVertex(merged: MergedRing, inputCount: number, z: number): readonly number[] {
  const [first, last] = [merged.firstInput[z - 1], merged.lastInput[z - 1]]
  return first === undefined || last === undefined ? [] : [last, (first - 1 + inputCount) % inputCount]
}

/** Positive-winding union of one closed ring, orientation normalised, on a 1 micrometre grid. Rings keep the input's direction. */
export function unionRing(ring: readonly Vec2[]): UnionResult {
  try {
    const grid = toGrid(ring)
    if (!grid) return { ok: false, detail: OFF_GRID }
    const merged = mergeRepeats(grid)
    if (merged.path.length < 3) return { ok: true, rings: [] }

    const area = doubledArea(merged.path)
    // z values below zero are crossings, indexing this list from the back: -1 is crossings[0].
    const crossings: (readonly [number, number])[] = []
    const union = new Clipper64()
    const segmentsAt = ({ z = 0 }: Point64): readonly number[] => (z < 0 ? (crossings[-z - 1] ?? []) : segmentsAtVertex(merged, grid.length, z))
    // Usually two input edges, but the library also reports crossings between points of its own output, whose
    // ends can be crossings or vertices that aren't neighbours. The segment they share is the one this edge lies on.
    const edgeSegment = (a: Point64, b: Point64): number => {
      const [atA, atB] = [segmentsAt(a), segmentsAt(b)]
      return atA.find((segment) => atB.includes(segment)) ?? atA[0] ?? atB[0] ?? 0
    }
    union.zCallback = (bot1, top1, bot2, top2, point) => {
      const [first, second] = [edgeSegment(bot1, top1), edgeSegment(bot2, top2)]
      crossings.push(first < second ? [first, second] : [second, first])
      point.z = -crossings.length
    }
    union.addPaths([merged.path], PathType.Subject, false)
    const out: Paths64 = []
    union.execute(ClipType.Union, area > 0n ? FillRule.Positive : FillRule.Negative, out)

    const originOf = ({ z = 0 }: Point64): RingVertexOrigin => {
      const [first, last] = z > 0 ? [merged.firstInput[z - 1], merged.lastInput[z - 1]] : []
      if (first !== undefined && last !== undefined) return { kind: 'input', first, last }
      const segments = z < 0 ? crossings[-z - 1] : undefined
      if (segments) return { kind: 'crossing', segments }
      throw new Error('the union produced a vertex with no origin')
    }
    const rings = out.map((path) => {
      const inInputDirection = doubledArea(path) > 0n === area > 0n ? path : path.toReversed()
      return inInputDirection.map((point) => ({ point: { x: point.x / GRID, y: point.y / GRID }, origin: originOf(point) }))
    })
    return { ok: true, rings }
  } catch (thrown) {
    return { ok: false, detail: failureDetail(thrown) }
  }
}

/** Exact on the grid: one ring out, with the same area as the ring in. */
export function ringIsSimple(ring: readonly Vec2[]): SimplicityResult {
  try {
    const grid = toGrid(ring)
    if (!grid) return { ok: false, detail: OFF_GRID }
    const { path } = mergeRepeats(grid)
    if (path.length < 3) return { ok: true, simple: false }

    const union = new Clipper64()
    union.addPaths([path], PathType.Subject, false)
    const out: Paths64 = []
    union.execute(ClipType.Union, FillRule.NonZero, out)
    const [only, ...others] = out
    return { ok: true, simple: only !== undefined && others.length === 0 && absolute(doubledArea(only)) === absolute(doubledArea(path)) }
  } catch (thrown) {
    return { ok: false, detail: failureDetail(thrown) }
  }
}

/** Area of `inner` outside `outer`, mm². Infinity when it can't be computed, so a guard reads it as outside. */
export function areaOutside(inner: readonly Vec2[], outer: readonly Vec2[]): number {
  try {
    const [subject, clip] = [toGrid(inner), toGrid(outer)]
    if (!subject || !clip) return Number.POSITIVE_INFINITY

    const difference = new Clipper64()
    difference.addPaths([subject], PathType.Subject, false)
    difference.addPaths([clip], PathType.Clip, false)
    const out: Paths64 = []
    difference.execute(ClipType.Difference, FillRule.NonZero, out)
    // Holes wind the opposite way, so summing signed areas subtracts them.
    const doubled = out.reduce((sum, path) => sum + doubledArea(path), 0n)
    return Number(absolute(doubled)) / 2 / (GRID * GRID)
  } catch {
    return Number.POSITIVE_INFINITY
  }
}
