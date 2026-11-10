/**
 * Pure 2D geometry kernel: vectors, lines and cubic beziers. Knows nothing about patterns, ids or
 * issues. Inputs are assumed finite; evaluate() drops non-finite coordinates before they get here.
 *
 * y points down (SVG), so a positive signed area means clockwise on screen.
 */

export interface Vec2 {
  readonly x: number
  readonly y: number
}

export interface LineCurve {
  readonly kind: 'line'
  readonly from: Vec2
  readonly to: Vec2
}

export interface CubicCurve {
  readonly kind: 'cubic'
  readonly from: Vec2
  readonly c1: Vec2
  readonly c2: Vec2
  readonly to: Vec2
}

/** Parameterised over t in [0, 1] from `from` to `to`. Exact control points are kept for rendering. */
export type Curve = LineCurve | CubicCurve

export interface CurveSample {
  readonly point: Vec2
  /** Unit tangent in the curve's direction of travel. */
  readonly tangent: Vec2
}

export type SampleResult =
  | { readonly ok: true; readonly sample: CurveSample }
  | { readonly ok: false; readonly reason: 'out-of-range'; readonly length: number }
  | { readonly ok: false; readonly reason: 'degenerate' }

/** Absolute error bound for arc length and its inverse, in mm. */
export const LENGTH_TOLERANCE = 1e-6
/** Curves shorter than this have no tangent. */
export const DEGENERATE_LENGTH = 1e-9
/** Smallest flattening tolerance honoured, so subdivision always terminates. */
export const MIN_FLATTEN_TOLERANCE = 1e-4

const MAX_DEPTH = 20

export const vec = (x: number, y: number): Vec2 => ({ x, y })
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k })
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y
/** z of the 2D cross product. Positive means b turns clockwise from a on screen. */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x
export const norm = (a: Vec2): number => Math.hypot(a.x, a.y)
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y)
const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

/** The points that define a curve: from, [c1, c2,] to. The curve lies inside their convex hull. */
export function curvePoints(curve: Curve): Vec2[] {
  switch (curve.kind) {
    case 'line':
      return [curve.from, curve.to]
    case 'cubic':
      return [curve.from, curve.c1, curve.c2, curve.to]
    default: {
      const _exhaustive: never = curve
      return _exhaustive
    }
  }
}

/** Position at parameter t (de Casteljau for cubics). */
export function pointAt(curve: Curve, t: number): Vec2 {
  switch (curve.kind) {
    case 'line':
      return lerp(curve.from, curve.to, t)
    case 'cubic': {
      const [left] = splitCubic(curve, t)
      return left.to
    }
    default: {
      const _exhaustive: never = curve
      return _exhaustive
    }
  }
}

/** dP/dt, not normalised. */
export function derivativeAt(curve: Curve, t: number): Vec2 {
  switch (curve.kind) {
    case 'line':
      return sub(curve.to, curve.from)
    case 'cubic': {
      const u = 1 - t
      const a = scale(sub(curve.c1, curve.from), 3 * u * u)
      const b = scale(sub(curve.c2, curve.c1), 6 * u * t)
      const c = scale(sub(curve.to, curve.c2), 3 * t * t)
      return add(add(a, b), c)
    }
    default: {
      const _exhaustive: never = curve
      return _exhaustive
    }
  }
}

/** The same curve traversed the other way; endpoint objects are reused, not copied. */
export function reverseCurve(curve: Curve): Curve {
  switch (curve.kind) {
    case 'line':
      return { kind: 'line', from: curve.to, to: curve.from }
    case 'cubic':
      return { kind: 'cubic', from: curve.to, c1: curve.c2, c2: curve.c1, to: curve.from }
    default: {
      const _exhaustive: never = curve
      return _exhaustive
    }
  }
}

/** Arc length to within LENGTH_TOLERANCE. Exact for lines. */
export function curveLength(curve: Curve): number {
  return lengthBetween(curve, 0, 1)
}

// 5-point Gauss-Legendre on [-1, 1].
const GL5: readonly (readonly [node: number, weight: number])[] = [
  [0, 0.5688888888888889],
  [-0.5384693101056831, 0.4786286704993665],
  [0.5384693101056831, 0.4786286704993665],
  [-0.906179845938664, 0.2369268850561891],
  [0.906179845938664, 0.2369268850561891]
]

