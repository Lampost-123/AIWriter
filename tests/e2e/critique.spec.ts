// The scene and chapter critic (contracts/critique.ts), end to end against the fake AI server, whose critique replies
// quote the words in the request (tests/fake-provider/critique.mjs): the Critique tab beside Issues, Critique scene and
// Critique chapter, a report with a summary, what works and notes (one quoting words in no scene, shown without them),
// a note's words shown in the page (opening their scene for a chapter's note), Rewrite this as a tracked change, the
// critique kept so reopening costs no AI call, "The scene changed since this critique" with Critique again, and Stop
// from the palette's "Critique this scene". The critic remembers (2026-10-16): a note acted on is Done, Critique again
// sends the notes before and never brings back one acted on, a note whose words changed says so in place, and Not
// needed / Not for this story are kept, told to the critic, and can be undone or allowed again.
import type { Page } from '@playwright/test'
import { binder, createWorldFromWelcome, expect, invoke, startFake, test, useFakeModel } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const scenePanel = (win: Page) => win.getByRole('complementary', { name: 'Scene panel' })
const critiqueTab = (win: Page) => scenePanel(win).getByRole('tab', { name: 'Critique' })
const panel = (win: Page) => scenePanel(win).getByRole('tabpanel', { name: 'Critique' })
const report = (win: Page) => panel(win).getByRole('region', { name: 'Critique' })
const notes = (win: Page) => report(win).getByRole('article')
const change = (win: Page) => win.getByRole('group', { name: 'The AI’s change' })
const row = (win: Page, title: string) => binder(win).locator('[data-row]', { hasText: title }).first()
const selection = (win: Page) => win.evaluate<string>('String(getSelection() ?? "")')
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')

const FERRY = 'The ferry came in late. Mara stood at the rail and counted the lamps on the shore.\n\nTobin did not look up from the rope.'
const INN = 'The inn was full. Nobody made room for her at the fire.\n\nShe took the stairs two at a time and locked the door.'

/** A chapter of two scenes with words, "The ferry" open in the page. The memory waits long after any change. */
async function setUp(
  win: Page,
  fake: Awaited<ReturnType<typeof startFake>>,
  model = 'fake/writer'
): Promise<{ ferry: string; inn: string; chapterId: string }> {
  await createWorldFromWelcome(win, 'Lowtown')
  await useFakeModel(win, fake, model)
  await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the ferry.' })
  const [story] = await invoke(win, 'listStories')
  const outline = await invoke(win, 'getOutline', story.id)
  const chapterId = outline.chapters[0].id
  const ferry = outline.scenes[0].id
  await invoke(win, 'updateScene', ferry, { title: 'The ferry' })
  const inn = (await invoke(win, 'createScene', chapterId, { title: 'The inn' })).id
  await invoke(win, 'saveSceneText', ferry, null, FERRY)
  await invoke(win, 'saveSceneText', inn, null, INN)
  await win.reload()
  await row(win, 'The ferry').click()
  await expect(prose(win)).toContainText('The ferry came in late.')
  return { ferry, inn, chapterId }
}

