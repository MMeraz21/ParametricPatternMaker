import { ClipType, Clipper64, FillRule, PathType, type Path64, type Paths64, type Point64 } from 'clipper2-ts'
import type { Vec2 } from './geometry'

/**
 * The only file that knows Clipper2, integers or fill rules. Every function is total: a library throw or
 * a coordinate that can't go on the grid becomes a failure value, so evaluate() can never throw from here.
 */

/** Integer grid units per mm: 1 micrometre. */
const GRID = 1000

export type RingVertexOrigin =
  /** The input vertex at `index`. Consecutive vertices on one grid point are merged and report the first. */
  | { readonly kind: 'input'; readonly index: number }
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

/** The input segment an edge of the merged path came from. */
function inputSegment(merged: MergedRing, a: Point64, b: Point64): number {
  const count = merged.path.length
  const [from, to] = [(a.z ?? 0) - 1, (b.z ?? 0) - 1]
  const lower = (from + 1) % count === to ? from : (to + 1) % count === from ? to : undefined
  const segment = lower === undefined ? undefined : merged.lastInput[lower]
  if (segment === undefined) throw new Error('a crossing is on an edge that is not in the ring')
  return segment
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
    union.zCallback = (bot1, top1, bot2, top2, point) => {
      const [first, second] = [inputSegment(merged, bot1, top1), inputSegment(merged, bot2, top2)]
      crossings.push(first < second ? [first, second] : [second, first])
      point.z = -crossings.length
    }
    union.addPaths([merged.path], PathType.Subject, false)
    const out: Paths64 = []
    union.execute(ClipType.Union, area > 0n ? FillRule.Positive : FillRule.Negative, out)

    const originOf = ({ z = 0 }: Point64): RingVertexOrigin => {
      const index = z > 0 ? merged.firstInput[z - 1] : undefined
      if (index !== undefined) return { kind: 'input', index }
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
