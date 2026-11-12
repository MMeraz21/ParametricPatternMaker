import { inflateSync } from 'node:zlib'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, type PDFPage } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { raglanPrintHazards, raglanTee } from './fixtures/raglan'
import { evaluateGraded } from './graded'
import type { Pattern } from './model'
import { PAPER, planPoster, type PaperName, type PosterPlan } from './poster'
import { pageBox, PT_PER_MM, writePosterPdf } from './posterPdf'

const planOf = (pattern: Pattern, sizes: readonly string[], paper: PaperName): PosterPlan => {
  const outcome = planPoster(pattern, evaluateGraded(pattern), { sizes, paper, title: 'Raglan' })
  if (outcome.kind !== 'planned') throw new Error('nothing to print')
  return outcome.plan
}

type Matrix = readonly [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
/** `m` applied first, then `n`, as PDF composes `cm`. */
const times = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5]
]
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

function streamText(doc: PDFDocument, ref: unknown): string {
  const stream = ref instanceof PDFRef ? doc.context.lookup(ref) : ref
  if (!(stream instanceof PDFRawStream)) throw new Error('not a raw stream')
  const bytes = stream.dict.has(PDFName.of('Filter')) ? inflateSync(stream.getContents()) : Buffer.from(stream.getContents())
  return bytes.toString('latin1')
}

function pageContent(doc: PDFDocument, page: PDFPage): string {
  const contents = page.node.Contents()
  return contents instanceof PDFArray ? contents.asArray().map((ref) => streamText(doc, ref)).join('\n') : streamText(doc, contents)
}

/** The page's `cm`s composed, and the name of the form it draws. */
function pageMatrix(content: string): { matrix: Matrix; form: string } {
  let matrix = IDENTITY
  for (const [, ...values] of content.matchAll(/(\S+) (\S+) (\S+) (\S+) (\S+) (\S+) cm/g)) {
    matrix = times(values.map(Number) as unknown as Matrix, matrix)
  }
  const form = /\/(\S+) Do/.exec(content)?.[1]
  if (!form) throw new Error('page draws no form')
  return { matrix, form }
}

function formOf(doc: PDFDocument, page: PDFPage, name: string): string {
  const resources = page.node.Resources()
  const xObjects = resources?.lookup(PDFName.of('XObject'), PDFDict)
  return streamText(doc, xObjects?.get(PDFName.of(name)))
}

/** The test square's four corners in form mm: the first closed four-line path drawn in the 0.35 mm square pen, inside the key's block. */
function testSquare(form: string): { matrix: Matrix; corners: [number, number][] } {
  const key = /q 1 0 0 1 (\S+) (\S+) cm\n([\s\S]*?)\nQ/.exec(form)
  if (!key) throw new Error('no key block')
  const square = /0\.35 w \[\] 0 d (\S+) (\S+) m (\S+) (\S+) l (\S+) (\S+) l (\S+) (\S+) l h S/.exec(key[3] ?? '')
  if (!square) throw new Error('no test square')
  const n = square.slice(1).map(Number)
  return {
    matrix: [1, 0, 0, 1, Number(key[1]), Number(key[2])],
    corners: [0, 2, 4, 6].map((i): [number, number] => [n[i] ?? NaN, n[i + 1] ?? NaN])
  }
}

describe.each(['letter', 'a4'] as const)('the PDF on %s', (paper) => {
  it('prints the test square at exactly 50 mm through every matrix in the file, the right way up', async () => {
    const doc = await PDFDocument.load(await writePosterPdf(planOf(raglanTee, ['M'], paper)))
    const page = doc.getPage(0)
    const { matrix, form } = pageMatrix(pageContent(doc, page))
    const square = testSquare(formOf(doc, page, form))
    const toPage = times(square.matrix, matrix)
    const [a, b, , d] = square.corners.map(([x, y]) => apply(toPage, x, y).map((pt) => pt / PT_PER_MM))
    if (!a || !b || !d) throw new Error('no corners')
    expect(Math.abs((b[0] ?? 0) - (a[0] ?? 0)) - 50).toBeLessThan(1e-9)
    expect(Math.abs((a[1] ?? 0) - (d[1] ?? 0)) - 50).toBeLessThan(1e-9)
    // y down in the form is y up on the page: the square's first corner is its top-left, so it is higher on the page.
    expect(a[1]).toBeGreaterThan(d[1] ?? Infinity)
    expect(b[0]).toBeGreaterThan(a[0] ?? Infinity)
  })

  it('has a page box of the paper in points, with the flip at the same height', async () => {
    const box = pageBox(paper)
    expect(Math.abs(box.width - PAPER[paper].width * PT_PER_MM)).toBeLessThan(1e-4)
    expect(Math.abs(box.height - PAPER[paper].height * PT_PER_MM)).toBeLessThan(1e-4)
    const doc = await PDFDocument.load(await writePosterPdf(planOf(raglanTee, ['M'], paper)))
    const page = doc.getPage(0)
    expect(page.getMediaBox()).toEqual({ x: 0, y: 0, ...box })
    const first = /(\S+) (\S+) (\S+) (\S+) (\S+) (\S+) cm/.exec(pageContent(doc, page))
    expect(first?.slice(1).map(Number)).toEqual([PT_PER_MM, 0, 0, -PT_PER_MM, 0, box.height])
    expect(Number(first?.[1])).toBe(72 / 25.4)
  })

  it('moves neighbouring pages by exactly one grid step', async () => {
    const plan = planOf(raglanTee, ['M'], paper)
    const doc = await PDFDocument.load(await writePosterPdf(plan))
    const [sheet] = plan.sheets
    const origins = doc.getPages().map((page) => apply(pageMatrix(pageContent(doc, page)).matrix, 0, 0).map((pt) => pt / PT_PER_MM))
    sheet.tiles.forEach((tile, i) => {
      const origin = origins[i] ?? []
      expect(Math.abs((origin[0] ?? 0) - (10 - tile.window.x))).toBeLessThan(1e-9)
      expect(Math.abs((origin[1] ?? 0) - (PAPER[paper].height - 10 + tile.window.y))).toBeLessThan(1e-3)
    })
  })
})

