# Parametric Pattern Maker: Build Plan

## What this is
A desktop app for drafting garment sewing patterns parametrically. A pattern is a graph of points and curves defined by formulas that reference body measurements. Change a measurement or switch sizes, and every piece redraws. First real use case: a raglan baseball tee (front, back, sleeve, neckband) in sizes S to XXL, cut from deadstock fabric.

Not a freeform drawing app. Think Seamly2D, but with a modern UI and a few workflow features it lacks.

## Stack
- Electron + React + TypeScript (Vite for bundling, electron-vite or similar)
- Tailwind for UI
- mathjs for parsing/evaluating formulas
- Clipper2 (JS port) for seam allowance offsetting
- pdf-lib for PDF export
- Vitest for tests
- Patterns stored locally as JSON files (working copy, works offline)
- Convex for cloud sync, backup, and pattern library (React client in renderer)
- Auth: Convex Auth (or Clerk)

## Architecture rules
- **Geometry kernel and evaluation engine are pure TS with zero UI or Electron imports.** Lives in its own folder (e.g. `src/core`). Must be fully unit tested. This is the most important rule.
- UI is a thin layer over the core. Renderer process never touches the filesystem directly; go through a typed IPC bridge in preload.
- Units stored internally in millimeters. Display in cm or inches.

## Data model (get this right first)
```ts
Measurement  { name: string; values: Record<SizeName, number> }   // e.g. chest, waist, shoulder_width
Variable     { name: string; formula: string }                     // e.g. ease = 10, body_width = chest/4 + ease
Point        { id: string; name: string; x: string; y: string }   // x/y are formulas, can reference other points (A.x) and variables
Segment      = Line { from, to } | Bezier { from, c1, c2, to }    // control points are also Points
Piece        { id; name; outline: SegmentRef[]; seamAllowance: { default: number; perEdge?: Record<segId, number> }; notches: NotchDef[]; grainline: [pointId, pointId]; cutCount: number; mirror?: boolean }
Pattern      { version; units; sizes: SizeName[]; activeSize; measurements; variables; points; segments; pieces }
```
- Build a dependency graph (DAG) from all formula references. Topologically sort to evaluate. Detect and report cycles and undefined references with clear errors pointing to the offending item.
- Evaluation: `evaluate(pattern, size) -> ResolvedPattern` (concrete coordinates). Pure function.

## Storage and sync (Convex)
- **Local first.** The app must fully work offline from local JSON. Convex is a sync layer, not a hard dependency for drafting.
- Convex tables (start simple):
  - `patterns`: `{ ownerId, name, pattern (full Pattern JSON, validated), schemaVersion, updatedAt, localId }`
  - `measurementProfiles`: `{ ownerId, name, measurements }` for reusable body/size tables
  - `templates`: built-in and user-published starting patterns
  - Exported PDFs/SVGs go in Convex file storage, referenced from `patterns`.
- One Convex doc per pattern for now. Patterns are small. Last-write-wins on `updatedAt` is fine for single user.
- Sync: debounce saves (a couple seconds after last edit). On open, compare local vs remote `updatedAt`; if both changed since last sync, prompt the user to pick a version instead of silently overwriting.
- Keep a `schemaVersion` on every pattern and write migrations in core so old files and docs still load.
- Validate pattern JSON with a shared schema (zod in core, mirrored by Convex validators) so the DB never holds a broken pattern.

## MVP milestones
1. **Core engine**: measurements, variables, points with formulas, DAG evaluation, cycle detection. Tests first.
2. **Geometry**: lines, cubic beziers, segment length (beziers via numeric integration/subdivision), point-on-curve, closed outline for a piece.
3. **Canvas**: SVG render of resolved pattern. Pan/zoom. Select a point to see/edit its formula. Dragging a point is optional for MVP.
4. **Editor panels**: measurement table (sizes as columns), variables list, point list. Live redraw on edit.
5. **Pieces**: define outline from segments, grainline, notches, seam allowance via Clipper2 offset with per-edge overrides (hem wider than side seams).
6. **Size switcher**: dropdown that re-evaluates and redraws. Optional overlay of all sizes nested (classic graded view).
7. **Export**: tiled PDF at true 1:1 scale with page overlap, alignment marks, page grid labels (A1, A2...), and a 5cm/2in test square. Also full-size SVG.
8. **File I/O**: open/save JSON, recent files, dirty-state warning on close.
8b. **Convex sync**: auth, `patterns` table, push/pull with debounce and conflict prompt, pattern library view listing cloud patterns.
9. **Raglan template**: ship a working raglan tee pattern as the first built-in template. This is the acceptance test for the whole MVP: print it, cut it, sew it.

## Post-MVP features (the differentiators)
- **Seam length checker**: pick two edges (e.g. sleeve raglan edge vs body raglan edge), show length difference per size. Flag mismatches.
- **Fabric layout / marker**: given bolt width and fabric length, pack pieces (respecting grainline and cut counts) and report garments per yard. Useful for costing deadstock.
- **More templates**: boxy tee, hoodie block.
- **Undo/redo** as a command stack over pattern edits.
- **DXF-AAMA export** for factory handoff.
- **AI editing**: natural language like "lengthen the sleeve 2 inches, drop the shoulder 1 inch" turns into parameter edits. Expose the core engine as an MCP server so an LLM can read/modify patterns through tools.

## Known hard parts (don't hand-wave these)
- Offsetting beziers cleanly: flatten curves to polylines at a fine tolerance before Clipper2, keep corners sane (mitre vs square joins by edge type).
- Smooth curves under grading: control points should be formula-driven relative to their anchors, not absolute.
- True-scale printing: PDF must not be scaled by the viewer; document page size explicitly and tell the user to print at 100% / "actual size".
- Undo/redo interacting with the DAG.

## Conventions
- Strict TypeScript, no `any` in core.
- Every core function gets tests. Include a fixture pattern (the raglan) used across tests.
- Small commits per milestone.

## First task for the agent
Scaffold the Electron + React + TS + Vite + Tailwind app, set up Vitest, create `src/core` with the data model types, and implement milestone 1 (formula evaluation over a DAG with cycle detection) with tests. Do not build UI beyond a placeholder window yet.
