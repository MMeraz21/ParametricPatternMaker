import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, type IpcMainInvokeEvent, type MessageBoxOptions } from 'electron'
import { menuTemplate } from './appMenu'
import { writeAtomically } from './atomicWrite'
import { answerOf, askToSavePrompt, conflictPrompt } from './closeGate'
import { runOpenDocument, runSaveDocument, type DocumentPorts } from './documentFiles'
import { createDocumentWindow, type DocumentWindow } from './documentWindow'
import { createKnownFiles, type KnownFiles } from './knownFiles'
import { readBytes, statFile, writeDocument } from './nodeFiles'
import { runSaveExport } from './saveExport'

let current: DocumentWindow | null = null

// Dialogs are read off the `dialog` module at call time, so a journey can stub them.
const ownerOf = (event: IpcMainInvokeEvent): BrowserWindow | null => BrowserWindow.fromWebContents(event.sender)
const showMessageBox = (owner: BrowserWindow | null, options: MessageBoxOptions) =>
  owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options)

function documentPorts(event: IpcMainInvokeEvent, known: KnownFiles): DocumentPorts {
  const owner = ownerOf(event)
  return {
    chooseOpen: (options) => {
      const withFile = { ...options, properties: ['openFile' as const] }
      return owner ? dialog.showOpenDialog(owner, withFile) : dialog.showOpenDialog(withFile)
    },
    chooseSave: (options) => (owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)),
    stat: statFile,
    readFile: readBytes,
    write: writeDocument,
    askConflict: async (fileName) => {
      const prompt = conflictPrompt(fileName)
      return answerOf(prompt, (await showMessageBox(owner, prompt.options)).response)
    },
    known,
    documentsDir: app.getPath('documents')
  }
}

function setMenu(known: KnownFiles): void {
  const send = (command: Parameters<DocumentWindow['send']>[0]): void => current?.send(command)
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate({ platform: process.platform, packaged: app.isPackaged, recents: known.recents() }, { send, clearRecents: known.clearRecents })))
}

function openWindow(known: KnownFiles): void {
  const opened = createDocumentWindow(known)
  current = opened
  opened.window.on('closed', () => {
    if (current === opened) current = null
  })
}

ipcMain.handle('app:getVersion', () => app.getVersion())

ipcMain.handle('export:save', (event, request: unknown) =>
  runSaveExport(request, {
    chooseFile: (options) => {
      const owner = ownerOf(event)
      return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
    },
    write: writeAtomically,
    documentsDir: app.getPath('documents')
  })
)

void app.whenReady().then(async () => {
  const storePath = join(app.getPath('userData'), 'recent-files.json')
  const files: KnownFiles = await createKnownFiles({
    load: () => readFile(storePath, 'utf8').catch(() => null),
    write: (data) => writeAtomically(storePath, data),
    platform: process.platform,
    onChange: () => setMenu(files),
    log: (message) => console.error(message)
  })

  ipcMain.handle('file:open', (event, request: unknown) => runOpenDocument(request, documentPorts(event, files)))
  ipcMain.handle('file:save', (event, request: unknown) => runSaveDocument(request, documentPorts(event, files)))
  ipcMain.handle('file:askToSave', async (event, name: unknown) => {
    const prompt = askToSavePrompt(typeof name === 'string' && name !== '' ? name : 'Untitled')
    return answerOf(prompt, (await showMessageBox(ownerOf(event), prompt.options)).response)
  })
  ipcMain.on('document:status', (event, raw: unknown) => {
    if (current?.window.webContents === event.sender) current.showStatus(raw)
  })
  ipcMain.on('file:closeAnswer', (event, proceed: unknown) => {
    if (current?.window.webContents === event.sender) current.answerClose(proceed === true)
  })

  setMenu(files)
  openWindow(files)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow(files)
  })
})

// One window is one document, so closing it quits on every OS, macOS included (docs/open-questions.md).
app.on('window-all-closed', () => app.quit())
