# Milestone 8: file I/O

Status: built. Unit tests and the `file-io` journey pass on macOS, and every earlier journey still passes with the new teardown.

Changes found while building:

- `answerOf` and `Prompt` keep each native prompt's buttons and answers together (`askToSavePrompt`, `conflictPrompt`), in place of
  `askToSaveOptions` and `conflictOptions`.
- Node ports live in `main/nodeFiles.ts`, shared by `index.ts` and the tests.
- `KnownFiles` gained `clearRecents` and `flush`.
- The renderer reads the bridge types through `file/bridge.ts`, aliases off `Window['api']`, as `export/stage.ts` does.
- After the last window closes, Playwright can't report the app's process, so `run.mjs` guards that lookup.
- The three unverified assumptions held: `blur()` commits a cell before the command reads it, `destroy()` skips the close question,
  and `MenuItem.click()` from `app.evaluate` runs the item's handler.

Numbers marked **ran** come from throwaway experiments on an Apple-silicon Mac on 2026-11-13. They ran against the real `src/core`, zod
4.6.7, Node 24.4 and the repo's Electron 45.1.0 binary, in the two design candidates' scratch folders. Numbers marked **unverified** are general
knowledge nobody executed here. Product decisions with a working default are in `docs/open-questions.md` under "(from M8)".

## Problem

M8 opens and saves the pattern as a JSON file, keeps a recent-files list, and warns before closing or opening another file while there are
unsaved edits. Eight facts make the shape non-obvious.

- **`parsePattern` loses data today.** It accepts `version: 2`, and zod drops keys it doesn't know (**ran**: `{ ...raglanTee, version: 2 }`
  parses, and a `lining` key on a piece is gone after parsing). If you open a newer file and save it, its new data is deleted without a word.
  The `unknownField` and `newerVersion` fixtures pin this.
- **The document and the disk are in different processes.** The pattern lives in the renderer's reducer, and only main may touch the
  filesystem. Main doesn't import `@core` (M7 decision 6), so main can't parse or build a pattern file.
- **Close is decided in main, synchronously,** in the window's `close` event. But unsaved edits are renderer state, and so is a half-typed
  formula, which commits only on Enter or blur (`EditableTable.tsx`, `Inspector.tsx`). Clicking a native menu or the close button doesn't blur the input.
- **A prevented close cancels a quit.** In Electron 45.1 the first `app.quit()` fired `before-quit` and then `close`, the window survived, and
  `will-quit` never came. A second `app.quit()` went through (**ran**).
- **Saving is async, and editing isn't paused.** An edit can land while a write is in flight, and two saves to one path race on `rename`.
- **There is no undo yet,** but PLAN.md plans a command stack over patterns. Saving must not touch that history, and undoing back to what's on
  disk should count as saved.
- **`rename` over a path replaces what's there.** A symlink becomes a plain file, and a read-only file is replaced and comes out writable
  (**ran**, both: after `chmod 444` the replaced file was `644`). That's fine for exports, but wrong for a document.
- **Every existing journey ends with unsaved edits,** and the runner tears down with `app.close()` (`run.mjs:173`). A close guard would hang every
  journey on its prompt.

Constraints kept:
- `src/core` has no Node, Electron or UI imports.
- Main writes with `writeAtomically` and the existing error words.
- The renderer stays sandboxed.
- Every untrusted file goes through `parsePattern`.
- Nothing shipped depends on one OS.

`model.ts` changes (decision 2), so `/blast-radius` runs before it ships.

## Usage (caller's view)

The renderer does every file action with one call. The native menu, its shortcuts and the window's close button all end up there.

```tsx
// renderer/src/App.tsx
const [store] = useState(() => createEditorStore(initEditorState(raglanTee, 'M')))      // Untitled raglan at M, saved
const state = useSyncExternalStore(store.subscribe, store.getState)
const [files] = useState(() => createFileCommands(store, { api: window.api, commitDraft: blurActiveElement }))

// Menu clicks, shortcuts and close requests arrive here. One path for every entry point.
useEffect(() => window.api.onFileCommand((command) => void files.run(command)), [files])

// Main shows this in the title bar and adds the path to recent files. Close never trusts it.
const status = documentStatus(state)     // { name: 'Raglan', path: '/Users/me/Patterns/Raglan.json', dirty: true }
useEffect(() => window.api.setDocumentStatus(status), [status.name, status.path, status.dirty])

<p aria-label="Document">{status.name}{status.dirty ? ' — Edited' : ''}</p>
{state.notice && <Notice notice={state.notice} onDismiss={() => store.dispatch({ type: 'notice', notice: null })} />}
{exportOpen && <ExportDialog defaultTitle={state.file?.name ?? 'Pattern'} ... />}
```

```ts
await files.run({ kind: 'save' })        // Untitled: Save As. Saved and unchanged: nothing. Else writes in place.
await files.run({ kind: 'saveAs' })
await files.run({ kind: 'open' })        // dialog, read, parse; only if it parsed, ask about unsaved edits; then replace
await files.run({ kind: 'openRecent', path })
await files.run({ kind: 'new' })
await files.run({ kind: 'close' })       // sent by main when the window is asked to close; the renderer answers
```

`run` never rejects, and it runs commands one at a time in arrival order. Every outcome shows up in the store: a new document, a saved
title, or a `notice` saying what went wrong.

Core reads and writes the format. Both are pure.

```ts
readPatternFile(PATTERN_FILE_HAZARDS.clean)         // { ok: true, pattern: <equals raglanTee>, upgradedFrom: null }
readPatternFile(PATTERN_FILE_HAZARDS.truncated)     // { ok: false, problem: { kind: 'not-json', cutShort: true, detail: '…' } }
readPatternFile(PATTERN_FILE_HAZARDS.wrongType)     // { ok: false, problem: { kind: 'invalid', issues: [{ path: 'pieces[2].cutCount', message: 'Invalid input: expected number, received string' }] } }
readPatternFile(PATTERN_FILE_HAZARDS.unknownField)  // { ok: false, problem: { kind: 'invalid', issues: [{ path: 'pieces[2]', message: 'Unrecognized key: "lining"' }] } }
readPatternFile(PATTERN_FILE_HAZARDS.newerVersion)  // { ok: false, problem: { kind: 'newer-version', version: 2 } }

writePatternFile(raglanTee)                         // { ok: true, data: Uint8Array }, 2-space JSON, LF, final newline, canonical order
```

Main wires each channel to one port-driven function, as `export:save` does today.

```ts
// main/index.ts
ipcMain.handle('file:open', (event, request: unknown) => runOpenDocument(request, documentPorts(event)))
ipcMain.handle('file:save', (event, request: unknown) => runSaveDocument(request, documentPorts(event)))
ipcMain.handle('file:askToSave', (event, name: unknown) => askToSave(name, promptFor(event)))
ipcMain.on('document:status', (event, raw: unknown) => documentWindow.showStatus(raw))
ipcMain.on('file:closeAnswer', (event, proceed: unknown) => documentWindow.answerClose(proceed === true))
```

A test reads each hazard as data.

```ts
// main/documentFiles.test.ts, on a real temp folder
const stale = await staleRecents(bytes)
const ports = fakePorts({ recents: stale.listed })
expect(await runOpenDocument({ kind: 'recent', path: stale.renamed.listed }, ports)).toEqual({
  kind: 'failed', message: "Moved.json isn't there any more. It may have been moved, renamed or deleted. It's been removed from recent files."
})
expect(ports.recents.list()).not.toContain(stale.renamed.listed)

// renderer/src/file/commands.test.ts, a real store and core, a fake api
const save = api.holdNextSave()
void files.run({ kind: 'save' })
store.dispatch({ type: 'edit', edit: setChestEase('120') })
save.resolve({ kind: 'saved', file })
await files.idle()
expect(isDirty(store.getState())).toBe(true)          // the edit made during the save is still unsaved
```

## Shape

```
                      renderer                                                  main
 native menu, shortcut ── 'file:command' ──┐
 window close ── closeGate ── 'file:command'┼─► files.run(command)    one at a time
                                            │     commitDraft()        a half-typed cell commits into the store first
                                            │     open:  api.openDocument ────────────►  dialog or recent → stat → read bytes (≤ 16 MiB)
                                            │            readPatternFile(bytes)  core  ◄── { read, file, data }
                                            │            leave()? → api.askToSave ────►  native Save / Don't Save / Cancel
                                            │            dispatch replace
                                            │     save:  writePatternFile(pattern) core
                                            │            api.saveDocument ────────────►  known path → stamp, read-only → realpath → writeAtomically
                                            │            dispatch saved(pattern as written)
                                            │     close: leave() → api.answerClose ───►  closeGate: close (and quit again) or stay
 store change ─► api.setDocumentStatus ───────────────────────────────────────────────►  title, Edited dot, recents
```

