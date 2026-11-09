# Canvas

The window body shows the raglan tee front, size M, drawn on a canvas, with an inspector and an
issues list on the right. You can pan and zoom the canvas. Clicking a point shows its x and y
formulas in the inspector. Editing a formula and pressing Enter redraws the pattern. A point whose
formula is broken disappears from the canvas, and you can still reach and fix it through the issues
list.

## Sub-features

- `canvas-render` draws the Front piece, its 5 points and 4 control points, with `Issues (0)`.
- `canvas-fit` fits the whole pattern inside the canvas on launch and again with `Fit`.
- `canvas-zoom` zooms with the `Zoom in` / `Zoom out` buttons and with pinch or ctrl+wheel, keeping the point under the cursor fixed.
- `canvas-pan` pans by dragging empty canvas and with a plain wheel or two-finger scroll; a drag ends if a move reports no button held.
- `canvas-constant-size` keeps markers the same on-screen size at every zoom.
- `canvas-select` selects a point by clicking it, shows its formulas and values, and clears when you click empty canvas.
- `canvas-edit` commits a formula on Enter, moving the point and the points that depend on it; Escape reverts a draft.
- `canvas-broken` keeps a broken point selected and editable, lists its issue, and lets you reselect it from the issues list.
- `canvas-console` produces no renderer errors.

## How to get to it (user POV)

- Launch the app. The canvas fills the area under the header, with the inspector and issues on the right.
- Canvas toolbar (top left of the canvas): `Zoom out`, zoom level readout, `Zoom in`, `Fit`.
- Click a point marker to select it. Click empty canvas to clear the selection.
- Pinch or ctrl/cmd+scroll over the canvas to zoom; scroll or drag empty canvas to pan.
- Inspector fields `<Name> x formula` and `<Name> y formula`. Enter or clicking away commits, Escape reverts.
- Issues list: a point's issue is a button that selects the point.

## Driving it with run.mjs

Preconditions:

- `run.mjs doctor` passes.
- The pattern is the built-in raglan fixture, size M (there is no file loading yet).

- **Open.** Launch it. `node .agents/skills/verify-pattern-maker/scripts/run.mjs .agents/skills/verify-pattern-maker/journeys/canvas.mjs`. The canvas `getByRole('group', { name: 'Pattern canvas' })` is visible.
- **Render.** Count markers. `window.getByRole('button', { name: /^Point / })`. There are 9, `getByLabel('Piece Front')` exists, and the heading `Issues (0)` is visible.
- **Fit.** Read the marker circles' boxes. `marker(name).locator('circle').boundingBox()`. All of them are inside the canvas box.
- **Zoom buttons.** Click `Zoom in`. `getByRole('button', { name: 'Zoom in' }).click()`. The screen distance from HPS to CFHem grows by 1.25x and the readout goes up.
- **Zoom about the cursor.** Hover HPS, then hold Control and wheel up. `window.mouse.move(x, y)`, `keyboard.down('Control')`, `mouse.wheel(0, -100)`. HPS stays within 1 px of where it was and the readout goes up.
- **Constant size.** Compare a marker circle's box before and after zooming. It doesn't change.
- **Pan.** Drag from empty canvas. `mouse.down()`, `mouse.move()` in steps, `mouse.up()`. HPS moves by the drag delta (within 1 px). A plain `mouse.wheel(0, 50)` moves it up by 50 px.
- **Select.** Click the Underarm circle. `marker('Underarm').locator('circle').click()`. The inspector heading is `Underarm`, `Underarm x formula` holds `body_width`, the `Underarm.x value` output reads `27.5 cm` (the raglan displays in cm), and the marker has `aria-pressed="true"`. A control point shows `Control point`.
- **Edit.** Fill `HPS x formula` with `neck_width + 30` and press Enter. `HPS.x value` reads `10 cm`, and both the HPS and NeckC1 markers move right.
- **Escape.** Type into the field, then press Escape. The field shows the committed formula again.
- **Broken.** Fill `HPS x formula` with `nope` and press Enter. The `alert` appears, there's no `Point HPS` marker, and the issues heading is no longer `Issues (0)`. Select another point, then click the `'nope' is not defined` issue button. The inspector is back on HPS. Fixing the formula brings the marker back and returns to `Issues (0)`.
- **Clear.** Click empty canvas. The inspector shows `Select a point on the canvas to see its formulas.`
- **Proof.** `evidence.aria(window, ...)` and `evidence.screenshot(window, ...)` after rendering, selecting and breaking.

## Gotchas

- The real cursor can send mouse events with the same pointer id as Playwright's. The runner reduces this with `setIgnoreMouseEvents`, but a rare `canvas-pan: drag moves content` failure showing a short pan (for example `-24, -16`) was still seen once in 145 runs, cause unconfirmed. Rerun it; a repeatable failure is a real bug.
- Click the marker's `circle`, not the marker button: the button's box includes its label, so its centre can be over 10 px from the point and miss the pick.
- The camera fits on the first resize. Wait for a marker to be visible before measuring.
- Zoom and pan are animated by nothing: measure right after the action, but re-read boxes after every action.
- Empty canvas: the right edge of the canvas (beside the narrow front piece) is empty at the fitted zoom. Pick click spots from the canvas box, not fixed coordinates.
- Escape reverts the draft without blurring. Blurring afterwards commits the committed formula again, which is a no-op.
