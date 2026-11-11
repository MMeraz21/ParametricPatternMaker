import type { SaveExportResult } from '../preload/api'

/**
 * The save half of export: validate what the renderer sent, ask where to save, write. Knows nothing about patterns.
 * No Electron import, so tests drive it with fake ports. Design: docs/design/m7-export.md, decision 6.
 */

export interface SaveExportPorts {
  readonly chooseFile: (options: {
    defaultPath: string
    filters: { name: string; extensions: string[] }[]
  }) => Promise<{ canceled: boolean; filePath?: string | undefined }>
  readonly write: (path: string, data: Uint8Array) => Promise<void>
  /** Where the dialog starts. */
  readonly documentsDir: string
}

/** The only formats main will write, keyed by extension. */
const FILTERS: Readonly<Record<string, { name: string; extensions: string[] }>> = {
  pdf: { name: 'PDF', extensions: ['pdf'] },
  svg: { name: 'SVG image', extensions: ['svg'] }
}

const OPEN_ELSEWHERE = 'The file may be open in another program. Close it and try again.'

const WORDS: Readonly<Record<string, string>> = {
  ENOSPC: 'The disk is full.',
  EACCES: "You don't have permission to save there.",
  EPERM: OPEN_ELSEWHERE,
  EBUSY: OPEN_ELSEWHERE,
  EROFS: "That disk can't be written to.",
  ENOENT: "That folder doesn't exist any more."
}

/** The name after the last separator of either kind, on every OS, so the renderer can never name a directory. */
export function bareName(fileName: string): string {
  return fileName.split(/[/\\]/).pop() ?? ''
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function messageFor(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (Object.hasOwn(WORDS, code)) return WORDS[code] ?? code
  return error instanceof Error ? error.message : String(error)
}

/** Joins without node:path, so the separator follows the documents folder's own style. */
function inDirectory(directory: string, name: string): string {
  const separator = directory.includes('\\') && !directory.includes('/') ? '\\' : '/'
  return directory.endsWith(separator) ? `${directory}${name}` : `${directory}${separator}${name}`
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
  try {
    const { canceled, filePath } = await ports.chooseFile({ defaultPath: inDirectory(ports.documentsDir, name), filters: [filter] })
    if (canceled || !filePath) return { kind: 'cancelled' }
    const path = extensionOf(bareName(filePath)) === extension ? filePath : `${filePath}.${extension}`
    await ports.write(path, data)
    return { kind: 'saved', path }
  } catch (error) {
    return { kind: 'failed', message: messageFor(error) }
  }
}