function lengthBetween(curve: Curve, t0: number, t1: number): number {
  if (curve.kind === 'line') return distance(curve.from, curve.to) * (t1 - t0)

  const speed = (t: number): number => norm(derivativeAt(curve, t))
  const gauss = (a: number, b: number): number => {
    const half = (b - a) / 2
    const mid = (a + b) / 2
    let sum = 0
    for (const [node, weight] of GL5) sum += weight * speed(mid + half * node)
    return sum * half
  }
  // Adaptive: |B'| is smooth except where it touches zero (cusps, or a control point on its anchor,
  // which relative control points produce often). Splitting concentrates work at those spots.
  const recurse = (a: number, b: number, whole: number, depth: number): number => {
    const m = (a + b) / 2
    const left = gauss(a, m)
    const right = gauss(m, b)
    if (depth >= MAX_DEPTH || Math.abs(left + right - whole) <= LENGTH_TOLERANCE * (b - a)) return left + right
    return recurse(a, m, left, depth + 1) + recurse(m, b, right, depth + 1)
  }
  return recurse(t0, t1, gauss(t0, t1), 0)
}

/** The t at which the arc length from the start is `s` (0 <= s <= total). */
function parameterAtLength(curve: Curve, s: number, total: number): number {
  if (curve.kind === 'line') return s / total
  // Safeguarded Newton: keep a bracket and bisect whenever a Newton step would leave it.
  let lo = 0
  let hi = 1
  let t = s / total
  for (let i = 0; i < 50; i++) {
    const f = lengthBetween(curve, 0, t) - s
    if (Math.abs(f) <= LENGTH_TOLERANCE) return t
    if (f > 0) hi = t
    else lo = t
    const speed = norm(derivativeAt(curve, t))
    const next = speed > 0 ? t - f / speed : Number.NaN
    t = next > lo && next < hi ? next : (lo + hi) / 2
  }
  return t
}

/** Unit tangent at t, defined even where B'(t) = 0 (e.g. c1 on `from`) unless the curve is a point. */
function tangentAt(curve: Curve, t: number): Vec2 | undefined {
  const candidates: Vec2[] = [derivativeAt(curve, t)]
  if (curve.kind === 'cubic') {
    // Where B' vanishes, the direction of travel is the limit of B'; nudging t inwards finds it.
    const inward = t < 0.5 ? Math.min(t + 1e-6, 1) : Math.max(t - 1e-6, 0)
    candidates.push(derivativeAt(curve, inward), sub(curve.to, curve.from))
  }
  for (const candidate of candidates) {
    const length = norm(candidate)
    if (length > DEGENERATE_LENGTH) return scale(candidate, 1 / length)
  }
  return undefined
}

function sampleAt(curve: Curve, t: number): SampleResult {
  const tangent = tangentAt(curve, t)
  if (!tangent) return { ok: false, reason: 'degenerate' }
  return { ok: true, sample: { point: pointAt(curve, t), tangent } }
}

/**
 * Point and tangent at arc length `along` from `from`. Values within LENGTH_TOLERANCE of either end
 * are clamped, so `sampleAtLength(c, curveLength(c))` always succeeds on a non-degenerate curve.
 */
export function sampleAtLength(curve: Curve, along: number): SampleResult {
  const total = curveLength(curve)
  if (total < DEGENERATE_LENGTH) return { ok: false, reason: 'degenerate' }
  if (along < -LENGTH_TOLERANCE || along > total + LENGTH_TOLERANCE) {
    return { ok: false, reason: 'out-of-range', length: total }
  }
  const s = Math.min(Math.max(along, 0), total)
  return sampleAt(curve, parameterAtLength(curve, s, total))
}

/** Point and tangent at parameter t in [0, 1]. */
export function sampleAtParameter(curve: Curve, t: number): SampleResult {
  if (curveLength(curve) < DEGENERATE_LENGTH) return { ok: false, reason: 'degenerate' }
  if (t < 0 || t > 1) return { ok: false, reason: 'out-of-range', length: curveLength(curve) }
  return sampleAt(curve, t)
}

function splitCubic(curve: CubicCurve, t: number): [CubicCurve, CubicCurve] {
  const ab = lerp(curve.from, curve.c1, t)
  const bc = lerp(curve.c1, curve.c2, t)
  const cd = lerp(curve.c2, curve.to, t)
  const abc = lerp(ab, bc, t)
  const bcd = lerp(bc, cd, t)
  const mid = lerp(abc, bcd, t)
  return [
    { kind: 'cubic', from: curve.from, c1: ab, c2: abc, to: mid },
    { kind: 'cubic', from: mid, c1: bcd, c2: cd, to: curve.to }
  ]
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a)
  const lengthSquared = dot(ab, ab)
  if (lengthSquared === 0) return distance(p, a)
  const t = Math.min(Math.max(dot(sub(p, a), ab) / lengthSquared, 0), 1)
  return distance(p, lerp(a, b, t))
}