describe('the PDF file', () => {
  it('says not to scale, and has no crop box or user unit', async () => {
    const doc = await PDFDocument.load(await writePosterPdf(planOf(raglanTee, ['M'], 'a4')))
    expect(doc.catalog.getViewerPreferences()?.getPrintScaling()).toBe('None')
    for (const page of doc.getPages()) {
      expect(page.node.has(PDFName.of('CropBox'))).toBe(false)
      expect(page.node.has(PDFName.of('UserUnit'))).toBe(false)
    }
  })

  it('has one page per tile and one form per sheet, and every page draws in eight operators', async () => {
    const plan = planOf(raglanTee, raglanTee.sizes, 'letter')
    const doc = await PDFDocument.load(await writePosterPdf(plan))
    expect(doc.getPageCount()).toBe(plan.sheets.reduce((sum, sheet) => sum + sheet.tiles.length, 0))
    const forms = new Set(doc.getPages().map((page) => pageMatrix(pageContent(doc, page)).form))
    expect(forms.size).toBe(plan.sheets.length)
    for (const page of doc.getPages()) expect(pageContent(doc, page).trim().split('\n')).toHaveLength(8)
  })

  it('prints a 50.8 mm square for a pattern in inches', async () => {
    const doc = await PDFDocument.load(await writePosterPdf(planOf(raglanPrintHazards, ['M'], 'letter')))
    const page = doc.getPage(0)
    const square = testSquare(formOf(doc, page, pageMatrix(pageContent(doc, page)).form))
    const [a, b] = square.corners
    expect((b?.[0] ?? 0) - (a?.[0] ?? 0)).toBe(50.8)
  })

  it('gives the same bytes twice', async () => {
    const plan = planOf(raglanTee, ['S', 'M'], 'a4')
    expect(Buffer.from(await writePosterPdf(plan)).equals(Buffer.from(await writePosterPdf(plan)))).toBe(true)
  })

  it('prints a name the font cannot show with ? and does not throw', async () => {
    const doc = await PDFDocument.load(await writePosterPdf(planOf(raglanPrintHazards, ['M'], 'letter')))
    const page = doc.getPage(0)
    const form = formOf(doc, page, pageMatrix(pageContent(doc, page)).form)
    const hex = Buffer.from('Sleeve <?> & "cuff"', 'latin1').toString('hex').toUpperCase()
    expect(form).toContain(`<${hex}>`)
  })

  it('does not overflow on a ring of 200,000 points', async () => {
    const plan = planOf(raglanTee, ['M'], 'a4')
    const [sheet] = plan.sheets
    const ring = Array.from({ length: 200_000 }, (_, i) => {
      const t = (i / 200_000) * 2 * Math.PI
      return { x: 100 + 50 * Math.cos(t), y: 100 + 50 * Math.sin(t) }
    })
    const chain = ring.slice(1).map((to, i) => ({ kind: 'line' as const, from: ring[i] ?? to, to }))
    const huge: PosterPlan = { ...plan, sheets: [{ ...sheet, art: [...sheet.art, { id: 'huge', offset: { x: 0, y: 0 }, marks: [{ kind: 'stroke', pen: 'cut', chain, closed: true }] }] }] }
    const bytes = await writePosterPdf(huge)
    expect(bytes.length).toBeGreaterThan(0)
  })
})
