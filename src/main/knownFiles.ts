/**
 * The paths main has handed out, what it last saw of each on disk, and the recent list. The one owner of all three, so the
 * renderer can only name a file main gave it. No Electron import. Design: docs/design/m8-file-io.md, decisions 9 and 15.
 */

export const RECENT_LIMIT = 10
const STORE_VERSION = 1

/** What main last saw of a file on disk. Never crosses the bridge. */
export interface FileStamp {
  readonly modifiedMs: number
  readonly size: number
}

export const sameStamp = (a: FileStamp, b: FileStamp): boolean => a.modifiedMs === b.modifiedMs && a.size === b.size

/** What makes two paths the same file: NFC everywhere, and case-insensitive on macOS and Windows, where `/` also means `\`. */
export function fileKey(path: string, platform: NodeJS.Platform): string {
  const normal = path.normalize('NFC')
  if (platform === 'win32') return normal.replaceAll('/', '\\').toLowerCase()
  if (platform === 'darwin') return normal.toLowerCase()
  return normal
}

/** `path` first. An older spelling of the same file goes. At most RECENT_LIMIT. */
export function withRecent(list: readonly string[], path: string, platform: NodeJS.Platform): readonly string[] {
  return [path, ...withoutRecent(list, path, platform)].slice(0, RECENT_LIMIT)
}

export function withoutRecent(list: readonly string[], path: string, platform: NodeJS.Platform): readonly string[] {
  const key = fileKey(path, platform)
  return list.filter((entry) => fileKey(entry, platform) !== key)
}

function isAbsolute(path: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' ? /^([a-zA-Z]:[\\/]|\\\\)/.test(path) : path.startsWith('/')
}

/** Total. Missing, malformed, another version or the wrong shape gives []. Keeps absolute path strings only, deduplicated and capped. */
export function parseRecents(text: string | null, platform: NodeJS.Platform): readonly string[] {
  if (text === null) return []
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return []
  }
  if (typeof json !== 'object' || json === null || !('version' in json) || json.version !== STORE_VERSION || !('files' in json) || !Array.isArray(json.files)) return []
  const paths = json.files.filter((entry): entry is string => typeof entry === 'string' && isAbsolute(entry, platform))
  return paths.reduceRight<readonly string[]>((list, path) => withRecent(list, path, platform), [])
}

export interface KnownFiles {
  /** Newest first. */
  recents(): readonly string[]
  /** Chosen in a dialog this session, or on the recent list. The only gate on paths from the renderer. */
  allows(path: string): boolean
  /** A dialog handed out this path. */
  grant(path: string): void
  stampOf(path: string): FileStamp | null
  setStamp(path: string, stamp: FileStamp | null): void
  /** The window shows this file now: it goes to the top of the recent list. */
  showing(path: string): void
  /** Gone from disk: it leaves the recent list. */
  forget(path: string): void
  /** Clear Menu. */
  clearRecents(): void
  /** Resolves when every change so far is on disk. */
  flush(): Promise<void>
}

export interface KnownFilesPorts {
  readonly load: () => Promise<string | null>
  readonly write: (data: Uint8Array) => Promise<void>
  readonly platform: NodeJS.Platform
  /** The recent list changed: rebuild the menu. */
  readonly onChange: () => void
  readonly log?: (message: string) => void
}

export async function createKnownFiles(ports: KnownFilesPorts): Promise<KnownFiles> {
  const { platform } = ports
  const key = (path: string): string => fileKey(path, platform)
  let recents = parseRecents(await ports.load().catch(() => null), platform)
  const granted = new Set<string>()
  const stamps = new Map<string, FileStamp>()
  let queue: Promise<void> = Promise.resolve()

  const setRecents = (next: readonly string[]): void => {
    if (next.length === recents.length && next.every((path, i) => path === recents[i])) return
    recents = next
    ports.onChange()
    // Each write takes the list as it is when its turn comes, so the newest list always lands last.
    queue = queue
      .then(() => ports.write(new TextEncoder().encode(`${JSON.stringify({ version: STORE_VERSION, files: recents }, null, 2)}\n`)))
      .catch((error: unknown) => ports.log?.(`Couldn't save recent files: ${String(error)}`))
  }

  return {
    recents: () => recents,
    allows: (path) => granted.has(key(path)) || recents.some((entry) => key(entry) === key(path)),
    grant: (path) => void granted.add(key(path)),
    stampOf: (path) => stamps.get(key(path)) ?? null,
    setStamp: (path, stamp) => void (stamp ? stamps.set(key(path), stamp) : stamps.delete(key(path))),
    showing: (path) => {
      granted.add(key(path))
      setRecents(withRecent(recents, path, platform))
    },
    forget: (path) => setRecents(withoutRecent(recents, path, platform)),
    clearRecents: () => setRecents([]),
    flush: () => queue
  }
}
