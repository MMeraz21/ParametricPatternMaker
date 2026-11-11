import { describe, expect, it } from 'vitest'
import { packBoxes, type Grid } from './posterPack'

/** Windows 100 x 100 that step by 90, so neighbours share 10. */
const grid: Grid = { stepX: 90, stepY: 90, windowWidth: 100, windowHeight: 100, overlap: 10 }

describe('packBoxes', () => {
  it('puts the first box at the top-left and a lone small box on one page', () => {
    const packed = packBoxes({ id: 'key', width: 40, height: 40 }, [{ id: 'a', width: 40, height: 40 }], grid)
    expect(packed.cols).toBe(1)
    expect(packed.rows).toBe(1)
    expect(packed.at.get('key')).toEqual({ x: 0, y: 0 })
    expect(packed.at.get('a')).toEqual({ x: 40, y: 0 })
    expect(packed.printed).toEqual([{ row: 0, col: 0 }])
  })

  it('adds columns until the widest box fits', () => {
    const packed = packBoxes({ id: 'key', width: 10, height: 10 }, [{ id: 'wide', width: 250, height: 10 }], grid)
    expect(packed.cols).toBeGreaterThanOrEqual(3)
    expect(packed.cols * grid.stepX + grid.overlap).toBeGreaterThanOrEqual(250)
  })

  it('skips cells no box meets', () => {
    const packed = packBoxes({ id: 'key', width: 10, height: 10 }, [{ id: 'tall', width: 10, height: 260 }, { id: 'long', width: 260, height: 10 }], grid)
    expect(packed.printed.length).toBeLessThan(packed.cols * packed.rows)
  })

  it('never overlaps two boxes, and gives the same answer twice', () => {
    const boxes = Array.from({ length: 12 }, (_, i) => ({ id: `b${i}`, width: 20 + ((i * 37) % 90), height: 15 + ((i * 53) % 140) }))
    const packed = packBoxes({ id: 'key', width: 30, height: 50 }, boxes, grid)
    expect(packBoxes({ id: 'key', width: 30, height: 50 }, boxes, grid)).toEqual(packed)
    const placed = [{ id: 'key', width: 30, height: 50 }, ...boxes].map((box) => ({ ...box, ...(packed.at.get(box.id) ?? { x: NaN, y: NaN }) }))
    placed.forEach((a, i) =>
      placed.slice(i + 1).forEach((b) => expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true))
    )
  })
})
