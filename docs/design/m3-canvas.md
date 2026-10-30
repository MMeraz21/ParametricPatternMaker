# Milestone 3: canvas

## Problem

The canvas draws the resolved pattern as SVG, supports pan and zoom, and lets you select a point to see and edit its
formulas. Constraints:

- The pattern has to live in the renderer for now, because there is no file I/O until milestone 8. It is seeded from
  the raglan fixture.
- Later milestones must not need a rewrite. That covers editor panels (4), seam allowance (5), the size switcher (6),
  export sharing `pathData` (7), dirty state (8), and undo/redo plus AI editing (post-MVP).
- A point whose formula is broken has no coordinates, but you still have to be able to select it and fix it.
- Only node-env vitest is installed, with no jsdom, so React components are proved through the
  `verify-pattern-maker` journey.

## Usage (caller's view)

```tsx
// App.tsx is the whole data flow.
const [state, dispatch] = useReducer(editorReducer, raglanTee, initEditorState)
const resolved = useMemo(() => evaluate(state.pattern, state.pattern.activeSize), [state.pattern])
const scene = useMemo(() => buildScene(state.pattern, resolved, state.selection), [state.pattern, resolved, state.selection])
const inspection = state.selection && inspectPoint(state.pattern, resolved, state.selection.id)

<Canvas scene={scene} onSelect={(id) => dispatch({ type: 'select', selection: id && { kind: 'point', id } })} />
<Inspector inspection={inspection} onEdit={(edit) => dispatch({ type: 'edit', edit })} />
<IssuesPanel issues={resolved.issues} onSelect={...} />
```

Every pattern change, now and later, goes through one pure core function:

```ts
applyEdit(pattern, { kind: 'setPointFormula', pointId: 'hps', axis: 'x', formula: 'neck_width + 10' })
// Returns the same reference when nothing changed, so `next === pattern` means "no change".
```

Inside the canvas, each input goes through one pure function:

```ts
dispatchCamera(interpretWheel({ deltaX, deltaY, deltaMode, ctrlKey, metaKey, at }))
const step = stepPointer(gesture, { type: 'up', pointerId, at })
if (step.output.kind === 'click') onSelect(pickMarker(projectMarkers(scene.markers, camera, viewport), step.output.at))
```

## Shape

| File | Pure | Vitest | Owns |
|---|---|---|---|
| `core/edit.ts` | yes | yes | The `PatternEdit` union and `applyEdit`, the only way a Pattern changes |
| `renderer/editor/state.ts` | yes | yes | `EditorState {pattern, selection}` and `editorReducer` |
| `renderer/editor/inspect.ts` | yes | yes | `pointRoles`, `inspectPoint`, `selectionForIssue` |
| `renderer/canvas/scene.ts` | yes | yes | `buildScene`: pieces, segments, handles and markers as plain data in mm, plus bounds |
| `renderer/canvas/camera.ts` | yes | yes | `Camera {center, scale}`, screen↔world, `zoomAbout`, `panBy`, `fitBounds`, `cameraReducer` |
| `renderer/canvas/input.ts` | yes | yes | `interpretWheel` (pinch vs scroll), `stepPointer` (click vs drag-pan), `pickMarker` |
| `Canvas.tsx`, `Inspector.tsx`, `IssuesPanel.tsx`, `App.tsx` | no | journey | Wiring and markup only |

Load-bearing decisions:

- **Document state and view state are separate.** The editor reducer owns what is saved and undone: `pattern` and
  `selection`. The camera belongs to `Canvas`, so pan and zoom (around 60 Hz) never re-run `evaluate` or
  `buildScene`.
- **`applyEdit` lives in core and is idempotent.** A no-op returns the same reference. Undo can then be a stack of
  whole-pattern snapshots inside the reducer's single commit path, and dirty can be `pattern !== saved`. Because
  evaluation is a pure function of the whole document, undo never has to patch the DAG. This removes the PLAN's
  "undo vs DAG" hard part.
- **Edits are committed on Enter or blur, not while typing.** A half-typed formula would make the point and everything
  that depends on it blink out on every keystroke. The field keeps a local draft and is keyed on the committed
  formula, so an external change (undo, a panel in M4) remounts it with the new value. Escape reverts the draft.
- **Selection stores a Pattern id.** A broken point stays selected, because the inspector reads formulas from the
  Pattern and issues from `resolved.issues`. The issues panel is the way to reach a point the canvas can't draw:
  every failed point has at least one issue, and clicking it selects the point.
