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
- `panels-variable` commits a variable formula and updates computed values.
- `panels-rename` renames a measurement and rewrites the formulas that use it; refuses a taken name.
- `panels-add` adds a variable that starts selected and can be renamed.
- `panels-delete` deletes a variable others use, lists the resulting issues, and clicking one selects the dependent variable.
- `panels-points` adds a point that appears on the canvas, moves it by formula, renames it and deletes it.
- `panels-canvas-sync` clicking a canvas point opens the Points tab with that row selected.
- `panels-console` produces no renderer errors.

## How to get to it (user POV)

- Launch the app. The dock sits under the canvas, with tabs `Measurements`, `Variables` and `Points`.
- Cells are text fields named `<row> <column>`, for example `chest M`, `neck name`, `body_width formula`, `HPS x`.
- Each row has a `Delete <name>` button. Below each table is a `+ Add measurement` / `+ Add variable` / `+ Add point` button.
- Clicking a point on the canvas, or an issue in the Issues list, selects the matching row and opens its tab.

## Driving it with run.mjs

Preconditions:

- `run.mjs doctor` passes.
- The pattern is the built-in raglan fixture, size M.

- **Open.** Launch it. `node .agents/skills/verify-pattern-maker/scripts/run.mjs .agents/skills/verify-pattern-maker/journeys/editor-panels.mjs`. `getByRole('tab', { name: 'Measurements' })` has `aria-selected="true"`.
- **Measurement value.** Fill `chest M` with `1040` and press Enter. `getByLabel('chest M', { exact: true })`. The Underarm marker moves right and the Variables tab shows `body_width value` `285`.
- **Rejected value.** Fill `chest M` with `wide` and press Enter. An alert reads `'wide' is not a number`. Escape restores `1040`.
- **Variable formula.** On the Variables tab, fill `chest_ease formula` with `120` and press Enter. `body_width value` reads `290`.
- **Rename.** Fill `neck name` with `neck_circ` and press Enter. `neck_width formula` reads `neck_circ / 6 + 5` and the heading `Issues (0)` is visible. Renaming `chest` to `neck_circ` shows `'neck_circ' is already used by a measurement`.
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
- `evidence.check` compares with `Object.is`, so compare arrays as joined strings.
- Commits happen on blur too. Moving focus to another cell commits the current one.
