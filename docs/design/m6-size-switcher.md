# Milestone 6: size switcher and graded view

Status: designed, not built. `raglanFailingInXXL` is the only part already in the code.

Numbers marked **ran** come from experiments against the real `evaluate` and `buildScene` on an Apple-silicon laptop on
2026-11-10. Product decisions with a working default are in `docs/open-questions.md`.

## Problem

M6 adds a dropdown that switches the size, an optional view of all sizes nested, and adding, removing and renaming sizes.
Everything above `evaluate` knows one size only. Five facts make the shape non-obvious.

- **`activeSize` is on `Pattern`.** Under the recorded plans (undo as whole-pattern snapshots, dirty as `pattern !== saved`), looking at
  another size would dirty the file and take an undo step. No record says this was intended. The field dates from the first sketch in `PLAN.md`.
- **A cut line can fail in XXL while M is fine.** If only the shown size is evaluated, nobody finds out until they switch or print.
- **Issues have no identity across sizes.** Messages embed values, sizes and whichever dependency failed first.
- **A piece can exist in some sizes and not others.** An outline with no area drops the piece; a failed cut line keeps the piece without its cut line.
- **The raglan's sleeve and neckband don't nest as drafted.** `sleeve_centre` and `band_top` move them per size, so the S and XXL
  neckbands don't overlap at all.

Constraints kept: core stays pure, `evaluate` never throws, `applyEdit` returns the same reference for a no-op or refusal, table
columns come from `pattern.sizes`, and the camera stays out of the reducer. No file has ever been saved, so the file shape can change
without a migration until M8.

## Usage (caller's view)

The app makes one call for every size and one call for what is on screen. `App` no longer calls `evaluate`.

```tsx
const [{ pattern, selection, panel, wantedSize, nestShown }, dispatch] = useReducer(editorReducer, raglanTee, openRaglan)

const graded = useMemo(() => evaluateGraded(pattern), [pattern])               // every size, every edit
const view = useMemo(() => viewAt(graded, wantedSize), [graded, wantedSize])   // never evaluates
const scene = useMemo(() => buildScene(pattern, view, selection, nestShown), [pattern, view, selection, nestShown])
const tables = useMemo(() => tablesFor(panel, pattern, view, selection), [panel, pattern, view, selection])
const inspection = selection?.kind === 'point' ? inspectPoint(pattern, view, selection.id) : null

<select aria-label="Size" value={view.size} onChange={(e) => dispatch({ type: 'showSize', size: e.target.value })}>
  {view.sizes.map(({ name, issueCount }) => (
    <option key={name} value={name}>{issueCount === 0 ? name : `${name} (${issueCount} ${issueCount === 1 ? 'issue' : 'issues'})`}</option>
  ))}
</select>
<label><input type="checkbox" checked={nestShown} onChange={(e) => dispatch({ type: 'showNest', shown: e.target.checked })} /> All sizes</label>

<IssuesPanel issues={view.issues} onOpen={(issue) => dispatch({ type: 'select', selection: selectionForIssue(issue), size: issue.openAt })} />
```

A view answers "what do I show?". Its size is always valid, so nothing downstream can see `unknown-size`.

```ts
const view = viewAt(evaluateGraded(raglanFailingInXXL), 'M')
view.size                          // 'M'
view.resolved.pieces['neckband']   // present: M is fine
view.issues.map((i) => [i.kind, i.sizes, i.here, i.openAt])
// [['cut-line-failed', ['XXL'], false, 'XXL'], ['degenerate-outline', ['XXL'], false, 'XXL']]
view.sizes                         // [{ name: 'S', issueCount: 0 }, ... { name: 'XXL', issueCount: 2 }]
view.nest.gaps
// [{ size: 'XXL', pieceId: 'front', pieceName: 'Front', reason: 'no-cut-line' },
//  { size: 'XXL', pieceId: 'neckband', pieceName: 'Neckband', reason: 'no-outline' }]
```

Later consumers read the same object.

```ts
// Seam-length checker (post-MVP): a difference per size.
evaluateGraded(pattern).bySize.map(({ size, resolved }) => [size, lengthOf(resolved, 'frontRaglan') - lengthOf(resolved, 'sleeveFrontRaglan')])
// Export (M7): which sizes have problems.
evaluateGraded(pattern).issues.filter((issue) => issue.sizes.includes('XXL'))
```

Size edits go through `applyEdit`.

