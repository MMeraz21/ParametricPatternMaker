// Journey for features/file-io.md. Run with:
//   node .agents/skills/verify-pattern-maker/scripts/run.mjs .agents/skills/verify-pattern-maker/journeys/file-io.mjs
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Polls until `test` is true, so a check waits for the app rather than a fixed delay. */
async function until(test, what, timeout = 5000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await test().catch(() => false)) return
    await sleep(50)
  }
  throw new Error(`Timed out waiting for ${what}`)
}

export default async function fileIoJourney({ app, window, evidence, rendererErrors }) {
  const folder = mkdtempSync(join(tmpdir(), 'ppm-file-io-'))
  const raglanPath = join(folder, 'Raglan.json')
  const otherPath = join(folder, 'Other.json')
  const header = () => window.getByLabel('Document').textContent()
  const formula = window.getByLabel('chest_ease formula', { exact: true })
  const fileText = (path) => readFileSync(path, 'utf8')
  /** evidence.check compares with ===, so lists are compared as text. */
  const listed = (items) => items.join(' | ')
  const chestEaseIn = (path) => JSON.parse(fileText(path)).variables.find((v) => v.name === 'chest_ease')?.formula

  /** Clicks a native menu item through main: the same handler a user's click runs. Playwright can't see native menus. */
  const clickMenu = (id) =>
    app.evaluate(({ Menu }, itemId) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
      if (!item) throw new Error(`No menu item ${itemId}`)
      item.click()
    }, id)
  const menuLabels = () =>
    app.evaluate(({ Menu }) => (Menu.getApplicationMenu()?.getMenuItemById('file-recent')?.submenu?.items ?? []).filter((item) => item.id?.match(/^file-recent-\d/)).map((item) => item.label))
  const nativeTitle = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle())

  // The native dialogs are the only things a journey can't click. Each stub records what it was asked.
  const answerSave = (reply) =>
    app.evaluate(({ dialog }, answer) => {
      globalThis.__saveDialogs = 0
      dialog.showSaveDialog = async () => {
        globalThis.__saveDialogs += 1
        return answer
      }
    }, reply)
  const answerOpen = (path) =>
    app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] })
    }, path)
  const answerPrompt = (label) =>
    app.evaluate(({ dialog }, button) => {
      globalThis.__prompts = []
      dialog.showMessageBox = async (first, second) => {
        const options = second ?? first
        globalThis.__prompts.push(options.message)
        return { response: options.buttons.indexOf(button), checkboxChecked: false }
      }
    }, label)
  const prompts = () => app.evaluate(() => globalThis.__prompts ?? [])
  const editChestEase = async (value) => {
    await formula.fill(value)
    await formula.press('Enter')
  }

  try {
    await window.getByRole('button', { name: 'Point HPS', exact: true }).waitFor()
    await window.getByRole('tab', { name: 'Variables' }).click()

    // file-title
    evidence.check('file-title: launch is untitled and saved', await header(), 'Untitled')
    await editChestEase('120')
    evidence.check('file-title: an edit marks it', await header(), 'Untitled — Edited')
    await until(async () => (process.platform === 'darwin' ? true : (await nativeTitle()).startsWith('*')), 'the title bar to show the edit')
    evidence.check('file-title: the title bar shows it', await nativeTitle(), process.platform === 'darwin' ? 'Untitled' : '*Untitled - Parametric Pattern Maker')
    if (process.platform === 'darwin') {
      evidence.check('file-title: macOS edited dot', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isDocumentEdited()), true)
    }

    // file-save-as
    await answerSave({ canceled: false, filePath: raglanPath })
    await clickMenu('file-save')
    await until(async () => (await header()) === 'Raglan', 'the header to name the saved file')
    evidence.check('file-save-as: untitled Save asked where', await app.evaluate(() => globalThis.__saveDialogs), 1)
    evidence.check('file-save-as: the file has the edit', chestEaseIn(raglanPath), '120')
    evidence.check('file-save-as: LF only, one final newline', /\r/.test(fileText(raglanPath)) === false && fileText(raglanPath).endsWith('}\n'), true)
    evidence.check('file-save-as: the header reads saved', await header(), 'Raglan')
    await evidence.screenshot(window, 'file-saved')

    // file-save
    await editChestEase('130')
    await answerSave({ canceled: true })
    await clickMenu('file-save')
    await until(async () => chestEaseIn(raglanPath) === '130', 'the file to be written in place')
    evidence.check('file-save: no dialog for a known file', await app.evaluate(() => globalThis.__saveDialogs), 0)
    await until(async () => (await header()) === 'Raglan', 'the header to read saved')

    // file-draft
    await formula.fill('140')
    await clickMenu('file-save')
    await until(async () => chestEaseIn(raglanPath) === '140', 'the typed draft to be saved')
    evidence.check('file-draft: a typed but uncommitted formula is saved', chestEaseIn(raglanPath), '140')
    evidence.check('file-draft: the document reads saved', await header(), 'Raglan')

    // file-recents
    evidence.check('file-recents: the saved file is listed once', listed(await menuLabels()), `Raglan.json — ${folder}`)

    // file-open-hazards
    const saved = fileText(raglanPath)
    const hazards = [
      ['Truncated.json', saved.slice(0, saved.length / 2), "Truncated.json is damaged. It ends too early, so it may have been cut off while saving or copying."],
      ['Newer.json', saved.replace('"version": 1', '"version": 2'), 'Newer.json was made by a newer version of Parametric Pattern Maker (format 2). Update the app to open it.'],
      ['WrongType.json', saved.replace('"cutCount": 2', '"cutCount": "2"'), "WrongType.json can't be opened: pieces[2].cutCount: Invalid input: expected number, received string."]
    ]
    for (const [name, content, words] of hazards) {
      writeFileSync(join(folder, name), content)
      await answerOpen(join(folder, name))
      await clickMenu('file-open')
      await window.getByRole('alert').filter({ hasText: words }).waitFor()
      evidence.check(`file-open-hazards: ${name} says why`, await window.getByRole('alert').locator('p').textContent(), words)
      evidence.check(`file-open-hazards: ${name} leaves the document`, listed([await header(), await formula.inputValue()]), 'Raglan | 140')
    }
    await evidence.aria(window, 'file-hazard-alert')
    evidence.check('file-open-hazards: none is listed in recents', listed(await menuLabels()), `Raglan.json — ${folder}`)

    // file-unsaved-open
    writeFileSync(otherPath, saved)
    await editChestEase('150')
    await answerOpen(otherPath)
    await answerPrompt('Cancel')
    await clickMenu('file-open')
    await until(async () => (await prompts()).length === 1, 'the unsaved-changes prompt')
    evidence.check('file-unsaved-open: asks about Raglan', (await prompts())[0], 'Do you want to save the changes you made to Raglan?')
    await sleep(200)
    evidence.check('file-unsaved-open: Cancel keeps the edit', listed([await header(), await formula.inputValue()]), 'Raglan — Edited | 150')
    await answerPrompt("Don't Save")
    await clickMenu('file-open')
    await until(async () => (await header()) === 'Other', 'the other file to open')
    // A new document starts on the first tab.
    await window.getByRole('tab', { name: 'Variables' }).click()
    evidence.check("file-unsaved-open: Don't Save opens the other file, saved", listed([await header(), await formula.inputValue()]), 'Other | 140')
    evidence.check('file-unsaved-open: the edit was not written', chestEaseIn(raglanPath), '140')
    await until(async () => (await menuLabels()).length === 2, 'Other to join the recent list')
    evidence.check('file-recents: newest first', listed(await menuLabels()), `Other.json — ${folder} | Raglan.json — ${folder}`)

    // file-recents, stale entry
    renameSync(raglanPath, join(folder, 'Moved.json'))
    await clickMenu('file-recent-1')
    const gone = "Raglan.json isn't there any more. It may have been moved, renamed or deleted. It's been removed from recent files."
    await window.getByRole('alert').filter({ hasText: gone }).waitFor()
    evidence.check('file-recents: a renamed file says so', await window.getByRole('alert').locator('p').textContent(), gone)
    await until(async () => (await menuLabels()).length === 1, 'the stale entry to leave the menu')
    evidence.check('file-recents: and leaves the list', listed(await menuLabels()), `Other.json — ${folder}`)
    evidence.check('file-recents: the open document is untouched', await header(), 'Other')

    // file-changed-on-disk
    await editChestEase('160')
    writeFileSync(otherPath, saved.replace('"chest_ease",\n      "formula": "140"', '"chest_ease",\n      "formula": "999"'))
    const later = new Date(Date.now() + 10_000)
    utimesSync(otherPath, later, later)
    const theirs = fileText(otherPath)
    await answerPrompt('Cancel')
    await clickMenu('file-save')
    await until(async () => (await prompts()).length === 1, 'the changed-on-disk prompt')
    evidence.check('file-changed-on-disk: asks', (await prompts())[0], 'Other.json was changed by another program since you opened it.')
    await sleep(200)
    evidence.check('file-changed-on-disk: Cancel writes nothing', fileText(otherPath) === theirs, true)
    await answerPrompt('Replace')
    await clickMenu('file-save')
    await until(async () => chestEaseIn(otherPath) === '160', 'Replace to write the user’s version')
    evidence.check('file-changed-on-disk: Replace writes the user’s version', chestEaseIn(otherPath), '160')

    // file-console, before the window closes
    evidence.check('file-console: no renderer errors', rendererErrors.length, 0)
    await evidence.screenshot(window, 'file-before-close')

    // file-close
    await editChestEase('170')
    await answerPrompt('Cancel')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    await until(async () => (await prompts()).length === 1, 'the close prompt')
    await sleep(200)
    evidence.check('file-close: Cancel keeps the window', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1)
    await answerPrompt('Save')
    const quit = app.waitForEvent('close', { timeout: 10_000 }).then(() => true, () => false)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    evidence.check('file-close: the window closes and the app quits', await quit, true)
    evidence.check('file-close: Save wrote the file first', existsSync(otherPath) && chestEaseIn(otherPath), '170')
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}
