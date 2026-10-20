// Adam's direction, end to end on the desk against the fake provider (2026-10-19): a whole scene drafted with a direction
// (the steer box, then Draft the scene) has it as the closing instruction's last words, word for word, and not on the
// scene card; the check as the words land goes through it ask by ask (tests/fake-provider/repair.mjs: an ask is kept when
// its words are in the draft, and the fake writer never writes "dialogue"), and the receipt over the dock says which
// asks landed, with Write it in (a Continue steered by what didn't land). What the AI saw shows the same. An Add below
// whose asks all landed says so in one line that fades by itself. The panels have the same receipt at the foot of the
// page, with Write it in, and "Write in what a draft missed" works there too. Invented test text only.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, invoke, startFake, test, useFakeModel } from './helpers'

// The desk; planning, the check as words land and contracts on; the memory reads a scene once and not again on its own;
// the critic after a draft waits.
const ON = {
  env: {
    AIWRITE_ARRANGEMENT: 'desk',
    AIWRITE_PLAN: 'on',
    AIWRITE_REPAIR: 'on',
    AIWRITE_CONTRACT: 'on',
    AIWRITE_KEEPER_QUIET_MS: '600000',
    AIWRITE_AFTER_DRAFT_MS: '600000'
  }
}

const dock = (win: Page) => win.getByRole('toolbar', { name: 'AI dock' })
const steer = (win: Page) => dock(win).getByRole('textbox', { name: 'Steer the next bit (optional)' })
const chip = (win: Page) => win.locator('.desk-chip[data-direction-receipt]')
const DIRECTION = 'Mara counts the doors from the corner. A shutter bangs above the tavern. More dialogue.'
const LEAD = "The author's direction for this draft (make every part of it happen on the page):"

/** Pictures for checking the look by eye, when AIWRITE_SHOTS names a folder. */
async function shot(win: Page, name: string): Promise<void> {
  const dir = process.env.AIWRITE_SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  // A moment for the entrances to settle, the pointer out of the way.
  await win.mouse.move(2, 2)
  await win.waitForTimeout(400)
  await win.screenshot({ path: join(dir, `${name}.png`) })
}

/** A new world, on the writing page. */
async function newWorld(win: Page): Promise<void> {
  await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await win.getByLabel('World name').fill('Harbour')
  await win.getByRole('button', { name: 'Create world' }).click()
  await expect(win.locator('.scene-prose')).toBeVisible()
}

