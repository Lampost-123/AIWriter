// The start screen, end to end: it shows at launch (these tests turn it on; the others go straight to the reopened
// world, see helpers.ts) with Continue at the top, every world with its stories, renaming in place, deleting a world
// with Undo and Recently deleted, the ways back (Home, the world menu, the palette), the "When AI Write opens" setting,
// and a draft that keeps writing underneath it. Every world, story and word here is made up for the test.
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { ID } from '@shared/types'
import { binder, createWorldFromWelcome, expect, invoke, openSettings, test, type LaunchedApp, type LaunchOptions } from './helpers'

const START = { AIWRITE_START: 'on' }

const startScreen = (win: Page) => win.locator('.start-screen')
const continueCard = (win: Page) => startScreen(win).getByRole('button', { name: /^Continue: / })
const worldList = (win: Page) => startScreen(win).getByRole('list', { name: 'Your worlds' })
/** A world's card on the start screen. */
const worldCard = (win: Page, name: string) =>
  worldList(win)
    .locator(':scope > li')
    .filter({ has: win.getByRole('button', { name: `Open ${name}`, exact: true }) })
/** A world card's own button, which opens it up to show its stories (not its menu's). */
const OPEN_UP = 'button[aria-expanded]:not([aria-haspopup])'
const prose = (win: Page) => win.locator('.scene-prose')
const deletedList = (win: Page) => startScreen(win).getByRole('list', { name: 'Recently deleted worlds' })
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')

interface Seeded {
  dataDir: string
  north: ID
  ash: ID
  book1: ID
  book2: ID
  ford: ID
  snowfall: ID
  kindling: ID
}

/**
 * Two made-up worlds: The Northern Reaches (Book 1 with "The Ford", Book 2 "Winter Crossing" with "Snowfall") and
 * Ashgrove ("Kindling"). The Northern Reaches is open last, at "The Ford".
 */
async function seed(launch: (opts?: LaunchOptions) => Promise<LaunchedApp>): Promise<Seeded> {
  const first = await launch()
  const { win } = first
  await createWorldFromWelcome(win, 'The Northern Reaches')
  const north = (await invoke(win, 'getWorld'))!.id
  const [book1] = await invoke(win, 'listStories')
  const ford = (await invoke(win, 'getOutline', book1.id)).scenes[0].id
  await invoke(win, 'updateScene', ford, { title: 'The Ford' })
  await invoke(win, 'saveSceneText', ford, null, 'Mara crossed the ford at dawn, with the river running high and cold.')
  const book2 = await invoke(win, 'createStory', { title: 'Winter Crossing', startStoryId: book1.id })
  const ch = await invoke(win, 'createChapter', book2.id, { title: 'The Pass' })
  const snowfall = (await invoke(win, 'createScene', ch.id, { title: 'Snowfall' })).id
  await invoke(win, 'saveSceneText', snowfall, null, 'Snow fell on the pass for three days, and nobody came up from the valley.')

  const ash = (await invoke(win, 'createWorld', 'Ashgrove')).id
  const [kindling] = await invoke(win, 'listStories')
  await invoke(win, 'updateStory', kindling.id, { title: 'Kindling' })
  const ember = (await invoke(win, 'getOutline', kindling.id)).scenes[0].id
  await invoke(win, 'saveSceneText', ember, null, 'The first ember caught in the dry moss by the gate.')

  await invoke(win, 'openWorld', north)
  await invoke(win, 'updateSettings', { theme: 'light', lastStoryId: book1.id, lastSceneId: ford })
  await first.close()
  return { dataDir: first.dataDir, north, ash, book1: book1.id, book2: book2.id, ford, snowfall, kindling: kindling.id }
}

/** Waits for the opening to end (it never holds anything up; this is only for pictures). */
const openingDone = (win: Page) => expect(startScreen(win)).toHaveAttribute('data-opening', 'done', { timeout: 5000 })

