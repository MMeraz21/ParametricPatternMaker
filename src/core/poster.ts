import type { GradedPattern } from './graded'
import type { Curve, Vec2 } from './geometry'
import type { Id, Pattern, SizeName } from './model'
import type { ResolvedPiece } from './outline'
import { KEY_SIZE, keyMarks, pieceMarks, tileGuides, type PrintablePiece } from './posterArt'
import { packBoxes, type Box, type Grid } from './posterPack'

/**
 * What prints, and where. `planPoster` decides every position, page and mark once, as plain data in mm with y down;
 * the file writers in posterFile.ts only choose syntax. Design: docs/design/m7-export.md.
 */

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
/** Space kept around every packed box, in mm. */
const PACK_GAP = 10

export { PRINT_INSTRUCTION } from './posterArt'

export type PenName = 'cut' | 'seam' | 'fold' | 'grain' | 'notch' | 'guide' | 'trim' | 'square'

/** One list, read by both writers. Lengths in mm at true size. All black: lines differ by weight and dash, so black-and-white print loses nothing. */
export const PEN: Readonly<Record<PenName, { readonly width: number; readonly dash: readonly number[] }>> = {
  cut: { width: 0.5, dash: [] },
  seam: { width: 0.25, dash: [3, 1.5] },
  fold: { width: 0.5, dash: [8, 2, 1.5, 2] },
  grain: { width: 0.35, dash: [] },
  notch: { width: 0.5, dash: [] },
  square: { width: 0.35, dash: [] },
  guide: { width: 0.2, dash: [] },
  trim: { width: 0.2, dash: [2, 2] }
}

export type Mark =
  /** Exact curves where the source has them. `chain` is continuous: each curve starts where the last ended. */
  | { readonly kind: 'stroke'; readonly pen: PenName; readonly chain: readonly Curve[]; readonly closed: boolean }
  /** `at` is the baseline start or middle. `size` is the em in mm. `angle` is degrees clockwise on screen (y down). `light` is only for the large page letters. */
  | {
      readonly kind: 'text'
      readonly at: Vec2
      readonly text: string
      readonly size: number
      readonly anchor: 'start' | 'middle'
      readonly angle: number
      readonly light: boolean
    }

/** One group of marks moved into place. There is deliberately no scale or rotation: geometry stays exactly as evaluated. */
export interface Block {
  /** A piece id, or 'key'. */
  readonly id: string
  /** Added to every coordinate in `marks`. */
  readonly offset: Vec2
  readonly marks: readonly Mark[]
}

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

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

export interface PrintDefect {
  readonly pieceId: Id
  readonly pieceName: string
  readonly defect: PieceDefect
}

/** `defects` is empty when the size can print. In author order, with at most one per declared piece. */
export interface SizePrintStatus {
  readonly size: SizeName
  readonly defects: readonly PrintDefect[]
}

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

/** The one rule for "this piece would print differently from what the pattern says". Null means it prints. */
function defectOf(declared: Pattern['pieces'][number], piece: ResolvedPiece | undefined): PieceDefect | null {
  if (!piece) return 'no-outline'
  if (!piece.cutLine) return 'no-cut-line'
  if (!piece.grainline) return 'no-grainline'
  if (declared.fold !== undefined && !piece.fold) return 'fold-lost'
  if (piece.cutLine.notches.length < declared.notches.length) return 'notch-lost'
  return null
}

const asPrintable = (piece: ResolvedPiece | undefined): PrintablePiece | null =>
  piece?.cutLine && piece.grainline ? { ...piece, cutLine: piece.cutLine, grainline: piece.grainline } : null

const resolvedPiece = (pieces: Readonly<Record<Id, ResolvedPiece>>, id: Id): ResolvedPiece | undefined => (Object.hasOwn(pieces, id) ? pieces[id] : undefined)

/** Every size, in pattern order, for the dialog. Total. */
export function printStatus(pattern: Pattern, graded: GradedPattern): readonly SizePrintStatus[] {
  return graded.bySize.map(({ size, resolved }) => {
    const seen = new Set<Id>()
    const defects = pattern.pieces.flatMap((declared): PrintDefect[] => {
      const duplicate = seen.has(declared.id)
      seen.add(declared.id)
      const defect = duplicate ? 'duplicate-id' : defectOf(declared, resolvedPiece(resolved.pieces, declared.id))
      return defect ? [{ pieceId: declared.id, pieceName: declared.name, defect }] : []
    })
    return { size, defects }
  })
}

