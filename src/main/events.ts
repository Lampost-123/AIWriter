import { BrowserWindow } from 'electron'
import type { AppEventName, AppEvents } from '@shared/api'

/** Sends an event to every open window. */
export function emit<E extends AppEventName>(event: E, payload: AppEvents[E]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(`event:${event}`, payload)
  }
}
