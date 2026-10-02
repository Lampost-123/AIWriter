import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { binder, createWorldFromWelcome, expect, invoke, newDataDir, openSettings, ROOT, test } from './helpers'

/** The Electron binary (the 'electron' package exports its path when required from Node). */
const electronPath = require('electron') as string

const worldButton = (win: Page, name: string) => win.getByRole('banner').getByRole('button', { name, exact: true })
const crumbs = (win: Page) => win.locator('main header').first()

/** Picks a world from the top bar's world menu. */
async function switchWorld(win: Page, from: string, to: string): Promise<void> {
  await worldButton(win, from).click()
  await win.getByRole('menuitem', { name: to, exact: true }).click()
}

/** Quits the way the Mac's Quit, a menu or an update restart does (app.quit), and waits for the app to exit. */
async function quitApp(app: ElectronApplication): Promise<void> {
  const exited = new Promise((r) => app.process().once('exit', r))
  await app.evaluate(({ app: a }) => a.quit())
  await exited
}

test('a world can be renamed from the world menu, and a world needs a name', async ({ launch }) => {
  const first = await launch()
  const { win } = first
  await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await expect(win.getByRole('button', { name: 'Create world' })).toBeDisabled()
  await createWorldFromWelcome(win, 'Alpha')

  await worldButton(win, 'Alpha').click()
  await win.getByRole('menuitem', { name: 'Rename this world' }).click()
  const box = win.getByRole('textbox', { name: 'World name' })
  await expect(box).toBeFocused()
  await win.keyboard.press('Control+A')
  await win.keyboard.type('The Northern Reaches')
  await win.keyboard.press('Enter')
  await expect(worldButton(win, 'The Northern Reaches')).toBeVisible()
  expect((await invoke(win, 'listWorlds')).map((w) => w.name)).toEqual(['The Northern Reaches'])
  await first.close()

  const second = await launch({ dataDir: first.dataDir })
  await expect(worldButton(second.win, 'The Northern Reaches')).toBeVisible()
  expect((await invoke(second.win, 'getWorld'))?.name).toBe('The Northern Reaches')
})

test('New world: typing goes straight into the name box', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  await worldButton(win, 'Alpha').click()
  await win.getByRole('menuitem', { name: 'New world…' }).click()
  const dialog = win.getByRole('dialog', { name: 'New world' })
  await expect(dialog.getByLabel('World name')).toBeFocused()
  await win.keyboard.type('Second World')
  await expect(dialog.getByLabel('World name')).toHaveValue('Second World')
  await win.keyboard.press('Enter')
  await expect(worldButton(win, 'Second World')).toBeVisible()
})

test('no menu bar with Reload or developer tools; right-click offers Cut, Copy and Paste', async ({ launch }) => {
  const { app, win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((i) => i.label) ?? null)
  if (process.platform === 'darwin') expect(menu).not.toContain('View')
  else expect(menu).toBeNull()
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.listenerCount('context-menu'))).toBeGreaterThan(0)

  await app.evaluate(({ Menu }) => {
    const build = Menu.buildFromTemplate.bind(Menu)
    Menu.buildFromTemplate = (items) => {
      ;(globalThis as { lastMenu?: unknown }).lastMenu = items.map((i) => i.label ?? i.type)
      return build(items)
    }
  })
  await win.locator('.scene-prose').click()
  await win.keyboard.type('Some words.')
  await win.locator('.scene-prose').click({ button: 'right' })
  await expect.poll(() => app.evaluate(() => (globalThis as { lastMenu?: string[] }).lastMenu ?? null)).toEqual(['Cut', 'Copy', 'Paste', 'separator', 'Select all'])
})

test('quitting from a menu (or Cmd+Q, or an update restart) saves the last words and the scene card first', async ({ launch }) => {
  const first = await launch()
  const { app, win } = first
  await createWorldFromWelcome(win, 'Alpha')
  await win.locator('.scene-prose').click()
  await win.keyboard.type('Typed then quit from the menu.')
  await win.getByPlaceholder("What they're trying to do").fill('Reach the ford before dawn')
  await quitApp(app)

  const second = await launch({ dataDir: first.dataDir })
  await expect(binder(second.win)).toBeVisible()
  const [story] = await invoke(second.win, 'listStories')
  const { scenes } = await invoke(second.win, 'getOutline', story.id)
  const scene = await invoke(second.win, 'getScene', scenes[0].id)
  expect(scene.text).toBe('Typed then quit from the menu.')
  expect(scene.card.goal).toBe('Reach the ford before dawn')
})

test('opening AI Write again while it runs changes nothing and leaves a draft writing', async ({ launch }) => {
  // Imported here: the server module has a top-level await (for its command line), so it can't be required.
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 5 })
  try {
    const { win, dataDir } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const provider = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url })
    await invoke(win, 'updateSettings', {
      models: { writer: { providerId: provider.id, modelId: 'fake/slow', label: 'Fake: Slow', contextLength: 32000, promptPrice: null, completionPrice: null } }
    })
    const [story] = await invoke(win, 'listStories')
    const { scenes } = await invoke(win, 'getOutline', story.id)
    const { generationId } = await invoke(win, 'startDraft', scenes[0].id, { direction: '', targetWords: 800, creativity: 'balanced' })
    await expect.poll(async () => (await invoke(win, 'getGeneration', generationId)).response.length).toBeGreaterThan(0)

    const settingsFile = join(dataDir, 'app', 'settings.json')
    const before = statSync(settingsFile).mtimeMs
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
    delete env.ELECTRON_RUN_AS_NODE
    env.AIWRITE_DATA_DIR = dataDir
    const args = process.platform === 'linux' ? ['.', '--no-sandbox'] : ['.']
    const code = await new Promise<number | null>((resolve) => {
      spawn(electronPath, args, { cwd: ROOT, env, stdio: 'ignore' }).once('exit', resolve)
    })
    expect(code).toBe(0)
    expect(statSync(settingsFile).mtimeMs).toBe(before)
    expect((await invoke(win, 'getWorld'))?.name).toBe('Alpha')

    // The draft is still being written, and its saved text keeps growing.
    const after = await invoke(win, 'getGeneration', generationId)
    expect(after.status).toBe('streaming')
    await expect.poll(async () => (await invoke(win, 'getGeneration', generationId)).response.length).toBeGreaterThan(after.response.length)
    await invoke(win, 'stopGeneration', generationId)
  } finally {
    await fake.close()
  }
})

