# Milestone 7: export

Status: designed and reviewed. Cross-platform points added after review. Building.

Numbers marked **ran** come from throwaway experiments on an Apple-silicon laptop on 2026-11-10, against the real `src/core`, pdf-lib 1.17.1
and the repo's Electron 45 where stated. Numbers marked **unverified** are general knowledge nobody executed here. Product decisions with
a working default are in `docs/open-questions.md`.

## Problem

M7 prints a pattern: a tiled PDF at true 1:1 with page overlap, alignment marks, A1/A2 labels and a 5 cm / 2 in test square, plus a
full-size SVG. `graded` already holds every size in mm. Everything on the way out is missing, and six facts make the shape non-obvious.

- **Every raglan piece is bigger than a page.** The smallest box is 359 x 80 mm against A4's 297 mm long edge. Spanning pages is the normal case.
- **Pieces sit at unrelated draft coordinates,** some negative, and some overlap in draft space. A print layout has to be invented.
- **`placed` doesn't mean printable, and `no-stack-point` doesn't mean unprintable.** Only `bySize[i].resolved.pieces[id]` and its optional fields say what would print.
- **A wrong physical size is the worst possible bug.** The user finds out with a ruler, or after cutting fabric.
- **pdf-lib has traps.** `pushOperators(...ops)` overflows on large input (**ran**), per-page content is over 20x slower than a shared form on large input (**ran**), `PageSizes.A4` is rounded, and `/PrintScaling` is advisory.
- **The bridge has one channel, and CSP blocks `blob:`.** The renderer can't hand a file to the user by itself.

Constraints kept: `src/core` has no UI, Electron or Node imports; evaluation goes through `evaluateGraded`; `boundaries.test.ts` pins new boundaries.
The app targets Linux, macOS and Windows, so nothing shipped or required for acceptance may depend on one OS (decision 11).
`model.ts` and `evaluate.ts` don't change, so `/blast-radius` isn't required.

## Usage (caller's view)

Printing is three calls. One says what can print, one decides what goes where and is cheap enough to run on every tick of a checkbox, and one produces the bytes.

```tsx
// renderer/src/export/ExportDialog.tsx. `pattern`, `graded` and the shown size come from App, which already holds them.
const status = useMemo(() => printStatus(pattern, graded), [pattern, graded])
const outcome = useMemo(() => planPoster(pattern, graded, { sizes: [...ticked], paper, title }), [pattern, graded, ticked, paper, title])

async function exportNow(format: ExportFormat): Promise<void> {
  if (outcome.kind !== 'planned') return
  setStage({ kind: 'working' })
  try {
    setStage(stageAfter(await window.api.saveExport(await writePosterFile(outcome.plan, format))))
  } catch (cause) {
    setStage({ kind: 'failed', message: `The file couldn't be built: ${String(cause)}` })
  }
}

// A size with a problem can't be ticked, and its row says why.
{status.map(({ size, defects }) => <SizeRow key={size} size={size} defects={defects} ticked={ticked.has(size)} onToggle={toggle} />)}

// Footer, updated live, and the printing instruction from core.
{outcome.kind === 'planned' ? `${pagesOf(outcome.plan)} pages of ${PAPER[paper].label}` : 'Nothing to export'}
<p>{PRINT_INSTRUCTION}</p>
```

The acceptance fixtures have one defined answer each.

```ts
const graded = evaluateGraded(raglanFailingInXXL)

printStatus(raglanFailingInXXL, graded).at(-1)
// { size: 'XXL', defects: [{ pieceId: 'front', pieceName: 'Front', defect: 'no-cut-line' },
//                          { pieceId: 'neckband', pieceName: 'Neckband', defect: 'no-outline' }] }

planPoster(raglanFailingInXXL, graded, { sizes: raglanFailingInXXL.sizes, paper: 'letter', title: 'Raglan' })
// kind 'planned'. sheets are S, M, L, XL. refused is XXL with the two defects above.

planPoster(raglanFailingInXXL, graded, { sizes: ['XXL'], paper: 'letter', title: 'Raglan' })
// { kind: 'nothing-to-print', refused: [ ...XXL... ] }. No file can be written.

planPoster(raglanPrintHazards, evaluateGraded(raglanPrintHazards), { sizes: raglanPrintHazards.sizes, paper: 'a4', title: 'Raglan' })
// sheets are M, XL, XXL, with a 50.8 mm test square. refused is S (Sleeve: no-grainline) and L (Back: notch-lost).
```

The bridge is one call. Main receives a finished file and knows nothing about patterns.

```ts
const file = await writePosterFile(plan, 'pdf')     // { fileName: 'Raglan-M-letter.pdf', data: Uint8Array }
await window.api.saveExport(file)
// { kind: 'saved', path: '/Users/.../Raglan-M-letter.pdf' } | { kind: 'cancelled' } | { kind: 'failed', message: 'The disk is full.' }
```

A test reads the plan without parsing any file format.

```ts
const { plan } = planned(raglanTee, { sizes: ['M'], paper: 'a4', title: 'Raglan' })
const [sheet] = plan.sheets
sheet.tiles[0].label                                  // 'A1', always
blockOf(sheet, 'key').marks.find(isTestSquare)        // four line curves, each exactly 50 long
```

## Shape

```
pattern, graded
   │  printStatus             one rule for "this size has a problem"
   ▼
planPoster (pure, sync, about 1 ms)  ─►  PosterPlan   plain data, mm, y down
   │   pack boxes onto one poster per size
   │   cut the poster into a uniform page grid
   │   draw every piece, the key and the tile guides as Marks
   ▼
writePosterFile (async, deterministic)
   ├ posterPdf.ts   each sheet = one form holding the whole poster. Each page = a clip and a translate. The only importer of pdf-lib.
   └ posterSvg.ts   sheet.art only, as one mm-sized document
   ▼
