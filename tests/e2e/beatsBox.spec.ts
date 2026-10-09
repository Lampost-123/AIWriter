// Beat by beat's bar always comes back (2026-10-09, on the desk): Adam's bar went missing and Beat by beat only asked
// "This scene already has text" (Replace it / Add below), with no way back to his session. An unfinished session is
// kept from the moment it starts, and comes back as it was after a restart, wherever it had got to: before its first
// beat's words, part-way through a beat, or with every beat written. Beat by beat on the scene brings it back too,
// rather than asking where a new draft goes. Against the fake OpenAI-compatible server, with invented text.
import type { Page } from '@playwright/test'
import type { FakeProvider, FakeProviderOptions } from '../fake-provider/server.mjs'
import { expect, invoke, test } from './helpers'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk' }
const FIVE = ['Pell finds the lantern.', 'Pell lights it.', 'The moths come.', 'Orrin calls from the yard.', 'Pell hides the lantern.']
const OLD = 'Pell had written this line himself, long before.'

const prose = (win: Page) => win.locator('.scene-prose')
const bar = (win: Page) => win.locator('[data-beat-bar]')
const status = (win: Page) => bar(win).getByRole('status')
const box = (win: Page) => bar(win).getByRole('textbox')
const barButton = (win: Page, name: string) => bar(win).getByRole('button', { name, exact: true })
const dock = (win: Page) => win.getByRole('toolbar', { name: 'AI dock' })
const tree = (win: Page) => win.getByRole('complementary', { name: 'Chapters and scenes' })
const choiceHeading = (win: Page) => win.getByRole('heading', { name: 'This scene already has text' })

async function fakeProvider(options: FakeProviderOptions = {}): Promise<FakeProvider> {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  return startFakeProvider({ delayMs: 5, ...options })
}

/** Connects the fake server and makes `modelId` the writer model, then reloads so the window reads it (and the card). */
async function useWriter(win: Page, fake: FakeProvider, modelId = 'fake/writer'): Promise<void> {
  const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
  await invoke(win, 'updateSettings', {
    models: { writer: { providerId: p.id, modelId, label: modelId, contextLength: 32000, promptPrice: null, completionPrice: null } }
  })
  await win.reload()
  await expect(prose(win)).toBeVisible()
}

/** A new world on the desk: its first scene has Adam's own line and five beats on its card; a second scene follows it. */
async function setup(win: Page, beats = FIVE): Promise<string> {
  await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await win.getByLabel('World name').fill('Alpha')
  await win.getByRole('button', { name: 'Create world' }).click()
  await expect(prose(win)).toBeVisible()
  const [story] = await invoke(win, 'listStories')
  const { scenes, chapters } = await invoke(win, 'getOutline', story.id)
  const sceneId = scenes[0].id
  const card = (await invoke(win, 'getScene', sceneId)).card
  await invoke(win, 'updateSceneCard', sceneId, { ...card, beats, targetWords: 1500 })
  const other = await invoke(win, 'createScene', chapters[0].id, { title: 'The yard', afterId: sceneId })
  const otherCard = (await invoke(win, 'getScene', other.id)).card
  await invoke(win, 'updateSceneCard', other.id, { ...otherCard, beats: FIVE.slice(0, 3), targetWords: 1500 })
  await invoke(win, 'saveSceneText', sceneId, null, OLD)
  return sceneId
}

/** Beat by beat from the AI dock's menu. */
async function beatByBeat(win: Page): Promise<void> {
  await dock(win).getByRole('button', { name: 'More ways to write' }).click()
  await win.getByRole('menu').getByRole('menuitem', { name: 'Beat by beat' }).click()
}

