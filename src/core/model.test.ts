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

  it.each([
    ['duplicates', ['S', 'S']],
    ['duplicates in another case', ['XL', 'xl']],
    ['an empty name', ['']],
    ['surrounding spaces', ['S ']],
    ['__proto__', ['__proto__']],
    ['constructor', ['constructor']]
  ])('rejects sizes with %s', (_label, sizes) => {
    expect(parsePattern({ ...raglanTee, sizes }).ok).toBe(false)
  })

  it('accepts sizes that are numbers or share a point name', () => {
    expect(parsePattern({ ...raglanTee, sizes: ['38', 'HPS'] }).ok).toBe(true)
  })

  it('keeps a stack point through a JSON round trip', () => {
    const pieces = raglanTee.pieces.map((piece) => ({ ...piece, stackPoint: 'hps' }))
    expect(parsePattern(JSON.parse(JSON.stringify({ ...raglanTee, pieces })))).toEqual({ ok: true, pattern: { ...raglanTee, pieces } })
  })

  it('refuses a saved active size rather than dropping it', () => {
    const result = parsePattern({ ...raglanTee, activeSize: 'M' })
    expect(result.ok).toBe(false)
  })

  it('refuses a version it does not know', () => {
    expect(parsePattern({ ...raglanTee, version: 2 }).ok).toBe(false)
  })

  it.each([
    ['the pattern', { ...raglanTee, layers: [] }, []],
    ['a piece', { ...raglanTee, pieces: raglanTee.pieces.map((piece, i) => (i === 0 ? { ...piece, lining: true } : piece)) }, ['pieces', 0]],
    ['a line', { ...raglanTee, segments: raglanTee.segments.map((s) => (s.kind === 'line' ? { ...s, colour: 'red' } : s)) }, ['segments']],
    ['a bezier', { ...raglanTee, segments: raglanTee.segments.map((s) => (s.kind === 'bezier' ? { ...s, colour: 'red' } : s)) }, ['segments']]
  ])('refuses an unknown key on %s instead of dropping it', (_where, input, pathStart) => {
    const result = parsePattern(input)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.issues[0]?.code).toBe('unrecognized_keys')
    expect(result.error.issues[0]?.path.slice(0, pathStart.length)).toEqual(pathStart)
  })
})
