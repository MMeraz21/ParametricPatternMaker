# Milestone 5: pieces and seam allowance

Status: design, awaiting review. Nothing here is built except the extended raglan fixture.

## Problem

A piece needs a cut line: each outline edge offset outward by its own allowance, joined at corners,
accurate to a physical tolerance because it is printed 1:1. It also needs a resolved grainline,
notches that reach the cut line, and a way to author all of this. Milestone 2 already gives closed
oriented outlines, notches placed with an outward normal, and exact curves in outline direction.
Everything here extends that.

Four facts make the shape non-obvious.

- **Clipper2 has no per-edge offset.** `ClipperOffset` takes one delta per call. Its `deltaCallback`
  gives one delta per vertex, and that one delta drives both sides of the join. On a rectangle with
  allowances 10/10/25/0 it gives `[[125,225],[0,200],[-10,-10],[110,-10]]`, where the right edge runs
  from x=110 to x=125 instead of staying parallel. No configuration of Clipper's offset can produce
  this cut line.
- **Offsetting a flattened polyline amplifies error.** A chord error ε becomes about ε·(r+d)/r on the
  outside of a curve, and every flatten vertex becomes a join.
- **`evaluate` is pure, synchronous and never throws,** while the library is a third-party ESM package
  that throws on overflow.
- **`frontCf: 0` is the most common override.** A zero-allowance edge meets non-zero neighbours at both
  ends, and the cut line has to land on the fold without crossing it.

**The design.** Core computes every edge's offset from the true curve, joins neighbours with a rule it
owns, and uses Clipper2 once per piece: a union of the assembled ring, which removes local overlaps
and reports which input segment each output chord came from.

This departs from PLAN.md's wording, "seam allowance via Clipper2 offset". Clipper2 stays in the
design, but as the union and not the offset, because its offset cannot express per-edge widths.

## Usage (caller's view)

Nothing new to call. `evaluate` remains the single entry point, and the cut line is a field on the piece.

```ts
import { evaluate, polygonPathData } from '@core'

const resolved = evaluate(pattern, size)
const front = resolved.pieces['front']   // present whenever the outline is closed and has area

front.cutLine                            // absent means an issue explains why
front.grainline?.angle                   // absent means a grainline issue
front.fold?.segmentId                    // 'frontCf'
front.cutCount                           // 1
```

Canvas (`scene.ts`). The polygon is ready to draw, with no flattening or tolerance choice:

```ts
pieces.map((piece) => ({
  id: piece.id,
  name: piece.name,
  d: pathData(piece.outline.map((e) => e.curve), { closed: true }),
  cutD: piece.cutLine && polygonPathData(piece.cutLine.ring),
  notchMarks: piece.cutLine?.notches.map((n) => n.mark) ?? [],
  grainline: piece.grainline && [piece.grainline.from, piece.grainline.to],
  fold: piece.fold && [piece.fold.from, piece.fold.to]
}))
```

PDF and SVG export (M7), including a per-edge treatment such as a thicker hem line:

```ts
for (const span of piece.cutLine.spans) {
  drawPolyline(span.points, span.kind === 'edge' && span.segmentId === 'frontHem' ? hemStyle : cutStyle)
}
```

Fabric layout reads `cutLine.ring` as its polygon, `grainline.angle` for rotation, `cutCount` for how
many, and `fold` to place the piece against a fold.

Editing goes through the one `applyEdit`:

```ts
applyEdit(pattern, { kind: 'setPiece', pieceId: 'front', patch: { fold: 'frontCf' } })
applyEdit(pattern, { kind: 'setPiece', pieceId: 'front', patch: {
  seamAllowance: { default: 'seam', perEdge: { frontHem: 'hem' } } } })
```

## Shape

### Module map

| File | Owns | Public to |
|---|---|---|
| `core/geometry.ts` (grows) | `offsetCurve`, exact end tangents, `polygonPathData`. The accuracy bound lives here. No model imports. | core, renderer (`polygonPathData` only) |
| `core/cutLine.ts` (new) | Corner rule, raw ring assembly, span ownership, validity, `rayExit`. Imports no Clipper symbol. | `outline.ts` only |
| `core/ringUnion.ts` (new) | **The only importer of `clipper2-ts`.** Integer grid, `try/catch`, provenance. Domain types in and out. | `cutLine.ts` only |
| `core/outline.ts` (grows) | Grainline, fold, allowance lookup, failure-to-issue mapping, notch marks. | `evaluate.ts` |