```ts
applyEdit(raglanTee, { kind: 'addSize', name: 'XXXL', after: 'XXL' })   // values copied from XXL, 0 issues
applyEdit(raglanTee, { kind: 'renameSize', from: 'M', to: 'Medium' })   // sizes and every values key
applyEdit(raglanTee, { kind: 'removeSize', name: 'M' })                 // sizes and every values key
applyEdit(onlyOneSize, { kind: 'removeSize', name: 'M' })               // same reference: refused
checkSizeName(raglanTee, 'xl')                                          // { kind: 'taken', message: "..." }
```

## Shape

```
pattern ─ evaluateGraded ─> GradedPattern ─ viewAt(wantedSize) ─> SizeView ─┬ buildScene ─> Scene (with ghosts when nestShown)
                                                                            ├ tablesFor
                                                                            ├ inspectPoint
                                                                            └ IssuesPanel
```

Load-bearing decisions:

1. **Every size is evaluated on every pattern change, overlay on or off.** Issues in other sizes must show with the overlay off, so
   evaluation has one code path.
2. **The active size is view state, and `Pattern.activeSize` is deleted.** A switch reads a result that already exists.
3. **All multi-size policy is in core** behind `evaluateGraded` and `viewAt`, where export and the seam checker can reach it.
4. **`evaluate` leaves the public `@core` surface** in the same change, so there is one way for app code to get results. Core's own tests still import `./evaluate`.
5. **A new optional `Piece.stackPoint`** names the point held fixed in the nest.

Interface depth: the public surface is two functions and the types they return. Behind them are the per-size loop, cross-size issue
identity, ordinal matching, choosing a true message, ordering, the size fallback, presence per piece, stack offsets and the choice of
reference size. `bySize` is public because export and the seam checker need whole results per size.

### Module map

| File | Change |
|---|---|
| `src/core/graded.ts` (new) | `evaluateGraded`, `viewAt`, the graded types. `issueIdentity` is private. The only non-test caller of `evaluate`. |
| `src/core/evaluate.ts` | Export `LocatedIssue`. No behaviour change. |
| `src/core/outline.ts` | `resolveStackPoint`, modelled on `resolveGrainline`. `ResolvedPiece.stackPoint?`. |
| `src/core/model.ts` | Delete `activeSize`. `sizes` is a non-empty tuple with a uniqueness check. `isSizeName`. `Piece.stackPoint`. |
| `src/core/edit.ts` | `addSize`, `removeSize`, `renameSize`, `checkSizeName`, `newSizeName`, `PiecePatch.stackPoint`. |
| `src/core/index.ts` | `evaluate` no longer exported. `export * from './graded'`. |
| `src/core/boundaries.test.ts` | `evaluate` is absent from `@core`; nothing outside core imports `@core/evaluate`. |
| `src/core/fixtures/raglan.ts` | Drop `activeSize`; two `stackPoint`s. |
| `renderer/App.tsx` | The usage above; the module-level `openRaglan` opens the seed at M. |
| `renderer/editor/state.ts` | `wantedSize`, `nestShown`, `PanelKind`, `showSize`, `showNest`, `select.size`, `wantedSizeAfter`. |
| `renderer/editor/inspect.ts` | Takes `SizeView`. `selectionForIssue` takes `LocatedIssue` and is no longer nullable. |
| `renderer/editor/IssuesPanel.tsx`, `Inspector.tsx` | Scope badge, `issue.key` as React key, `issue.text`. |
| `renderer/canvas/scene.ts` | Takes `SizeView`. `ghosts`, `legend`, `shownBounds`. |
| `renderer/canvas/camera.ts` | `containsBounds`, the `reveal` action. |
| `renderer/canvas/Canvas.tsx` | Ghost layer, legend, `reveal` when the overlay turns on. |
| `renderer/panels/tables.ts` | Takes `SizeView`. `sizeTable`. Size columns keyed `size:<name>`. Stack point column. Missing values flagged per column. |
| `renderer/panels/EditableTable.tsx`, `PanelDock.tsx` | Amber for other-size issues. Nullable `Row.key` and `Row.remove`. `Sizes` tab. |
| `.agents/skills/verify-pattern-maker/` | `features/sizes.md`, `journeys/sizes.mjs`, index line. |
| Docs | `PLAN.md:31`, `m3-canvas.md` (the `setActiveSize` note), `CLAUDE.md` (pipeline and "ten edits" becomes thirteen), `open-questions.md`. |

### Types

`src/core/graded.ts`:

```ts
/** Every issue except `unknown-size`, which graded evaluation cannot produce. Declared in evaluate.ts. */
export type LocatedIssue = Exclude<EvaluationIssue, { kind: 'unknown-size' }>

export interface SizeResult {
  readonly size: SizeName
  readonly resolved: ResolvedPattern
}

/** How one problem spreads across sizes. */
export interface IssueSpread {
  /** Stable across sizes and renders: kind, item, the discriminating field and a per-size ordinal. */
  readonly key: string
  /** In pattern order. */
  readonly sizes: readonly [SizeName, ...SizeName[]]
  readonly inEverySize: boolean
  /** Each size's own report. Messages differ when they carry values. */
  readonly instances: readonly { readonly size: SizeName; readonly issue: LocatedIssue }[]
}

/** One problem, reported once. Reads as the first affected size's report. */
export type GradedIssue = LocatedIssue & IssueSpread

export type PieceAtSize =
  /** `stackAt` is null only when the piece declares no stack point. */
  | { readonly kind: 'placed'; readonly size: SizeName; readonly piece: ResolvedPiece; readonly stackAt: Vec2 | null }
  | { readonly kind: 'no-outline'; readonly size: SizeName }
  /** The outline resolved but the declared stack point did not, so there is nowhere to put it. */
  | { readonly kind: 'no-stack-point'; readonly size: SizeName }

export interface GradedPiece {
  readonly id: Id
  readonly name: string
  /** One entry per size, in pattern order. */
  readonly atSizes: readonly PieceAtSize[]
}

export interface GradedPattern {
  /** One per size in pattern order. */
  readonly bySize: readonly [SizeResult, ...SizeResult[]]
  /** First-seen order, walking sizes in pattern order. */
  readonly issues: readonly GradedIssue[]
  /** Author order. A duplicated piece id appears once, as evaluate resolves it. */
  readonly pieces: readonly GradedPiece[]
}

/** A graded issue that reads as the shown size's own report when it has one. */
export type ShownIssue = GradedIssue & {
  /** The shown size has this problem. */
  readonly here: boolean
  /** The size to show when the issue is opened: the shown size if `here`, else the first affected. */
  readonly openAt: SizeName
  /** 'XXL' or 'L, XL'. Null when every size has it. */
  readonly scope: string | null
  /** `message`, led by the sizes it is literally true for. See "Issues that happen in some sizes". */
  readonly text: string
}

export interface NestGhost {
  readonly size: SizeName
  /** Position in `sizes`, for a colour ramp. */
  readonly sizeIndex: number
  readonly piece: ResolvedPiece
  /** Add to this piece's geometry to stack it on the shown size. */
  readonly offset: Vec2
}

export interface NestGap {
  readonly size: SizeName
  readonly pieceId: Id
  readonly pieceName: string
  readonly reason: 'no-outline' | 'no-stack-point' | 'no-cut-line'
}

export interface Nest {
  /** Every other size's pieces. The shown size is drawn normally and is not a ghost. */
  readonly ghosts: readonly NestGhost[]
  /** What the nest cannot show, for every size including the shown one. */
  readonly gaps: readonly NestGap[]
}

/** One size on screen, in the context of all of them. */
export interface SizeView {
  readonly size: SizeName
  /** Every size in pattern order, with the number of distinct problems it has. */
  readonly sizes: readonly { readonly name: SizeName; readonly issueCount: number }[]
  readonly resolved: ResolvedPattern
  /** Problems the shown size has first, then the rest; first-seen order within each. */
  readonly issues: readonly ShownIssue[]
  readonly nest: Nest
}

/** Evaluate every size. Pure, and never throws on bad pattern content. For each size, the issues in `issues` for that size are exactly what `evaluate` reports. */
export function evaluateGraded(pattern: Pattern): GradedPattern { throw new Error('not implemented') }

/** The size to show: `wanted` if it exists, else the first size. Total, so a stale size (a removed size, a future undo, an opened file) can never reach the UI as an unknown size. */
export function viewAt(graded: GradedPattern, wanted: SizeName): SizeView { throw new Error('not implemented') }

/** Exhaustive over LocatedIssue, ending in `const _exhaustive: never`. Excludes `message`, `dependency` and values such as `distance`. */
function issueIdentity(issue: LocatedIssue): string { throw new Error('not implemented') }
```

`src/core/model.ts`:

```ts
/** Not empty, no surrounding spaces, and not a name every object inherits (__proto__, constructor, toString...). */
export function isSizeName(name: string): boolean { throw new Error('not implemented') } // name !== '' && name === name.trim() && !(name in Object.prototype)
export const SizeNameSchema = z.string().refine(isSizeName, 'Not a valid size name')

// PatternSchema: `activeSize` is deleted, and `sizes` becomes non-empty in the type:
  sizes: z.tuple([SizeNameSchema]).rest(SizeNameSchema).superRefine(/* no two the same, ignoring case */),

// PieceSchema gains:
  /** The point held fixed across sizes in the nested view. Absent means draft coordinates already nest. */
  stackPoint: IdSchema.optional()
```

