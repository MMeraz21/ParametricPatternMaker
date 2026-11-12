import { chmod, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeAtomically } from './atomicWrite'

const folder = (): Promise<string> => mkdtemp(join(tmpdir(), 'atomic-write-'))

describe('writeAtomically', () => {
  it('writes a new file and replaces an existing one, leaving nothing else behind', async () => {
    const dir = await folder()
    const target = join(dir, 'a.pdf')
    await writeAtomically(target, new Uint8Array([1, 2, 3]))
    await writeAtomically(target, new Uint8Array([4, 5]))
    expect([...(await readFile(target))]).toEqual([4, 5])
    expect(await readdir(dir)).toEqual(['a.pdf'])
  })

  it('rejects for a missing folder', async () => {
    const dir = await folder()
    await expect(writeAtomically(join(dir, 'missing', 'a.pdf'), new Uint8Array([1]))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('leaves the original bytes and no temporary file when it cannot write', async () => {
    const dir = await folder()
    const target = join(dir, 'a.pdf')
    await writeFile(target, new Uint8Array([9]))
    await chmod(dir, 0o500)
    try {
      await expect(writeAtomically(target, new Uint8Array([1]))).rejects.toMatchObject({ code: 'EACCES' })
    } finally {
      await chmod(dir, 0o700)
    }
    expect([...(await readFile(target))]).toEqual([9])
    expect(await readdir(dir)).toEqual(['a.pdf'])
  })
})
