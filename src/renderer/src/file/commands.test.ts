import { describe, expect, it, vi } from 'vitest'
import { blankPattern, readPatternFile, type PatternEdit } from '@core'
import { PATTERN_FILE_HAZARDS, type PatternFileHazard } from '@core/fixtures/patternFiles'
import { raglanTee } from '@core/fixtures/raglan'
import { initEditorState, isDirty } from '../editor/state'
import { createEditorStore } from '../editor/store'
import type { DocumentFile, FileApi, SaveChoice, SaveDocumentResult } from './bridge'
import { createFileCommands } from './commands'

const raglanFile: DocumentFile = { path: '/home/me/Raglan.json', name: 'Raglan' }
const otherFile: DocumentFile = { path: '/home/me/Other.json', name: 'Other' }
const setChestEase = (formula: string): PatternEdit => ({ kind: 'setFormula', owner: { kind: 'variable', name: 'chest_ease' }, formula })

function setup(options: { file?: DocumentFile | null; choice?: SaveChoice; save?: SaveDocumentResult } = {}) {
  const store = createEditorStore(initEditorState(raglanTee, 'M', options.file === undefined ? raglanFile : options.file))
  const held: ((result: SaveDocumentResult) => void)[] = []
  let holdNext = false
  const api = {
    openDocument: vi.fn<FileApi['openDocument']>(async () => ({ kind: 'cancelled' })),
    saveDocument: vi.fn<FileApi['saveDocument']>(async (request) => {
      if (holdNext) {
        holdNext = false
        return new Promise<SaveDocumentResult>((resolve) => held.push(resolve))
      }
      return options.save ?? { kind: 'saved', file: request.kind === 'overwrite' ? { path: request.path, name: 'Raglan' } : otherFile }
    }),
    askToSave: vi.fn<FileApi['askToSave']>(async () => options.choice ?? 'cancel'),
    answerClose: vi.fn<FileApi['answerClose']>()
  }
  const commitDraft = vi.fn()
  const files = createFileCommands(store, { api, commitDraft })
  const edit = (formula = '120'): void => store.dispatch({ type: 'edit', edit: setChestEase(formula) })
  const holdNextSave = (): ((result: SaveDocumentResult) => void) => {
    holdNext = true
    return (result) => held.shift()?.(result)
  }
  return { store, api, files, edit, commitDraft, holdNextSave }
}

const openReturns = (data: Uint8Array, file = otherFile) => ({ kind: 'read' as const, file, data })

describe('save', () => {
  it('asks where to save an untitled document, and then it is saved under the chosen name', async () => {
    const { store, api, files, edit } = setup({ file: null })
    edit()
    await files.run({ kind: 'save' })
    expect(api.saveDocument.mock.calls[0]?.[0]).toMatchObject({ kind: 'choose', name: 'Untitled', near: null })
    expect(store.getState().file).toEqual(otherFile)
    expect(isDirty(store.getState())).toBe(false)
  })

  it('writes a known file in place with the pattern it holds', async () => {
    const { store, api, files, edit } = setup()
    edit('77')
    await files.run({ kind: 'save' })
    const request = api.saveDocument.mock.calls[0]?.[0]
    expect(request).toMatchObject({ kind: 'overwrite', path: raglanFile.path })
    const written = request && readPatternFile(request.data)
    expect(written?.ok && written.pattern.variables[0]?.formula).toBe('77')
    expect(isDirty(store.getState())).toBe(false)
  })

  it('does nothing for a saved document', async () => {
    const { api, files } = setup()
    await files.run({ kind: 'save' })
    expect(api.saveDocument).not.toHaveBeenCalled()
  })

  it('Save As always asks, starting near the current file', async () => {
    const { api, files } = setup()
    await files.run({ kind: 'saveAs' })
    expect(api.saveDocument.mock.calls[0]?.[0]).toMatchObject({ kind: 'choose', name: 'Raglan', near: raglanFile.path })
  })

  it('keeps an edit made while the save is writing as unsaved', async () => {
    const { store, api, files, edit, holdNextSave } = setup()
    edit('120')
    const finish = holdNextSave()
    const saving = files.run({ kind: 'save' })
    await vi.waitFor(() => expect(api.saveDocument).toHaveBeenCalled())
    edit('130')
    finish({ kind: 'saved', file: raglanFile })
    await saving
    expect(isDirty(store.getState())).toBe(true)
    expect(store.getState().saved.variables[0]?.formula).toBe('120')
  })

  it('runs two saves in order, and the second has nothing left to do', async () => {
    const { api, files, edit } = setup()
    edit()
    await Promise.all([files.run({ kind: 'save' }), files.run({ kind: 'save' })])
    expect(api.saveDocument).toHaveBeenCalledTimes(1)
  })

  it('shows what went wrong and stays unsaved when the write fails', async () => {
    const { store, files, edit } = setup({ save: { kind: 'failed', message: 'The disk is full.' } })
    edit()
    await files.run({ kind: 'save' })
    expect(store.getState().notice).toEqual({ tone: 'error', text: 'The disk is full.' })
    expect(isDirty(store.getState())).toBe(true)
  })

  it('saves the draft a cell was holding', async () => {
    const { store, api, files, commitDraft } = setup()
    commitDraft.mockImplementation(() => store.dispatch({ type: 'edit', edit: setChestEase('99') }))
    await files.run({ kind: 'save' })
    const request = api.saveDocument.mock.calls[0]?.[0]
    const written = request && readPatternFile(request.data)
    expect(written?.ok && written.pattern.variables[0]?.formula).toBe('99')
  })
})

