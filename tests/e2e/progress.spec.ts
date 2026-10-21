// The top bar's writing progress (features/progress, Adam, 2026-10-20: "when the AI is writing a chapter or a scene
// there is no way to see its progress other than this"), end to end against the fake AI server in the New look: while
// Generate drafts a scene, and while Write this chapter writes one, the top bar's pill says where it has got (the title
// may be cut short, the numbers never are) with a thin bar, its hover names the model, and a click opens the progress
// card: the steps with the current one marked and the model each uses, each scene with its words (a chapter), what it is
// doing right now and with which model, the bar, the time so far, Go to the scene and Stop. A card left open when the
// AI stops says what happened and what was kept. Pictures go to PROGRESS_SHOTS when it is set (a folder).
import type { Locator, Page } from '@playwright/test'
import { join } from 'node:path'
import { areaButton, binder, createWorldFromWelcome, expect, invoke, startFake, test } from './helpers'
import type { FakeProvider } from '../fake-provider/server.mjs'

const NEW_LOOK = { AIWRITE_KEEPER_QUIET_MS: '600000', AIWRITE_LOOK: 'new' }
const prose = (win: Page) => win.locator('.scene-prose')
const row = (win: Page, title: string) => binder(win).locator('[data-row]', { hasText: title }).first()
const topBar = (win: Page) => win.locator('header').first()

async function shot(target: Page | Locator, name: string): Promise<void> {
  const dir = process.env.PROGRESS_SHOTS
  if (!dir) return
  await (target as Page).waitForTimeout?.(300)
  await target.screenshot({ path: join(dir, `${name}.png`) })
}

/** The fake as every model, each with a name of its own, so each step's model shows. `writer`: the writer's fake. */
async function models(win: Page, fake: FakeProvider, writer: string): Promise<void> {
  const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
  const m = (modelId: string, label: string) => ({ providerId: p.id, modelId, label, contextLength: 32000, promptPrice: 0.000002, completionPrice: 0.000008 })
  await invoke(win, 'updateSettings', {
    models: {
      writer: m(writer, 'Fake: Story Writer 2'),
      memory: m('fake/writer', 'Fake: Memory Mini'),
      check: m('fake/writer', 'Fake: Checker Pro'),
      chapter: m('fake/writer', 'Fake: Planner Max')
    },
    chapterCritic: false
  })
  await win.reload()
  await expect(prose(win)).toBeVisible()
}

test('Generate: the top bar says how the draft is going, and its card has the steps, the model, the words and Stop', async ({ launch }) => {
  test.setTimeout(120_000)
  const fake = await startFake({ delayMs: 5, slowDelayMs: 45 })
  try {
    const { win } = await launch({ env: NEW_LOOK })
    await createWorldFromWelcome(win, 'Lowtown')
    await models(win, fake, 'fake/slow')
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    await invoke(win, 'updateScene', sceneId, { title: 'Morning Confrontation at the Old Ferry Landing' })
    const card = (await invoke(win, 'getScene', sceneId)).card
    await invoke(win, 'updateSceneCard', sceneId, { ...card, goal: 'Mara faces Tobin at the landing.', targetWords: 1500, lengthSet: true })
    await win.reload()
    await row(win, 'Morning Confrontation').click()
    await expect(prose(win)).toBeVisible()

    await win.locator('main header').getByRole('button', { name: 'Draft the scene', exact: true }).click()
    const status = topBar(win).getByTestId('draft-status')
    const pill = status.getByRole('button', { name: /Writing/ })
    await expect(prose(win)).toContainText('The rain', { timeout: 60_000 })
    // The pill: the title (cut short if it must), then the words against the length it aims for, never cut.
    await expect(pill).toContainText('Writing “Morning Confrontation at the Old Ferry Landing”')
    await expect(pill).toContainText(/\d+ of ~1,500 words/)
    await expect(pill).toHaveAttribute('title', /“Morning Confrontation at the Old Ferry Landing”: .*Model: Story Writer 2\./)
    const tail = pill.locator('.wp-tail')
    expect(await tail.evaluate((t) => t.scrollWidth - t.clientWidth)).toBeLessThanOrEqual(0)
    await expect(pill.locator('.wp-pill-bar')).toBeVisible()
    await shot(status, 'scene-pill')

    // The card: the steps (the plan is on), the current one marked, each step's model, what it is doing and with what.
    await pill.click()
    const c = win.locator('[data-progress-card="scene"]')
    await expect(c).toBeVisible()
    await expect(c.getByRole('heading', { name: '“Morning Confrontation at the Old Ferry Landing”' })).toBeVisible()
    const steps = c.getByRole('list', { name: 'Steps' }).getByRole('listitem')
    await expect(steps).toHaveText([/The memory\s*Memory Mini/, /The plan\s*Memory Mini/, /Writing\s*Story Writer 2/, /Checking\s*Memory Mini/])
    await expect(steps.nth(2)).toHaveAttribute('aria-current', 'step')
    await expect(c.locator('[data-progress-now]')).toContainText('Writing the scene')
    await expect(c.locator('[data-progress-model]')).toHaveText('Model: Story Writer 2')
    await expect(c.getByRole('progressbar')).toHaveAttribute('aria-label', /\d+ of about 1,500 words/)
    await expect(c.locator('[data-progress-time]')).toContainText(/s so far/, { timeout: 10_000 })
    await expect(c.locator('[data-progress-time]')).toContainText(/left/, { timeout: 20_000 })
    await shot(win, 'scene-card-window')
    await shot(c, 'scene-card')

    // Stop: the card says what happened and what was kept.
    await c.getByTestId('draft-stop').click()
    await expect(c.locator('[data-progress-ended="stopped"]')).toHaveText(/^Stopped\. The [\d,]+ words written so far stay in the scene\.$/, { timeout: 15_000 })
    await shot(c, 'scene-card-stopped')
    await win.keyboard.press('Escape')
    await expect(status).toBeHidden()
  } finally {
    await fake.close()
  }
})

