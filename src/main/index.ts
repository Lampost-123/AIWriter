import { app, BrowserWindow, shell, nativeTheme } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { closeWorld, openWorld } from './world'
import { getSettings } from './settings'
import { waitForFlush } from './flush'
import { initBackups } from './services/backups'
import { initUpdater } from './services/updater'
import { initAi } from './ai'

if (process.env.AIWRITE_DATA_DIR) app.setPath('userData', join(process.env.AIWRITE_DATA_DIR, 'app'))

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let quitting = false

function backgroundFor(): string {
  const theme = getSettings().theme
  if (theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)) return '#1b1a19'
  if (theme === 'sepia') return '#f4ecd8'
  return '#fbfaf8'
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'AI Write',
    backgroundColor: backgroundFor(),
    autoHideMenuBar: true,
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })

  // Show only once the first frame is painted, so there's no white flash.
  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Before closing, let the interface save anything still pending.
  mainWindow.on('close', (e) => {
    if (quitting || !mainWindow) return
    e.preventDefault()
    quitting = true
    mainWindow.webContents.send('event:app:flush', {})
    void waitForFlush(2000).then(() => {
      closeWorld()
      mainWindow?.destroy()
      app.quit()
    })
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(() => {
  app.setAppUserModelId('com.lampost.aiwrite')
  registerIpc()
  initBackups()
  initAi()
  // Reopen the last world straight away, so the page is ready as soon as the window shows.
  const last = getSettings().lastWorldId
  if (last) {
    try {
      openWorld(last)
    } catch (e) {
      console.warn('Could not reopen the last world', e)
    }
  }
  createWindow()
  initUpdater()
})

app.on('before-quit', () => {
  quitting = true
})

app.on('window-all-closed', () => {
  closeWorld()
  app.quit()
})
