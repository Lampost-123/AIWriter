// Build with AI mid-story, and every older way in (Adam, 2026-10-20: "a unified area to build all parts of the story
// using AI"), on the sample world against the fake provider (tests/fake-provider/m4/outline.mjs: a chapter's interview
// and plan, a scene's ideas and its card planned; story.mjs: the talk). Invented text only.
//
//  1. Mid-story, on the desk (Dark): each section says how it stands; a chapter's Plan it opens its own page (zoomed in)
//     at its plan, with its interview, and its scene cards keep into it; a planned scene's Ideas (Use this fills its card)
//     and Fill the card work in its row there; Threads' Plan its payoff puts the thread in the story line's box and ticks
//     it; Write it opens the scene and starts its draft.
//  2. Every older way in, in the panels (Light): the story menu, the palette's "Your idea, cast and world", the Plan
//     area's Next scene ideas and Interview me (the scene's page), the binder's "Interview me about this chapter" and
//     "Write this chapter with AI…" (the chapter's page), the World area's Build from a summary, the trail's chapter, and
//     the top bar's "The chapter plan is ready".
import type { ElectronApplication, Page } from '@playwright/test'
import { areaButton, areaRow, binder, expect, invoke, test, type LaunchOptions } from './helpers'
import type { FakeProvider } from '../fake-provider/server.mjs'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk', AIWRITE_KEEPER_QUIET_MS: '600000', AIWRITE_THEME: 'dark' }
const PANELS = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'panels', AIWRITE_KEEPER_QUIET_MS: '600000', AIWRITE_THEME: 'light' }
const area = (win: Page) => win.locator('[data-plan-hub]')
const toastWith = (win: Page, text: string | RegExp) => win.locator('div.fixed[aria-live="polite"] > div', { hasText: text })

async function fakeServer(): Promise<FakeProvider> {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  return startFakeProvider({ delayMs: 2 })
}