Load-bearing decisions:

1. **The renderer owns the document. Main owns the disk, the window and every path's history.** Each piece of state has one writer. Main's
   copy of the status is for display, and it never decides whether to ask about unsaved edits.
2. **Unsaved is a reference comparison,** `pattern !== saved`. It's derived and never stored.
3. **One command runner, serial, which commits the draft first.** Every entry point calls `files.run`. It's the only code that calls the file
   channels, so ordering and the unsaved-edits guard can't be skipped.
4. **The schema can't lose data.** It refuses versions and keys it doesn't know, so no path can strip a newer file, a future Convex pull
   included.
5. **Main writes only paths it handed out,** and keeps their disk stamps itself.

Interface depth: the renderer learns one function, `run(command)`. Behind it are the draft commit, the queue, reading before asking, the
three-way prompt, Save As for Untitled, edits during a save, the changed-on-disk check, error words and the close handshake. Core exposes two
functions and a problem union. Main exposes one function per channel, each a validator over ports, like `runSaveExport`.

### Data structures

`EditorState` gains three fields. `editorReducer` is still the only writer of the document.

```ts
// renderer/src/editor/state.ts
export interface EditorState {
  /** The document: what gets saved and, later, snapshotted for undo. */
  readonly pattern: Pattern
  /** The pattern as last opened or saved, by reference. Unsaved is `pattern !== saved`. */
  readonly saved: Pattern
  /** Where the document is on disk. null is Untitled. */
  readonly file: DocumentFile | null
  /** The last file problem or remark, until dismissed or the next file command. View state, never saved or undone. */
  readonly notice: Notice | null
  readonly selection: Selection | null
  readonly panel: PanelKind
  readonly wantedSize: SizeName
  readonly nestShown: boolean
}

export interface Notice { readonly tone: 'error' | 'info'; readonly text: string }

export type EditorAction =
  | ...today's five...
  /** Open or New. Resets selection, panel and size, and makes `pattern` the saved one. Undo history, later, starts empty. */
  | { readonly type: 'replace'; readonly pattern: Pattern; readonly file: DocumentFile | null; readonly notice: Notice | null }
  /** `pattern` is what was written, captured before the write. Only `saved` and `file` change. History, later, is untouched. */
  | { readonly type: 'saved'; readonly pattern: Pattern; readonly file: DocumentFile }
  | { readonly type: 'notice'; readonly notice: Notice | null }

export const isDirty = (state: EditorState): boolean => state.pattern !== state.saved
export const documentStatus = (state: EditorState): DocumentStatus => ({ name: state.file?.name ?? 'Untitled', path: state.file?.path ?? null, dirty: isDirty(state) })
```

The bridge types are structural and live in `preload/api.ts`, as `SaveExportRequest` does.

```ts
// preload/api.ts
export interface DocumentFile {
  readonly path: string
  /** The file name without `.json`. Computed in main. The title and the export name use it. */
  readonly name: string
}

export type OpenDocumentRequest =
  | { readonly kind: 'choose'; readonly near: string | null }        // the dialog starts in this file's folder, else Documents
  | { readonly kind: 'recent'; readonly path: string }

export type OpenDocumentResult =
  | { readonly kind: 'read'; readonly file: DocumentFile; readonly data: Uint8Array }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string }

export type SaveDocumentRequest =
  | { readonly kind: 'overwrite'; readonly path: string; readonly data: Uint8Array }
  | { readonly kind: 'choose'; readonly name: string; readonly near: string | null; readonly data: Uint8Array }

export type SaveDocumentResult =
  /** `file` differs from the request's path when the user picked Save As in the changed-on-disk prompt. */
  | { readonly kind: 'saved'; readonly file: DocumentFile }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string }

export type SaveChoice = 'save' | 'discard' | 'cancel'

export interface DocumentStatus { readonly name: string; readonly path: string | null; readonly dirty: boolean }

export type FileCommand =
  | { readonly kind: 'new' }
  | { readonly kind: 'open' }
  | { readonly kind: 'openRecent'; readonly path: string }
  | { readonly kind: 'save' }
  | { readonly kind: 'saveAs' }
  /** From main only: the window was asked to close. The renderer must answer with `answerClose`. */
  | { readonly kind: 'close' }

export interface Api {
  getVersion: () => Promise<string>
  saveExport: (request: SaveExportRequest) => Promise<SaveExportResult>
  /** Never rejects. Returns bytes: main doesn't parse them. */
  openDocument: (request: OpenDocumentRequest) => Promise<OpenDocumentResult>
  /** Never rejects. */
  saveDocument: (request: SaveDocumentRequest) => Promise<SaveDocumentResult>
  /** The native Save / Don't Save / Cancel prompt. */
  askToSave: (name: string) => Promise<SaveChoice>
  /** Fire and forget. */
  setDocumentStatus: (status: DocumentStatus) => void
  /** Fire and forget. The reply to a `close` command. */
  answerClose: (proceed: boolean) => void
  /** Returns the unsubscribe. The listener never sees the IPC event. */
  onFileCommand: (listener: (command: FileCommand) => void) => () => void
}
```

What main keeps for files, in `knownFiles.ts`:

```ts
/** A path main handed out, with what it last saw on disk. Never crosses the bridge. */
interface KnownFile { readonly path: string; stamp: FileStamp | null }
interface FileStamp { readonly modifiedMs: number; readonly size: number }
```

The recent list on disk, `<userData>/recent-files.json`, owned by main:

```json
{ "version": 1, "files": ["/Users/me/Patterns/Raglan.json", "C:\\Users\\me\\Patterns\\Tee.json"] }
```

### Module map

| File | Change |
|---|---|
| `src/core/model.ts` | Every object schema becomes `z.strictObject`. `version` becomes `z.literal(CURRENT_SCHEMA_VERSION)`. Decision 2, `/blast-radius`. |
| `src/core/patternFile.ts` (new) | `readPatternFile`, `writePatternFile`, `PatternFileProblem`, `blankPattern`. Public. |
| `src/core/migrations.ts` (new, internal) | `MIGRATIONS` (empty today) and `upgrade`. |
| `src/core/fixtures/patternFiles.ts` | **Added.** `raglanFileText`, `PATTERN_FILE_HAZARDS`. `fileText` switches to `writePatternFile` once it exists. |
| `src/core/index.ts`, `boundaries.test.ts` | Named exports, new rules (Acceptance). |
| `src/main/files.ts` (new) | Moved from `saveExport.ts` unchanged: `WORDS`, `OPEN_ELSEWHERE`, `messageFor`, `bareName`, `inDirectory`, `extensionOf`. New: `readMessage`, and `saveThroughDialog`, the choose, add-extension, write and map-error routine that export and Save As share. |
| `src/main/saveExport.ts` | Validation, then `saveThroughDialog`. Behaviour and tests unchanged. |
| `src/main/knownFiles.ts` (new) | `createKnownFiles`: the paths main handed out, with stamps, and the recent list. Pure list rules (`fileKey`, `withRecent`, `withoutRecent`, `parseRecents`). The only owner of both. |
| `src/main/documentFiles.ts` (new) | `runOpenDocument`, `runSaveDocument`, `MAX_PATTERN_BYTES`, `PATTERN_FILTER`. No Electron import. |
| `src/main/fixtures/staleRecents.ts` | **Added.** The renamed, deleted and became-a-folder entries on a real temp folder. |
| `src/main/closeGate.ts` (new) | Pure `stepCloseGate`, `windowTitle`, `parseDocumentStatus`, `askToSaveOptions`, `conflictOptions`. |
| `src/main/appMenu.ts` (new) | `menuTemplate(options, send)`. Type-only Electron import. |
| `src/main/documentWindow.ts` (new) | The one window: creates it, owns its gate and status, sets the title and macOS document state, forwards commands. Electron glue only. |
| `src/main/index.ts` | Handlers, known files loaded before the first window, the menu. Still doesn't import `@core`. |
| `src/preload/api.ts`, `index.ts` | The types above and six new members. `index.d.ts` unchanged. |
| `src/renderer/src/editor/store.ts` (new) | `createEditorStore`: `editorReducer` behind `getState`, `dispatch`, `subscribe`. |
| `src/renderer/src/editor/state.ts` | `saved`, `file`, `notice`, three actions, `isDirty`, `documentStatus`. |
| `src/renderer/src/file/commands.ts` (new) | `createFileCommands`: the runner. No React. |
| `src/renderer/src/file/messages.ts` (new) | `problemText(problem, fileName)`. Every word the renderer shows about a file. |
| `src/renderer/src/App.tsx` | Store, runner, command listener, status effect, document name, notice, export title. |
| `src/renderer/src/export/ExportDialog.tsx` | `defaultTitle` prop. |
| `.agents/skills/verify-pattern-maker/` | `features/file-io.md`, `journeys/file-io.mjs`. `run.mjs` teardown destroys windows before `app.close()`. README list. |
| Docs | `CLAUDE.md` (a File I/O paragraph), `open-questions.md` (done). |

