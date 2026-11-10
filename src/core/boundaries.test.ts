import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as core from './index'

describe('the public core API', () => {
  it.each(['offsetCurve', 'startTangent', 'endTangent', 'OFFSET_TOLERANCE'])('keeps %s internal to the cut line code', (name) => {
    expect(Object.keys(core)).not.toContain(name)
  })

  it.each(['unionRing', 'ringIsSimple', 'areaOutside', 'onSameGridPoint', 'buildCutLine'])('keeps %s internal to the cut line code', (name) => {
    expect(Object.keys(core)).not.toContain(name)
  })

  it('still exports the geometry the renderer and export use', () => {
    expect(Object.keys(core)).toEqual(expect.arrayContaining(['pathData', 'polygonPathData', 'distance', 'curveLength', 'flatten', 'vec']))
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

  it('imports the cut line internals only from inside core', () => {
    const importers = importersOf((specifier) => /^@core\/(ringUnion|cutLine)\b/.test(specifier))
    expect(importers).toEqual([])
    const outsideCore = sourceFiles.filter((file) => !file.path.startsWith('core/') && file.imports.some((s) => /(^|\/)(ringUnion|cutLine)$/.test(s)))
    expect(outsideCore).toEqual([])
  })
})
