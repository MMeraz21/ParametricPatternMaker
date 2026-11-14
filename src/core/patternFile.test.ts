import { describe, expect, it } from 'vitest'
import { applyEdit } from './edit'
import { PATTERN_FILE_HAZARDS, type PatternFileHazard } from './fixtures/patternFiles'
import { raglanFailingInXXL, raglanPrintHazards, raglanTee } from './fixtures/raglan'
import { CURRENT_SCHEMA_VERSION, parsePattern, type Pattern } from './model'
import { blankPattern, readPatternFile, writePatternFile, type PatternFileProblem } from './patternFile'

const text = (data: Uint8Array): string => new TextDecoder().decode(data)
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value)

function written(pattern: Pattern): Uint8Array {
  const result = writePatternFile(pattern)
  if (!result.ok) throw new Error(`Expected ${JSON.stringify(result.issues)} to be empty`)
  return result.data
}

function problemOf(data: Uint8Array): PatternFileProblem {
  const result = readPatternFile(data)
  if (result.ok) throw new Error('Expected the file to be refused')
  return result.problem
}

describe('readPatternFile', () => {
  it.each(['clean', 'bomCrlf'] as const)('opens %s as the raglan, not upgraded', (name) => {
    expect(readPatternFile(PATTERN_FILE_HAZARDS[name])).toEqual({ ok: true, pattern: raglanTee, upgradedFrom: null })
  })

  it.each<[PatternFileHazard, PatternFileProblem]>([
    ['empty', { kind: 'empty' }],
    ['notText', { kind: 'not-text' }],
    ['utf16', { kind: 'not-text' }],
    ['notAPattern', { kind: 'not-a-pattern' }],
    ['newerVersion', { kind: 'newer-version', version: CURRENT_SCHEMA_VERSION + 1 }],
    ['wrongType', { kind: 'invalid', issues: [{ path: 'pieces[2].cutCount', message: 'Invalid input: expected number, received string' }] }],
    ['unknownField', { kind: 'invalid', issues: [{ path: 'pieces[2]', message: 'Unrecognized key: "lining"' }] }]
  ])('refuses %s', (name, problem) => {
    expect(problemOf(PATTERN_FILE_HAZARDS[name])).toEqual(problem)
  })

  it.each([
    ['truncated', true],
    ['doubleComma', false]
  ] as const)('refuses %s as not JSON, with cutShort %s and the engine detail', (name, cutShort) => {
    const problem = problemOf(PATTERN_FILE_HAZARDS[name])
    expect(problem).toMatchObject({ kind: 'not-json', cutShort })
    expect(problem.kind === 'not-json' && problem.detail.length).toBeGreaterThan(0)
  })

  it.each(['   \n\t', '﻿'])('calls %j empty', (value) => {
    expect(problemOf(bytes(value))).toEqual({ kind: 'empty' })
  })

  it.each(['null', '[]', '3', '"x"', '{}', '{"version":0}', '{"version":1.5}', '{"version":"1"}'])('calls %s not a pattern', (value) => {
    expect(problemOf(bytes(value))).toEqual({ kind: 'not-a-pattern' })
  })

  it('checks the version before the shape, so any newer layout gets the same answer', () => {
    expect(problemOf(bytes('{"version":7,"anything":"else"}'))).toEqual({ kind: 'newer-version', version: 7 })
  })

  it('reports every schema issue with a path a person can find', () => {
    const problem = problemOf(bytes(JSON.stringify({ ...raglanTee, units: 'furlongs', sizes: [] })))
    expect(problem.kind === 'invalid' && problem.issues.map((issue) => issue.path)).toEqual(['units', 'sizes[0]'])
  })

  it('names the top level when an issue has no path', () => {
    const problem = problemOf(bytes(JSON.stringify({ ...raglanTee, extra: 1 })))
    expect(problem).toEqual({ kind: 'invalid', issues: [{ path: '(top level)', message: 'Unrecognized key: "extra"' }] })
  })
})

describe('writePatternFile', () => {
  it('writes 2-space JSON with LF line ends and one final newline', () => {
    const output = text(written(raglanTee))
    expect(output.startsWith('{\n  "version": 1,\n  "units": "cm",')).toBe(true)
    expect(output).not.toContain('\r')
    expect(output.endsWith('}\n')).toBe(true)
    expect(output.endsWith('\n\n')).toBe(false)
  })

  it.each([
    ['raglanTee', raglanTee],
    ['raglanFailingInXXL', raglanFailingInXXL],
    ['raglanPrintHazards', raglanPrintHazards],
    ['blankPattern()', blankPattern()]
  ])('round-trips %s to an equal pattern and identical bytes', (_name, pattern) => {
    const first = written(pattern)
    const read = readPatternFile(first)
    expect(read).toEqual({ ok: true, pattern, upgradedFrom: null })
    expect(read.ok && text(written(read.pattern))).toBe(text(first))
  })

  it('writes keys in schema order, whatever order they were built in', () => {
    const shuffled = Object.fromEntries(Object.entries(raglanTee).reverse()) as Pattern
    expect(text(written(shuffled))).toBe(text(written(raglanTee)))
  })

  it('writes each measurement in size order, even after a size was added in the middle', () => {
    const withXS = applyEdit(raglanTee, { kind: 'addSize', name: 'MT', after: 'M' })
    expect(Object.keys(withXS.measurements[0]?.values ?? {})).not.toEqual(withXS.sizes)
    const read = readPatternFile(written(withXS))
    expect(read.ok && Object.keys(read.pattern.measurements[0]?.values ?? {})).toEqual(['S', 'M', 'MT', 'L', 'XL', 'XXL'])
  })

  it('refuses to write a pattern that fails its own schema', () => {
    const broken = { ...raglanTee, measurements: [{ name: 'chest', values: { S: Number.NaN } }] }
    const result = writePatternFile(broken)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.issues[0]?.path).toBe('measurements[0].values.S')
  })
})

describe('blankPattern', () => {
  it('is one size, M, in cm, with nothing else', () => {
    expect(blankPattern()).toEqual({ version: CURRENT_SCHEMA_VERSION, units: 'cm', sizes: ['M'], measurements: [], variables: [], points: [], segments: [], pieces: [] })
    expect(parsePattern(blankPattern()).ok).toBe(true)
  })
})