test('Critique scene: a report with notes, words shown in the page, Rewrite this as a tracked change, kept for next time, and Critique again once the scene changes', async ({
  launch
}) => {
  const fake = await startFake()
  try {
    const { win } = await launch({ env: { AIWRITE_KEEPER_QUIET_MS: '600000' } })
    const { ferry } = await setUp(win, fake)

    // The tab sits beside Issues, and asks nothing until Adam does.
    const names = await scenePanel(win).getByRole('tab').allTextContents()
    expect(names.findIndex((n) => n.startsWith('Critique'))).toBe(names.findIndex((n) => n.startsWith('Issues')) + 1)
    await critiqueTab(win).click()
    await expect(panel(win).getByText('No critique yet')).toBeVisible()
    expect(await invoke(win, 'getCritique', { scope: 'scene', id: ferry })).toBeNull()

    await panel(win).getByRole('button', { name: 'Critique scene' }).click()
    await expect(report(win)).toContainText('The scene moves well, but its middle slows.', { timeout: 30_000 })
    await expect(report(win).getByRole('list', { name: 'What works' })).toContainText('The opening line sets the mood at once.')
    await expect(notes(win)).toHaveCount(2)
    const first = report(win).getByRole('article', { name: 'Matters most: The middle slows' })
    await expect(first).toContainText('Pacing')
    await expect(first).toContainText('“Mara stood at the rail and counted the lamps on the shore.”')
    await expect(first).toContainText('Cut this back to one line so the scene keeps moving.')
    // The note whose quote is in no scene shows without it, and offers no rewrite.
    const nowhere = report(win).getByRole('article', { name: 'Small thing: A quote from nowhere' })
    await expect(nowhere).not.toContainText('Words that are nowhere')
    await expect(nowhere.getByRole('button', { name: 'Rewrite this' })).toHaveCount(0)
    await expect(panel(win).getByText(/^Critiqued just now · 2 notes$/)).toBeVisible()

    // A click on the words shows them in the page.
    await first.getByRole('button', { name: /Mara stood at the rail/ }).click()
    await expect.poll(() => selection(win)).toBe('Mara stood at the rail and counted the lamps on the shore.')

    // Rewrite this: the AI tools' Rewrite on the sentence, waiting in the page to accept or reject.
    await first.getByRole('button', { name: 'Rewrite this' }).click()
    await expect(change(win)).toBeVisible()
    await expect(prose(win).locator('.aw-sugg-words')).toContainText('In the end, mara stood at the rail', { timeout: 30_000 })
    await change(win)
      .getByRole('button', { name: /^Accept/ })
      .click()
    await expect(prose(win)).toContainText('In the end, mara stood at the rail')
    // The note acted on is marked done, in place, with the words its rewrite put in kept.
    await expect(first.locator('[data-note-state]')).toHaveText('Done')
    await expect(first.getByRole('button', { name: 'Not done yet' })).toBeVisible()
    await expect(first.getByRole('button', { name: 'Rewrite this' })).toHaveCount(0)
    await expect
      .poll(async () => (await invoke(win, 'getCritique', { scope: 'scene', id: ferry }))?.critique.notes[0])
      .toMatchObject({ status: 'done', newWords: expect.stringContaining('In the end, mara stood at the rail') })

    // The scene has changed since: said, with Critique again.
    const changed = panel(win).getByText('The scene changed since this critique.')
    await expect(changed).toBeVisible({ timeout: 15_000 })
    expect((await invoke(win, 'getCritique', { scope: 'scene', id: ferry }))?.changed).toBe(true)

    // Reopening shows the kept critique without asking the AI again.
    const asked = JSON.stringify(fake.requestCounts())
    await win.reload()
    await expect(prose(win)).toContainText('In the end, mara stood at the rail')
    await critiqueTab(win).click()
    await expect(report(win)).toContainText('The scene moves well, but its middle slows.')
    await expect(changed).toBeVisible()
    await expect(first.locator('[data-note-state]')).toHaveText('Done')
    expect(JSON.stringify(fake.requestCounts())).toBe(asked)

    // Critique again builds on the notes before: the critic is told what became of each and says which are settled.
    // The fake gives "The middle slows" again on the rewritten words without saying it still stands: the note Adam acted
    // on is never reversed or raised again, so it is left out. The note from nowhere still stands.
    await panel(win).getByRole('button', { name: 'Critique again' }).first().click()
    await expect(changed).toHaveCount(0, { timeout: 30_000 })
    const sent = (fake.lastRequest()!.body as { messages: { content: string }[] }).messages[1].content
    expect(sent).toContain('## Your notes last time')
    expect(sent).toMatch(/\[P1\] Pacing: “The middle slows”.* — The author acted on it/)
    await expect(notes(win)).toHaveCount(1)
    await expect(report(win).getByRole('article', { name: 'Small thing: A quote from nowhere' })).toContainText('Still stands from last time')
    await expect(report(win)).toContainText('Since last time, 1 note is settled.')
  } finally {
    await fake.close()
  }
})