The whole chain is `evaluate → resolveGeometry → resolvePiece → buildCutLine → unionRing`.

`index.ts` exports the types and `polygonPathData`, and not `buildCutLine`, `offsetCurve` or anything
from `ringUnion.ts`. Because `@core/*` deep imports exist, a new `core/boundaries.test.ts` scans
`src/**` and fails if `clipper2-ts` is imported outside `ringUnion.ts`, or if `@core/ringUnion` or
`@core/cutLine` is imported outside `src/core`.

### Resolved types

```ts
// outline.ts
export interface ResolvedPiece {
  readonly id: Id; readonly name: string
  readonly outline: readonly [OutlineEdge, ...OutlineEdge[]]
  readonly orientation: Orientation; readonly area: number
  readonly notches: readonly ResolvedNotch[]        // unchanged: seam-line notches
  readonly cutCount: number
  /** Absent only when a 'cut-line-failed' issue, or a failed allowance, explains it. */
  readonly cutLine?: CutLine
  readonly grainline?: ResolvedGrainline
  readonly fold?: ResolvedFold
}
export interface ResolvedGrainline { readonly from: Vec2; readonly to: Vec2; /** radians, atan2(dy, dx), y down */ readonly angle: number }
export interface ResolvedFold { readonly segmentId: Id; readonly from: Vec2; readonly to: Vec2 }

// cutLine.ts
/**
 * Invariants, so a consumer never re-checks: `ring` is one simple closed polygon in outline direction,
 * contains the seam outline, and is within CUT_LINE_BOUND mm of the corner rule below.
 * Every non-degenerate edge has at least one 'edge' span. Spans partition the ring in ring order;
 * each span's first point is the previous span's last.
 */
export interface CutLine {
  readonly ring: readonly Vec2[]                    // no repeated closing vertex
  readonly spans: readonly CutSpan[]
  /** One per seam notch. Built from the ring, so "no cut line, no marks" holds by construction. */
  readonly notches: readonly CutNotch[]
}
export type CutSpan =
  /** Every chord is parallel to the edge at `allowance`, or on the straight extension to its corner. */
  | { readonly kind: 'edge'; readonly segmentId: Id; readonly allowance: number; readonly points: readonly Vec2[] }
  /** A connector parallel to neither edge: a clipped miter, a step, a reflex cap. */
  | { readonly kind: 'join'; readonly after: Id; readonly before: Id; readonly points: readonly Vec2[] }
export interface CutNotch { readonly notchId: Id; readonly at: Vec2; readonly mark: readonly [Vec2, Vec2] }
```

`CutNotch.at` is where a ray from the seam notch along `outward` first leaves the ring (`rayExit`). A
fixed `point + allowance·outward` would miss the cut line next to a reflex corner. The ray always
exits, because the ring is checked to contain every source point, and a notch on a zero-allowance edge
returns its own point. So no notch can fail here and no issue kind is needed.

### How curves are flattened and offset, and why grading stays accurate

```ts
// geometry.ts
/** Max distance, in mm, between a chord of an offset chain and the true offset curve. */
export const OFFSET_TOLERANCE = 0.02

export interface OffsetChain {
  /** Offset points, first and last exact. Empty only for a curve with no tangent. */
  readonly points: readonly Vec2[]
  /** points[i] was computed from source[i]. */
  readonly source: readonly Vec2[]
  /** False when a cusp makes the offset undefined. */
  readonly regular: boolean
}
export function offsetCurve(curve: Curve, distance: number, outward: (tangent: Vec2) => Vec2): OffsetChain {
  // TODO recursive midpoint split of the cubic. Lines return two points.
  // For a sub-cubic:  a = P(t0) + d*N(t0),  b = P(t1) + d*N(t1)
  //   w = width of the cone holding the hodograph vectors (c1-p0, c2-c1, p3-c2)
  //   accept iff w < pi and (|ab| / 2) * tan(w / 2) <= OFFSET_TOLERANCE
  // Vectors under 1e-9 of the largest are skipped, so a control point on its anchor is fine.
  // Cusp: tangents either side of a split disagree (dot < 0.5), or depth 24 is reached. regular = false.
  throw new Error('not implemented')
}
export function startTangent(curve: Curve): Vec2 | undefined { throw new Error('not implemented') }
export function endTangent(curve: Curve): Vec2 | undefined { throw new Error('not implemented') }
export function polygonPathData(ring: readonly Vec2[]): string { throw new Error('not implemented') }
```

