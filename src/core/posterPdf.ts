import {
  clip,
  concatTransformationMatrix,
  drawObject,
  endPath,
  PDFDocument,
  PDFName,
  popGraphicsState,
  PrintScaling,
  pushGraphicsState,
  rectangle,
  StandardFonts,
  type PDFFont
} from 'pdf-lib'
import type { Curve } from './geometry'
import { PAPER, PEN, PRINT_MARGIN, gridFor, type Mark, type PaperName, type PosterPlan, type PosterSheet } from './poster'

/**
 * The tiled PDF. Each sheet is one form XObject holding the whole poster in mm, y down. Each page is a window onto it:
 * one matrix from mm to points, a clip to the margins and a translate. pdf-lib is only the container: the art is one
 * hand-written content string per sheet, so no drawing operator ever goes through pushOperators.
 * The only file that imports pdf-lib, and the only place the scale exists. Internal to export.
 */

/** Points per millimetre. Never rounded: rounding to 2 decimals is 3.3 mm wrong over 2 m. */
export const PT_PER_MM = 72 / 25.4

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4

/** The page box in points: exact mm times PT_PER_MM, rounded to 4 decimals so Letter is exactly 612 x 792. */
export function pageBox(paper: PaperName): { readonly width: number; readonly height: number } {
  return { width: round4(PAPER[paper].width * PT_PER_MM), height: round4(PAPER[paper].height * PT_PER_MM) }
}

/** A number for a content stream: at most 4 decimals, never an exponent or -0. */
function num(n: number): string {
  const rounded = round4(n)
  return rounded === 0 ? '0' : String(rounded)
}

function pathOps(chain: readonly Curve[], closed: boolean): string {
  const first = chain[0]
  if (!first) return ''
  const ops = [`${num(first.from.x)} ${num(first.from.y)} m`]
  for (const curve of chain) {
    switch (curve.kind) {
      case 'line':
        ops.push(`${num(curve.to.x)} ${num(curve.to.y)} l`)
        break
      case 'cubic':
        ops.push(`${num(curve.c1.x)} ${num(curve.c1.y)} ${num(curve.c2.x)} ${num(curve.c2.y)} ${num(curve.to.x)} ${num(curve.to.y)} c`)
        break
      default: {
        const _exhaustive: never = curve
        return _exhaustive
      }
    }
  }
  if (closed) ops.push('h')
  return ops.join(' ')
}

/** Text the standard font can show: anything outside WinAnsi becomes '?', character by character. */
function encodable(font: PDFFont, text: string): string {
  let safe = ''
  for (const char of text) {
    try {
      font.encodeText(char)
      safe += char
    } catch {
      safe += '?'
    }
  }
  return safe
}

function markOps(mark: Mark, font: PDFFont): string {
  switch (mark.kind) {
    case 'stroke': {
      const pen = PEN[mark.pen]
      return `${num(pen.width)} w [${pen.dash.map(num).join(' ')}] 0 d ${pathOps(mark.chain, mark.closed)} S`
    }
    case 'text': {
      const value = encodable(font, mark.text)
      const radians = (mark.angle * Math.PI) / 180
      const [cos, sin] = [Math.cos(radians), Math.sin(radians)]
      const lead = mark.anchor === 'middle' ? font.widthOfTextAtSize(value, mark.size) / 2 : 0
      // The form is y down, so the text matrix flips glyphs back upright.
      const matrix = [cos, sin, sin, -cos, mark.at.x - cos * lead, mark.at.y - sin * lead].map(num).join(' ')
      return `BT /F1 ${num(mark.size)} Tf ${mark.light ? '0.75' : '0'} g ${matrix} Tm ${font.encodeText(value).toString()} Tj ET`
    }
    default: {
      const _exhaustive: never = mark
      return _exhaustive
    }
  }
}

function sheetContent(sheet: PosterSheet, font: PDFFont): string {
  const parts = ['0 G 1 j 0 J', ...sheet.guides.map((mark) => markOps(mark, font))]
  for (const block of sheet.art) {
    parts.push(`q 1 0 0 1 ${num(block.offset.x)} ${num(block.offset.y)} cm`, ...block.marks.map((mark) => markOps(mark, font)), 'Q')
  }
  return parts.join('\n')
}

/** Deterministic: the same plan gives the same bytes. */
export async function writePosterPdf(plan: PosterPlan): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.setTitle(plan.title)
  doc.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None)
  const font = doc.embedStandardFont(StandardFonts.Helvetica)
  const box = pageBox(plan.paper)
  const grid = gridFor(plan.paper)
  plan.sheets.forEach((sheet, index) => {
    const form = doc.context.flateStream(sheetContent(sheet, font), {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, sheet.width, sheet.height],
      Resources: { Font: { F1: font.ref } }
    })
    const formRef = doc.context.register(form)
    const name = PDFName.of(`Sheet${index + 1}`)
    for (const tile of sheet.tiles) {
      const page = doc.addPage([box.width, box.height])
      page.node.setXObject(name, formRef)
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(PT_PER_MM, 0, 0, -PT_PER_MM, 0, box.height),
        rectangle(PRINT_MARGIN, PRINT_MARGIN, grid.windowWidth, grid.windowHeight),
        clip(),
        endPath(),
        concatTransformationMatrix(1, 0, 0, 1, PRINT_MARGIN - tile.window.x, PRINT_MARGIN - tile.window.y),
        drawObject(name),
        popGraphicsState()
      )
    }
  })
  return doc.save({ useObjectStreams: true, addDefaultPage: false })
}