test('at launch the start screen shows Continue first; Enter goes straight back to the scene', async ({ launch }) => {
  const s = await seed(launch)
  const { win } = await launch({ dataDir: s.dataDir, env: START })
  await expect(startScreen(win)).toBeVisible()
  await expect(continueCard(win)).toBeVisible()
  await expect(continueCard(win)).toContainText('The Ford')
  await expect(continueCard(win)).toContainText('Book 1 › The Northern Reaches')
  await expect(continueCard(win)).toBeFocused()
  // The keyboard is there, but no focus ring shows at launch: nothing has been done with the keyboard yet.
  const ringShows = (): Promise<boolean> =>
    continueCard(win).evaluate((e) => (e as unknown as { matches(s: string): boolean }).matches(':focus-visible'))
  expect(await ringShows()).toBe(false)
  // The worlds, the open one first, each with what it holds.
  await expect(worldList(win).locator(':scope > li')).toHaveCount(2)
  await expect(worldList(win).locator(':scope > li').first()).toContainText('The Northern Reaches')
  await expect(worldCard(win, 'The Northern Reaches')).toContainText('2 stories')
  await expect(worldCard(win, 'Ashgrove')).toContainText('1 story')
  // The workspace is there underneath, hidden and out of reach.
  await expect(binder(win)).toBeHidden()
  expect(await win.locator('.scene-prose').count()).toBe(1)

  // Pictures for a look, in the default window size: light, then dark.
  await openingDone(win)
  const light = join(tmpdir(), 'aiwrite-start-screen-light.png')
  const dark = join(tmpdir(), 'aiwrite-start-screen-dark.png')
  await win.screenshot({ path: light })
  await win.evaluate("document.documentElement.dataset.theme = 'dark'")
  // Colours ease for 150 ms when the theme changes.
  await win.waitForTimeout(400)
  await win.screenshot({ path: dark })
  await win.evaluate("document.documentElement.dataset.theme = 'light'")
  test.info().annotations.push({ type: 'screenshots', description: `${light} ${dark}` })

  await win.keyboard.press('Enter')
  await expect(startScreen(win)).toHaveCount(0)
  await expect(binder(win)).toBeVisible()
  await expect(prose(win)).toContainText('Mara crossed the ford at dawn')
})

test('a world card opens to its stories; a story opens where Adam left off, in its own world if need be', async ({ launch }) => {
  const s = await seed(launch)
  const { win } = await launch({ dataDir: s.dataDir, env: START })
  const north = worldCard(win, 'The Northern Reaches')
  await north.locator(OPEN_UP).click()
  const stories = north.getByRole('list', { name: 'Stories in The Northern Reaches' })
  await expect(stories.getByRole('button', { name: 'Book 1', exact: true })).toBeVisible()
  await expect(stories.getByRole('button', { name: 'Winter Crossing', exact: true })).toBeVisible()
  await expect(stories.locator('li').filter({ hasText: 'Winter Crossing' })).toContainText('Book 2')
  await stories.getByRole('button', { name: 'Winter Crossing', exact: true }).click()
  await expect(startScreen(win)).toHaveCount(0)
  await expect(prose(win)).toContainText('Snow fell on the pass')

  // Home, then a story in the other world: that world opens at it.
  await win.getByRole('button', { name: 'Start screen', exact: true }).click()
  await expect(startScreen(win)).toBeVisible()
  const ash = worldCard(win, 'Ashgrove')
  await ash.locator(OPEN_UP).click()
  await ash.getByRole('button', { name: 'Kindling', exact: true }).click()
  await expect(startScreen(win)).toHaveCount(0)
  await expect(prose(win)).toContainText('The first ember caught')
  expect((await invoke(win, 'getWorld'))?.id).toBe(s.ash)

  // Back on the start screen, Continue names the world open now straight away (not the one the last list named).
  await win.getByRole('button', { name: 'Start screen', exact: true }).click()
  await expect(continueCard(win)).toBeVisible()
  expect(await continueCard(win).textContent()).toContain('Ashgrove')
  await expect(continueCard(win)).toContainText('Kindling')

  // New story… in a chosen world: that world opens behind, and the New story dialog shows over the start screen.
  await startScreen(win).getByRole('button', { name: 'New story…' }).click()
  await win.getByRole('menuitem', { name: 'The Northern Reaches' }).click()
  const dialog = win.getByRole('dialog', { name: 'New story' })
  await expect(dialog).toBeVisible()
  await expect(startScreen(win)).toBeVisible()
  await expect.poll(async () => (await invoke(win, 'getWorld'))?.id).toBe(s.north)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(startScreen(win)).toHaveCount(0)
  await expect.poll(async () => (await invoke(win, 'listStories')).length).toBe(3)
})

