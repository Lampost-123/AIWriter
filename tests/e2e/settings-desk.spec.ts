// The first run, Settings and moving work in and out on the New look's desk (UI overhaul): the setup's rail of steps,
// its picture lit step by step, the services as marks and the moment it ends; Settings' grouped list with "Find a
// setting", each page's picture and heading; Appearance's preview following the choices; Usage and cost's charts
// (by day, by model, by world) after real calls to the fake AI server; Backups' preview before a restore; Recently
// deleted's cards; and the import page's drop zone. Everything on the sample world or invented words.
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, invoke, startFake, test, useFakeModel, type LaunchOptions } from './helpers'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk', AIWRITE_DESK_READY: '1' }
const settingsNav = (win: Page) => win.getByRole('navigation', { name: 'Settings' })
const heading = (win: Page, name: string) => win.getByRole('heading', { level: 1, name, exact: true })

async function sampleWorld(
  launch: (o?: LaunchOptions) => Promise<{ app: ElectronApplication; win: Page; dataDir: string }>
): Promise<{ app: ElectronApplication; win: Page; dataDir: string }> {
  const a = await launch({ env: DESK })
  await expect(a.win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(a.win, 'openSampleWorld')
  await a.win.reload()
  await expect(a.win.locator('.scene-prose')).toContainText('A hundred and twelve steps to the lamp room.')
  return a
}

async function openPage(win: Page, name: string): Promise<void> {
  if (!(await settingsNav(win).isVisible())) await win.keyboard.press('Control+,')
  await settingsNav(win).getByRole('button', { name }).click()
  await expect(heading(win, name)).toBeVisible()
}

async function size(app: ElectronApplication, win: Page, w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [cw, ch]) => BrowserWindow.getAllWindows()[0].setContentSize(cw, ch), [w, h] as [number, number])
  await expect.poll(async () => Math.abs(((await win.evaluate('innerWidth')) as number) - w)).toBeLessThanOrEqual(1)
}

