import type { SaveExportResult } from '../preload/api'
import { bareName, extensionOf, saveThroughDialog, type FileFilter, type SaveDialogPorts } from './files'

/**
 * The save half of export: validate what the renderer sent, ask where to save, write. Knows nothing about patterns.
 * No Electron import, so tests drive it with fake ports. Design: docs/design/m7-export.md, decision 6.
 */

export interface SaveExportPorts extends SaveDialogPorts {
  /** Where the dialog starts. */
  readonly documentsDir: string
}

/** The only formats main will export, keyed by extension. */
const FILTERS: Readonly<Record<string, FileFilter>> = {
  pdf: { name: 'PDF', extensions: ['pdf'] },
  svg: { name: 'SVG image', extensions: ['svg'] }
}

/** Validates the renderer's request, shows the dialog, writes. Never rejects: every outcome is a SaveExportResult. */
export async function runSaveExport(raw: unknown, ports: SaveExportPorts): Promise<SaveExportResult> {
  if (typeof raw !== 'object' || raw === null || !('fileName' in raw) || !('data' in raw)) return { kind: 'failed', message: 'Nothing to save.' }
  const { fileName, data } = raw
  if (typeof fileName !== 'string' || !(data instanceof Uint8Array)) return { kind: 'failed', message: 'Nothing to save.' }
  const name = bareName(fileName)
  const extension = extensionOf(name)
  const filter = Object.hasOwn(FILTERS, extension) ? FILTERS[extension] : undefined
  if (!filter) return { kind: 'failed', message: `Can't save a .${extension || '?'} file.` }
  return saveThroughDialog({ name, data, filter, startDir: ports.documentsDir }, ports)
}
