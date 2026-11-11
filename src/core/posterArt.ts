import type { CutLine, CutSpan } from './cutLine'
import { add, distance, scale, sub, type Curve, type Vec2 } from './geometry'
import type { DisplayUnits, SizeName } from './model'
import type { ResolvedGrainline, ResolvedPiece } from './outline'
import type { Mark, PenName, Rect, Tile } from './poster'
import type { Grid } from './posterPack'

/**
 * Everything that is drawn, and in which pen: pieces, the key and the page guides, as Marks in mm with y down.
 * Internal to export.
 */

/** Shown in the dialog and printed in the key, from this one constant. */
export const PRINT_INSTRUCTION = 'Print at 100% or "Actual size". Turn off "Fit" and "Shrink". Print page 1 alone first and measure the square.'
const TAPING_RULE = 'Trim each page along its top and left dashed lines. Lay the cut edge on the next page\'s dashed line so the crosses meet, then tape.'

/** A resolved piece the printability check has passed, so its optional fields are known to be there. */
export type PrintablePiece = ResolvedPiece & { readonly cutLine: CutLine; readonly grainline: ResolvedGrainline }

/** Helvetica advance widths in 1/1000 em for ASCII 32 to 126, from its AFM. Anything else counts as 556. */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584
]

/** Width of `text` in mm at an em of `size` mm, in Helvetica. Close enough for layout; the PDF writer measures its own text again. */
export function textWidth(text: string, size: number): number {
  let units = 0
  for (const char of text) units += HELVETICA_WIDTHS[(char.codePointAt(0) ?? 0) - 32] ?? 556
  return (units / 1000) * size
}

const text = (at: Vec2, value: string, size: number, options: { anchor?: 'start' | 'middle'; angle?: number; light?: boolean } = {}): Mark => ({
  kind: 'text',
  at,
  text: value,
  size,
  anchor: options.anchor ?? 'start',
  angle: options.angle ?? 0,
  light: options.light ?? false
})

/** Straight lines through `points`. */
function polyline(points: readonly Vec2[]): Curve[] {
  return points.slice(1).map((to, i): Curve => ({ kind: 'line', from: points[i] ?? to, to }))
}

const stroke = (pen: PenName, points: readonly Vec2[], closed = false): Mark => ({ kind: 'stroke', pen, chain: polyline(points), closed })

function wrap(value: string, size: number, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of value.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (line && textWidth(next, size) > width) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

function truncate(value: string, size: number, width: number): string {
  if (textWidth(value, size) <= width) return value
  let kept = [...value]
  while (kept.length > 0 && textWidth(`${kept.join('')}…`, size) > width) kept = kept.slice(0, -1)
  return `${kept.join('')}…`
}

// ---------------------------------------------------------------- pieces

function pointInRing(point: Vec2, ring: readonly Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (!a || !b) continue
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function distanceToSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy)
}

/** Points of consecutive spans as one chain, without repeating the shared point. */
function joinSpans(spans: readonly CutSpan[]): Vec2[] {
  const points: Vec2[] = []
  for (const span of spans) {
    for (const point of span.points) {
      const last = points.at(-1)
      if (!last || last.x !== point.x || last.y !== point.y) points.push(point)
    }
  }
  return points
}

/** The cut line, with every span along the fold edge drawn in the fold pen instead. */
function cutStrokes(piece: PrintablePiece): Mark[] {
  const { ring, spans } = piece.cutLine
  const foldId = piece.fold?.segmentId
  const isFold = (span: CutSpan | undefined): boolean => span?.kind === 'edge' && span.segmentId === foldId
  const start = spans.findIndex((span, i) => !isFold(span) && isFold(spans[(i - 1 + spans.length) % spans.length]))
  if (foldId === undefined || start < 0) return [stroke('cut', ring, true)]
  const marks: Mark[] = []
  let run: CutSpan[] = []
  const flush = (): void => {
    if (run.length > 0) marks.push(stroke('cut', joinSpans(run)))
    run = []
  }
  for (const span of [...spans.slice(start), ...spans.slice(0, start)]) {
    if (isFold(span)) {
      flush()
      marks.push(stroke('fold', span.points))
    } else run.push(span)
  }
  flush()
  return marks
}

