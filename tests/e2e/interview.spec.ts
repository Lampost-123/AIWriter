// "Interview me" on a scene card and on a chapter, walked through the way Adam works, against the fake
// provider (tests/fake-provider/m4/outline.mjs answers "[AIWRITE-OUTLINE v1] interview", "fill" and "plan":
// a scene's questions "Who walks in first?", "How should it end?", "How should it feel?"; a chapter's "What
// happens in this chapter?", "How does the chapter end?"; then {"done": true}).
//
//  1. A scene: the AI asks one question at a time; Adam answers, skips, and says he's done. Only the
//     card's empty parts are filled (his goal stays), with Undo; the second time the AI says it has
//     enough on its own, and the palette starts it too.
//  2. A chapter: from the chapter's menu in the binder, a page with the chapter's goal and the interview;
//     when the AI has enough, the chapter gets a goal and scene cards to keep, edit or discard. The first
//     kept takes the place of the chapter's empty "Scene 1"; Undo puts it back.
import type { Page } from '@playwright/test'
import { binder, createWorldFromWelcome, expect, invoke, test, useFakeModel } from './helpers'

const main = (win: Page) => win.locator('main')
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')
const toastWith = (win: Page, text: string) => toasts(win).locator(':scope > div', { hasText: text })
const undoIn = (win: Page, text: string) => toastWith(win, text).getByRole('button', { name: 'Undo' })
const sceneCard = (win: Page) => win.getByRole('tabpanel', { name: 'Scene card' })
const interview = (win: Page, where: ReturnType<typeof sceneCard>) => where.getByRole('region', { name: 'Interview' })
const answerBox = (where: ReturnType<typeof sceneCard>) => where.getByRole('textbox', { name: 'Your answer' })
const sceneRow = (win: Page, title: string) => binder(win).locator('[data-row="scene"]', { hasText: title })

async function startFake() {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  return startFakeProvider({ delayMs: 2 })
}

async function answer(where: ReturnType<typeof sceneCard>, question: string, words: string): Promise<void> {
  await expect(where.getByText(question)).toBeVisible()
  await answerBox(where).fill(words)
  await answerBox(where).press('Enter')
}

test('a scene interview asks about what the card is missing, and fills only its empty parts, with Undo', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Varn')
    const [story] = await invoke(win, 'listStories')
    await invoke(win, 'createEntry', 'character', { name: 'Mara Venn', originStoryId: story.id })
    await invoke(win, 'createEntry', 'place', { name: 'Harrow Docks', originStoryId: story.id })
    await useFakeModel(win, fake)
    const [scene] = (await invoke(win, 'getOutline', story.id)).scenes
    await win.getByRole('tab', { name: 'Scene card' }).click()
    const card = sceneCard(win)
    await card.getByLabel('Goal', { exact: true }).fill('Get the ledger back')

    // ----- One question at a time; Adam answers, skips, and says he's done -----
    fake.reset()
    await card.getByRole('button', { name: 'Interview me' }).click()
    const box = interview(win, card)
    await expect(box.getByText("Who's there")).toBeVisible()
    await expect(card.getByRole('button', { name: 'Interview me' })).toHaveCount(0)
    const asked = fake.lastRequest()!.body.messages
    expect(asked[0].content.startsWith('[AIWRITE-OUTLINE v1] interview scene')).toBe(true)
    expect(asked[1].content).toContain('Goal: Get the ledger back')
    await expect(box.getByRole('button', { name: 'Stop' })).toBeVisible()
    await answer(box, 'Who walks in first?', 'Mara, soaked to the bone')
    await expect(box.getByText('How should it end?')).toBeVisible()
    await expect(box.getByText('1 answer so far.')).toBeVisible()
    await box.getByRole('button', { name: 'Skip' }).click()
    await expect(box.getByText('How should it feel?')).toBeVisible()
    await answerBox(box).fill('Cold and quiet')
    await box.getByRole('button', { name: 'Done' }).click()

    // ----- The card's empty parts are filled; his goal stays -----
    const filled = 'Filled in the beats, conflict, outcome, mood, point of view, characters present and location from your answers.'
    await expect(toastWith(win, filled)).toBeVisible()
    await expect(box).toHaveCount(0)
    expect(fake.lastRequest()!.body.messages[0].content.startsWith('[AIWRITE-OUTLINE v1] fill scene')).toBe(true)
    expect(fake.lastRequest()!.body.messages[1].content).toContain('Answer: Cold and quiet')
    await expect(card.getByLabel('Goal', { exact: true })).toHaveValue('Get the ledger back')
    await expect(card.getByLabel('Outcome', { exact: true })).toHaveValue('Cold and quiet')
    await expect(card.getByRole('textbox', { name: 'Beats', exact: true })).toHaveValue('She reaches the ferry.')
    await expect.poll(async () => (await invoke(win, 'getScene', scene.id)).card.mood).toBe('Tense and quiet')
    const saved = (await invoke(win, 'getScene', scene.id)).card
    expect(saved.goal).toBe('Get the ledger back')
    expect(saved.povId).toBeTruthy()
    expect(saved.locationId).toBeTruthy()

    // ----- Undo takes out what it put in, and nothing of his -----
    await undoIn(win, filled).click()
    await expect(card.getByLabel('Outcome', { exact: true })).toHaveValue('')
    await expect(card.getByRole('textbox', { name: 'Beats', exact: true })).toHaveValue('')
    await expect(card.getByLabel('Goal', { exact: true })).toHaveValue('Get the ledger back')
    await expect.poll(async () => (await invoke(win, 'getScene', scene.id)).card.locationId).toBeNull()

    // ----- From the palette; the AI says when it has enough -----
    await win.keyboard.press('Control+k')
    await win.getByRole('dialog', { name: 'Search' }).getByRole('combobox').fill('interview me about this scene')
    await win.keyboard.press('Enter')
    await answer(box, 'Who walks in first?', 'Mara')
    await answer(box, 'How should it end?', 'She gets away')
    await answer(box, 'How should it feel?', 'Hurried')
    await expect(toastWith(win, 'Filled in the beats')).toBeVisible()
    await expect(card.getByLabel('Outcome', { exact: true })).toHaveValue('Hurried')
  } finally {
    await fake.close()
  }
})