/**
 * Polyline within `tolerance` of the curve. The first and last elements are the curve's own `from`
 * and `to` objects, so flattened neighbours join exactly.
 */
export function flatten(curve: Curve, tolerance: number): Vec2[] {
  if (curve.kind === 'line') return [curve.from, curve.to]
  const tol = Math.max(tolerance, MIN_FLATTEN_TOLERANCE)
  const points: Vec2[] = [curve.from]
  const recurse = (c: CubicCurve, depth: number): void => {
    // The curve is a convex combination of its control points with interior weights summing to at
    // most 3/4, so it lies within 3/4 of the controls' distance from the chord.
    const deviation = 0.75 * Math.max(distanceToSegment(c.c1, c.from, c.to), distanceToSegment(c.c2, c.from, c.to))
    if (deviation <= tol || depth >= MAX_DEPTH) {
      points.push(c.to)
      return
    }
    const [left, right] = splitCubic(c, 0.5)
    recurse(left, depth + 1)
    recurse(right, depth + 1)
  }
  recurse(curve, 0)
  points[points.length - 1] = curve.to
  return points
}

/** Max distance, in mm, between a chord of an offset chain and the true offset curve. */
export const OFFSET_TOLERANCE = 0.02

const OFFSET_MAX_DEPTH = 24
/** A control vector this small, relative to the largest beside it, has no direction worth using. */
const NEGLIGIBLE_VECTOR = 1e-9
/** Tangents either side of a split agree above this dot product. Below it the split landed on a cusp. */
const MIN_TANGENT_AGREEMENT = 0.5

export interface OffsetChain {
  /** Offset points, first and last exact. Empty only for a curve with no tangent. */
  readonly points: readonly Vec2[]
  /** points[i] was computed from source[i]. */
  readonly source: readonly Vec2[]
  /** False when a cusp makes the offset undefined. */
  readonly regular: boolean
}

/** The first candidate that isn't negligible beside the largest, as a unit vector. */
function firstDirection(candidates: readonly Vec2[]): Vec2 | undefined {
  const largest = Math.max(...candidates.map(norm))
  for (const candidate of candidates) {
    const length = norm(candidate)
    if (length > NEGLIGIBLE_VECTOR * largest) return scale(candidate, 1 / length)
  }
  return undefined
}

/** In order of preference, the vectors whose direction is the curve's direction of travel at its start. */
function startCandidates(curve: Curve): Vec2[] {
  if (curve.kind === 'line') return [sub(curve.to, curve.from)]
  return [sub(curve.c1, curve.from), sub(curve.c2, curve.from), sub(curve.to, curve.from)]
}

function endCandidates(curve: Curve): Vec2[] {
  if (curve.kind === 'line') return [sub(curve.to, curve.from)]
  return [sub(curve.to, curve.c2), sub(curve.to, curve.c1), sub(curve.to, curve.from)]
}

/** A whole curve smaller than DEGENERATE_LENGTH has no tangent. Sub-curves skip this: they can be tiny near a cusp. */
function tangentOfWholeCurve(candidates: readonly Vec2[]): Vec2 | undefined {
  return Math.max(...candidates.map(norm)) < DEGENERATE_LENGTH ? undefined : firstDirection(candidates)
}

/** Exact unit tangent where the curve starts, read from its control points. */
export function startTangent(curve: Curve): Vec2 | undefined {
  return tangentOfWholeCurve(startCandidates(curve))
}

/** Exact unit tangent where the curve ends, in its direction of travel. */
export function endTangent(curve: Curve): Vec2 | undefined {
  return tangentOfWholeCurve(endCandidates(curve))
}

/** Angular width of the cone holding every tangent of the cubic: at least pi when no half-plane holds them. */
function tangentConeWidth(curve: CubicCurve): number {
  const hodograph = [sub(curve.c1, curve.from), sub(curve.c2, curve.c1), sub(curve.to, curve.c2)]
  const largest = Math.max(...hodograph.map(norm))
  const vectors = hodograph.filter((v) => norm(v) > NEGLIGIBLE_VECTOR * largest)
  const [base] = vectors
  if (!base) return 0
  const angles = vectors.map((v) => Math.atan2(cross(base, v), dot(base, v)))
  return Math.max(...angles) - Math.min(...angles)
}

