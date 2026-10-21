// Directed writing (Adam's spec, "Directed writing (an option)"), end to end against the fake provider
// (tests/fake-provider/director.mjs: the director, and a writer that lands each stretch's beat): turned on for one draft
// in the draft options, Generate writes a stretch at a time; the director's line shows by the page; Adam's note goes in at
// the next pause, where the fake director has the last paragraph taken again (its new words in the page, the old ones
// gone); What the AI saw keeps each stretch's note and why. Settings › Models has the switch and the Director model. The
// desk shows the line over its AI dock. Invented test text only.
import type { Page } from '@playwright/test'
import { createWorldFromWelcome, expect, invoke, openSettings, test, useFakeModel } from './helpers'
import type { FakeProvider } from '../fake-provider/server.mjs'

const prose = (win: Page) => win.locator('.scene-prose')
const generateButton = (win: Page) => win.locator('main header').getByRole('button', { name: 'Draft the scene', exact: true })
const bar = (win: Page) => win.getByRole('region', { name: 'Director' })
const BEATS = ['Mara counts the doors from the corner.', 'Tobin turns his cup on the table.', 'Someone knocks at the door.']

/** The fake provider, slow enough to type a note while a stretch is written. */
async function slowFake(): Promise<FakeProvider> {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  return startFakeProvider({ delayMs: 45, words: 90 })
}

/** A world whose first scene has a card with three beats, Mara and Tobin in it. `desk`: on the desk (no binder showing). */
async function setUp(win: Page, fake: FakeProvider, desk = false): Promise<string> {
  if (desk) {
    await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
    await win.getByLabel('World name').fill('Harbour')
    await win.getByRole('button', { name: 'Create world' }).click()
    await expect(win.locator('.scene-prose')).toBeVisible()
  } else await createWorldFromWelcome(win, 'Harbour')
  const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the ferry.' })
  const tobin = await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'A ferryman.' })
  const [story] = await invoke(win, 'listStories')
  const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
  const card = (await invoke(win, 'getScene', sceneId)).card
  await invoke(win, 'updateSceneCard', sceneId, { ...card, povId: mara.id, presentIds: [mara.id, tobin.id], beats: BEATS, targetWords: 450, lengthSet: true })
  await useFakeModel(win, fake)
  return sceneId
}

test('a directed draft: the director’s line by the page, Adam’s note at the next pause, a retake, and each stretch kept', async ({ launch }) => {
  const fake = await slowFake()
  try {
    const { win } = await launch()
    const sceneId = await setUp(win, fake)

    // The draft options: Directed writing, for this draft only (Settings has it off).
    await win.getByRole('button', { name: 'Draft options' }).click()
    const toggle = win.getByRole('checkbox', { name: /Directed writing/ })
    await expect(toggle).not.toBeChecked()
    await expect(win.locator('[data-directed-toggle]')).toContainText('For this draft only.')
    await toggle.check()
    await win.keyboard.press('Escape')

    await generateButton(win).click()
    await expect(bar(win)).toBeVisible({ timeout: 30_000 })
    await expect(bar(win).locator('[data-director-line]')).toHaveText('Writing: Mara counts the doors from the corner')

    // Adam's note, typed while it writes: it goes in at the next pause.
    const box = bar(win).getByRole('textbox', { name: 'Your note for the next stretch' })
    await box.fill('she wouldn’t say that')
    await box.press('Enter')
    await expect(box).toHaveValue('')
    await expect(bar(win).locator('[data-director-hint]')).toHaveText(/Your note (goes|went) in/)

    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId))[0]?.status, { timeout: 60_000 }).toBe('complete')
    const [draft] = await invoke(win, 'listGenerations', sceneId)
    const rec = await invoke(win, 'getGeneration', draft.id)
    expect(rec.params.directed).toMatchObject({ stretches: 3, retakes: 1, notes: 1 })
    expect(rec.params.directed?.directorCalls).toBeGreaterThanOrEqual(1)
    // The paragraph written again is on the page, as in the record; each stretch's beat landed.
    await expect(prose(win)).toContainText('Mara stood very still by the door and let the room come to her.')
    await expect(prose(win)).toContainText('Someone knocks at the door.')
    const page = (await invoke(win, 'getScene', sceneId)).text
    expect(page.trim()).toBe(rec.response.trim())
    // The line stays a moment, then goes.
    await expect(bar(win)).toHaveCount(0, { timeout: 10_000 })

    // What the AI saw: each stretch's note and why.
    await win.getByRole('tab', { name: 'Drafts' }).click()
    await win.getByRole('button', { name: /What the AI saw/ }).first().click()
    await expect(win.getByRole('heading', { level: 1, name: 'What the AI saw' })).toBeVisible()
    const steps = win.getByRole('region', { name: 'Steps it took' }).or(win.locator('section[aria-label="Steps it took"]'))
    await expect(steps).toContainText('Stretch 1 of 3')
    await expect(steps).toContainText('Take the last paragraph again')
    await expect(steps).toContainText('Your notes: “she wouldn’t say that”')
    await expect(steps).toContainText('Why: The author says: she wouldn’t say that')
  } finally {
    await fake.close()
  }
})

test('Settings › Models: Directed writing off by default, the Director model the memory model’s until one is chosen', async ({ launch }) => {
  const fake = await slowFake()
  try {
    const { win } = await launch()
    await setUp(win, fake)
    await openSettings(win, 'Models')
    const director = win.locator('section', { has: win.getByRole('heading', { name: 'Director model' }) })
    await expect(director).toContainText('Same as the memory model')
    const toggle = win.getByRole('switch', { name: 'Direct every draft' })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(win.getByText('Costs a little more and takes a little longer', { exact: false })).toBeVisible()
    await toggle.click()
    await expect.poll(async () => (await invoke(win, 'getSettings')).directedWriting).toBe(true)
  } finally {
    await fake.close()
  }
})

test('on the desk, the director’s line sits over the AI dock while a directed draft writes', async ({ launch }) => {
  const fake = await slowFake()
  try {
    const { win } = await launch({ env: { AIWRITE_ARRANGEMENT: 'desk', AIWRITE_DIRECTED: 'on' } })
    const sceneId = await setUp(win, fake, true)
    const dock = win.getByRole('toolbar', { name: 'AI dock' })
    await dock.getByRole('button', { name: /^Draft the scene/ }).click()
    await expect(bar(win)).toBeVisible({ timeout: 30_000 })
    const line = (await bar(win).boundingBox())!
    const dockBox = (await dock.boundingBox())!
    expect(line.y + line.height).toBeLessThanOrEqual(dockBox.y + 1)
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId))[0]?.status, { timeout: 60_000 }).toBe('complete')
    const [draft] = await invoke(win, 'listGenerations', sceneId)
    expect((await invoke(win, 'getGeneration', draft.id)).params.directed?.stretches).toBe(3)
  } finally {
    await fake.close()
  }
})
