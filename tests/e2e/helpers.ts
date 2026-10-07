import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ApiMethod, AppApi, Bridge, IpcResult } from '@shared/api'
import type { FakeProvider } from '../fake-provider/server.mjs'

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
  /**
   * Writing by hand: false starts a fresh data folder with smart punctuation off, for tests that type straight
   * quotes and look for them as typed. On by default, as for Adam.
   */
  smartPunctuation?: boolean
}

export const newDataDir = (): string => mkdtempSync(join(tmpdir(), 'aiwrite-e2e-'))

/** Launches the built app with its own data folder and waits for the first window. */
export async function launchApp(opts: LaunchOptions = {}): Promise<LaunchedApp> {
  const dataDir = opts.dataDir ?? newDataDir()
  const settingsFile = join(dataDir, 'app', 'settings.json')
  if (opts.smartPunctuation === false && !existsSync(settingsFile)) {
    mkdirSync(join(dataDir, 'app'), { recursive: true })
    writeFileSync(settingsFile, JSON.stringify({ editor: { smartPunctuation: false } }))
  }
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  delete env.ELECTRON_RUN_AS_NODE
  // Check and repair (new AI words checked claim by claim as they land) is one more AI call after every draft: app tests
  // that aren't about it leave it out, and ask for it with { env: { AIWRITE_REPAIR: 'on' } }.
  env.AIWRITE_REPAIR = 'off'
  // A fresh data folder would show the first-run setup (milestone 6); app tests start at the start screen's
  // "Create a world" unless they ask for the setup with { env: { AIWRITE_SETUP: 'on' } }. A world reopened at
  // launch opens straight away, not under the start screen, unless they ask for it with { env: { AIWRITE_START: 'on' } }.
  // The New look: app tests start in Classic (today's layout), with no one-time note, unless they ask for the New
  // look with { env: { AIWRITE_LOOK: 'new' } } (or '' for what Adam gets: the New look, and the note after updating).
  // Run on Adam's PC, the window is see-through and never takes focus (main/index.ts), so he can use his PC
  // meanwhile; AIWRITE_BACKGROUND=off shows it. CI has no one to disturb.
  const background = process.env.AIWRITE_BACKGROUND ?? (process.env.CI ? 'off' : 'on')
  Object.assign(env, { AIWRITE_DATA_DIR: dataDir, AIWRITE_SETUP: 'off', AIWRITE_START: 'off', AIWRITE_LOOK: 'classic', AIWRITE_BACKGROUND: background }, opts.env)
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
  // Plain types for what crosses into the window: Playwright's types for evaluate's argument are worked out
  // over every API method otherwise, which made type checking slow and hungry as the API grew.
  const sent: [string, unknown[]] = [method, args as unknown[]]
  const res = (await win.evaluate(
    ([m, a]) => (globalThis as unknown as { aiwrite: Bridge }).aiwrite.invoke(m as ApiMethod, ...a),
    sent
  )) as IpcResult<unknown>
  if (!res.ok) throw new Error(res.error.message)
  return res.value as Awaited<ReturnType<AppApi[M]>>
}

/** Creates a world from the start screen (with no worlds yet) and waits for the workspace. */
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
 * screenshot of its window attached when the test failed, and their data folders removed.
 */
export const test = base.extend<{ launch: (opts?: LaunchOptions) => Promise<LaunchedApp>; smartPunctuation: boolean }>({
  // A spec that types straight quotes and expects them as typed says test.use({ smartPunctuation: false }).
  smartPunctuation: [true, { option: true }],
  launch: async ({ smartPunctuation }, use, testInfo) => {
    const apps: LaunchedApp[] = []
    const made = new Set<string>()
    await use(async (opts = {}) => {
      const a = await launchApp({ smartPunctuation, ...opts })
      // Removed once the apps have closed: Windows won't delete files an app still has open.
      made.add(a.dataDir)
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
    for (const dir of made) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      } catch {
        /* a file still held open on Windows: the temp folder is left for the system to clear */
      }
    }
  }
})

export { expect }

/** Starts the fake AI server (tests/fake-provider/server.mjs). Close it in `finally`. */
export async function startFake(opts: { delayMs?: number } = {}): Promise<FakeProvider> {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  return startFakeProvider({ delayMs: opts.delayMs ?? 2 })
}

/**
 * Connects the fake server and makes `modelId` the writer model (the memory and the builders use it
 * when no model of their own is chosen), then reloads the window so it reads the new settings.
 */
export async function useFakeModel(win: Page, fake: FakeProvider, modelId = 'fake/writer'): Promise<void> {
  const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
  await invoke(win, 'updateSettings', {
    models: { writer: { providerId: p.id, modelId, label: modelId, contextLength: 32000, promptPrice: null, completionPrice: null } }
  })
  await win.reload()
  await expect(win.locator('.scene-prose')).toBeVisible()
}