- **Paths are drawn in world mm.** They sit inside one `<g transform>`, so pan and zoom rewrite a single attribute
  and never rebuild a path string. Strokes use `vector-effect="non-scaling-stroke"`. Markers and labels are drawn in
  a screen-space layer at projected positions with radii in px, because SVG text can't be non-scaling.
- **Picking uses the nearest marker within 10 px, not the DOM target.** Markers cluster, for example a control point
  sitting on its anchor, and the topmost element is the wrong answer there. On a tie the anchor wins. Markers are
  still `role="button"` with the name `Point <Name>`, for the keyboard and for journeys.
- **Wheel policy is macOS-first.** Pinch arrives as ctrl+wheel, and that, ctrl+wheel and cmd+wheel all zoom about the
  cursor. A plain wheel pans. The listener is native with `{ passive: false }`, because React's `onWheel` can't
  `preventDefault`. Main also sets `setVisualZoomLevelLimits(1, 1)` so a pinch outside the canvas doesn't zoom the
  whole UI.
- **One place assigns point roles.** `pointRoles` is shared by the scene and the inspector. A point that is an anchor
  anywhere counts as an anchor.

Not included: point dragging, the size switcher, seam allowance, and issue flags drawn in the world.

## Synthesis decision

There were two candidates:

- **React-local reducer with pure seams (base).**
- **A framework-free document store** behind `useSyncExternalStore`, with edits as zod data and a `viewBox` camera.

They agreed on a lot: `applyEdit` in core with a same-reference no-op, selection by id, non-scaling strokes, numeric
picking with ties going to the anchor, a native non-passive wheel listener, pinch-as-ctrl zoom with plain-wheel pan,
and leaving dragging out until there's a product answer.

The base won on interface depth for what exists today. The second candidate's main argument for a store was that a
reducer can't be tested without jsdom. That isn't true for a pure reducer, and the reducer can move into a store
unchanged once a second, out-of-React writer exists (MCP, sync). The transform camera with a screen-space marker
layer keeps `px / scale` arithmetic out of components. With a `viewBox` camera, every marker, label and hit radius
would need that conversion.

Taken from the store candidate:

- Commit on Enter/blur instead of a live preview. This drops three reducer actions and the race between a preview
  and selection, and stops points from blinking while you type.
- `setVisualZoomLevelLimits(1, 1)` in main.

Trimmed from the base: the `preview`/`cancel` actions, the `setActiveSize` edit (M6), the Unplaced list (the issues
panel already covers it), and issue flags drawn in the world.

## Tradeoffs accepted

- We accept no live redraw while typing, in exchange for not having points flicker in and out. Live preview can come
  back in M4 as an opt-in.
- We accept a plain mouse wheel panning, in exchange for first-class trackpad behaviour. Cmd/ctrl+wheel and the zoom
  buttons cover mice.
- We accept re-projecting every marker on each camera frame (O(points)), in exchange for constant-size markers with no
  per-component scale maths.
- We accept bezier bounds taken from the control polygon, which fit a little loosely, in exchange for no root finding.
- We accept prop threading, in exchange for no context or store until M4 shows which props actually spread.
- We accept the production renderer importing the raglan fixture until M8/M9 provide file loading and templates.

## Alternatives considered

- **External store or zustand.** The same reducer behind a subscription API, plus a dependency and
  selector-memoisation rules before any second subscriber exists.
- **Pattern state in main, with the renderer as a view over IPC.** One owner, but an IPC round trip for a
  computation that takes microseconds.
- **A `viewBox` camera.** It's equivalent for paths, but it leaks `px / scale` into every marker, label and hit
  radius.
- **A pan/zoom library.** It hides the transform, but not the pinch policy, picking or fit, and its state would sit
  outside our tests.

## Open questions and risks

- What should dragging a parametric point write? A literal value breaks grading. This decides when dragging lands.
- Should a mouse wheel zoom (the CAD habit)? A preference toggle could cover it later.
- When x resolves and y fails, `ResolvedPattern` drops both, so the inspector can't show the good x value.
- Risk: pinch arriving as ctrl+wheel is Chromium behaviour that Electron upgrades could change.

## Next implementation step

`core/edit.ts` and `canvas/camera.ts` test-first, then `buildScene` against the raglan fixture.