test('a session whose first beat is still on its way comes back after a restart, ready for that beat, and goes below as Adam chose', async ({
  launch
}) => {
  const fake = await fakeProvider({ waitMs: 60_000 })
  try {
    const first = await launch({ env: DESK })
    const sceneId = await setup(first.win)
    await useWriter(first.win, fake, 'fake/wait')
    await beatByBeat(first.win)
    await first.win.locator('[data-choice="add"]').click()
    await expect(status(first.win)).toHaveText('Writing beat 1 of 5…')
    await expect(barButton(first.win, 'Stop')).toBeVisible()
    // Kept with the scene before any of its words are on the page.
    await expect.poll(async () => (await invoke(first.win, 'getBeatMarks', sceneId))?.open).toBe(true)
    await first.close()

    // Opened again: the same bar, on beat 1 of 5, with its words and an empty note box (no chooser, no new session).
    const again = await launch({ dataDir: first.dataDir, env: DESK })
    const win = again.win
    await expect(prose(win)).toBeVisible()
    await expect(status(win)).toHaveText('Beat 1 of 5')
    await expect(bar(win)).toContainText(FIVE[0])
    await expect(box(win)).toHaveValue('')
    await expect(barButton(win, 'Write the next beat')).toBeEnabled()
    await expect(choiceHeading(win)).toHaveCount(0)
    // The first beat goes below Adam's line, as he said before the restart, without asking again.
    await useWriter(win, fake)
    await expect(status(win)).toHaveText('Beat 1 of 5')
    await barButton(win, 'Write the next beat').click()
    await expect(status(win)).toHaveText('Beat 2 of 5')
    await expect(choiceHeading(win)).toHaveCount(0)
    await expect(prose(win).locator('p').first()).toHaveText(OLD)
    await expect(prose(win)).toContainText('The rain')
  } finally {
    await fake.close()
  }
})

test('a beat cut short by a restart comes back as stopped part-way, with Write it again; every beat written comes back with Finish', async ({
  launch
}) => {
  const fake = await fakeProvider({ slowWords: 2000, slowDelayMs: 40, words: 40 })
  try {
    const first = await launch({ env: DESK })
    const sceneId = await setup(first.win, FIVE.slice(0, 2))
    await useWriter(first.win, fake, 'fake/slow')
    await beatByBeat(first.win)
    await first.win.locator('[data-choice="add"]').click()
    await expect(status(first.win)).toHaveText('Writing beat 1 of 2…')
    await expect(prose(first.win)).toContainText('The rain')
    await expect.poll(async () => (await invoke(first.win, 'getBeatMarks', sceneId))?.beats[0]?.versions.length ?? 0).toBe(1)
    await first.close()

    // Opened again: the bar is back, the beat stopped part-way, and it can be written again or carried on from.
    const second = await launch({ dataDir: first.dataDir, env: DESK })
    let win = second.win
    await expect(prose(win)).toBeVisible()
    await expect(status(win)).toHaveText('Beat 2 of 2')
    await expect(bar(win)).toContainText('Beat 1 stopped part-way. Write it again, or carry on with beat 2.')
    await expect(barButton(win, 'Write it again')).toBeEnabled()
    await expect(barButton(win, 'Write the next beat')).toBeEnabled()

    // Every beat written, not finished: after a restart the bar is back with Write it again and Finish.
    await useWriter(win, fake)
    await barButton(win, 'Write the next beat').click()
    await expect(status(win)).toHaveText('All 2 beats are written')
    await second.close()
    const third = await launch({ dataDir: first.dataDir, env: DESK })
    win = third.win
    await expect(prose(win)).toBeVisible()
    await expect(status(win)).toHaveText('All 2 beats are written')
    await expect(barButton(win, 'Write it again')).toBeEnabled()
    await barButton(win, 'Finish').click()
    await expect(bar(win)).toHaveCount(0)
    await expect.poll(async () => (await invoke(win, 'getBeatMarks', sceneId))?.open ?? false).toBe(false)
  } finally {
    await fake.close()
  }
})

test('Beat by beat on a scene whose session gave way brings its bar back as it was, not "This scene already has text"', async ({
  launch
}) => {
  const fake = await fakeProvider({ words: 40 })
  try {
    const { win } = await launch({ env: DESK })
    await setup(win)
    await useWriter(win, fake)
    await beatByBeat(win)
    await win.locator('[data-choice="add"]').click()
    await expect(status(win)).toHaveText('Beat 2 of 5')

    // Another scene's session: this one gives way (one at a time), and its bar goes.
    await tree(win).getByRole('treeitem', { name: /The yard/ }).click()
    await beatByBeat(win)
    await expect(status(win)).toHaveText('Beat 2 of 3')
    await tree(win).getByRole('treeitem', { name: /Scene 1/ }).click()
    await expect(bar(win)).toHaveCount(0)

    // Beat by beat brings back the same session, on beat 2 of 5, ready to write it.
    await beatByBeat(win)
    await expect(status(win)).toHaveText('Beat 2 of 5')
    await expect(choiceHeading(win)).toHaveCount(0)
    await expect(bar(win)).toContainText(FIVE[1])
    await expect(box(win)).toBeFocused()
    await expect(barButton(win, 'Write it again')).toBeEnabled()
    await barButton(win, 'Write the next beat').click()
    await expect(status(win)).toHaveText('Beat 3 of 5')
  } finally {
    await fake.close()
  }
})