/** The seam line, exact. A fold piece leaves out its fold edge, where the cut line already is. */
function seamStroke(piece: PrintablePiece): Mark {
  const foldAt = piece.fold ? piece.outline.findIndex((edge) => edge.segmentId === piece.fold?.segmentId) : -1
  if (foldAt < 0) return { kind: 'stroke', pen: 'seam', chain: piece.outline.map((edge) => edge.curve), closed: true }
  const edges = [...piece.outline.slice(foldAt + 1), ...piece.outline.slice(0, foldAt)]
  return { kind: 'stroke', pen: 'seam', chain: edges.map((edge) => edge.curve), closed: false }
}

const ARROW_LENGTH = 4
const ARROW_SPREAD = 0.45

/** Two short lines meeting at `tip`, opening back along `back` (a unit vector). */
function arrowhead(tip: Vec2, back: Vec2, pen: PenName): Mark {
  const side = (sign: number): Vec2 => {
    const [c, s] = [Math.cos(sign * ARROW_SPREAD), Math.sin(sign * ARROW_SPREAD)]
    return add(tip, scale({ x: back.x * c - back.y * s, y: back.x * s + back.y * c }, ARROW_LENGTH))
  }
  return stroke(pen, [side(1), tip, side(-1)])
}

function grainlineMarks({ from, to }: ResolvedGrainline): Mark[] {
  const length = distance(from, to)
  const unit = scale(sub(to, from), 1 / length)
  return [stroke('grain', [from, to]), arrowhead(from, unit, 'grain'), arrowhead(to, scale(unit, -1), 'grain')]
}

/** Text angle along `direction`, turned so it never reads upside down. */
function readableAngle(direction: Vec2): number {
  const degrees = (Math.atan2(direction.y, direction.x) * 180) / Math.PI
  return degrees > 90 ? degrees - 180 : degrees <= -90 ? degrees + 180 : degrees
}

const FOLD_BRACKET_INSET = 12

function foldMarks(piece: PrintablePiece): Mark[] {
  if (!piece.fold) return []
  const { from, to } = piece.fold
  const length = distance(from, to)
  if (length === 0) return []
  const unit = scale(sub(to, from), 1 / length)
  const left = { x: unit.y, y: -unit.x }
  const middle = add(from, scale(unit, length / 2))
  const inward = pointInRing(add(middle, scale(left, FOLD_BRACKET_INSET)), piece.cutLine.ring) ? left : scale(left, -1)
  const [a, b] = [add(from, scale(unit, length * 0.15)), add(from, scale(unit, length * 0.85))]
  const [aIn, bIn] = [add(a, scale(inward, FOLD_BRACKET_INSET)), add(b, scale(inward, FOLD_BRACKET_INSET))]
  return [
    stroke('grain', [a, aIn, bIn, b]),
    arrowhead(a, inward, 'grain'),
    arrowhead(b, inward, 'grain'),
    text(add(middle, scale(inward, FOLD_BRACKET_INSET + 5)), 'CUT ON FOLD', 4, { anchor: 'middle', angle: readableAngle(unit) })
  ]
}

const LABEL_SAMPLES = 32
const NAME_SIZE = 9
const DETAIL_SIZE = 5

export const cutText = (piece: Pick<ResolvedPiece, 'cutCount' | 'fold'>): string => `Cut ${piece.cutCount}${piece.fold ? ' on fold' : ''}`

/** The label's lines and its box around the anchor point, which is the middle of the name's baseline. */
function labelLines(piece: PrintablePiece, size: SizeName): { lines: { text: string; size: number; dy: number }[]; box: (at: Vec2) => Rect } {
  const lines = [
    { text: piece.name, size: NAME_SIZE, dy: 0 },
    { text: `Size ${size}`, size: DETAIL_SIZE, dy: 7 },
    { text: cutText(piece), size: DETAIL_SIZE, dy: 13 }
  ]
  const width = Math.max(...lines.map((line) => textWidth(line.text, line.size)))
  return { lines, box: (at) => ({ x: at.x - width / 2, y: at.y - NAME_SIZE * 0.75, width, height: NAME_SIZE * 0.75 + 14 }) }
}

