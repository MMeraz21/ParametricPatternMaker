import { describe, expect, it } from 'vitest'
import { raglanTee } from './fixtures/raglan'
import { curvePoints, type Vec2 } from './geometry'
import { evaluateGraded } from './graded'
import { gridFor, PAPER, PEN, planPoster, type Mark, type PenName } from './poster'
import { KEY_SIZE, keyMarks, pieceMarks, testSquareSide, textWidth, type PrintablePiece } from './posterArt'

const graded = evaluateGraded(raglanTee)
const printable = (size: string, id: string): PrintablePiece => {
  const piece = graded.bySize.find((result) => result.size === size)?.resolved.pieces[id]
  if (!piece?.cutLine || !piece.grainline) throw new Error(`${id} does not print in ${size}`)
  return { ...piece, cutLine: piece.cutLine, grainline: piece.grainline }
}
const strokes = (marks: readonly Mark[], pen: PenName): Extract<Mark, { kind: 'stroke' }>[] =>
  marks.flatMap((mark) => (mark.kind === 'stroke' && mark.pen === pen ? [mark] : []))
const texts = (marks: readonly Mark[]): Extract<Mark, { kind: 'text' }>[] => marks.flatMap((mark) => (mark.kind === 'text' ? [mark] : []))
const vertices = (mark: Extract<Mark, { kind: 'stroke' }>): Vec2[] => [mark.chain[0]?.from ?? { x: NaN, y: NaN }, ...mark.chain.map((curve) => curve.to)]
const never = (): boolean => false

describe('pieceMarks', () => {
  it.each(['front', 'back'])('draws the %s fold span in the fold pen and the rest of the ring in the cut pen', (id) => {
    const piece = printable('M', id)
    const marks = pieceMarks(piece, 'M', never)
    const foldSpans = piece.cutLine.spans.filter((span) => span.kind === 'edge' && span.segmentId === piece.fold?.segmentId)
    expect(strokes(marks, 'fold').map(vertices)).toEqual(foldSpans.map((span) => span.points))
    const drawn = [...strokes(marks, 'cut'), ...strokes(marks, 'fold')].flatMap(vertices).map(({ x, y }) => `${x},${y}`)
    expect(new Set(drawn)).toEqual(new Set(piece.cutLine.ring.map(({ x, y }) => `${x},${y}`)))
  })

  it('draws a piece with no fold as one closed cut line', () => {
    const piece = printable('M', 'sleeve')
    const cut = strokes(pieceMarks(piece, 'M', never), 'cut')
    expect(cut).toHaveLength(1)
    expect(cut[0]?.closed).toBe(true)
    expect(cut[0] && vertices(cut[0])).toEqual(piece.cutLine.ring)
  })

  it('leaves the fold edge out of the seam line, and keeps every other edge exact', () => {
    const piece = printable('M', 'front')
    const [seam] = strokes(pieceMarks(piece, 'M', never), 'seam')
    expect(seam?.closed).toBe(false)
    const curveOf = (id: string): unknown => piece.outline.find((edge) => edge.segmentId === id)?.curve
    expect(seam?.chain).toEqual(['frontHem', 'frontSide', 'frontRaglan', 'frontNeck'].map(curveOf))
  })

  it('draws every notch mark', () => {
    const piece = printable('M', 'front')
    expect(strokes(pieceMarks(piece, 'M', never), 'notch').map(vertices)).toEqual(piece.cutLine.notches.map((notch) => [...notch.mark]))
  })

  it('labels with name, size and cut count', () => {
    expect(texts(pieceMarks(printable('L', 'front'), 'L', never)).slice(-3).map((mark) => mark.text)).toEqual(['Front', 'Size L', 'Cut 1 on fold'])
    expect(texts(pieceMarks(printable('L', 'sleeve'), 'L', never)).slice(-3).map((mark) => mark.text)).toEqual(['Sleeve', 'Size L', 'Cut 2'])
  })

  it('puts every raglan label inside its piece and off page joins in every size', () => {
    const outcome = planPoster(raglanTee, graded, { sizes: raglanTee.sizes, paper: 'letter', title: 'Raglan' })
    if (outcome.kind !== 'planned') throw new Error('nothing to print')
    const grid = gridFor('letter')
    const inBand = (value: number, step: number): boolean => value > step && ((value % step) + step) % step < grid.overlap
    for (const sheet of outcome.plan.sheets) {
      for (const block of sheet.art.slice(1)) {
        const [name] = texts(block.marks).slice(-3)
        if (!name) throw new Error('no label')
        const x = name.at.x + block.offset.x
        const y = name.at.y + block.offset.y
        const half = textWidth(name.text, name.size) / 2
        expect([x - half, x, x + half].some((value) => inBand(value, grid.stepX))).toBe(false)
        expect(inBand(y, grid.stepY)).toBe(false)
      }
    }
  })

  it('marks the fold with a bracket pointing at it and the words CUT ON FOLD', () => {
    const marks = pieceMarks(printable('M', 'back'), 'M', never)
    const words = texts(marks).find((mark) => mark.text === 'CUT ON FOLD')
    expect(words?.angle).toBe(90)
    expect(words?.at.x).toBeGreaterThan(0)
  })
})

