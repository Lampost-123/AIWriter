import { contextBridge, ipcRenderer } from 'electron'
import type { Bridge, PaintedTheme } from '@shared/api'
import { accentIdOf, lookOf } from '@shared/contracts/look'

/** The theme main opened the window in (passed as --aiwrite-theme=...). */
function initialTheme(): PaintedTheme {
  const arg = process.argv.find((a) => a.startsWith('--aiwrite-theme='))?.split('=')[1]
  return arg === 'dark' || arg === 'sepia' ? arg : 'light'
}

/** The accent colour main opened the window in (--aiwrite-accent=...), null for the theme's own. */
const initialAccent = (): string | null => accentIdOf(process.argv.find((a) => a.startsWith('--aiwrite-accent='))?.split('=')[1])

/** The look main opened the window in (--aiwrite-look=...): the New look or Classic. */
const initialLook = (): 'new' | 'classic' => lookOf(process.argv.find((a) => a.startsWith('--aiwrite-look='))?.split('=')[1])

const bridge: Bridge = {
  invoke: (method, ...args) => ipcRenderer.invoke(`api:${method}`, ...args),
  on: (event, listener) => {
    const channel = `event:${event}`
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown): void => listener(payload as never)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
  platform: process.platform,
  initialTheme: initialTheme(),
  initialAccent: initialAccent(),
  initialLook: initialLook()
}

contextBridge.exposeInMainWorld('aiwrite', bridge)
