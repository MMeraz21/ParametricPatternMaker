import { describe, expect, it, vi } from 'vitest'
import { createKnownFiles, fileKey, parseRecents, RECENT_LIMIT, withRecent, type KnownFilesPorts } from './knownFiles'

const store = (paths: readonly unknown[]) => JSON.stringify({ version: 1, files: paths })

function ports(stored: string | null, platform: NodeJS.Platform = 'linux') {
  const written: string[] = []
  const fake = {
    load: async () => stored,
    write: vi.fn<KnownFilesPorts['write']>(async (data) => void written.push(new TextDecoder().decode(data))),
    platform,
    onChange: vi.fn()
  }
  return { fake, written }
}

describe('fileKey', () => {
  const nfd = 'Cafe\u0301.json'
  const nfc = 'Caf\u00e9.json'
  it.each<[NodeJS.Platform, string, string, boolean]>([
    ['darwin', `/Users/me/${nfd}`, `/users/ME/${nfc}`, true],
    ['win32', 'C:/Patterns/Tee.json', 'c:\\patterns\\TEE.json', true],
    ['linux', '/home/me/Tee.json', '/home/me/tee.json', false],
    ['linux', `/home/me/${nfd}`, `/home/me/${nfc}`, true]
  ])('on %s, %s and %s are the same file: %s', (platform, a, b, same) => {
    expect(fileKey(a, platform) === fileKey(b, platform)).toBe(same)
  })
})

describe('withRecent', () => {
  it('puts the path first, keeps the newest spelling, and caps the list', () => {
    expect(withRecent(['/a', '/B', '/c'], '/b', 'darwin')).toEqual(['/b', '/a', '/c'])
    const many = Array.from({ length: RECENT_LIMIT }, (_, i) => `/f${i}`)
    expect(withRecent(many, '/new', 'linux')).toEqual(['/new', ...many.slice(0, RECENT_LIMIT - 1)])
  })
})

describe('parseRecents', () => {
  it.each([null, '', 'not json', '[]', '{}', JSON.stringify({ version: 1, files: 'x' }), JSON.stringify({ version: 2, files: ['/a'] })])('gives nothing for %j', (text) => {
    expect(parseRecents(text as string | null, 'linux')).toEqual([])
  })

  it('keeps absolute paths only, in order, without repeats, capped', () => {
    expect(parseRecents(store(['/a', 'relative.json', 3, '/b', '/a']), 'linux')).toEqual(['/a', '/b'])
    expect(parseRecents(store(['C:\\x.json', '\\\\server\\y.json', '/z.json']), 'win32')).toEqual(['C:\\x.json', '\\\\server\\y.json'])
    expect(parseRecents(store(Array.from({ length: 15 }, (_, i) => `/f${i}`)), 'linux')).toHaveLength(RECENT_LIMIT)
  })
})

describe('createKnownFiles', () => {
  it('allows recent and granted paths only, by file key', async () => {
    const known = await createKnownFiles(ports(store(['/Users/me/Raglan.json']), 'darwin').fake)
    expect(known.allows('/users/me/raglan.json')).toBe(true)
    expect(known.allows('/etc/passwd')).toBe(false)
    known.grant('/tmp/New.json')
    expect(known.allows('/tmp/new.json')).toBe(true)
  })

  it('moves a shown file to the top, writes the list, and tells the menu', async () => {
    const { fake, written } = ports(store(['/a', '/b']))
    const known = await createKnownFiles(fake)
    known.showing('/b')
    await known.flush()
    expect(known.recents()).toEqual(['/b', '/a'])
    expect(JSON.parse(written.at(-1) ?? '')).toEqual({ version: 1, files: ['/b', '/a'] })
    expect(fake.onChange).toHaveBeenCalledTimes(1)
  })

  it('writes nothing when nothing changed', async () => {
    const { fake } = ports(store(['/a']))
    const known = await createKnownFiles(fake)
    known.showing('/a')
    await known.flush()
    expect(fake.write).not.toHaveBeenCalled()
  })

  it('leaves the newest list on disk when two changes are close together', async () => {
    const { fake, written } = ports(null)
    let release = (): void => undefined
    let started = (): void => undefined
    const writing = new Promise<void>((resolve) => (started = resolve))
    fake.write.mockImplementationOnce(async (data) => {
      started()
      await new Promise<void>((resolve) => (release = resolve))
      written.push(new TextDecoder().decode(data))
    })
    const known = await createKnownFiles(fake)
    known.showing('/a')
    await writing
    known.showing('/b')
    release()
    await known.flush()
    expect(JSON.parse(written.at(-1) ?? '').files).toEqual(['/b', '/a'])
  })

  it('forgets a path, keeps going when the store cannot be written, and survives an unreadable store', async () => {
    const log = vi.fn()
    const known = await createKnownFiles({ ...ports(null).fake, load: async () => Promise.reject(new Error('EACCES')), write: async () => Promise.reject(new Error('disk')), log })
    known.showing('/a')
    known.showing('/b')
    known.forget('/a')
    await known.flush()
    expect(known.recents()).toEqual(['/b'])
    expect(log).toHaveBeenCalled()
  })

  it('keeps stamps by file key, and clears the recent list', async () => {
    const known = await createKnownFiles(ports(store(['C:\\A.json']), 'win32').fake)
    known.setStamp('C:\\A.json', { modifiedMs: 1, size: 2 })
    expect(known.stampOf('c:/a.json')).toEqual({ modifiedMs: 1, size: 2 })
    known.clearRecents()
    expect(known.recents()).toEqual([])
  })
})