test('a library folder that cannot be reached still opens the window, says so and offers a way on', async ({ launch }) => {
  const dataDir = newDataDir()
  try {
    mkdirSync(join(dataDir, 'app'), { recursive: true })
    writeFileSync(join(dataDir, 'not-a-folder'), 'x')
    const missing = join(dataDir, 'not-a-folder', 'AI Write')
    writeFileSync(join(dataDir, 'app', 'settings.json'), JSON.stringify({ libraryPath: missing, lastWorldId: 'gone' }))
    const { app, win } = await launch({ dataDir })
    await expect(win.getByRole('heading', { name: "AI Write can't find your library folder" })).toBeVisible()
    await expect(win.getByText(missing)).toBeVisible()
    await expect(win.getByRole('heading', { name: 'Create a world' })).toHaveCount(0)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true)

    // Choosing another folder gets Adam going again.
    const other = mkdtempSync(join(dataDir, 'lib-'))
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog
    }, other)
    await win.getByRole('button', { name: 'Choose another folder…' }).click()
    await createWorldFromWelcome(win, 'Fresh start')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('changing the library folder leaves the old world behind and shows the welcome screen', async ({ launch }) => {
  const { app, win, dataDir } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  const other = mkdtempSync(join(dataDir, 'lib-'))
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog
  }, other)
  await openSettings(win, 'About and updates')
  await win.getByRole('button', { name: 'Change folder…' }).click()
  await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await expect(binder(win)).toHaveCount(0)
  expect(await invoke(win, 'getWorld')).toBeNull()
})

test('a world that fails to open leaves the current world open and saving', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'World A')
  await worldButton(win, 'World A').click()
  await win.getByRole('menuitem', { name: 'New world…' }).click()
  await win.keyboard.type('World B')
  await win.keyboard.press('Enter')
  await expect(worldButton(win, 'World B')).toBeVisible()
  await switchWorld(win, 'World B', 'World A')
  await expect(worldButton(win, 'World A')).toBeVisible()

  // Something in World B's folder is in the way, so it can't be opened.
  const b = (await invoke(win, 'listWorlds')).find((w) => w.name === 'World B')!
  rmSync(join(b.folder, 'images'), { recursive: true, force: true })
  writeFileSync(join(b.folder, 'images'), 'not a folder')
  await switchWorld(win, 'World A', 'World B')
  await expect(win.getByText(/couldn't open that world/)).toBeVisible()
  expect((await invoke(win, 'getWorld'))?.name).toBe('World A')
  await expect(worldButton(win, 'World A')).toBeVisible()

  await win.locator('.scene-prose').click()
  await win.keyboard.type('Still saving.')
  const [story] = await invoke(win, 'listStories')
  const { scenes } = await invoke(win, 'getOutline', story.id)
  await expect.poll(async () => (await invoke(win, 'getScene', scenes[0].id)).text).toBe('Still saving.')
})

test('switching worlds returns to the same place, and an Undo never acts on another world', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')

  // A delete in Alpha offers Undo...
  await binder(win).getByText('Scene 1').click({ button: 'right' })
  await win.getByRole('menuitem', { name: /Delete scene/ }).click()
  await expect(win.getByRole('button', { name: 'Undo' })).toBeVisible()

  // ...then Adam starts Book 2 and is writing there.
  await binder(win).getByRole('button', { name: /Book 1/ }).click()
  await win.getByRole('menuitem', { name: 'New story' }).click()
  await win.getByRole('textbox', { name: 'Story title' }).press('Enter')
  await expect(crumbs(win)).toContainText('Book 2')

  // Switching worlds drops the Undo: it would act on the wrong world.
  await worldButton(win, 'Alpha').click()
  await win.getByRole('menuitem', { name: 'New world…' }).click()
  await win.keyboard.type('Beta')
  await win.keyboard.press('Enter')
  await expect(worldButton(win, 'Beta')).toBeVisible()
  await expect(win.getByRole('button', { name: 'Undo' })).toHaveCount(0)
  await expect(crumbs(win)).toContainText('Book 1')

  // Back in Alpha, he is where he left off.
  await switchWorld(win, 'Beta', 'Alpha')
  await expect(worldButton(win, 'Alpha')).toBeVisible()
  await expect(crumbs(win)).toContainText('Book 2')
  await expect(win.getByText(/could not be found/)).toHaveCount(0)
})

test('the window opens already in the chosen theme', async ({ launch }) => {
  const dataDir = newDataDir()
  try {
    mkdirSync(join(dataDir, 'app'), { recursive: true })
    writeFileSync(join(dataDir, 'app', 'settings.json'), JSON.stringify({ theme: 'dark' }))
    const { app, win } = await launch({ dataDir })
    await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
    expect(await win.evaluate(() => (globalThis as unknown as { aiwrite: { initialTheme: string } }).aiwrite.initialTheme)).toBe('dark')
    await expect(win.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect((await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor())).toLowerCase()).toBe('#161514')
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})