/** Inside the ring, off page joins when it can be, and as far from every line as possible. Deterministic. */
function labelPoint(piece: PrintablePiece, box: (at: Vec2) => Rect, crossesGrid: (box: Rect) => boolean): Vec2 {
  const ring = piece.cutLine.ring
  const xs = ring.map((point) => point.x)
  const ys = ring.map((point) => point.y)
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const obstacles: [Vec2, Vec2][] = ring.map((point, i): [Vec2, Vec2] => [point, ring[(i + 1) % ring.length] ?? point])
  obstacles.push([piece.grainline.from, piece.grainline.to])
  const candidates: { at: Vec2; clearance: number; crosses: boolean }[] = []
  for (let i = 1; i < LABEL_SAMPLES; i++) {
    for (let j = 1; j < LABEL_SAMPLES; j++) {
      const at = { x: minX + ((maxX - minX) * i) / LABEL_SAMPLES, y: minY + ((maxY - minY) * j) / LABEL_SAMPLES }
      if (!pointInRing(at, ring)) continue
      const clearance = Math.min(...obstacles.map(([a, b]) => distanceToSegment(at, a, b)))
      candidates.push({ at, clearance, crosses: crossesGrid(box(at)) })
    }
  }
  const clear = candidates.filter((candidate) => !candidate.crosses)
  const pool = clear.length > 0 ? clear : candidates
  let best = pool[0]
  for (const candidate of pool) if (best && candidate.clearance > best.clearance) best = candidate
  return best?.at ?? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
}

/** Everything drawn for one piece, in draft coordinates. `crossesGrid` says whether a box in draft coordinates would cross a page join. */
export function pieceMarks(piece: PrintablePiece, size: SizeName, crossesGrid: (box: Rect) => boolean): readonly Mark[] {
  const label = labelLines(piece, size)
  const at = labelPoint(piece, label.box, crossesGrid)
  return [
    ...cutStrokes(piece),
    seamStroke(piece),
    ...piece.cutLine.notches.map((notch) => stroke('notch', notch.mark)),
    ...grainlineMarks(piece.grainline),
    ...foldMarks(piece),
    ...label.lines.map((line) => text({ x: at.x, y: at.y + line.dy }, line.text, line.size, { anchor: 'middle' }))
  ]
}

// ---------------------------------------------------------------- the key

const KEY_WIDTH = 66
/** Left of the title row, kept clear for A1's page letter. */
const LETTER_SLOT = 30
const SQUARE_TOP = 22
const SQUARE_ROOM = 50.8
const NOTE_SIZE = 2.8
const NOTE_LEADING = 3.6
const NOTES_TOP = SQUARE_TOP + SQUARE_ROOM + 6
const NOTES = [...wrap(PRINT_INSTRUCTION, NOTE_SIZE, KEY_WIDTH), ...wrap(TAPING_RULE, NOTE_SIZE, KEY_WIDTH)]
const MAP_TOP = NOTES_TOP + NOTES.length * NOTE_LEADING + 3
const MAP_HEIGHT = 20
const MAP_CELL_MAX = 8

/** The key's footprint in mm, from its top-left. It never depends on the pattern. */
export const KEY_SIZE = { width: KEY_WIDTH, height: MAP_TOP + 4 + MAP_HEIGHT } as const

/** The test square's side in mm for the pattern's units. */
export const testSquareSide = (units: DisplayUnits): number => (units === 'in' ? 50.8 : 50)

/** Title, the test square, the printing and taping rules, and a map of the pages with skipped ones crossed out. */
export function keyMarks(
  title: string,
  size: SizeName,
  units: DisplayUnits,
  cols: number,
  rows: number,
  printed: readonly { readonly row: number; readonly col: number }[]
): readonly Mark[] {
  const side = testSquareSide(units)
  const [x0, y0, x1, y1] = [0, SQUARE_TOP, side, SQUARE_TOP + side]
  const marks: Mark[] = [
    text({ x: LETTER_SLOT + 2, y: 7 }, truncate(title, 4.5, KEY_WIDTH - LETTER_SLOT - 2), 4.5),
    text({ x: LETTER_SLOT + 2, y: 13 }, `Size ${size}`, 3.5),
    stroke(
      'square',
      [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 }
      ],
      true
    ),
    text({ x: side / 2, y: SQUARE_TOP + side / 2 - 1 }, 'This square must', 3.5, { anchor: 'middle' }),
    text({ x: side / 2, y: SQUARE_TOP + side / 2 + 4 }, `measure ${units === 'in' ? '2 in' : '5 cm'}`, 3.5, { anchor: 'middle' }),
    ...NOTES.map((line, i) => text({ x: 0, y: NOTES_TOP + i * NOTE_LEADING }, line, NOTE_SIZE)),
    text({ x: 0, y: MAP_TOP }, 'Pages. Crossed out: not printed.', NOTE_SIZE)
  ]
  const cell = Math.min(KEY_WIDTH / cols, MAP_HEIGHT / rows, MAP_CELL_MAX)
  const isPrinted = new Set(printed.map(({ row, col }) => `${row},${col}`))
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const [left, top, right, bottom] = [col * cell, MAP_TOP + 4 + row * cell, (col + 1) * cell, MAP_TOP + 4 + (row + 1) * cell]
      const [a, b, c, d] = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]
      marks.push(stroke('guide', [a, b, c, d], true))
      if (!isPrinted.has(`${row},${col}`)) marks.push(stroke('guide', [a, c]), stroke('guide', [b, d]))
    }
  }
  return marks
}

