# Editor panels

A dock under the canvas has three tabs: Measurements (a table with one column per size), Variables
(name, formula, value) and Points (name, x and y formulas). Every cell edits in place. Enter or
clicking away commits, Escape reverts, and a rejected value shows why. Committed edits redraw the
canvas straight away. Renaming an item rewrites every formula that uses it. Deleting an item that
others use leaves issues that point at the dependents. Rows can be added and deleted, and selecting
a point on the canvas jumps to its row.

## Sub-features

- `panels-tabs` shows the Measurements, Variables and Points tabs, Measurements first, with a column per size and the active size highlighted.
- `panels-measure` commits a measurement value and redraws; rejects non-numbers with a message; Escape reverts.
- `panels-variable` commits a variable formula (units like `12cm` allowed) and updates computed values.
- `panels-units` switches the header `Units` between cm and inches; tables, values and typed measurements follow.
- `panels-rename` renames a measurement and rewrites the formulas that use it; refuses a taken name.
- `panels-add` adds a variable that starts selected and can be renamed.
- `panels-delete` deletes a variable others use, lists the resulting issues, and clicking one selects the dependent variable.
- `panels-points` adds a point that appears on the canvas, moves it by formula, renames it and deletes it.
- `panels-canvas-sync` clicking a canvas point opens the Points tab with that row selected.
- `panels-console` produces no renderer errors.

## How to get to it (user POV)

- The header has a `Units` select (cm or inches).
- Launch the app. The dock sits under the canvas, with tabs `Measurements`, `Variables` and `Points`.
- Cells are text fields named `<row> <column>`, for example `chest M`, `neck name`, `body_width formula`, `HPS x`.
- Each row has a `Delete <name>` button. Below each table is a `+ Add measurement` / `+ Add variable` / `+ Add point` button.
- Clicking a point on the canvas, or an issue in the Issues list, selects the matching row and opens its tab.

## Driving it with run.mjs

Preconditions:

- `run.mjs doctor` passes.
- The pattern is the built-in raglan fixture, size M.

- **Open.** Launch it. `node .agents/skills/verify-pattern-maker/scripts/run.mjs .agents/skills/verify-pattern-maker/journeys/editor-panels.mjs`. `getByRole('tab', { name: 'Measurements' })` has `aria-selected="true"`.
- **Measurement value.** Fill `chest M` with `104` (cm) and press Enter. `getByLabel('chest M', { exact: true })`. The Underarm marker moves right and the Variables tab shows `body_width value` `28.5`.
- **Rejected value.** Fill `chest M` with `wide` and press Enter. An alert reads `'wide' is not a number`. Escape restores `104`.
- **Variable formula.** On the Variables tab, fill `chest_ease formula` with `12cm` and press Enter. `body_width value` reads `29`.
- **Units.** `getByLabel('Units').selectOption('in')`. `body_width value` reads `11.42`, the table is `Measurements (in)` and `chest M` reads `40.94`. Typing `42` there moves the Underarm marker. Switching back to `cm` shows `104`.
- **Rename.** Fill `neck name` with `neck_circ` and press Tab. Focus lands in `neck_circ S`. `neck_width formula` reads `neck_circ / 6 + 5` and the heading `Issues (0)` is visible. Renaming `chest` to `neck_circ` shows `'neck_circ' is already used by a measurement`.
- **Add.** Click `+ Add variable`. A row `variable_1` appears and is selected (`aria-selected="true"`). Renaming it to `ease` works.
- **Delete with dependents.** Click `Delete chest_ease`. The issues list shows `'chest_ease' is not defined`. Clicking it opens Variables with `body_width` selected. Renaming `ease` to `chest_ease` clears the issues.
- **Points.** On Points, click `+ Add point`. `Point P_1` appears on the canvas. Set `P_1 x` to `Underarm.x + 50`, and the marker moves right. Rename it to `Extra`, and `Point Extra` exists. `Delete Extra` removes the marker.
- **Canvas sync.** Click the Underarm marker's circle. The Points tab is selected and the `Underarm` row has `aria-selected="true"`.
- **Proof.** `evidence.screenshot` and `evidence.aria` on the measurement table, after a rename, and with issues showing.

## Gotchas

- `getByLabel` matches substrings: `chest M` also matches `chest MXL`-style labels if sizes change. Pass `{ exact: true }`.
- Renaming a measurement or variable changes the row's key, so its cells are new elements. Re-locate them by the new label.
- The dock takes 256 px from the canvas, so fitted canvas coordinates differ from M3 screenshots.
- Later steps need a clean pattern: after deleting `chest_ease`, the points step fails (Underarm can't resolve) unless the name is defined again.
- Values show in the pattern's display units (cm for the raglan); formulas are always mm unless they name a unit (`12cm`, `2inch`).
- `evidence.check` compares with `Object.is`, so compare arrays as joined strings.
- Commits happen on blur too. Moving focus to another cell commits the current one.