PosterFile { fileName, data }  ─►  window.api.saveExport  ─►  main: dialog, atomic write. Result as data.
```

Load-bearing decisions:

1. **The plan is the one layout.** A piece's position, the tile grid, every mark and every label are decided once, in pure code, in plain data. A writer decides only syntax.
2. **The plan cannot express scale.** A `Block` has a translation and nothing else. The only scale in a PDF is one matrix per page in one file, per encode-lessons-in-structure.
3. **The page is only a window.** Every drawn thing, including alignment marks and page labels, is poster content in one form. A page's whole content stream is eight operators (**ran**). A mark on A1's right edge and the same mark on A2's left edge are one drawing, and they cannot disagree.
4. **A size prints whole or not at all,** and "has a problem" is about the output, not about issue counts.
5. **pdf-lib is the container, not the drawing API.** Art goes in as one hand-written content string through `context.flateStream`, so no art operator touches `pushOperators`. Overflow is impossible at any size, rather than chunked around.
6. **Main stays dumb and stateless.** One invoke carries finished bytes. The path comes only from the dialog, per boundary-discipline.

Interface depth: three functions and the data they return. Behind them are the printability rule, packing and the column search, tile cutting, blank-page
skipping, seam marks, piece drawing (fold-aware cut strokes, label placement, grainline and fold arrows), the key, both file syntaxes, numeric care for points,
and file naming. A caller learns none of that. The writers aren't public, so there is one way to get a file.

### Module map

| File | Change |
|---|---|
| `src/core/poster.ts` (new) | Public types, `PAPER`, `PEN`, `PRINT_INSTRUCTION`, `printStatus`, `planPoster`. Owns the plan. |
| `src/core/posterPack.ts` (new, internal) | `packBoxes`: MaxRects with the column search. No model imports. |
| `src/core/posterArt.ts` (new, internal) | `pieceMarks`, `keyMarks`, `tileGuides`. Everything that is drawn and in what pen. |
| `src/core/posterPdf.ts` (new, internal) | `writePosterPdf`. **The only file that imports `pdf-lib`,** and the only place `PT_PER_MM` exists. |
| `src/core/posterSvg.ts` (new, internal) | `writePosterSvg`. String building and XML escaping. |
| `src/core/posterFile.ts` (new) | `writePosterFile`, `ExportFormat`, naming. The exhaustive format switch. |
| `src/core/index.ts` | Named exports from `poster` and `posterFile`. |
| `src/core/boundaries.test.ts` | See Acceptance. |
| `src/core/fixtures/raglan.ts` | `raglanPrintHazards`. **Already added** with its tests in `raglan.test.ts`. |
| `src/main/saveExport.ts` (new) | `runSaveExport(raw, ports)`: validation, dialog, write, result mapping. No Electron import, so vitest drives it with fakes. |
| `src/main/atomicWrite.ts` (new) | `writeAtomically`. Node only. |
| `src/main/index.ts` | `ipcMain.handle('export:save', …)` wiring real ports. Still doesn't import `@core`. |
| `src/preload/api.ts`, `index.ts` | `saveExport`. `index.d.ts` needs no change. |
| `src/renderer/src/export/ExportDialog.tsx` (new) | The modal. |
| `src/renderer/src/export/stage.ts` (new) | Pure `stageAfter`, default ticks, `defaultPaper`, messages. |
| `src/renderer/src/App.tsx` | Export button in the header row, `exportOpen` as local state. Never saved or undone. |
| `.agents/skills/verify-pattern-maker/` | `features/export.md`, `journeys/export.mjs`, `scripts/measure-pdf.swift` (optional, macOS only), the README list and its "Not yet built" paragraph. |
| `package.json` | `pdf-lib` `1.17.1`, exact, as `clipper2-ts` is pinned. |
| Docs | `open-questions.md` (done), the `CLAUDE.md` pipeline once built. |

### Types

`src/core/poster.ts`:

```ts
export type PaperName = 'letter' | 'a4'

/** Millimetres, portrait. Adding a paper is one row. */
export const PAPER: Readonly<Record<PaperName, { readonly label: string; readonly width: number; readonly height: number }>> = {
  letter: { label: 'Letter', width: 215.9, height: 279.4 },
  a4: { label: 'A4', width: 210, height: 297 }
}

/** Nothing is drawn within this distance of the paper edge, in mm. */
export const PRINT_MARGIN = 10
/** How far neighbouring pages show the same strip of poster, in mm. */
export const PAGE_OVERLAP = 15

/** Shown in the dialog and printed in the key, from this one constant. */
export const PRINT_INSTRUCTION = 'Print at 100% or "Actual size". Turn off "Fit" and "Shrink". Print page 1 alone first and measure the square.'

export type PenName = 'cut' | 'seam' | 'fold' | 'grain' | 'notch' | 'guide' | 'trim' | 'square'

/** One list, read by both writers. Lengths in mm at true size. All black: lines differ by weight and dash, so black-and-white print loses nothing. */
export const PEN: Readonly<Record<PenName, { readonly width: number; readonly dash: readonly number[] }>> = {
  cut:    { width: 0.5,  dash: [] },
  seam:   { width: 0.25, dash: [3, 1.5] },
  fold:   { width: 0.5,  dash: [8, 2, 1.5, 2] },
  grain:  { width: 0.35, dash: [] },
  notch:  { width: 0.5,  dash: [] },
  square: { width: 0.35, dash: [] },
  guide:  { width: 0.2,  dash: [] },
  trim:   { width: 0.2,  dash: [2, 2] }
}

export type Mark =
  /** Exact curves where the source has them. `chain` is continuous in the sense `pathData` assumes. */
  | { readonly kind: 'stroke'; readonly pen: PenName; readonly chain: readonly Curve[]; readonly closed: boolean }
  /** `at` is the baseline start or middle. `size` is the em in mm. `angle` is degrees clockwise on screen (y down). `light` is only for the large page letters. */
  | { readonly kind: 'text'; readonly at: Vec2; readonly text: string; readonly size: number; readonly anchor: 'start' | 'middle'; readonly angle: number; readonly light: boolean }