/** The sample world with the fake as its model, and Ch 3 "The Bell Tower" planned past where it is written. */
async function sample(
  launch: (o?: LaunchOptions) => Promise<{ app: ElectronApplication; win: Page }>,
  fake: FakeProvider,
  env: Record<string, string>
): Promise<{ app: ElectronApplication; win: Page; storyId: string; ch3: string; hung: string; unlit: string }> {
  const a = await launch({ env })
  await expect(a.win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(a.win, 'openSampleWorld')
  const p = await invoke(a.win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
  await invoke(a.win, 'updateSettings', {
    models: { writer: { providerId: p.id, modelId: 'fake/writer', label: 'fake/writer', contextLength: 32000, promptPrice: null, completionPrice: null } }
  })
  const [story] = await invoke(a.win, 'listStories')
  const ch3 = await invoke(a.win, 'createChapter', story.id, { title: 'The Bell Tower' })
  const [first] = (await invoke(a.win, 'getOutline', story.id)).scenes.filter((s) => s.chapterId === ch3.id)
  const hung = first?.id ?? (await invoke(a.win, 'createScene', ch3.id, { title: 'The bell is hung' })).id
  await invoke(a.win, 'updateScene', hung, { title: 'The bell is hung' })
  const card = (await invoke(a.win, 'getScene', hung)).card
  await invoke(a.win, 'updateSceneCard', hung, { ...card, goal: 'The Board’s men hang the bell buoy off Bell Rock.', beats: ['The boat comes out at dawn'] })
  // A planned scene with nothing on its card yet.
  const unlit = (await invoke(a.win, 'createScene', ch3.id, { title: 'Scene 2' })).id
  await a.app.evaluate(({ BrowserWindow }) => {
    const b = BrowserWindow.getAllWindows()[0]
    b.unmaximize()
    b.setContentSize(1600, 960)
  })
  await a.win.reload()
  await expect(a.win.locator('.scene-prose')).toBeVisible()
  return { ...a, storyId: story.id, ch3: ch3.id, hung, unlit }
}

const lastAsked = (fake: FakeProvider): { system: string; user: string } => {
  const m = fake.lastRequest()!.body.messages as { role: string; content: string }[]
  return { system: m[0].content, user: m.filter((x) => x.role === 'user').map((x) => x.content).join('\n') }
}

test('mid-story on the desk: how each part stands, a chapter planned on its page, a scene’s ideas and card, a thread’s payoff, Write it', async ({ launch }) => {
  test.setTimeout(180_000)
  const fake = await fakeServer()
  try {
    const { win, storyId, ch3, hung, unlit } = await sample(launch, fake, DESK)
    await win.getByRole('navigation', { name: 'Rooms' }).getByRole('button', { name: /^Plan/ }).click()
    const links = win.locator('[data-desk-room]').getByRole('navigation', { name: 'Plan' })
    await expect(links.getByRole('button').first()).toHaveText(/Build with AI/)
    await links.getByRole('button', { name: 'Build with AI' }).click()
    await expect(area(win)).toHaveAttribute('data-plan-hub', 'writing')
    // A story under way opens at the story line's What happens next?
    await expect(area(win).locator('[data-nav="line"]')).toHaveAttribute('aria-selected', 'true')
    await expect(area(win).locator('[data-next-card]').getByRole('heading', { name: 'What happens next?' })).toBeInViewport()

    // ----- How each part stands -----
    await expect(area(win).locator('[data-nav="idea"]')).toContainText('written')
    await expect(area(win).locator('[data-nav="cast"]')).toContainText('4 people, 3 places')
    await expect(area(win).locator('[data-nav="line"]')).toContainText('Ch 1–2 written, Ch 3 planned')
    await expect(area(win).locator('[data-nav="threads"]')).toContainText('1 open')
    await expect(area(win).locator('[data-section-status="line"]')).toHaveText('Ch 1–2 written, Ch 3 planned')
    // The planned chapter in plain sight: no row around it to open first.
    await expect(area(win).locator('[data-row="planned"]')).toHaveCount(0)
    await expect(area(win).locator(`[data-planned-chapters] [data-chapter="${ch3}"]`)).toBeVisible()

    // ----- Nothing locked behind another section: How it all connects opens on the people and places the world has -----
    await area(win).locator('[data-nav="cast"]').click()
    await expect(area(win).locator('[data-topic="connections"]')).toBeEnabled()
    await area(win).locator('[data-nav="line"]').click()

    // ----- Plan it, on the chapter's own page: the interview, then scene cards kept into the chapter -----
    const line = area(win).locator('[data-story-line]')
    await line.locator(`[data-step-for="${ch3}"]`).click()
    const row = area(win).locator(`[data-chapter-page="${ch3}"]`)
    const panel = row.locator(`[data-chapter-plan="${ch3}"]`)
    await expect(row.getByRole('heading', { name: 'Ch 3 · The Bell Tower' })).toBeVisible()
    await panel.locator('[data-interview-chapter]').click()
    const interview = panel.getByRole('region', { name: 'Interview' })
    await expect(interview.getByText('What happens in this chapter?')).toBeVisible()
    expect(lastAsked(fake).system.startsWith('[AIWRITE-OUTLINE v1] interview chapter')).toBe(true)
    await interview.getByRole('textbox', { name: 'Your answer' }).fill('The bell rings with no one at the rope')
    await interview.getByRole('textbox', { name: 'Your answer' }).press('Enter')
    await expect(interview.getByText('How does the chapter end?')).toBeVisible()
    await interview.getByRole('button', { name: 'Done' }).click()
    await expect(panel.getByRole('group', { name: /^Scene: / }).first()).toBeVisible({ timeout: 30_000 })
    expect(lastAsked(fake).system.startsWith('[AIWRITE-OUTLINE v1] plan chapter')).toBe(true)
    // The goal it gave the chapter shows in its box; the cards are named where they go.
    await expect(row.getByLabel('What the chapter achieves')).toHaveValue(/The bell rings with no one at the rope/)
    await expect(panel.getByRole('group', { name: /^Scene: / }).first()).toContainText('Ch 3 · Sc 3')
    const first = panel.getByRole('group', { name: /^Scene: / }).first()
    const title = (await first.getAttribute('aria-label'))!.replace(/^Scene: /, '')
    await first.getByRole('button', { name: `Keep “${title}”` }).click()
    await expect.poll(async () => (await invoke(win, 'getOutline', storyId)).scenes.filter((s) => s.chapterId === ch3).map((s) => s.title)).toContain(title)

    // ----- A planned scene's Ideas, in its row on the chapter's page (its ⋯): Use this fills its card -----
    const empty = row.locator(`[data-scene-row="${unlit}"]`)
    await empty.locator('[data-scene-more]').click()
    await win.getByRole('menuitem', { name: 'Ideas' }).click()
    const ideas = empty.locator(`[data-scene-ideas="${unlit}"]`)
    await ideas.getByLabel('What you have in mind, roughly (optional)').fill('the keeper hides from the Board')
    await ideas.locator('[data-ask-ideas]').click()
    await expect(ideas.locator('[data-idea]')).toHaveCount(3, { timeout: 30_000 })
    expect(lastAsked(fake).user).toContain('the keeper hides from the Board')
    await ideas.locator('[data-idea]').first().getByRole('button', { name: /^Use “/ }).click()
    await expect.poll(async () => (await invoke(win, 'getScene', unlit)).card.goal).not.toBe('')
    await expect(ideas).toContainText('One went on the scene’s card')

    // ----- Fill the card, in its row: only its empty parts -----
    await row.locator(`[data-scene-row="${hung}"]`).locator('[data-scene-more]').click()
    await win.getByRole('menuitem', { name: 'Fill the card' }).click()
    await expect(toastWith(win, /^Planned|already had everything/)).toBeVisible({ timeout: 30_000 })
    expect(lastAsked(fake).system).toContain('[AIWRITE-OUTLINE v1] stage scene')
    expect((await invoke(win, 'getScene', hung)).card.goal).toBe('The Board’s men hang the bell buoy off Bell Rock.')

    // ----- The tabs stay on a chapter's page: Story line goes back to the whole story, the chapter's row in view -----
    await expect(area(win).locator('[data-nav="line"]')).toHaveAttribute('aria-selected', 'true')
    await area(win).locator('[data-nav="line"]').click()
    await expect(area(win).locator(`[data-chapter-page="${ch3}"]`)).toHaveCount(0)
    await expect(area(win).locator(`[data-chapter="${ch3}"]`).first()).toBeInViewport()

    // ----- Threads: Plan its payoff puts the thread in the story line's box, ticked -----
    await area(win).locator('[data-nav="threads"]').click()
    const thread = area(win).locator('[data-thread-row="Will the light go dark at midwinter?"]')
    await expect(thread).toBeVisible()
    await thread.getByRole('button', { name: 'Plan its payoff' }).click()
    const next = area(win).locator('[data-next-card]')
    await expect(next.getByLabel('Tell it in your own words, or leave it to the AI')).toHaveValue(
      'Move toward paying off the plot thread “Will the light go dark at midwinter?” (Can Wren save the Gullhaven Light before midwinter).'
    )
    await expect(next.getByRole('group', { name: 'Threads waiting' }).getByRole('button', { name: /Will the light go dark at midwinter/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(area(win).locator('[data-nav="line"]')).toHaveAttribute('aria-selected', 'true')

    // ----- Write it: the scene on the writing page, its draft started the usual way -----
    await line.locator(`[data-chapter-zoom="${ch3}"]`).click()
    await row.locator(`[data-scene-row="${hung}"]`).locator('[data-scene-step="write"]').click()
    await expect(win.locator('.scene-prose')).toBeVisible()
    await expect.poll(async () => (await invoke(win, 'getScene', hung)).text.length, { timeout: 30_000 }).toBeGreaterThan(0)
  } finally {
    await fake.close()
  }
})

test('every older way in lands in its section of Build with AI (the panels)', async ({ launch }) => {
  test.setTimeout(180_000)
  const fake = await fakeServer()
  try {
    const { win, storyId, ch3, unlit } = await sample(launch, fake, PANELS)
    const inView = (s: string) => expect(area(win).locator(`[data-nav="${s}"]`)).toHaveAttribute('aria-selected', 'true')

    // The story menu: the area, at the story line (the story is under way).
    await binder(win).locator('[data-story-menu]').click()
    await win.getByRole('menuitem', { name: 'Build with AI' }).click()
    await inView('line')
    await expect(area(win).getByRole('heading', { level: 1 })).toHaveText('Build “The Keeper’s Light” with AI')

    // The palette's "Your idea, cast and world" (the Story builder before): Your idea.
    await win.keyboard.press('Control+K')
    await win.keyboard.type('Your idea, cast')
    await win.getByRole('dialog', { name: 'Search' }).getByRole('option', { name: 'Your idea, cast and world' }).click()
    await inView('idea')
    await expect(area(win).locator('[data-build-section="idea"]').getByLabel(/^Your idea, in your own words/)).toBeInViewport()

    // The World area's Build from a summary, with a story open: Cast and world, from a summary.
    await areaButton(win, 'World').click()
    await areaRow(win, 'Build from a summary').click()
    await inView('cast')
    await expect(area(win).locator('[data-cast-way-summary]')).toHaveAttribute('aria-pressed', 'true')
    await expect(area(win).locator('[data-summary-builder]').getByLabel('Your summary')).toBeVisible()

    // The Plan area's Next scene ideas with a written scene open: the story line at the next scene.
    await areaButton(win, 'Plan').click()
    await areaRow(win, 'Next scene ideas').click()
    await inView('line')
    await expect(area(win).locator('[data-next-card] [data-scope="next-scene"]')).toHaveAttribute('aria-pressed', 'true')

    // Interview me with a planned scene open: that scene's page, its interview open.
    await win.evaluate(() => undefined)
    await invoke(win, 'updateSettings', { lastSceneId: unlit })
    await win.reload()
    await expect(win.locator('.scene-prose')).toBeVisible()
    await areaButton(win, 'Plan').click()
    await areaRow(win, 'Interview me').click()
    const scene = area(win).locator(`[data-scene-page="${unlit}"]`)
    await expect(scene.getByRole('region', { name: 'Interview' })).toBeVisible()
    await expect(scene.getByRole('region', { name: 'Interview' }).getByText('Who walks in first?')).toBeVisible()

    // The binder's "Interview me about this chapter": its page, at its plan, the first question there.
    await areaButton(win, 'Write').click()
    await binder(win).locator('[data-row="chapter"]', { hasText: 'The Bell Tower' }).click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Interview me about this chapter' }).click()
    const plan = area(win).locator(`[data-chapter-plan="${ch3}"]`)
    await expect(plan.getByRole('region', { name: 'Interview' }).getByText('What happens in this chapter?')).toBeVisible()
    await expect(area(win)).toHaveAttribute('data-zoomed', 'chapter')

    // The binder's "Write this chapter with AI…": its page, Write this chapter open at its start.
    await areaButton(win, 'Write').click()
    await binder(win).locator('[data-row="chapter"]', { hasText: 'The Bell Tower' }).click({ button: 'right' })
    await win.getByRole('menuitem', { name: /^Write this chapter with AI/ }).click()
    const write = area(win).locator(`[data-write-panel="${ch3}"]`)
    await expect(write.getByTestId('chapter-writer-plan')).toContainText('The bell is hung')
    // Started, then left: the top bar's "The chapter plan is ready for you" comes back to it, the plan to read.
    await write.getByTestId('chapter-writer-start').click()
    await expect(write.getByTestId('chapter-plan')).toBeVisible({ timeout: 60_000 })
    await areaButton(win, 'Write').click()
    await win.getByTestId('chapter-writer-status').getByRole('button', { name: /ready for you/ }).click()
    await expect(area(win).locator(`[data-write-panel="${ch3}"]`).getByTestId('chapter-plan')).toBeVisible()
    await area(win).getByTestId('chapter-plan-cancel').click()
    await expect(win.getByText('Cancelled before writing: nothing in the chapter changed.')).toBeVisible({ timeout: 30_000 })

    // The trail's chapter (where a chapter's plan was): its page, at its plan.
    await areaButton(win, 'Write').click()
    await binder(win).locator('[data-row="scene"]', { hasText: 'The bell is hung' }).click()
    await win.getByRole('navigation', { name: 'Where you are' }).getByRole('button', { name: 'The Bell Tower' }).click()
    await expect(area(win).locator(`[data-chapter-plan="${ch3}"]`)).toBeVisible()
    expect(storyId).toBeTruthy()
  } finally {
    await fake.close()
  }
})
