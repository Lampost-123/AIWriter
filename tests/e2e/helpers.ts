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
  /** Extra Electron switches, e.g. '--force-device-scale-factor=1' for pictures the same size on any screen. */
  args?: string[]
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
  // Story memory step 5 (sticky entries, what was said, earlier passages found by searching) changes what a briefing
  // holds: app tests that aren't about it leave it out, and ask for it with { env: { AIWRITE_RECALL: 'on' } }.
  env.AIWRITE_RECALL = 'off'
  // The search model downloads by itself while "Find by meaning" is on (Adam, 2026-10-08): never in app tests, which
  // ask for it with { env: { AIWRITE_SEARCH_MODEL_AUTO: 'on' } } (and a local server, never Hugging Face).
  env.AIWRITE_SEARCH_MODEL_AUTO = 'off'
  // A fresh data folder would show the first-run setup (milestone 6); app tests start at the start screen's
  // "Create a world" unless they ask for the setup with { env: { AIWRITE_SETUP: 'on' } }. A world reopened at
  // launch opens straight away, not under the start screen, unless they ask for it with { env: { AIWRITE_START: 'on' } }.
  // The look: the New look, the only one since Classic was retired (2026-10-19). App tests start with no one-time note
  // about it (AIWRITE_LOOK=new) unless they ask for what Adam gets with { env: { AIWRITE_LOOK: '' } }.
  // The New look's layout: the panels (the rail and the side list) unless a test asks for the desk with
  // { env: { AIWRITE_ARRANGEMENT: 'desk' } }.
  // Run on Adam's PC, the window is see-through and never takes focus (main/index.ts), so he can use his PC
  // meanwhile; AIWRITE_BACKGROUND=off shows it. CI has no one to disturb.
  // The theme: Dark is the default now (src/shared/defaults.ts); app tests start in "Match the system", as they always
  // did, so their pictures stay as taken, unless a test asks for a theme with { env: { AIWRITE_THEME: 'dark' } } (or ''
  // for what Adam gets).
  // Plan before writing (one more AI call before each draft or beat, src/main/plan/) is left out of app tests that
  // aren't about it, so the calls they count stay as they were; they ask for it with { env: { AIWRITE_PLAN: 'on' } }.
  // The guided tour of the desk is left out too; a test asks for it with { env: { AIWRITE_TOUR: 'on' } }.
  // Each scene's contract (long story memory fix 13) changes what a briefing, the plan and the check hold: app tests that
  // aren't about it leave it out, and ask for it with { env: { AIWRITE_CONTRACT: 'on' } }.
  // The continuity brief (long story memory fix 14) makes the plan read and write more: app tests that aren't about it
  // leave it out, and ask for it with { env: { AIWRITE_BRIEF: 'on' } }.
  // The story index works out where things stand for the last two chapters by itself a few seconds after a world opens
  // (one AI call a scene not yet read): app tests that aren't about it leave it out, and ask for it with
  // { env: { AIWRITE_INDEX_FILL: 'on' } }.
  const background = process.env.AIWRITE_BACKGROUND ?? (process.env.CI ? 'off' : 'on')
  Object.assign(
    env,
    {
      AIWRITE_DATA_DIR: dataDir,
      AIWRITE_SETUP: 'off',
      AIWRITE_START: 'off',
      // The New look only (Classic retired, 2026-10-19). AIWRITE_E2E_ARRANGEMENT=desk runs specs that don't choose one on the desk.
      AIWRITE_LOOK: 'new',
      AIWRITE_ARRANGEMENT: process.env.AIWRITE_E2E_ARRANGEMENT ?? 'panels',
      AIWRITE_THEME: 'system',
      AIWRITE_BACKGROUND: background,
      AIWRITE_PLAN: 'off',
      AIWRITE_TOUR: 'off',
      AIWRITE_CONTRACT: 'off',
      AIWRITE_BRIEF: 'off',
      AIWRITE_INDEX_FILL: 'off'
    },
    opts.env
  )
  const app = await electron.launch({ args: ['.', ...(opts.args ?? [])], cwd: ROOT, env, timeout: 60_000 })
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

