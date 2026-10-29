import { describe, expect, it } from 'vitest'
import { raglanTee } from './fixtures/raglan'
import { parsePattern } from './model'

describe('parsePattern', () => {
  it('accepts the raglan fixture after a JSON round trip', () => {
    const result = parsePattern(JSON.parse(JSON.stringify(raglanTee)))
    expect(result).toEqual({ ok: true, pattern: raglanTee })
  })

  it('rejects malformed patterns', () => {
    expect(parsePattern(null).ok).toBe(false)
    expect(parsePattern({ ...raglanTee, sizes: [] }).ok).toBe(false)
    expect(parsePattern({ ...raglanTee, units: 'furlongs' }).ok).toBe(false)
  })

  it('rejects unknown segment kinds', () => {
    const segments = [{ id: 's', kind: 'arc', from: 'a', to: 'b' }]
    expect(parsePattern({ ...raglanTee, segments }).ok).toBe(false)
  })

  it('rejects negative seam allowances', () => {
    const [front] = raglanTee.pieces
    const pieces = [{ ...front, seamAllowance: { default: -1 } }]
    expect(parsePattern({ ...raglanTee, pieces }).ok).toBe(false)
  })
})