test('worlds and stories are renamed in place, open or not, and a story in another world is deleted with Undo', async ({ launch }) => {
  const s = await seed(launch)
  const { win } = await launch({ dataDir: s.dataDir, env: START })

  // A world that isn't open: renamed without opening it.
  await worldCard(win, 'Ashgrove').getByRole('button', { name: 'More for Ashgrove' }).click()
  await win.getByRole('menuitem', { name: 'Rename' }).click()
  const box = startScreen(win).getByRole('textbox', { name: 'World name' })
  await expect(box).toBeFocused()
  await box.fill('Ashgrove Vale')
  await box.press('Enter')
  await expect(worldCard(win, 'Ashgrove Vale')).toBeVisible()
  await expect.poll(async () => (await invoke(win, 'listWorlds')).map((w) => w.name).sort()).toEqual(['Ashgrove Vale', 'The Northern Reaches'])
  expect((await invoke(win, 'getWorld'))?.id).toBe(s.north)

  // A story in the open world: the binder knows at once.
  const north = worldCard(win, 'The Northern Reaches')
  await north.locator(OPEN_UP).click()
  await north.getByRole('button', { name: 'More for Winter Crossing' }).click()
  await win.getByRole('menuitem', { name: 'Rename' }).click()
  const title = startScreen(win).getByRole('textbox', { name: 'Story title' })
  await title.fill('The Long Winter')
  await title.press('Enter')
  await expect(north.getByRole('button', { name: 'The Long Winter', exact: true })).toBeVisible()
  await expect.poll(async () => (await invoke(win, 'listStories')).map((x) => x.title)).toContain('The Long Winter')

  // Escape leaves a name as it was.
  await north.getByRole('button', { name: 'More for Book 1' }).click()
  await win.getByRole('menuitem', { name: 'Rename' }).click()
  await startScreen(win).getByRole('textbox', { name: 'Story title' }).fill('Not this')
  await win.keyboard.press('Escape')
  await expect(north.getByRole('button', { name: 'Book 1', exact: true })).toBeVisible()

  // A story in the other world: deleted (that world opens behind), and the start screen stays.
  const ash = worldCard(win, 'Ashgrove Vale')
  await ash.locator(OPEN_UP).click()
  await ash.getByRole('button', { name: 'More for Kindling' }).click()
  await win.getByRole('menuitem', { name: 'Delete story' }).click()
  await expect(toasts(win)).toContainText('“Kindling” deleted.')
  await expect(startScreen(win)).toBeVisible()
  await expect(ash.getByRole('button', { name: 'Kindling', exact: true })).toHaveCount(0)
  expect((await invoke(win, 'getWorld'))?.id).toBe(s.ash)
  await toasts(win).getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await invoke(win, 'listStories')).map((x) => x.title)).toEqual(['Kindling'])
  // Undo leaves the start screen up, with the story back on it.
  await expect(ash.getByRole('button', { name: 'Kindling', exact: true })).toBeVisible()
  await expect(startScreen(win)).toBeVisible()
  await expect(binder(win)).toBeHidden()

  // Nothing on the start screen has the keyboard now (the toast has gone): keys still never reach the hidden page.
  const ember = (await invoke(win, 'getOutline', s.kindling)).scenes[0].id
  await win.evaluate("(document.activeElement && document.activeElement.blur && document.activeElement.blur(), 0)")
  await win.keyboard.press('Control+Z')
  await win.keyboard.press('Control+Z')
  await expect(startScreen(win)).toBeFocused()
  await expect(startScreen(win)).toBeVisible()
  expect((await invoke(win, 'getScene', ember)).text).toBe('The first ember caught in the dry moss by the gate.')

  // A story that isn't the open one (its world opens behind again): deleted, then Undo puts it back on the list.
  const reaches = worldCard(win, 'The Northern Reaches')
  await reaches.getByRole('button', { name: 'More for The Long Winter' }).click()
  await win.getByRole('menuitem', { name: 'Delete story' }).click()
  await expect(reaches.getByRole('button', { name: 'The Long Winter', exact: true })).toHaveCount(0)
  await toasts(win).getByRole('button', { name: 'Undo' }).last().click()
  await expect(reaches.getByRole('button', { name: 'The Long Winter', exact: true })).toBeVisible()
  await expect(startScreen(win)).toBeVisible()
})

