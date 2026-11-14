import type { SaveExportResult } from '../preload/api'

/**
 * What export and pattern files share in main: the words for filesystem errors, safe names, and the save-dialog routine.
 * No Electron import, so tests drive it with fake ports. Design: docs/design/m7-export.md decision 6, docs/design/m8-file-io.md.
 */

export interface FileFilter {
  readonly name: string
  readonly extensions: string[]
}

export interface SaveDialogPorts {
  readonly chooseFile: (options: { defaultPath: string; filters: FileFilter[] }) => Promise<{ canceled: boolean; filePath?: string | undefined }>
  readonly write: (path: string, data: Uint8Array) => Promise<void>
}

export const OPEN_ELSEWHERE = 'The file may be open in another program. Close it and try again.'

/** What a failed write means, by error code. */
export const WORDS: Readonly<Record<string, string>> = {
  ENOSPC: 'The disk is full.',
  EACCES: "You don't have permission to save there.",
  EPERM: OPEN_ELSEWHERE,
  EBUSY: OPEN_ELSEWHERE,
  EROFS: "That disk can't be written to.",
  ENOENT: "That folder doesn't exist any more."
}

export const codeOf = (error: unknown): string => (typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '')

/** The words for a failed write, else the error's own message. */
export function messageFor(error: unknown): string {
  const code = codeOf(error)
  if (Object.hasOwn(WORDS, code)) return WORDS[code] ?? code
  return error instanceof Error ? error.message : String(error)
}

/** The words for a failed read, naming the file. */
export function readMessage(error: unknown, fileName: string): string {
  switch (codeOf(error)) {
    case 'ENOENT':
    case 'ENOTDIR':
      return `${fileName} isn't there any more. It may have been moved, renamed or deleted.`
    case 'EACCES':
    case 'EPERM':
      return `You don't have permission to open ${fileName}.`
    case 'EISDIR':
      return `${fileName} is a folder, not a pattern file.`
    case 'EBUSY':
      return OPEN_ELSEWHERE
    default:
      return error instanceof Error ? error.message : String(error)
  }
}

/** The name after the last separator of either kind, on every OS, so the renderer can never name a directory. */
export function bareName(fileName: string): string {
  return fileName.split(/[/\\]/).pop() ?? ''
}

/** Everything before the last separator of either kind. */
export function folderOf(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at <= 0 ? path.slice(0, at + 1) : path.slice(0, at)
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** Joins without node:path, so the separator follows the folder's own style. */
export function inDirectory(directory: string, name: string): string {
  const separator = directory.includes('\\') && !directory.includes('/') ? '\\' : '/'
  return directory.endsWith(separator) ? `${directory}${name}` : `${directory}${separator}${name}`
}

/**
 * Asks where to save `name` with one filter, adds the extension back if the user removed it, writes, and says what went wrong.
 * `name` must already be bare and carry the filter's extension. Never rejects.
 */
export async function saveThroughDialog(
  file: { readonly name: string; readonly data: Uint8Array; readonly filter: FileFilter; readonly startDir: string },
  ports: SaveDialogPorts
): Promise<SaveExportResult> {
  const extension = extensionOf(file.name)
  try {
    const { canceled, filePath } = await ports.chooseFile({ defaultPath: inDirectory(file.startDir, file.name), filters: [file.filter] })
    if (canceled || !filePath) return { kind: 'cancelled' }
    const path = extensionOf(bareName(filePath)) === extension ? filePath : `${filePath}.${extension}`
    await ports.write(path, file.data)
    return { kind: 'saved', path }
  } catch (error) {
    return { kind: 'failed', message: messageFor(error) }
  }
}