`src/core/edit.ts`:

```ts
export type PatternEdit =
  | /* the ten existing edits */
  /** Inserts after `after`, copying its value for every measurement that has one. Refused on a bad or taken name, or an unknown `after`. */
  | { readonly kind: 'addSize'; readonly name: SizeName; readonly after: SizeName }
  /** Deletes the column and each measurement's value for it. Refused for the last size or an unknown size. */
  | { readonly kind: 'removeSize'; readonly name: SizeName }
  /** Renames in `sizes` and every `values` key. Formulas never name a size. */
  | { readonly kind: 'renameSize'; readonly from: SizeName; readonly to: SizeName }

/** The single size-name rule. `except` is the size being renamed. The UI shows the message; applyEdit calls it again. */
export function checkSizeName(pattern: Pattern, name: string, except?: SizeName): NameProblem | null { throw new Error('not implemented') }

/** The smallest unused `Size <N>`. Deterministic, so the edit carries the name. */
export function newSizeName(pattern: Pattern): SizeName { throw new Error('not implemented') }

// PiecePatch gains: readonly stackPoint?: Id | null
```

Renderer:

```ts
// editor/state.ts
export type PanelKind = ItemKind | 'size'
export interface EditorState {
  readonly pattern: Pattern
  readonly selection: Selection | null
  readonly panel: PanelKind
  /** What the user asked to see. May be stale; only `viewAt` reads it. Never saved or undone. */
  readonly wantedSize: SizeName
  readonly nestShown: boolean
}
export type EditorAction =
  | { readonly type: 'select'; readonly selection: Selection | null; readonly size?: SizeName }
  | { readonly type: 'showPanel'; readonly panel: PanelKind }
  | { readonly type: 'edit'; readonly edit: PatternEdit }
  | { readonly type: 'showSize'; readonly size: SizeName }
  | { readonly type: 'showNest'; readonly shown: boolean }
/** `size` defaults to the first size. */
export function initEditorState(pattern: Pattern, size?: SizeName): EditorState { throw new Error('not implemented') }
/** Adding shows the new size, renaming follows, removing the shown size moves to a neighbour. Ends in `never`, so a new edit kind has to answer. */
function wantedSizeAfter(wanted: SizeName, before: Pattern, edit: PatternEdit): SizeName { throw new Error('not implemented') }

// editor/inspect.ts
export function inspectPoint(pattern: Pattern, view: SizeView, id: Id): PointInspection | null { throw new Error('not implemented') }
export function selectionForIssue(issue: LocatedIssue): Selection { throw new Error('not implemented') }

// canvas/camera.ts
export function containsBounds(camera: Camera, viewport: Viewport, bounds: Bounds, padding?: number): boolean { throw new Error('not implemented') }
// CameraAction gains: { readonly type: 'reveal'; readonly shown: Bounds | null; readonly all: Bounds | null }

// canvas/scene.ts
export interface SceneGhost { readonly key: string; readonly size: SizeName; readonly pieceName: string; readonly d: string; readonly cutD: string | null; readonly offset: Vec2; readonly tint: string }
export interface LegendEntry { readonly size: SizeName; readonly tint: string; readonly shown: boolean; /** 'Neckband: no outline', 'Front: no cut line'. */ readonly gaps: readonly string[] }
// Scene gains ghosts and legend (both empty unless nestShown) and shownBounds. `bounds` keeps meaning "everything drawn".
export function buildScene(pattern: Pattern, view: SizeView, selection: Selection | null, nestShown: boolean): Scene { throw new Error('not implemented') }

// panels/tables.ts
// TextCell.issues becomes readonly ShownIssue[]. Row.key becomes ItemKey | null. Row.remove becomes PatternEdit | null. TableModel.kind becomes PanelKind.
export function sizeTable(pattern: Pattern, view: SizeView): TableModel { throw new Error('not implemented') }
export function tablesFor(kind: PanelKind, pattern: Pattern, view: SizeView, selection: Selection | null): readonly TableModel[] { throw new Error('not implemented') }
```

Every other table builder takes `view` in place of `resolved`. `issuesAbout(view, matches)` drops its `unknown-size` guard.

## The decisions

### Active size: view state

`EditorState.wantedSize` sits beside `selection` and `panel`. `Pattern.activeSize` is deleted, and every stale reader then fails to compile.