test('the direction: said last of all, checked ask by ask, and a receipt over the dock with Write it in; also in What the AI saw', async ({
  launch
}) => {
  const fake = await startFake()
  try {
    const { win } = await launch(ON)
    await newWorld(win)
    const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the ferry.' })
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    const card = (await invoke(win, 'getScene', sceneId)).card
    await invoke(win, 'updateSceneCard', sceneId, { ...card, povId: mara.id, presentIds: [mara.id], beats: ['Mara waits in the tavern.'], targetWords: 600 })
    await useFakeModel(win, fake)

    // A whole scene, steered from the dock.
    await steer(win).fill(DIRECTION)
    await dock(win).getByRole('button', { name: /^Draft the scene/ }).click()

    // The receipt: what landed, and what didn't (the fake writer has no dialogue to speak of), with Write it in.
    await expect(chip(win)).toHaveAttribute('data-direction-receipt', 'missing', { timeout: 60_000 })
    await expect(win.getByRole('status', { name: 'Your direction: Mara counts the doors from the corner, done; A shutter bangs above the tavern, done; More dialogue, not yet.' })).toBeVisible()
    await expect(chip(win).locator('[data-ask="landed"]')).toHaveCount(2)
    await expect(chip(win).locator('[data-ask="missing"]')).toHaveText(/More dialogue/)
    const writeIn = chip(win).getByRole('button', { name: 'Write it in' })
    await expect(writeIn).toBeVisible()

    // The writer read the direction once, last of all, word for word; the scene card no longer says it. The plan's notes
    // carry how it should read.
    const [draft] = (await invoke(win, 'listGenerations', sceneId)).filter((g) => g.job === 'draft')
    const rec = await invoke(win, 'getGeneration', draft.id)
    const user = rec.messages[1].content as string
    expect(user).toContain(`${LEAD}\n${DIRECTION}`)
    expect(user.split('Mara counts the doors from the corner')).toHaveLength(2)
    expect(rec.blocks.find((b) => b.id === 'scene-card')!.text).not.toContain('counts the doors')
    expect(rec.blocks.find((b) => b.id === 'scene-contract')!.text).toContain('1. What the author directs, as given last of all, below.')
    expect(user).toContain('How it reads, as the author asks: More dialogue.')
    // The check read each ask as an item of its own (no new call: the check's own).
    const check = (await invoke(win, 'getCheckReport', sceneId))!.contract!
    expect(check.recordId).toBe(draft.id)
    expect(check.items.filter((i) => i.ask).map((i) => [i.text, i.result])).toEqual([
      ['Mara counts the doors from the corner', 'kept'],
      ['A shutter bangs above the tavern', 'kept'],
      ['More dialogue', 'not yet']
    ])

    // What the AI saw, for this draft: the same receipt under the direction.
    await win.locator('[data-page-title]').getByRole('button', { name: 'Scene details' }).click()
    const drawer = win.locator('aside.desk-drawer')
    await drawer.getByRole('tab', { name: /^Drafts/ }).click()
    await drawer.getByRole('button', { name: /What the AI saw/ }).first().click()
    await expect(win.getByRole('heading', { level: 1, name: 'What the AI saw' })).toBeVisible()
    const saw = win.getByRole('group', { name: 'How the draft kept to your direction' })
    await expect(saw).toContainText('Mara counts the doors from the corner · in the draft')
    await expect(saw).toContainText('More dialogue · not in the draft')
    await win.getByRole('navigation', { name: 'Rooms' }).getByRole('button', { name: /^Write/ }).click()
    await expect(win.locator('.scene-prose')).toBeVisible()
    await expect(chip(win)).toHaveAttribute('data-direction-receipt', 'missing')

    // Write it in: a Continue from the end of the scene, steered by what didn't land; the receipt goes.
    await chip(win).getByRole('button', { name: 'Write it in' }).click()
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'review', { timeout: 30_000 })
    expect(JSON.stringify(fake.lastRequest()?.body.messages ?? [])).toContain('More dialogue.')
    await expect(chip(win)).toHaveCount(0)
    await win.keyboard.press('Escape')
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle')

    // Add below whose every ask lands: one quiet line, which fades by itself.
    await steer(win).fill('Mara counts the doors from the corner.')
    await dock(win).getByRole('button', { name: /^Add below/ }).click()
    await expect(chip(win)).toHaveAttribute('data-direction-receipt', 'landed', { timeout: 60_000 })
    await expect(chip(win)).toContainText('Mara counts the doors from the corner')
    await expect(chip(win).getByRole('button')).toHaveCount(0)
    await expect(chip(win)).toHaveCount(0, { timeout: 10_000 })
  } finally {
    await fake.close()
  }
})

test('Add below with the steer box empty has no direction, not the last Generate’s', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch({ env: { AIWRITE_ARRANGEMENT: 'desk', AIWRITE_KEEPER_QUIET_MS: '600000' } })
    await newWorld(win)
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    await useFakeModel(win, fake)
    // A whole draft with a direction in the Draft options, kept for the scene.
    await dock(win).getByRole('button', { name: /^More ways to write/ }).click()
    await win.getByRole('menuitem', { name: /^Draft options/ }).click()
    await win.getByLabel('Direction for this draft (optional)').fill('Tobin sells the ferry.')
    await win.getByRole('button', { name: /^Generate draft/ }).click()
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId)).filter((g) => g.job === 'draft')[0]?.status, { timeout: 30_000 }).toBe('complete')
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle')
    // Add below from the dock, the steer box empty: no direction (it was the whole draft's).
    await dock(win).getByRole('button', { name: /^Add below/ }).click()
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId)).filter((g) => g.job === 'draft').length, { timeout: 30_000 }).toBe(2)
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle', { timeout: 30_000 })
    const [below, whole] = (await invoke(win, 'listGenerations', sceneId)).filter((g) => g.job === 'draft')
    expect((await invoke(win, 'getGeneration', whole.id)).direction).toBe('Tobin sells the ferry.')
    const rec = await invoke(win, 'getGeneration', below.id)
    expect(rec.direction).toBe('')
    expect(rec.messages[1].content as string).not.toContain('Tobin sells the ferry')
  } finally {
    await fake.close()
  }
})