test('Critique chapter: notes point into the chapter’s scenes and open them; Critique this scene from the palette can be stopped', async ({
  launch
}) => {
  const fake = await startFake({ slowDelayMs: 150 })
  try {
    const { win } = await launch({ env: { AIWRITE_KEEPER_QUIET_MS: '600000' } })
    const { chapterId } = await setUp(win, fake)
    await critiqueTab(win).click()
    await panel(win).getByRole('radio', { name: 'This chapter' }).click()
    await expect(panel(win).getByText('No critique yet')).toBeVisible()
    await panel(win).getByRole('button', { name: 'Critique chapter' }).click()
    await expect(report(win)).toContainText('The chapter builds steadily to its last scene.', { timeout: 30_000 })
    await expect(notes(win)).toHaveCount(3)
    const ending = report(win).getByRole('article', { name: 'Worth a look: The ending could pull harder' })
    await expect(ending).toContainText('Pull to read on')
    await expect(ending).toContainText('· The inn')
    // Its words are in the other scene: a click opens it, with them shown.
    await ending.getByRole('button', { name: /The inn was full/ }).click()
    await expect(row(win, 'The inn')).toHaveAttribute('aria-selected', 'true')
    await expect(prose(win)).toContainText('Nobody made room for her')
    await expect.poll(() => selection(win)).toBe('The inn was full.')
    // The chapter's critique still shows, for the scene now open.
    await expect(report(win)).toContainText('The chapter builds steadily to its last scene.')
    expect((await invoke(win, 'getCritique', { scope: 'chapter', id: chapterId }))?.critique.notes).toHaveLength(3)

    // From the palette, with a slow model: Stop while it reads leaves no critique.
    await useFakeModel(win, fake, 'fake/slow')
    await win.keyboard.press('Control+K')
    await win.keyboard.type('Critique this scene')
    await win
      .getByRole('option', { name: /^Critique this scene/ })
      .first()
      .click()
    await expect(critiqueTab(win)).toHaveAttribute('data-state', 'active')
    await expect(panel(win).getByRole('radio', { name: 'This scene' })).toHaveAttribute('aria-checked', 'true')
    await expect(panel(win).getByText('Reading the scene…')).toBeVisible()
    await panel(win).getByRole('button', { name: 'Stop' }).click()
    await expect(panel(win).getByRole('button', { name: 'Critique scene' })).toBeVisible({ timeout: 15_000 })
    await expect(panel(win).getByText('No critique yet')).toBeVisible()
  } finally {
    await fake.close()
  }
})

