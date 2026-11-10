# Parametric Pattern Maker verification map

This directory is the maintained source for verifying the user-facing behavior of Parametric
Pattern Maker. Read the index before driving the app, then use the matching feature file and its
journey in `../journeys/` as the recipe.

## Baseline preconditions

- Launch through `scripts/run.mjs`, which builds `out/` and starts the app on a throwaway profile.
- `run.mjs doctor` passes: real app version, throwaway profile, preload bridge, fresh build.
- Never drive an instance this run did not start, including the user's `npm run dev` window.

## Driving conventions

- Start every journey from a fresh launch. The runner gives each run a new profile.
- Locate elements by ARIA role and accessible name. If new UI lacks one, add it in the source.
- Treat quoted names and text as literal.
- Prefix every `evidence.check` name with the sub-feature ID.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot and a screenshot showing the app heading or title.
- File or sync proof includes a second, read-only view of the stored value.
- Report the evidence directory and `result.json` status with every claim.
- Report an unreachable entry point with the attempted action and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior,
then exactly four H2 sections in this order:

1. `Sub-features`: short IDs, one line each.
2. `How to get to it (user POV)`: every user entry point.
3. `Driving it with run.mjs`: starts with `Preconditions:`, then labeled bullets pairing each user
   action with the exact Playwright call and the observable result.
4. `Gotchas`: traps that waste or invalidate a run.

Keep implementation details out of the map. Name only user paths, stable handles, required state,
commands and observable proof.

## Features

- [App shell](./app-shell.md) covers the main window, its title and heading, the version shown via
  the preload bridge, styling, and renderer isolation.
- [Canvas](./canvas.md) covers drawing the pattern, pan and zoom, selecting a point, and editing
  its formulas in the inspector, including fixing a broken point from the issues panel.
- [Editor panels](./editor-panels.md) covers the measurement table, variables and points tabs:
  editing, renaming, adding, deleting, and jumping to rows from the canvas and issues list.
- [Pieces](./pieces.md) covers cut lines, grainlines, folds and notch marks on the canvas, and editing
  allowances, edges, notches and segments in the Pieces and Segments tabs.
- [Sizes](./sizes.md) covers the size dropdown, the nested all-sizes view, problems that happen in some
  sizes, and adding, renaming and removing sizes.

## Not yet built

PLAN.md milestones 7 onward add: PDF/SVG export,
open/save, and Convex sync. Add a feature file and a journey for each as it lands.
