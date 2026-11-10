# Pieces

Each piece that resolves is drawn with its seam allowance cut line, grainline, fold line and notch
marks. The Pieces tab has one row per piece: name, default allowance, grainline ends, fold edge and
cut count. Selecting a piece highlights it and adds its Edges and Notches tables, where one edge can
have its own allowance. The Segments tab defines the curves that outlines are made of. Allowances are
formulas. Anything that stops a cut line is listed in Issues, and the rest of the piece stays drawn.

## Sub-features

- `pieces-canvas` draws a cut line, grainline and notch marks for the raglan pieces, and a fold line only on the pieces cut on the fold.
- `pieces-select` selecting a piece highlights its row and adds `Edges of <piece>` and `Notches of <piece>` beside it, visible without scrolling.
- `pieces-allowance` a default allowance formula moves the cut line.
- `pieces-override` an edge allowance moves only that edge, and blank returns it to the default.
- `pieces-fold` clearing the fold removes the fold line and gives that edge an allowance; an edge not in the piece is refused.
- `pieces-issue` a broken allowance removes the cut line but keeps the piece, and its issue opens the Pieces tab.
- `pieces-failure` an allowance too large to build reports why.
- `pieces-notch` a notch distance moves its mark; notches can be added and deleted.
- `pieces-segment` a segment's points are typed by name, a name that doesn't exist is refused, and its kind can change.
- `pieces-add` a new piece starts selected, reports that it has no outline, and can be deleted.
- `pieces-delete` the `×` on a piece that isn't selected deletes it on the first click.
- `pieces-console` produces no renderer errors.

## How to get to it (user POV)

- Launch the app. Canvas paths are named `Cut line <piece>`, `Piece <piece>`, `Grainline <piece>`, `Fold <piece>` and `Notch mark <piece>`.
- Open the `Pieces` tab in the dock under the canvas.
- Piece cells are named `<piece> name`, `<piece> allowance`, `<piece> grain from`, `<piece> grain to`, `<piece> fold` and `<piece> cut count`.
- Focusing or clicking a piece's row selects it. Edge cells are named `<segment> allowance`, and notch cells `<notch> distance`.
- Segment cells on the `Segments` tab are named `<segment> kind`, `<segment> from`, `<segment> c1`, `<segment> c2` and `<segment> to`.

## Driving it with run.mjs

Preconditions:

- `run.mjs doctor` passes.
- The pattern is the built-in raglan fixture, size M.

- **Open.** `node .agents/skills/verify-pattern-maker/scripts/run.mjs .agents/skills/verify-pattern-maker/journeys/pieces.mjs`.
- **Canvas.** `Cut line Front`, `Grainline Front`, `Fold Front` and `Notch mark Front` exist. `Fold Sleeve` doesn't.
- **Allowance.** On Pieces, fill `Sleeve allowance` with `20` and press Enter. The `Cut line Sleeve` path changes.
- **Override.** Select Front. Fill `frontHem allowance` with `40`. The lowest point of `Cut line Front` is 730 mm. Blank returns it to the default, 700 mm.
- **Fold.** Blank `Front fold`. `Fold Front` is gone and the cut line reaches x = -10 mm. Typing `sleeveHem` shows an alert.
- **Broken allowance.** Fill `Front allowance` with `nope`. `Cut line Front` is gone, `Piece Front` stays. On another tab, clicking the issue `'nope' is not defined` opens Pieces.
- **Proof.** `evidence.screenshot` of the canvas, and of the Pieces tab with a piece selected.

## Gotchas

- The fitted view includes the cut lines, so canvas coordinates differ from earlier milestones. Read geometry from the `d` attribute, which is in mm, not from pixels.
- `Edges of <piece>` only exists while that piece is selected.
- Focusing any cell of a piece's row selects it, so the Edges and Notches tables appear as soon as you start typing in the Pieces table.
- Later steps need the pattern restored: each step here puts back what it changed.
