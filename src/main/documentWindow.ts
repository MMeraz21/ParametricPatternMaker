import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import type { DocumentStatus, FileCommand } from '../preload/api'
import { parseDocumentStatus, START_GATE, stepCloseGate, windowTitle, type CloseGate, type CloseGateEvent } from './closeGate'
import type { KnownFiles } from './knownFiles'

/**
 * The one window: creates it, owns its close gate and the status it shows, and forwards file commands to its renderer.
 * Electron glue only; the decisions are in closeGate.ts. Design: docs/design/m8-file-io.md, decisions 7 and 11.
 */

export interface DocumentWindow {
  readonly window: BrowserWindow
  /** What the renderer pushed on `document:status`. */
  showStatus(raw: unknown): void
  /** The renderer's reply to a `close` command. */
  answerClose(proceed: boolean): void
  /** Sends a file command to the renderer, once it's listening. */
  send(command: FileCommand): void
}

export function createDocumentWindow(known: KnownFiles): DocumentWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Untitled',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  let gate: CloseGate = START_GATE
  let status: DocumentStatus | null = null

  const step = (event: CloseGateEvent): void => {
    const next = stepCloseGate(gate, event)
    gate = next.gate
    switch (next.effect) {
      case 'close':
        window.close()
        return
      case 'close-and-quit':
        window.close()
        // The prevented close cancelled the first quit, so it has to be asked for again.
        app.quit()
        return
      case 'allow':
      case 'prevent':
      case 'prevent-and-ask':
      case 'none':
        return
      default: {
        const _exhaustive: never = next.effect
        return _exhaustive
      }
    }
  }

  window.on('close', (event) => {
    const next = stepCloseGate(gate, { kind: 'close-requested' })
    gate = next.gate
    if (next.effect === 'prevent' || next.effect === 'prevent-and-ask') event.preventDefault()
    if (next.effect === 'prevent-and-ask') window.webContents.send('file:command', { kind: 'close' } satisfies FileCommand)
  })
  const onBeforeQuit = (): void => step({ kind: 'before-quit' })
  app.on('before-quit', onBeforeQuit)
  window.on('closed', () => app.off('before-quit', onBeforeQuit))

  // A reload or a crash: the renderer that would answer is gone, and its status with it.
  window.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      status = null
      step({ kind: 'renderer-reset' })
    }
  })
  window.webContents.on('render-process-gone', () => step({ kind: 'renderer-reset' }))
  // Main is the only writer of the title.
  window.on('page-title-updated', (event) => event.preventDefault())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void window.loadURL(devUrl)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))

  return {
    window,
    showStatus(raw) {
      const next = parseDocumentStatus(raw)
      if (!next) return
      if (!gate.ready) step({ kind: 'renderer-ready' })
      status = next
      window.setTitle(windowTitle(next, process.platform))
      if (process.platform === 'darwin') {
        window.setDocumentEdited(next.dirty)
        window.setRepresentedFilename(next.path ?? '')
      }
      if (next.path !== null && known.allows(next.path)) known.showing(next.path)
    },
    answerClose: (proceed) => step({ kind: 'answered', proceed }),
    send(command) {
      if (gate.ready && status !== null) window.webContents.send('file:command', command)
    }
  }
}