test('a chapter interview gives the chapter a goal and scene cards to keep one by one', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Varn')
    const [story] = await invoke(win, 'listStories')
    await useFakeModel(win, fake)
    const [chapter] = (await invoke(win, 'getOutline', story.id)).chapters
    const [lone] = (await invoke(win, 'getOutline', story.id)).scenes

    // ----- From the chapter's menu in the binder -----
    fake.reset()
    await binder(win).locator('[data-row="chapter"]', { hasText: 'Chapter 1' }).click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Interview me about this chapter' }).click()
    await expect(main(win).getByRole('heading', { level: 1 })).toHaveText('Chapter 1')
    const page = main(win)
    const box = page.getByRole('region', { name: 'Interview' })
    await answer(box, 'What happens in this chapter?', 'A letter comes for Mara')
    expect(fake.lastRequest()!.body.messages[0].content.startsWith('[AIWRITE-OUTLINE v1] interview chapter')).toBe(true)
    await answer(box, 'How does the chapter end?', 'She finds the mill')

    // ----- The AI has enough: a goal for the chapter, and scene cards to decide on -----
    await expect(box).toHaveCount(0)
    const suggestion = (title: string) => page.getByRole('group', { name: `Scene: ${title}`, exact: true })
    await expect(suggestion('The name on the door')).toBeVisible()
    await expect(page.locator('[data-suggestion]')).toHaveCount(3)
    expect(fake.lastRequest()!.body.messages[0].content.startsWith('[AIWRITE-OUTLINE v1] plan chapter')).toBe(true)
    await expect(toastWith(win, 'Gave the chapter a goal from your answers.')).toBeVisible()
    await expect(page.getByLabel('Goal', { exact: true })).toHaveValue('A letter comes for Mara.')
    await expect.poll(async () => (await invoke(win, 'getOutline', story.id)).chapters[0].goal).toBe('A letter comes for Mara.')

    // ----- Keep one: it takes the place of the chapter's empty "Scene 1" -----
    await page.getByRole('button', { name: 'Keep “Questions at the market”', exact: true }).click()
    const kept = 'Added “Questions at the market” to the chapter.'
    await expect(toastWith(win, kept)).toBeVisible()
    await expect(sceneRow(win, 'Questions at the market')).toBeVisible()
    await expect(sceneRow(win, 'Scene 1')).toHaveCount(0)
    await expect.poll(async () => (await invoke(win, 'getScene', lone.id)).title).toBe('Questions at the market')

    // ----- Discard one, keep the rest -----
    await page.getByRole('button', { name: 'Discard “The name on the door”', exact: true }).click()
    await expect(suggestion('The name on the door')).toHaveCount(0)
    await page.getByRole('button', { name: 'Keep all that’s left' }).click()
    await expect(sceneRow(win, 'A letter at dawn')).toBeVisible()
    await expect(page.getByText('Everything is decided.', { exact: false })).toBeVisible()
    const scenes = (await invoke(win, 'getOutline', story.id)).scenes.filter((s) => s.chapterId === chapter.id)
    expect(scenes.map((s) => s.title)).toEqual(['A letter at dawn', 'Questions at the market'])
    const dawn = await invoke(win, 'getScene', scenes[0].id)
    expect(dawn.card.goal).toBe('A letter arrives that Mara was never meant to read.')
    expect(dawn.card.when).toBe('Day 2, morning')

    // ----- Undo (one toast for both keeps): "Scene 1" is back as it was -----
    await undoIn(win, 'Added 2 scenes to the chapter.').click()
    await expect(sceneRow(win, 'Scene 1')).toBeVisible()
    await expect(sceneRow(win, 'Questions at the market')).toHaveCount(0)
    await expect(sceneRow(win, 'A letter at dawn')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Keep “A letter at dawn”', exact: true })).toBeVisible()
  } finally {
    await fake.close()
  }
})