/** One group of marks moved into place. There is deliberately no scale or rotation: geometry stays exactly as evaluated. */
export interface Block {
  /** A piece id, or 'key'. */
  readonly id: string
  /** Added to every coordinate in `marks`. */
  readonly offset: Vec2
  readonly marks: readonly Mark[]
}

export interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export interface Tile {
  /** Row letter then column number: A1, A2, B1. After Z comes AA. Positional, so skipping a blank page never renumbers. */
  readonly label: string
  readonly row: number
  readonly col: number
  /** What this page shows, in poster mm. Same width and height on every tile of the plan. */
  readonly window: Rect
}

export interface PosterSheet {
  readonly size: SizeName
  /** The whole grid, in mm. */
  readonly width: number
  readonly height: number
  readonly cols: number
  readonly rows: number
  /** In PDF and SVG: the key first, then pieces in author order. */
  readonly art: readonly [Block, ...Block[]]
  /** PDF only: page labels, trim lines, crosses and seam tags, in poster mm. Drawn under the art. */
  readonly guides: readonly Mark[]
  /** Printed pages, row by row. Blank grid cells are left out. The first is always A1, because the key is on it. */
  readonly tiles: readonly [Tile, ...Tile[]]
}

export interface PosterPlan {
  readonly title: string
  readonly paper: PaperName
  /** One per printable requested size, in pattern order. */
  readonly sheets: readonly [PosterSheet, ...PosterSheet[]]
  readonly refused: readonly SizePrintStatus[]
}

export type PieceDefect = 'duplicate-id' | 'no-outline' | 'no-cut-line' | 'no-grainline' | 'fold-lost' | 'notch-lost'

export interface PrintDefect { readonly pieceId: Id; readonly pieceName: string; readonly defect: PieceDefect }

/** `defects` is empty when the size can print. In author order, with at most one per declared piece. */
export interface SizePrintStatus { readonly size: SizeName; readonly defects: readonly PrintDefect[] }

export interface PosterRequest {
  /** Unknown names are ignored, and order doesn't matter: sheets follow pattern order. */
  readonly sizes: readonly SizeName[]
  readonly paper: PaperName
  /** Printed in the key and used for the file name. */
  readonly title: string
}

export type PosterOutcome =
  | { readonly kind: 'planned'; readonly plan: PosterPlan }
  /** No requested size can print, or nothing was requested, or the pattern has no pieces. */
  | { readonly kind: 'nothing-to-print'; readonly refused: readonly SizePrintStatus[] }

/** Every size, in pattern order, for the dialog. Total. */
export function printStatus(pattern: Pattern, graded: GradedPattern): readonly SizePrintStatus[] { throw new Error('not implemented') }

/** Pure and total. Never evaluates: it reads `graded`, which must come from `pattern`. */
export function planPoster(pattern: Pattern, graded: GradedPattern, request: PosterRequest): PosterOutcome { throw new Error('not implemented') }
```

`src/core/posterFile.ts`:

```ts
export type ExportFormat = 'pdf' | 'svg'

export interface PosterFile {
  /** A bare name with its extension: 'Raglan-M-letter.pdf', 'Raglan-M.svg'. Safe on Linux, macOS and Windows (decision 11). */
  readonly fileName: string
  readonly data: Uint8Array
}

/** Deterministic: the same plan gives the same bytes. Rejects only on a bug, never on pattern content. */
export function writePosterFile(plan: PosterPlan, format: ExportFormat): Promise<PosterFile> { throw new Error('not implemented') }
```

Internals:

```ts
// posterPack.ts
export interface Box { readonly id: string; readonly width: number; readonly height: number }
export interface Grid { readonly stepX: number; readonly stepY: number; readonly windowWidth: number; readonly windowHeight: number; readonly overlap: number }
export interface Packed { readonly cols: number; readonly rows: number; readonly at: ReadonlyMap<string, Vec2>; readonly printed: readonly { readonly row: number; readonly col: number }[] }
/** `first` is fixed at the poster's top-left. The rest fill around it. */
export function packBoxes(first: Box, boxes: readonly Box[], grid: Grid): Packed { throw new Error('not implemented') }

// posterArt.ts
/** A resolved piece the printability check has passed, so its optional fields are known to be there. */
export type PrintablePiece = ResolvedPiece & { readonly cutLine: CutLine; readonly grainline: ResolvedGrainline }
/** `crossesGrid` says whether a label box in draft coordinates would cross a page join, so placement can prefer one that doesn't. */
export function pieceMarks(piece: PrintablePiece, size: SizeName, crossesGrid: (box: Rect) => boolean): readonly Mark[] { throw new Error('not implemented') }
export function keyMarks(title: string, size: SizeName, units: DisplayUnits, cols: number, rows: number, printed: readonly { row: number; col: number }[]): readonly Mark[] { throw new Error('not implemented') }
export function tileGuides(size: SizeName, tiles: readonly Tile[], grid: Grid, sheet: { readonly width: number; readonly height: number }): readonly Mark[] { throw new Error('not implemented') }

// posterPdf.ts
export function writePosterPdf(plan: PosterPlan): Promise<Uint8Array> { throw new Error('not implemented') }

// posterSvg.ts
export function writePosterSvg(plan: PosterPlan): string { throw new Error('not implemented') }
```

The bridge:

```ts
// src/preload/api.ts. Structural, so a PosterFile passes straight through and the preload never imports core.
export interface SaveExportRequest { readonly fileName: string; readonly data: Uint8Array }
export type SaveExportResult =
  | { readonly kind: 'saved'; readonly path: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string }
