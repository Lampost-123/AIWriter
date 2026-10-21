// Write the whole chapter (contracts/chapterWriter.ts), end to end against the fake AI server in the New look: the
// chapter plan is scripted (tests/fake-provider/chapter.mjs: a look-up, then a part for each scene), the checks find
// nothing in the fake prose, the critic reads the chapter once and its notes on words in the scenes are fixed, each
// passage rewritten (the fake adds "The rain went on."). Started from the palette's "Whole chapter with AI", which opens
// Build with AI at the chapter, Write this chapter open in its row (2026-10-20; a dialog before): it lists the scenes;
// the plan shows there before anything is written, with the name it picked for Chapter 1 (the next chapter has one of its
// own), Write the chapter, Change the plan and Cancel; while it works
// the top bar says so and the open scene can't be typed in; it ends in a message with Show (the report on the chapter
// card) and Undo (the words before).
import type { Page } from '@playwright/test'
import { areaButton, binder, createWorldFromWelcome, expect, invoke, startFake, test, useFakeModel } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const row = (win: Page, title: string) => binder(win).locator('[data-row]', { hasText: title }).first()
/** Write this chapter, in its row of Build with AI, before it starts. */
const dialog = (win: Page) => win.locator('[data-plan-hub] [data-write-stage="start"]')
/** Its plan to read, in the same row. */
const planView = (win: Page) => win.locator('[data-plan-hub] [data-write-stage="review"]')
const status = (win: Page) => win.getByTestId('chapter-writer-status')
const NEW_LOOK = { AIWRITE_KEEPER_QUIET_MS: '600000', AIWRITE_LOOK: 'new' }

/** Opens Write this chapter with AI from the palette and starts it. */
async function start(win: Page): Promise<void> {
  await win.keyboard.press('Control+K')
  await win.keyboard.type('Whole chapter')
  await win.getByRole('option', { name: /^Whole chapter with AI/ }).first().click()
  await dialog(win).getByTestId('chapter-writer-start').click()
  await expect(dialog(win)).toBeHidden()
}

/** Back to the writing page, where the open scene is. */
async function toWriting(win: Page): Promise<void> {
  await areaButton(win, 'Write').click()
  await expect(prose(win)).toBeVisible()
}

const FERRY = 'Old words of the ferry scene.'

async function setUp(win: Page, fake: Awaited<ReturnType<typeof startFake>>): Promise<{ ferry: string; inn: string; chapterId: string }> {
  await createWorldFromWelcome(win, 'Lowtown')
  await useFakeModel(win, fake)
  await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the ferry.' })
  const [story] = await invoke(win, 'listStories')
  const outline = await invoke(win, 'getOutline', story.id)
  const chapterId = outline.chapters[0].id
  const ferry = outline.scenes[0].id
  await invoke(win, 'updateScene', ferry, { title: 'The ferry' })
  const inn = (await invoke(win, 'createScene', chapterId, { title: 'The inn' })).id
  const card = (await invoke(win, 'getScene', ferry)).card
  await invoke(win, 'updateSceneCard', ferry, { ...card, goal: 'Mara meets Tobin at the ferry.' })
  await invoke(win, 'updateSceneCard', inn, { ...card, beats: ['Mara finds no room at the inn.'] })
  await invoke(win, 'saveSceneText', ferry, null, FERRY)
  // A chapter after it with a name of its own: Chapter 1, only a number, is named in its style by the plan.
  await invoke(win, 'createChapter', story.id, { title: 'The Road North' })
  await win.reload()
  await row(win, 'The ferry').click()
  await expect(prose(win)).toContainText(FERRY)
  return { ferry, inn, chapterId }
}