test('the setup on the desk: a rail of steps, the lamp lit step by step, services as marks, and the lamp lit at the end', async ({ launch }) => {
  const fake = await startFake()
  try {
    // No graphics card for the voices, so the read-aloud step says so and only goes on.
    const { win, app } = await launch({ env: { ...DESK, AIWRITE_SETUP: 'on', AIWRITE_FAKE_SPEECH_GPU: '' } })
    await expect(win.getByRole('heading', { name: 'Name your world', exact: true })).toBeVisible()
    await size(app, win, 1440, 900)
    const rail = win.getByRole('complementary', { name: 'Setup steps' })
    const art = win.locator('[data-living-art="setup"]')
    await expect(rail.getByRole('listitem')).toHaveCount(6)
    await expect(rail.locator('[aria-current="step"]')).toContainText('Your world')
    await expect(art).toHaveAttribute('data-stage', '1')
    await expect(win.getByText('Explore the sample world')).toBeVisible()

    await win.getByLabel('World name').fill('The Salt Marches')
    await win.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(rail.locator('[aria-current="step"]')).toContainText('Connect')
    await expect(rail.locator('[data-state="done"]')).toHaveCount(1)
    await expect(art).toHaveAttribute('data-stage', '2')
    // The other services as marks (plain shapes, never their logos); one fills in the form for it.
    const services = win.getByRole('region', { name: 'Other services' })
    await expect(services.locator('[data-provider-mark]')).toHaveCount(6)
    await services.getByRole('button', { name: /^LM Studio/ }).click()
    const form = win.locator('form').filter({ hasText: 'Add a provider' })
    await expect(form.getByLabel('Base URL')).toHaveValue('http://localhost:1234/v1')
    await form.getByLabel('Name').fill('Test server')
    await form.getByLabel('Base URL').fill(fake.url)
    await form.getByRole('button', { name: 'Add provider' }).click()
    await expect(win.getByText(/^Connected to Test server in .+ It offers \d+ models\.$/)).toBeVisible()
    await win.getByRole('button', { name: 'Continue', exact: true }).click()

    await expect(art).toHaveAttribute('data-stage', '3')
    await win.getByRole('listbox', { name: 'Models' }).getByRole('option', { name: /^fake\/writer\b/ }).click()
    await win.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(art).toHaveAttribute('data-stage', '4')
    await win.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(art).toHaveAttribute('data-stage', '5')
    await expect(rail.locator('[aria-current="step"]')).toContainText('Read aloud')
    await expect(win.getByText(/^No NVIDIA graphics card was found on this computer/)).toBeVisible()
    await expect(win.getByRole('button', { name: 'Download now' })).toHaveCount(0)
    await win.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(art).toHaveAttribute('data-stage', '6')
    await expect(rail.locator('[data-state="done"]')).toHaveCount(5)

    // The end: the lamp is lit on the picture and the sheet says so, then the first scene opens.
    await win.getByRole('button', { name: /Start writing/ }).click()
    await expect(art).toHaveAttribute('data-finishing')
    await expect(win.getByRole('status').filter({ hasText: 'The lamp is lit' })).toBeVisible()
    await expect(win.locator('.scene-prose')).toBeVisible()
    await expect(rail).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

test('Settings on the desk: grouped pages with pictures, Find a setting, and Appearance’s preview following the choices', async ({ launch }) => {
  const { win, app } = await sampleWorld(launch)
  await size(app, win, 1440, 900)
  await win.keyboard.press('Control+,')
  const nav = settingsNav(win)
  for (const group of ['Writing', 'Look and feel', 'Your work', 'AI Write']) await expect(nav.getByRole('group', { name: group })).toBeVisible()
  await expect(nav.getByRole('button', { name: 'Models' })).toHaveAttribute('aria-current', 'page')
  await expect(win.locator('[data-section-art="models"]')).toBeVisible()

  // Find a setting: a word on a page finds the page and says what matched; Enter opens it.
  const find = nav.getByRole('textbox', { name: 'Find a setting' })
  await find.fill('typewriter')
  const found = nav.getByRole('group', { name: 'Found' }).getByRole('button')
  await expect(found).toHaveCount(1)
  await expect(found.first()).toContainText('Editor')
  await expect(found.first()).toContainText('Typewriter scrolling')
  await find.press('Enter')
  await expect(heading(win, 'Editor')).toBeVisible()
  await expect(find).toHaveValue('')
  await find.fill('zzzz')
  await expect(nav.getByText('Nothing in Settings by that name.')).toBeVisible()
  await find.press('Escape')
  await expect(nav.getByRole('group', { name: 'Writing' })).toBeVisible()

  // Every page has its own picture and heading.
  for (const [name, art] of [
    ['My writing preferences', 'preferences'],
    ['Read aloud and dictation', 'speech'],
    ['Backups', 'backups'],
    ['Recently deleted', 'trash'],
    ['Usage and cost', 'usage'],
    ['About and updates', 'about'],
    ['Appearance', 'appearance']
  ] as const) {
    await openPage(win, name)
    await expect(win.locator(`[data-section-art="${art}"]`)).toBeVisible()
  }

  // Appearance: the preview shows the desk, and follows the text size and paragraphs as they change.
  const preview = win.getByRole('figure', { name: 'Preview' })
  await expect(preview).toHaveAttribute('data-preview-layout', 'desk')
  const words = preview.locator('.ap-words')
  const was = (await invoke(win, 'getSettings')).editor.fontSize
  await expect(words).toHaveAttribute('style', new RegExp(`font-size: ${was}px`))
  const textSize = win.getByLabel(/^Text size:/)
  await textSize.focus()
  await textSize.press(was < 24 ? 'ArrowRight' : 'ArrowLeft')
  const now = was < 24 ? was + 1 : was - 1
  await expect.poll(async () => (await invoke(win, 'getSettings')).editor.fontSize).toBe(now)
  await expect(words).toHaveAttribute('style', new RegExp(`font-size: ${now}px`))
  await expect(preview).toContainText(`${now}px text`)
  await expect(preview).toContainText('spaced paragraphs')
  // The theme as pictures: Dark paints the window at once.
  await win.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Dark' }).click()
  await expect.poll(() => win.evaluate('document.documentElement.dataset.theme')).toBe('dark')
  await expect.poll(async () => (await invoke(win, 'getSettings')).theme).toBe('dark')

  // Nothing spills sideways in a small window.
  await size(app, win, 1366, 768)
  for (const name of ['Appearance', 'Usage and cost', 'Backups', 'Models']) {
    await openPage(win, name)
    const spill = (await win.evaluate(
      `(() => { const p = document.querySelector('.st-page'); return p ? p.scrollWidth - p.clientWidth : 0 })()`
    )) as number
    expect(spill, name).toBeLessThanOrEqual(1)
  }
})

test('Usage and cost: the day’s bars by model, the split by model and by world, in dollars or tokens', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win, app } = await sampleWorld(launch)
    await useFakeModel(win, fake)
    await size(app, win, 1440, 900)
    // A priced writer model, so the calls cost something.
    const s = await invoke(win, 'getSettings')
    await invoke(win, 'updateSettings', { models: { writer: { ...s.models.writer!, promptPrice: 0.0001, completionPrice: 0.0002 } } })
    const [story] = await invoke(win, 'listStories')
    const { scenes } = await invoke(win, 'getOutline', story.id)
    await win.reload()
    await expect(win.locator('.scene-prose')).toBeVisible()
    await win.getByRole('toolbar', { name: 'AI dock' }).getByRole('button', { name: 'Add below', exact: true }).click()
    await expect.poll(async () => (await invoke(win, 'listGenerations', scenes[0].id))[0]?.status, { timeout: 30_000 }).toBe('complete')

    await openPage(win, 'Usage and cost')
    const report = await invoke(win, 'getUsage', { period: 'this-month', scope: 'library' })
    expect(report.total.calls).toBeGreaterThanOrEqual(1)
    expect(report.byWorld?.map((w) => w.name)).toContain('Sample world: Gullhaven')
    expect(report.bars.some((b) => (b.models ?? []).some((m) => m.modelId === 'fake/writer'))).toBe(true)
    // The tiles, the bars and the breakdowns.
    await expect(win.getByText('This month', { exact: true }).first()).toBeVisible()
    await expect(win.locator('.uc-bar').first()).toBeVisible()
    await expect(win.getByRole('heading', { name: 'By model' })).toBeVisible()
    await expect(win.getByRole('list', { name: 'By model' })).toContainText('writer')
    await expect(win.getByRole('heading', { name: 'By world' })).toBeVisible()
    await expect(win.getByRole('list', { name: 'By world' })).toContainText('Sample world: Gullhaven')
    await expect(win.getByRole('heading', { name: 'By job' })).toBeVisible()
    // Tokens: the scale counts tokens, not dollars.
    await win.getByRole('radiogroup', { name: 'Show the charts in' }).getByRole('radio', { name: 'Tokens' }).click()
    await expect(win.locator('.uc-bars [role="img"]')).toHaveAttribute('aria-label', /^Tokens day by day/)
    await win.getByRole('radio', { name: 'All time' }).click()
    await expect(win.locator('.uc-bars [role="img"]')).toHaveAttribute('aria-label', /month by month/)
  } finally {
    await fake.close()
  }
})

