import { describe, expect, it, vi } from 'vitest'
import { folderOf, messageFor, readMessage, saveThroughDialog } from './files'

const failing = (code: string) => Object.assign(new Error('raw'), { code })

describe('readMessage', () => {
  it.each([
    ['ENOENT', "Raglan.json isn't there any more. It may have been moved, renamed or deleted."],
    ['ENOTDIR', "Raglan.json isn't there any more. It may have been moved, renamed or deleted."],
    ['EACCES', "You don't have permission to open Raglan.json."],
    ['EPERM', "You don't have permission to open Raglan.json."],
    ['EISDIR', 'Raglan.json is a folder, not a pattern file.'],
    ['EBUSY', 'The file may be open in another program. Close it and try again.'],
    ['EWHAT', 'raw']
  ])('says what %s means, naming the file', (code, message) => {
    expect(readMessage(failing(code), 'Raglan.json')).toBe(message)
  })
})

describe('messageFor', () => {
  it('uses the export words, and passes anything else on', () => {
    expect(messageFor(failing('ENOSPC'))).toBe('The disk is full.')
    expect(messageFor(failing('constructor'))).toBe('raw')
    expect(messageFor('plain')).toBe('plain')
  })
})

describe('folderOf', () => {
  it.each([
    ['/Users/me/Raglan.json', '/Users/me'],
    ['C:\\Users\\me\\Raglan.json', 'C:\\Users\\me'],
    ['/Raglan.json', '/'],
    ['Raglan.json', '']
  ])('gives the folder of %s', (path, folder) => {
    expect(folderOf(path)).toBe(folder)
  })
})

describe('saveThroughDialog', () => {
  const filter = { name: 'Pattern', extensions: ['json'] }
  const data = new Uint8Array([123, 125])

  it('starts in the given folder, adds the extension back, and writes there', async () => {
    const chooseFile = vi.fn(async () => ({ canceled: false, filePath: 'C:\\Patterns\\Mine' }))
    const write = vi.fn(async () => undefined)
    expect(await saveThroughDialog({ name: 'Raglan.json', data, filter, startDir: 'C:\\Patterns' }, { chooseFile, write })).toEqual({ kind: 'saved', path: 'C:\\Patterns\\Mine.json' })
    expect(chooseFile).toHaveBeenCalledWith({ defaultPath: 'C:\\Patterns\\Raglan.json', filters: [filter] })
    expect(write).toHaveBeenCalledWith('C:\\Patterns\\Mine.json', data)
  })

  it('says what a failed write means', async () => {
    const result = await saveThroughDialog({ name: 'a.json', data, filter, startDir: '/tmp' }, { chooseFile: async () => ({ canceled: false, filePath: '/tmp/a.json' }), write: async () => Promise.reject(failing('EROFS')) })
    expect(result).toEqual({ kind: 'failed', message: "That disk can't be written to." })
  })
})