| | Behaviour |
|---|---|
| Switching size | A reducer action, not an edit. The pattern reference is unchanged, so `graded` is untouched. |
| Edits | Unaffected. `setMeasurement` already takes its size from the column. Formulas apply to all sizes. |
| Undo (post-MVP) | Snapshots hold `pattern` only. Undo never changes the size you're looking at unless the size no longer exists, and then `viewAt` falls back to the first. |
| Dirty (M8) | `pattern !== saved` stays truthful. Looking at XXL doesn't prompt on close, trigger a sync or bump `updatedAt`. |
| Saved file | Holds `sizes`, not a current size. A file opens at its first size, and the raglan seed opens at M. M8 can remember the last size per file in app settings. |

`wantedSize` is written only by the reducer and read only by `viewAt`. It may go stale by design, because one read-side fallback replaces
repairing it on every path (remove, undo, open file).

This reverses the `setActiveSize` edit that `m3-canvas.md` deferred to M6. That note was a consequence of where the field already sat, not a recorded choice.

### Keeping the overlay fast

Commits happen on Enter or blur, never per keystroke, so the budget is one interaction and not 60 Hz.

| Measured (**ran**, warm) | Median | p99 |
|---|---|---|
| `evaluate`, one size | 1.05 ms | 2.2 ms |
| All 5 raglan sizes, including grouping | 5.36 ms | 8.5 ms |
| 12 sizes | 11.96 ms | 13.8 ms |
| 5 sizes of a pattern 8× the raglan (232 points, 32 pieces) | 41.7 ms | 83.4 ms |
| Stack offsets for one view | 0.001 ms | 0.003 ms |

| | Cached? | Why |
|---|---|---|
| `graded` | Yes, `useMemo([pattern])` | `applyEdit` makes a new reference only on a real change. |
| `view` | Yes, `useMemo([graded, wantedSize])` | A size switch evaluates nothing. |
| Results per size across edits | No | Reusing other sizes on a measurement edit saves about 4 ms, and leaves a stale-result risk held up only by a test. |
| Compiled formulas across sizes | No | Compiling is 13% of `evaluate`, about 0.55 ms over 5 sizes, and sharing it needs `evaluate` split in two. |

React and SVG were measured with a stripped copy of `Canvas`'s DOM, fed by the real `buildScene`, in offscreen Electron (**ran**).
The overlay at 5 sizes is 164 SVG elements against 116 today. Commit stays under 2 ms, and toggle to painted frame stays about 8.5 ms at 5 and 12 sizes.
Offscreen mode doesn't time GPU raster, and the real window wasn't measured, so the `sizes-perf` journey records toggle-to-frame time in the real app with a coarse 100 ms limit.

Ghosts stay cheap by construction. They sit inside the one transformed `<g>` and have no markers, so `projected`, the only per-pan JS cost, doesn't grow. If `sizes-perf` ever fails,
the one-file fix is merging each size's ghosts into one path in `buildScene`.

### Issues that happen in some sizes

`evaluateGraded` reports each problem once, with the sizes that have it. Identity is `kind`, `item`, the discriminating field
(`reference`, `pointId`, `segmentId`, `reason`, `failure.kind` and so on) and an ordinal within the size. Messages and `dependency` are excluded
because they change per size. The ordinal keeps grouping lossless: flattening findings for any size gives exactly that size's `evaluate` issues (**ran** on nine recipes).

A merged finding's values can differ per size, so its wording has one rule: **the text names only the sizes it is true for.** `message` is the shown size's own report when it has one,
otherwise the first affected size's. `text` starts with the sizes whose message is identical, and lists the others after it:
`XXL: Notch 'a' is 390.6 mm along a 384.6 mm segment (also in XL)`. Issues in every size with one message read exactly as they do today.

| Surface | Behaviour |
|---|---|
| Size dropdown | Each option shows its count, `XXL (2 issues)`. The option's value stays the bare name. |
| Issues panel | One row per finding, this size's first. A badge such as `XXL` sits outside the button when not every size has it, so all-size issues keep today's accessible name. The heading counts findings. |
| Clicking an issue | Selects the item and, if the shown size doesn't have the problem, switches to `openAt`. You land where the problem is visible. |
| Table cells | Every finding about the item, from any size. Red if `here`, amber if only in other sizes. A formula is shared by all sizes, so a problem in XXL is one you'd fix in this same cell. The tooltip uses `text`. |
| Measurement columns | `missing-measurement-value` flags the column of each affected size. This removes the accepted gap at `m4-editor-panels.md:104`. |
| Inspector | Values are the shown size's. Issues list `text`. "This point can't be drawn" stays tied to the shown size. |
| Overlay legend | The size's entry names what can't be drawn. |