export interface Api {
  getVersion: () => Promise<string>
  saveExport: (request: SaveExportRequest) => Promise<SaveExportResult>
}

// src/main/atomicWrite.ts
/** Writes beside the target, then renames over it, so a failed write leaves an existing file untouched. Removes its temporary file on failure. */
export async function writeAtomically(target: string, data: Uint8Array): Promise<void> { throw new Error('not implemented') }

// src/main/saveExport.ts. No Electron import: index.ts passes the real dialog, read off the module at call time so a journey's stub works.
export interface SaveExportPorts {
  readonly chooseFile: (options: { defaultPath: string; filters: { name: string; extensions: string[] }[] }) => Promise<{ canceled: boolean; filePath?: string }>
  readonly write: (path: string, data: Uint8Array) => Promise<void>
  readonly documentsDir: string
}
/** Validates the renderer's request, shows the dialog, writes. Never rejects: every outcome is a SaveExportResult. */
export async function runSaveExport(raw: unknown, ports: SaveExportPorts): Promise<SaveExportResult> { throw new Error('not implemented') }
```

## The decisions

### 1. True 1:1

Scale is prevented in layers. Each layer catches what the one before can't.

| Layer | Mechanism |
|---|---|
| The plan | `Block` has only an offset. No field can hold a scale. |
| The writer | `const PT_PER_MM = 72 / 25.4`, in one file, never rounded. It's used for one `cm` per page and for the page boxes. Rounding it to 2 decimals would be 3.3 mm wrong over 2 m (**ran**). |
| The form | Written in mm, the plan's own units. Only the page matrix converts. |
| The page box | Computed once per paper as `mm * PT_PER_MM` rounded to 4 decimals: 612 x 792 and 595.2756 x 841.8898 (**ran**). The unrounded Letter width is 612.0000000000001 (**ran**), which a printer's paper match shouldn't have to tolerate. `PageSizes.A4` is not used. That one rounded height is also the flip height in the matrix, so the top of the page is exact. |
| The file | No `/CropBox` and no `/UserUnit` in the page dictionary. `/ViewerPreferences /PrintScaling /None`. (pdf-lib's `getCropBox()` falls back to the MediaBox, so tests look at the raw dictionary.) |
| The viewer | Can't be controlled, so the test square and the message handle it. |

The whole content of one A4 page (**ran**, read back and inflated):

```
q
2.834645669291339 0 0 -2.834645669291339 0 841.8898 cm
10 10 190 277 re
W
n
1 0 0 1 10 10 cm
/Poster-7098480789 Do
Q
```

Independent check (**ran**): a real raglan M PDF on A4 with the rounded box, rendered by macOS PDFKit at 600 dpi, has a test square of 49.996 mm centre to centre on both
axes, where one pixel is 0.042 mm. The raw `MediaBox` reads `[ 0 0 595.2756 841.8898 ]`, there is no raw `/CropBox`, and `PrintScaling` reads `None`.

**How it's tested.** Each of these fails if the scale drifts.

- **Through the file, in vitest:** parse the output with pdf-lib, inflate the page stream and the form, compose every `cm`, and measure the test square's corners. It's 50 (or 50.8) mm to 1e-9 on both axes, and y comes out top-down, so a mirrored piece fails.
- The matrix's first number is exactly `72 / 25.4`, with `toBe`.
- The page box equals paper mm x `PT_PER_MM` within 0.0001 pt, for both papers, and the flip height equals the box height.
- Adjacent pages' translations differ by exactly the grid step.
- No `/CropBox`, no `/UserUnit`, `PrintScaling` is `None`, on the raw dictionary.
- Translation only: for every piece of every size, the plan's cut ring plus offset equals `resolved`'s ring plus offset, point by point.
- Journey, optional second opinion: on macOS, `measure-pdf.swift` renders page 1 at 600 dpi with PDFKit and asserts 50 mm ± 0.1 centre to centre on both axes. On Linux and Windows the step reports "skipped, macOS only" and the journey still passes, because the vitest case above is the proof and runs everywhere. If journeys start running off macOS, replace it with a pdf.js render inside the Electron window.
- By hand: print A1 and measure with a ruler. This is the last acceptance step and nothing replaces it.

**What the user is told,** in two places they can't miss. The dialog shows `PRINT_INSTRUCTION`. The key on A1 repeats it, next to "This square must measure 5 cm". `/PrintScaling` is
honoured by Acrobat and ignored by many others (**unverified**), which is why the message and the square exist.

### 2. Paper, margins, overlap, layout

| | Letter | A4 |
|---|---|---|
| Paper, mm | 215.9 x 279.4 | 210 x 297 |
| Window (paper less 10 mm a side) | 195.9 x 259.4 | 190 x 277 |
| Step (window less 15 mm overlap) | 180.9 x 244.4 | 175 x 262 |

The 10 mm margin clears the 3 to 6.35 mm non-printable edge of consumer printers (**unverified**). The trim line is a further 7.5 mm in, so a printer can lose up to 17.5 mm at the edge before losing
the line that matters. Pages are always portrait: landscape was no consistent win (**ran**, Letter M 28 pages against 24, S 20 against 21) and one orientation means one print setting.

**Packing.** Each piece's cut-line box, plus a 10 mm gap, is packed as drafted, without rotating, so grain stays as drawn. The key is a fixed box at the top-left. MaxRects is used because a skyline can't fill the space under the key.

```
for cols from the fewest that fit the widest box, for 12 column counts:
  for each order (tallest first, largest area first, widest first):
    bin width = cols * stepX + overlap
    place each box at the lowest then leftmost free rectangle
    rows = max(1, ceil((lowest edge - overlap) / stepY))
    printed = grid cells whose window meets any placed box
    keep the best by (printed, |cols - rows|, cols), first seen on ties
