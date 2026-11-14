import { chmod, lstat, mkdtemp, readFile, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MAX_PATTERN_BYTES, runOpenDocument, runSaveDocument, type DocumentPorts } from './documentFiles'
import { staleRecents } from './fixtures/staleRecents'
import { createKnownFiles } from './knownFiles'
import { readBytes, statFile, writeDocument } from './nodeFiles'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const folder = (): Promise<string> => mkdtemp(join(tmpdir(), 'ppm-documents-'))
const text = async (path: string): Promise<string> => readFile(path, 'utf8')

async function portsWith(options: { recents?: readonly string[]; open?: string; save?: string; conflict?: 'replace' | 'save-as' | 'cancel' } = {}) {
  const known = await createKnownFiles({
    load: async () => JSON.stringify({ version: 1, files: options.recents ?? [] }),
    write: async () => undefined,
    platform: process.platform,
    onChange: () => undefined
  })
  const ports = {
    chooseOpen: vi.fn<DocumentPorts['chooseOpen']>(async () => (options.open ? { canceled: false, filePaths: [options.open] } : { canceled: true, filePaths: [] })),
    chooseSave: vi.fn<DocumentPorts['chooseSave']>(async () => (options.save ? { canceled: false, filePath: options.save } : { canceled: true })),
    stat: statFile,
    readFile: readBytes,
    write: vi.fn<DocumentPorts['write']>(writeDocument),
    askConflict: vi.fn<DocumentPorts['askConflict']>(async () => options.conflict ?? 'cancel'),
    known,
    documentsDir: '/home/me/Documents'
  } satisfies DocumentPorts
  return ports
}

