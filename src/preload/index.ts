import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from './api'

// The renderer never touches Node or the filesystem directly; everything goes through this bridge.
const api: Api = {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  saveExport: (request) => ipcRenderer.invoke('export:save', request)
}

contextBridge.exposeInMainWorld('api', api)