```

Pages for a full size, including the key (**ran** on a spike, cols x rows = printed pages):

| | S | M | L | XL | XXL |
|---|---|---|---|---|---|
| Letter | 3x6 = 18 | 7x3 = 21 | 5x6 = 24 | 4x6 = 24 | 4x6 = 24 |
| A4 | 3x8 = 19 | 7x3 = 21 | 4x6 = 24 | 6x6 = 24 | 6x6 = 28 |

With no key at all, Letter is 18, 21, 23, 24, 24 (**ran**), so keeping the key on A1 costs at most one Letter page and up to three A4 pages. These counts get pinned from the first green implementation, not copied from the spike.

A piece larger than a page needs no code: it's one box on a poster and any number of windows see it. A window that meets a box prints even when no line crosses it, because that sheet keeps its neighbours alignable. Only cells that meet no box are skipped.

**Fold pieces** print as the drafted half, with a fold marking. No code mirrors anything, and the sewist places the edge on the fold.

**Default paper:** Letter where the system's region uses it (US, Canada, Mexico and a few others), else A4, via a small pure `defaultPaper(locale)`. If the locale has no region (common on Linux, where `LANG` can be `C` or `C.UTF-8`), the default is A4. The paper choice sits next to the page count in the dialog, not behind a menu. It's chosen in the dialog for the session. The file name carries the paper, because printing an A4 file on Letter is what triggers scaling or clipping.

### 3. Which sizes, and what has a problem means

The dialog has one checkbox per size, with the shown size ticked. Each ticked size gets its own sheet, its own grid and its own A1 with its own test square. A file holds every ticked size. Sizes are not nested on one sheet in this milestone, because a nest needs a way to tell seven overlapping lines apart in black and white.

**What has a problem means.** A size has a problem exactly when one of its declared pieces would print differently from what the pattern says. Reading `pattern.pieces` in order and `bySize[i].resolved.pieces[id]` for that size, the first matching row is that piece's defect:

| Check | Defect |
|---|---|
| Id already seen in `pattern.pieces` | `duplicate-id` (the later piece wouldn't print) |
| Not in `resolved.pieces` | `no-outline` |
| No `cutLine` | `no-cut-line` |
| No `grainline` (required by the schema, so this is always a failure) | `no-grainline` |
| Model piece has `fold`, but no resolved `fold` | `fold-lost` (the edge would print with a seam allowance) |
| `cutLine.notches.length < model piece's notches.length` | `notch-lost` |

A size with any defect is refused whole, because a garment with a missing or wrong piece isn't a garment, and paper and fabric are what a mistake costs. The other requested sizes still export. The fix is one formula, and the dialog names it.

This reads the output, not `issues`, so everything else is irrelevant by construction:

| Doesn't block | Why |
|---|---|
| A broken variable or point no piece uses | Nothing printed changes. |
| A failed stack point (`no-stack-point`) | Nest-only. Reading `bySize` keeps this piece, which walking `atSizes` would lose. |
| `unknown-seam-allowance-edge`, `fold-edge-has-allowance` | The result is still built exactly as resolved. The issue stays in the panel. |

`raglanFailingInXXL`, all sizes requested: sheets S, M, L and XL. XXL is refused with `Front: no-cut-line` and `Neckband: no-outline`. Requested alone, XXL gives `nothing-to-print` and the Export button is disabled. The dialog says "XXL can't be printed: Front has no cut line, Neckband has no outline."

### 4. What is drawn

All in `posterArt.ts`, from `PrintablePiece`, in draft coordinates.

| Thing | Source | Pen or text |
|---|---|---|
| Cut line | `cutLine.spans` | `cut`, solid 0.5 mm |
| Fold edge | Spans with `kind: 'edge'` and `segmentId === fold.segmentId` | `fold`, long dash and dot, 0.5 mm. Uses the span, which runs to the corner miters (longer than `fold.from` to `fold.to`), so the whole boundary on the fabric fold is marked. |
| Seam line | `outline[].curve`, exact | `seam`, dashed 0.25 mm. A fold piece drops the fold edge, so two dash patterns never sit on one line. |
| Notches | `cutLine.notches[].mark` | `notch`, 6 mm as built |
| Grainline | `grainline.from` to `to` | `grain`, arrowheads at both ends |
| Fold marking | `fold`, inward normal | A bracket 12 mm inside the edge, between 15% and 85% of its length, arrowheads pointing at the fold, "CUT ON FOLD" along it |
| Piece label | `name`, the size, `cutCount`, `fold` | Name at 9 mm, then `Size M`, then `Cut 2` or `Cut 1 on fold` at 5 mm |

**Cut strokes with a fold.** Rotate the spans to begin just after the last fold span, then emit one open `cut` stroke per run of non-fold spans and one `fold` stroke per fold span. It handles any number of fold spans, because "at least one" is the only guarantee. A piece with no fold is one closed `cut` stroke.

**Label position.** Sample a 32 x 32 grid over the ring's box and keep points inside the ring. Prefer points whose label box doesn't cross a page join (`crossesGrid`), then take the one farthest from the ring and the grainline. Deterministic, with no per-piece hints. On raglan M the clearance is 143, 143, 147 and 35 mm (**ran**).

**Black and white.** Every line is black. Pens differ by weight and dash, and the only non-black ink is the big page letter, where a halftone can't break it. Thin gray lines can vanish on a laser printer (**unverified**), so guides stay black hairlines. Text is Helvetica. Names outside WinAnsi print as `?` character by character (**ran**: `font.encodeText` throws on `袖`), and the SVG keeps the real text.

### 5. Alignment, labels and the test square

Everything here is poster content, so it's correct on both sheets by construction.