describe('runOpenDocument', () => {
  it.each([null, 'x', {}, { kind: 'recent' }, { kind: 'choose' }, { kind: 'recent', path: 3 }])('fails %j before any dialog', async (raw) => {
    const ports = await portsWith()
    expect(await runOpenDocument(raw, ports)).toEqual({ kind: 'failed', message: 'Nothing to open.' })
    expect(ports.chooseOpen).not.toHaveBeenCalled()
  })

  it('reads the chosen file as bytes, names it, and allows saving back to it', async () => {
    const dir = await folder()
    const path = join(dir, 'Raglan.JSON')
    await writeFile(path, '{}')
    const ports = await portsWith({ open: path })
    expect(await runOpenDocument({ kind: 'choose', near: null }, ports)).toEqual({ kind: 'read', file: { path, name: 'Raglan' }, data: bytes('{}') })
    expect(ports.chooseOpen.mock.calls[0]?.[0]).toEqual({ defaultPath: '/home/me/Documents', filters: [{ name: 'Pattern', extensions: ['json'] }, { name: 'All files', extensions: ['*'] }] })
    expect(ports.known.allows(path)).toBe(true)
  })

  it('starts the dialog in the open file’s folder', async () => {
    const ports = await portsWith()
    await runOpenDocument({ kind: 'choose', near: '/home/me/Patterns/Tee.json' }, ports)
    expect(ports.chooseOpen.mock.calls[0]?.[0].defaultPath).toBe('/home/me/Patterns')
  })

  it('does nothing when the dialog is cancelled', async () => {
    expect(await runOpenDocument({ kind: 'choose', near: null }, await portsWith())).toEqual({ kind: 'cancelled' })
  })

  it('refuses a recent path that is not on the list', async () => {
    expect(await runOpenDocument({ kind: 'recent', path: '/etc/passwd' }, await portsWith())).toEqual({ kind: 'failed', message: "That file isn't in your recent files." })
  })

  it('opens a recent file that is still there', async () => {
    const stale = await staleRecents(bytes('{}'))
    const result = await runOpenDocument({ kind: 'recent', path: stale.kept }, await portsWith({ recents: stale.listed }))
    expect(result).toMatchObject({ kind: 'read', file: { path: stale.kept, name: 'Kept' } })
  })

  it.each(['renamed', 'deleted'] as const)('drops a recent file that was %s, and says so', async (which) => {
    const stale = await staleRecents(bytes('{}'))
    const path = which === 'renamed' ? stale.renamed.listed : stale.deleted
    const name = which === 'renamed' ? 'Moved.json' : 'Gone.json'
    const ports = await portsWith({ recents: stale.listed })
    expect(await runOpenDocument({ kind: 'recent', path }, ports)).toEqual({
      kind: 'failed',
      message: `${name} isn't there any more. It may have been moved, renamed or deleted. It's been removed from recent files.`
    })
    expect(ports.known.recents()).not.toContain(path)
    expect(ports.known.recents()).toHaveLength(stale.listed.length - 1)
  })

  it('refuses a recent file that became a folder, and keeps it listed', async () => {
    const stale = await staleRecents(bytes('{}'))
    const ports = await portsWith({ recents: stale.listed })
    expect(await runOpenDocument({ kind: 'recent', path: stale.becameFolder }, ports)).toEqual({ kind: 'failed', message: 'Folder.json is a folder, not a pattern file.' })
    expect(ports.known.recents()).toContain(stale.becameFolder)
  })

  it('refuses a file too big to be a pattern without reading it', async () => {
    const dir = await folder()
    const path = join(dir, 'Huge.json')
    await writeFile(path, new Uint8Array(MAX_PATTERN_BYTES + 1))
    const ports = { ...(await portsWith({ open: path })), readFile: vi.fn(readBytes) }
    expect(await runOpenDocument({ kind: 'choose', near: null }, ports)).toEqual({ kind: 'failed', message: "Huge.json is 16.0 MB, far bigger than a pattern, so it wasn't opened." })
    expect(ports.readFile).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('says when a file can’t be read', async () => {
    const dir = await folder()
    const path = join(dir, 'Locked.json')
    await writeFile(path, '{}')
    await chmod(path, 0o000)
    expect(await runOpenDocument({ kind: 'choose', near: null }, await portsWith({ open: path }))).toEqual({ kind: 'failed', message: "You don't have permission to open Locked.json." })
  })
})

describe('runSaveDocument', () => {
  async function opened(content = 'old') {
    const dir = await folder()
    const path = join(dir, 'Raglan.json')
    await writeFile(path, content)
    return { dir, path }
  }

  async function openedWithPorts(options: Parameters<typeof portsWith>[0] = {}) {
    const { dir, path } = await opened()
    const ports = await portsWith({ open: path, ...options })
    expect(await runOpenDocument({ kind: 'choose', near: null }, ports)).toMatchObject({ kind: 'read' })
    return { dir, path, ports }
  }

  it.each([null, {}, { kind: 'overwrite', path: '/a.json' }, { kind: 'choose', name: 'a', data: bytes('x') }, { kind: 'overwrite', path: '/a.json', data: [1] }])('fails %j before any dialog', async (raw) => {
    const ports = await portsWith()
    expect(await runSaveDocument(raw, ports)).toEqual({ kind: 'failed', message: 'Nothing to save.' })
    expect(ports.chooseSave).not.toHaveBeenCalled()
  })

  it('writes an opened file in place, with no dialog and no question', async () => {
    const { path, ports } = await openedWithPorts()
    expect(await runSaveDocument({ kind: 'overwrite', path, data: bytes('new') }, ports)).toEqual({ kind: 'saved', file: { path, name: 'Raglan' } })
    expect(await text(path)).toBe('new')
    expect(ports.chooseSave).not.toHaveBeenCalled()
    expect(ports.askConflict).not.toHaveBeenCalled()
    // Saving twice uses the stamp from the first save, so it doesn't look like another program's change.
    expect(await runSaveDocument({ kind: 'overwrite', path, data: bytes('newer') }, ports)).toMatchObject({ kind: 'saved' })
    expect(ports.askConflict).not.toHaveBeenCalled()
  })

  it('refuses to overwrite a path main never handed out', async () => {
    const { path } = await opened()
    expect(await runSaveDocument({ kind: 'overwrite', path, data: bytes('x') }, await portsWith())).toEqual({ kind: 'failed', message: 'Choose where to save with Save As.' })
    expect(await text(path)).toBe('old')
  })

  async function changedElsewhere(path: string): Promise<void> {
    await writeFile(path, 'theirs!')
    await utimes(path, new Date(), new Date(Date.now() + 5000))
  }

  it('asks when another program changed the file, and Cancel writes nothing', async () => {
    const { path, ports } = await openedWithPorts({ conflict: 'cancel' })
    await changedElsewhere(path)
    expect(await runSaveDocument({ kind: 'overwrite', path, data: bytes('mine') }, ports)).toEqual({ kind: 'cancelled' })
    expect(ports.askConflict).toHaveBeenCalledWith('Raglan.json')
    expect(await text(path)).toBe('theirs!')
  })

  it('replaces it when the user says Replace', async () => {
    const { path, ports } = await openedWithPorts({ conflict: 'replace' })
    await changedElsewhere(path)
    expect(await runSaveDocument({ kind: 'overwrite', path, data: bytes('mine') }, ports)).toMatchObject({ kind: 'saved', file: { path } })
    expect(await text(path)).toBe('mine')
  })

  it('saves somewhere else when the user says Save As, and leaves their file alone', async () => {
    const { dir, path, ports } = await openedWithPorts({ conflict: 'save-as', save: '' })
    const other = join(dir, 'Mine.json')
    ports.chooseSave.mockResolvedValue({ canceled: false, filePath: other })
    await changedElsewhere(path)
    expect(await runSaveDocument({ kind: 'overwrite', path, data: bytes('mine') }, ports)).toEqual({ kind: 'saved', file: { path: other, name: 'Mine' } })
    expect(ports.chooseSave.mock.calls[0]?.[0].defaultPath).toBe(join(dir, 'Raglan.json'))
    expect([await text(path), await text(other)]).toEqual(['theirs!', 'mine'])
  })

  it('writes a file again that was deleted since it was opened', async () => {
    const { path, ports } = await openedWithPorts()
    await import('node:fs/promises').then(({ rm }) => rm(path))
    expect(await runSaveDocument({ kind: 'overwrite', path, data: bytes('back') }, ports)).toMatchObject({ kind: 'saved' })
    expect(await text(path)).toBe('back')
  })

  it.skipIf(process.platform === 'win32')('refuses a read-only file instead of replacing it', async () => {
    const { path, ports } = await openedWithPorts()
    await chmod(path, 0o444)
    expect(await runSaveDocument({ kind: 'overwrite', path, data: bytes('x') }, ports)).toEqual({ kind: 'failed', message: 'Raglan.json is read-only. Use Save As to keep your changes somewhere else.' })
    expect(await text(path)).toBe('old')
  })

  it.skipIf(process.platform === 'win32')('writes through a symlink, so the link stays a link', async () => {
    const { dir, path } = await opened()
    const link = join(dir, 'Link.json')
    await symlink(path, link)
    const ports = await portsWith({ open: link })
    await runOpenDocument({ kind: 'choose', near: null }, ports)
    expect(await runSaveDocument({ kind: 'overwrite', path: link, data: bytes('through') }, ports)).toMatchObject({ kind: 'saved' })
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    expect(await text(path)).toBe('through')
  })

  it('uses the export words when a write fails', async () => {
    const { path, ports } = await openedWithPorts()
    ports.write.mockRejectedValueOnce(Object.assign(new Error('raw'), { code: 'ENOSPC' }))
    expect(await runSaveDocument({ kind: 'overwrite', path, data: bytes('x') }, ports)).toEqual({ kind: 'failed', message: 'The disk is full.' })
    expect(await text(path)).toBe('old')
  })

  it('Save As suggests the name in the open file’s folder, adds .json, and allows the new path', async () => {
    const dir = await folder()
    const chosen = join(dir, 'Tee')
    const ports = await portsWith({ save: chosen })
    expect(await runSaveDocument({ kind: 'choose', name: '../Tee', near: join(dir, 'Old.json'), data: bytes('{}') }, ports)).toEqual({
      kind: 'saved',
      file: { path: `${chosen}.json`, name: 'Tee' }
    })
    expect(ports.chooseSave.mock.calls[0]?.[0]).toEqual({ defaultPath: join(dir, 'Tee.json'), filters: [{ name: 'Pattern', extensions: ['json'] }] })
    expect(ports.known.allows(`${chosen}.json`)).toBe(true)
    expect(await text(`${chosen}.json`)).toBe('{}')
  })

  it('Save As of Untitled starts in Documents and writes nothing when cancelled', async () => {
    const ports = await portsWith()
    expect(await runSaveDocument({ kind: 'choose', name: 'Untitled', near: null, data: bytes('{}') }, ports)).toEqual({ kind: 'cancelled' })
    expect(ports.chooseSave.mock.calls[0]?.[0].defaultPath).toBe('/home/me/Documents/Untitled.json')
    expect(ports.write).not.toHaveBeenCalled()
  })
})