// ----- The panels: the receipt at the foot of the page -----

const PANELS = { env: { ...ON.env, AIWRITE_ARRANGEMENT: 'panels' } }
/** The receipt, in the band at the foot of the panels' page. */
const footReceipt = (win: Page) => win.locator('[data-page-foot] [data-direction-receipt]')
const change = (win: Page) => win.getByRole('group', { name: 'The AI’s change' })

/** The window's inner size, as Adam might have it. */
async function size(app: import('@playwright/test').ElectronApplication, win: Page, w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [cw, ch]) => {
    const b = BrowserWindow.getAllWindows()[0]
    b.unmaximize()
    b.setContentSize(cw, ch)
  }, [w, h] as [number, number])
  await expect.poll(() => win.evaluate('innerWidth')).toBe(w)
}

/** Mara on the first scene's card; the fake writer connected. */
async function maraScene(win: Page, fake: Awaited<ReturnType<typeof startFake>>): Promise<string> {
  const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the ferry.' })
  const [story] = await invoke(win, 'listStories')
  const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
  const card = (await invoke(win, 'getScene', sceneId)).card
  await invoke(win, 'updateSceneCard', sceneId, { ...card, povId: mara.id, presentIds: [mara.id], beats: ['Mara waits in the tavern.'], targetWords: 600 })
  await useFakeModel(win, fake)
  return sceneId
}

/** Generate from the panels' toolbar, with a direction set in the draft options. */
async function generateWith(win: Page, direction: string): Promise<void> {
  await win.getByRole('button', { name: 'Draft options' }).click()
  await win.getByLabel('Direction for this draft (optional)').fill(direction)
  await win.keyboard.press('Escape')
  await win.locator('main header').getByRole('button', { name: 'Generate', exact: true }).click()
}

test('panels: the receipt at the foot of the page, with Write it in', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { app, win } = await launch(PANELS)
    await newWorld(win)
    const sceneId = await maraScene(win, fake)
    await generateWith(win, DIRECTION)

    // The receipt, once the draft is checked: what landed, and what didn't, with Write it in; the panels' own pill.
    await expect(footReceipt(win)).toHaveAttribute('data-direction-receipt', 'missing', { timeout: 60_000 })
    await expect(win.getByRole('status', { name: 'Your direction: Mara counts the doors from the corner, done; A shutter bangs above the tavern, done; More dialogue, not yet.' })).toBeVisible()
    await expect(footReceipt(win).locator('[data-ask="landed"]')).toHaveCount(2)
    await expect(footReceipt(win).locator('[data-ask="missing"]')).toHaveText(/More dialogue/)
    await expect(win.locator('.desk-chip')).toHaveCount(0)
    const writeIn = footReceipt(win).getByRole('button', { name: 'Write it in' })
    await expect(writeIn).toBeVisible()
    // It lies over the foot of the page, inside it.
    const inPage = async (): Promise<void> => {
      const page = (await win.locator('.desk-scroller').boundingBox())!
      const pill = (await footReceipt(win).boundingBox())!
      expect(pill.x).toBeGreaterThanOrEqual(page.x)
      expect(pill.x + pill.width).toBeLessThanOrEqual(page.x + page.width)
      expect(pill.y + pill.height).toBeLessThanOrEqual(page.y + page.height - 12)
      expect(pill.y).toBeGreaterThan(page.y + page.height - 100)
    }
    await inPage()
    for (const scheme of ['dark', 'light'] as const) {
      await win.emulateMedia({ colorScheme: scheme })
      await expect(win.locator('html')).toHaveAttribute('data-theme', scheme)
      await shot(win, `panels-receipt-${scheme}`)
    }
    // A small window: the asks that landed give up their room first; Write it in and Dismiss stay whole.
    await size(app, win, 1024, 700)
    await expect(writeIn).toBeVisible()
    await inPage()
    expect(await writeIn.evaluate((b) => b.scrollWidth <= b.clientWidth)).toBe(true)
    await shot(win, 'panels-receipt-1024-light')
    await win.emulateMedia({ colorScheme: 'dark' })
    await shot(win, 'panels-receipt-1024-dark')
    await win.emulateMedia({ colorScheme: 'light' })

    // Write it in: a Continue from the end of the scene, steered by what didn't land; the receipt goes, and Accept and
    // Reject are what there is to press.
    await writeIn.click()
    await expect(change(win).getByRole('button', { name: /^Reject/ })).toBeVisible({ timeout: 30_000 })
    expect(JSON.stringify(fake.lastRequest()?.body.messages ?? [])).toContain('More dialogue.')
    await expect(footReceipt(win)).toHaveCount(0)
    await change(win).getByRole('button', { name: /^Reject/ }).click()
    await expect(change(win)).toBeHidden()
    await expect(win.locator('[data-page-foot]')).toBeHidden()

    // Every ask landed: one quiet line, which fades by itself.
    await generateWith(win, 'Mara counts the doors from the corner.')
    await win.getByRole('button', { name: 'Add below', exact: true }).click()
    await expect(footReceipt(win)).toHaveAttribute('data-direction-receipt', 'landed', { timeout: 60_000 })
    await expect(footReceipt(win)).toContainText('Mara counts the doors from the corner')
    await expect(footReceipt(win).getByRole('button')).toHaveCount(0)
    await shot(win, 'panels-receipt-landed')
    await expect(footReceipt(win)).toHaveCount(0, { timeout: 10_000 })
    expect((await invoke(win, 'listGenerations', sceneId)).filter((g) => g.job === 'draft')).toHaveLength(2)
  } finally {
    await fake.close()
  }
})

