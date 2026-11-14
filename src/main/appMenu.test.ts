import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { FileCommand } from '../preload/api'
import { menuTemplate } from './appMenu'

function flatten(items: readonly MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? flatten(item.submenu) : [])])
}

function build(platform: NodeJS.Platform, recents: readonly string[] = [], packaged = true) {
  const send = vi.fn<(command: FileCommand) => void>()
  const clearRecents = vi.fn()
  const items = flatten(menuTemplate({ platform, packaged, recents }, { send, clearRecents }))
  const byId = (id: string) => items.find((item) => item.id === id)
  const click = (id: string) => (byId(id)?.click as (() => void) | undefined)?.()
  return { items, byId, click, send, clearRecents }
}

describe('menuTemplate', () => {
  it.each(['darwin', 'win32', 'linux'] as const)('has every file command with its shortcut on %s, each sending its command', (platform) => {
    const menu = build(platform)
    for (const [kind, accelerator] of [['new', 'CmdOrCtrl+N'], ['open', 'CmdOrCtrl+O'], ['save', 'CmdOrCtrl+S'], ['saveAs', 'CmdOrCtrl+Shift+S']] as const) {
      expect(menu.byId(`file-${kind}`)?.accelerator).toBe(accelerator)
      menu.click(`file-${kind}`)
      expect(menu.send).toHaveBeenLastCalledWith({ kind })
    }
  })

  it('has the app and Window menus and Close Window on macOS only, and Exit elsewhere', () => {
    const roles = (platform: NodeJS.Platform) => build(platform).items.map((item) => item.role).filter(Boolean)
    expect(roles('darwin')).toEqual(expect.arrayContaining(['appMenu', 'windowMenu', 'close', 'editMenu']))
    expect(roles('win32')).not.toContain('appMenu')
    expect(roles('linux')).toEqual(expect.arrayContaining(['quit', 'editMenu']))
  })

  it('lists recent files by name and folder, opens one, and clears them', () => {
    const menu = build('linux', ['/home/me/Raglan.json', '/home/me/old/Tee.json'])
    expect(menu.byId('file-recent-0')?.label).toBe('Raglan.json — /home/me')
    menu.click('file-recent-1')
    expect(menu.send).toHaveBeenLastCalledWith({ kind: 'openRecent', path: '/home/me/old/Tee.json' })
    menu.click('file-recent-clear')
    expect(menu.clearRecents).toHaveBeenCalled()
  })

  it('shows a greyed-out item when there are no recent files', () => {
    expect(build('linux').byId('file-recent-none')).toMatchObject({ label: 'No Recent Files', enabled: false })
  })

  it('offers Reload only in development', () => {
    expect(build('linux', [], true).items.some((item) => item.role === 'reload')).toBe(false)
    expect(build('linux', [], false).items.some((item) => item.role === 'reload')).toBe(true)
  })
})
