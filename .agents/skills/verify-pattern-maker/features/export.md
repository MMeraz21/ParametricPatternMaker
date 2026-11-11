# Export

`Export…` in the header opens a dialog that prints the pattern at true size. It lists every size with a checkbox, the shown size
ticked, and a size that can't print is disabled with a line saying which pieces are wrong. Paper (Letter or A4) and a title are
chosen there, the footer counts pages, and the printing instruction is always shown. `Save PDF` writes a tiled PDF with a 5 cm
(or 2 in) test square on page A1. `Save SVG` writes one full-size SVG. Both go through the system save dialog.

## Sub-features

- `export-pdf` the dialog opens with M ticked, counts 21 Letter pages, and saves a 21-page Letter PDF whose square measures 50 mm.
- `export-svg` saves an SVG whose width and height are in mm.
- `export-sizes` ticking sizes changes the page count, nothing ticked disables saving, and a size that fails can't be ticked and says why.
- `export-cancel` cancelling the save dialog writes nothing, shows nothing and leaves the export dialog open.
- `export-failure` a failed write shows a message and leaves the export dialog open.
- `export-console` produces no renderer errors.

## How to get to it (user POV)

- Launch the app. The header has an `Export…` button, which opens the dialog named `Export`.
- Size checkboxes are named `Size <size>`. The selects and fields are `Paper` and `Title`. Buttons are `Close`, `Save SVG` and `Save PDF`.
- A saved file is reported in a `status`, and a failure in an `alert`.

## Driving it with run.mjs

Preconditions:

- `run.mjs doctor` passes.
- The pattern is the built-in raglan fixture, opened at size M.

- **Open.** `node .agents/skills/verify-pattern-maker/scripts/run.mjs .agents/skills/verify-pattern-maker/journeys/export.mjs`.
- **Dialog.** `getByRole('button', { name: 'Export…' }).click()`, then `getByLabel('Paper').selectOption('letter')`. The footer reads `21 pages of Letter`.
- **Save.** The native save dialog is replaced with `app.evaluate` returning a path in a temporary folder. `Save PDF` shows `Saved to <path>`, and the file loads with pdf-lib.
- **Measure.** On macOS, `scripts/measure-pdf.swift <file> 0 600 20 47` renders page A1 with PDFKit and prints the square's size. Off macOS the step is recorded as skipped.
- **Refuse.** Close, type `chest > 1200 ? 0 : 60` into `band_width formula` on the Variables tab, reopen. `Size XXL` is disabled and reads `XXL can't be printed: Neckband has no outline.`
- **Cancel and fail.** The stub returns `{ canceled: true }`, then a path in a missing folder. The second shows `That folder doesn't exist any more.`

## Gotchas

- The save dialog is native and can't be clicked by Playwright. Stub it per save, before clicking.
- The default paper follows the system locale, so select it before checking page counts.
- `(20, 47)` mm is inside the test square on A1 only while the margin, key inset and key layout stay as built. If the measure step reports no square, check those first.
- The PDFKit render proves the file, not a printer. The last check is printing A1 at 100% and measuring with a ruler.
