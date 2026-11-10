import { describe, expect, it } from 'vitest'
import * as core from './index'

describe('the public core API', () => {
  it.each(['offsetCurve', 'startTangent', 'endTangent', 'OFFSET_TOLERANCE'])('keeps %s internal to the cut line code', (name) => {
    expect(Object.keys(core)).not.toContain(name)
  })

  it('still exports the geometry the renderer and export use', () => {
    expect(Object.keys(core)).toEqual(expect.arrayContaining(['pathData', 'distance', 'curveLength', 'flatten', 'vec']))
  })
})