describe('open', () => {
  it('replaces a saved document without asking, at its first size', async () => {
    const { store, api, files } = setup()
    api.openDocument.mockResolvedValue(openReturns(PATTERN_FILE_HAZARDS.clean))
    store.dispatch({ type: 'showSize', size: 'XL' })
    await files.run({ kind: 'open' })
    expect(api.openDocument).toHaveBeenCalledWith({ kind: 'choose', near: raglanFile.path })
    expect(api.askToSave).not.toHaveBeenCalled()
    expect(store.getState()).toMatchObject({ file: otherFile, wantedSize: 'S', notice: null })
    expect(store.getState().pattern).toEqual(raglanTee)
    expect(isDirty(store.getState())).toBe(false)
  })

  it.each<[PatternFileHazard, string]>([
    ['truncated', 'Other.json is damaged. It ends too early, so it may have been cut off while saving or copying.'],
    ['wrongType', "Other.json can't be opened: pieces[2].cutCount: Invalid input: expected number, received string."],
    ['unknownField', 'Other.json can\'t be opened: pieces[2]: Unrecognized key: "lining".'],
    ['newerVersion', 'Other.json was made by a newer version of Parametric Pattern Maker (format 2). Update the app to open it.'],
    ['notAPattern', "Other.json isn't a pattern file."],
    ['empty', 'Other.json is empty.']
  ])('refuses %s with its words, asks nothing, and leaves the document alone', async (hazard, words) => {
    const { store, api, files, edit } = setup()
    edit()
    const before = store.getState().pattern
    api.openDocument.mockResolvedValue(openReturns(PATTERN_FILE_HAZARDS[hazard]))
    await files.run({ kind: 'open' })
    expect(store.getState().notice).toEqual({ tone: 'error', text: words })
    expect(store.getState().pattern).toBe(before)
    expect(store.getState().file).toEqual(raglanFile)
    expect(api.askToSave).not.toHaveBeenCalled()
  })

  it('shows what main said about a recent file that has gone', async () => {
    const { store, api, files } = setup()
    api.openDocument.mockResolvedValue({ kind: 'failed', message: "Gone.json isn't there any more." })
    await files.run({ kind: 'openRecent', path: '/home/me/Gone.json' })
    expect(api.openDocument).toHaveBeenCalledWith({ kind: 'recent', path: '/home/me/Gone.json' })
    expect(store.getState().notice?.text).toBe("Gone.json isn't there any more.")
  })

  it.each<[SaveChoice, SaveDocumentResult | undefined, boolean]>([
    ['cancel', undefined, false],
    ['discard', undefined, true],
    ['save', undefined, true],
    ['save', { kind: 'cancelled' }, false],
    ['save', { kind: 'failed', message: 'The disk is full.' }, false]
  ])('with unsaved edits, answering %s (save result %j) replaces the document: %s', async (choice, saveResult, replaced) => {
    const { store, api, files, edit } = setup({ choice, ...(saveResult ? { save: saveResult } : {}) })
    edit()
    api.openDocument.mockResolvedValue(openReturns(PATTERN_FILE_HAZARDS.clean))
    await files.run({ kind: 'open' })
    expect(api.askToSave).toHaveBeenCalledWith('Raglan')
    expect(store.getState().file).toEqual(replaced ? otherFile : raglanFile)
  })
})

describe('new', () => {
  it('asks first, then opens a blank untitled pattern', async () => {
    const { store, files, edit } = setup({ choice: 'discard' })
    edit()
    await files.run({ kind: 'new' })
    expect(store.getState()).toMatchObject({ pattern: blankPattern(), file: null })
    expect(isDirty(store.getState())).toBe(false)
  })
})

describe('close', () => {
  it('answers yes without asking when everything is saved', async () => {
    const { api, files } = setup()
    await files.run({ kind: 'close' })
    expect(api.askToSave).not.toHaveBeenCalled()
    expect(api.answerClose).toHaveBeenCalledWith(true)
  })

  it('asks about a draft that was only typed', async () => {
    const { store, api, files, commitDraft } = setup({ choice: 'cancel' })
    commitDraft.mockImplementation(() => store.dispatch({ type: 'edit', edit: setChestEase('99') }))
    await files.run({ kind: 'close' })
    expect(api.askToSave).toHaveBeenCalled()
    expect(api.answerClose).toHaveBeenCalledWith(false)
  })

  it('keeps the window open when saving fails, and says why', async () => {
    const { store, api, files, edit } = setup({ choice: 'save', save: { kind: 'failed', message: 'The disk is full.' } })
    edit()
    await files.run({ kind: 'close' })
    expect(api.answerClose).toHaveBeenCalledWith(false)
    expect(store.getState().notice?.text).toBe('The disk is full.')
  })

  it('always answers, even when something throws', async () => {
    const { store, api, files, edit } = setup()
    edit()
    api.askToSave.mockRejectedValue(new Error('no window'))
    await files.run({ kind: 'close' })
    expect(api.answerClose).toHaveBeenCalledWith(false)
    expect(store.getState().notice?.text).toContain('no window')
  })
})