test('Whole chapter with AI: plans first, writes every scene to the plan Adam changed, holds the open one, ends clean with Show and Undo', async ({
  launch
}) => {
  test.setTimeout(180_000)
  const fake = await startFake({ delayMs: 25 })
  try {
    const { win } = await launch({ env: NEW_LOOK })
    const { ferry, inn, chapterId } = await setUp(win, fake)

    await win.keyboard.press('Control+K')
    await win.keyboard.type('Whole chapter')
    await win.getByRole('option', { name: /^Whole chapter with AI/ }).first().click()
    await expect(dialog(win)).toBeVisible()
    const plan = dialog(win).getByTestId('chapter-writer-plan')
    await expect(plan).toContainText('Sc 1 “The ferry”')
    await expect(plan).toContainText('has words: they will be replaced')
    await expect(plan).toContainText('Sc 2 “The inn”')
    await expect(plan).toContainText('empty: will be written')
    await dialog(win).getByTestId('chapter-writer-start').click()
    await expect(dialog(win)).toBeHidden()

    // The plan, before anything is written: a part for each scene, and what in the cards doesn't fit the memory.
    const view = planView(win)
    await expect(view).toBeVisible({ timeout: 60_000 })
    await expect(view.getByTestId('chapter-plan')).toContainText('1 · The ferry')
    await expect(view.getByTestId('chapter-plan')).toContainText('Sc 1 moves the chapter on.')
    await expect(view.getByTestId('chapter-plan')).toContainText('Ends with: Sc 1 ends on the far bank.')
    await expect(view.getByTestId('chapter-plan')).toContainText("Sc 1's card has Mara at the inn; the memory has her at the ferry.")
    // A name for the chapter, picked to fit the other chapters', to change; nothing is renamed yet.
    const name = view.getByRole('textbox', { name: 'Chapter name' })
    await expect(name).toHaveValue('The Far Bank')
    await expect(view).toContainText('Picked to fit your story and its other chapters.')
    expect((await invoke(win, 'getOutline', (await invoke(win, 'listStories'))[0].id)).chapters[0].title).toBe('Chapter 1')
    expect((await invoke(win, 'getScene', inn)).text).toBe('')
    // Left, it waits: the top bar opens it again, at its chapter.
    await toWriting(win)
    await expect(view).toBeHidden()
    await expect(status(win)).toContainText('The chapter plan is ready for you')
    await status(win).getByRole('button', { name: /ready for you/ }).click()
    await expect(view).toBeVisible()
    // Adam changes Sc 2's part, then writes.
    await view.getByTestId('chapter-plan-change').click()
    await view.getByRole('textbox', { name: 'Sc 2 “The inn”: its part of the plan' }).fill('Mara finds no room at the inn and sleeps in the stable.')
    await name.fill('Across the Water')
    await view.getByTestId('chapter-plan-write').click()
    await expect(view).toBeHidden()
    // Its row says how it is going.
    await expect(win.locator('[data-plan-hub] [data-write-stage]')).not.toHaveAttribute('data-write-stage', 'start')

    // While it works: the top bar says what it is doing, and the open scene can be read but not typed in.
    await toWriting(win)
    await expect(status(win)).toBeVisible()
    await expect(win.locator('.scene-prose.chapter-held')).toHaveCount(1)
    await expect(win.locator('.scene-prose.chapter-held')).toHaveAttribute('contenteditable', 'false')
    await expect.poll(() => invoke(win, 'getScene', inn).then((s) => s.text.length), { timeout: 60_000 }).toBeGreaterThan(0)

    // It ends clean, in a message with Show and Undo.
    const done = win.getByText(/Chapter 1 is written and checked: 2 rounds of checks, \d+ things? fixed\./)
    await expect(done).toBeVisible({ timeout: 120_000 })
    await expect(status(win)).toBeHidden()
    const report = await invoke(win, 'getChapterWriterReport', chapterId)
    expect(report?.status).toBe('done')
    expect(report?.brief).toContain('Keep Sc 1 true to the memory.')
    expect(report?.brief).toContain('Mara finds no room at the inn and sleeps in the stable.')
    expect(report?.plan?.scenes[1].changed).toBe(true)
    // The chapter has the name Adam kept, from before its scenes were written.
    const storyId = (await invoke(win, 'listStories'))[0].id
    expect((await invoke(win, 'getOutline', storyId)).chapters[0].title).toBe('Across the Water')
    expect(report?.named).toEqual({ from: 'Chapter 1', to: 'Across the Water' })
    // The page shows the run's words, and can be typed in again.
    await expect(prose(win)).toContainText('The rain went on.')
    await expect(prose(win)).not.toContainText(FERRY)
    await expect(win.locator('.scene-prose.chapter-held')).toHaveCount(0)

    // Show: the report on the chapter card.
    await win.getByRole('button', { name: 'Show', exact: true }).click()
    const card = win.getByRole('region', { name: 'Chapter card' })
    const written = card.getByTestId('chapter-writer-report')
    await expect(written).toContainText('Written and checked: 2 rounds of checks, clean at the end.')
    await expect(written).toContainText('Your scene cards and the memory (1)')
    await expect(written).toContainText('Named the chapter “Across the Water”.')

    // Undo puts the chapter back as it was.
    await written.getByRole('button', { name: 'Undo' }).click()
    await expect(win.getByText('Put back 2 scenes and the chapter’s name as they were before the AI wrote the chapter.')).toBeVisible()
    expect((await invoke(win, 'getOutline', storyId)).chapters[0].title).toBe('Chapter 1')
    expect((await invoke(win, 'getScene', ferry)).text).toBe(FERRY)
    expect((await invoke(win, 'getScene', inn)).text).toBe('')
    await expect(prose(win)).toContainText(FERRY)
  } finally {
    await fake.close()
  }
})

