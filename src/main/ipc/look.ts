// Milestone 6: the handlers for src/shared/contracts/look.ts (the Look and focus part). Focus mode asks the
// window to fill the screen; leaving puts it back as it was (maximised or not), unless it already filled the
// screen before focus mode began.
import { BrowserWindow } from 'electron'
import type { Handlers } from './index'
import type { LookApi } from '@shared/contracts/look'
import { emit } from '../events'

/** Windows that focus mode made fill the screen (so leaving it only undoes what it did). */
const madeFull = new WeakSet<BrowserWindow>()
/** Windows whose going in and out of full screen is reported to the interface. */
const watched = new WeakSet<BrowserWindow>()

/** The app's window (it has one). */
const mainWindow = (): BrowserWindow | null => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null

function watch(win: BrowserWindow): void {
  if (watched.has(win)) return
  watched.add(win)
  win.on('enter-full-screen', () => emit('look:fullScreen', { on: true }))
  win.on('leave-full-screen', () => {
    madeFull.delete(win)
    emit('look:fullScreen', { on: false })
  })
}

export const lookHandlers: Handlers<keyof LookApi> = {
  setFullScreen: (on) => {
    const win = mainWindow()
    if (!win) return false
    watch(win)
    if (on) {
      if (!win.isFullScreen()) {
        madeFull.add(win)
        win.setFullScreen(true)
      }
    } else if (madeFull.has(win)) {
      madeFull.delete(win)
      win.setFullScreen(false)
    }
    return win.isFullScreen()
  }
}
