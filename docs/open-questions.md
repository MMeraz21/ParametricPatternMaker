# Open questions

Product decisions we've deferred until there's real pattern-making experience to answer them. Each
one has a working default so nothing is blocked. Revisit them while drafting real patterns, and
move answered ones to "Decided" with the reason.

## Open

### What should dragging a point do to its formula? (from M3)

Every point is placed by formulas, so a drag has to rewrite them somehow:

- Replace with a fixed value (`neck_width` → `87.3`). Simple, but the point stops grading between
  sizes.
- Add an offset (`neck_width` → `neck_width + 12.3`). Keeps grading, but offsets pile up over time.
- Allow dragging only control points, relative to their anchor. Curves keep their shape when graded.

**Current default:** no dragging. You edit formulas in the inspector.

### Should a mouse wheel zoom or pan? (from M3)

**Current default:** a plain scroll pans (natural on a trackpad). Pinch and Cmd/Ctrl+scroll zoom
about the cursor, and there are zoom buttons. A preference toggle is the likely answer if this feels
wrong with a mouse.

### Inches as fractions? (from M4)

Inches show as decimals to the hundredth (`40.94`). Sewists working in inches often use fractions
(`40 15/16`). **Current default:** decimals for display and input.

### Variables that aren't lengths (from M4)

Variable values are always shown converted to the display unit, which is wrong for a ratio such as
`0.55`: in cm it shows as `0.1`. **Current default:** treat every variable as a length, since all of
the raglan's are. A possible fix is a per-variable "unitless" flag.

### Should deleting something that's in use ask first? (from M4)

Deleting a measurement, variable or point that other formulas use is allowed. The dependents then show
"'x' is not defined" issues, and clicking one jumps to the item that needs fixing. Defining the name again
(by renaming or adding) clears them. **Current default:** no confirmation and no "used by N" count.
Possible additions are a confirmation that lists the dependents, or a "used by" column.

### Adding, removing and renaming sizes (from M4)

The measurement table has one column per size in `pattern.sizes`, but you can't add or remove sizes
yet. **Current default:** sizes are fixed (S to XXL in the raglan). Designed for M6 in
`docs/design/m6-size-switcher.md`. This moves to Decided when it's built.

### Which size should a file open at? (from M6)

The size you're looking at isn't saved, so looking at another size never counts as changing the file. **Current default:** a file
opens at its first size, and the raglan opens at M. Remembering the last size per file on this computer, outside the file, is the
likely addition.

### What should a new size start as? (from M6)

**Current default:** a copy of the size you're looking at, placed right after it. You then type the real measurements. Nothing marks
it as unfinished. Extending the step between neighbouring sizes is the alternative, but it invents numbers nobody entered.

### What counts as a valid size name? (from M6)

**Current default:** anything except an empty name, spaces at either end, a name that matches another size ignoring case (`xl` and
`XL`), or a word programs reserve (`constructor`, `__proto__`). `38`, `2XL` and `Petite M` are fine.

### Reordering sizes (from M6)

**Current default:** no reordering. A new size goes after the one you're looking at, so nothing can be added before the first size.

### Should removing a size ask first? (from M6)

Removing a size deletes its value in every measurement, and there's no undo yet. **Current default:** no confirmation, the same as
deleting a measurement. A confirmation that says how many values go is the alternative.

### Where should a piece stack in the all-sizes view? (from M6)

Pieces drafted from a shared origin nest by themselves. Others, like a sleeve drawn to the side, name a stack point, the spot where
every size meets. **Current default:** a piece with no stack point stays where it was drafted. The pieces only slide into place and
never rotate. Guessing a stack point automatically is the alternative, but a wrong guess can't be corrected.

### What should the all-sizes view draw? (from M6)

**Current default:** every other size's seam line and cut line, without points, notches or grainlines, and always every size. Printed
nests often show only cut lines, and choosing which sizes to show is a possible addition.

### Should switching size move the view? (from M6)

**Current default:** no, so you can compare sizes in a still frame. A larger size can run off the edge until you press Fit. Turning on
All sizes zooms out only if you were viewing the whole size and the nest doesn't fit.

### Should clicking an issue change the size? (from M6)

