# Sizes

A dropdown in the header switches the size on screen, and every value and piece follows. It lists each size with the number of
problems it has. `All sizes` draws every other size nested around the shown one, with a legend that says what a size can't draw.
The `Sizes` tab adds, renames and removes sizes. Problems that happen in only some sizes are listed once with a badge naming the
sizes, and clicking one goes to a size that has it.

## Sub-features

- `sizes-switch` choosing a size moves the cut lines, updates values and moves the column emphasis.
- `sizes-camera` switching size never moves the view. Turning on `All sizes` from a fit view keeps the nest on screen, and from a zoomed-in view changes nothing.
- `sizes-edit` editing another size's measurement changes nothing drawn until you switch to it, and a half-typed cell commits when the dropdown takes focus.
- `sizes-nest` `All sizes` draws 16 outlines at M, offset by each piece's stack point, and adds no markers.
- `sizes-nest-failure` a piece that fails in XXL is left out of the nest and named in the legend.
- `sizes-issue` the dropdown counts problems per size, an issue from another size has a badge, and clicking it selects the item and switches size.
- `sizes-add` `+ Add size` adds a copy of the size on screen and shows it, with no new issues.
- `sizes-rename` renaming updates the column and the option, and bad names are refused.
- `sizes-remove` removing the shown size moves to a neighbour, and the last size can't be removed.
- `sizes-perf` turning on `All sizes` paints within 100 ms.
- `sizes-console` produces no renderer errors.

## How to get to it (user POV)

- Launch the app. The header has a `Size` dropdown and an `All sizes` checkbox.
- Nest paths are named `Graded <size> <piece>` and `Graded cut line <size> <piece>`. The legend is the list named `Size legend`.
- Open the `Sizes` tab in the dock. Cells are named `<size> name`, and the delete buttons `Delete <size>`.
- Measurement cells are named `<measurement> <size>`.

## Driving it with run.mjs

Preconditions:

- `run.mjs doctor` passes.
- The pattern is the built-in raglan fixture, opened at size M.

- **Open.** `node .agents/skills/verify-pattern-maker/scripts/run.mjs .agents/skills/verify-pattern-maker/journeys/sizes.mjs`.
- **Switch.** `getByLabel('Size', { exact: true }).selectOption('XXL')`. The lowest y of `Cut line Front` goes from 715 to 775.
- **Nest.** `getByLabel('All sizes').check()`. `Graded S Sleeve` has `translate(40 0)`.
- **Failure.** Type `chest > 1200 ? 0 : 60` into `band_width formula`. The dropdown reads `XXL (1 issue)` and the legend reads `Neckband: no outline`.
- **Add.** `Sizes` tab, `+ Add size`. The dropdown shows `Size 1`.

## Gotchas

- Size names are user-chosen and `getByLabel` matches substrings, so always pass `exact: true`.
- The value of a dropdown option is the bare size name. Its text carries the issue count.
- The view is unchanged by a switch, so read geometry from the path's `d`, not from the screen.
