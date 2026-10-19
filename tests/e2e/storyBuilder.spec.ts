// The Story builder (Adam, 2026-10-17: one place to build a story from), against the fake provider (its
// tests/fake-provider/story.mjs answers "[AIWRITE-STORY v1]" requests). From the story menu: the plot and his own
// character, a style preset for the story, then the cast and world planned (his own first), talked over (a preview,
// applied), one item redone, built into the codex in full; then the outline from the idea and the codex (with a
// premise written for it), talked over (a scene kept and one changed by hand before it stay so), one scene redone
// and kept. Nothing changes without a click.
import type { Page } from '@playwright/test'
import { binder, createWorldFromWelcome, expect, invoke, startFake, test, useFakeModel } from './helpers'

const main = (win: Page) => win.locator('main')
const talk = (win: Page, name: string) => main(win).getByRole('region', { name })

test('a plot becomes a whole cast and world, then an outline, each part talked over or redone before it is kept', async ({ launch }) => {
  const fake = await startFake({ delayMs: 1 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Grey Coast')
    const [story] = await invoke(win, 'listStories')
    await useFakeModel(win, fake)

    // ----- From the story menu, at its first step -----
    await binder(win).getByRole('button', { name: 'Book 1', exact: true }).click()
    await win.getByRole('menuitem', { name: 'Story builder' }).click()
    await expect(main(win).getByRole('heading', { level: 1 })).toHaveText('Build “Book 1” with the AI')
    await expect(main(win).locator('[data-step="idea"]')).toHaveAttribute('aria-current', 'step')

    // ----- Your idea: the plot and his own character, kept silently -----
    await main(win).getByLabel('Your plot').fill('A lighthouse keeper’s daughter has one winter to find out who is wrecking ships on purpose.')
    await main(win).getByRole('button', { name: 'Add one' }).click()
    await main(win).getByLabel('Name').fill('Ida Marr')
    await main(win).getByLabel('Who or what it is').fill('The old lighthouse keeper, going blind.')
    // A preset sets the story's whole style at once, with Undo; those for adult readers open with a click.
    const style = main(win).locator('[data-story-style]')
    await style.getByRole('button', { name: 'For adult readers' }).click()
    await style.getByRole('button', { name: /^Hardboiled noir/ }).click()
    await expect(win.getByText('This story is now written as “Hardboiled noir”.')).toBeVisible()
    await expect.poll(async () => (await invoke(win, 'listStories'))[0].style.genres).toEqual(['mystery', 'thriller'])
    await expect.poll(async () => (await invoke(win, 'getStoryBrief', story.id)).mine.map((e) => e.name)).toEqual(['Ida Marr'])

    // ----- Cast and world: planned, his own first, nothing made yet -----
    await main(win).locator('[data-next]').click()
    await expect(main(win).locator('[data-step="codex"]')).toHaveAttribute('aria-current', 'step')
    await main(win).locator('[data-plan-codex]').click()
    const list = main(win).locator('[data-codex-list]')
    await expect(list.locator('[data-item]').first()).toContainText('Ida Marr')
    await expect(list.locator('[data-item]').first()).toContainText('Yours')
    await expect(list).toContainText('Ada Lorne')
    await expect(list).toContainText('Gull Harbour')
    await expect(list).toContainText('Who wrecks the ships')
    expect(await invoke(win, 'listEntries', 'character')).toEqual([])

    // Talked over: the change is shown first, and only Apply makes it.
    const codexTalk = talk(win, 'Talk the cast and world over')
    await codexTalk.getByLabel('What would you like changed?').fill('Add a rival')
    await codexTalk.getByRole('button', { name: 'Send' }).click()
    await expect(codexTalk.locator('[data-talk-preview]')).toContainText('Corin Vale')
    await expect(list).not.toContainText('Corin Vale')
    await codexTalk.locator('[data-apply]').click()
    await expect(list).toContainText('Corin Vale')
    await expect(codexTalk).toContainText('Applied')

    // One item done again, with a note: the new version shows first.
    const bram = list.locator('[data-item]', { hasText: 'Bram Holt' })
    await bram.locator('[data-item-redo]').click()
    await bram.getByLabel('What should be different').fill('make him kinder')
    await bram.getByRole('button', { name: 'Write it again' }).click()
    await expect(bram).toContainText('Redone: make him kinder.')
    await bram.getByRole('button', { name: 'Use this' }).click()
    await expect(bram.getByText(/^Redone: make him kinder\./)).toBeVisible()

    // Built into the codex in full, live on the page.
    await main(win).locator('[data-build]').click()
    await expect(main(win).locator('[data-build-status]')).toContainText('Built', { timeout: 60_000 })
    const people = (await invoke(win, 'listEntries', 'character')).map((e) => e.name).sort()
    expect(people).toEqual(expect.arrayContaining(['Ada Lorne', 'Bram Holt', 'Corin Vale', 'Ida Marr']))
    expect((await invoke(win, 'listEntries', 'place')).map((e) => e.name)).toContain('Gull Harbour')
    expect((await invoke(win, 'getStoryBrief', story.id)).built).not.toBeNull()

    // ----- The outline: planned from the idea and the codex, with a premise written for it -----
    await main(win).locator('[data-step-bar] [data-step="outline"]').first().click()
    await expect(main(win).getByLabel('Premise', { exact: true })).toHaveAttribute('placeholder', /^Optional: the AI writes it from your plot/)
    await main(win).getByRole('button', { name: 'Suggest an outline' }).click()
    await expect(main(win).getByText(/^Here is the outline: /)).toBeVisible()
    const sent = fake.lastRequest()!.body.messages
    expect(sent[0].content.startsWith('[AIWRITE-STORY v1] outline')).toBe(true)
    expect(sent[1].content).toContain('Ida Marr')
    expect(sent[1].content).toContain('Genre: Mystery')
    await main(win).locator('[data-premise-card]').getByRole('button', { name: 'Keep as the premise' }).click()
    await expect.poll(async () => (await invoke(win, 'listStories'))[0].premise).toMatch(/^A lighthouse keeper’s daughter must find out/)

    // Before talking it over, one scene kept and one changed by hand: both carry over the talk.
    const group = (kind: string, title: string) => main(win).getByRole('group', { name: `${kind}: ${title}`, exact: true })
    await main(win).getByRole('button', { name: 'Keep “The Wreck”' }).click()
    await expect(group('Scene', 'The Wreck')).toHaveAttribute('data-state', 'kept')
    await main(win).getByRole('button', { name: 'Edit “Salvage Rights”' }).click()
    const form = main(win).getByRole('form', { name: 'Edit the scene' })
    await form.getByLabel('What happens', { exact: true }).fill('Bram claims the cargo before dawn.')
    await form.getByRole('button', { name: 'Save changes' }).click()
    await expect(group('Scene', 'Salvage Rights')).toContainText('Changed by you')

    // Talked over: the revised plan is a preview until Apply.
    const planTalk = talk(win, 'Talk it over')
    await planTalk.getByLabel('What would you like changed?').fill('Make the first chapter a betrayal')
    await planTalk.getByRole('button', { name: 'Send' }).click()
    await expect(planTalk.locator('[data-talk-preview]')).toContainText('The Betrayal')
    await expect(main(win).locator('[data-suggestion="chapter"]').first()).toHaveAttribute('aria-label', 'Chapter: Grey Water')
    await expect(planTalk.locator('[data-talk-preview]')).toContainText('1 part changes')
    await planTalk.locator('[data-apply]').click()
    await expect(main(win).locator('[data-suggestion="chapter"]').first()).toHaveAttribute('aria-label', 'Chapter: The Betrayal')
    // What was kept is still kept, in its place, and Adam's words are still his.
    await expect(group('Chapter', 'The Long Night')).toHaveAttribute('data-state', 'kept')
    await expect(group('Scene', 'The Wreck')).toHaveAttribute('data-state', 'kept')
    await expect(main(win).getByRole('button', { name: 'Keep “The Wreck”' })).toHaveCount(0)
    await expect(group('Scene', 'Salvage Rights')).toContainText('Bram claims the cargo before dawn.')
    await expect(group('Scene', 'Salvage Rights')).toContainText('Changed by you')

    // One scene done again: Use this swaps it in, the rest stay as they were.
    const scene = main(win).locator('[data-suggestion="scene"]', { hasText: 'Salvage Rights' })
    await scene.locator('[data-redo]').first().click()
    await main(win).locator('[data-redo-panel]').getByRole('button', { name: 'Write it again' }).click()
    await main(win).locator('[data-redo-panel]').getByRole('button', { name: 'Use this' }).click()
    await expect(main(win).locator('[data-suggestion="scene"]', { hasText: 'A Different Night' })).toBeVisible()
    await expect(main(win).locator('[data-suggestion="scene"]', { hasText: 'The Dark Lamp' })).toBeVisible()

    // Kept: it is in the story, and the codex was not built again for it.
    await main(win).getByRole('button', { name: /^Keep all that/ }).click()
    await expect(main(win).getByText(/^Everything is decided/)).toBeVisible()
    const outline = await invoke(win, 'getOutline', story.id)
    expect(outline.chapters.map((c) => c.title)).toEqual(['The Betrayal', 'The Long Night'])
    expect(outline.scenes.map((s) => s.title)).toContain('A Different Night')
  } finally {
    await fake.close()
  }
})