We never offset a polyline. Each vertex of the chain is computed as `P(t) + d·N(t)` on the true curve,
and a chord is accepted only if it is within tolerance measured in offset space. `flattenOutline` stays
for its existing purpose and for the simplicity check, and is not an input to the offset.

The accept test is a bound, not a heuristic. The offset `O = P + d·N` has derivative `P'·(1 + d·κ)`, so
where the offset is regular its tangent lies in the source tangent cone, which is the cone of the
hodograph's control vectors. A curve from `A` to `B` with all tangents in a cone of width `w` stays
inside the parallelogram `(A + cone) ∩ (B − cone)`, whose height above the chord is at most
`(|AB|/2)·tan(w/2)`. Outside-of-curve amplification is already in `|AB|`, because that is measured
after offsetting.

**Total bound, for regular offsets: 0.021 mm in every size.** That is 0.02 from `offsetCurve` plus
0.0007 from rounding to the 1 µm Clipper grid. Tests assert `CUT_LINE_BOUND = 0.025`. One 600 dpi
printer dot is 0.042 mm. Where `1 + d·κ < 0` the offset is the inverted part of a swallowtail, and the
union removes it. That part of the chain is not on the final ring, so the bound does not apply to it.

Grading. The tolerance is absolute, so S and XXL get the same physical accuracy. The test is applied per
chord, per size, and nothing reads another size's vertices. Corner decisions use exact end tangents,
never polyline directions, so where flattening falls cannot move a corner. Control points stay formulas
relative to their anchors, per the existing convention.

### How per-edge allowances meet at corners

Inputs at outline vertex `V` between edges `A` then `B`: exact unit tangents `tA` (end of A), `tB`
(start of B), outward normals `nA`, `nB`, allowances `a`, `b`. `A_end = V + a·nA`, `B_start = V + b·nB`.
`M` is the intersection of the two offset tangent lines. `s = (M − A_end)·tA` and `r = (B_start − M)·tB`,
so `s ≥ 0` means A extends forward to `M` and `r ≥ 0` means B extends backward to `M`. Convex means the
outline turns toward its interior.

The first row that matches wins.

| # | Condition | Join | Result |
|---|---|---|---|
| 1 | `a = 0` and `b = 0` | Share `V` | Chains meet at the seam vertex. |
| 2 | Tangents parallel (`\|cross(tA,tB)\| < 1e-9`) | Connector `A_end → B_start` | Equal allowances coincide. Unequal is a step along the normal. |
| 3 | Reflex | `A_end → V → B_start` | Self-overlap, removed by the union. Equals the union of the two edge bands. |
| 4 | Convex, `s ≥ 0`, `r ≥ 0` | **Miter at `M`, limited** | Both chains extend straight to `M`. If `\|M − V\| > 4·max(a,b)`, clip by a line perpendicular to `M − V` at that reach, giving a `join` chord between a point on A's line and a point on B's. |
| 5 | Convex, exactly one of `a`, `b` is zero, and the non-zero chain must shorten | **Landing** | Trim that chain where it crosses the zero edge's line. Refused if the non-zero edge itself crosses that line first; then row 6. |
| 6 | Convex otherwise | Connector `A_end → B_start` | Neither edge loses any of its allowance. |

How that covers the cases:

- **Different widths.** Row 4 gives the corner at each edge's own width. Hem 25 meeting side 10 lands at
  exactly `(285, 715)` on the M front. Row 6 handles the case where a miter would shorten the wider edge.
- **Zero fold edge.** The miter point is on the zero edge's line by construction, so the landing on a fold
  is structural. Row 5 is the shallow-angle case, where the neighbour's offset starts across the fold and
  is cut back to it. M front lands at `(0, 80)` and `(0, 715)`, and min x of the ring is exactly 0.
  Zero means at most 1e-6 mm.
- **Acute.** The limit in row 4. A 20° tip with 10 mm allowances is clipped to a 40 mm reach.
- **Reflex.** Row 3. An L-shape with 25 and 5 crosses at exactly `(55, 75)`.
- **Near tangent.** No angle threshold: rows 4 and 6 meet continuously where `s` or `r` is 0, and row 2 is
  only a numeric guard. A 0.5° corner with 25 and 10 gives a step `(100,−25) → (100.087,−10)`.
- **Curve to curve.** The same rule with exact end tangents, and extensions are straight. A G1 join with
  equal allowances meets at one vertex and has no join span.

Row 6 means span labels can change between sizes while the geometry stays continuous. The sleeve hem
does this: S uses row 4, and M to XXL use row 6. At M the connector ends 0.63 mm from where the miter
would be.