// ---------------------------------------------------------------- page guides

const PAGE_LETTER_SIZE = 14
const CROSS_HALF = 5
const TAG_SIZE = 3

/** Page letters, trim lines, alignment crosses and seam tags, in poster mm. */
export function tileGuides(size: SizeName, tiles: readonly Tile[], grid: Grid, sheet: { readonly width: number; readonly height: number }): readonly Mark[] {
  const cols = Math.round((sheet.width - grid.overlap) / grid.stepX)
  const rows = Math.round((sheet.height - grid.overlap) / grid.stepY)
  const letters = tiles.flatMap((tile): Mark[] => {
    const left = tile.window.x + (tile.col > 0 ? grid.overlap : 0) + 2
    const top = tile.window.y + (tile.row > 0 ? grid.overlap : 0)
    return [text({ x: left, y: top + PAGE_LETTER_SIZE }, tile.label, PAGE_LETTER_SIZE, { light: true }), text({ x: left, y: top + 19 }, `Size ${size}`, 3.5)]
  })
  const trims: Mark[] = []
  for (let col = 1; col < cols; col++) {
    const x = col * grid.stepX + grid.overlap / 2
    trims.push(stroke('trim', [{ x, y: 0 }, { x, y: sheet.height }]))
  }
  for (let row = 1; row < rows; row++) {
    const y = row * grid.stepY + grid.overlap / 2
    trims.push(stroke('trim', [{ x: 0, y }, { x: sheet.width, y }]))
  }
  const byCell = new Map(tiles.map((tile) => [`${tile.row},${tile.col}`, tile]))
  const joins: Mark[] = []
  const cross = (at: Vec2): Mark[] => [
    stroke('guide', [{ x: at.x - CROSS_HALF, y: at.y }, { x: at.x + CROSS_HALF, y: at.y }]),
    stroke('guide', [{ x: at.x, y: at.y - CROSS_HALF }, { x: at.x, y: at.y + CROSS_HALF }])
  ]
  for (const tile of tiles) {
    const east = byCell.get(`${tile.row},${tile.col + 1}`)
    if (east) {
      const x = east.window.x + grid.overlap / 2
      const [from, to] = [tile.window.y + grid.overlap, tile.window.y + grid.windowHeight - grid.overlap]
      joins.push(...cross({ x, y: from + (to - from) / 4 }), ...cross({ x, y: from + ((to - from) * 3) / 4 }))
      joins.push(text({ x: x + 2, y: (from + to) / 2 }, `${tile.label} | ${east.label}`, TAG_SIZE, { anchor: 'middle', angle: 90 }))
    }
    const south = byCell.get(`${tile.row + 1},${tile.col}`)
    if (south) {
      const y = south.window.y + grid.overlap / 2
      const [from, to] = [tile.window.x + grid.overlap, tile.window.x + grid.windowWidth - grid.overlap]
      joins.push(...cross({ x: from + (to - from) / 4, y }), ...cross({ x: from + ((to - from) * 3) / 4, y }))
      joins.push(text({ x: (from + to) / 2, y: y + 2 + TAG_SIZE }, `${tile.label} | ${south.label}`, TAG_SIZE, { anchor: 'middle' }))
    }
  }
  return [...letters, ...trims, ...joins]
}