### Types and signatures

`src/core/patternFile.ts`:

```ts
/** One schema problem, with `path` written the way a person finds it in the file: `pieces[2].cutCount`. */
export interface FileIssue { readonly path: string; readonly message: string }

export type PatternFileProblem =
  | { readonly kind: 'empty' }
  /** Not UTF-8. A PDF or image picked by mistake, or a file re-saved as UTF-16. */
  | { readonly kind: 'not-text' }
  /** `cutShort` when the text doesn't end in `}`: copied or synced only partly. `detail` is the engine's sentence, shown but never tested word for word. */
  | { readonly kind: 'not-json'; readonly cutShort: boolean; readonly detail: string }
  /** JSON, but not an object with a positive integer `version`. Someone's package.json. */
  | { readonly kind: 'not-a-pattern' }
  /** Made by a newer app. Never parsed, so never stripped. */
  | { readonly kind: 'newer-version'; readonly version: number }
  /** Our format, at a version we read, but parsePattern refuses it. Every issue, in zod's order. */
  | { readonly kind: 'invalid'; readonly issues: readonly [FileIssue, ...FileIssue[]] }

export type ReadPatternResult =
  | { readonly ok: true; readonly pattern: Pattern; /** The file's version, when it was older and was upgraded in memory. */ readonly upgradedFrom: number | null }
  | { readonly ok: false; readonly problem: PatternFileProblem }

export type WritePatternResult =
  | { readonly ok: true; readonly data: Uint8Array }
  /** The pattern fails its own schema. A bug, but a file on disk is never replaced by one we couldn't read back. */
  | { readonly ok: false; readonly issues: readonly [FileIssue, ...FileIssue[]] }

/** Pure and total: never throws, whatever the bytes. */
export function readPatternFile(data: Uint8Array): ReadPatternResult { throw new Error('not implemented') }

/** Validates, then writes 2-space JSON in canonical order with LF line ends and one final newline. Deterministic. */
export function writePatternFile(pattern: Pattern): WritePatternResult { throw new Error('not implemented') }

/** What File > New opens: one size, M, in cm, and nothing else. */
export function blankPattern(): Pattern { throw new Error('not implemented') }
```

```
readPatternFile(data):
  text = TextDecoder('utf-8', { fatal: true }).decode(data)    throws → not-text      (a UTF-8 BOM is dropped, ran)
  text.trim() is '' → empty
  json = JSON.parse(text), catch → not-json { cutShort: !text.trimEnd().endsWith('}'), detail: error.message }
  json isn't a plain object, or json.version isn't a positive integer → not-a-pattern
  json.version > CURRENT_SCHEMA_VERSION → newer-version(json.version)       before any shape check
  input = json.version < CURRENT ? upgrade(json, json.version) : json
  parsed = parsePattern(input), fails → invalid(issues, each path joined as a[2].b)
  ok(parsed.pattern, upgradedFrom: the old version or null)

writePatternFile(pattern):
  parsed = parsePattern(pattern), fails → { ok: false, issues }
  canonical = parsed.pattern, with each measurement's values rebuilt in pattern.sizes order
  data = UTF-8 of JSON.stringify(canonical, null, 2) + '\n'
```

`src/core/migrations.ts`, internal:

```ts
type JsonObject = { readonly [key: string]: unknown }
/** MIGRATIONS[i] turns a version i+1 file into version i+2, and sets its version. A test pins length === CURRENT_SCHEMA_VERSION - 1. */
export const MIGRATIONS: readonly ((file: JsonObject) => JsonObject)[] = []
/** Runs every step from `from` up to current. The result still goes through parsePattern. */
export function upgrade(file: JsonObject, from: number, migrations = MIGRATIONS): JsonObject { throw new Error('not implemented') }
```

`src/main/knownFiles.ts`:

```ts
export const RECENT_LIMIT = 10

/** What makes two paths the same file. NFC everywhere, and lower case on darwin and win32, with `/` read as `\` on win32. */
export function fileKey(path: string, platform: NodeJS.Platform): string { throw new Error('not implemented') }
/** `path` first. An older spelling of the same file is dropped. At most RECENT_LIMIT. */
export function withRecent(list: readonly string[], path: string, platform: NodeJS.Platform): readonly string[] { throw new Error('not implemented') }
export function withoutRecent(list: readonly string[], path: string, platform: NodeJS.Platform): readonly string[] { throw new Error('not implemented') }
/** Total. Missing, malformed, another version or the wrong shape gives []. Keeps only absolute path strings, deduplicated and capped. */
export function parseRecents(text: string | null, platform: NodeJS.Platform): readonly string[] { throw new Error('not implemented') }

export interface KnownFiles {
  /** Newest first, as paths. The menu shows the name, then the folder. */
  recents(): readonly string[]
  /** Chosen in a dialog this session, or on the recent list. The only gate on paths from the renderer. */
  allows(path: string): boolean
  /** A dialog handed out this path. */
  grant(path: string): void
  stampOf(path: string): FileStamp | null
  setStamp(path: string, stamp: FileStamp | null): void
  /** The window shows this file now. Moves it to the top of recents. */
  showing(path: string): void
  /** Gone from disk. Leaves recents. */
  forget(path: string): void
}

/** Recents writes are chained, and each writes the list as it is when its turn comes, so the newest list always lands last. A failed write is logged. */
export async function createKnownFiles(ports: { load: () => Promise<string | null>; write: (data: Uint8Array) => Promise<void>; platform: NodeJS.Platform; onChange: () => void }): Promise<KnownFiles> { throw new Error('not implemented') }
```

`src/main/documentFiles.ts`:

```ts
/** About 1,500 raglans (10.8 KB, ran). */
export const MAX_PATTERN_BYTES = 16 * 1024 * 1024
export const PATTERN_FILTER = { name: 'Pattern', extensions: ['json'] }

export interface DocumentPorts {
  readonly chooseOpen: (options: { defaultPath: string; filters: Filter[] }) => Promise<{ canceled: boolean; filePaths: string[] }>
  readonly chooseSave: SaveExportPorts['chooseFile']
  readonly stat: (path: string) => Promise<{ isFile: boolean; size: number; mtimeMs: number; writable: boolean }>
  readonly readFile: (path: string) => Promise<Uint8Array>
  /** realpath, so a symlink stays a link, then writeAtomically. */
  readonly write: (path: string, data: Uint8Array) => Promise<void>
  /** The native "changed by another program" prompt. */
  readonly askConflict: (fileName: string) => Promise<'replace' | 'save-as' | 'cancel'>
  readonly known: KnownFiles
  readonly documentsDir: string
}

/** Never rejects. Reads bytes and nothing else: parsing is core's, in the renderer. */
export async function runOpenDocument(raw: unknown, ports: DocumentPorts): Promise<OpenDocumentResult> { throw new Error('not implemented') }
/** Never rejects. */
export async function runSaveDocument(raw: unknown, ports: DocumentPorts): Promise<SaveDocumentResult> { throw new Error('not implemented') }
```

```
runOpenDocument(raw, ports):
  request = validate raw, else failed 'Nothing to open.'
  recent:  path = request.path; unless known.allows(path) → failed "That file isn't in your recent files."
  choose:  { canceled, filePaths } = chooseOpen({ defaultPath: folder of near, else documentsDir; filters: [PATTERN_FILTER, All files] })
           canceled or none → cancelled; known.grant(path)
  try
    s = stat(path)
    !s.isFile → failed "<name> is a folder, not a pattern file."
    s.size > MAX → failed "<name> is <n> MB, far bigger than a pattern, so it wasn't opened."
    data = readFile(path)
    known.setStamp(path, stamp of s)              the stamp from before the read: a change in between shows as a conflict at save, the safe side
    read({ path, name }, data)
  catch error
    ENOENT or ENOTDIR → known.forget(path); message adds "It's been removed from recent files." when it was a recent
    failed(readMessage(error, bareName(path)))

runSaveDocument(raw, ports):
  request = validate raw, else failed 'Nothing to save.'
  choose:
    result = saveThroughDialog({ name: `${request.name}.json`, data, filter: PATTERN_FILTER, startDir: folder of near, else documentsDir }, ports)
    saved → known.grant(path); known.setStamp(path, stat after write); saved({ path, name })     the OS dialog already asked about replacing
  overwrite:
    unless known.allows(path) → failed 'Choose where to save with Save As.'
    now = stat(path), ENOENT → null                                   deleted since: write it again, no question
    now and !now.writable → failed "<name> is read-only. Use Save As to keep your changes somewhere else."
    now and known.stampOf(path) and now differs from it →
        askConflict(name): cancel → cancelled; save-as → the choose branch, near path; replace → go on
    try write(path, data) catch → failed(messageFor(error))           the words export uses
    known.setStamp(path, stat after write); saved({ path, name })
```