```ts
// cutLine.ts
export const MITER_LIMIT = 4           // × the larger allowance at the corner
export const CUT_LINE_BOUND = 0.025    // mm
export const MIN_EDGE_LENGTH = 0.001   // mm, one grid unit; shorter edges contribute no chain

export interface EdgeAllowance { readonly edge: OutlineEdge; readonly allowance: number }
export type CutLineResult =
  | { readonly ok: true; readonly line: Omit<CutLine, 'notches'> }
  | { readonly ok: false; readonly failure: CutLineFailure }

/** Total and pure: every input yields a result. Never throws. */
export function buildCutLine(edges: readonly EdgeAllowance[], orientation: Orientation, foldLine?: FoldLine): CutLineResult {
  // TODO, in order:
  //  1 range guard on every control point and allowance -> out-of-range
  //  2 drop edges under MIN_EDGE_LENGTH
  //  3 ringIsSimple(flattened source) -> source-self-intersects
  //  4 offsetCurve per edge -> cusp
  //  5 corner rule above, per corner
  //  6 raw ring, recording an owner for every raw SEGMENT (edge index, or join)
  //  7 unionRing -> split | engine-failed
  //  8 owner of each output chord = owner common to its two endpoint provenances; runs -> spans
  //  9 validity: edge-swallowed, crosses-fold, source-outside
  throw new Error('not implemented')
}
```

Ownership is recorded on raw **segments**, not vertices. A straight edge trimmed at both ends has no
surviving vertex of its own, and Clipper merges a miter point with a coincident chain end, so vertex tags
fail in both cases.

### How Clipper2 fits the core purity rule

```ts
// ringUnion.ts: the only file that knows Clipper2, integers, or fill rules.
export type RingVertexOrigin =
  | { readonly kind: 'input'; readonly index: number }
  | { readonly kind: 'crossing'; readonly segments: readonly [number, number] }
export interface UnionVertex { readonly point: Vec2; readonly origin: RingVertexOrigin }
export type UnionResult =
  | { readonly ok: true; readonly rings: readonly (readonly UnionVertex[])[] }
  | { readonly ok: false; readonly detail: string }

/** Positive-winding union of one closed ring, orientation normalised, on a 1 µm grid. */
export function unionRing(ring: readonly Vec2[]): UnionResult { throw new Error('not implemented') }
/** Exact on the grid: one ring out, with the same area as the ring in. */
export function ringIsSimple(ring: readonly Vec2[]): { readonly ok: true; readonly simple: boolean } | { readonly ok: false; readonly detail: string } { throw new Error('not implemented') }
/** Area of `inner` outside `outer`, mm². */
export function areaOutside(inner: readonly Vec2[], outer: readonly Vec2[]): number { throw new Error('not implemented') }
```

- **Package: `clipper2-ts`, pinned exactly at `2.0.1-19`, no caret.** It has no dependencies, a BSL-1.0
  licence, and its dist imports no Node or DOM symbol, so `src/core` keeps its rule the same way it does
  with `mathjs` and `zod`. It is pure JavaScript with no WASM or async setup, so `evaluate` stays
  synchronous. `clipper2-js` was rejected: unpublished since January 2024 and it has no Z channel.
- **Contained to one file and four runtime symbols:** `Clipper64`, `ClipType` (`Union` and, for
  `areaOutside`, `Difference`), `FillRule`, `PathType`. No Clipper type crosses the module boundary.
- **Prerelease risk.** The exact pin stops unplanned upgrades. A library-behaviour test pins what we
  depend on: a union keeps input Z values, `zCallback` tags crossings, and collinear vertices stay by default.
- **Module format.** The package is ESM only and the app is CJS on purpose. The renderer bundles it through
  Vite. Vitest loads it. Preload never imports core. Main does not import `@core` today. When it first
  does, add `main.build.externalizeDeps: { exclude: ['clipper2-ts'] }` so it is bundled to CJS.

### How failures become typed issues

`buildCutLine` is total, and the single `try/catch` for the library sits in `ringUnion.ts`. One issue kind
carries one typed reason, so one place writes messages and one state applies to all of them.