/**
 * The curve moved `offset` mm along `outward(tangent)`, as a chain within OFFSET_TOLERANCE of the true
 * offset. Every vertex is P(t) + offset * N(t) on the true curve; a polyline is never offset. A chord is
 * accepted on a bound measured after offsetting: all tangents lie in the hodograph's cone of width w, so
 * the offset stays within (|ab| / 2) * tan(w / 2) of its chord ab.
 */
export function offsetCurve(curve: Curve, offset: number, outward: (tangent: Vec2) => Vec2): OffsetChain {
  const first = startTangent(curve)
  const last = endTangent(curve)
  if (!first || !last) return { points: [], source: [], regular: true }
  const place = (point: Vec2, tangent: Vec2): Vec2 => add(point, scale(outward(tangent), offset))
  if (curve.kind === 'line') {
    return { points: [place(curve.from, first), place(curve.to, last)], source: [curve.from, curve.to], regular: true }
  }

  const points = [place(curve.from, first)]
  const source = [curve.from]
  let regular = true
  const recurse = (piece: CubicCurve, startDir: Vec2, endDir: Vec2, depth: number): void => {
    const end = place(piece.to, endDir)
    const width = tangentConeWidth(piece)
    const within =
      width < Math.PI && (distance(place(piece.from, startDir), end) / 2) * Math.tan(width / 2) <= OFFSET_TOLERANCE
    // A cone of pi or more never passes, however small the piece, so a cusp splits until the depth limit.
    if (within || depth >= OFFSET_MAX_DEPTH) {
      if (!within) regular = false
      points.push(end)
      source.push(piece.to)
      return
    }
    const [left, right] = splitCubic(piece, 0.5)
    const arriving = firstDirection(endCandidates(left))
    const leaving = firstDirection(startCandidates(right))
    if (!arriving || !leaving || dot(arriving, leaving) < MIN_TANGENT_AGREEMENT) regular = false
    const middle = leaving ?? arriving ?? endDir
    recurse(left, startDir, middle, depth + 1)
    recurse(right, middle, endDir, depth + 1)
  }
  recurse(curve, first, last, 0)
  return { points, source, regular }
}

// 3-point Gauss-Legendre on [0, 1]: exact for polynomials up to degree 5.
const GL3: readonly (readonly [node: number, weight: number])[] = [
  [0.5, 4 / 9],
  [0.5 - Math.sqrt(15) / 10, 5 / 18],
  [0.5 + Math.sqrt(15) / 10, 5 / 18]
]

/**
 * Signed area enclosed by a closed chain of curves (each `to` is the next `from`). Positive means
 * clockwise on screen. Exact: Green's theorem, 1/2 ∮ (x dy - y dx), whose integrand is a degree-5
 * polynomial for a cubic, so 3-point Gauss-Legendre integrates it without error.
 */
export function signedArea(chain: readonly Curve[]): number {
  let sum = 0
  for (const curve of chain) {
    if (curve.kind === 'line') {
      sum += cross(curve.from, curve.to)
      continue
    }
    for (const [t, weight] of GL3) sum += weight * cross(pointAt(curve, t), derivativeAt(curve, t))
  }
  return sum / 2
}

const fmt = (n: number): string => String(Math.round(n * 1e6) / 1e6)

/** SVG path data for a closed polygon with no repeated closing vertex. */
export function polygonPathData(ring: readonly Vec2[]): string {
  if (ring.length === 0) return ''
  return `${ring.map(({ x, y }, i) => `${i === 0 ? 'M' : 'L'} ${fmt(x)} ${fmt(y)}`).join(' ')} Z`
}

/**
 * SVG path data for a chain of curves, e.g. "M 0 0 C 1 2 3 4 5 6 L 7 8 Z". Shared by the canvas, SVG
 * export and PDF export so they render identical true curves. Assumes each curve starts where the
 * previous one ended.
 */
export function pathData(chain: readonly Curve[], options: { closed?: boolean } = {}): string {
  const first = chain[0]
  if (!first) return ''
  const parts = [`M ${fmt(first.from.x)} ${fmt(first.from.y)}`]
  for (const curve of chain) {
    switch (curve.kind) {
      case 'line':
        parts.push(`L ${fmt(curve.to.x)} ${fmt(curve.to.y)}`)
        break
      case 'cubic':
        parts.push(
          `C ${fmt(curve.c1.x)} ${fmt(curve.c1.y)} ${fmt(curve.c2.x)} ${fmt(curve.c2.y)} ${fmt(curve.to.x)} ${fmt(curve.to.y)}`
        )
        break
      default: {
        const _exhaustive: never = curve
        return _exhaustive
      }
    }
  }
  if (options.closed) parts.push('Z')
  return parts.join(' ')
}