`src/main/files.ts`, moved and extended:

```ts
export const OPEN_ELSEWHERE = 'The file may be open in another program. Close it and try again.'
/** Today's WORDS from saveExport.ts, unchanged. */
export const WORDS: Readonly<Record<string, string>>
export function messageFor(error: unknown): string
/** Read failures name the file. ENOENT "<name> isn't there any more. It may have been moved, renamed or deleted.",
 *  EACCES and EPERM "You don't have permission to open <name>.", EISDIR "<name> is a folder, not a pattern file.", EBUSY OPEN_ELSEWHERE. */
export function readMessage(error: unknown, fileName: string): string
export function bareName(fileName: string): string
export function inDirectory(directory: string, name: string): string
/** Choose with one filter, add the extension if the user removed it, write, map the error. runSaveExport's body today. */
export async function saveThroughDialog(file: { name: string; data: Uint8Array; filter: Filter; startDir: string }, ports: Pick<SaveExportPorts, 'chooseFile' | 'write'>): Promise<SaveExportResult>
```

`src/main/closeGate.ts`:

```ts
export interface CloseGate {
  /** The renderer has registered its listener and pushed a status. A renderer that isn't there can't be asked. */
  readonly ready: boolean
  readonly phase: 'open' | 'asking' | 'approved'
  /** A quit is waiting on this close. */
  readonly quitting: boolean
}
export const START_GATE: CloseGate = { ready: false, phase: 'open', quitting: false }

export type CloseGateEvent =
  | { readonly kind: 'close-requested' }
  | { readonly kind: 'before-quit' }
  | { readonly kind: 'answered'; readonly proceed: boolean }
  | { readonly kind: 'renderer-ready' }
  /** A main-frame navigation (reload) or render-process-gone: an answer will never come. */
  | { readonly kind: 'renderer-reset' }
export type CloseGateEffect = 'allow' | 'prevent' | 'prevent-and-ask' | 'close' | 'close-and-quit' | 'none'

export function stepCloseGate(gate: CloseGate, event: CloseGateEvent): { readonly gate: CloseGate; readonly effect: CloseGateEffect } { throw new Error('not implemented') }
export function windowTitle(status: DocumentStatus, platform: NodeJS.Platform): string { throw new Error('not implemented') }
export function parseDocumentStatus(raw: unknown): DocumentStatus | null { throw new Error('not implemented') }
/** Buttons in Electron's order. On macOS the system places them. The answer maps back through the same list. */
export function askToSaveOptions(name: string): MessageBoxOptions { throw new Error('not implemented') }
export function conflictOptions(fileName: string): MessageBoxOptions { throw new Error('not implemented') }
```

| Gate | Event | Effect, next gate |
|---|---|---|
| not `ready` | `close-requested` | `allow` |
| `approved` | `close-requested` | `allow` |
| ready, `open` | `close-requested` | `prevent-and-ask`, `asking` |
| `asking` | `close-requested` | `prevent`, so there's one question at a time |
| any | `before-quit` | `none`, `quitting: true` |
| `asking` | `answered` true | `close-and-quit` if quitting, else `close`. `approved` |
| `asking` | `answered` false | `none`, `open`, `quitting: false`, so Cancel cancels the quit too |
| any | `renderer-ready` | `none`, `ready: true` |
| any | `renderer-reset` | `none`, `ready: false`, `open`, `quitting: false` |

`close-and-quit` calls `win.close()` and then `app.quit()` again, because the prevented close already cancelled the first quit (**ran**).

`src/main/appMenu.ts`:

```ts
export interface MenuOptions { readonly platform: NodeJS.Platform; readonly packaged: boolean; readonly recents: readonly string[] }
/** Item ids: file-new, file-open, file-recent-<i>, file-save, file-save-as. A journey clicks them by id. */
export function menuTemplate(options: MenuOptions, send: (command: FileCommand) => void): MenuItemConstructorOptions[] { throw new Error('not implemented') }
```

`src/renderer/src/editor/store.ts` and `src/renderer/src/file/commands.ts`:

```ts
export interface EditorStore {
  getState(): EditorState
  /** Runs editorReducer synchronously. Notifies only when the state changed. */
  dispatch(action: EditorAction): void
  subscribe(listener: () => void): () => void
}
export function createEditorStore(initial: EditorState): EditorStore { throw new Error('not implemented') }

export interface FilePorts {
  readonly api: Pick<Window['api'], 'openDocument' | 'saveDocument' | 'askToSave' | 'answerClose'>
  /** Ends any cell edit, so its draft commits through the store before the command reads it. */
  readonly commitDraft: () => void
}
export interface FileCommands {
  /** Queued behind any running command. Never rejects. */
  run(command: FileCommand): Promise<void>
  /** Resolves when the queue is empty. For tests. */
  idle(): Promise<void>
}
export function createFileCommands(store: EditorStore, ports: FilePorts): FileCommands { throw new Error('not implemented') }
```

```
perform(command):
  commitDraft()
  dispatch notice null                                   a new command clears the last notice
  new:        if leave() → replace(blankPattern(), file null)
  open:       openRead(await openDocument({ kind: 'choose', near: file?.path }))
  openRecent: openRead(await openDocument({ kind: 'recent', path }))
  save:       save(false)
  saveAs:     save(true)
  close:      answerClose(leave())                       an unexpected error answers false and shows it

openRead(r):
  cancelled → done.   failed → notice(r.message)
  parsed = readPatternFile(r.data)
  !parsed.ok → notice(problemText(parsed.problem, file name)). Nobody was asked anything, and the document is untouched.
  leave() → replace(parsed.pattern, r.file, an info notice when upgradedFrom)
                                                         Cancel, or a save that failed or was cancelled: untouched

leave(): boolean                                         may the current document go?
  clean → true
  choice = askToSave(name)
  save → save(false).   discard → true.   cancel → false

save(choose): boolean
  { pattern, file } = getState()                         captured now, before any await
  !choose and file and clean → true                      saving a saved document is a no-op
  encoded = writePatternFile(pattern); !ok → notice "This pattern can't be saved: …"; false
  request = !choose and file ? overwrite(file.path) : choose(name, near file?.path)
  result = await saveDocument(request)
  saved → dispatch saved(pattern, result.file); true     edits made during the await stay unsaved
  cancelled → false.   failed → notice(result.message); false
```

## The decisions

### 1. File format

The file is exactly a `Pattern`, the object Convex will store in `patterns.pattern`. There's no envelope around it.

- **Why no envelope.** A pattern's name is its file name, as in most document apps, and Convex keeps `name` outside the pattern too. `version`
  already identifies the format. An envelope would add a second version field to keep in step with it. Anything per computer, like the last
  size shown, stays outside the file.
- **Extension `.json`.** The user asked for JSON, and nothing about M8 needs a private type. Save suggests `Untitled.json` or `<name>.json`. Open
  shows a Pattern filter (`json`) plus All files, because the content decides. A private extension only pays off with a file association,
  which needs an installer. That's an open question.
- **Bytes.** UTF-8 without a byte order mark, 2-space indent, LF on every OS, one final newline.
- **Canonical order.** Keys come in schema order, because `writePatternFile` writes `parsePattern`'s output (**ran**: shuffled keys come back
  as version, units, sizes, …). Each measurement's `values` is rebuilt in `pattern.sizes` order, because `addSize` leaves the new size's value
  last (**ran**: `S,M,L,XL,XXL,XS`). The same pattern always gives the same bytes, so a git diff shows only what changed.
- **Validated before writing.** A pattern that fails its own schema is never written, so the app can always read back what it saved.
  `z.number()` already refuses `NaN` and `Infinity` (**ran**), which `JSON.stringify` would turn into `null`. A pattern with evaluation issues, like a cycle or an undefined
  name, is valid content and saves normally, because a half-built pattern has to be savable. `raglanFailingInXXL` round-trips in the tests.
