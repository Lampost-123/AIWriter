// Interviews by topic (Adam, 2026-10-20: separate interviews for characters, places, lore and history, then how it all
// connects), against the fake provider (tests/fake-provider/m4/worldTopics.mjs: each topic asks two questions, then one,
// then has enough; its suggestions are made from the answers one sentence at a time). In Build with AI's Cast and world:
// the characters interview (answer, skip, a second round, its pages suggested by themselves, Change, Keep, Undo), the
// places interview stopped early (Stop asking, Keep all, a room put inside its town), then How it all connects (offered
// once something is kept: a relationship and a secret kept, a Discard undone). Then the World builder page, for a
// world with no story. Nothing goes into the world without a click.
import type { Page } from '@playwright/test'
import { binder, createWorldFromWelcome, expect, invoke, openPage, startFake, test, useFakeModel } from './helpers'

const main = (win: Page) => win.locator('main')
const interviews = (win: Page) => main(win).locator('[data-topic-interviews]')
const topic = (win: Page, t: string) => interviews(win).locator(`[data-topic="${t}"]`)
const panel = (win: Page, t: string) => interviews(win).locator(`[data-topic-panel="${t}"]`)
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')
const entriesOf = async (win: Page, kind: 'character' | 'place' | 'lore') => invoke(win, 'listEntries', kind)

