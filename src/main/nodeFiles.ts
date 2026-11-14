import { readFile, realpath, stat } from 'node:fs/promises'
import { writeAtomically } from './atomicWrite'
import type { FileInfo } from './documentFiles'

/** The filesystem half of DocumentPorts, on Node. main/index.ts and the tests share it. */

export async function statFile(path: string): Promise<FileInfo> {
  const info = await stat(path)
  // Windows reports its read-only attribute as a mode without write bits.
  return { isFile: info.isFile(), size: info.size, modifiedMs: info.mtimeMs, writable: (info.mode & 0o200) !== 0 }
}

export async function readBytes(path: string): Promise<Uint8Array> {
  const buffer = await readFile(path)
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

/** Writes through a symlink, so the link stays a link. A path that doesn't exist yet is written as given. */
export async function writeDocument(path: string, data: Uint8Array): Promise<void> {
  await writeAtomically(await realpath(path).catch(() => path), data)
}