`editor.test.ts:118` (`unknown-size` maps to null) is deleted with the guard.

| Recipe (**ran**) | Raw issues over 5 sizes | Findings | Scope |
|---|---|---|---|
| `band_width` degenerate in XXL | 1 | 1 | XXL |
| `frontNeck` allowance crosses the fold | 1 | 1 | XXL |
| Notch out of range | 1 | 1 | XXL |
| `chest_ease` not finite in M | 33 | 33 | M |
| `armhole_depth.XXL` deleted | 25 | 25 | XXL |
| Broken `hem_length` | 95 | 19 | every size |

### A piece that fails in one size, in the overlay

The overlay shows what exists and says what doesn't. There are no placeholders and no fallback to draft coordinates.

| State in another size | Drawn | Legend |
|---|---|---|
| Placed, with cut line | Seam outline and cut line | Clean |
| Placed, no cut line | Seam outline only | `Front: no cut line` |
| No outline | Nothing for that piece | `Neckband: no outline` |
| Stack point unresolved | Nothing, since drawing it at its draft position would look like a grading error | `Sleeve: no stack point` |

If the shown size lost the piece, its segments still draw dashed as they do today, the other sizes' ghosts stay, and the nest uses the first size that placed it as the reference.
On `raglanFailingInXXL` at M the overlay has 15 ghost outlines and 14 cut lines (**ran**).

### Adding, removing and renaming sizes

| Operation | Effect | Refused when |
|---|---|---|
| `addSize` | Inserted right after `after`. Each measurement copies `values[after]`; one with no value there stays without one and is flagged. | Bad or taken name, unknown `after` |
| `removeSize` | Removed from `sizes` and every `values`. | Unknown, or **the last size** (the UI hides ×) |
| `renameSize` | Replaced in `sizes` and every `values` key. `from === to` is a no-op. | Unknown, bad or taken name |

- **Formulas are never touched,** because they cannot refer to a size.
- **A new size copies the size you're on.** This gives 0 issues and 4 pieces, against 0 pieces and 86 issues with no values (**ran**). It doesn't invent numbers, and it becomes the shown size.
- **The shown size.** Adding shows the new one, renaming follows, and removing it moves to the next size or else the previous.
- **Names.** `checkSizeName` is its own rule, since sizes aren't in the formula namespace: `38`, `2XL` and `XS/S` are valid, and a size may share a point's name.
  It refuses empty names, surrounding spaces, names equal ignoring case (`xl` and `XL` are one size to a sewist), and anything `in Object.prototype`, which covers `__proto__`, `constructor` and `toString` without a list (**ran**).
- **The file boundary** applies the same rule, so neither entrance can admit those names and no `hasOwn` guard is needed on the two `values[size]` reads.
- **A size named `name`** can't collide with the name column, because measurement columns are keyed `size:<name>`.
- **Where it's edited.** A `Sizes` tab using `EditableTable` over `sizeTable`, with an editable name, × and `+ Add size`, like every other panel.
- **Drafts.** Renaming remounts that column's cells and removing unmounts them, so a draft can't land on the wrong size. A half-typed cell commits on blur when the dropdown takes focus, which `sizes-edit` checks.

### The camera

| Action | Camera |
|---|---|
| Switching size | Never moves. Comparing sizes needs a still frame. |
| Editing, or adding, removing or renaming a size | Never moves. |
| Turning All sizes on | Moves only if you were viewing the whole shown size and the nest doesn't fit. It then fits the nest. Zoomed in on a neckline, it stays put. |
| Turning All sizes off | Never moves. |
| Fit button | Fits everything drawn: the nest when it's on, otherwise the shown size. |

The overlay keeps the shown size at its true draft position and moves only the ghosts, so turning it on moves nothing already drawn. Without `reveal`, a fit view at M would clip the nest:
M's sleeve stops at x=1009 and the XXL sleeve stacked on it reaches x=1071 (**ran**).

`reveal` returns the same state when there's no camera, when `all` is already in view, or when `shown` isn't entirely in view. Otherwise it fits `all`. `Canvas` dispatches it when `scene.legend` goes from empty to not empty.

### Nesting

Each piece may name a **stack point**, the trade's term for where all sizes meet. The nest translates every other size so its stack point lands on the shown size's. A piece with none keeps its draft coordinates, which is right for pieces drafted on a shared origin.

Fixture change, when the field exists: `sleeve.stackPoint = 'sleeveNeckC'` and `neckband.stackPoint = 'bandA'`. Front and back get none because they already nest, and `grainline.from` would break them.

