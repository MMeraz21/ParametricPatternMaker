import { blankPattern, readPatternFile, writePatternFile } from '@core'
import { documentName, isDirty } from '../editor/state'
import type { EditorStore } from '../editor/store'
import type { FileApi, FileCommand, OpenDocumentResult } from './bridge'
import { fileNameOf, problemText, unsavableText, upgradedText } from './messages'

/**
 * The one runner for every file command: menu clicks, shortcuts and the window's close button all come here. It runs one
 * command at a time, commits a half-typed cell first, and is the only code that calls the file channels, so nothing can skip
 * the unsaved-edits question. No React. Design: docs/design/m8-file-io.md, decisions 5 to 8.
 */

export interface FilePorts {
  readonly api: FileApi
  /** Ends any cell edit, so its draft commits through the store before the command reads it. */
  readonly commitDraft: () => void
}

export interface FileCommands {
  /** Queued behind any running command. Never rejects. */
  run(command: FileCommand): Promise<void>
  /** Resolves when the queue is empty. For tests. */
  idle(): Promise<void>
}

export function createFileCommands(store: EditorStore, { api, commitDraft }: FilePorts): FileCommands {
  const showError = (text: string): void => store.dispatch({ type: 'notice', notice: { tone: 'error', text } })

  /** true when the document was written. The pattern is captured before any await, so later edits stay unsaved. */
  async function save(choose: boolean): Promise<boolean> {
    const state = store.getState()
    const { pattern, file } = state
    if (!choose && file && !isDirty(state)) return true
    const encoded = writePatternFile(pattern)
    if (!encoded.ok) {
      showError(unsavableText(encoded.issues))
      return false
    }
    const result = await api.saveDocument(
      !choose && file ? { kind: 'overwrite', path: file.path, data: encoded.data } : { kind: 'choose', name: documentName(state), near: file?.path ?? null, data: encoded.data }
    )
    switch (result.kind) {
      case 'saved':
        store.dispatch({ type: 'saved', pattern, file: result.file })
        return true
      case 'cancelled':
        return false
      case 'failed':
        showError(result.message)
        return false
      default: {
        const _exhaustive: never = result
        return _exhaustive
      }
    }
  }

  /** May the current document go? Asks only when there are unsaved edits. */
  async function leave(): Promise<boolean> {
    const state = store.getState()
    if (!isDirty(state)) return true
    const choice = await api.askToSave(documentName(state))
    switch (choice) {
      case 'save':
        return save(false)
      case 'discard':
        return true
      case 'cancel':
        return false
      default: {
        const _exhaustive: never = choice
        return _exhaustive
      }
    }
  }

  /** Parses before asking, so a file that won't open never interrupts with a question or touches the document. */
  async function openRead(result: OpenDocumentResult): Promise<void> {
    if (result.kind === 'cancelled') return
    if (result.kind === 'failed') return showError(result.message)
    const fileName = fileNameOf(result.file.path)
    const read = readPatternFile(result.data)
    if (!read.ok) return showError(problemText(read.problem, fileName))
    if (!(await leave())) return
    const notice = read.upgradedFrom === null ? null : { tone: 'info' as const, text: upgradedText(fileName) }
    store.dispatch({ type: 'replace', pattern: read.pattern, file: result.file, notice })
  }

  async function perform(command: FileCommand): Promise<void> {
    commitDraft()
    store.dispatch({ type: 'notice', notice: null })
    const file = store.getState().file
    switch (command.kind) {
      case 'new':
        if (await leave()) store.dispatch({ type: 'replace', pattern: blankPattern(), file: null, notice: null })
        return
      case 'open':
        return openRead(await api.openDocument({ kind: 'choose', near: file?.path ?? null }))
      case 'openRecent':
        return openRead(await api.openDocument({ kind: 'recent', path: command.path }))
      case 'save':
        await save(false)
        return
      case 'saveAs':
        await save(true)
        return
      case 'close': {
        let proceed = false
        try {
          proceed = await leave()
        } finally {
          // Main is waiting: it always gets an answer, and an error keeps the window open.
          api.answerClose(proceed)
        }
        return
      }
      default: {
        const _exhaustive: never = command
        return _exhaustive
      }
    }
  }

  let tail: Promise<void> = Promise.resolve()
  return {
    run(command) {
      const next = tail.then(() => perform(command)).catch((error: unknown) => showError(`Something went wrong: ${String(error)}`))
      tail = next
      return next
    },
    idle: () => tail
  }
}