```ts
export type CutLineFailure =
  | { readonly kind: 'out-of-range' }
  | { readonly kind: 'source-self-intersects' }
  | { readonly kind: 'cusp'; readonly segmentId: Id }
  | { readonly kind: 'edge-swallowed'; readonly segmentId: Id }
  | { readonly kind: 'split'; readonly rings: number }
  | { readonly kind: 'crosses-fold'; readonly segmentId: Id }
  | { readonly kind: 'source-outside' }
  | { readonly kind: 'engine-failed'; readonly detail: string }

// evaluate.ts. ItemRef gains:
//   { kind: 'seamAllowance'; pieceId: Id; segmentId: Id | null }   (null is the default width)
// EvaluationIssue gains:
//   { kind: 'cut-line-failed'; item; failure: CutLineFailure; message }
//   { kind: 'negative-seam-allowance'; item; value; message }
//   { kind: 'unknown-seam-allowance-edge'; item; segmentId; message }
//   { kind: 'fold-edge-has-allowance'; item; segmentId; message }
//   { kind: 'invalid-fold-edge'; item; segmentId; reason: 'not-in-outline' | 'not-straight' | 'piece-crosses-line'; message }
//   { kind: 'degenerate-grainline'; item; message }
```

**In every row the piece stays in `pieces`, with its outline, notches and grainline.** Only a broken
outline omits a piece, as in M2. `cutLine` present means safe to print.

| Failure | Issue | `ResolvedPattern` holds |
|---|---|---|
| Allowance formula broken, undefined name, depends on a cycle, non-finite | Existing formula issues, `item: seamAllowance` | No `cutLine` if an outline edge uses that formula, otherwise `cutLine` |
| Allowance negative | `negative-seam-allowance` | No `cutLine` if an outline edge uses that formula, otherwise `cutLine` |
| `perEdge` key not in the outline | `unknown-seam-allowance-edge` | `cutLine` built, stale key ignored |
| Allowance set on a fold edge | `fold-edge-has-allowance` | `cutLine` built with 0 on that edge |
| Coordinates or allowance past 100 m (a 1e9 square passes M2 and would reach Clipper) | `cut-line-failed: out-of-range` | No `cutLine` |
| Library throw of any kind | `cut-line-failed: engine-failed` | No `cutLine` |
| Self-intersecting source outline | `cut-line-failed: source-self-intersects` | No `cutLine`, figure-8 seam line still draws |
| Multi-ring output, including allowances closing a neck into a hole | `cut-line-failed: split` | No `cutLine` |
| An edge's allowance is consumed by its neighbours | `cut-line-failed: edge-swallowed` | No `cutLine` |
| Allowance larger than a convex piece | None, valid geometry | `cutLine` |
| Zero-length edge | None | `cutLine`, no span for it, neighbours join directly |
| Cusp inside a curve (offset undefined) | `cut-line-failed: cusp` | No `cutLine` |
| Cut line would leave the fold line | `cut-line-failed: crosses-fold` | No `cutLine` |
| Internal guard: seam outline escapes the ring | `cut-line-failed: source-outside` | No `cutLine` |
| Grainline point missing or failed | Existing `missing-point`, `dependency-failed` (item piece) | No `grainline` |
| Grainline points coincide | `degenerate-grainline` | No `grainline` |
| `fold` not in outline, curved, or piece on both sides | `invalid-fold-edge` | No `fold`, edge reads its own allowance |

The 100 m guard keeps coordinates well inside Clipper's integer range: scaled by 1000, 100 m is `1e8`.
Products of those can pass `2^53`, so `ringUnion.ts` computes areas with `BigInt` and `ringIsSimple`'s
comparison stays exact.

A formula blocks the cut line only if an edge uses it. A stale override, an override on a fold edge, and a
default that every edge overrides still report their issue but don't block. To find an edge's width, check
`Object.hasOwn(perEdge, segmentId)` first and then read that key's value. Failed formulas are absent from the
value map, so falling back to the default on a missing value would silently print a broken override at the
default width.

`edge-swallowed` is deliberate, with a clear threshold. A concave arc is refused when its radius is at
most the allowance (15 mm radius: 14 mm passes, 15 mm is refused). A slot is refused when the allowance is
at least half its width (20 mm slot: 9.99 mm passes, 10 mm is refused). A cut line that hides an edge's
allowance is not printable as drafted, and the issue names the edge to change. A fully inverted edge ends
here, never as a wrong ring.

### What changes in `model.ts` and the DAG

