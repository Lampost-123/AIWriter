// A new story built end to end in one place, Build with AI (Adam, 2026-10-20: "a unified area to build all parts of the
// story using AI"; the Story builder before), against the fake provider (tests/fake-provider/story.mjs answers
// "[AIWRITE-STORY v1]" requests, m4/outline.mjs a chapter's plan, chapter.mjs Write the chapter). From the story menu,
// in one page: Your idea (the idea and his own character, a style preset), Cast and world (planned, his own first,
// talked over beside it, one item redone, built into the codex), the story line (planned from the idea and the codex
// with a premise written for it, talked over, a scene redone, kept), a chapter planned in its row (Plan this chapter),
// then Write this chapter: its plan to read in the row, with what the chapter does, each scene's ending, what it keeps
// true and about how long and what it costs; written with the fake. Nothing changes without a click.
import type { Page } from '@playwright/test'
import { binder, createWorldFromWelcome, expect, invoke, startFake, test, useFakeModel } from './helpers'

const main = (win: Page) => win.locator('main')
const area = (win: Page) => main(win).locator('[data-plan-hub]')

test('a new story built in one place: idea, cast and world, story line, a chapter planned and written', async ({ launch }) => {
  test.setTimeout(240_000)
  const fake = await startFake({ delayMs: 1 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Grey Coast')
    const [story] = await invoke(win, 'listStories')
    await useFakeModel(win, fake)

    // ----- From the story menu: Build with AI, a new story at Your idea -----
    await binder(win).locator('[data-story-menu]').click()
    await win.getByRole('menuitem', { name: 'Build with AI' }).click()
    await expect(area(win)).toHaveAttribute('data-plan-hub', 'start')
    await expect(area(win).getByRole('heading', { level: 1 })).toHaveText('Build “Book 1” with AI')
    await expect(area(win).locator('[data-nav="idea"]')).toHaveAttribute('aria-current', 'true')
    // Each section says how it stands, in the list of sections and at its head.
    await expect(area(win).locator('[data-nav="idea"]')).toContainText('not written yet')
    await expect(area(win).locator('[data-nav="line"]')).toContainText('nothing planned yet')

    // ----- Your idea: the idea and his own character, kept silently -----
    await area(win).getByLabel(/^Your idea, in your own words/).fill('A lighthouse keeper’s daughter has one winter to find out who is wrecking ships on purpose.')
    await area(win).getByRole('button', { name: 'Add one' }).click()
    await area(win).getByLabel('Name').fill('Ida Marr')
    await area(win).getByLabel('Who or what it is').fill('The old lighthouse keeper, going blind.')
    await expect(area(win).locator('[data-nav="idea"]')).toContainText('written')
    // A preset sets the story's whole style at once, with Undo; those for adult readers open with a click.
    const style = area(win).locator('[data-story-style]')
    await style.getByRole('button', { name: 'For adult readers' }).click()
    await style.getByRole('button', { name: /^Hardboiled noir/ }).click()
    await expect(win.getByText('This story is now written as “Hardboiled noir”.')).toBeVisible()
    await expect.poll(async () => (await invoke(win, 'listStories'))[0].style.genres).toEqual(['mystery', 'thriller'])
    await expect.poll(async () => (await invoke(win, 'getStoryBrief', story.id)).mine.map((e) => e.name)).toEqual(['Ida Marr'])
    // Start from a recipe lives here too (none in the library yet), with the way to the library.
    await expect(area(win).locator('[data-recipe-card]')).toContainText('Start from a recipe')

    // ----- Cast and world: planned, his own first, nothing made yet -----
    await area(win).locator('[data-nav="cast"]').click()
    await expect(area(win).locator('[data-nav="cast"]')).toHaveAttribute('aria-current', 'true')
    await area(win).locator('[data-plan-codex]').click()
    const list = area(win).locator('[data-codex-list]')
    await expect(list.locator('[data-item]').first()).toContainText('Ida Marr')
    await expect(list.locator('[data-item]').first()).toContainText('Yours')
    await expect(list).toContainText('Ada Lorne')
    await expect(list).toContainText('Gull Harbour')
    await expect(list).toContainText('Who wrecks the ships')
    expect(await invoke(win, 'listEntries', 'character')).toEqual([])

    // Talked over beside it (Talk it over knows Cast and world is in view): the change is shown first, only Apply makes it.
    const codexTalk = area(win).locator('[data-talk^="codex:"]')
    await expect(codexTalk.locator('[data-talk-about]')).toContainText('Cast and world')
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

    // Built into the codex in full, live on the page; who the world has shows under it.
    await area(win).locator('[data-build]').click()
    await expect(area(win).locator('[data-build-status]')).toContainText('Built', { timeout: 60_000 })
    const people = (await invoke(win, 'listEntries', 'character')).map((e) => e.name).sort()
    expect(people).toEqual(expect.arrayContaining(['Ada Lorne', 'Bram Holt', 'Corin Vale', 'Ida Marr']))
    expect((await invoke(win, 'listEntries', 'place')).map((e) => e.name)).toContain('Gull Harbour')
    await expect(area(win).locator('[data-in-world]')).toContainText('Ada Lorne')
    await expect(area(win).locator('[data-nav="cast"]')).toContainText(/\d+ people/)
    // The brief is saved a moment after the build ends (patchBrief waits 400 ms for more changes).
    await expect.poll(async () => (await invoke(win, 'getStoryBrief', story.id)).built).not.toBeNull()

    // ----- The story line: planned from the idea and the codex, with a premise written for it -----
    await area(win).locator('[data-build-status]').getByRole('button', { name: 'Next: the story line' }).click()
    await expect(area(win).locator('[data-nav="line"]')).toHaveAttribute('aria-current', 'true')
    const start = area(win).locator('[data-start-card]')
    // The idea is the one from Your idea, quoted, never asked for again.
    await expect(start.locator('[data-idea-status]')).toContainText('A lighthouse keeper’s daughter has one winter')
    await expect(start.getByRole('textbox')).toHaveCount(0)
    await start.locator('[data-plan-it]').click()
    await expect(area(win).locator('[data-batch-head]')).toContainText('to keep, change or discard')
    const sent = fake.lastRequest()!.body.messages
    expect(sent[0].content.startsWith('[AIWRITE-STORY v1] outline')).toBe(true)
    expect(sent[1].content).toContain('Ida Marr')
    expect(sent[1].content).toContain('Genre: Mystery')
    await area(win).locator('[data-premise-card]').getByRole('button', { name: 'Keep as the premise' }).click()
    await expect.poll(async () => (await invoke(win, 'listStories'))[0].premise).toMatch(/^A lighthouse keeper’s daughter must find out/)

    // Before talking it over, one scene kept and one changed by hand: both carry over the talk.
    const group = (kind: string, title: string) => area(win).getByRole('group', { name: `${kind}: ${title}`, exact: true })
    await area(win).getByRole('button', { name: 'Keep “The Wreck”' }).click()
    await expect(group('Scene', 'The Wreck')).toHaveAttribute('data-state', 'kept')
    await area(win).getByRole('button', { name: 'Change “Salvage Rights”' }).click()
    const form = area(win).getByRole('form', { name: 'Edit the scene' })
    await form.getByLabel('What happens', { exact: true }).fill('Bram claims the cargo before dawn.')
    await form.getByRole('button', { name: 'Save changes' }).click()
    await expect(group('Scene', 'Salvage Rights')).toContainText('Changed by you')

    // Talked over: the revised plan is a preview until "Make this change".
    await area(win).locator('[data-nav="line"]').click()
    const planTalk = area(win).locator('[data-talk^="plan:"]')
    await expect(planTalk.locator('[data-talk-about]')).toContainText('The story line')
    await planTalk.getByLabel('What would you like changed?').fill('Make the first chapter a betrayal')
    await planTalk.getByRole('button', { name: 'Send' }).click()
    await expect(planTalk.locator('[data-talk-preview]')).toContainText('The Betrayal')
    await expect(area(win).locator('[data-suggestion="chapter"]').first()).toHaveAttribute('aria-label', 'Chapter: Grey Water')
    await expect(planTalk.locator('[data-talk-preview]')).toContainText('1 part changes')
    await expect(planTalk.locator('[data-apply]')).toHaveText('Make this change')
    await planTalk.locator('[data-apply]').click()
    await expect(area(win).locator('[data-suggestion="chapter"]').first()).toHaveAttribute('aria-label', 'Chapter: The Betrayal')
    // What was kept is still kept, in its place, and Adam's words are still his.
    await expect(group('Chapter', 'The Long Night')).toHaveAttribute('data-state', 'kept')
    await expect(group('Scene', 'The Wreck')).toHaveAttribute('data-state', 'kept')
    await expect(area(win).getByRole('button', { name: 'Keep “The Wreck”' })).toHaveCount(0)
    await expect(group('Scene', 'Salvage Rights')).toContainText('Bram claims the cargo before dawn.')
    await expect(group('Scene', 'Salvage Rights')).toContainText('Changed by you')

    // One scene done again: Use this swaps it in, the rest stay as they were.
    const scene = area(win).locator('[data-suggestion="scene"]', { hasText: 'Salvage Rights' })
    await scene.locator('[data-redo]').first().click()
    await area(win).locator('[data-redo-panel]').getByRole('button', { name: 'Write it again' }).click()
    await area(win).locator('[data-redo-panel]').getByRole('button', { name: 'Use this' }).click()
    await expect(area(win).locator('[data-suggestion="scene"]', { hasText: 'A Different Night' })).toBeVisible()
    await expect(area(win).locator('[data-suggestion="scene"]', { hasText: 'The Dark Lamp' })).toBeVisible()

    // Kept: it is in the story, and the codex was not built again for it.
    await area(win).locator('[data-batch-head]').getByRole('button', { name: 'Keep all' }).click()
    await expect(area(win).locator('[data-batch-head]')).toContainText(/^All decided · \d+ kept/)
    let outline = await invoke(win, 'getOutline', story.id)
    expect(outline.chapters.map((c) => c.title)).toEqual(['The Betrayal', 'The Long Night'])
    expect(outline.scenes.map((s) => s.title)).toContain('A Different Night')
    await expect(area(win)).toHaveAttribute('data-plan-hub', 'planned')
    await expect(area(win).locator('[data-nav="line"]')).toContainText('Ch 1–2 planned')

    // ----- A chapter planned in its row: Plan this chapter, its scene cards kept into it -----
    const night = outline.chapters[1]
    const row = area(win).locator(`[data-chapter="${night.id}"]`)
    await row.locator(`[data-plan-chapter="${night.id}"]`).click()
    const panel = area(win).locator(`[data-chapter-plan="${night.id}"]`)
    await expect(panel.getByRole('heading', { name: 'Ch 2 · The Long Night' })).toBeVisible()
    await panel.locator('[data-suggest-scenes]').click()
    await expect(panel.getByRole('group', { name: /^Scene: / }).first()).toBeVisible({ timeout: 30_000 })
    expect(fake.lastRequest()!.body.messages[0].content.startsWith('[AIWRITE-OUTLINE v1] plan chapter')).toBe(true)
    // Named where they go: after the chapter's own scenes.
    await expect(panel.getByRole('group', { name: /^Scene: / }).first()).toContainText('Ch 2 · Sc 3')
    await panel.getByRole('button', { name: 'Keep all' }).click()
    await expect.poll(async () => (await invoke(win, 'getOutline', story.id)).scenes.filter((s) => s.chapterId === night.id).length).toBe(5)

    // ----- Write this chapter, in the same row: its plan to read first -----
    await panel.locator('[data-write-chapter-row]').getByRole('button', { name: 'Write this chapter' }).click()
    const write = area(win).locator(`[data-write-panel="${night.id}"]`)
    await expect(write.getByTestId('chapter-writer-plan')).toContainText('empty: will be written')
    await write.getByTestId('chapter-writer-start').click()
    const review = write.getByTestId('chapter-plan')
    await expect(review).toBeVisible({ timeout: 60_000 })
    await expect(review).toContainText('Write this chapter · step 1 of 3: the plan')
    await expect(review.getByRole('heading', { name: 'Ch 2 · The Long Night' })).toBeVisible()
    // What the chapter does: whose it is, what they want, what is against them, how it turns.
    await expect(review.locator('[data-three="wants"]')).toContainText(/Ada Lorne wants|What they want/)
    await expect(review.locator('[data-three="wants"]')).toContainText('To get across before dark.')
    await expect(review.locator('[data-three="against"]')).toContainText('The river is up.')
    await expect(review.locator('[data-three="turn"]')).toContainText('The ferry leaves without them.')
    // Scene by scene, each with how it ends; what it keeps true from the memory; about how long and what it costs.
    await expect(review.locator('[data-plan-scene]')).toHaveCount(5)
    await expect(review.locator('[data-plan-scene]').first()).toContainText('Ends with: Sc 1 ends on the far bank.')
    await expect(review).toContainText('Kept true from the memory')
    await expect(review).toContainText('Keep Sc 1 true to the memory.')
    await expect(review.locator('[data-estimate]')).toHaveText(/^About (a minute|\d+ minutes) · cost not known$/)
    // The row says how it is going.
    await expect(area(win).locator(`[data-write-chapter-btn="${night.id}"]`)).toContainText('Writing · 1 of 3: the plan')
    await review.getByTestId('chapter-plan-write').click()
    // While it writes, the row says how it goes (step 2 or 3 of 3), then how it ended, with the report and Undo.
    await expect(write.locator('[data-write-report]')).toContainText('Last time: Written', { timeout: 180_000 })
    await expect(write.locator('[data-write-report]').getByRole('button', { name: 'See the report' })).toBeVisible()
    outline = await invoke(win, 'getOutline', story.id)
    expect(outline.scenes.filter((s) => s.chapterId === night.id).every((s) => s.wordCount > 0)).toBe(true)
    await expect(area(win).locator('[data-nav="line"]')).toContainText('Ch 2 written')
  } finally {
    await fake.close()
  }
})