test('Write this chapter: the top bar says the scene and the words, and its card lists each scene, the step, the model, Go to the scene and Stop', async ({
  launch
}) => {
  test.setTimeout(180_000)
  const fake = await startFake({ delayMs: 20, slowDelayMs: 40 })
  try {
    const { win } = await launch({ env: NEW_LOOK })
    await createWorldFromWelcome(win, 'Lowtown')
    await models(win, fake, 'fake/slow')
    await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the ferry.' })
    const [story] = await invoke(win, 'listStories')
    const outline = await invoke(win, 'getOutline', story.id)
    const chapterId = outline.chapters[0].id
    const ferry = outline.scenes[0].id
    await invoke(win, 'updateScene', ferry, { title: 'The ferry' })
    const inn = (await invoke(win, 'createScene', chapterId, { title: 'The inn' })).id
    const card = (await invoke(win, 'getScene', ferry)).card
    await invoke(win, 'updateSceneCard', ferry, { ...card, goal: 'Mara meets Tobin at the ferry.', targetWords: 1500, lengthSet: true })
    await invoke(win, 'updateSceneCard', inn, { ...card, beats: ['Mara finds no room at the inn.'], targetWords: 1200, lengthSet: true })
    await invoke(win, 'createChapter', story.id, { title: 'The Road North' })
    await win.reload()
    await row(win, 'The ferry').click()
    await expect(prose(win)).toBeVisible()

    await win.keyboard.press('Control+K')
    await win.keyboard.type('Whole chapter')
    await win.getByRole('option', { name: /^Whole chapter with AI/ }).first().click()
    await win.locator('[data-plan-hub] [data-write-stage="start"]').getByTestId('chapter-writer-start').click()
    const status = topBar(win).getByTestId('chapter-writer-status')
    const plan = win.locator('[data-plan-hub] [data-write-stage="review"]')
    await expect(plan).toBeVisible({ timeout: 60_000 })
    await expect(status).toContainText('The chapter plan is ready for you')
    await plan.getByTestId('chapter-plan-write').click()
    await areaButton(win, 'Write').click()

    // Writing Sc 1: the pill names the chapter, the scene of how many and the words so far.
    const pill = status.getByRole('button', { name: /Writing/ })
    await expect(pill).toContainText(/Writing Ch 1/, { timeout: 60_000 })
    await expect(pill).toContainText(/scene 1 of 2 · [\d,]+ words?/, { timeout: 60_000 })
    await expect(pill).toHaveAttribute('title', /Model: Story Writer 2\./)
    await shot(status, 'chapter-pill')

    await pill.click()
    const c = win.locator('[data-progress-card="chapter"]')
    await expect(c).toBeVisible()
    const steps = c.getByRole('list', { name: 'Steps' }).getByRole('listitem')
    await expect(steps).toHaveText([/The plan\s*Planner Max/, /Writing\s*Story Writer 2/, /Checking and fixing\s*Checker Pro/])
    await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step')
    const scenes = c.getByRole('list', { name: 'Scenes' }).getByRole('listitem')
    await expect(scenes).toHaveCount(2)
    await expect(scenes.nth(0)).toHaveAttribute('data-progress-scene', 'writing')
    await expect(scenes.nth(0)).toContainText(/Sc 1 “The ferry”\s*[\d,]+ of about 1,500 words/)
    await expect(scenes.nth(1)).toContainText('waiting')
    await expect(c.locator('[data-progress-now]')).toContainText('Writing Sc 1 “The ferry” (scene 1 of 2)')
    await expect(c.locator('[data-progress-model]')).toHaveText('Model: Story Writer 2')
    await expect(c.getByRole('progressbar')).toHaveAttribute('aria-label', /words · 0 of 2 scenes written/)
    await expect(c.locator('[data-progress-time]')).toContainText(/so far/)
    await expect(c.getByRole('button', { name: 'See the plan' })).toBeVisible()
    await shot(win, 'chapter-card-window')
    await shot(c, 'chapter-card')

    // Go to the scene: the scene being written opens.
    await c.getByRole('button', { name: 'Go to the scene' }).click()
    await expect(c).toBeHidden()
    await expect(win.locator('main h1')).toContainText('The ferry')

    // Stop from the card: it says what happened and what was kept.
    await pill.click()
    await c.getByTestId('chapter-writer-stop').click()
    await expect(c.locator('[data-progress-ended="stopped"]')).toContainText('The words written so far are kept', { timeout: 30_000 })
    await expect(c.getByRole('button', { name: 'See the report' })).toBeVisible()
    // The scene it was still drafting was never saved: it says so.
    await expect(c.locator('[data-progress-scene="unfinished"]')).toContainText('not finished')
    await shot(c, 'chapter-card-stopped')
    await win.keyboard.press('Escape')
    await expect(status).toBeHidden()
    expect((await invoke(win, 'getChapterWriterReport', chapterId))?.status).toBe('stopped')
  } finally {
    await fake.close()
  }
})
