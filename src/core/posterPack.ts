import type { Vec2 } from './geometry'

/**
 * Packs boxes onto a poster cut into a uniform page grid, choosing the column count that prints the fewest pages.
 * Internal to export. No model imports.
 */

export interface Box {
  readonly id: string
  readonly width: number
  readonly height: number
}

/** A page grid in mm. Page (row, col) shows the window starting at (col * stepX, row * stepY). */
export interface Grid {
  readonly stepX: number
  readonly stepY: number
  readonly windowWidth: number
  readonly windowHeight: number
  readonly overlap: number
}

export interface Packed {
  readonly cols: number
  readonly rows: number
  /** Top-left of every box, including `first`. */
  readonly at: ReadonlyMap<string, Vec2>
  /** Grid cells whose window meets a box, row by row. */
  readonly printed: readonly { readonly row: number; readonly col: number }[]
}

interface Placed extends Box {
  readonly x: number
  readonly y: number
}

interface Free {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const EPSILON = 1e-9
/** How many column counts are tried past the fewest that fit. */
const COLUMN_TRIES = 12
const UNBOUNDED = 1e9

const ORDERS: readonly ((a: Box, b: Box) => number)[] = [
  (a, b) => b.height - a.height || b.width - a.width,
  (a, b) => b.width * b.height - a.width * a.height,
  (a, b) => b.width - a.width || b.height - a.height
]

const meets = (a: Free, b: Free): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
const contains = (outer: Free, inner: Free): boolean =>
  outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height

/** Removes `used` from every free rectangle it meets, keeping only maximal rectangles. */
function carve(free: readonly Free[], used: Free): Free[] {
  const next: Free[] = []
  for (const f of free) {
    if (!meets(f, used)) {
      next.push(f)
      continue
    }
    if (used.x > f.x) next.push({ x: f.x, y: f.y, width: used.x - f.x, height: f.height })
    if (used.x + used.width < f.x + f.width) next.push({ x: used.x + used.width, y: f.y, width: f.x + f.width - used.x - used.width, height: f.height })
    if (used.y > f.y) next.push({ x: f.x, y: f.y, width: f.width, height: used.y - f.y })
    if (used.y + used.height < f.y + f.height) next.push({ x: f.x, y: used.y + used.height, width: f.width, height: f.y + f.height - used.y - used.height })
  }
  // Drop rectangles inside another. Of two equal ones, the first is kept.
  return next.filter((a, i) => !next.some((b, j) => j !== i && contains(b, a) && (j < i || !contains(a, b))))
}

/** MaxRects, lowest then leftmost. Null when a box is wider than the bin. */
function maxRects(binWidth: number, first: Box, boxes: readonly Box[]): Placed[] | null {
  let free: Free[] = carve([{ x: 0, y: 0, width: binWidth, height: UNBOUNDED }], { x: 0, y: 0, width: first.width, height: first.height })
  const placed: Placed[] = [{ ...first, x: 0, y: 0 }]
  for (const box of boxes) {
    let best: Vec2 | null = null
    for (const f of free) {
      if (box.width > f.width + EPSILON || box.height > f.height + EPSILON) continue
      if (!best || f.y < best.y - EPSILON || (Math.abs(f.y - best.y) <= EPSILON && f.x < best.x)) best = { x: f.x, y: f.y }
    }
    if (!best) return null
    placed.push({ ...box, ...best })
    free = carve(free, { ...best, width: box.width, height: box.height })
  }
  return placed
}

function cellsMet(placed: readonly Placed[], cols: number, rows: number, grid: Grid): { row: number; col: number }[] {
  const cells: { row: number; col: number }[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const window = { x: col * grid.stepX, y: row * grid.stepY, width: grid.windowWidth, height: grid.windowHeight }
      if (placed.some((box) => box.width > 0 && box.height > 0 && meets(window, box))) cells.push({ row, col })
    }
  }
  return cells
}

/** `first` is fixed at the poster's top-left. The rest fill around it. Deterministic. */
export function packBoxes(first: Box, boxes: readonly Box[], grid: Grid): Packed {
  const widest = Math.max(first.width, ...boxes.map((box) => box.width))
  const fewestCols = Math.max(1, Math.ceil((widest - grid.overlap) / grid.stepX - EPSILON))
  let best: { packed: Packed; score: readonly number[] } | null = null
  for (let cols = fewestCols; cols < fewestCols + COLUMN_TRIES; cols++) {
    for (const order of ORDERS) {
      const placed = maxRects(cols * grid.stepX + grid.overlap, first, [...boxes].sort(order))
      if (!placed) continue
      const bottom = Math.max(...placed.map((box) => box.y + box.height))
      const rows = Math.max(1, Math.ceil((bottom - grid.overlap) / grid.stepY - EPSILON))
      const printed = cellsMet(placed, cols, rows, grid)
      const score = [printed.length, Math.abs(cols - rows), cols]
      if (best && !isBetter(score, best.score)) continue
      best = { packed: { cols, rows, at: new Map(placed.map((box) => [box.id, { x: box.x, y: box.y }])), printed }, score }
    }
  }
  if (!best) throw new Error('A bin as wide as the widest box always fits every box')
  return best.packed
}

function isBetter(score: readonly number[], than: readonly number[]): boolean {
  for (const [i, value] of score.entries()) {
    const other = than[i] ?? 0
    if (value !== other) return value < other
  }
  return false
}
