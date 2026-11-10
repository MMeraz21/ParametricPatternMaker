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

  it('requires seam allowances to be formula text', () => {
    const [front] = raglanTee.pieces
    const parseWith = (seamAllowance: unknown) => parsePattern({ ...raglanTee, pieces: [{ ...front, seamAllowance }] }).ok
    expect(parseWith({ default: 10 })).toBe(false)
    expect(parseWith({ default: '10', perEdge: { frontHem: 25 } })).toBe(false)
    expect(parseWith({ default: 'seam', perEdge: { frontHem: 'hem' } })).toBe(true)
  })
})