- **Size.** The raglan is 10,826 bytes (**ran**).

### 2. Versions, strictness and migrations

Two changes to `model.ts`. Both are enforced by the schema, so every reader gets them, including a future Convex pull or MCP tool:

- `version: z.literal(CURRENT_SCHEMA_VERSION)`, so a parsed `Pattern` always has the current version (**ran**: version 2 gives "Invalid
  input: expected 1"). The inferred type of `version` narrows from `number` to `1`. The fixtures already use the constant.
- Every object schema becomes `z.strictObject`, so an unknown key is an issue, not a silent deletion (**ran**: `unrecognized_keys`, inside a
  `discriminatedUnion` too).

`readPatternFile` still checks the version **before** parsing. The user then reads "made by a newer version" rather than a schema error, and a
newer file is never parsed at all, whatever its shape. A newer file never reaches the editor, so it can't be saved over. The strict schema is
the second wall. A hand-edited or buggy file at the current version with an extra key is refused, and the error names the key.

**Migrations.** `MIGRATIONS[i]` takes version i+1 JSON to i+2, on raw JSON, before `parsePattern`. The table is empty today, and a test pins its
length to `CURRENT_SCHEMA_VERSION - 1`, so bumping the version without a migration fails the build. An upgraded file opens as saved, with an
info notice: "Raglan.json was made by an older version. Saving updates it, and older versions won't open it after that." Nothing is written
until the user saves.

Blast radius, to confirm with `/blast-radius`: `model.test.ts` "does not keep a saved active size" becomes "refuses a saved active size", which
keeps the M6 intent and makes it louder. Fixtures are typed literals, and `applyEdit` builds objects by spreading typed values, so nothing in the
app adds extra keys. Two fixture tests in `patternFiles.test.ts` pin today's stripping, and they flip to refusals in the same change.

### 3. Where bytes become a pattern

Main reads bytes. Core, running in the renderer, decodes and parses them. Main never imports `@core`, as in M7.

| Input | Answer |
|---|---|
| UTF-8, with or without a BOM | Read. `TextDecoder` drops the BOM (**ran**). |
| CRLF line ends | Read. JSON treats them as space (**ran**). Saving writes LF. |
| UTF-16, or any other non-UTF-8 bytes | `not-text`. We don't guess encodings. The words say to save it as UTF-8. |
| Empty or only spaces | `empty` |
| `null`, `[]`, a number, JSON without a numeric `version` | `not-a-pattern` |
| Over 16 MiB | Refused by main from `stat`, before reading, so a wrong pick never crosses the bridge. |
| A folder, pipe or device | Refused by main from `stat`. |
| Permission denied, locked, gone | `readMessage` names the file. |

A `Buffer` read in main arrives in the sandboxed preload as a `Uint8Array` (**ran**: 40,000 bytes). M7 measured 50 MB at 91 ms (**ran**).

### 4. Who owns what

| State | Owner | Others |
|---|---|---|
| `pattern`, `saved`, `file`, `notice` | The renderer store | Main gets a `DocumentStatus` copy for display. |
| Unsaved | Derived in the renderer | Never stored anywhere. |
| Disk, dialogs, prompts | Main | The renderer asks through the bridge. |
| Allowed paths, their disk stamps, the recent list | `knownFiles.ts` in main | The renderer sees paths, never stamps. |
| Close gate, title, macOS document state | `documentWindow.ts` in main | |

Main's status copy can be a frame stale. It drives only the title, the macOS Edited dot and recents, where a frame doesn't matter. Closing
asks the renderer every time (decision 7).

**Why the store.** `useReducer` state is only visible to the next render. The runner works across awaits, and it has to read the state right
after a draft commits. So the reducer moves behind a small external store read with `useSyncExternalStore`. `editorReducer` doesn't change and is
still the only writer. `dispatch` runs it synchronously, so `commitDraft()` followed by `getState()` sees the committed cell. Blurring the input
fires React's `onBlur`, which dispatches the edit before `blur()` returns (**unverified** for React 19). The journey's `file-draft` step proves it,
and `commitDraft` can wrap the blur in `flushSync` if not.

**Paths, not handles.** The renderer holds paths, because the title, the macOS proxy icon and export defaults need them. Main writes only paths
it handed out (decision 15), and keeps their stamps itself, so the renderer can't drop or forge a stamp.

### 5. Unsaved changes

`isDirty = pattern !== saved`. `applyEdit` returns the same reference for a no-op or refused edit, so those never count as changes.

- **An edit during a save stays unsaved.** `saved` becomes the pattern captured before the write, not the one current when it finishes.
- **Undo, later.** The stack will hold pattern references. Undoing back to `saved` gives `pattern === saved`, which reads as saved with no extra
  code. `saved` doesn't touch the stack. `replace` (Open, New) starts a fresh stack, because history from another file can't apply. A test pins
  this as the contract undo has to meet: set `pattern` back to `saved`, and the document reads as saved.
- **An edit and its exact reverse** stay unsaved, because they produce a new object. Accepted (Tradeoffs).
- **Opening or upgrading** sets `saved` to the opened pattern, so an untouched file reads as saved.
- **Launch** sets `saved = pattern`, so closing an untouched app never asks.
- **A cell whose draft was refused** (a formula with a syntax error) isn't part of the pattern. It isn't saved, and on its own it doesn't
  make the document unsaved. That's an open question.

### 6. Save, Save As and failures

| Case | What happens |
|---|---|
| First save of Untitled | Save acts as Save As. The dialog starts in Documents with "Untitled.json". |
| Save, file known | Writes in place, with no dialog. |
| Save with nothing changed | Nothing happens. It's idempotent, and the file's modified time doesn't move. |
| Save twice fast | The second waits in the queue. Then it's a no-op if the first saved everything, or it saves the newer edits. The disk always ends up with the newest pattern: one writer per window, serial by construction (`separate-before-serializing-shared-state`). |
| Edit during a save | Kept, and still unsaved (decision 5). |
| Save As | Always the dialog, starting in the current file's folder with its name. The OS dialog asks before replacing. Afterwards the window shows the new file, and both files are in recents. |
| A write fails | `writeAtomically` leaves the old file whole. The notice uses the export words, for example "The disk is full." The document stays unsaved. |
| Read-only file | "Raglan.json is read-only. Use Save As to keep your changes somewhere else." Without the check, the rename would replace it and make it writable (**ran**). |
| Read-only folder | "You don't have permission to save there." |
| File deleted since opening | Save writes it again. If its folder is gone too: "That folder doesn't exist any more." |
| Changed by another program | Main sees a different modified time or size, and asks natively: "Raglan.json was changed by another program since you opened it." The buttons are Replace, Save As… and Cancel, with Cancel the default. Cancel writes nothing. |
| A symlink | Main writes to `realpath(path)`, so the link stays a link. |
| The pattern fails its own schema | Nothing is written, and the notice says "This pattern can't be saved: …". A bug, made visible. |

The changed-on-disk check is a `stat` before writing, so there's a small race window. That's fine for a single-user desktop app. Saving never
re-reads or merges. A file with the same size and the same modified time isn't noticed, and FAT's 2-second times make that likelier there (**unverified**).

### 7. The close guard and quitting

Close always asks the renderer. Main never decides from its status copy.

```
X, Cmd+W, Alt+F4, Cmd+Q, File > Exit, app.quit()
   │  before-quit (quits only) → quitting = true
   ▼
win 'close' → stepCloseGate(close-requested)
   allow           → closes
   prevent-and-ask → event.preventDefault(); send { kind: 'close' }
                     renderer: commitDraft, leave() → askToSave → maybe save → answerClose(bool)
   answered true   → approved; win.close(); app.quit() again if quitting
   answered false  → stays; quitting cleared
```

- **Why always ask.** A half-typed formula commits only on blur. Asking runs `commitDraft` first, so closing with a typed formula asks to save
  it. Asking also leaves no race between the last edit and a pushed status. It costs one IPC round trip.
- **The prompt is native.** `dialog.showMessageBox` with Save, Don't Save and Cancel, and Escape means Cancel. macOS places the buttons itself, and `noLink` stops
  Windows turning them into command links. The renderer shows the same prompt before Open and New through `askToSave`. It's native because
  it's what each OS's users expect, it shows for Cmd+Q even when the window is minimized, and a journey stubs it the way it stubs the save
  dialog.
- **Save in the prompt** of an Untitled document opens Save As. Cancelling that, or a failed write, cancels the close and any quit.
- **Last window closed quits on every OS,** macOS included. This is one window for one document. A window-less macOS app would need menu commands
  that create a window and queue the command until the renderer listens. That's an open question.
- **A renderer that can't answer.** `ready` is false until the first status push. It goes false again on a main-frame navigation
  (`did-start-navigation` with `isMainFrame`) and on `render-process-gone`. A window closed during startup or after a crash then closes
  normally.
- **A hung renderer** is still asked, so its window won't close until the user force-quits. Main never closes a document with unsaved edits
  on a guess (Tradeoffs).
- **Reload.** The packaged menu has no Reload, so no shortcut can throw away edits. Dev keeps View > Reload, which discards unsaved edits
  without asking.
- **Journeys and teardown.** `run.mjs` calls `BrowserWindow.getAllWindows().forEach((w) => w.destroy())` through `app.evaluate` before
  `app.close()`. `destroy` skips the `close` event (**unverified**), so teardown can't hang on a prompt. This lands before the guard, and every
  existing journey is re-run.
- **Windows log-off** (`query-session-end`) isn't handled in M8. It's listed under risks.

### 8. Opening, and opening while there are unsaved edits

The file is read and parsed **before** asking about unsaved edits.

1. Choose a file (or take the recent path), read its bytes, and parse them in core.
2. If that failed, show the notice. The current document is untouched, and nobody was asked about saving for nothing.
3. If it parsed, run `leave()`. Cancel, or a save that failed or was cancelled, keeps the current document, still unsaved.
4. Only then `replace`.

A failed open can't touch the document, because `replace` only takes a parsed `Pattern`. Opening the file that's already open re-reads it from
disk, asking first if there are unsaved edits, so it works as a revert. A file opens at its first size, as today.

What each hazard shows in the notice (role `alert`), with the document unchanged:

| Hazard | Fixture | `PatternFileProblem` | Words |
|---|---|---|---|
| Malformed JSON, cut short | `truncated` | `not-json`, `cutShort` | "Raglan.json is damaged. It ends too early, so it may have been cut off while saving or copying." |
| Malformed JSON mid-file | `doubleComma` | `not-json` | "Raglan.json is damaged and can't be read as JSON. (<engine detail>)" |
| Valid JSON that fails `parsePattern` | `wrongType` | `invalid` | "Raglan.json can't be opened: pieces[2].cutCount: Invalid input: expected number, received string." Up to three issues, then "and 4 more." |
| A field this version doesn't know | `unknownField` | `invalid` | "Raglan.json can't be opened: pieces[2]: Unrecognized key: \"lining\"." |
| Newer format | `newerVersion` | `newer-version` | "Raglan.json was made by a newer version of Parametric Pattern Maker (format 2). This version reads format 1. Update the app to open it." |
| Other JSON | `notAPattern` | `not-a-pattern` | "package.json isn't a pattern file." |
| Not text | `notText`, `utf16` | `not-text` | "Raglan.json isn't a pattern file. If it's a pattern saved in another encoding, save it again as UTF-8." |
| Empty | `empty` | `empty` | "Raglan.json is empty." |
| Recent file renamed or deleted | `staleRecents` | main `failed` | "Raglan.json isn't there any more. It may have been moved, renamed or deleted. It's been removed from recent files." |
| Over 16 MiB, a folder, no permission | `staleRecents.becameFolder` and others | main `failed` | Decision 3. |

### 9. Recent files

- **Stored** in `<userData>/recent-files.json` and written with `writeAtomically`. Main loads it before the first window.
- **What goes in** is the path of the document the window shows. When `status.path` changes and `known.allows` it, main calls `showing(path)`.
  So a file that failed to parse never enters the list, Save As adds the new file, and the current document is always first. That's one rule
  derived from what the window shows, instead of an add call at every open and save.
- **Order and cap:** newest first, at most 10.
- **Dedupe** is by `fileKey`. macOS and Windows file systems ignore case by default, and macOS can hand back decomposed Unicode names
  (**unverified**). The newest spelling is kept. The same key also matches an open file to its stamp.
- **Stale entries** aren't checked when the menu is built, because `stat` on a sleeping network drive can hang it. Opening one that's gone
  (ENOENT or ENOTDIR) removes it and says so. Other failures (permission, locked, became a folder, no longer parses) keep it, because the file is
  still there.
- **Corrupt store.** Unreadable, not JSON, another version or the wrong shape gives an empty list, and the next change replaces the file. The app
  never fails to start because of it. It's a cache, so losing it is harmless.
- **Writes** are chained, and each writes the current list, so two quick changes can't leave the older list on disk. A failed write doesn't fail
  the open or save.
- **Shown** in the native File > Open Recent submenu as the file name, then the folder in a smaller label, rebuilt when the list changes. "No Recent
  Files" shows, greyed out, when the list is empty. "Clear Menu" empties it.
- **Not in M8:** `app.addRecentDocument` (the macOS Dock and Windows jump list). Clicking those launches the app with a path or sends `open-file`,
  which belongs with file association (decision 13).
- **Two app instances** each keep their list in memory, and the last one to write wins. Accepted.

### 10. Menus and shortcuts

M8 sets an application menu, which replaces Electron's default menu and its Reload.

| Menu | macOS | Windows and Linux |
|---|---|---|
| App | role `appMenu` (About, Hide, Quit) | none |
| File | New ⌘N, Open… ⌘O, Open Recent ▸, Save ⌘S, Save As… ⇧⌘S, Close Window ⌘W | New Ctrl+N, Open… Ctrl+O, Open Recent ▸, Save Ctrl+S, Save As… Ctrl+Shift+S, Exit |
| Edit | role `editMenu` | role `editMenu` |
| View | Toggle Full Screen. Reload and developer tools only when not packaged. | the same |
| Window | role `windowMenu` | none |

- **The native menu is the only command surface.** There are no Open or Save buttons in the header. That gives one way to do each task, with the
  platform's own accelerators. The header shows the document name and "— Edited", which aren't buttons. M9's start screen is the likely home for a
  visible recent list.
- **The Edit menu stays,** because macOS routes ⌘C, ⌘V and ⌘Z in text fields through it (**unverified**). Without it, copy and paste in formula
  cells would break.
- **A click** calls `send(command)`, which is `webContents.send('file:command', command)` to the one window. This is the first main-to-renderer
  message. Preload wraps it, so the listener never sees the IPC event. A command sent before `ready` is dropped.
- **Shortcuts are native accelerators only.** The renderer has no key handler for them, so one key press can't run a command twice.
- **No drift.** `menuTemplate` keys its items with a `Record<MenuCommandKind, …>`, where `MenuCommandKind` is `FileCommand['kind']` without
  `openRecent` and `close`. A new command kind fails typecheck until the menu has it, and `run` ends its switch with `never`.

### 11. Window title and document state

| | Title | Extra |
|---|---|---|
| macOS | `Raglan`, or `Untitled` | `setDocumentEdited(dirty)` for the dot. `setRepresentedFilename(path ?? '')` for the proxy icon. |
| Windows, Linux | `Raglan - Parametric Pattern Maker`, and `*Raglan - …` when unsaved | |

`windowTitle` is pure and tested per platform. Main prevents `page-title-updated`, so the HTML `<title>` doesn't overwrite it. The header shows
`Raglan — Edited` the same way on every OS, which is what journeys read.

### 12. Launch, New and the export title

- **Launch:** an Untitled document seeded with the raglan at M, already saved. Every existing journey starts from that, and M9 replaces it with templates.
- **New:** `blankPattern()`, with one size, M, in cm, and nothing else. It asks about unsaved edits first.
- **Export title:** the document's name, else "Pattern". This answers the M7 question "Where does an export's title come from?".

### 13. Opening from the OS

Double-click, `open-file` on macOS, and a path in `argv` or `second-instance` on Windows and Linux are **not in M8**. They need a file association,
which needs an installer, and none exists. When they come, main calls `known.grant(path)`, then `send({ kind: 'openRecent', path })`, so the
runner and the guard need no change.

### 14. File changed on disk

It's detected only at save time, through the stamp (decision 6). Nothing watches the file while it's open. Watching needs `fs.watch`, which behaves
differently on each OS, and a "reload?" flow. Neither is needed to keep edits safe.

### 15. Which paths main will touch

The renderer is sandboxed, but it shows untrusted file content. Main reads and writes only paths it handed out: chosen in one of its dialogs this
session, or on the recent list. `known.allows` is the one check, and both channels use it. It extends M7's rule ("the path comes only from the
dialog") to documents, which must save in place. A refused path reads "Choose where to save with Save As." The renderer can still overwrite an
allowed file with any bytes. That's the same power the user has, so it's accepted.

### 16. Hazard fixtures

**Added** in this change, with tests that pin each hazard using only today's code.

`src/core/fixtures/patternFiles.ts`: `PATTERN_FILE_HAZARDS`, all derived from the raglan. Text edits go through `replaceOnce`, which throws if
its search text isn't found exactly once, so a fixture can't silently turn back into the clean file.

| Fixture | Built as | Pinned today | `readPatternFile` answers |
|---|---|---|---|
| `clean` | The raglan as JSON | Parses equal to `raglanTee` | `ok`, equal to `raglanTee`, `upgradedFrom: null` |
| `empty` | Zero bytes | Length 0 | `empty` |
| `truncated` | First half of the bytes | `JSON.parse` throws, doesn't end in `}` | `not-json`, `cutShort: true` |
| `doubleComma` | `"units": "cm",,` | `JSON.parse` throws, ends in `}` | `not-json`, `cutShort: false` |
| `wrongType` | Sleeve `cutCount: "2"` | Fails `parsePattern` at exactly `pieces[2].cutCount` | `invalid`, that one issue |
| `unknownField` | `lining: true` on the sleeve, version 1 | Today `parsePattern` strips it | `invalid` at `pieces[2]`, naming `lining` |
| `newerVersion` | Version 2 and the same `lining` | Today `parsePattern` accepts it and strips `lining` | `newer-version`, `version: 2` |
| `notAPattern` | `{"name":"my-app","version":"1.0.0"}` | Valid JSON | `not-a-pattern` |
| `notText` | `%PDF-1.7` then bytes that aren't UTF-8 | Fatal UTF-8 decode throws | `not-text` |
| `utf16` | The raglan as UTF-16 LE with a BOM | Fatal UTF-8 decode throws | `not-text` |
| `bomCrlf` | UTF-8 BOM and CRLF line ends | Parses equal to `raglanTee` | `ok`, equal to `raglanTee` |

Once `writePatternFile` exists, `fileText` in the fixture uses it. Round trips over `raglanTee`, `raglanFailingInXXL` and `raglanPrintHazards`
(inches, and `Sleeve <袖> & "cuff"`) check two things. `read(write(p))` equals `p`, and `write(read(write(p)))` is byte-identical. The output has
no `\r`, ends with exactly one `\n`, and has `values` keys in `sizes` order after an `addSize`.

`src/main/fixtures/staleRecents.ts`: the recent-file hazard is the filesystem itself, so it's a real temp folder. It holds a recent list of four
paths: `kept` is still there, `renamed.listed` was renamed to `renamed.now`, `deleted` is gone, and `becameFolder` is now a folder. The caller passes
the bytes, so main code never needs `@core`. `documentFiles.test.ts` opens each one. `kept` opens. `renamed.listed` and `deleted` fail with the
exact words in decision 8 and leave the list. `becameFolder` is refused as a folder and stays on it.

## Acceptance

| Unit tests | Prove |
|---|---|
| `core/patternFile.test.ts` | Every fixture row. Round trips and byte stability. The version gate runs before parsing: a newer file with a wrong body still says `newer-version`. A `NaN` measurement gives `ok: false` and no bytes. `blankPattern()` passes `parsePattern`. |
| `core/migrations.test.ts` | `MIGRATIONS.length === CURRENT_SCHEMA_VERSION - 1`. `upgrade` runs injected steps in order, starting at `from`. |
| `core/model.test.ts` | Refuses version 2. Refuses an unknown key at the top, in a piece, and in a segment of each kind. The active-size test expects refusal. |
| `core/fixtures/patternFiles.test.ts` | **Added.** Each hazard is what it claims. The two stripping tests flip with decision 2. |
| `main/files.test.ts` | `messageFor` and `readMessage` per code. `saveThroughDialog` adds the extension and maps a thrown write. |
| `main/saveExport.test.ts` | Unchanged and green, which proves the move kept behaviour. |
| `main/knownFiles.test.ts` | `fileKey` for darwin, win32 and linux, including NFD against NFC and `C:/` against `C:\`. Order, dedupe keeping the newest spelling, the cap of 10. `parseRecents` on null, garbage, the wrong shape, version 2 and relative paths. Two quick changes leave the newest list on disk. A failing write doesn't throw. |
| `main/documentFiles.test.ts` | Real temp folder and fake dialogs. Requests that aren't valid fail before any dialog. Open: cancel, too big, a folder, a recent path not on the list refused, and each `staleRecents` entry. Save: an unknown path refused, the same stamp writes without asking, a changed stamp asks and each of Replace, Save As and Cancel does what it says, a deleted file is written again, a read-only file refused, a symlink kept, Save As grants and adds `.json`, write errors use the export words. |
| `main/fixtures/staleRecents.test.ts` | **Added.** The four entries are what they claim on disk. |
| `main/closeGate.test.ts` | Every row of the gate table. `windowTitle` per platform. `parseDocumentStatus` rejects junk. `askToSaveOptions` and `conflictOptions` map their buttons back. |
| `main/appMenu.test.ts` | Every `MenuCommandKind` has its id and accelerator on each platform. macOS has the app and Window menus. Empty recents show the greyed-out item. Reload only when not packaged. A click calls `send` with its command. |
| `renderer/src/editor/state.test.ts` | `replace` resets selection and size and makes the pattern saved. `saved` with an older pattern leaves the document unsaved and changes nothing else. A refused edit stays saved. The undo contract. |
| `renderer/src/file/commands.test.ts` | A real store and core, with a fake api. Save of Untitled asks where. Save of a saved document calls nothing. An edit during a held save stays unsaved. Two saves run in order, and the second is a no-op. Opening each hazard shows its words, asks nothing, and leaves `pattern` the same reference. Open while unsaved: Cancel keeps it, Save with a cancelled Save As keeps it, Don't Save replaces it. Close of a saved document answers true without asking. Close with unsaved edits and a failed save answers false with the disk-full words. A draft committed by `commitDraft` is what gets saved. |
| `renderer/src/file/messages.test.ts` | The exact words for each problem, and three issues then "and N more". |

New rules in `core/boundaries.test.ts`:

```ts
it('exports readPatternFile, writePatternFile and blankPattern', ...)
it.each(['upgrade', 'MIGRATIONS'])('keeps %s internal to the file format', ...)
it('reads pattern files only through readPatternFile outside core', ...)   // no main/ or renderer/ file imports parsePattern
it('keeps @core out of main', ...)                                          // M7 decision 6, now pinned, for non-test main files
```

Journey `file-io.mjs` with `features/file-io.md`. Native surfaces are stubbed or clicked through `app.evaluate`, the same exception the export
journey makes for the save dialog. That covers `dialog.showSaveDialog`, `showOpenDialog` and `showMessageBox`. The prompt stub answers by button
label (`options.buttons.indexOf(answer)`), so platform button order doesn't matter. Menu items are clicked by id through
`Menu.getApplicationMenu().getMenuItemById(id).click()`, which runs the same handler a user's click runs (**unverified**: the first step proves it).
Files are made and read with `node:fs` in the journey.

| Sub-feature | Proof |
|---|---|
| `file-title` | Launch shows "Untitled". An edit shows "Untitled — Edited" in the header and the platform's form in `BrowserWindow.getTitle()`. |
| `file-save-as` | File > Save As… with a stubbed path. The file parses, has the edit, ends in `\n` and has no `\r`. The header reads "Raglan", saved. |
| `file-save` | Another edit, then File > Save with `showSaveDialog` stubbed to throw: no dialog, the file is updated, and the document reads as saved. |
| `file-draft` | Type a formula without pressing Enter, then click `file-save`. The file has the typed formula. This proves the menu wiring and the draft commit. |
| `file-open-hazards` | The journey writes a truncated copy, a version-2 copy and a `"cutCount": "2"` copy. Opening each shows its exact alert, and the header name and a known cell are unchanged. None appears in Open Recent. |
| `file-recents` | Open Recent lists Raglan once after two saves. Rename it on disk and click it: the "isn't there any more" alert shows, and the entry is gone. |
| `file-changed-on-disk` | Rewrite the open file from the journey, edit, Save, and answer Cancel: the file still has the journey's bytes. Again with Replace: it has the user's version. |
| `file-unsaved-open` | With unsaved edits, open a good file and answer Cancel: nothing changes. Again with Don't Save: the other file shows, saved. |
| `file-close` | Last. With unsaved edits, `BrowserWindow.close()` (what the close button does) and answer Cancel: the window stays. Then Save: the file is written and the window closes. |
| `file-console` | No renderer errors, and CSP clean. |

Every existing journey is re-run after the teardown change, since all of them now end with unsaved edits.

## Synthesis decision

Two candidates, on the configured panel. Candidate 1 (Opus) had a serial command runner over an external store, a draft commit before every
command, strict schemas with a literal version, a native prompt, real paths with an allowlist, and a header File menu beside the native one.
Candidate 2 (Sonnet) had a single-flight flow table over `useReducer` and a ref, a one-line `.max` on `version` plus a raw-against-parsed lossless
walker, a renderer-drawn prompt, opaque file handles, and the native menu as the only surface.

**Base: candidate 1,** by agreement between the cross-judge (Sonnet, 23 to 22) and my own read. The gap is in the two criteria the milestone
exists for. Candidate 1's strict schema stops stripping on every path, not just the file reader. Its draft commit means a typed but uncommitted
formula is asked about on close and included in a menu Save, and candidate 2 lost it silently. Its teardown change keeps every existing journey
from hanging on the new prompt, which candidate 2 missed.

Grafts from candidate 2:

- The read-only check before overwriting, from its experiment showing the rename replaces a `444` file.
- Canonical `values` order on write, from its `addSize` experiment.
- Replace, Save As… and Cancel when a file changed on disk, instead of Replace and Cancel.
- The measured quit facts: a prevented close cancels the quit, and a second `quit()` goes through.
- Stamps kept in main, beside the path, instead of round-tripping through the renderer.
- The gate's `ready` flag, so a window closed before the renderer listens closes normally.
- The native menu as the only command surface, which drops candidate 1's header File menu.
- An `empty` problem kind, `.json` as the extension, and saving a pattern with evaluation issues, named and tested.

Trimmed from candidate 1, on the cross-judge's advice:

- UTF-16 decoding. It's refused now, with words that say how to fix it.
- Line and column parsing of V8's message. It became an engine-independent `cutShort` and the engine's own sentence.

The `did-start-navigation` reset is now main-frame only.

Rejected from candidate 2:

- **The lossless walker.** It protects only callers that remember to run it, and the strict schema protects every caller.
- **Opaque handles.** The title and proxy icon need paths anyway, and the allowlist gives the same guarantee with one check.
- **The renderer-drawn prompt.** It's invisible with the window minimized during Cmd+Q, and it would hang every existing journey's teardown.
- **Dropping commands while busy.** A second Cmd+S after an edit would be silently lost. A queue keeps it.
- **`unresponsive` letting a close through.** That closes a document with unsaved edits on a guess.
- **`markOpened`.** Deriving recents from the status push is one rule, not a second call per open.

Rejected from the cross-judge: deferring the external store. The draft commit needs a synchronous read after `blur()`, which a ref over
`useReducer` can't give before the next render.

Both candidates converged on:
- The renderer owns the document, and unsaved is a reference comparison.
- Close always asks the renderer.
- Open reads and parses before asking.
- Bare `Pattern` JSON with no envelope, and core's `readPatternFile` as the one decoder.
- Main stays free of `@core`.
- The version is checked before parsing, and a migrations table pins its length.
- Stamps are checked at save, with no file watcher.
- `realpath` before the atomic write.
- Recents live in `userData`, written in a chain, with ENOENT forgetting the entry.
- No opening from the OS in M8.

Verification: the fixture tests pass on today's code, typecheck is clean, and nothing else is built yet.

## Tradeoffs accepted

- We accept that an edit followed by its exact reverse still reads as unsaved, in exchange for an unsaved check that is one reference comparison
  and that a future undo stack makes exact.
- We accept a strict schema that refuses a hand-edited file with one harmless extra key, in exchange for no code path ever deleting data it
  didn't understand.
- We accept one IPC round trip on every close, in exchange for committing half-typed cells and never trusting a stale flag.
- We accept that a hung renderer can't close its window, in exchange for main never closing a document with unsaved edits on a guess.
- We accept quitting when the window closes on macOS, in exchange for no window-less state that menus must handle.
- We accept that main can't tell a damaged file from a good one, in exchange for main never loading core, zod or mathjs.
- We accept reading and parsing before asking about unsaved edits, so the question comes after the open dialog, in exchange for never asking
  about a file that won't open.
- We accept moving the reducer behind an external store, in exchange for a runner that reads the state synchronously after a draft commits.
- We accept a native menu as the only way to open and save, in exchange for one surface with the platform's shortcuts. A journey has to click it
  through main.
- We accept a `stat` race in the changed-on-disk check, in exchange for no file watching.
- We accept that dev reload discards edits, in exchange for no `beforeunload` handshake.
- We accept two app instances overwriting each other's recent list, in exchange for no single-instance lock before file association exists.

## Alternatives considered

- **Main owns the path and the unsaved flag, the renderer pushes state, and main decides close alone.** Close would need no round trip, and a hung
  renderer couldn't block it. It lost because main's copy can lag the last edit, a half-typed cell is invisible to it, and two processes would
  hold one fact. The guard for Open lives in the renderer either way.
- **Parse in main with `@core`.** Main could refuse a bad file before any bytes cross. It brings zod, mathjs, the ESM-only clipper2-ts and pdf-lib
  into a main bundle CI doesn't build, which M7 rejected for the same reason, and it hides nothing the renderer can't do.
- **An envelope `{ format, formatVersion, name, pattern }`.** It would name and identify files without guessing. It lost because it's a second
  version to keep in step, the name already lives in the file name, and Convex stores the bare pattern.
- **Compare the raw JSON with the parsed result to catch stripped keys.** It protects only callers that remember to compare. A strict schema
  protects every caller, so the lesson lives in structure.
- **A renderer-drawn Save, Don't Save, Cancel.** A journey could drive it by role without stubs. It lost because Cmd+Q and the close button
  start in main, and it's invisible when the window is minimized.
- **Ask before reading** (the usual order). A damaged file would still make the user decide about saving first.
- **Opaque handles instead of paths.** Safer in theory, but the title, the proxy icon and the export name need paths, and the allowlist gives the
  same guarantee.
- **A header File menu beside the native one.** More discoverable, and a journey could click it by role. It's a second surface for every
  command, and M9's start screen is the better home for a visible recent list.

## Open questions and risks

- Does `element.blur()` commit a cell through React 19's `onBlur` synchronously? The design relies on it. The `file-draft` journey step proves
  it, and `commitDraft` can use `flushSync` if not.
- Does `win.destroy()` skip `close` in Electron 45, so journey teardown can't hang? That's checked first, before the guard lands.
- Does `MenuItem.click()` called from `app.evaluate` run the item's handler? The journey's first step proves it. If not, the journey needs
  another way in, and a header button is the fallback.
- Is quitting when the window closes acceptable to macOS users? This is in open questions.
- Should the Windows log-off and shutdown path (`query-session-end`) ask about unsaved edits? It isn't handled.
- An atomic write that crashes leaves a hidden `.Raglan.json.<hex>.tmp` beside the file. Nothing cleans these up.
- GTK's open dialog filters may be case-sensitive, so `RAGLAN.JSON` may be hidden under the Pattern filter (**unverified**). All files is offered.
- Should CI run on macOS and Windows now that recents and titles branch per OS? The pure functions take the platform as a parameter, so Ubuntu
  covers the logic, but not Electron's dialogs.
- When Convex sync (M8b) and a file hold the same pattern, `file` and `saved` give a natural "last synced" baseline. That's M8b's design.

## Build order

Each step keeps tests and typecheck green.

1. `run.mjs` teardown that destroys windows, checked against every existing journey.
2. `/blast-radius`, then the strict schema and literal version in `model.ts`, with `model.test.ts` and the two flipped fixture tests.
3. `migrations.ts` and `patternFile.ts` with `/tdd` against the fixtures, then `blankPattern`, exports and boundary rules. Switch the fixture's
   `fileText` to `writePatternFile`.
4. Move the words and the dialog routine to `main/files.ts`. `saveExport.test.ts` stays green untouched.
5. `knownFiles.ts`, then `documentFiles.ts`, against real temp folders and `staleRecents`.
6. `closeGate.ts`, `appMenu.ts`.
7. The preload channels, `documentWindow.ts`, and the `index.ts` wiring.
8. `editor/store.ts`, the three actions, `file/commands.ts` and `file/messages.ts`.
9. The header name, notice, export title and status effect in `App.tsx`.
10. `features/file-io.md`, `journeys/file-io.mjs`, the README list, and the `CLAUDE.md` paragraph.

## Next implementation step

Change `run.mjs` teardown to destroy windows before `app.close()` and re-run every journey. Then run `/blast-radius` on making `PatternSchema`
strict with a literal version.