- **The page letter.** "A1" at 14 mm, light, sits just inside each tile's private area, `(overlap + 2, overlap + 14)` from the tile's top-left and under the art, or `(2, 14)` on a side with no neighbour. The size is below it. Rows are letters, columns are numbers.
- **The trim line.** One dashed line per interior grid line, down the middle of the 15 mm overlap band and across the whole poster.
- **The crosses.** Two 10 mm crosses on the trim line per shared edge, at a quarter and three quarters of the edge.
- **The seam tag.** "A1 | A2" in black beside the trim line, on the side that stays after trimming. It runs along the seam.
- **Only printed pairs** get crosses and tags.

The user trims each page's left and top along the dashed line, then lays that cut edge on the neighbour's dashed line so the half crosses complete. The key says so.

**The test square** is in a 66 x 112 mm **key block** at the poster's top-left, placed before any piece, so nothing can collide with it. Its layout, top to bottom:

| y in the block, mm | Content |
|---|---|
| 0 to 18 | Left 30 mm reserved for A1's page letter, so the two can't collide. The title and size to its right. |
| 20 to 70 | The 50 mm square (50.8 when `pattern.units` is `in`), with "This square must measure 5 cm" (or 2 in) inside it. |
| 72 to 92 | `PRINT_INSTRUCTION` and the one-line taping rule. |
| 94 to 112 | The page map: `cols` x `rows` small cells, with skipped pages hatched. A missing page then reads as intended, not lost. |

The block lies inside A1's private area on both papers, so it never crosses a page edge and is never trimmed. A1 always has the key, so A1 is never blank and is always the first page of its sheet. Its size may grow slightly during the build, and page counts get pinned afterward.

### 6. Core, main and the bridge

| Where | What |
|---|---|
| `src/core` | Plan and both writers. pdf-lib has no Node or Electron imports (**ran**, grep of `cjs/`) and it's isolated like `clipper2-ts`. The `async` is only pdf-lib's API. The result is byte-identical across runs (**ran**, with `updateMetadata: false`). |
| Renderer | Calls core, then the bridge. pdf-lib ran under the app's exact CSP in a sandboxed page (**ran**, no `eval`, no `blob:`). |
| Preload | One `ipcRenderer.invoke`. |
| Main | Dialog and write, nothing about patterns. No new runtime dependency and no `@core` import, which sidesteps externalization of real dependencies in a main bundle that has never had any and that CI doesn't build. |

A `Uint8Array` crosses `contextBridge` and `invoke` as a `Uint8Array` under this app's sandbox settings (**ran**: 1 MB in 0.9 ms, 50 MB in 91 ms). The file is built before the dialog opens, so main needs no pending state between two calls.

```
runSaveExport(raw, ports):
  reject unless raw.data is a Uint8Array and raw.fileName is a string with an extension in FILTERS   → failed
  { canceled, filePath } = await ports.chooseFile({ defaultPath: join(documentsDir, basename(fileName)), filters })
  canceled or no filePath → cancelled
  add the extension if the user removed it
  try ports.write → saved(path)
  catch → failed(words for ENOSPC, EACCES, EPERM, EROFS, EBUSY, else err.message)
           EPERM and EBUSY say "The file may be open in another program. Close it and try again."
```

- `FILTERS` is the only list main keeps, keyed by extension. The renderer never names a directory: main takes the text after the last `/` or `\`, on every OS, because Node's POSIX `basename` doesn't treat `\` as a separator.
- **Cancelling** leaves the export dialog open, shows nothing, and wastes about 40 ms on the raglan.
- **A failed write** shows the message and the dialog stays open to retry. An existing file is untouched because of the rename, and the temporary file is removed.
- **A failed build** is a bug, and the dialog shows it rather than losing it.
- The channel is namespaced (`export:save`), so M8's file channels won't collide.
- Convex upload later (`PLAN.md:42`) reuses `writePosterFile`, since the bytes exist without main.

### 7. The SVG

One layout. `posterSvg.ts` reads the same plan, drawing `sheet.art` and ignoring `guides` and `tiles`, since a plotter or a designer has no pages. Pens come from `PEN`.

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="1281.3mm" height="748.2mm" viewBox="0 0 1281.3 748.2">
  <g data-size="M">
    <g data-piece="front" transform="translate(190.2 25.5)"> <path .../> <text .../> </g>
  </g>
</svg>
```

One user unit is one mm, and the physical size is the `mm` suffix on `width` and `height`. A unitless width would be read as pixels, which is where software disagrees. In Chromium a 50-unit rect measures 49.9998 mm (**ran**). Inkscape and Illustrator honour `mm` per the spec (**unverified**). The key's test square travels with the file, so anyone can check it. Several sizes go in one file, stacked with a 50 mm gap, one `<g data-size>` each. Text and attributes are XML-escaped, because names are free text. Text uses `font-family="Helvetica, Arial, sans-serif"`, since Helvetica is usually missing on Windows and Linux.

### 8. Staying fast

Numbers **ran** on warm V8 under Node. The renderer runs the same engine.

| | Time |
|---|---|
| Packing search, all 5 raglan sizes | 0.44 ms median, 1.5 ms max |
| Packing search, 8x raglan, 5 sizes | 7.6 ms |
| PDF write, all 5 sizes, 129 pages | 40 ms median, 47 ms max, 58 KiB |
| PDF write, one size | 11 to 30 ms, 11 KiB |
| PDF write, 8x raglan, 5 sizes, 827 pages | 295 ms, 267 KiB |

**Export stays on the renderer's main thread.** It's a one-off action. The worst case measured is 295 ms, and `doc.save()` yields between batches of objects. A worker would need CSP and packaging proof that doesn't exist, to save a third of a second on a pattern 8x the raglan. The button shows "Exporting…" and is disabled while it runs. `planPoster` is cheap enough for `useMemo` on every tick. One form per sheet keeps content independent of page count. The dialog reads App's `graded`, so nothing is evaluated again.

### 9. Acceptance

