import { contextBridge, ipcRenderer } from 'electron'
import type { Bridge, PaintedTheme } from '@shared/api'

/** The theme main opened the window in (passed as --aiwrite-theme=...). */
function initialTheme(): PaintedTheme {
  const arg = process.argv.find((a) => a.startsWith('--aiwrite-theme='))?.split('=')[1]
  return arg === 'dark' || arg === 'sepia' ? arg : 'light'
}

const bridge: Bridge = {
  invoke: (method, ...args) => ipcRenderer.invoke(`api:${method}`, ...args),
  on: (event, listener) => {
    const channel = `event:${event}`
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown): void => listener(payload as never)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
  platform: process.platform,
  initialTheme: initialTheme()
}

contextBridge.exposeInMainWorld('aiwrite', bridge)
