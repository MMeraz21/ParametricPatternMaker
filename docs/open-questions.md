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
yet. **Current default:** sizes are fixed (S to XXL in the raglan). Planned for M6, the size switcher.

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

## Decided

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
