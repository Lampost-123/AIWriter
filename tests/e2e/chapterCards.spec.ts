// Chapter cards (2026-10-08), walked through the way Adam works, with invented test data only:
//
//  1. Clicking a chapter in the binder opens its card beside the page. What he sets there reaches the chapter's
//     scenes at once ("Updated 2 scenes", with Undo); each scene card tags those parts "From chapter". Changing one
//     on a scene makes it the scene's own (a later chapter change leaves it be); "Use chapter's" follows the chapter
//     again. A new scene starts with the chapter's card. From the chapter's menu, the keyboard carries on in the card.
//  2. The outline helper (the fake provider, "[[fake: chapter card]]" in the premise) fills each kept chapter's card,
//     and a scene that happens somewhere else keeps that as its own.
//
// With AIWRITE_SHOTS set to a folder, pictures of the window go there once every animation has ended.
import type { Page } from '@playwright/test'
import { binder, createWorldFromWelcome, expect, invoke, test, useFakeModel } from './helpers'

const main = (win: Page) => win.locator('main')
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')
const toastWith = (win: Page, text: string) => toasts(win).locator(':scope > div', { hasText: text })
const chapterRow = (win: Page, title: string) => binder(win).locator('[data-row="chapter"]', { hasText: title })
const sceneRow = (win: Page, title: string) => binder(win).locator('[data-row="scene"]', { hasText: title })
const chapterCard = (win: Page) => win.getByRole('region', { name: 'Chapter card' })
const sceneCard = (win: Page) => win.getByRole('tabpanel', { name: 'Scene card' })
/** A part of the scene card a chapter card carries, with its label, tag and "Use chapter's". */
const part = (win: Page, label: string) => sceneCard(win).locator(`[data-carry="${label}"]`)

async function shot(win: Page, name: string): Promise<void> {
  const dir = process.env.AIWRITE_SHOTS
  if (!dir) return
  type Anim = { finished: Promise<unknown>; effect: { getComputedTiming(): { iterations?: number } } | null }
  await win.evaluate(() =>
    Promise.all(
      (globalThis as unknown as { document: { getAnimations(): Anim[] } }).document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined))
    )
  )
  await win.waitForTimeout(150)
  await win.screenshot({ path: `${dir}/${name}.png` })
}

/** Picks an option in one of a card's pickers. */
async function pick(win: Page, where: ReturnType<typeof chapterCard>, label: string | RegExp, option: string): Promise<void> {
  await where.getByRole('combobox', { name: label }).click()
  await win.getByRole('option', { name: option, exact: true }).click()
  await expect(where.getByRole('combobox', { name: label })).toHaveText(option)
}

/** Adds a scene at the end of the chapter with its + button, keeping the name it is given. */
async function addScene(win: Page, chapter: string, title: string): Promise<void> {
  const row = chapterRow(win, chapter)
  await row.hover()
  await row.getByRole('button', { name: 'Add a scene to this chapter' }).click()
  const rename = binder(win).getByRole('textbox', { name: 'Scene title' })
  await expect(rename).toHaveValue(title)
  await rename.press('Enter')
  await expect(sceneRow(win, title)).toBeVisible()
}

/** The lighthouse keeper's world: two characters and two places, made the way the builders make them. */
async function makeCast(win: Page): Promise<void> {
  await invoke(win, 'createEntry', 'character', { name: 'Wren Calloway', summary: 'Keeps the light on Calloway Point.' })
  await invoke(win, 'createEntry', 'character', { name: 'Odo Calloway', summary: 'Her younger brother, a boatman.' })
  await invoke(win, 'createEntry', 'place', { name: 'The Lamp Tower', summary: 'The lighthouse on the point.' })
  await invoke(win, 'createEntry', 'place', { name: 'Gull Quay', summary: 'Where the boats come in.' })
}

