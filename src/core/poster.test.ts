import { describe, expect, it } from 'vitest'
import { raglanFailingInXXL, raglanPrintHazards, raglanTee } from './fixtures/raglan'
import { curvePoints, type Vec2 } from './geometry'
import { evaluateGraded } from './graded'
import type { Pattern } from './model'
import { gridFor, PAPER, planPoster, printStatus, rowLetters, type Block, type PosterPlan, type PosterRequest, type PosterSheet } from './poster'

const planned = (pattern: Pattern, request: PosterRequest): PosterPlan => {
  const outcome = planPoster(pattern, evaluateGraded(pattern), request)
  if (outcome.kind !== 'planned') throw new Error('nothing to print')
  return outcome.plan
}
const everySize = (pattern: Pattern, paper: 'letter' | 'a4' = 'letter'): PosterPlan => planned(pattern, { sizes: pattern.sizes, paper, title: 'Raglan' })
const withPieces = (pattern: Pattern, change: (piece: Pattern['pieces'][number]) => Pattern['pieces'][number]): Pattern => ({ ...pattern, pieces: pattern.pieces.map(change) })

const blockOf = (sheet: PosterSheet, id: string): Block => {
  const block = sheet.art.find((art) => art.id === id)
  if (!block) throw new Error(`no block ${id}`)
  return block
}
/** Every point a block's strokes pass through or bend toward, in poster mm. */
const strokePoints = (block: Block): Vec2[] =>
  block.marks.flatMap((mark) => (mark.kind === 'stroke' ? mark.chain.flatMap(curvePoints) : [])).map((p) => ({ x: p.x + block.offset.x, y: p.y + block.offset.y }))

describe('printStatus', () => {
  it('finds nothing wrong with the raglan in any size', () => {
    expect(printStatus(raglanTee, evaluateGraded(raglanTee))).toEqual(raglanTee.sizes.map((size) => ({ size, defects: [] })))
  })

  it('names both XXL pieces of raglanFailingInXXL, in author order', () => {
    const status = printStatus(raglanFailingInXXL, evaluateGraded(raglanFailingInXXL))
    expect(status.slice(0, 4).every(({ defects }) => defects.length === 0)).toBe(true)
    expect(status.at(-1)).toEqual({
      size: 'XXL',
      defects: [
        { pieceId: 'front', pieceName: 'Front', defect: 'no-cut-line' },
        { pieceId: 'neckband', pieceName: 'Neckband', defect: 'no-outline' }
      ]
    })
  })

  it('finds the lost grainline in S and the lost notch in L of raglanPrintHazards', () => {
    expect(printStatus(raglanPrintHazards, evaluateGraded(raglanPrintHazards))).toEqual([
      { size: 'S', defects: [{ pieceId: 'sleeve', pieceName: 'Sleeve <袖> & "cuff"', defect: 'no-grainline' }] },
      { size: 'M', defects: [] },
      { size: 'L', defects: [{ pieceId: 'back', pieceName: 'Back', defect: 'notch-lost' }] },
      { size: 'XL', defects: [] },
      { size: 'XXL', defects: [] }
    ])
  })

  it('reports a duplicated piece id on the later piece', () => {
    const neckband = raglanTee.pieces[3]
    if (!neckband) throw new Error('no neckband')
    const pattern = { ...raglanTee, pieces: [...raglanTee.pieces, { ...neckband, name: 'Second band' }] }
    expect(printStatus(pattern, evaluateGraded(pattern))[0]?.defects).toEqual([{ pieceId: 'neckband', pieceName: 'Second band', defect: 'duplicate-id' }])
  })

  it('reports a fold that no longer resolves', () => {
    const pattern = withPieces(raglanTee, (piece) => (piece.id === 'back' ? { ...piece, fold: 'frontNeck' } : piece))
    expect(printStatus(pattern, evaluateGraded(pattern))[0]?.defects).toEqual([{ pieceId: 'back', pieceName: 'Back', defect: 'fold-lost' }])
  })

  it('lets a piece with a missing stack point print, since stacking is only for the nest', () => {
    const pattern = withPieces(raglanTee, (piece) => (piece.id === 'sleeve' ? { ...piece, stackPoint: 'nowhere' } : piece))
    const graded = evaluateGraded(pattern)
    expect(graded.issues.length).toBeGreaterThan(0)
    expect(printStatus(pattern, graded).every(({ defects }) => defects.length === 0)).toBe(true)
  })
})