| Fixture | Proves |
|---|---|
| `raglanTee` | The clean case. |
| `raglanFailingInXXL` | The refusal case in Usage. |
| `raglanPrintHazards` (added) | Units in inches and a 50.8 mm square, a name unsafe in PDF and XML, `no-grainline` only in S, `notch-lost` only in L, and M, XL, XXL printing. |

Other defect rows use small edits inside their tests.

| Unit tests | Prove |
|---|---|
| `core/poster.test.ts` | `printStatus` and `planPoster` on all three fixtures as in Usage. Each defect row. Each non-blocking row, including a failed stack point still printing. Translation only for every piece and size. No two boxes overlap. Every box lies inside the grid. Every tile is the same size. A1 is first. Blank cells are skipped. `AA` after `Z`. Seam marks appear only between printed pairs. Unknown and duplicate requested sizes. A pattern with no pieces. |
| `core/posterArt.test.ts` | Fold strokes cover exactly the fold spans; cut plus fold strokes are the whole ring; several fold spans; the seam omits the fold edge; every `cutLine.notches` mark is drawn; the test square is exactly 50 or 50.8; the label point is inside the ring and off page joins for every raglan piece and size; the key map hatches exactly the skipped cells; only page letters are light; `cut`, `seam` and `fold` have different dash patterns. |
| `core/posterPack.test.ts` | Exact placements for small cases, determinism, the widest box forces enough columns. |
| `core/posterPdf.test.ts` | Everything under decision 1. One form per sheet. Page stream length constant across plans. Byte-identical twice. A 200,000-vertex ring doesn't overflow. `袖` becomes `?` without throwing. |
| `core/posterSvg.test.ts` | `width` is the viewBox width plus `mm`; escaping of `<`, `&` and quotes; several sizes; no guide appears. |
| `core/posterFile.test.ts` | Exhaustive format switch; names with slashes, backslashes, `<>:"|?*`, control characters, trailing dots and spaces; a title of `CON` or `nul`; an empty title. |
| `main/saveExport.test.ts` | With fake ports: invalid requests fail before any dialog; cancel writes nothing; a path traversal in `fileName` with `/` or `\` can't name a directory; each error code's words, including the open-file words for EPERM and EBUSY; a thrown write maps to `failed`. |
| `main/atomicWrite.test.ts` | Replaces a file; a missing directory rejects and leaves no temporary file; a failed rename leaves the original bytes. |

New rules in `core/boundaries.test.ts`:

```ts
it('imports pdf-lib only from posterPdf', ...)                           // ['core/posterPdf.test.ts', 'core/posterPdf.ts']
it('imports nothing from Electron, Node or the UI in core', ...)         // non-test core files: no electron, node:*, react, react-dom
it('keeps the poster internals inside core', ...)                        // @core/poster(Pdf|Svg|Pack|Art)
it.each(['writePosterPdf', 'writePosterSvg', 'packBoxes', 'pieceMarks'])('keeps %s out of the public API', ...)
it('exports printStatus, planPoster and writePosterFile', ...)
```

Journey `export.mjs` with `features/export.md`. The native dialog is stubbed with `app.evaluate`, and files are read back from disk.

| Sub-feature | Proof |
|---|---|
| `export-pdf` | A saved PDF opens with pdf-lib, has the planned page count, and page 1 measures 50 mm ± 0.1 at 600 dpi. |
| `export-svg` | The file parses, with `width` ending in `mm`. |
| `export-sizes` | Ticks change the page count. Apply the two failing formulas through the UI: XXL can't be ticked and the row names both pieces. |
| `export-cancel` | The stub returns `canceled`: no file, dialog open, no error. |
| `export-failure` | The stub returns a path in a missing directory: message shown, dialog open. |
| `export-console` | No renderer errors. CSP clean. |

Last step, by the user: print raglan M on Letter at 100%, measure the square, tape, and check that Front's cut line is 735 mm long. That number is the acceptance test.

### 10. Product decisions

`docs/open-questions.md` holds these with their defaults. The three existing ones are kept open with sharper defaults: a problem refuses that whole size (with the table above), notches stay 6 mm, and `cutCount` prints `Cut 2` or `Cut 1 on fold` and says nothing about mirroring.

### 11. Linux, macOS and Windows

Nothing shipped depends on one OS. pdf-lib is plain JavaScript in core and the renderer. Main uses Electron's `dialog.showSaveDialog`, `app.getPath('documents')` and Node's `fs`, which all three support. The SVG is text. The scale proof is a vitest case with no renderer. PDFKit appears only in the optional macOS journey step (decision 1).

What differs by OS, and how it's handled:

| Concern | Handling |
|---|---|
| Replacing a PDF a viewer has open | Windows usually refuses the rename (EPERM or EBUSY, **unverified** on this repo). The old file stays, and the message says to close it and retry. |
| File names | `posterFile` replaces `< > : " / \ \| ? *` and control characters with `-`, trims trailing dots and spaces, prefixes `_` to the Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`, any case, with or without extension), and falls back to `Pattern` if nothing is left. The same name is then safe everywhere. |
| Path separators from the renderer | Main strips everything up to the last `/` or `\` on every OS. |
| Default paper | A locale with no region gives A4. |
| SVG fonts | Helvetica, then Arial, then sans-serif. |
| Line endings | None matter: both files are written as bytes. |

Not M7: installers for the three OSes (the repo has no packaging setup yet), and CI on a matrix of the three (it runs only on Ubuntu today). Both are in open questions.

## Synthesis decision

Two candidates, on the configured panel. Candidate 1 (Opus) was a pure poster plan with a renderer-side build and a dumb main. Candidate 2 (Sonnet) was a main-process service with a tile set per piece and a separate SVG path.

**Base: candidate 1,** by agreement between the cross-judge (Sonnet) and my own read. The plan can't express scale, one layout serves both formats, the save path carries no pattern logic, and its numbers are measured. Candidate 2's main-side build needs `@core`, ESM-only `clipper2-ts` and pdf-lib loading in a bundle that has never held a real dependency, and CI wouldn't catch a failure. It also costs more paper (A4 M 24 pages to 21). Its form matrix was specified without a y-flip, which would mirror every piece.

Grafts from candidate 2:

- The through-the-file scale test that composes every matrix and measures the square, with the tile-translation check.
- Injected ports for main, so cancel, validation and failure are vitest cases instead of journey-only.
- The hatched page map on the key, so a skipped page reads as intended.
- Black-only guides, replacing candidate 1's 0.55 gray lines.
- One `PRINT_INSTRUCTION` constant, `Cut 1 on fold`, and preferring labels that don't cross a page join.
- A print-hazards fixture, reshaped so each hazard is in a named size.

Defects fixed from candidate 1: the "CropBox equal to it" claim (a pdf-lib fallback, now asserted on the raw dictionary), the mismatch between the rounded flip height and the sample stream (now one value, **ran** again), and the undefined overlap of the A1 letter and the key (the key reserves its slot).

Rejected from the cross-judge: printing a size with a lost grainline, notch or fold plus a `CHECK:` line. A lost fold prints a wrong-width piece and a lost grainline or notch misleads on fabric, and the fix is one formula. It's recorded as an open question so the user can overturn it. Also rejected: a key sheet per piece, since the square only needs checking once per printer setting, and per-piece landscape, since mixed orientation in one file is a print-setting trap.

Both candidates converged on: one shared form instead of per-page drawing, `PT_PER_MM` in one file, `/PrintScaling /None` as advisory only, a 10 mm margin and 15 mm overlap, atomic writes, weight and dash rather than colour, fold pieces as halves, reading `resolved.pieces` rather than `issues`, and `?` for unencodable names.

Verification: the fixture tests pass, and the rounded-page spike was re-rendered through PDFKit (decision 1). Nothing has been printed on paper yet.

## Tradeoffs accepted

- We accept that the SVG's layout depends on the chosen paper, which an SVG has no use for, in exchange for one layout and one code path.
- We accept a poster packed by boxes, not outlines, in exchange for an algorithm that takes a millisecond and can't overlap two pieces.
- We accept up to 3 extra A4 pages to keep the key on A1, in exchange for "page 1 has the square" being true of every sheet.
- We accept that reprinting one piece means finding its pages on the sheet, in exchange for fewer pages and one grid.
- We accept refusing a whole size for a lost grainline or notch, in exchange for never printing something that doesn't match the pattern.
- We accept a viewer drawing the whole poster form per page, clipped, in exchange for a far smaller file and marks that can't disagree.
- We accept writing PDF operators by hand, in exchange for pdf-lib being a thin container that's easy to replace (1.17.1 is old) and overflow being impossible.
- We accept `Curve` objects for polygon rings in the plan, in exchange for typed writers and tests that read geometry without parsing a path.
- We accept a page with no visible lines printing when it lies inside a piece's box, in exchange for keeping sheets alignable.
- We accept up to 50 MB of bytes copied over IPC, at 91 ms (**ran**), in exchange for a stateless main.
- We accept `pdf-lib` adding 516 KiB to a 2.6 MB renderer bundle and living in core, in exchange for no round trip and vitest coverage.

## Alternatives considered

- **A tile set per piece.** Reprinting is easier, but every piece starts fresh pages and needs its own key and alignment. It wins only when reprinting single pieces is common.
- **Build the PDF in main.** Needs `@core`, clipper2-ts and pdf-lib in a process that has never loaded a real dependency. It hides nothing the renderer can't do, and it makes the bytes harder to reach for Convex.
- **Keep the PDF writer in the renderer, outside core.** Workable, and it keeps a binary-format library out of core. Lost because core's isolation rule already covers it and core tests, the journey and a future MCP server all reach it the same way.
- **Marks drawn per page.** Measured over 20x slower on large input, and the two sides of a join become two separately computed drawings.
- **A cover page for the test square.** Simple, but one page on every export against 0 to 1 on Letter, and an SVG would still need the key.
- **Generate SVG and convert it to PDF.** Needs a converter, and page clipping would still need a layout step.
- **A worker.** Saves up to a third of a second at 8x the raglan, on a path with no CSP or packaging proof.

## Open questions and risks

- Does the first real print measure 50 mm? The render proves the file, not the printer.
- How do real viewers handle `/PrintScaling` and a large clipped form? Nothing has printed from Preview, Acrobat or a browser yet.
- Is a 0.2 mm black dashed trim line easy to follow on the user's printer?
- Does anyone want an SVG laid out for a plotter's roll width? If so, a roll is one more `Grid`, not a new path.
- Will a very large pattern need a page-count warning? The dialog shows the count, and there's no cap.
- Should CI add `npm run build`? pdf-lib in the renderer bundle is only proved by the journey.
- Should CI run on Linux, macOS and Windows? Today it runs typecheck and tests on Ubuntu, so a Windows-only path bug would reach the user first.
- Packaging for the three OSes is unplanned. Nothing in M7 blocks it.

## Build order

Each step keeps tests and typecheck green.

1. `printStatus` with `/tdd`, on all three fixtures.
2. `posterPack`, then `planPoster` with key and tiles, using simple marks.
3. `posterArt`: strokes, fold, label, guides, key map.
4. `posterPdf`, with the through-the-file scale tests first, and the `pdf-lib` boundary rule.
5. `posterSvg`, `posterFile`.
6. `atomicWrite`, `runSaveExport`, preload, the handler in main.
7. `ExportDialog`, the App button.
8. Journey, feature file, docs, then print one. The PDFKit step is optional and skipped off macOS.

## Next implementation step

Write `src/core/poster.test.ts` cases for `printStatus` on `raglanFailingInXXL` and `raglanPrintHazards`, then implement it with `/tdd`.