test('a chapter card reaches the scenes that follow it; a scene keeps what it changes, and can follow the chapter again', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Calloway Point')
  await makeCast(win)
  await addScene(win, 'Chapter 1', 'Scene 2')
  await sceneRow(win, 'Scene 1').click()
  await expect(sceneCard(win)).toBeVisible()

  // ----- A click on the chapter opens its card beside the page -----
  await chapterRow(win, 'Chapter 1').click()
  const card = chapterCard(win)
  await expect(card.getByRole('heading', { name: 'Chapter card: Chapter 1' })).toBeVisible()
  await expect(card).toContainText('Its 2 scenes follow each part')
  await expect(chapterRow(win, 'Chapter 1')).toHaveAttribute('data-card-open', 'true')
  await pick(win, card, 'Point of view', 'Wren Calloway')
  await pick(win, card, 'Location', 'The Lamp Tower')
  await card.getByLabel('When', { exact: true }).fill('Day 4, dawn')
  await card.getByLabel('Mood or tone', { exact: true }).fill('Hushed, salt in the air')
  // One toast for every change while it shows, with one Undo.
  await expect(toastWith(win, 'Updated 2 scenes that follow this chapter card.')).toBeVisible()
  await expect(card.getByText('Saved')).toBeVisible()
  await shot(win, '1-chapter-card')

  // ----- Each scene card has the chapter's values, tagged "From chapter" -----
  await sceneRow(win, 'Scene 1').click()
  await expect(chapterCard(win)).toHaveCount(0)
  await expect(sceneCard(win)).toBeVisible()
  // The change written as the card closed joined the same toast.
  await expect(sceneCard(win).getByRole('textbox', { name: /^Mood or tone/ })).toHaveValue('Hushed, salt in the air')
  await expect(toastWith(win, 'that follow this chapter card')).toHaveCount(1)
  await expect(part(win, 'Point of view')).toContainText('From chapter')
  await expect(sceneCard(win).getByRole('combobox', { name: 'Point of view (from the chapter card)' })).toHaveText('Wren Calloway')
  await expect(sceneCard(win).getByRole('combobox', { name: /^Location/ })).toHaveText('The Lamp Tower')
  const when = sceneCard(win).getByRole('textbox', { name: /^When/ })
  await expect(when).toHaveValue('Day 4, dawn')
  await expect(part(win, 'When')).toContainText('From chapter')
  await expect(sceneCard(win).getByRole('textbox', { name: /^Mood or tone/ })).toHaveValue('Hushed, salt in the air')
  // A part the chapter card leaves empty has no tag.
  await expect(part(win, 'Notes for the AI')).not.toContainText('From chapter')
  await shot(win, '2-scene-follows-chapter')

  // ----- Changing it here makes it the scene's own -----
  await when.fill('Day 4, dusk')
  await expect(part(win, 'When')).not.toContainText('From chapter')
  const useWhen = part(win, 'When').getByRole('button', { name: "Use the chapter's when" })
  await expect(useWhen).toBeVisible()
  await expect(sceneCard(win).getByText('Saved')).toBeVisible()
  await shot(win, '3-scene-own-when')

  // A later change to the chapter's When reaches Scene 2, never Scene 1's own.
  await chapterRow(win, 'Chapter 1').click()
  await chapterCard(win).getByLabel('When', { exact: true }).fill('Day 5, dawn')
  await expect(chapterCard(win).getByText('Saved')).toBeVisible()
  const [story] = await invoke(win, 'listStories')
  const ids = async (): Promise<string[]> => (await invoke(win, 'getOutline', story.id)).scenes.map((s) => s.id)
  const [first, second] = await ids()
  await expect.poll(async () => (await invoke(win, 'getScene', second)).card.when).toBe('Day 5, dawn')
  expect((await invoke(win, 'getScene', first)).card.when).toBe('Day 4, dusk')

  // ----- "Use chapter's" follows the chapter again, from the keyboard too -----
  await sceneRow(win, 'Scene 1').click()
  await expect(when).toHaveValue('Day 4, dusk')
  await useWhen.focus()
  await win.keyboard.press('Enter')
  await expect(when).toHaveValue('Day 5, dawn')
  await expect(part(win, 'When')).toContainText('From chapter')
  await expect.poll(async () => (await invoke(win, 'getScene', first)).card.inherits?.when).toBe(true)

  // ----- A new scene starts with the chapter's card -----
  await addScene(win, 'Chapter 1', 'Scene 3')
  await sceneRow(win, 'Scene 3').click()
  await expect(sceneCard(win).getByRole('combobox', { name: 'Point of view (from the chapter card)' })).toHaveText('Wren Calloway')
  await expect(sceneCard(win).getByRole('textbox', { name: /^When/ })).toHaveValue('Day 5, dawn')

  // ----- From the chapter's menu, the keyboard carries on in the card; Undo puts a change back -----
  await chapterRow(win, 'Chapter 1').click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Chapter card' }).click()
  await expect(chapterCard(win).getByRole('button', { name: 'Back to Scene card' })).toBeFocused()
  await chapterCard(win).getByLabel('Mood or tone', { exact: true }).fill('Storm coming')
  const updated = 'Updated 3 scenes that follow this chapter card.'
  await expect(toastWith(win, updated)).toBeVisible()
  await toastWith(win, updated).getByRole('button', { name: 'Undo' }).click()
  await expect(chapterCard(win).getByLabel('Mood or tone', { exact: true })).toHaveValue('Hushed, salt in the air')
  await expect.poll(async () => (await invoke(win, 'getScene', first)).card.mood).toBe('Hushed, salt in the air')
  await chapterCard(win).getByRole('button', { name: 'Back to Scene card' }).click()
  await expect(sceneCard(win)).toBeVisible()
  await expect(sceneCard(win).getByRole('textbox', { name: /^Mood or tone/ })).toHaveValue('Hushed, salt in the air')
})

