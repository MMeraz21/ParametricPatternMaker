import { readFile, stat } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { staleRecents } from './staleRecents'

const data = new TextEncoder().encode('{}\n')

describe('staleRecents', () => {
  it('lists four files, of which one is still there, one was renamed, one deleted and one became a folder', async () => {
    const fixture = await staleRecents(data)
    expect(fixture.listed).toEqual([fixture.kept, fixture.renamed.listed, fixture.deleted, fixture.becameFolder])
    expect([...(await readFile(fixture.kept))]).toEqual([...data])
    expect([...(await readFile(fixture.renamed.now))]).toEqual([...data])
    await expect(stat(fixture.renamed.listed)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(fixture.deleted)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await stat(fixture.becameFolder)).isDirectory()).toBe(true)
  })
})