test('Whole chapter with AI: Cancel at the plan changes nothing; once writing, it can be stopped from the top bar, keeping what was written', async ({
  launch
}) => {
  test.setTimeout(120_000)
  const fake = await startFake({ delayMs: 60 })
  try {
    const { win } = await launch({ env: NEW_LOOK })
    const { chapterId, ferry } = await setUp(win, fake)
    await start(win)
    await planView(win).getByTestId('chapter-plan-cancel').click({ timeout: 60_000 })
    await expect(win.getByText('Cancelled before writing: nothing in the chapter changed.')).toBeVisible({ timeout: 30_000 })
    await expect(status(win)).toBeHidden()
    expect((await invoke(win, 'getChapterWriterReport', chapterId))?.status).toBe('cancelled')
    expect((await invoke(win, 'getScene', ferry)).text).toBe(FERRY)
    // Not even the name the plan picked.
    expect((await invoke(win, 'getOutline', (await invoke(win, 'listStories'))[0].id)).chapters[0].title).toBe('Chapter 1')

    await start(win)
    await planView(win).getByTestId('chapter-plan-write').click({ timeout: 60_000 })
    await expect(planView(win)).toBeHidden()
    await status(win).getByRole('button').first().click()
    await win.getByTestId('chapter-writer-stop').click()
    await expect(win.getByText('Stopped writing Chapter 1. The words so far are kept; Undo puts the chapter back.')).toBeVisible({ timeout: 30_000 })
    // The progress card, left open, says it stopped and what was kept; closed, the top bar's pill goes.
    await expect(win.locator('[data-progress-ended="stopped"]')).toBeVisible()
    await win.locator('[data-progress-card="chapter"]').press('Escape')
    await expect(status(win)).toBeHidden()
    expect((await invoke(win, 'getChapterWriterReport', chapterId))?.status).toBe('stopped')
  } finally {
    await fake.close()
  }
})

test('Whole chapter with AI: a plan waiting is opened from the top bar in its own story, with another story open, and cancelled from there', async ({
  launch
}) => {
  test.setTimeout(120_000)
  const fake = await startFake({ delayMs: 25 })
  try {
    const { win } = await launch({ env: NEW_LOOK })
    const { chapterId, ferry } = await setUp(win, fake)
    await start(win)
    await expect(planView(win)).toBeVisible({ timeout: 60_000 })
    // The window opens again at another story while the plan waits (2026-10-21: the top bar looked for it in the story
    // open, and it could be neither read nor cancelled).
    const other = await invoke(win, 'createStory', { title: 'Winter Crossing' })
    await invoke(win, 'updateSettings', { lastStoryId: other.id })
    await win.reload()
    await expect(status(win)).toContainText('The chapter plan is ready for you')
    await status(win).getByRole('button', { name: /ready for you/ }).click()
    await expect(planView(win).getByTestId('chapter-plan')).toContainText('1 · The ferry')
    // Cancel beside it ends the run from wherever Adam is: nothing in the chapter changed.
    await status(win).getByRole('button', { name: 'Cancel' }).click()
    await expect(win.getByText('Cancelled before writing: nothing in the chapter changed.')).toBeVisible({ timeout: 30_000 })
    await expect(status(win)).toBeHidden()
    expect((await invoke(win, 'getChapterWriterReport', chapterId))?.status).toBe('cancelled')
    expect((await invoke(win, 'getScene', ferry)).text).toBe(FERRY)
  } finally {
    await fake.close()
  }
})
