# Milestone 2: geometry

## Problem

Milestone 2 adds lines, cubic beziers, arc length, point-on-curve and closed piece outlines. The
later consumers want different things. The canvas and PDF export want exact control points. Clipper2
(milestone 5) wants polylines flattened at a tolerance it picks, split per edge. Notches want a point
and a direction at an arc-length distance. The seam-length checker wants lengths per size.

Milestone 1 sets the constraints:

- `evaluate` is pure and never throws.
- Failed values are omitted and explained by an `EvaluationIssue` with an `ItemRef`.
- DAG nodes are numbers.
- `ResolvedPattern` passed `segments` and `pieces` through unresolved, and notch `distance` was a
  formula nothing evaluated.

## Usage (caller's view)

```ts
import { evaluate, pathData, flattenOutline, sampleAtLength } from '@core'

const resolved = evaluate(pattern, size) // numbers, curves, lengths, outlines, notches, issues
```

Canvas (milestone 3). Every segment that resolved renders, even when its piece is broken:

```tsx
{Object.values(resolved.segments).map((s) => <path key={s.id} d={pathData([s.curve])} />)}
{Object.values(resolved.pieces).map((p) => (
  <path key={p.id} d={pathData(p.outline.map((e) => e.curve), { closed: true })} />
))}
```

Notches (milestone 5) are already placed:

```ts
for (const n of piece.notches) drawLine(n.point, add(n.point, scale(n.outward, NOTCH_DEPTH)))
```

Seam allowance (milestone 5):

```ts
const flat = flattenOutline(piece, 0.05) // per-edge polylines + one closed ring
```

Seam-length checker:

```ts
const diff = (size: string) => {
  const r = evaluate(pattern, size)
  return (r.segments['sleeveRaglan']?.length ?? NaN) - (r.segments['frontRaglan']?.length ?? NaN)
}
```

## Shape

There are two layers behind one entry point.

1. **`geometry.ts`, the kernel.** It defines `Vec2` and `Curve = LineCurve | CubicCurve`, and
   provides arc length, sampling by length or parameter, reversal, flattening, signed area and SVG
   path data. It doesn't import the model, so it is tested with plain numbers.
2. **`outline.ts`, resolution.** `resolveGeometry` maps `Segment` to `Curve`. That is the only
   switch from model kinds to kernel kinds. It measures each segment once, orients outline edges,
   checks closure, finds the orientation and places notches. It is internal: `index.ts` exports only
   the `Resolved*` types and `flattenOutline`.
3. **`evaluate()` stays the single public entry point.** The DAG stays numbers-only. Its one new node
   is the notch distance (`notch:<pieceId>/<notchId>`), a leaf that reuses every formula issue.
   After the sort, `evaluate` calls `resolveGeometry` once and merges its issues.

The decisions the design rests on:

- **Geometry resolution runs inside `evaluate` (interface depth).** Every consumer wants the
  geometry. If it were a separate public step, every caller would have to run two calls in order
  and merge two issue lists. Keeping it inside hides the ordering and keeps one issue list.
- **Closure is checked by point id, not by coordinate tolerance.** Ids don't change between sizes,
  so a piece is closed in every size or in none, and the check needs no epsilon. A side effect is
  that `edge.curve.to` and `next.curve.from` are the same object.
- **Reversal is applied once.** `OutlineEdge.curve` is already in outline direction, so consumers
  never branch on `reversed`. A notch's distance is measured from its segment's own `from`, as the
  model defines it. The notch's tangent and outward normal are given in outline direction.
- **A piece resolves completely or not at all; segments resolve independently.** A broken piece is
  left out of `pieces`, with issues, but its segments still render. `outline` has a non-empty tuple
  type.
- **Flattening is a function, not a stored field.** The tolerance is the consumer's choice. Each
  flattened edge starts and ends on the exact endpoint values, so neighbouring edges join without
  gaps.
