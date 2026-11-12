import type { PosterPlan } from './poster'
import { writePosterPdf } from './posterPdf'
import { writePosterSvg } from './posterSvg'

/**
 * The one way to turn a plan into a file. Design: docs/design/m7-export.md.
 */

export type ExportFormat = 'pdf' | 'svg'

export interface PosterFile {
  /** A bare name with its extension: 'Raglan-M-letter.pdf', 'Raglan-M.svg'. Safe on Linux, macOS and Windows. */
  readonly fileName: string
  readonly data: Uint8Array
}

const MAX_BASE_LENGTH = 120
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** A file name base that every desktop OS accepts as is. Never empty. */
export function safeFileBase(name: string): string {
  let base = name.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-').trim()
  base = base.replace(/^\.+/, '').slice(0, MAX_BASE_LENGTH).replace(/[. ]+$/, '')
  if (base === '') return 'Pattern'
  return WINDOWS_RESERVED.test(base) ? `_${base}` : base
}

/** Deterministic: the same plan gives the same bytes. Rejects only on a bug, never on pattern content. */
export async function writePosterFile(plan: PosterPlan, format: ExportFormat): Promise<PosterFile> {
  const sizes = plan.sheets.map((sheet) => sheet.size).join('-')
  switch (format) {
    case 'pdf':
      return { fileName: `${safeFileBase(`${plan.title}-${sizes}-${plan.paper}`)}.pdf`, data: await writePosterPdf(plan) }
    case 'svg':
      return { fileName: `${safeFileBase(`${plan.title}-${sizes}`)}.svg`, data: new TextEncoder().encode(writePosterSvg(plan)) }
    default: {
      const _exhaustive: never = format
      return _exhaustive
    }
  }
}