test('Backups and Recently deleted on the desk: a preview before a restore, and cards brought back', async ({ launch }) => {
  const { win, app } = await sampleWorld(launch)
  await size(app, win, 1440, 900)
  // The backup made at launch first, so the one made by hand below is the newest.
  await expect.poll(async () => (await invoke(win, 'listBackups')).length).toBeGreaterThan(0)
  await openPage(win, 'Backups')
  await win.getByRole('button', { name: 'Back up now' }).first().click()
  const rows = win.getByRole('list', { name: 'Backups' }).getByRole('listitem')
  await expect(rows.first()).toContainText('Made by you')
  await expect(rows.first()).toContainText('Newest')
  // The backup's preview, beside the world now; nothing is changed until Restore.
  const [story] = await invoke(win, 'listStories')
  const outline = await invoke(win, 'getOutline', story.id)
  await invoke(win, 'deleteScene', outline.scenes[outline.scenes.length - 1].id)
  await rows.first().getByRole('button', { name: /^Restore the backup from/ }).click()
  await expect(rows.first()).toContainText('Your current work is backed up first')
  await expect(rows.first()).toContainText('Scenes')
  await expect(rows.first()).toContainText('1 more than now')
  await expect(rows.first().getByRole('list', { name: 'Stories in this backup' })).toContainText('The Keeper’s Light')
  await win.keyboard.press('Escape')
  await expect(win.getByText('Your current work is backed up first')).toHaveCount(0)
  const preview = await invoke(win, 'previewBackup', (await invoke(win, 'listBackups'))[0].id)
  expect(preview.backup!.scenes - preview.now!.scenes).toBe(1)

  // Recently deleted: the scene as a card with its days left; Restore brings it back and the card goes.
  await openPage(win, 'Recently deleted')
  const list = win.getByRole('list', { name: 'Recently deleted' })
  const card = list.getByRole('listitem').filter({ hasText: outline.scenes[outline.scenes.length - 1].title })
  await expect(card).toContainText('Scene in')
  await expect(card.getByTitle('Kept for 30 more days')).toBeVisible()
  await card.getByRole('button', { name: /^Restore “/ }).click()
  await expect(win.getByText(/is back\.$/)).toBeVisible()
  await expect(card).toHaveCount(0)
})

test('the import page on the desk: a drop zone with its manuscript, and the export dialog’s formats as cards', async ({ launch }) => {
  const { win, app } = await sampleWorld(launch)
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as unknown as typeof dialog.showOpenDialog
  })
  await win.keyboard.press('Control+K')
  await win.keyboard.type('Import a manuscript')
  await win.getByRole('option', { name: /^Import a manuscript/ }).first().click()
  await expect(heading(win, 'Import a manuscript')).toBeVisible()
  const zone = win.locator('[data-drop-zone]')
  await expect(zone).toContainText('Drop a manuscript here')
  await expect(zone.getByRole('button', { name: 'Choose a file…' })).toBeVisible()

  await win.keyboard.press('Control+K')
  await win.keyboard.type('Export story')
  await win.getByRole('option', { name: /^Export story/ }).first().click()
  const dialog = win.getByRole('dialog', { name: 'Export story' })
  const formats = dialog.getByRole('radiogroup', { name: 'Format' })
  await expect(formats.getByRole('radio')).toHaveCount(5)
  await expect(formats.getByRole('radio', { name: 'Word' })).toHaveAttribute('aria-checked', 'true')
  await formats.getByRole('radio', { name: 'Word' }).press('ArrowRight')
  await expect(formats.getByRole('radio', { name: 'EPUB' })).toHaveAttribute('aria-checked', 'true')
  await expect(dialog).toContainText('An e-book (.epub)')
})
