import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ApiMethod, AppApi, Bridge, IpcResult } from '@shared/api'

/** The repository root: the built app (out/) is launched from here. */
export const ROOT = resolve(__dirname, '..', '..')

export interface LaunchedApp {
  app: ElectronApplication
  win: Page
  /** The AIWRITE_DATA_DIR this run uses: app settings in app/, worlds in library/. */
  dataDir: string
  close(): Promise<void>
}

export interface LaunchOptions {
  /** Reuse a data folder (to test what survives a restart). A fresh temp folder by default. */
  dataDir?: string
  env?: Record<string, string>
}

export const newDataDir = (): string => mkdtempSync(join(tmpdir(), 'aiwrite-e2e-'))

/** Launches the built app with its own data folder and waits for the first window. */
export async function launchApp(opts: LaunchOptions = {}): Promise<LaunchedApp> {
  const dataDir = opts.dataDir ?? newDataDir()
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  delete env.ELECTRON_RUN_AS_NODE
  Object.assign(env, { AIWRITE_DATA_DIR: dataDir }, opts.env)
  const args = process.platform === 'linux' ? ['.', '--no-sandbox'] : ['.']
  const app = await electron.launch({ args, cwd: ROOT, env, timeout: 60_000 })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  let closed = false
  return {
    app,
    win,
    dataDir,
    close: async () => {
      if (closed) return
      closed = true
      await app.close().catch(() => undefined)
    }
  }
}

/** Closes the window the way Adam does (the X), so pending saves run first, and waits for the app to exit. */
export async function closeWindow(app: ElectronApplication): Promise<void> {
  const closed = new Promise<void>((r) => app.once('close', () => r()))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
}

/** Calls the app's API from the window, like the interface does. Throws the plain-words error on failure. */
export async function invoke<M extends ApiMethod>(win: Page, method: M, ...args: Parameters<AppApi[M]>): Promise<Awaited<ReturnType<AppApi[M]>>> {
  const res = (await win.evaluate(
    ([m, a]) => (globalThis as unknown as { aiwrite: Bridge }).aiwrite.invoke(m as ApiMethod, ...(a as unknown[])),
    [method, args] as const
  )) as IpcResult<unknown>
  if (!res.ok) throw new Error(res.error.message)
  return res.value as Awaited<ReturnType<AppApi[M]>>
}

/** Creates a world from the welcome screen and waits for the workspace. */
export async function createWorldFromWelcome(win: Page, name: string): Promise<void> {
  await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await win.getByLabel('World name').fill(name)
  await win.getByRole('button', { name: 'Create world' }).click()
  await expect(binder(win)).toBeVisible()
}

export const binder = (win: Page) => win.getByRole('complementary', { name: 'Binder' })

/** Opens a Settings page from the top bar. */
export async function openSettings(win: Page, tab: string): Promise<void> {
  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  await win.getByRole('navigation').getByRole('button', { name: tab }).click()
  await expect(win.getByRole('heading', { level: 1, name: tab })).toBeVisible()
}

/**
 * The test fixture: `launch()` starts the app; every app is closed afterwards, with a
 * screenshot of its window attached when the test failed, and temp data folders removed.
 */
export const test = base.extend<{ launch: (opts?: LaunchOptions) => Promise<LaunchedApp> }>({
  // eslint-disable-next-line no-empty-pattern
  launch: async ({}, use, testInfo) => {
    const apps: LaunchedApp[] = []
    const made = new Set<string>()
    await use(async (opts = {}) => {
      const a = await launchApp(opts)
      if (!opts.dataDir) made.add(a.dataDir)
      apps.push(a)
      return a
    })
    for (const a of apps) {
      if (testInfo.status !== testInfo.expectedStatus) {
        try {
          if (!a.win.isClosed()) await testInfo.attach('window', { body: await a.win.screenshot(), contentType: 'image/png' })
        } catch {
          /* the window may already be gone */
        }
      }
      await a.close()
    }
    for (const dir of made) rmSync(dir, { recursive: true, force: true })
  }
})

export { expect }
