import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { writeAtomically } from './atomicWrite'
import { runSaveExport } from './saveExport'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Parametric Pattern Maker',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Pinch zooms the canvas, not the whole UI.
  void win.webContents.setVisualZoomLevelLimits(1, 1)

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('app:getVersion', () => app.getVersion())

ipcMain.handle('export:save', (event, request: unknown) =>
  runSaveExport(request, {
    // Read off the module at call time, so a journey can stub the dialog.
    chooseFile: (options) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options)
    },
    write: writeAtomically,
    documentsDir: app.getPath('documents')
  })
)

void app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
