import { describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION, parsePattern } from '../model'
import { PATTERN_FILE_HAZARDS, raglanFileText } from './patternFiles'
import { raglanTee } from './raglan'

/**
 * Pins what each hazard is, using only today's code, so the M8 reader is built against fixtures that are known to be what
 * they claim. The reader's own answers are in docs/design/m8-file-io.md, decision 16.
 */

const text = (bytes: Uint8Array): string => new TextDecoder('utf-8', { fatal: true }).decode(bytes)
const json = (bytes: Uint8Array): unknown => JSON.parse(text(bytes))

describe('pattern file hazards', () => {
  it('starts from a clean file that parses back to the raglan', () => {
    expect(text(PATTERN_FILE_HAZARDS.clean)).toBe(raglanFileText)
    expect(parsePattern(json(PATTERN_FILE_HAZARDS.clean))).toEqual({ ok: true, pattern: raglanTee })
  })

  it('has an empty file', () => {
    expect(PATTERN_FILE_HAZARDS.empty.length).toBe(0)
  })

  it('has malformed JSON that stops early', () => {
    expect(() => json(PATTERN_FILE_HAZARDS.truncated)).toThrow(SyntaxError)
    expect(text(PATTERN_FILE_HAZARDS.truncated).trimEnd().endsWith('}')).toBe(false)
  })

  it('has malformed JSON in the middle of an otherwise whole file', () => {
    expect(() => json(PATTERN_FILE_HAZARDS.doubleComma)).toThrow(SyntaxError)
    expect(text(PATTERN_FILE_HAZARDS.doubleComma).endsWith('}\n')).toBe(true)
  })

  it('has valid JSON that fails parsePattern at exactly one place', () => {
    const result = parsePattern(json(PATTERN_FILE_HAZARDS.wrongType))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.issues.map((issue) => issue.path)).toEqual([['pieces', 2, 'cutCount']])
  })

  // The next two pin the data loss M8 removes. When decision 2 lands, parsePattern refuses both and these tests change with it.
  it('has a current-version file with a field that today parsePattern silently drops', () => {
    const raw = json(PATTERN_FILE_HAZARDS.unknownField)
    expect(raw).toMatchObject({ version: CURRENT_SCHEMA_VERSION, pieces: [{}, {}, { id: 'sleeve', lining: true }, {}] })
    const result = parsePattern(raw)
    expect(result.ok && result.pattern.pieces[2]).toEqual(raglanTee.pieces[2])
  })

  it('has a newer-version file that today parsePattern accepts, losing its new field', () => {
    const raw = json(PATTERN_FILE_HAZARDS.newerVersion)
    expect(raw).toMatchObject({ version: CURRENT_SCHEMA_VERSION + 1, pieces: [{}, {}, { lining: true }, {}] })
    const result = parsePattern(raw)
    expect(result.ok && result.pattern.version).toBe(CURRENT_SCHEMA_VERSION + 1)
    expect(result.ok && 'lining' in (result.pattern.pieces[2] ?? {})).toBe(false)
  })

  it('has JSON from another program, without a numeric version', () => {
    expect(json(PATTERN_FILE_HAZARDS.notAPattern)).toEqual({ name: 'my-app', version: '1.0.0' })
  })

  it.each(['notText', 'utf16'] as const)('has %s, which is not UTF-8', (name) => {
    expect(() => text(PATTERN_FILE_HAZARDS[name])).toThrow(TypeError)
  })

  it('has a byte order mark and CRLF line ends that still parse back to the raglan', () => {
    expect([...PATTERN_FILE_HAZARDS.bomCrlf.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(text(PATTERN_FILE_HAZARDS.bomCrlf)).toContain('\r\n')
    expect(parsePattern(json(PATTERN_FILE_HAZARDS.bomCrlf))).toEqual({ ok: true, pattern: raglanTee })
  })
})