/** 'A', 'B', ... 'Z', 'AA', 'AB'. */
export function rowLetters(row: number): string {
  let letters = ''
  for (let n = row + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters
  return letters
}

export function gridFor(paper: PaperName): Grid {
  const { width, height } = PAPER[paper]
  const windowWidth = width - 2 * PRINT_MARGIN
  const windowHeight = height - 2 * PRINT_MARGIN
  return { windowWidth, windowHeight, stepX: windowWidth - PAGE_OVERLAP, stepY: windowHeight - PAGE_OVERLAP, overlap: PAGE_OVERLAP }
}

interface Bounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

function boundsOf(points: readonly Vec2[]): Bounds {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const { x, y } of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return { minX, minY, maxX, maxY }
}

/** True when a box in poster mm crosses an overlap band, where it would be split or trimmed. */
function crossesJoin(box: Rect, grid: Grid): boolean {
  const crosses = (from: number, to: number, step: number): boolean => {
    for (let k = Math.max(1, Math.floor(from / step)); k * step < to; k++) if (from < k * step + grid.overlap && to > k * step) return true
    return false
  }
  return crosses(box.x, box.x + box.width, grid.stepX) || crosses(box.y, box.y + box.height, grid.stepY)
}

function planSheet(pattern: Pattern, size: SizeName, pieces: readonly PrintablePiece[], title: string, grid: Grid): PosterSheet {
  const boxes = pieces.map((piece) => {
    const bounds = boundsOf([...piece.cutLine.ring, piece.grainline.from, piece.grainline.to])
    return { piece, bounds, box: { id: piece.id, width: bounds.maxX - bounds.minX + PACK_GAP, height: bounds.maxY - bounds.minY + PACK_GAP } satisfies Box }
  })
  const key: Box = { id: 'key', width: KEY_SIZE.width + PACK_GAP, height: KEY_SIZE.height + PACK_GAP }
  const packed = packBoxes(
    key,
    boxes.map(({ box }) => box),
    grid
  )
  const width = packed.cols * grid.stepX + grid.overlap
  const height = packed.rows * grid.stepY + grid.overlap
  const tiles = packed.printed.map(({ row, col }): Tile => ({
    label: `${rowLetters(row)}${col + 1}`,
    row,
    col,
    window: { x: col * grid.stepX, y: row * grid.stepY, width: grid.windowWidth, height: grid.windowHeight }
  }))
  const [first, ...rest] = tiles
  if (!first) throw new Error('A packed sheet always prints A1, which holds the key')
  const pieceBlocks = boxes.map(({ piece, bounds }): Block => {
    const at = packed.at.get(piece.id) ?? { x: 0, y: 0 }
    const offset = { x: at.x - bounds.minX + PACK_GAP / 2, y: at.y - bounds.minY + PACK_GAP / 2 }
    const crossesGrid = (box: Rect): boolean => crossesJoin({ ...box, x: box.x + offset.x, y: box.y + offset.y }, grid)
    return { id: piece.id, offset, marks: pieceMarks(piece, size, crossesGrid) }
  })
  const keyBlock: Block = { id: 'key', offset: { x: PACK_GAP / 2, y: PACK_GAP / 2 }, marks: keyMarks(title, size, pattern.units, packed.cols, packed.rows, packed.printed) }
  return {
    size,
    width,
    height,
    cols: packed.cols,
    rows: packed.rows,
    art: [keyBlock, ...pieceBlocks],
    guides: tileGuides(size, tiles, grid, { width, height }),
    tiles: [first, ...rest]
  }
}

/** Pure and total. Never evaluates: it reads `graded`, which must come from `pattern`. */
export function planPoster(pattern: Pattern, graded: GradedPattern, request: PosterRequest): PosterOutcome {
  const wanted = new Set(request.sizes)
  const statuses = printStatus(pattern, graded).filter(({ size }) => wanted.has(size))
  const refused = statuses.filter(({ defects }) => defects.length > 0)
  const grid = gridFor(request.paper)
  const sheets = statuses.flatMap(({ size, defects }): PosterSheet[] => {
    if (defects.length > 0) return []
    const resolved = graded.bySize.find((result) => result.size === size)?.resolved
    if (!resolved) return []
    const pieces = pattern.pieces.flatMap((declared) => asPrintable(resolvedPiece(resolved.pieces, declared.id)) ?? [])
    return pieces.length > 0 ? [planSheet(pattern, size, pieces, request.title, grid)] : []
  })
  const [first, ...rest] = sheets
  if (!first) return { kind: 'nothing-to-print', refused }
  return { kind: 'planned', plan: { title: request.title, paper: request.paper, sheets: [first, ...rest], refused } }
}
