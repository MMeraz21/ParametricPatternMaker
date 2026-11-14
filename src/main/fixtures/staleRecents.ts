import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The fourth M8 hazard: files on the recent list that have changed since they were listed. Real files in a fresh temp
 * folder, because the hazard is the filesystem itself. docs/design/m8-file-io.md, decisions 9 and 16.
 */
export interface StaleRecents {
  readonly folder: string
  /** Still there. Opens. */
  readonly kept: string
  /** Listed under `listed`, now at `now`. Opening `listed` fails with ENOENT and drops the entry. */
  readonly renamed: { readonly listed: string; readonly now: string }
  /** Gone. Opening it fails with ENOENT and drops the entry. */
  readonly deleted: string
  /** Replaced by a folder of the same name. Refused as a folder, and kept on the list. */
  readonly becameFolder: string
  /** The recent list as it was saved, newest first. */
  readonly listed: readonly string[]
}

/** `data` is what each file held when it was listed. The caller passes it, so main code never needs `@core`. */
export async function staleRecents(data: Uint8Array): Promise<StaleRecents> {
  const folder = await mkdtemp(join(tmpdir(), 'ppm-recents-'))
  const path = (name: string): string => join(folder, name)
  const kept = path('Kept.json')
  const renamed = { listed: path('Moved.json'), now: path('Moved (renamed).json') }
  const deleted = path('Gone.json')
  const becameFolder = path('Folder.json')
  for (const file of [kept, renamed.listed, deleted, becameFolder]) await writeFile(file, data)
  await rename(renamed.listed, renamed.now)
  await rm(deleted)
  await rm(becameFolder)
  await mkdir(becameFolder)
  return { folder, kept, renamed, deleted, becameFolder, listed: [kept, renamed.listed, deleted, becameFolder] }
}
