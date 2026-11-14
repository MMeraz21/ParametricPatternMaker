import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api, FileCommand } from './api'

// The renderer never touches Node or the filesystem directly; everything goes through this bridge.
const api: Api = {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  saveExport: (request) => ipcRenderer.invoke('export:save', request),
  openDocument: (request) => ipcRenderer.invoke('file:open', request),
  saveDocument: (request) => ipcRenderer.invoke('file:save', request),
  askToSave: (name) => ipcRenderer.invoke('file:askToSave', name),
  setDocumentStatus: (status) => ipcRenderer.send('document:status', status),
  answerClose: (proceed) => ipcRenderer.send('file:closeAnswer', proceed),
  onFileCommand: (listener) => {
    // The listener gets the command only, never the IPC event, which would expose ipcRenderer.
    const handler = (_event: IpcRendererEvent, command: FileCommand): void => listener(command)
    ipcRenderer.on('file:command', handler)
    return () => void ipcRenderer.removeListener('file:command', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