**Current default:** yes, when the problem isn't in the size you're looking at, so you land where you can see it.

### How should a cell show a problem from another size? (from M6)

A formula is shared by every size, so a problem in XXL is one you'd fix in the same cell. **Current default:** red for a problem in
the size you're looking at, amber for a problem only in other sizes.

### Does a problem in one size block export? (from M6)

A cut line can fail in XXL while M is fine. **Current default for M7 to confirm:** export is refused for the sizes that have the
problem and works for the rest.

### Reordering rows (from M4)

New measurements, variables and points go at the bottom, and rows can't be reordered. **Current
default:** no reordering. Order doesn't affect evaluation.

### Should formulas reference segment lengths? (from M2)

Recommended yes, after M5. It needs segments to have names formulas can use: either reuse ids as
names, or add a `Segment.name` field, which is a schema change. Details are in
`docs/design/m2-geometry.md`.

### Should a point show its x value when only y fails? (from M3)

`ResolvedPattern` drops both coordinates when either one fails, so the inspector shows "—" for both.
Fixing this is a small `evaluate` change.

### How long may a sharp corner's allowance tip be? (from M5)

Where two edges meet at a sharp angle, the allowance comes to a long point. **Current default:** the
point is trimmed once it reaches 4× the wider of the two allowances. It's one constant to change.

### Should a hem corner be shaped so it folds back flat? (from M5)

When a hem is folded up, a plain corner can leave the side seam allowance too narrow or too wide. Pattern
makers often shape that corner to mirror the seam. **Current default:** plain corners, where each edge's
offset runs straight to where it meets its neighbour. A per-corner choice could come later.

### How long is a notch mark on the printed cut line? (from M5)

**Current default:** 6 mm, cut inward from the cut line. T-notches or a depth tied to the allowance are
the alternatives.

### What does `cutCount: 2` mean? (from M5)

It could be a mirrored pair, like sleeves, or two identical pieces. **Current default:** the app doesn't
say. It carries the number and export prints "Cut 2".

### Is cut-on-fold a property of an edge? (from M5)

The plan has `mirror: true` on a piece, which doesn't say where the fold is. **Current default:** replace
it with `fold: <edge>`, which names the edge, forces its allowance to 0 and checks the edge is straight
with the whole piece on one side.

### Can a zero allowance be used on an edge that isn't a fold? (from M5)

For example, a raw edge finished with binding. **Current default:** allowed, and its corners behave
exactly like a fold's.

### Should an edge hidden by its neighbours block the cut line? (from M5)

A very curved neckline or a narrow slot can have an allowance so wide that the neighbouring allowance
covers the edge completely (at or above the radius of a tight inward curve, or half a slot's width).
**Current default:** no cut line, and an issue names the edge to change. The alternative is to draw the
filled-in outline and show a warning.

### How do you define a piece's outline? (from M5)

**Current default:** a table of edges where you type segment names in order. Clicking segments on the
canvas is the likely improvement.

## Decided

- **A piece's stack point is a field on the piece** (M6), rather than constants in the raglan's formulas. Constants
  would change where size M is drafted and tie the layout to the largest size. Whether a piece without one should
  get a guessed stack point is still open above.
- **An outline with a gap omits the piece** (M2). Its segments still draw and the issue names both
  points. This avoids exporting a piece with a hole in its edge.
- **A notch on a segment outside its piece's outline is an error** (M2). Notches that appear on both
  sides of a seam would be a separate "seam pairs" feature.
- **Notch distance is measured from its segment's own start** (M2), even when the outline runs the
  segment backwards.
- **Display units are cm or inches; formulas stay in mm** (M4). Switching units changes how measurements,
  values and coordinates are shown, and how typed measurement values are read. A bare number in a formula
  is always mm, because the app can't tell a length (`10`) from a ratio (`/ 4`). Formulas can name a unit
  explicitly: `12cm`, `2inch`, `5mm`.
- **Renaming rewrites every formula that uses the name** (M4), keeping the user's formatting. If a
  rewrite can't be done safely, the rename is refused rather than half-applied.
- **Edits commit on Enter or when you click away** (M3, M4), not on every keystroke, so a half-typed
  formula doesn't make points blink in and out.