| Offset against M (**ran**) | S | L | XL | XXL |
|---|---|---|---|---|
| Sleeve | (40, 0) | (−40, 0) | (−80, 0) | (−130, 0) |
| Neckband | (0, 20) | (0, −20) | (0, −40) | (0, −60) |
| Front, Back | (0, 0) | (0, 0) | (0, 0) | (0, 0) |

After placement, every size's seam box contains the previous size's for all four pieces, against references S, M and XXL (**ran**). Apart from front and back, which share an area by design, no two different pieces collide.

The reference is the shown size, so markers, handles and inspector values stay in draft coordinates and need no translation. A stack point is checked like a grainline end: `missing-point` or `dependency-failed` on the piece, which is never removed. It's edited in a `Stack point` column on the Pieces table, by point name, with blank clearing it.

### Acceptance

`raglanTee` stays clean: 0 issues in all five sizes and identical geometry, so every M pin holds.

`raglanFailingInXXL` is in `fixtures/raglan.ts` now, with its tests in `raglan.test.ts`. It uses only today's edits. S to XL have 4 pieces and 0 issues. XXL has 3 pieces and exactly two issues: `cut-line-failed` on Front and `degenerate-outline` on Neckband.

| Unit tests | Prove |
|---|---|
| `core/graded.test.ts` (new) | Clean raglan; the failing fixture exactly; the recipe table with `it.each`; lossless for every size; unstable `dependency`; ordinals; `message` and `text` per shown size; here-first order and `openAt`; `viewAt` for a removed size; `issueCount` per size; nest offsets; nesting containment against S, M and XXL; reference fallback; every gap reason. |
| `core/graded.fuzz.test.ts` (new) | Same generator as `evaluate.fuzz`: never throws, lossless holds. |
| `core/edit.test.ts` | Each size edit's full result; same reference for last size, unknown, duplicates ignoring case, `__proto__`, `constructor`, no-op rename; a copy gives 0 issues. |
| `core/model.test.ts` | Parse rejects duplicates and hazardous names. Round trip keeps `stackPoint`. |
| `core/outline.test.ts` | `stackPoint` `missing-point` and `dependency-failed`; the piece survives. |
| `core/boundaries.test.ts` | `evaluate` isn't in `@core`; no `@core/evaluate` import outside core. |
| `canvas/scene.test.ts` | No ghosts when off and the scene otherwise identical; 16 ghosts at M; offsets; bounds grow only when shown; failing fixture legend. |
| `canvas/camera.test.ts` | `reveal`: already in view, zoomed in, fitted, and no camera. |
| `panels/tables.test.ts` | Emphasis follows the view; missing value flagged per column; other-size issues on cells; `sizeTable` commits and refusals; last size has no remove; a size named `name`. |
| `editor/editor.test.ts` | `showSize` keeps `pattern` the same reference and repeats as a no-op; add shows, rename follows, remove moves to a neighbour; `select` with `size`. |

Journey `sizes.mjs` with `features/sizes.md`. Size names are user-chosen and `getByLabel` matches substrings, so it uses `exact: true`.

| Sub-feature | Proof |
|---|---|
| `sizes-switch` | Select XXL: `Cut line Front` lowest y goes 715 → 775, `Underarm` updates, column emphasis moves. |
| `sizes-camera` | World transform and zoom are identical across a switch. Turning All sizes on from a fit view keeps every ghost inside the canvas; from a zoomed view it changes nothing. |
| `sizes-edit` | Editing `chest L` on M changes nothing drawn, and switching to L shows it. A half-typed cell commits when the dropdown takes focus. |
| `sizes-nest` | At M: 16 `Graded <size> <piece>` paths, `Graded S Sleeve` has `translate(40 0)`, still 29 markers. Off again: 0. |
| `sizes-nest-failure` | Apply the two failing formulas through the UI: 15 outlines, 14 cut lines, legend text, M keeps `Cut line Front`. |
| `sizes-issue` | Dropdown reads `XXL (2 issues)`. Issue row has badge `XXL`; clicking it selects the item and the dropdown shows XXL. |
| `sizes-add` | `+ Add size`: new column equals M and is shown, `Issues (0)`. |
| `sizes-rename` | `Size 1` → `XS` updates column and option. `__proto__` and `xl` show a refusal. |
| `sizes-remove` | Delete the shown size: the dropdown moves to a neighbour. Down to one size, × is hidden. |
| `sizes-perf` | Toggle to two animation frames under 100 ms, recorded. |
| `sizes-console` | No renderer errors. |

## Synthesis decision

