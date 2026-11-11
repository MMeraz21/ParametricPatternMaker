import { randomBytes } from 'node:crypto'
import { rm, writeFile, rename } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/**
 * Writes beside the target, then renames over it, so a failed write leaves an existing file untouched.
 * Removes its temporary file on failure, and rejects with the original error.
 */
export async function writeAtomically(target: string, data: Uint8Array): Promise<void> {
  const temporary = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    await writeFile(temporary, data, { flag: 'wx' })
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}
