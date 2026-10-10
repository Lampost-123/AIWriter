// Write the whole chapter (contracts/chapterWriter.ts), end to end against the fake AI server: the agent's calls are
// scripted (tests/fake-provider/chapter.mjs: a brief, one fix per scene with findings, then done), the checks find
// nothing in the fake prose, and the critic's notes come the first time and none on a re-read. Started from the
// palette's "Whole chapter with AI"; the dialog lists the scenes; while it works the top bar says so and the open scene
// can't be typed in; it ends in a message with Show (the report on the chapter card) and Undo (the words before).
import type { Page } from '@playwright/test'
import { binder, createWorldFromWelcome, expect, invoke, startFake, test, useFakeModel } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const row = (win: Page, title: string) => binder(win).locator('[data-row]', { hasText: title }).first()
const dialog = (win: Page) => win.getByRole('dialog', { name: 'Write this chapter with AI' })
const status = (win: Page) => win.getByTestId('chapter-writer-status')

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
  await win.reload()
  await row(win, 'The ferry').click()
  await expect(prose(win)).toContainText(FERRY)
  return { ferry, inn, chapterId }
}

test('Whole chapter with AI: writes every scene, holds the open one while it works, ends clean with Show and Undo', async ({ launch }) => {
  test.setTimeout(180_000)
  const fake = await startFake({ delayMs: 25 })
  try {
    const { win } = await launch({ env: { AIWRITE_KEEPER_QUIET_MS: '600000' } })
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

    // While it works: the top bar says what it is doing, and the open scene can be read but not typed in.
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

    // Undo puts the chapter back as it was.
    await written.getByRole('button', { name: 'Undo' }).click()
    await expect(win.getByText('Put back 2 scenes as they were before the AI wrote the chapter.')).toBeVisible()
    expect((await invoke(win, 'getScene', ferry)).text).toBe(FERRY)
    expect((await invoke(win, 'getScene', inn)).text).toBe('')
    await expect(prose(win)).toContainText(FERRY)
  } finally {
    await fake.close()
  }
})

test('Whole chapter with AI can be stopped from the top bar, keeping what was written', async ({ launch }) => {
  test.setTimeout(120_000)
  const fake = await startFake({ delayMs: 60 })
  try {
    const { win } = await launch({ env: { AIWRITE_KEEPER_QUIET_MS: '600000' } })
    const { chapterId } = await setUp(win, fake)
    await win.keyboard.press('Control+K')
    await win.keyboard.type('Whole chapter')
    await win.getByRole('option', { name: /^Whole chapter with AI/ }).first().click()
    await dialog(win).getByTestId('chapter-writer-start').click()
    await status(win).getByRole('button').first().click()
    await win.getByTestId('chapter-writer-stop').click()
    await expect(win.getByText('Stopped writing Chapter 1. The words so far are kept; Undo puts the chapter back.')).toBeVisible({ timeout: 30_000 })
    await expect(status(win)).toBeHidden()
    expect((await invoke(win, 'getChapterWriterReport', chapterId))?.status).toBe('stopped')
  } finally {
    await fake.close()
  }
})
