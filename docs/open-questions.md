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

### Which units should the inspector show? (from M3)

Formulas are written in mm and the inspector shows mm, even when a pattern's display units are cm or
inches. **Current default:** mm everywhere. Revisit in M4, when the editor panels show
measurements.

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
