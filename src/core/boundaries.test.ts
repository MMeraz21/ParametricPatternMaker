import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as core from './index'
import type { CutLine, CutLineFailure, CutNotch, CutSpan, ResolvedFold, ResolvedGrainline } from './index'

describe('the public core API', () => {
  it.each(['offsetCurve', 'startTangent', 'endTangent', 'OFFSET_TOLERANCE'])('keeps %s internal to the cut line code', (name) => {
    expect(Object.keys(core)).not.toContain(name)
  })

  it.each(['unionRing', 'ringIsSimple', 'areaOutside', 'buildCutLine'])('keeps %s internal to the cut line code', (name) => {
    expect(Object.keys(core)).not.toContain(name)
  })

  it('offers one way to get results: evaluateGraded, not evaluate', () => {
    expect(Object.keys(core)).not.toContain('evaluate')
    expect(Object.keys(core)).toEqual(expect.arrayContaining(['evaluateGraded', 'viewAt']))
  })

  it.each(['writePosterPdf', 'writePosterSvg', 'packBoxes', 'pieceMarks', 'keyMarks', 'tileGuides', 'PT_PER_MM'])('keeps %s internal to export', (name) => {
    expect(Object.keys(core)).not.toContain(name)
  })

  it('exports printStatus, planPoster and writePosterFile', () => {
    expect(Object.keys(core)).toEqual(expect.arrayContaining(['printStatus', 'planPoster', 'writePosterFile', 'PRINT_INSTRUCTION', 'PAPER']))
  })

  it('still exports the geometry the renderer and export use', () => {
    expect(Object.keys(core)).toEqual(expect.arrayContaining(['pathData', 'polygonPathData', 'distance', 'curveLength', 'flatten', 'vec']))
  })
})

describe('the cut line types the renderer and export read', () => {
  it('are exported, which typecheck proves by compiling this', () => {
    const notch: CutNotch = { notchId: 'n', at: core.vec(0, 0), mark: [core.vec(0, 0), core.vec(0, 1)] }
    const span: CutSpan = { kind: 'join', after: 'a', before: 'b', points: [] }
    const line: CutLine = { ring: [], spans: [span], notches: [notch] }
    const failure: CutLineFailure = { kind: 'out-of-range' }
    const fold: ResolvedFold = { segmentId: 's', from: core.vec(0, 0), to: core.vec(0, 1) }
    const grainline: ResolvedGrainline = { from: core.vec(0, 0), to: core.vec(0, 1), angle: 0 }
    expect([line.spans.length, failure.kind, fold.segmentId, grainline.angle]).toEqual([1, 'out-of-range', 's', 0])
  })
})

describe('source imports', () => {
  const importsOf = (source: string): string[] =>
    [...source.matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bdoMock\s*\(\s*)['"]([^'"]+)['"]/g)].flatMap((match) => match[1] ?? [])

  const srcRoot = join(import.meta.dirname, '..')
  const sourceFiles = readdirSync(srcRoot, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.(ts|tsx|mts|js|mjs)$/.test(file))
    .map((file) => ({ path: file.split(sep).join('/'), imports: importsOf(readFileSync(join(srcRoot, file), 'utf8')) }))
  const importersOf = (matches: (specifier: string) => boolean): string[] =>
    sourceFiles.filter((file) => file.imports.some(matches)).map((file) => file.path).sort()

  it('sees every form of import', () => {
    expect(importsOf(`import { a } from 'x'`)).toEqual(['x'])
    expect(importsOf(`import type { a } from "x"`)).toEqual(['x'])
    expect(importsOf(`import 'x'`)).toEqual(['x'])
    expect(importsOf(`export * from 'x'`)).toEqual(['x'])
    expect(importsOf(`await import('x')`)).toEqual(['x'])
    expect(importsOf(`require('x')`)).toEqual(['x'])
  })

  it('finds the source files it should be scanning', () => {
    const paths = sourceFiles.map((file) => file.path)
    expect(paths).toContain('core/evaluate.ts')
    expect(paths).toContain('renderer/src/App.tsx')
    expect(paths).toContain('main/index.ts')
  })

  it('imports clipper2-ts only from ringUnion', () => {
    expect(importersOf((specifier) => specifier.startsWith('clipper2-ts'))).toEqual(['core/ringUnion.test.ts', 'core/ringUnion.ts'])
  })

  it('imports pdf-lib only from posterPdf', () => {
    expect(importersOf((specifier) => specifier === 'pdf-lib' || specifier.startsWith('pdf-lib/'))).toEqual(['core/posterPdf.test.ts', 'core/posterPdf.ts'])
  })

  it('imports nothing from Electron, Node or the UI in core outside tests', () => {
    const banned = (specifier: string): boolean => /^(electron|react|react-dom)(\/|$)/.test(specifier) || specifier.startsWith('node:') || ['fs', 'path', 'os', 'zlib'].includes(specifier)
    expect(sourceFiles.filter((file) => file.path.startsWith('core/') && !file.path.endsWith('.test.ts') && file.imports.some(banned)).map((file) => file.path)).toEqual([])
  })

  it('imports the export internals only from inside core', () => {
    expect(importersOf((specifier) => /^@core\/(posterPdf|posterSvg|posterPack|posterArt)\b/.test(specifier))).toEqual([])
  })

  it('calls evaluate only from inside core', () => {
    expect(importersOf((specifier) => /^@core\/evaluate\b/.test(specifier))).toEqual([])
    expect(sourceFiles.filter((file) => !file.path.startsWith('core/') && file.imports.some((s) => /(^|\/)evaluate$/.test(s)))).toEqual([])
  })

  it('imports the cut line internals only from inside core', () => {
    const importers = importersOf((specifier) => /^@core\/(ringUnion|cutLine)\b/.test(specifier))
    expect(importers).toEqual([])
    const outsideCore = sourceFiles.filter((file) => !file.path.startsWith('core/') && file.imports.some((s) => /(^|\/)(ringUnion|cutLine)$/.test(s)))
    expect(outsideCore).toEqual([])
  })
})
