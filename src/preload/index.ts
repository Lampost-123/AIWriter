import { contextBridge, ipcRenderer } from 'electron'
import type { Bridge } from '@shared/api'

const bridge: Bridge = {
  invoke: (method, ...args) => ipcRenderer.invoke(`api:${method}`, ...args),
  on: (event, listener) => {
    const channel = `event:${event}`
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown): void => listener(payload as never)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('aiwrite', bridge)