```ts
export const SeamAllowanceSchema = z.object({
  default: z.string(),                         // was number
  perEdge: z.record(IdSchema, z.string()).optional()
})
export const PieceSchema = z.object({
  id: IdSchema, name: z.string(),
  outline: z.array(SegmentRefSchema),
  seamAllowance: SeamAllowanceSchema,
  notches: z.array(NotchDefSchema),
  grainline: z.tuple([IdSchema, IdSchema]),
  cutCount: z.number().int().positive(),
  fold: IdSchema.optional()                    // replaces mirror
})

/** The one list of every formula a piece owns. evaluate and rename both go through it. */
export function visitPieceFormulas(piece: Piece, visit: (owner: PieceFormulaOwner, formula: string) => string): Piece {
  throw new Error('not implemented')
}
```

- **Allowances become formulas.** A `seam` or `hem` variable changes every piece at once, `5/8 * inch` and
  `1.5cm` are how sewists write them, and notch distance is the precedent.
- **New DAG leaves**, built exactly like notch distances, one for the default and one per override. `allowanceKey`
  sits next to `notchKey`, and both JSON-encode their ids, because ids are free text and joining them with a
  separator lets two items collide. Nothing can reference
  them, so they cannot form cycles, and every formula issue comes free. The DAG stays numbers-only and
  geometry stays outside it. Negative values move from zod to `evaluate`, where they have an `ItemRef`.
- **`rename` must rewrite them.** `visitPieceFormulas` replaces the notch-only code at `edit.ts:234` and
  the loop at `evaluate.ts:190`, so the two lists cannot drift.
- **`mirror` is removed, and `fold: segmentId` replaces it.** `mirror: true` only ever meant "cut on fold",
  with no axis. The edge is the axis. A fold implies allowance 0 from one source. Core checks the edge is
  straight with the whole piece on one side. The corner rule never branches on fold; it reads
  `allowance = 0`, so a zero edge that isn't a fold works the same.
- **`cutCount` is carried to `ResolvedPiece`.** No geometry.
- **Grainline resolves** to `{from, to, angle}` from point ids, and need not lie on the piece.
- **`schemaVersion` stays 1.** No document has ever left memory: M8 is unbuilt, and the fixture is the
  only v1 document. The first file saved in M8 is the first real v1, and it will have this shape.

PLAN.md's data model block already has these two changes (`seamAllowance` values, `fold` for `mirror`).

### Editing and the minimum piece UI

```ts
export type NamedItemKey = { kind: 'measurement'; name: string } | { kind: 'variable'; name: string } | { kind: 'point'; id: Id }
export type ItemKey = NamedItemKey | { readonly kind: 'segment'; readonly id: Id } | { readonly kind: 'piece'; readonly id: Id }
export type NewItem = /* existing */ | { kind: 'segment'; segment: Segment } | { kind: 'piece'; piece: Piece }
export type PiecePatch = Partial<Pick<Piece, 'name' | 'outline' | 'seamAllowance' | 'notches' | 'grainline' | 'cutCount'>> & { readonly fold?: Id | null }

export type PatternEdit = /* existing six; rename takes NamedItemKey */
  | { readonly kind: 'setSegment'; readonly segment: Segment }   // replaces by id; refuses an unknown id
  | { readonly kind: 'setPiece'; readonly pieceId: Id; readonly patch: PiecePatch }
```

`setPiece` returns the same reference when every patched field is deep-equal, and stays replayable because
cells compute the whole new array. Setting a fold deletes that edge's override.

The UI fits `TableModel`. `ItemKind` gains `segment` and `piece`, giving "Segments" and "Pieces" tabs.

- **Segments.** One row each: id (readout), kind, `from`, `c1`, `c2`, `to`, typed as point names. A commit
  maps the name to an id, or rejects with "no point named X".
- **Pieces.** `tableFor` becomes `tablesFor`, returning a list. With a piece selected the list also has:
  - a piece row: name, default allowance (formula), grainline from and to (point names), fold (edge), cut count;
  - an **Edges** table, one row per outline entry in order: segment, reversed, allowance override (formula,
    blank clears it), length readout. Add appends, remove deletes;
  - a **Notches** table: segment, distance (formula).

`EditableTable` changes only by giving `Row` an `id: string` for React keys. `selectionForIssue` navigates
piece, notch and seamAllowance issues to the piece.

On the canvas the cut line goes in the world layer *below* the piece fill, with `non-scaling-stroke`.
Notch marks, grainline arrow and fold line go above the fill, and `bounds` includes the cut ring. M5 adds
no piece picking on the canvas. Pieces are selected from the Pieces tab, and a selected piece is highlighted.

## The raglan fixture as the acceptance test

