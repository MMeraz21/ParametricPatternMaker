import type { DocumentFile, OpenDocumentRequest, OpenDocumentResult, SaveDocumentRequest, SaveDocumentResult } from '../preload/api'
import { bareName, codeOf, folderOf, messageFor, readMessage, saveThroughDialog, type FileFilter, type SaveDialogPorts } from './files'
import { sameStamp, type FileStamp, type KnownFiles } from './knownFiles'

/**
 * Opening and saving pattern files: dialogs, which paths may be touched, stamps, and the words for what went wrong. Reads and
 * writes bytes only; parsing is core's, in the renderer. No Electron import. Design: docs/design/m8-file-io.md, decisions 3, 6 and 8.
 */

/** About 1,500 raglans (10.8 KB each). */
export const MAX_PATTERN_BYTES = 16 * 1024 * 1024
export const PATTERN_FILTER: FileFilter = { name: 'Pattern', extensions: ['json'] }
const ALL_FILES: FileFilter = { name: 'All files', extensions: ['*'] }

export interface FileInfo {
  readonly isFile: boolean
  readonly size: number
  readonly modifiedMs: number
  readonly writable: boolean
}

export interface DocumentPorts {
  readonly chooseOpen: (options: { defaultPath: string; filters: FileFilter[] }) => Promise<{ canceled: boolean; filePaths: string[] }>
  readonly chooseSave: SaveDialogPorts['chooseFile']
  /** Rejects with the filesystem error. */
  readonly stat: (path: string) => Promise<FileInfo>
  readonly readFile: (path: string) => Promise<Uint8Array>
  /** Follows a symlink, so the link stays a link, then writes atomically. */
  readonly write: (path: string, data: Uint8Array) => Promise<void>
  /** The native "changed by another program" prompt. */
  readonly askConflict: (fileName: string) => Promise<'replace' | 'save-as' | 'cancel'>
  readonly known: KnownFiles
  readonly documentsDir: string
}

/** The file name without a final `.json`, any case. */
export function documentFile(path: string): DocumentFile {
  return { path, name: bareName(path).replace(/\.json$/i, '') || 'Untitled' }
}

const stampOf = (info: FileInfo): FileStamp => ({ modifiedMs: info.modifiedMs, size: info.size })
const startDir = (near: string | null, ports: DocumentPorts): string => (near ? folderOf(near) || ports.documentsDir : ports.documentsDir)

async function stampAfterWrite(path: string, ports: DocumentPorts): Promise<FileStamp | null> {
  return ports.stat(path).then(stampOf, () => null)
}

function parseOpen(raw: unknown): OpenDocumentRequest | null {
  if (typeof raw !== 'object' || raw === null || !('kind' in raw)) return null
  if (raw.kind === 'choose' && 'near' in raw && (raw.near === null || typeof raw.near === 'string')) return { kind: 'choose', near: raw.near }
  if (raw.kind === 'recent' && 'path' in raw && typeof raw.path === 'string') return { kind: 'recent', path: raw.path }
  return null
}

function parseSave(raw: unknown): SaveDocumentRequest | null {
  if (typeof raw !== 'object' || raw === null || !('kind' in raw) || !('data' in raw) || !(raw.data instanceof Uint8Array)) return null
  const { data } = raw
  if (raw.kind === 'overwrite' && 'path' in raw && typeof raw.path === 'string') return { kind: 'overwrite', path: raw.path, data }
  if (raw.kind === 'choose' && 'name' in raw && typeof raw.name === 'string' && 'near' in raw && (raw.near === null || typeof raw.near === 'string')) {
    return { kind: 'choose', name: raw.name, near: raw.near, data }
  }
  return null
}

/** Never rejects. */
export async function runOpenDocument(raw: unknown, ports: DocumentPorts): Promise<OpenDocumentResult> {
  const request = parseOpen(raw)
  if (!request) return { kind: 'failed', message: 'Nothing to open.' }
  let path: string
  if (request.kind === 'recent') {
    if (!ports.known.allows(request.path)) return { kind: 'failed', message: "That file isn't in your recent files." }
    path = request.path
  } else {
    try {
      const { canceled, filePaths } = await ports.chooseOpen({ defaultPath: startDir(request.near, ports), filters: [PATTERN_FILTER, ALL_FILES] })
      const [chosen] = filePaths
      if (canceled || chosen === undefined) return { kind: 'cancelled' }
      path = chosen
    } catch (error) {
      return { kind: 'failed', message: messageFor(error) }
    }
    ports.known.grant(path)
  }

  const name = bareName(path)
  try {
    const info = await ports.stat(path)
    if (!info.isFile) return { kind: 'failed', message: `${name} is a folder, not a pattern file.` }
    if (info.size > MAX_PATTERN_BYTES) return { kind: 'failed', message: `${name} is ${(info.size / 1024 / 1024).toFixed(1)} MB, far bigger than a pattern, so it wasn't opened.` }
    const data = await ports.readFile(path)
    // The stamp from before the read: a change in between shows up as a conflict at save, the safe side.
    ports.known.setStamp(path, stampOf(info))
    return { kind: 'read', file: documentFile(path), data }
  } catch (error) {
    const gone = codeOf(error) === 'ENOENT' || codeOf(error) === 'ENOTDIR'
    if (gone && request.kind === 'recent') {
      ports.known.forget(path)
      return { kind: 'failed', message: `${readMessage(error, name)} It's been removed from recent files.` }
    }
    return { kind: 'failed', message: readMessage(error, name) }
  }
}

/** Never rejects. */
export async function runSaveDocument(raw: unknown, ports: DocumentPorts): Promise<SaveDocumentResult> {
  const request = parseSave(raw)
  if (!request) return { kind: 'failed', message: 'Nothing to save.' }
  if (request.kind === 'choose') return saveAs(bareName(request.name) || 'Untitled', request.near, request.data, ports)

  const { path, data } = request
  if (!ports.known.allows(path)) return { kind: 'failed', message: 'Choose where to save with Save As.' }
  const name = bareName(path)
  try {
    // A file deleted since it was opened is written again, with no question.
    const now = await ports.stat(path).catch((error: unknown) => (codeOf(error) === 'ENOENT' ? null : Promise.reject(error)))
    if (now && !now.writable) return { kind: 'failed', message: `${name} is read-only. Use Save As to keep your changes somewhere else.` }
    const seen = ports.known.stampOf(path)
    if (now && seen && !sameStamp(stampOf(now), seen)) {
      const choice = await ports.askConflict(name)
      if (choice === 'cancel') return { kind: 'cancelled' }
      if (choice === 'save-as') return saveAs(documentFile(path).name, path, data, ports)
    }
    await ports.write(path, data)
  } catch (error) {
    return { kind: 'failed', message: messageFor(error) }
  }
  ports.known.setStamp(path, await stampAfterWrite(path, ports))
  return { kind: 'saved', file: documentFile(path) }
}

async function saveAs(name: string, near: string | null, data: Uint8Array, ports: DocumentPorts): Promise<SaveDocumentResult> {
  const result = await saveThroughDialog({ name: `${name}.json`, data, filter: PATTERN_FILTER, startDir: startDir(near, ports) }, { chooseFile: ports.chooseSave, write: ports.write })
  if (result.kind !== 'saved') return result
  ports.known.grant(result.path)
  ports.known.setStamp(result.path, await stampAfterWrite(result.path, ports))
  return { kind: 'saved', file: documentFile(result.path) }
}