test('panels: Write in what a draft missed, once, by itself; the receipt says so once the change waits', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { app, win } = await launch(PANELS)
    await newWorld(win)
    await maraScene(win, fake)
    await invoke(win, 'updateSettings', { autoWriteIn: true })
    await win.reload()
    await expect(win.locator('.scene-prose')).toBeVisible()
    // A small window (1024 by 700): the receipt stays clear of the message in the corner.
    await size(app, win, 1024, 700)

    await generateWith(win, 'Mara counts the doors from the corner. More dialogue.')

    // Written in by itself, with the same steered Continue as Write it in; the receipt says so once the change waits for
    // Accept or Reject (never while it is being written), with nothing of its own to press but Dismiss.
    await expect(footReceipt(win)).toHaveAttribute('data-direction-receipt', 'written', { timeout: 60_000 })
    await expect(change(win).getByRole('button', { name: /^Accept/ })).toBeVisible()
    expect(JSON.stringify(fake.lastRequest()?.body.messages ?? [])).toContain('More dialogue.')
    await expect(footReceipt(win).locator('[data-ask="written"]')).toHaveText(/More dialogue/)
    await expect(footReceipt(win).locator('[data-ask="landed"]')).toHaveCount(1)
    await expect(footReceipt(win)).toContainText('Written in below')
    await expect(footReceipt(win).getByRole('button')).toHaveCount(1)
    await expect(win.getByRole('status', { name: /More dialogue, written in below for you to keep or not/ })).toBeVisible()
    const corner = win.locator('div.fixed[aria-live="polite"] > div')
    if (await corner.count()) {
      const [a, b] = [(await footReceipt(win).boundingBox())!, (await corner.first().boundingBox())!]
      expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `${JSON.stringify(a)} under ${JSON.stringify(b)}`).toBe(true)
    }
    for (const scheme of ['light', 'dark'] as const) {
      await win.emulateMedia({ colorScheme: scheme })
      await expect(win.locator('html')).toHaveAttribute('data-theme', scheme)
      await shot(win, `panels-receipt-written-1024-${scheme}`)
    }

    // Adam doesn't keep it: it goes, and it is never written in again for this draft.
    await change(win).getByRole('button', { name: /^Reject/ }).click()
    await expect(change(win)).toBeHidden()
    const writes = fake.requestCounts()
    await win.waitForTimeout(2_500)
    await expect(change(win)).toBeHidden()
    expect(fake.requestCounts()).toEqual(writes)
    await footReceipt(win).getByRole('button', { name: 'Dismiss' }).click()
    await expect(footReceipt(win)).toHaveCount(0)
  } finally {
    await fake.close()
  }
})
