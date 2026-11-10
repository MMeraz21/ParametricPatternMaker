import { describe, expect, it } from 'vitest'
import { evaluate } from '../evaluate'
import { raglanTee } from './raglan'

/**
 * The raglan as the milestone 5 acceptance test. The todos are the checks that need the cut line, and
 * become real tests when it lands. docs/design/m5-pieces.md says what each one asserts.
 */
const sizes = raglanTee.sizes
const resolvedFor = (size: string) => evaluate(raglanTee, size)

describe('raglan tee fixture', () => {
  it.each(sizes)('resolves all four pieces with no issues in size %s', (size) => {
    const resolved = resolvedFor(size)
    expect(resolved.issues).toEqual([])
    expect(Object.keys(resolved.pieces)).toEqual(['front', 'back', 'sleeve', 'neckband'])
  })

  it.each([
    ['frontRaglan', 'sleeveFrontRaglan'],
    ['backRaglan', 'sleeveBackRaglan']
  ])('sews %s to %s at the same length in every size', (body, sleeve) => {
    for (const size of sizes) {
      const { segments } = resolvedFor(size)
      expect(segments[sleeve]?.length).toBeCloseTo(segments[body]?.length ?? Number.NaN, 6)
    }
  })

  it.each(['front', 'back', 'sleeve', 'neckband'])('grades %s larger at every step', (id) => {
    const areas = sizes.map((size) => resolvedFor(size).pieces[id]?.area ?? Number.NaN)
    for (const [i, area] of areas.entries()) {
      if (i > 0) expect(area).toBeGreaterThan(areas[i - 1] ?? Number.POSITIVE_INFINITY)
    }
  })

  it('winds the neckband the other way from the body', () => {
    const { pieces } = resolvedFor('M')
    expect(pieces['neckband']?.orientation).not.toBe(pieces['front']?.orientation)
  })

  describe('cut line (milestone 5)', () => {
    it.todo('builds a cut line and grainline for every piece in every size')
    it.todo('lands front and back exactly on the fold, with min x equal to 0')
    it.todo('keeps every hem span at hem_length + 25 and every side span at body_width + 10')
    it.todo('keeps curved spans within CUT_LINE_BOUND of the true offset, with the bound checked both ways')
    it.todo('gives one edge span per outline edge, in outline order')
    it.todo('contains every source point inside a simple ring')
    it.todo('lands each notch on the cut line at its edge allowance from the seam')
    it.todo('grows the cut area at every size step')
    it.todo('gives deep-equal cut lines from two evaluate calls')
  })
})