test('deleting a world asks first, offers Undo, and Recently deleted restores or empties for good', async ({ launch }) => {
  const s = await seed(launch)
  const { win } = await launch({ dataDir: s.dataDir, env: START })

  // The open world: the dialog names it and what it holds.
  await worldCard(win, 'The Northern Reaches').getByRole('button', { name: 'More for The Northern Reaches' }).click()
  await win.getByRole('menuitem', { name: 'Delete world…' }).click()
  const dialog = win.getByRole('dialog', { name: 'Delete this world?' })
  await expect(dialog).toContainText(/The Northern Reaches: 2 stories, \d[\d,]* words\./)
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Delete world' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(worldCard(win, 'The Northern Reaches')).toHaveCount(0)
  // Continue went with it (there is nowhere to go back to), and the keyboard is on the start screen.
  await expect(continueCard(win)).toHaveCount(0)
  await expect(startScreen(win)).toBeFocused()
  await expect(deletedList(win)).toContainText('The Northern Reaches')
  await expect(deletedList(win)).toContainText('Goes for good in 30 days')
  expect(await invoke(win, 'getWorld')).toBeNull()

  // Undo brings it straight back, open again behind the start screen.
  await toasts(win).getByRole('button', { name: 'Undo' }).click()
  await expect(worldCard(win, 'The Northern Reaches')).toBeVisible()
  await expect(deletedList(win)).toHaveCount(0)
  await expect.poll(async () => (await invoke(win, 'getWorld'))?.id).toBe(s.north)
  await expect(startScreen(win)).toBeVisible()

  // Another world: deleted, then restored from Recently deleted.
  await worldCard(win, 'Ashgrove').getByRole('button', { name: 'More for Ashgrove' }).click()
  await win.getByRole('menuitem', { name: 'Delete world…' }).click()
  await win.getByRole('dialog', { name: 'Delete this world?' }).getByRole('button', { name: 'Delete world' }).click()
  await expect(deletedList(win)).toContainText('Ashgrove')
  await deletedList(win).getByRole('button', { name: 'Restore “Ashgrove”' }).click()
  await expect(worldCard(win, 'Ashgrove')).toBeVisible()
  await expect(deletedList(win)).toHaveCount(0)
  await expect(toasts(win)).toContainText('“Ashgrove” is back.')

  // Deleted again, then Empty now (asked again): gone for good.
  await worldCard(win, 'Ashgrove').getByRole('button', { name: 'More for Ashgrove' }).click()
  await win.getByRole('menuitem', { name: 'Delete world…' }).click()
  await win.getByRole('dialog', { name: 'Delete this world?' }).getByRole('button', { name: 'Delete world' }).click()
  await expect(deletedList(win)).toContainText('Ashgrove')
  await startScreen(win).getByRole('button', { name: 'Empty now' }).click()
  const empty = win.getByRole('dialog', { name: 'Empty Recently deleted?' })
  await expect(empty).toContainText('“Ashgrove” will be removed for good. This can’t be undone.')
  await empty.getByRole('button', { name: 'Empty now' }).click()
  await expect(empty).toHaveCount(0)
  await expect(deletedList(win)).toHaveCount(0)
  expect((await invoke(win, 'listWorlds')).map((w) => w.name)).toEqual(['The Northern Reaches'])
  expect((await invoke(win, 'getLibrary')).deleted).toEqual([])
})

test('the Home button, the world menu and the palette go back to the start screen', async ({ launch }) => {
  const s = await seed(launch)
  // Started without the start screen: the world reopens at once.
  const { win } = await launch({ dataDir: s.dataDir })
  await expect(prose(win)).toContainText('Mara crossed the ford')
  await expect(startScreen(win)).toHaveCount(0)

  await win.getByRole('button', { name: 'Start screen', exact: true }).click()
  await expect(continueCard(win)).toBeFocused()
  await continueCard(win).click()
  await expect(startScreen(win)).toHaveCount(0)

  await win.getByRole('banner').getByRole('button', { name: 'The Northern Reaches', exact: true }).click()
  await win.getByRole('menuitem', { name: 'Go to the start screen' }).click()
  await expect(startScreen(win)).toBeVisible()
  await win.keyboard.press('Enter')
  await expect(startScreen(win)).toHaveCount(0)
  // The caret is back in the page: typing carries on there.
  await expect(prose(win)).toBeFocused()
  await win.keyboard.press('Control+End')
  await win.keyboard.type(' Then the far bank.')
  await expect.poll(async () => (await invoke(win, 'getScene', s.ford)).text).toContain('Then the far bank.')

  await win.keyboard.press('Control+K')
  await win.keyboard.type('start screen')
  await win.getByRole('option', { name: /Go to the start screen/ }).click()
  await expect(startScreen(win)).toBeVisible()
  // Settings from the start screen, then Home again from its top bar.
  await startScreen(win).getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(startScreen(win)).toHaveCount(0)
  await win.getByRole('navigation').getByRole('button', { name: 'Appearance' }).click()
  await expect(win.getByLabel('When AI Write opens')).toBeVisible()
  await win.getByRole('button', { name: 'Start screen', exact: true }).click()
  await expect(startScreen(win)).toBeVisible()
})

