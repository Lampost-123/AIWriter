// The first run and the sample world (milestone 6), end to end. A fresh data folder shows the setup (these tests
// turn it on: the others start at the Welcome screen, see helpers.ts); it is walked with the fake AI server as the
// provider, quit midway and resumed, and ends in the first scene with its guide, through one Generate to Mark done.
// The sample world opens from the first run, shows its codex and its story with its memory read, and opening it
// again never makes a second one.
import type { Page } from '@playwright/test'
import { binder, closeWindow, expect, invoke, startFake, test } from './helpers'

// A graphics card that can run the voices, so the read-aloud step offers its download (never started here).
const SETUP = { AIWRITE_SETUP: 'on', AIWRITE_FAKE_SPEECH_GPU: 'NVIDIA GeForce RTX 4090', AIWRITE_FAKE_SPEECH_GPU_MEMORY: '24564', AIWRITE_FAKE_SPEECH_GPU_CAP: '8.9' }

const main = (win: Page) => win.locator('main')
const heading = (win: Page, name: string) => win.getByRole('heading', { name, exact: true })
const next = (win: Page) => win.getByRole('button', { name: 'Continue', exact: true })
const guide = (win: Page) => win.getByRole('region', { name: 'Your first scene' })
const prose = (win: Page) => win.locator('.scene-prose')

test('a fresh install walks through the setup, resumes after quitting, and lands in a guided first scene', async ({ launch }) => {
  const fake = await startFake()
  try {
    const first = await launch({ env: SETUP })
    let win = first.win

    // ----- 1. The world: made there and then -----
    await expect(heading(win, 'Name your world')).toBeVisible()
    await expect(win.getByRole('heading', { name: 'Create a world' })).toHaveCount(0)
    await expect(win.getByText('Step 1 of 6')).toBeVisible()
    await expect(next(win)).toBeDisabled()
    await win.getByLabel('World name').fill('The Northern Reaches')
    await next(win).click()

    // ----- 2. Connect: another provider (the fake server), tested as it is added -----
    await expect(heading(win, 'Connect an AI service')).toBeVisible()
    expect((await invoke(win, 'listWorlds')).map((w) => w.name)).toEqual(['The Northern Reaches'])
    await expect(next(win)).toBeDisabled()
    await win.getByRole('button', { name: 'Use another provider' }).click()
    const form = win.locator('form').filter({ hasText: 'Add a provider' })
    await form.getByLabel('Name').fill('Test server')
    await form.getByLabel('Base URL').fill(fake.url)
    await form.getByRole('button', { name: 'Add provider' }).click()
    await expect(win.getByText(/^Connected to Test server in .+ It offers \d+ models\.$/)).toBeVisible()
    await expect(next(win)).toBeEnabled()

    // ----- Quitting midway loses nothing: the next launch resumes at the same step, in the same world -----
    await closeWindow(first.app)
    const second = await launch({ dataDir: first.dataDir, env: SETUP })
    win = second.win
    await expect(heading(win, 'Connect an AI service')).toBeVisible()
    await expect(win.getByText('Test server', { exact: true })).toBeVisible()
    await next(win).click()

    // ----- 3. The writer model: picked from the picker, and tested -----
    await expect(heading(win, 'Pick a writer model')).toBeVisible()
    await expect(next(win)).toBeDisabled()
    await win.getByRole('listbox', { name: 'Models' }).getByRole('option', { name: /^fake\/writer\b/ }).click()
    await win.getByRole('button', { name: 'Test this model' }).click()
    await expect(win.getByText(/The model answered in/)).toBeVisible()
    expect((await invoke(win, 'getSettings')).models.writer?.modelId).toBe('fake/writer')
    await next(win).click()

    // ----- 4. The basic style, kept as the writing preferences -----
    await expect(heading(win, 'How should your stories read?')).toBeVisible()
    // A long step keeps Back and Continue in sight at the window's foot, in a 1440x900 window and a small one (then
    // the window goes back to its own size).
    const own = await second.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize())
    const resize = (w: number, h: number) =>
      second.app.evaluate(({ BrowserWindow }, [cw, ch]) => BrowserWindow.getAllWindows()[0].setContentSize(cw, ch), [w, h] as [number, number])
    for (const [w, h] of [[1440, 900], [1024, 700]] as const) {
      await resize(w, h)
      // Within a pixel: on CI's 1440×900 virtual screen (Linux, xvfb) a window as tall as the screen comes out 899 tall,
      // as in desk.spec. Continue is then measured against the window's real height.
      await expect.poll(async () => Math.abs(((await win.evaluate('innerHeight')) as number) - h)).toBeLessThanOrEqual(1)
      const tall = (await win.evaluate('innerHeight')) as number
      await expect.poll(async () => { const b = await next(win).boundingBox(); return b ? b.y + b.height : 9999 }).toBeLessThanOrEqual(tall)
      await expect(win.getByRole('button', { name: 'Back', exact: true })).toBeInViewport()
    }
    await resize(own[0], own[1])
    await win.getByRole('button', { name: 'First person', exact: true }).click()
    await win.getByRole('radio', { name: 'US (color)' }).click()
    await win.getByLabel('How should the prose sound?').fill('Plain and warm.')
    await next(win).click()
    await expect(heading(win, 'Hear your stories read aloud')).toBeVisible()
    const prefs = await invoke(win, 'getWritingPrefs')
    expect(prefs).toMatchObject({ pov: 'First person', spelling: 'US', voiceNotes: 'Plain and warm.' })
    // Back keeps what was chosen.
    await win.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(win.getByLabel('Point of view')).toHaveValue('First person')
    await next(win).click()

    // ----- 5. Read aloud: its one-time download offered, and Later says where to find it -----
    await expect(heading(win, 'Hear your stories read aloud')).toBeVisible()
    await expect(win.getByText('The studio voices', { exact: true })).toBeVisible()
    await expect(win.getByRole('button', { name: 'Download now', exact: true })).toBeEnabled()
    await win.getByRole('button', { name: 'Later', exact: true }).click()
    await expect(win.getByText('Read aloud is in Settings › Read aloud and dictation whenever you want it.')).toBeVisible()
    await expect(heading(win, 'Lay out your world (optional)')).toBeVisible()

    // ----- 6. Skip the World builder: the first scene opens with its guide -----
    await win.getByRole('button', { name: /Start writing/ }).click()
    await expect(binder(win)).toBeVisible()
    await expect(prose(win)).toBeVisible()
    await expect(guide(win)).toContainText('Fill in the scene card')
    expect((await invoke(win, 'getSettings')).firstRun?.step).toBe('guide')

    // The card, then Generate, then an edit of his own, then Mark done: the guide follows along.
    const card = win.getByRole('tabpanel', { name: 'Scene card' })
    await card.getByLabel('Goal').fill('Mara finds the hidden door.')
    await expect(guide(win)).toContainText('Press Generate')
    await main(win).locator('header').getByRole('button', { name: 'Generate', exact: true }).click()
    await expect(prose(win)).toContainText('The rain had not let up')
    await expect(guide(win)).toContainText('Make it yours', { timeout: 20_000 })
    await prose(win).click()
    await win.keyboard.press('Control+End')
    await win.keyboard.type(' The door was locked.')
    await expect(guide(win)).toContainText('Mark it done')
    await win.keyboard.press('Control+Enter')
    await expect(guide(win)).toHaveCount(0)
    await expect(win.getByText(/That’s your first scene done/)).toBeVisible()
    await expect.poll(async () => (await invoke(win, 'getSettings')).firstRun ?? null).toBeNull()
  } finally {
    await fake.close()
  }
})