test('a note whose words changed says so in place; Not needed (with Undo) and Not for this story are kept and told to the critic, and can be allowed again', async ({
  launch
}) => {
  const fake = await startFake()
  try {
    const { win } = await launch({ env: { AIWRITE_KEEPER_QUIET_MS: '600000' } })
    const { inn, chapterId } = await setUp(win, fake)
    await invoke(win, 'updateChapter', chapterId, { goal: 'Get Mara to the inn before the patrol.' })
    await critiqueTab(win).click()
    await panel(win).getByRole('radio', { name: 'This chapter' }).click()
    await panel(win).getByRole('button', { name: 'Critique chapter' }).click()
    await expect(notes(win)).toHaveCount(3, { timeout: 30_000 })

    // The words of the note about the inn change: it dims and says so, in place, with nothing to rewrite.
    const ending = report(win).getByRole('article', { name: 'Worth a look: The ending could pull harder' })
    const height = (await ending.boundingBox())!.height
    await invoke(win, 'saveSceneText', inn, null, 'All of it is different now.\n\nShe took the stairs two at a time and locked the door.')
    await expect(ending.locator('[data-note-state]')).toHaveText('These words have changed', { timeout: 15_000 })
    await expect(ending).toHaveAttribute('data-state', 'changed')
    await expect(ending.getByRole('button', { name: 'Rewrite this' })).toBeDisabled()
    expect((await ending.boundingBox())!.height).toBe(height)

    // Not needed: set aside here, with Undo.
    const nowhere = report(win).getByRole('article', { name: 'Small thing: A quote from nowhere' })
    await nowhere.getByRole('button', { name: 'Not needed' }).click()
    await expect(nowhere.locator('[data-note-state]')).toHaveText('Not needed')
    const toast = toasts(win).filter({ hasText: 'Set aside. The critic won’t raise it here again.' })
    await toast.getByRole('button', { name: 'Undo' }).click()
    await expect(nowhere.locator('[data-note-state]')).toHaveCount(0)
    await expect(nowhere.getByRole('button', { name: 'Not needed' })).toBeVisible()

    // Not for this story: kept for the whole story, and said under the notes.
    const middle = report(win).getByRole('article', { name: 'Matters most: The middle slows' })
    await middle.getByRole('button', { name: 'Not for this story' }).click()
    await expect(middle.locator('[data-note-state]')).toHaveText('Not for this story')
    await expect(report(win)).toContainText('You told the critic 1 kind of note isn’t for this story.')

    // The scene's own critique is told it, and doesn't raise that kind of note.
    await panel(win).getByRole('radio', { name: 'This scene' }).click()
    await panel(win).getByRole('button', { name: 'Critique scene' }).click()
    await expect(report(win)).toContainText('The scene moves well, but its middle slows.', { timeout: 30_000 })
    const sent = (fake.lastRequest()!.body as { messages: { content: string }[] }).messages[1].content
    expect(sent).toContain('## What the author has said he wants')
    expect(sent).toContain('- Pacing: “The middle slows”')
    expect(sent).toContain("## Facts to respect\nThe chapter's goal: Get Mara to the inn before the patrol.")
    await expect(notes(win)).toHaveCount(1)
    await expect(report(win).getByRole('article', { name: /The middle slows/ })).toHaveCount(0)

    // Allowed again from the list under the notes.
    await report(win).getByRole('button', { name: 'Show' }).click()
    await expect(report(win).getByRole('list', { name: 'Not for this story' })).toContainText('“The middle slows”')
    await report(win).getByRole('button', { name: 'Allow again' }).click()
    await expect(report(win).getByText(/kind of note isn’t for this story/)).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

for (const look of ['classic', 'new'] as const) {
  test(`the Critique tab fits beside the others at the panel’s narrowest, with the Sounds tab too (${look === 'new' ? 'the New look' : 'Classic'})`, async ({
    launch
  }) => {
    const { win } = await launch({ env: { AIWRITE_LOOK: look } })
    await createWorldFromWelcome(win, 'Lowtown')
    await invoke(win, 'updateSettings', { layout: { inspectorWidth: 260 } })
    await win.reload()
    await expect(prose(win)).toBeVisible()
    /** Every tab inside the list, and nothing scrolled out of sight. */
    const fit = () =>
      scenePanel(win)
        .getByRole('tablist')
        .evaluate((list) => {
          const right = list.getBoundingClientRect().right
          const tabs = [...list.querySelectorAll('[role="tab"]')]
          return {
            count: tabs.length,
            over: Math.max(0, Math.ceil(Math.max(...tabs.map((t) => t.getBoundingClientRect().right)) - right - 0.5)),
            scrolls: list.scrollWidth > list.clientWidth + 1
          }
        })
    await expect.poll(fit).toEqual({ count: 6, over: 0, scrolls: false })
    await expect(critiqueTab(win)).toBeVisible()
    await invoke(win, 'updateSettings', { speech: { readAloud: true, soundEffects: true } })
    await win.reload()
    await expect(prose(win)).toBeVisible()
    await expect.poll(fit).toEqual({ count: 7, over: 0, scrolls: false })
  })
}

test('the desk: the Critique tab in the scene drawer, its report in the Issues tab’s cards', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch({ env: { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk', AIWRITE_KEEPER_QUIET_MS: '600000' } })
    await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
    await invoke(win, 'openSampleWorld')
    await useFakeModel(win, fake)
    const drawer = win.locator('aside.desk-drawer')
    await win
      .locator('[data-desk-topbar]')
      .getByRole('button', { name: /^Scene details/ })
      .click()
    await drawer.getByRole('tab', { name: 'Critique' }).click()
    await drawer.getByRole('button', { name: 'Critique scene' }).click()
    const cards = drawer.getByRole('region', { name: 'Critique' }).getByRole('article')
    await expect(cards).toHaveCount(2, { timeout: 30_000 })
    await expect(cards.first()).toHaveAttribute('data-weight', 'high')
    await expect(cards.first().locator('.ck-sev')).toHaveText('Matters most')
    await expect(cards.first().getByRole('button', { name: 'Rewrite this' })).toBeVisible()
  } finally {
    await fake.close()
  }
})