test('the outline helper fills each chapter card, and a scene somewhere else keeps that as its own', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 2 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Calloway Point')
    await makeCast(win)
    const [story] = await invoke(win, 'listStories')
    await invoke(win, 'updateStory', story.id, {
      premise: 'Wren Calloway keeps the light on Calloway Point through the winter the boats stop coming. [[fake: chapter card]]'
    })
    await useFakeModel(win, fake)

    await binder(win).getByRole('button', { name: 'Book 1', exact: true }).click()
    await win.getByRole('menuitem', { name: 'Outline helper' }).click()
    for (const [label, option] of [
      ['Acts', 'No acts'],
      ['Chapters', '2 chapters'],
      ['Scenes in each chapter', '3 scenes in each']
    ]) {
      await main(win).getByRole('combobox', { name: label, exact: true }).click()
      await win.getByRole('option', { name: option, exact: true }).click()
    }
    await main(win).getByRole('button', { name: 'Suggest an outline' }).click()
    await expect(main(win).getByText('Here is the outline: 2 chapters and 6 scenes. Keep what you like.')).toBeVisible()
    const sent = fake.lastRequest()!.body.messages
    expect(sent[0].content).toContain('Point of view: <the character whose eyes most of the chapter is seen through>')
    // The fake gives the first character and place the briefing lists, and the second place to the third scene.
    const listed = (kind: string): string[] =>
      [...String(sent[1].content).matchAll(new RegExp(`^- (.+?) \\(${kind}\\)`, 'gm'))].map((m) => m[1])
    const [pov] = listed('character')
    const [place, elsewhere] = listed('place')
    expect([pov, place, elsewhere].every(Boolean)).toBe(true)
    await main(win).getByRole('button', { name: 'Keep all that’s left' }).click()
    await expect(chapterRow(win, 'Rain on the Narrows')).toBeVisible()

    // The chapter's card, from the outline.
    await sceneRow(win, 'Arrival at the docks').click()
    await chapterRow(win, 'Rain on the Narrows').click()
    const card = chapterCard(win)
    await expect(card.getByRole('combobox', { name: 'Point of view' })).toHaveText(pov)
    await expect(card.getByRole('combobox', { name: 'Location' })).toHaveText(place)
    await expect(card.getByLabel('When', { exact: true })).toHaveValue('Day 1, morning')
    await expect(card.getByLabel('Mood or tone', { exact: true })).toHaveValue('Wet and watchful')
    await expect(card).toContainText('Odo Calloway')
    await expect(card).toContainText('Wren Calloway')
    await shot(win, '4-outline-chapter-card')

    // Its first scene follows it all; its third is at the quay, as its own.
    await card.getByRole('button', { name: 'Back to Scene card' }).click()
    await expect(part(win, 'When')).toContainText('From chapter')
    await expect(part(win, 'Location')).toContainText('From chapter')
    await sceneRow(win, 'Pursuit through the docks').click()
    await expect(sceneCard(win).getByRole('combobox', { name: /^Location/ })).toHaveText(elsewhere)
    await expect(part(win, 'Location').getByRole('button', { name: "Use the chapter's location" })).toBeVisible()
    await expect(part(win, 'Point of view')).toContainText('From chapter')
    await expect(sceneCard(win).getByRole('textbox', { name: /^When/ })).toHaveValue('Day 1, afternoon')
    await shot(win, '5-outline-scene-own-place')
  } finally {
    await fake.close()
  }
})
