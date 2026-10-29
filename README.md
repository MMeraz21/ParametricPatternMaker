# Parametric Pattern Maker

A desktop app for drafting garment sewing patterns parametrically. A pattern is a graph of points and
curves defined by formulas over body measurements: change a measurement or switch sizes and every
piece redraws. See [PLAN.md](PLAN.md) for the full plan and milestones.

## Stack

Electron, React, TypeScript, Vite (electron-vite), Tailwind, mathjs, zod, Vitest.

## Development

```sh
npm install
npm run dev        # launch the app with hot reload
npm test           # run unit tests
npm run typecheck  # type-check main, preload, renderer and core
npm run build      # production build into out/
```

## Layout

- `src/core`: pure TypeScript pattern engine (data model, formulas, dependency graph, evaluation).
  No UI or Electron imports. Fully unit tested.
- `src/main`: Electron main process.
- `src/preload`: typed IPC bridge exposed to the renderer as `window.api`.
- `src/renderer`: React UI.

All lengths are stored in millimetres; `units` on a pattern only controls display.