describe('keyMarks', () => {
  it.each([
    ['cm', 50],
    ['in', 50.8]
  ] as const)('draws a test square of exactly the right side in %s', (units, side) => {
    expect(testSquareSide(units)).toBe(side)
    const [square] = strokes(keyMarks('R', 'M', units, 2, 2, []), 'square')
    if (!square) throw new Error('no square')
    expect(square.chain.map((curve) => Math.hypot(curve.to.x - curve.from.x, curve.to.y - curve.from.y))).toEqual([side, side, side])
    expect(square.closed).toBe(true)
  })

  it('crosses out exactly the pages that do not print', () => {
    const marks = keyMarks('R', 'M', 'cm', 3, 2, [
      { row: 0, col: 0 },
      { row: 1, col: 2 }
    ])
    const crossings = strokes(marks, 'guide').filter((mark) => !mark.closed)
    expect(crossings).toHaveLength(4 * 2)
    expect(strokes(marks, 'guide').filter((mark) => mark.closed)).toHaveLength(6)
  })

  it('fits inside the private part of A1 on both papers', () => {
    for (const paper of ['letter', 'a4'] as const) {
      const grid = gridFor(paper)
      expect(KEY_SIZE.width + 10).toBeLessThan(grid.stepX)
      expect(KEY_SIZE.height + 10).toBeLessThan(grid.stepY)
      expect(PAPER[paper].width).toBeGreaterThan(0)
    }
  })

  it('keeps every key line within the key size', () => {
    const points = strokes(keyMarks('A very long title that will not fit in the key at all', 'XXL', 'in', 12, 9, []), 'guide').flatMap((mark) => mark.chain.flatMap(curvePoints))
    for (const { x, y } of points) {
      expect(x).toBeLessThanOrEqual(KEY_SIZE.width + 1e-9)
      expect(y).toBeLessThanOrEqual(KEY_SIZE.height + 1e-9)
    }
    const [title] = texts(keyMarks('A very long title that will not fit in the key at all', 'XXL', 'in', 1, 1, []))
    expect(title && title.at.x + textWidth(title.text, title.size)).toBeLessThanOrEqual(KEY_SIZE.width)
  })
})

describe('pens', () => {
  it('keeps cut, seam and fold apart by dash pattern alone', () => {
    expect(new Set([PEN.cut, PEN.seam, PEN.fold].map((pen) => pen.dash.join(','))).size).toBe(3)
  })

  it('makes only page letters light', () => {
    const outcome = planPoster(raglanTee, graded, { sizes: ['M'], paper: 'a4', title: 'Raglan' })
    if (outcome.kind !== 'planned') throw new Error('nothing to print')
    const [sheet] = outcome.plan.sheets
    const light = [...sheet.guides, ...sheet.art.flatMap((block) => block.marks)].flatMap((mark) => (mark.kind === 'text' && mark.light ? [mark.text] : []))
    expect(light).toEqual(sheet.tiles.map((tile) => tile.label))
  })
})