- **Sampling returns one of three results:** `ok`, `out-of-range` (with the curve's length) or
  `degenerate`.
- **Orientation comes from the exact signed area,** computed with Green's theorem and 3-point
  Gauss-Legendre, which is exact for the degree-5 integrand of a cubic. It doesn't depend on
  flattening.
- **Every issue carries `item: ItemRef`.** `missing-point` changes from a bare `segmentId` to
  `item: { kind: 'segment' }`.

Deliberately not done here: seam allowance, grainline resolution, self-intersection checks, segment
names, and lengths in formulas.

## Synthesis decision

There were two candidates:

- **Layered (base).** Geometry resolution runs after the numbers-only DAG, inside `evaluate`.
- **Geometry as DAG nodes.** Segments, outlines and notches become nodes, solved by a generic loop
  over a typed value store with template-literal keys.

They agreed on most things: one `evaluate` entry point, resolved records keyed by id, closure by
id, `item` on every issue, notch distance as a formula node, adaptive Gauss-Legendre arc length, and
flattening with a tolerance the caller picks. That agreement is strong evidence for the shared
parts.

The layered candidate won on blast radius and interface depth. Milestone 1's evaluator stays
intact, and the DAG stays numbers-only. The other candidate's generic `solve` engine and its
four-map `ValueStore` exist mainly so that formulas can read lengths, which this milestone doesn't
do.

What was taken from the DAG candidate:

- A rigorous flatness test (deviation ≤ ¾ × the largest control-point distance from the chord) and
  a minimum tolerance, so `flatten` always terminates.
- The `Name.length` accessor syntax for the future length reference, rather than `len(S)`, which the
  numbers-only function table can't type.

What was trimmed from the layered candidate as milestone 5 work: per-edge seam allowance on outline
edges, grainline resolution, and the `unknown-seam-allowance-edge` issue.

## Segment lengths in formulas: recommendation

**Yes, but not in this milestone.** It fits the DAG without changing the numbers-only design:

- Add a computed node `segment:<id>.length`. Its dependencies are the coordinate nodes of the
  segment's 2 or 4 points. When the sort reaches it, it calls `curveLength(toCurve(...))`.
  Everything stays a number, so `values: Map<string, number>` is unchanged.
- The node union becomes `formula | segmentLength`.
- A formula writes `S.length`. That is a third `Reference` variant, parsed through the existing
  accessor path.
- Tarjan reports the dangerous case with a readable path. For example, if a point is placed using a
  segment's length while one of that segment's control points depends on the same point:
  `P.x → frontRaglan.length → raglanC1.x → P.x`. Because x and y are separate nodes, every cycle
  reported is a real one.
- Notch distances would then accept `frontRaglan.length / 2` for free.

The graph work is cheap, about 60 lines plus tests. The reason to wait is a naming decision that is
expensive to reverse. Segments have no names in the formula namespace today. They need either:

- **ids reused as names**, which forces segment ids to be valid identifiers and makes them collide
  with point and variable names, or
- **a `Segment.name` field**, which is a schema change mirrored in Convex.

The motivating case, matching the sleeve cap to the armhole, is usually a goal-seek ("choose the cap
height so the lengths match") rather than a forward formula. Length references alone don't solve
it. Do this as a small milestone after 5, once the raglan sleeve exists. Nothing here blocks it: the
segment `ItemRef`, namespaced node keys and a pure `curveLength` are already in place.

## Tradeoffs accepted

- We accept computing every length and outline on every `evaluate` call (microseconds per segment)
  in exchange for one call that returns plain data in a fixed order.
- We accept dropping the `segments` and `pieces` pass-through in exchange for `ResolvedPattern`
  holding only resolved values. Callers that need definitions already hold the `Pattern`.
- We accept closure by id, which rejects two distinct points that happen to coincide, in exchange
  for closure checks that hold in every size and need no epsilon.
- We accept a breaking change to the shape of `missing-point` in exchange for one way to locate an
  issue. Only tests consumed it.
- We accept having no arc-length lookup table in exchange for having no cache state.

## Alternatives considered

- **A separate public `resolveGeometry(pattern, resolved)`.** Every caller would coordinate two
  calls and two issue lists, which is a shallow interface.
- **Geometry as DAG nodes with a generic solver.** The interface is just as deep, but it refactors
  milestone 1 and adds a typed store before anything reads geometry from a formula.
- **Lazy, memoised `lengthOf(id)` on `ResolvedPattern`.** It turns plain data into a stateful
  object, which breaks IPC and `structuredClone`, and its errors show up late.
- **Storing flattened polylines on pieces.** That fixes one consumer's tolerance in core.

## Open questions and risks

- Should an outline gap omit the piece (as implemented) or resolve it as an open chain for the
  canvas? Its segments render either way.
- Should a notch on a segment outside its piece's outline be an error (as implemented)?
- `@core/*` deep imports can still reach `resolveGeometry`. Is the explicit export list in `index.ts`
  enough for now?

## Next implementation step

Write `geometry.ts` test-first, then `resolveGeometry` with the raglan front piece as the acceptance
test.
