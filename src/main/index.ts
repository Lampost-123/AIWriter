import { app, BrowserWindow, dialog, Menu, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import type { PaintedTheme } from '@shared/api'
import { accentIdOf } from '@shared/contracts/look'
import { registerIpc } from './ipc'
import { closeWorld, openWorld } from './world'
import { getSettings } from './settings'
import { waitForFlush } from './flush'
import { initBackups } from './services/backups'
import { initUpdater } from './services/updater'
import { initAi } from './ai'
import { initKeeper } from './keeper'
import { activeDraftIds, stopDraft } from './ai/drafts'
import { stopAllTasks } from './ai/tasks'
import { registerPortraitScheme, servePortraits } from './portraits'
import { initHistory } from './history'
import { initSpeech, stopSpeech } from './speech'
import { purgeOldDeletedWorlds } from './library'
import { initSpelling } from './spelling'
import { contextMenuFor } from './spelling/menu'

if (process.env.AIWRITE_DATA_DIR) app.setPath('userData', join(process.env.AIWRITE_DATA_DIR, 'app'))
// App tests of dictation: Chromium's own pretend microphone (a beep), with no permission prompt.
if (process.env.AIWRITE_FAKE_MIC === '1') {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
}
registerPortraitScheme()

let mainWindow: BrowserWindow | null = null
/** True while pending saves are being flushed before quitting. */
let flushing = false
/** True once they are flushed and the world is closed: from then on the app may quit. */
let flushed = false

/** The theme the window opens in, so its very first frame is already the right colour. */
function startTheme(): PaintedTheme {
  let theme = 'system'
  try {
    theme = getSettings().theme
  } catch {
    /* fall back to the system's choice */
  }
  if (theme === 'light' || theme === 'dark' || theme === 'sepia') return theme
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

/** The accent colour the window opens in (milestone 6), as the theme: none for the theme's own. */
function startAccent(): string[] {
  try {
    const accent = accentIdOf(getSettings().accent)
    return accent ? [`--aiwrite-accent=${accent}`] : []
  } catch {
    return []
  }
}

/** Each theme's --bg colour in styles.css. */
const BACKGROUND: Record<PaintedTheme, string> = { light: '#f6f4f0', dark: '#161514', sepia: '#ece3cf' }

/** Shows the window if it is still hidden (the fallback when the interface never asks). */
function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show()
}

/** Keys that would reload the page (losing unsaved work and any draft being written) or open the developer tools. */
function isReloadOrDevToolsKey(input: Electron.Input): boolean {
  if (input.type !== 'keyDown') return false
  const key = input.key.toLowerCase()
  const mod = input.control || input.meta
  return key === 'f5' || key === 'f12' || (mod && key === 'r') || (mod && input.shift && (key === 'i' || key === 'j'))
}

/** A reload or a crash starts the interface afresh with nothing listening to a draft being written: stop it (its text is kept). */
function stopRunningDrafts(): void {
  for (const id of activeDraftIds()) void stopDraft(id).catch((e) => console.warn('Could not stop a draft', e))
  stopAllTasks()
}

function createWindow(): void {
  const theme = startTheme()
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'AI Write',
    backgroundColor: BACKGROUND[theme],
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      additionalArguments: [`--aiwrite-theme=${theme}`, ...startAccent()]
    }
  })
  mainWindow = win
  // No menu bar on Windows and Linux (Alt would otherwise show File / Edit / View with Reload).
  if (process.platform !== 'darwin') win.removeMenu()

  // The interface shows the window once its first frame is painted in the right theme (the
  // showWindow call), so nothing flashes. This is only the fallback, in case that never comes.
  win.once('ready-to-show', () => setTimeout(showMainWindow, 3000))

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // The window never leaves the app's own page (a file dropped on it would otherwise replace it).
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault()
    if (/^https?:/.test(url)) void shell.openExternal(url)
  })
  win.webContents.on('before-input-event', (e, input) => {
    if (!isReloadOrDevToolsKey(input)) return
    e.preventDefault()
    // Developers running from source can still open the developer tools.
    if (!app.isPackaged && input.key.toLowerCase() !== 'r' && input.key !== 'F5') win.webContents.toggleDevTools()
  })
  // The right-click menu for text (src/main/spelling/menu.ts): spelling, synonyms, Cut, Copy and Paste.
  win.webContents.on('context-menu', (_e, p) => {
    void contextMenuFor(win, p)
      .then((items) => {
        if (items.length && !win.isDestroyed()) Menu.buildFromTemplate(items).popup({ window: win })
      })
      .catch((e: unknown) => console.warn('Could not show the right-click menu', e))
  })

  let loaded = false
  win.webContents.once('did-finish-load', () => (loaded = true))
  win.webContents.on('did-start-navigation', (d) => {
    if (loaded && d.isMainFrame && !d.isSameDocument) stopRunningDrafts()
  })
  win.webContents.on('render-process-gone', stopRunningDrafts)

  // Every way of closing (the window's X, the Mac's Quit, an update restart) saves first.
  win.on('close', (e) => {
    if (flushed) return
    e.preventDefault()
    flushThenQuit()
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Lets the interface save anything still pending, closes the world, then quits. */
function flushThenQuit(): void {
  if (flushing) return
  flushing = true
  const win = mainWindow
  const finish = (): void => {
    flushed = true
    try {
      closeWorld()
    } catch (e) {
      console.error('Could not close the world cleanly', e)
    }
    try {
      stopSpeech()
    } catch (e) {
      console.error('Could not stop the speech server', e)
    }
    if (win && !win.isDestroyed()) win.destroy()
    app.quit()
  }
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return finish()
  win.webContents.send('event:app:flush', {})
  void waitForFlush(2000).then(finish)
}

function setAppMenu(): void {
  if (process.platform === 'darwin') {
    // The Mac needs a menu for Quit, Cut, Copy and Paste; there is no View menu (no Reload).
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]))
  } else {
    Menu.setApplicationMenu(null)
  }
}