test('"Where I left off" skips the start screen at launch', async ({ launch }) => {
  const s = await seed(launch)
  const first = await launch({ dataDir: s.dataDir, env: START })
  await expect(startScreen(first.win)).toBeVisible()
  await first.win.keyboard.press('Enter')
  await openSettings(first.win, 'Appearance')
  await first.win.getByLabel('When AI Write opens').click()
  await first.win.getByRole('option', { name: 'Where I left off' }).click()
  await expect.poll(async () => (await invoke(first.win, 'getSettings')).startWith).toBe('last')
  await first.close()

  const second = await launch({ dataDir: s.dataDir, env: START })
  await expect(binder(second.win)).toBeVisible()
  await expect(prose(second.win)).toContainText('Mara crossed the ford')
  await expect(startScreen(second.win)).toHaveCount(0)
})

test('a draft keeps writing while the start screen is open, and Continue shows it still writing', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  // Long enough (about 30 seconds) that it is still writing however slowly a test machine saves the page.
  test.setTimeout(180_000)
  const slow = await startFakeProvider({ delayMs: 5, slowWords: 1500, slowDelayMs: 20 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: slow.url, apiKey: '' })
    await invoke(win, 'updateSettings', {
      models: { writer: { providerId: p.id, modelId: 'fake/slow', label: 'fake/slow', contextLength: 32000, promptPrice: null, completionPrice: null } }
    })
    await win.reload()
    await expect(prose(win)).toBeVisible()
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id

    await win.locator('main header').getByRole('button', { name: 'Generate', exact: true }).click()
    await expect(prose(win)).toContainText('The rain')
    await win.getByRole('button', { name: 'Start screen', exact: true }).click()
    await expect(startScreen(win)).toBeVisible()
    // Underneath, the page is still there and the draft goes on landing in it (and being saved).
    expect(await prose(win).count()).toBe(1)
    const before = (await invoke(win, 'getScene', sceneId)).text.length
    await expect.poll(async () => (await invoke(win, 'getScene', sceneId)).text.length, { timeout: 15_000 }).toBeGreaterThan(before)
    const [gen] = await invoke(win, 'listGenerations', sceneId)
    expect(gen.status).toBe('streaming')

    await continueCard(win).click()
    await expect(startScreen(win)).toHaveCount(0)
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId))[0]?.status, { timeout: 120_000 }).toBe('complete')
    const rec = await invoke(win, 'getGeneration', gen.id)
    await expect.poll(async () => (await invoke(win, 'getScene', sceneId)).text.trim()).toBe(rec.response.trim())
  } finally {
    await slow.close()
  }
})

test('New story from a recipe picks the recipe, then the world, and opens New story with that recipe chosen', async ({ launch }) => {
  const s = await seed(launch)
  const { win } = await launch({ dataDir: s.dataDir, env: START })
  await expect(startScreen(win)).toBeVisible()
  const recipe = await invoke(win, 'newRecipe')
  await invoke(win, 'updateRecipe', recipe.id, { name: 'The Long Road Home' })
  const tile = startScreen(win).getByRole('button', { name: 'New story from a recipe…' })
  await expect(tile).toBeVisible()
  await tile.click()
  await win.getByRole('menuitem', { name: 'The Long Road Home' }).click()
  await win.getByRole('menuitem', { name: 'Ashgrove' }).click()
  const dialog = win.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('From a recipe')).toContainText('The Long Road Home')
  // The world opened behind the start screen, which stays up under the dialog.
  await expect.poll(async () => (await invoke(win, 'getWorld'))?.id).toBe(s.ash)
  await expect(startScreen(win)).toBeVisible()
})