test('the sample world opens from the first run with its story, codex and memory, and is never made twice', async ({ launch }) => {
  const { win } = await launch({ env: SETUP })
  await expect(heading(win, 'Name your world')).toBeVisible()
  await win.getByRole('button', { name: 'Explore a sample world first' }).click()

  // Its story, open at its first scene, and the line saying it is the sample.
  await expect(binder(win)).toBeVisible()
  await expect(win.getByRole('region', { name: 'Sample world' })).toContainText('You’re exploring the sample world')
  await expect(binder(win).getByText('Lighting the Lamp')).toBeVisible()
  await expect(binder(win).getByText('Low Tide')).toBeVisible()
  await expect(prose(win)).toContainText('A hundred and twelve steps to the lamp room.')

  // Its memory is read already: nothing waits for the AI (no provider is even connected).
  const [story] = await invoke(win, 'listStories')
  const outline = await invoke(win, 'getOutline', story.id)
  expect(outline.scenes.map((s) => s.memoryState)).toEqual(['current', 'current', 'current', 'current'])
  const status = await invoke(win, 'getMemoryStatus')
  expect(status).toMatchObject({ behind: 0, failed: 0 })

  // The codex shows its people and places.
  await binder(win).getByRole('button', { name: 'Codex' }).click()
  await expect(main(win).getByRole('heading', { level: 1, name: 'Codex' })).toBeVisible()
  for (const name of ['Wren Halloway', 'Iska Vey', 'The Gullhaven Light', 'The light is never dark']) {
    await expect(main(win).locator('[data-codex-card]').filter({ hasText: name }).first()).toBeVisible()
  }

  // Opening it again (the palette, then the API twice) opens the same world: there is only ever one.
  const id = (await invoke(win, 'getWorld'))!.id
  await win.keyboard.press('Control+K')
  await win.keyboard.type('sample world')
  await win.keyboard.press('Enter')
  expect((await invoke(win, 'openSampleWorld')).id).toBe(id)
  expect((await invoke(win, 'openSampleWorld')).id).toBe(id)
  expect((await invoke(win, 'listWorlds')).filter((w) => w.name.startsWith('Sample world'))).toHaveLength(1)

  // "Start my own world" goes back to the setup's first step.
  await win.getByRole('region', { name: 'Sample world' }).getByRole('button', { name: 'Start my own world' }).click()
  await expect(heading(win, 'Name your world')).toBeVisible()
})
