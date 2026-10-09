// The scene and chapter critic (contracts/critique.ts), end to end against the fake AI server, whose critique replies
// quote the words in the request (tests/fake-provider/critique.mjs): the Critique tab beside Issues, Critique scene and
// Critique chapter, a report with a summary, what works and notes (one quoting words in no scene, shown without them),
// a note's words shown in the page (opening their scene for a chapter's note), Rewrite this as a tracked change, the
// critique kept so reopening costs no AI call, "The scene changed since this critique" with Critique again, and Stop
// from the palette's "Critique this scene".
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
    expect(JSON.stringify(fake.requestCounts())).toBe(asked)

    await panel(win).getByRole('button', { name: 'Critique again' }).first().click()
    await expect(changed).toHaveCount(0, { timeout: 30_000 })
    await expect(report(win).getByRole('article', { name: 'Matters most: The middle slows' })).toContainText(
      'In the end, mara stood at the rail'
    )
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
