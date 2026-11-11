import type { PaperName, PieceDefect, PosterPlan, SizePrintStatus } from '@core'

/** What saving gave back, as the preload bridge types it. */
type SaveExportResult = Awaited<ReturnType<Window['api']['saveExport']>>

/** Where the export dialog is. Everything here is pure, so the dialog component only wires it up. */
export type ExportStage =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working' }
  | { readonly kind: 'saved'; readonly path: string }
  | { readonly kind: 'failed'; readonly message: string }

/** Cancelling shows nothing: the dialog is simply still open. */
export function stageAfter(result: SaveExportResult): ExportStage {
  switch (result.kind) {
    case 'saved':
      return { kind: 'saved', path: result.path }
    case 'cancelled':
      return { kind: 'idle' }
    case 'failed':
      return { kind: 'failed', message: result.message }
    default: {
      const _exhaustive: never = result
      return _exhaustive
    }
  }
}

/** Regions that print on Letter. */
const LETTER_REGIONS = new Set(['US', 'CA', 'MX', 'PH', 'PR', 'CL', 'CO', 'CR', 'DO', 'GT', 'PA', 'SV', 'VE', 'NI', 'BZ'])

/** Letter where the locale's region uses it, else A4. A locale with no region, or one that doesn't parse, gives A4. */
export function defaultPaper(locale: string): PaperName {
  try {
    const region = new Intl.Locale(locale).region
    return region && LETTER_REGIONS.has(region) ? 'letter' : 'a4'
  } catch {
    return 'a4'
  }
}

/** The shown size if it can print, else nothing. */
export function defaultTicks(status: readonly SizePrintStatus[], shown: string): ReadonlySet<string> {
  return new Set(status.some(({ size, defects }) => size === shown && defects.length === 0) ? [shown] : [])
}

const DEFECT_WORDS: Readonly<Record<PieceDefect, string>> = {
  'duplicate-id': 'shares its id with another piece',
  'no-outline': 'has no outline',
  'no-cut-line': 'has no cut line',
  'no-grainline': 'has no grainline',
  'fold-lost': 'has lost its fold',
  'notch-lost': 'has lost a notch'
}

/** Why a size can't print, or null when it can. */
export function refusalText({ size, defects }: SizePrintStatus): string | null {
  if (defects.length === 0) return null
  return `${size} can't be printed: ${defects.map(({ pieceName, defect }) => `${pieceName} ${DEFECT_WORDS[defect]}`).join(', ')}.`
}

export const pagesOf = (plan: PosterPlan): number => plan.sheets.reduce((sum, sheet) => sum + sheet.tiles.length, 0)