test('the characters and places interviews suggest pages to keep, change or discard; How it all connects links them', async ({ launch }) => {
  test.setTimeout(180_000)
  const fake = await startFake({ delayMs: 1 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Grey Coast')
    await useFakeModel(win, fake)

    // ----- Build with AI, Cast and world -----
    await binder(win).locator('[data-story-menu]').click()
    await win.getByRole('menuitem', { name: 'Build with AI' }).click()
    const area = main(win).locator('[data-plan-hub]')
    await area.locator('[data-nav="cast"]').click()
    await expect(interviews(win)).toBeVisible()
    await expect(topic(win, 'characters')).toContainText('Not started')
    // How it all connects waits until the world has a character, place or lore to link.
    await expect(topic(win, 'connections')).toBeDisabled()
    await expect(topic(win, 'connections')).toContainText('Add a character, place or lore first')

    // ----- Characters: two questions, then one, then the pages by themselves -----
    await topic(win, 'characters').click()
    const chars = panel(win, 'characters')
    const first = chars.getByLabel('Who is the main character, and what do they want most?')
    await expect(first).toBeFocused()
    await expect(chars.getByLabel('Who stands in their way, and why?')).toBeVisible()
    await expect(chars.getByRole('button', { name: 'Answer' })).toBeDisabled()
    // One answered, one left empty (skipped).
    await first.fill('Mara Venn is a smuggler captain. Mara Venn wants to pay off the Salt Guild.')
    await chars.getByRole('button', { name: 'Answer' }).click()
    const talk = chars.getByLabel('How does the main character talk?')
    await expect(talk).toBeVisible()
    await expect(chars).toContainText('1 answered, 1 skipped')
    await expect(topic(win, 'characters')).toContainText('Under way')
    await talk.fill('Mara Venn talks in clipped orders.')
    await talk.press('Control+Enter')
    // The fake has enough now: the pages are suggested without another click. Nothing is made yet.
    const mara = chars.locator('[data-suggestion]', { hasText: 'Mara Venn' })
    await expect(mara).toBeVisible()
    await expect(chars.getByRole('status')).toHaveText('1 page to keep, change or discard')
    await expect(mara).toContainText('What they want: Mara Venn wants to pay off the Salt Guild.')
    await expect(mara).toContainText('How they speak: Mara Venn talks in clipped orders.')
    expect(await entriesOf(win, 'character')).toEqual([])
    await expect(chars.getByRole('button', { name: 'What the AI saw' })).toBeVisible()

    // Change, then Keep: the page is made, his change kept as his.
    await mara.getByRole('button', { name: 'Change Mara Venn' }).click()
    const edit = chars.locator('[data-suggestion-edit]')
    await edit.getByLabel('In a line').fill('A smuggler captain deep in debt.')
    await edit.getByRole('button', { name: 'Done' }).click()
    await expect(mara).toContainText('A smuggler captain deep in debt.')
    await mara.getByRole('button', { name: 'Keep Mara Venn' }).click()
    await expect(mara.locator('[data-kept]')).toBeVisible()
    await expect(toasts(win)).toContainText('Kept “Mara Venn” in your world.')
    await expect.poll(async () => (await entriesOf(win, 'character')).map((e) => e.name)).toEqual(['Mara Venn'])
    const kept = (await entriesOf(win, 'character'))[0]
    expect(kept.summary).toBe('A smuggler captain deep in debt.')
    expect(kept.fieldOrigins.summary ?? kept.origin).toBe('adam')
    expect(kept.fields.speech).toBe('Mara Venn talks in clipped orders.')
    await expect(topic(win, 'characters')).toContainText('Done · 1 kept')
    await expect(topic(win, 'connections')).toBeEnabled()
    // Undo on the row takes it out again; Keep puts it back.
    await mara.getByRole('button', { name: 'Undo keeping Mara Venn' }).click()
    await expect.poll(async () => (await entriesOf(win, 'character')).length).toBe(0)
    await expect(topic(win, 'characters')).toContainText('Under way')
    await mara.getByRole('button', { name: 'Keep Mara Venn' }).click()
    await expect(topic(win, 'characters')).toContainText('Done · 1 kept')

    // ----- Places: Stop asking after the first round, Keep all -----
    await topic(win, 'places').click()
    await expect(panel(win, 'characters')).toBeHidden()
    const places = panel(win, 'places')
    await places.getByLabel('Where does the story mostly happen?').fill('Saltmarsh is a port town lost in fog.')
    await places.getByLabel('Which smaller places inside it matter most?').fill('The Anchor Inn is inside Saltmarsh.')
    await places.locator('[data-stop-asking]').click()
    await expect(places.getByRole('status')).toHaveText('2 pages to keep, change or discard')
    await expect(places.locator('[data-suggestion]', { hasText: 'The Anchor Inn' })).toContainText('Inside Saltmarsh')
    await places.getByRole('button', { name: 'Keep all' }).click()
    await expect(places.getByRole('status')).toHaveText('All decided · 2 kept')
    await expect.poll(async () => (await entriesOf(win, 'place')).map((e) => e.name).sort()).toEqual(['Saltmarsh', 'The Anchor Inn'])
    const placeList = await entriesOf(win, 'place')
    const saltmarsh = placeList.find((p) => p.name === 'Saltmarsh')!
    expect(placeList.find((p) => p.name === 'The Anchor Inn')!.parentId).toBe(saltmarsh.id)
    await expect(topic(win, 'places')).toContainText('Done · 2 kept')

    // ----- How it all connects: links between what was kept -----
    await topic(win, 'connections').click()
    const links = panel(win, 'connections')
    await links.getByLabel('Who lives or works where?').fill('Mara Venn lives at Saltmarsh.')
    await links.getByLabel('Who knows which secrets?').fill('Mara Venn’s secret is she sank the Merrow.')
    await links.locator('[data-stop-asking]').click()
    await expect(links.getByRole('status')).toHaveText('2 links to keep, change or discard')
    const lives = links.locator('[data-suggestion]', { hasText: 'Mara Venn lives at Saltmarsh' })
    const secret = links.locator('[data-suggestion]', { hasText: 'Mara Venn: Secrets they keep' })
    await expect(secret).toContainText('She sank the Merrow.')
    await lives.getByRole('button', { name: /^Keep / }).click()
    await expect(lives.locator('[data-kept]')).toBeVisible()
    // Discarded, then brought back by the toast's Undo, then kept.
    await secret.getByRole('button', { name: /^Discard / }).click()
    await expect(secret).toBeHidden()
    await toasts(win).getByRole('button', { name: 'Undo' }).last().click()
    await expect(secret).toBeVisible()
    await secret.getByRole('button', { name: /^Keep / }).click()
    await expect(links.getByRole('status')).toHaveText('All decided · 2 kept')
    const maraId = (await entriesOf(win, 'character'))[0].id
    await expect.poll(async () => (await invoke(win, 'getEntry', maraId)).fields.secrets).toBe('She sank the Merrow.')
    const changes = await invoke(win, 'listChanges', maraId)
    expect(changes.some((c) => c.kind === 'relationship' && c.payload.otherId === saltmarsh.id && c.payload.type === 'lives at')).toBe(true)
    await expect(topic(win, 'connections')).toContainText('Done · 2 kept')

    // Each request was the World builder model's, marked by its job.
    expect(String(fake.lastRequest()?.body.messages[0].content)).toMatch(/^\[AIWRITE-WORLD v1\] topic-suggest connections/)
  } finally {
    await fake.close()
  }
})

test('the World builder page, for a world with no story, has the same interviews', async ({ launch }) => {
  const fake = await startFake({ delayMs: 1 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Grey Coast')
    await useFakeModel(win, fake)
    const [story] = await invoke(win, 'listStories')
    await invoke(win, 'deleteStory', story.id)
    await win.reload()
    await openPage(win, 'Build from a summary')
    await expect(main(win).getByRole('heading', { name: 'Build the world from a summary' })).toBeVisible()
    await topic(win, 'lore').click()
    const lore = panel(win, 'lore')
    await lore.getByLabel('How does magic work, and what does it cost?').fill('Tide Magic costs blood, always.')
    await lore.locator('[data-stop-asking]').click()
    const tide = lore.locator('[data-suggestion]', { hasText: 'Tide Magic' })
    await expect(tide).toContainText('Always true, never to be broken')
    await tide.getByRole('button', { name: /^Keep / }).click()
    await expect(topic(win, 'lore')).toContainText('Done · 1 kept')
    await expect.poll(async () => (await entriesOf(win, 'lore')).map((e) => [e.name, e.hardRule])).toEqual([['Tide Magic', true]])
    // The kept page isn't a build: the page's own results stay empty.
    expect((await invoke(win, 'getWorldBuilder')).last).toBeNull()
  } finally {
    await fake.close()
  }
})
