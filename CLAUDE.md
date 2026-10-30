# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Desktop app for drafting parametric sewing patterns. `PLAN.md` is the source of truth for scope, data
model and milestones; `workflow.md` describes how we work and which skills to use per milestone.

## Commands

```sh
npm run dev                                  # electron-vite dev with hot reload
npm test                                     # vitest run (all *.test.ts under src/)
npx vitest run src/core/evaluate.test.ts     # one file
npx vitest run -t "reports cycles"           # tests matching a name
npm run typecheck                            # tsc on tsconfig.node.json and tsconfig.web.json
npm run build                                # production build into out/
```

There is no linter yet. CI (`.github/workflows/ci.yml`) runs typecheck and tests.

- This agent shell sets `ELECTRON_RUN_AS_NODE=1`, which makes Electron start as plain Node
  (`ipcMain` is undefined). Launch with `env -u ELECTRON_RUN_AS_NODE npm run dev`.
- If dev fails with "Electron uninstall", the binary didn't download: `node node_modules/electron/install.js`.
- The user normally runs the app in their own terminal; Claude runs tests, typecheck and builds.
- To prove a UI change in the real app, use the `verify-pattern-maker` skill
  (`.agents/skills/verify-pattern-maker/`): `node .agents/skills/verify-pattern-maker/scripts/run.mjs doctor`.
  When adding a user-facing feature, add its feature file and journey there too.

## Architecture

Three Electron layers plus a pure core:

- `src/core`: the pattern engine. **No UI, Electron or Node imports**; this is the most important
  rule in the project. Imported by renderer (and main later) via the `@core` alias.
- `src/main`: main process. Owns the filesystem and IPC handlers.
- `src/preload`: the only bridge to the renderer. `api.ts` defines the `Api` interface, `index.ts`
  implements it with `ipcRenderer.invoke`, `index.d.ts` types `window.api`. Adding a capability
  means touching all three plus an `ipcMain.handle` in main. The renderer is sandboxed and
  context-isolated and must never reach Node directly.
- `src/renderer`: React + Tailwind v4 (via `@tailwindcss/vite`, no tailwind config file).

The package is CommonJS on purpose (no `"type": "module"`): sandboxed preload scripts must be CJS.
Config files use `.mts` for that reason.

### Core evaluation pipeline

`evaluate(pattern, size)` in `src/core/evaluate.ts` is pure and never throws on bad pattern
content. Every problem becomes a typed `EvaluationIssue` with an `ItemRef` pointing at the
offending item, and the affected values are omitted from the `ResolvedPattern`.

1. `model.ts`: zod schemas are the single source of truth; types are `z.infer`'d from them.
   `parsePattern()` validates untrusted JSON. The same schemas are meant to be mirrored in Convex.
2. `formula.ts`: mathjs is used **only as a parser**. `compileFormula` converts its AST into our
   own `Expr` union, rejecting anything outside a whitelist (functions, operators, `pi`/`tau`,
   `Name.x`/`Name.y`). `evaluateExpr` interprets `Expr`; mathjs `evaluate` is never called.
   New functions or syntax go in the tables and `toExpr`.
3. Measurements, variables and points share one name namespace. Graph nodes are keyed
   `measurement:<name>`, `variable:<name>`, `point:<id>.<axis>`; x and y are separate nodes, so
   cross-axis references between two points are not cycles.
4. `graph.ts`: Tarjan SCC gives dependency order plus every cycle (all members and one concrete
   path). Nodes downstream of a failure get `dependency-failed`.
5. `outline.ts` (internal, called once at the end of `evaluate`): turns resolved points into
   segment curves with lengths, and pieces into closed, oriented outlines with placed notches. Notch
   distances are the only other DAG nodes. Closure is checked by point id, not coordinates. All maths
   is in `geometry.ts`, a kernel with no model imports (arc length, sampling, flattening, area, SVG
   path data). Design and the segment-length-in-formulas recommendation: `docs/design/m2-geometry.md`.

Pattern changes go through `applyEdit(pattern, edit)` in `src/core/edit.ts`. It is pure, and a no-op
returns the same reference.

### Renderer

`App.tsx` holds the document in one `useReducer` (`editor/state.ts`). From it, `evaluate` produces the
ResolvedPattern, and `canvas/scene.ts` builds plain drawable data. The canvas camera (`canvas/camera.ts`)
is view state owned by `Canvas`, so pan and zoom never re-evaluate. Input policy lives in `canvas/input.ts`:
wheel and pinch, click versus drag-pan, and nearest-marker picking. Everything except the `.tsx` components
is pure and unit tested. Components are proved with the `canvas` journey. Design:
`docs/design/m3-canvas.md`.

`src/core/fixtures/raglan.ts` is the shared raglan tee fixture used across tests. Extend it as
milestones add pieces; it is the MVP acceptance test.

## Conventions

- Lengths are millimetres internally; `units` on a pattern is display only. y points down (SVG).
- Bezier control points are formulas relative to their anchors, so curves keep shape when graded.
- Strict TS with `noUncheckedIndexedAccess`. In core: no `any`, avoid `as` and `!`; model variants
  as discriminated unions and end switches with `const _exhaustive: never = x`.
- Tests sit next to the code (`*.test.ts`), call the public function and assert exact results.
- Small commits per milestone.

## Skills

Most installed skills are user-only, so use them when the user names them. Defaults for this repo
(details in `workflow.md`):

- New milestone: `/architect` to design, then `/tdd` to build core code.
- Changes to `model.ts` or `evaluate.ts`: `/blast-radius` before shipping.
- Core code follows `principle-type-system-discipline`, `principle-boundary-discipline` and
  `principle-test-behavior-not-implementation` (in `~/.claude/skills/`).