Two structurally different candidates ran: a deep core module (Opus) and "core stays single-size, size is a renderer lens" (Sonnet). The cross-judge (Sonnet) scored them 22 and 20 of 30 and recommended the first as base. My own reading agreed.

The base is the core module, for three reasons. A stale size can't reach the UI because `viewAt` is total. There is no cache to invalidate. Multi-size policy is in one tested place that export and the seam checker can read.

Taken from the renderer-lens candidate:

- The `reveal` camera action, which fixes the base's clipped overlay. I narrowed it so it can't throw away a zoomed-in view.
- The size count in the dropdown, so a failure in another size shows at the place you switch.
- Names equal ignoring case count as duplicates.
- The nesting containment test.
- Deleting the saved field instead of renaming it. The base had renamed it `baseSize`, which was a persisted field with a cross-field invariant and nothing that could set it. The judge raised this and I agreed.

Changed from the base after judging: `text` names only the sizes it's true for, `Pattern.sizes` is a non-empty tuple instead of a runtime fallback (types checked with `tsc` under the repo's strict flags), and removing the shown size moves to a neighbour.

Rejected from the renderer-lens candidate: per-size result reuse (`canReuse`), grouping issues by message (a problem whose value differs in each size becomes five rows), and cells that stay silent about other sizes.

Judge suggestions I didn't take: a two-step remove, because a size column and a measurement row hold the same number of values on the raglan and M4 chose no confirmation (now an open question); a 16-character limit and a control-character rule, which guard nothing; and a `measurementValue` guard, since both entrances refuse those names.

## Tradeoffs accepted

- We accept evaluating every size on every commit, including `setUnits`, in exchange for one code path and issues that are always complete.
- We accept that a file doesn't reopen at the last viewed size, in exchange for looking never dirtying a file.
- We accept a new optional model field in exchange for leaving the draft layout free.
- We accept some presentation in core (`scope`, `text`, here-first order) in exchange for all multi-size policy being reachable by vitest.
- We accept that `wantedSize` can be stale in state, in exchange for one read-side fallback.
- We accept that an amber cell can mean a problem you can't see in this size, in exchange for never hiding it.
- We accept mechanical churn in renderer signatures and about 25 test call sites (one `viewOf` helper) in exchange for one way to get results.

## Alternatives considered

- **Keep `evaluate` in the renderer and add helpers around it.** Callers coordinate the loop, grouping and fallback, and each future consumer repeats them. It hides the least.
- **Active size as a document edit.** Keeps file reopening, but dirties the file, adds undo steps and sync traffic for merely looking.
- **Evaluate other sizes only when the overlay is on.** Hides the XXL failure this milestone must surface.
- **Constant `sleeve_centre` and `band_top` in the fixture.** It nests with no code, but breaks M's pins and ties the draft layout to the largest size. Sleeve and body cut lines overlap in the draft at chest 1500 (**ran**).
- **Automatic nesting** by bounding box or grainline. A top-left corner splays the sleeve, top-centre moves the fold, and `grainline.from` varies on front and back. A wrong guess can't be corrected.
- **Nesting on a fixed size.** The nest wouldn't jump on a switch, but the shown size would be drawn away from its draft position, so markers and inspector values would disagree.
- **Fit on every size switch.** Destroys the still frame comparison needs.
- **Reusing `checkName` for sizes.** Refuses `38` and `2XL`, and rejects a size sharing a point's name.

## Open questions and risks

- If point dragging ever lands, should graded evaluation get a one-size fast path? At 8× the raglan a commit costs 42 ms median, which is too slow for 60 Hz.
- `PLAN.md:45` says `schemaVersion` and the code says `version`. Should this be settled before M8 closes the free window?
- Amber versus red was chosen from code and hasn't been seen on screen.
- `model.ts` and `evaluate.ts` change, so `/blast-radius` is required before shipping.
- When built, "Adding, removing and renaming sizes" moves to Decided in `open-questions.md`.

## Build order

Each step keeps tests and typecheck green.

1. Size edits, `checkSizeName`, stricter `sizes` schema.
2. `evaluateGraded` and `viewAt` against the fixture, with `/tdd`, using `evaluate` unchanged.
3. Move the renderer to `SizeView`, delete `activeSize`, stop exporting `evaluate`. The dropdown works.
4. Issue surfaces: dropdown count, badge, click-through, amber cells, per-column missing values.
5. `Sizes` tab.
6. `stackPoint`, ghosts, legend, `reveal`.
7. `sizes` journey and docs.

## Next implementation step

Write `src/core/edit.test.ts` cases for `addSize`, `removeSize` and `renameSize`, then implement them with `/tdd`.
