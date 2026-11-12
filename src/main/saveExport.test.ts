import { describe, expect, it, vi } from 'vitest'
import { runSaveExport, type SaveExportPorts } from './saveExport'

const data = new Uint8Array([37, 80, 68, 70])

function ports(choose: Awaited<ReturnType<SaveExportPorts['chooseFile']>>, write: SaveExportPorts['write'] = async () => undefined) {
  const chooseFile = vi.fn<SaveExportPorts['chooseFile']>(async () => choose)
  const writeSpy = vi.fn(write)
  return { chooseFile, write: writeSpy, documentsDir: '/home/me/Documents' }
}

describe('runSaveExport', () => {
  it('suggests the file name in the documents folder, with one filter for its format, and saves where the user chose', async () => {
    const fake = ports({ canceled: false, filePath: '/tmp/out.pdf' })
    expect(await runSaveExport({ fileName: 'Raglan-M-letter.pdf', data }, fake)).toEqual({ kind: 'saved', path: '/tmp/out.pdf' })
    expect(fake.chooseFile).toHaveBeenCalledWith({ defaultPath: '/home/me/Documents/Raglan-M-letter.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    expect(fake.write).toHaveBeenCalledWith('/tmp/out.pdf', data)
  })

  it('joins a Windows documents folder with a backslash', async () => {
    const fake = { ...ports({ canceled: true }), documentsDir: 'C:\\Users\\me\\Documents' }
    await runSaveExport({ fileName: 'Raglan.svg', data }, fake)
    expect(fake.chooseFile.mock.calls[0]?.[0].defaultPath).toBe('C:\\Users\\me\\Documents\\Raglan.svg')
  })

  it.each([null, 'x', {}, { fileName: 'a.pdf' }, { fileName: 3, data }, { fileName: 'a.pdf', data: [1, 2] }])('fails %j before any dialog', async (raw) => {
    const fake = ports({ canceled: false, filePath: '/tmp/x.pdf' })
    expect((await runSaveExport(raw, fake)).kind).toBe('failed')
    expect(fake.chooseFile).not.toHaveBeenCalled()
  })

  it.each(['notes.txt', 'noextension', 'evil.exe'])('refuses to save %s', async (fileName) => {
    const fake = ports({ canceled: false, filePath: '/tmp/x' })
    expect((await runSaveExport({ fileName, data }, fake)).kind).toBe('failed')
    expect(fake.chooseFile).not.toHaveBeenCalled()
  })

  it.each(['../../etc/Raglan.pdf', '..\\..\\Windows\\Raglan.pdf', 'C:\\Raglan.pdf'])('never lets %s name a directory', async (fileName) => {
    const fake = ports({ canceled: true })
    await runSaveExport({ fileName, data }, fake)
    expect(fake.chooseFile.mock.calls[0]?.[0].defaultPath).toBe('/home/me/Documents/Raglan.pdf')
  })

  it('writes nothing when the user cancels', async () => {
    const fake = ports({ canceled: true })
    expect(await runSaveExport({ fileName: 'a.pdf', data }, fake)).toEqual({ kind: 'cancelled' })
    expect(fake.write).not.toHaveBeenCalled()
  })

  it('adds the extension back if the user removed it', async () => {
    const fake = ports({ canceled: false, filePath: '/tmp/mine' })
    expect(await runSaveExport({ fileName: 'a.svg', data }, fake)).toEqual({ kind: 'saved', path: '/tmp/mine.svg' })
  })

  it.each([
    ['ENOSPC', 'The disk is full.'],
    ['EACCES', "You don't have permission to save there."],
    ['EPERM', 'The file may be open in another program. Close it and try again.'],
    ['EBUSY', 'The file may be open in another program. Close it and try again.'],
    ['EROFS', "That disk can't be written to."],
    ['ENOENT', "That folder doesn't exist any more."]
  ])('says what %s means', async (code, message) => {
    const fake = ports({ canceled: false, filePath: '/tmp/a.pdf' }, async () => {
      throw Object.assign(new Error('raw'), { code })
    })
    expect(await runSaveExport({ fileName: 'a.pdf', data }, fake)).toEqual({ kind: 'failed', message })
  })

  it('passes on any other error, and a failing dialog', async () => {
    const write = ports({ canceled: false, filePath: '/tmp/a.pdf' }, async () => {
      throw new Error('something odd')
    })
    expect(await runSaveExport({ fileName: 'a.pdf', data }, write)).toEqual({ kind: 'failed', message: 'something odd' })
    const dialog = { ...ports({ canceled: true }), chooseFile: async () => Promise.reject(new Error('no window')) }
    expect(await runSaveExport({ fileName: 'a.pdf', data }, dialog)).toEqual({ kind: 'failed', message: 'no window' })
  })
})