**Already done on this branch.** `fixtures/raglan.ts` gains back, sleeve and neckband, appended so every
existing index stays valid. The back shares the front's hem and side seam, which tests one segment in two
pieces. The sleeve raglans are point reflections of the body raglans, so seams match in length exactly. The
neckband winds the other way. All four pieces resolve with zero issues in all five sizes.

`fixtures/raglan.test.ts` holds what is checkable today plus these checks as `it.todo`, each for every size:

| Property | Asserts |
|---|---|
| Clean | `issues` empty, every piece has `cutLine` and `grainline` |
| Fold | Every `frontCf` span point has `x === 0`, and `min(ring.x) === 0`, front and back |
| Hem exact | Every `frontHem` span point has `y === hem_length + 25` on the µm grid, including both corners |
| Side exact | Every `frontSide` span point has `x === body_width + 10` |
| Curve accuracy | Each chord sampled at 0.25, 0.5, 0.75 is `allowance ± CUT_LINE_BOUND` from the true curve, excluding corner extensions, and the true curve is within the bound of the ring |
| Spans | `edge` spans in outline order, one per edge; `join` spans only at the sleeve seam and hem |
| Validity | Ring is simple, every source flatten point is inside or on the ring |
| Notch | `cutLine.notches[0].at` is on the ring, at the edge allowance from the seam point |
| Sewable | `frontRaglan.length` equals `sleeveFrontRaglan.length` to 6 decimals, back likewise (active today) |
| Grading | Cut area strictly increases S to XXL per piece |
| Pure | Two `evaluate` calls give deep-equal cut lines |

Unit tests in `geometry.test.ts` and a new `cutLine.test.ts`: one per corner-rule row and per failure-table
row, in both windings, with the exact numbers above. The library throw is exercised by mocking
`clipper2-ts` in the test, so no test seam appears in a signature. A seeded fuzz of 4,000 shapes runs two
oracles: the union of bands is inside the ring, and each edge span's interior sits at its allowance. These
catch undershoot and overshoot.

Tests already updated for the four-piece fixture: `scene.test.ts`, `tables.test.ts`, `editor.test.ts`,
`canvas.mjs`.

Tests the build will change:

| Test | Why |
|---|---|
| `outline.test.ts:36` | `seamAllowance: { default: '10' }` |
| `model.test.ts:22-26` | Schema now rejects a number, and `evaluate` reports negative |
| `scene.test.ts` piece and bounds assertions | `ScenePiece` fields, and `bounds` includes the cut ring |
| `editor-panels.mjs:20` | New tabs |

## Synthesis decision

Two candidates, each committed to a different whole shape.

- **Edge-owned offset chain (base).** Core offsets from the true curve and owns the corner rule. Clipper
  does one union.
- **Clipper-built bands.** Per-edge band polygons and corner wedges, unioned by Clipper, then a ±5 µm
  closing. An anonymous ring.

The cross-judge (Sonnet, read-only, re-ran the spike) scored the chain 26/30 and the bands 20/30. My own
reading agreed. The chain wins on three points a maintainer depends on: accuracy is a property of one
function rather than a calibration of five constants, the corner rule is explicit and exhaustive, and it
was proven on all four pieces and keeps the edge identity M7 needs. The judge also found the bands can
cross a fold at an obtuse corner, which their rule doesn't handle.

Grafted from the bands: `rayExit` for notches, which also removed an issue kind. The library-behaviour pin
test and the mocked library throw. A DAG key per allowance. The
finding that a 1e9 square passes M2 and needs the guard.

Rejected:

- **The bands' `schemaVersion` 2 migration,** which the judge suggested grafting. No v1 file exists, so it
  would be code for data that doesn't exist. The first saved file already has the new shape.
- **The ±5 µm closing and `SLIVER_AREA_MM2`.** They repair splits the bands' own construction creates. The
  chain's single ring doesn't produce them.
- **Filling closed slots silently.** A wrong outline that looks right is worse than a named issue.

Both candidates agreed on: `clipper2-ts` pinned exactly in one file, allowances as formulas, a range guard
before the library, exact end tangents at corners, and a failed cut line leaving the piece usable. That
agreement is strong evidence for those parts.

The judge's challenges were checked, not assumed. See the evidence section.

## Tradeoffs accepted

- We accept a hand-written offset and join rule in core, about 200 lines, in exchange for a stated bound
  in mm and a cut line that keeps edge identity. Clipper offers neither.
- We accept depending on Clipper's Z channel in a prerelease package, in exchange for exact span ownership
  with no coordinate matching. Exact pin, one file, five symbols, a behaviour test.