describe('planPoster', () => {
  it('plans S to XL of raglanFailingInXXL and refuses XXL', () => {
    const plan = everySize(raglanFailingInXXL)
    expect(plan.sheets.map((sheet) => sheet.size)).toEqual(['S', 'M', 'L', 'XL'])
    expect(plan.refused.map(({ size, defects }) => [size, defects.map((d) => d.defect)])).toEqual([['XXL', ['no-cut-line', 'no-outline']]])
  })

  it('has nothing to print when only a refused size is asked for', () => {
    const outcome = planPoster(raglanFailingInXXL, evaluateGraded(raglanFailingInXXL), { sizes: ['XXL'], paper: 'letter', title: 'Raglan' })
    expect(outcome.kind).toBe('nothing-to-print')
    expect(outcome.kind === 'nothing-to-print' && outcome.refused.map(({ size }) => size)).toEqual(['XXL'])
  })

  it('plans M, XL and XXL of raglanPrintHazards and refuses S and L', () => {
    const plan = everySize(raglanPrintHazards, 'a4')
    expect(plan.sheets.map((sheet) => sheet.size)).toEqual(['M', 'XL', 'XXL'])
    expect(plan.refused.map(({ size }) => size)).toEqual(['S', 'L'])
  })

  it('ignores unknown and repeated sizes and follows pattern order', () => {
    const plan = planned(raglanTee, { sizes: ['XL', 'nope', 'S', 'XL'], paper: 'a4', title: 'Raglan' })
    expect(plan.sheets.map((sheet) => sheet.size)).toEqual(['S', 'XL'])
  })

  it('has nothing to print with no sizes or no pieces', () => {
    expect(planPoster(raglanTee, evaluateGraded(raglanTee), { sizes: [], paper: 'a4', title: 'R' })).toEqual({ kind: 'nothing-to-print', refused: [] })
    const empty = { ...raglanTee, pieces: [] }
    expect(planPoster(empty, evaluateGraded(empty), { sizes: ['M'], paper: 'a4', title: 'R' })).toEqual({ kind: 'nothing-to-print', refused: [] })
  })

  it('pins the page counts of every raglan size on both papers', () => {
    const counts = (paper: 'letter' | 'a4'): string[] => everySize(raglanTee, paper).sheets.map((s) => `${s.size} ${s.cols}x${s.rows}=${s.tiles.length}`)
    expect(counts('letter')).toEqual(['S 3x6=18', 'M 7x3=21', 'L 5x6=24', 'XL 4x6=24', 'XXL 4x6=24'])
    expect(counts('a4')).toEqual(['S 5x5=21', 'M 7x3=21', 'L 4x6=24', 'XL 6x6=24', 'XXL 6x6=28'])
  })

  describe.each(['letter', 'a4'] as const)('on %s', (paper) => {
    const plan = everySize(raglanTee, paper)
    const grid = gridFor(paper)

    it('moves every piece by a translation only, so its cut line is the evaluated one', () => {
      const graded = evaluateGraded(raglanTee)
      for (const sheet of plan.sheets) {
        const pieces = graded.bySize.find((result) => result.size === sheet.size)?.resolved.pieces ?? {}
        for (const [id, piece] of Object.entries(pieces)) {
          const block = blockOf(sheet, id)
          const drawn = new Set(strokePoints({ ...block, offset: { x: 0, y: 0 } }).map(({ x, y }) => `${x},${y}`))
          expect(piece.cutLine?.ring.every(({ x, y }) => drawn.has(`${x},${y}`))).toBe(true)
        }
      }
    })

    it('keeps the key and pieces apart, and clear of the poster edge so no outer page clips a line', () => {
      for (const sheet of plan.sheets) {
        const boxes = sheet.art.map((block) => {
          const points = strokePoints(block)
          const xs = points.map((p) => p.x)
          const ys = points.map((p) => p.y)
          return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
        })
        for (const box of boxes) {
          expect(box.minX).toBeGreaterThanOrEqual(1)
          expect(box.minY).toBeGreaterThanOrEqual(1)
          expect(box.maxX).toBeLessThanOrEqual(sheet.width - 1)
          expect(box.maxY).toBeLessThanOrEqual(sheet.height - 1)
        }
        boxes.forEach((a, i) =>
          boxes.slice(i + 1).forEach((b) => expect(a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY).toBe(true))
        )
      }
    })

    it('cuts every sheet into same-size windows, with A1 first and the grid spanning the sheet', () => {
      for (const sheet of plan.sheets) {
        expect(sheet.tiles[0].label).toBe('A1')
        expect(sheet.width).toBeCloseTo(sheet.cols * grid.stepX + grid.overlap, 9)
        expect(sheet.height).toBeCloseTo(sheet.rows * grid.stepY + grid.overlap, 9)
        for (const tile of sheet.tiles) {
          expect(tile.window).toEqual({ x: tile.col * grid.stepX, y: tile.row * grid.stepY, width: PAPER[paper].width - 20, height: PAPER[paper].height - 20 })
          expect(tile.label).toBe(`${rowLetters(tile.row)}${tile.col + 1}`)
        }
      }
    })

    it('tags a page join only where both pages print', () => {
      for (const sheet of plan.sheets) {
        const printed = new Set(sheet.tiles.map((tile) => tile.label))
        const tags = sheet.guides.flatMap((mark) => (mark.kind === 'text' && mark.text.includes(' | ') ? [mark.text] : []))
        let pairs = 0
        for (const tile of sheet.tiles) {
          if (printed.has(`${rowLetters(tile.row)}${tile.col + 2}`)) pairs++
          if (printed.has(`${rowLetters(tile.row + 1)}${tile.col + 1}`)) pairs++
        }
        expect(tags).toHaveLength(pairs)
        for (const tag of tags) expect(tag.split(' | ').every((label) => printed.has(label))).toBe(true)
      }
    })

    it('skips grid cells no box meets', () => {
      const sheet = plan.sheets.find(({ cols, rows, tiles }) => tiles.length < cols * rows)
      expect(sheet).toBeDefined()
    })
  })
})

describe('rowLetters', () => {
  it.each([
    [0, 'A'],
    [25, 'Z'],
    [26, 'AA'],
    [27, 'AB'],
    [701, 'ZZ'],
    [702, 'AAA']
  ])('names row %i %s', (row, letters) => {
    expect(rowLetters(row)).toBe(letters)
  })
})
