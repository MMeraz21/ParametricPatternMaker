import { pathData } from './geometry'
import { PEN, type Mark, type PosterPlan } from './poster'

/**
 * The full-size SVG: every sheet's art, stacked, with one user unit per mm and the physical size in `width` and
 * `height`. No pages, so no guides. Internal to export.
 */

/** Space between stacked sizes, in mm. */
const SHEET_GAP = 50
const FONT_FAMILY = 'Helvetica, Arial, sans-serif'

const num = (n: number): string => {
  const rounded = Math.round(n * 1e6) / 1e6
  return rounded === 0 ? '0' : String(rounded)
}

export function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char] ?? char)
}

function markSvg(mark: Mark): string {
  switch (mark.kind) {
    case 'stroke': {
      const pen = PEN[mark.pen]
      const dash = pen.dash.length > 0 ? ` stroke-dasharray="${pen.dash.map(num).join(' ')}"` : ''
      return `<path d="${pathData(mark.chain, { closed: mark.closed })}" fill="none" stroke="#000" stroke-width="${num(pen.width)}"${dash} stroke-linejoin="round"/>`
    }
    case 'text': {
      const [x, y] = [num(mark.at.x), num(mark.at.y)]
      const anchor = mark.anchor === 'middle' ? ' text-anchor="middle"' : ''
      const rotate = mark.angle !== 0 ? ` transform="rotate(${num(mark.angle)} ${x} ${y})"` : ''
      return `<text x="${x}" y="${y}" font-size="${num(mark.size)}" font-family="${FONT_FAMILY}"${anchor}${rotate} fill="${mark.light ? '#bfbfbf' : '#000'}">${escapeXml(mark.text)}</text>`
    }
    default: {
      const _exhaustive: never = mark
      return _exhaustive
    }
  }
}

export function writePosterSvg(plan: PosterPlan): string {
  const width = Math.max(...plan.sheets.map((sheet) => sheet.width))
  const height = plan.sheets.reduce((sum, sheet) => sum + sheet.height, 0) + SHEET_GAP * (plan.sheets.length - 1)
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}mm" height="${num(height)}mm" viewBox="0 0 ${num(width)} ${num(height)}">`,
    `<title>${escapeXml(plan.title)}</title>`
  ]
  let top = 0
  for (const sheet of plan.sheets) {
    lines.push(`<g data-size="${escapeXml(sheet.size)}" transform="translate(0 ${num(top)})">`)
    for (const block of sheet.art) {
      lines.push(`<g data-block="${escapeXml(block.id)}" transform="translate(${num(block.offset.x)} ${num(block.offset.y)})">`, ...block.marks.map(markSvg), '</g>')
    }
    lines.push('</g>')
    top += sheet.height + SHEET_GAP
  }
  lines.push('</svg>', '')
  return lines.join('\n')
}
