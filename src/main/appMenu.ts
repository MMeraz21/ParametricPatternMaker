import type { MenuItemConstructorOptions } from 'electron'
import type { FileCommand, MenuCommandKind } from '../preload/api'
import { bareName, folderOf } from './files'

/**
 * The application menu, as data. File commands go to the renderer through `send`, the one way to run them.
 * Design: docs/design/m8-file-io.md, decision 10.
 */

export interface MenuOptions {
  readonly platform: NodeJS.Platform
  readonly packaged: boolean
  readonly recents: readonly string[]
}

export interface MenuActions {
  readonly send: (command: FileCommand) => void
  readonly clearRecents: () => void
}

/** One row per command. A new MenuCommandKind fails the build until it's here. Ids let a journey click an item. */
const FILE_ITEMS: Readonly<Record<MenuCommandKind, { readonly label: string; readonly accelerator: string }>> = {
  new: { label: 'New', accelerator: 'CmdOrCtrl+N' },
  open: { label: 'Open…', accelerator: 'CmdOrCtrl+O' },
  save: { label: 'Save', accelerator: 'CmdOrCtrl+S' },
  saveAs: { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S' }
}

const fileItem = (kind: MenuCommandKind, send: MenuActions['send']): MenuItemConstructorOptions => ({
  id: `file-${kind}`,
  ...FILE_ITEMS[kind],
  click: () => send({ kind })
})

function recentItems(recents: readonly string[], actions: MenuActions): MenuItemConstructorOptions[] {
  if (recents.length === 0) return [{ id: 'file-recent-none', label: 'No Recent Files', enabled: false }]
  return [
    ...recents.map((path, i): MenuItemConstructorOptions => ({
      id: `file-recent-${i}`,
      label: `${bareName(path)} — ${folderOf(path)}`,
      click: () => actions.send({ kind: 'openRecent', path })
    })),
    { type: 'separator' },
    { id: 'file-recent-clear', label: 'Clear Menu', click: actions.clearRecents }
  ]
}

export function menuTemplate(options: MenuOptions, actions: MenuActions): MenuItemConstructorOptions[] {
  const mac = options.platform === 'darwin'
  const file: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      fileItem('new', actions.send),
      fileItem('open', actions.send),
      { id: 'file-recent', label: 'Open Recent', submenu: recentItems(options.recents, actions) },
      { type: 'separator' },
      fileItem('save', actions.send),
      fileItem('saveAs', actions.send),
      { type: 'separator' },
      mac ? { role: 'close', label: 'Close Window' } : { role: 'quit', label: 'Exit' }
    ]
  }
  const view: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { role: 'togglefullscreen' },
      // Reload discards unsaved edits without asking, so only development builds have it.
      ...(options.packaged ? [] : [{ type: 'separator' as const }, { role: 'reload' as const }, { role: 'toggleDevTools' as const }])
    ]
  }
  return [
    ...(mac ? [{ role: 'appMenu' as const }] : []),
    file,
    // macOS sends copy, paste and undo in text fields through the Edit menu.
    { role: 'editMenu' },
    view,
    ...(mac ? [{ role: 'windowMenu' as const }] : [])
  ]
}