function reopenLastWorld(): void {
  try {
    const last = getSettings().lastWorldId
    if (last) openWorld(last)
  } catch (e) {
    console.warn('Could not reopen the last world', e)
  }
}

function main(): void {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    } else if (app.isReady() && !flushing) {
      createWindow()
    }
  })

  app
    .whenReady()
    .then(() => {
      app.setAppUserModelId('com.lampost.aiwrite')
      setAppMenu()
      registerIpc()
      servePortraits()
      initBackups()
      initAi()
      initKeeper()
      initHistory()
      initSpeech()
      initSpelling()
      // Reopen the last world straight away, so the page is ready as soon as the window shows.
      reopenLastWorld()
      createWindow()
      initUpdater()
      // Deleted worlds past 30 days go for good; a moment after launch, so the first paint isn't kept waiting.
      setTimeout(() => void purgeOldDeletedWorlds(), 10_000).unref()
    })
    .catch((e: unknown) => {
      // Never leave an invisible AI Write running (it would block opening it again).
      console.error('AI Write could not start', e)
      dialog.showErrorBox(
        'AI Write could not start',
        `${e instanceof Error ? e.message : String(e)}\n\nTry opening AI Write again. If this keeps happening, restart your computer.`
      )
      try {
        closeWorld()
      } catch {
        /* already closed */
      }
      app.exit(1)
    })

  // Quit from a menu, Cmd+Q or an update restart: save first, then quit for real.
  app.on('before-quit', (e) => {
    if (flushed) return
    e.preventDefault()
    flushThenQuit()
  })

  app.on('window-all-closed', () => {
    closeWorld()
    stopSpeech()
    app.quit()
  })
}

// Only one AI Write runs at a time. A second copy hands over to the first (its 'second-instance'
// handler brings the window forward) and exits at once: app.quit() is not enough before 'ready',
// as the startup work (opening the world, tidying drafts) would still run.
if (app.requestSingleInstanceLock()) main()
else app.exit(0)
