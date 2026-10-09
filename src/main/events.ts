import { BrowserWindow } from 'electron'
import type { AppEventName, AppEvents } from '@shared/api'

/** The phone window, when it is connected. The payload is the same one the desktop window gets. */
const phoneListeners = new Set<(event: string, payload: unknown) => void>()

export function onPhoneEvent(fn: (event: string, payload: unknown) => void): () => void {
  phoneListeners.add(fn)
  return () => phoneListeners.delete(fn)
}

/** Sends an event to every open window, and to the phone. */
export function emit<E extends AppEventName>(event: E, payload: AppEvents[E]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(`event:${event}`, payload)
  }
  for (const fn of phoneListeners) {
    try {
      fn(event, payload)
    } catch (err) {
      console.error(err)
    }
  }
}