- We accept omitting the whole cut line on any cut failure, even when an approximate one exists, so that
  `cutLine` present means printable. The seam line still shows.
- We accept a polygon cut line rather than curves, within 0.021 mm, for one representation across canvas,
  PDF, SVG and layout.
- We accept a join-span label flipping between sizes where the geometry is continuous.
- We accept typed names in a clumsy table for outlines, in exchange for no new component kinds in M5.
- We accept a breaking schema change at `schemaVersion` 1, because no v1 file exists.

## Alternatives considered

- **Clipper `inflatePaths` per allowance group, then union.** Hides the corner rule inside the library's
  miter logic, so a hem meeting a side seam needs post-hoc repair, and identity is lost.
- **`executeWithCallback` per vertex.** Measured unable to keep edges parallel.
- **Clipper `inflatePaths` of each open edge.** Measured two-sided: a 100×15 strip with a 25 mm hem spans
  y −10 to 40 instead of −5 to 40.
- **Bands, a polygon per edge, unioned.** Simple and correct about coverage, and kept as a test oracle. As
  the design it has no corner rule, only a stepped union.
- **No Clipper, own self-intersection removal.** Robust polygon overlay is the part least worth owning.

## Open questions and risks

Product questions are in `docs/open-questions.md`, each with a default. Technical risks:

- Does `clipper2-ts`'s Z behaviour stay stable across its prerelease series? The exact pin prevents an
  unplanned change, and the pin test catches a planned one.
- `require()` of an ESM-only package in Electron 45 is unverified, and the design avoids it by bundling.
  Neither `electron-vite build` nor a real renderer has loaded the package yet.
- The cusp guard is a heuristic at split points plus a depth cap. Inverted edges have been shown to end as
  `edge-swallowed`. A bound for non-regular offsets is not claimed.

## Evidence

Prototypes live in the session scratchpad, not the repo. They used the repo's real `evaluate` and `geometry`
and real `clipper2-ts@2.0.1-19` on Node 24.4.1.

- **Raglan, 4 pieces × 5 sizes:** zero issues and no acceptance failures. Worst deviation from a
  20,000-sample true curve: **0.0101 mm**. 96 to 173 ring vertices per piece, 0.1 to 0.9 ms per piece after
  warm-up.
- **Bound, independently:** 539 regular cases (random cubics up to 800 mm, allowances ±5, ±10, ±25). Worst
  **0.0101 mm** in both directions, against 0.02.
- **Fuzz, 4,000 shapes:** no throws, 3,945 built. Seam outline inside the ring and every edge's band
  inside the ring, 0 misses. The interior of every edge span sits at its allowance to within 0.0105 mm. The
  four `edge-swallowed` results were inspected: lines of 64 to 164 mm with 5 or 10 mm allowance, between
  neighbours of 10 to 25 mm at reflex corners, so a wider neighbour hides them.
- **Corner cases, exact:** rectangle clockwise and counterclockwise at 10/10/25/0 give `(110,−10)`,
  `(110,225)`, `(0,225)`, `(0,−10)`. Reflex 25/5 at `(55,75)`.
- **Failures produced:** figure-8, curl, U-slot closing, keyhole hole, `1e7` and `1e300` coordinates, `1e12`
  allowance, interior cusp on and off a dyadic split, zero-length edge.
- **Bundling:** the repo's `rolldown` bundled the package to ESM and CJS at 50 kB, and the CJS bundle ran
  under this repo's Electron in run-as-node mode. Vitest loaded it through a spike config.

Not run: `crosses-fold`, `source-outside` and `invalid-fold-edge` wiring, a single-edge closed outline, and
formula allowances, `applyEdit` and the UI, which are designed but not prototyped.

## Build plan

Each step is test-first, with `/tdd` for core code.

1. `model.ts`, `evaluate.ts`, fixture conversion, `visitPieceFormulas`. Run `/blast-radius` first.
2. `offsetCurve` and end tangents in `geometry.ts`, starting with the bound on a quarter arc.
3. Add `clipper2-ts`, then `ringUnion.ts` with the behaviour pin test.
4. `cutLine.ts`, one corner-rule row at a time with the rectangle cases, then the failure rows.
5. `resolvePiece` wiring: grainline, fold, notch marks, issues. Turn the `it.todo` checks on.
6. New edits in `edit.ts`.
7. Canvas and panels, with a `pieces` feature file and journey in `verify-pattern-maker`.
8. `/interrogate` and `/code-review` before merging.