/**
 * Where each page Classic's binder listed sits in the New look's panels (Classic is retired): its area on the rail, and
 * its row in the area's list (the side pane, still the "Binder" landmark). Rows may carry a count after their name.
 */
const PAGES = {
  Codex: ['World', 'Everything'],
  Characters: ['World', 'Characters'],
  Places: ['World', 'Places'],
  Groups: ['World', 'Groups'],
  Items: ['World', 'Items'],
  Lore: ['World', 'Lore'],
  Events: ['World', 'Events'],
  Glossary: ['World', 'Glossary'],
  'Build from a summary': ['World', 'Build from a summary'],
  Timeline: ['World', 'Timeline'],
  'Relationship map': ['World', 'Relationship map'],
  'Plot threads board': ['Plan', 'Plot threads board'],
  // Build with AI (2026-10-20): the Plan area's first row, every AI building tool in one area; its Your idea (the Story
  // builder's first step before) is the first section of it.
  'Build with AI': ['Plan', 'Build with AI'],
  'Plan with AI': ['Plan', 'Build with AI'],
  'The idea, cast and world': ['Plan', 'Build with AI'],
  Consistency: ['Check', 'Consistency'],
  'What changed': ['Check', 'What changed'],
  'Style guide': ['Write', 'Style guide'],
  'Story settings': ['Write', 'Story settings']
} as const satisfies Record<string, readonly [string, string]>
export type PageName = keyof typeof PAGES

/** The rail's button for one of the New look's areas (Write, Plan, World, Check; Ask and Settings at its foot). */
export const areaButton = (win: Page, name: string) => win.getByRole('navigation', { name: 'Areas' }).getByRole('button', { name, exact: true })

/** A row of the side list of the area showing (its name, then perhaps a count). */
export const areaRow = (win: Page, name: string) => {
  const plain = name.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')
  return win.locator('[data-area-list]').getByRole('button', { name: new RegExp(`^${plain}(?: \\d+)?$`) })
}

/** Opens one of the pages Classic's binder listed, the way Adam does in the panels: its area on the rail, then its row. */
export async function openPage(win: Page, name: PageName): Promise<void> {
  const [area, row] = PAGES[name]
  await areaButton(win, area).click()
  await areaRow(win, row).click()
}

/**
 * The open scene's title at the head of its page (a click renames the scene). Classic, now retired, had it in the
 * scene's header bar (`main header`); the New look puts it on the page.
 */
export const sceneTitle = (win: Page, name: string | RegExp) => win.locator('main h1').getByRole('button', { name, exact: typeof name === 'string' })

/**
 * Makes sure the story's chapters and scenes show in the side list (the Write area's list): if another area (or
 * Settings, whose own list covers the side pane) is showing, goes back to the writing page first.
 */
export async function showTree(win: Page): Promise<void> {
  if ((await areaButton(win, 'Write').getAttribute('aria-current')) !== 'page') await openWrite(win)
}

/** Back to the Write area, where the side list is the story's chapters and scenes. */
export async function openWrite(win: Page): Promise<void> {
  await areaButton(win, 'Write').click()
  await expect(win.locator('[data-area-list="write"]')).toBeVisible()
}

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

/**
 * Starts the fake AI server (tests/fake-provider/server.mjs). Close it in `finally`. `slowDelayMs`: the pause between
 * pieces of fake/slow's replies (40 ms unless given).
 */
export async function startFake(opts: { delayMs?: number; slowDelayMs?: number } = {}): Promise<FakeProvider> {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  return startFakeProvider({ delayMs: opts.delayMs ?? 2, ...(opts.slowDelayMs !== undefined ? { slowDelayMs: opts.slowDelayMs } : {}) })
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
