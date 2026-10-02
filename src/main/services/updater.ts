// Updates from GitHub Releases (electron-updater). The installed app checks on launch, downloads
// in the background, then offers "Restart to update". It never restarts on its own.
import { app } from 'electron'
import type { AppUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'
import { emit } from '../events'
import { UserError } from '../util'
import { describeUpdateError, releaseNotesText, UPDATES_DEV_ONLY } from './updateText'

const FIRST_CHECK_DELAY_MS = 5_000
const RECHECK_EVERY_MS = 6 * 60 * 60 * 1000

let status: UpdateStatus = { state: 'idle' }
let updater: AppUpdater | null = null
let checking: Promise<UpdateStatus> | null = null

function setStatus(next: UpdateStatus): void {
  // Once an update is downloaded, nothing (not even a later failed check) takes the offer away.
  if (status.state === 'ready' && next.state !== 'ready') return
  status = next
  emit('update:status', next)
}

export const getUpdateStatus = (): UpdateStatus => status

/** Loads electron-updater only in the installed app, and only when needed, so launch stays fast. */
async function load(): Promise<AppUpdater> {
  if (updater) return updater
  // electron-updater is CommonJS: depending on how it's loaded, its exports sit on the
  // namespace or on `default`.
  const mod = (await import('electron-updater')) as typeof import('electron-updater') & { default?: typeof import('electron-updater') }
  const autoUpdater = mod.default?.autoUpdater ?? mod.autoUpdater
  autoUpdater.logger = null // no console noise; problems surface as a status instead
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  let lastPercent = -1
  autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking' }))
  autoUpdater.on('update-available', () => {
    lastPercent = 0
    setStatus({ state: 'downloading', percent: 0 })
  })
  autoUpdater.on('download-progress', (p: { percent: number }) => {
    const percent = Math.max(0, Math.min(100, Math.floor(p.percent)))
    if (percent === lastPercent) return
    lastPercent = percent
    setStatus({ state: 'downloading', percent })
  })
  autoUpdater.on('update-not-available', () => setStatus({ state: 'none' }))
  autoUpdater.on('update-downloaded', (info: { version: string; releaseNotes?: string | { version?: string; note?: string | null }[] | null }) =>
    setStatus({ state: 'ready', version: info.version, notes: releaseNotesText(info.releaseNotes) })
  )
  autoUpdater.on('error', (e: unknown) => setStatus(describeUpdateError(e)))
  updater = autoUpdater
  return autoUpdater
}

export function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    status = { state: 'disabled', message: UPDATES_DEV_ONLY }
    return Promise.resolve(status)
  }
  if (status.state === 'ready' || status.state === 'downloading') return Promise.resolve(status)
  if (checking) return checking
  checking = (async (): Promise<UpdateStatus> => {
    try {
      const u = await load()
      setStatus({ state: 'checking' })
      const result = await u.checkForUpdates()
      // The download carries on in the background; its errors arrive through the 'error' event.
      result?.downloadPromise?.catch(() => undefined)
      if (!result) setStatus({ state: 'disabled', message: UPDATES_DEV_ONLY })
      else if (status.state === 'checking') setStatus(result.isUpdateAvailable ? { state: 'downloading', percent: 0 } : { state: 'none' })
    } catch (e) {
      setStatus(describeUpdateError(e))
    } finally {
      checking = null
    }
    return status
  })()
  return checking
}

/** Restarts into the downloaded update. Only ever called when Adam clicks "Restart to update". */
export async function installUpdate(): Promise<void> {
  if (status.state !== 'ready' || !updater) throw new UserError('There is no update ready to install yet. AI Write will tell you when one is.')
  const u = updater
  u.autoInstallOnAppQuit = true
  // Let this reply reach the window before the app starts closing.
  setTimeout(() => u.quitAndInstall(true, true), 50)
}

export function initUpdater(): void {
  if (!app.isPackaged) {
    status = { state: 'disabled', message: UPDATES_DEV_ONLY }
    return
  }
  setTimeout(() => void checkForUpdates(), FIRST_CHECK_DELAY_MS).unref()
  setInterval(() => void checkForUpdates(), RECHECK_EVERY_MS).unref()
}
