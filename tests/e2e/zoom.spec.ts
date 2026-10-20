// Build with AI zooms in (Adam's choice, "Option A: Zoom in", 2026-10-20): the whole story's line is quiet (each chapter
// its name and one next step, each scene its name), and a chapter or a scene opens as its own page in the area, with a
// trail back out. On the sample world against the fake provider (tests/fake-provider/m4/outline.mjs: a chapter's scenes,
// a scene's card planned, its ideas). Invented text only.
//
//  1. The desk (Dark): the story line has no scene tools; Ch 3's one next step is Plan it (a card says nothing yet).
//     Its name opens its page: the trail, how it stands, Write this chapter, its goal, how many scenes and how long, its
//     scenes each with one action and the rest in ⋯ (Ideas opens in the row). Fill the card on the empty one. Add scenes
//     arrives on the page, What the AI saw comes back to the page. A scene's name opens its page: its card in short,
//     Ideas, Interview me, Fill the card, Write it. The trail goes back to the chapter, then to the whole story.
//  2. The panels (Light): the binder's "Build this chapter with AI" and "Build this scene with AI", the chapter card's
//     and the scene card's links, the palette's entries, and an older way in (Write this chapter with AI…) all land on
//     the page, with what they asked for open.
// Pictures go to ZOOM_SHOTS when it is set (a folder), for Adam to look at.
import type { ElectronApplication, Page } from '@playwright/test'
import { join } from 'node:path'
import { areaButton, binder, expect, invoke, test, type LaunchOptions } from './helpers'
import type { FakeProvider } from '../fake-provider/server.mjs'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk', AIWRITE_KEEPER_QUIET_MS: '600000', AIWRITE_THEME: 'dark' }
const PANELS = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'panels', AIWRITE_KEEPER_QUIET_MS: '600000', AIWRITE_THEME: 'light' }
const area = (win: Page) => win.locator('[data-plan-hub]')
const line = (win: Page) => area(win).locator('[data-story-line]')
const trail = (win: Page) => area(win).getByRole('navigation', { name: 'Trail' })
const toastWith = (win: Page, text: string | RegExp) => win.locator('div.fixed[aria-live="polite"] > div', { hasText: text })

async function shot(win: Page, name: string): Promise<void> {
  const dir = process.env.ZOOM_SHOTS
  if (!dir) return
  await win.waitForTimeout(450)
  await win.screenshot({ path: join(dir, `${name}.png`) })
}

async function fakeServer(): Promise<FakeProvider> {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  return startFakeProvider({ delayMs: 2 })
}

/** The sample world with the fake as its model, and Ch 3 "The Bell Tower" planned: one scene with a card, one without. */
async function sample(
  launch: (o?: LaunchOptions) => Promise<{ app: ElectronApplication; win: Page }>,
  fake: FakeProvider,
  env: Record<string, string>,
  w = 1600,
  h = 960
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
  await invoke(a.win, 'updateChapter', ch3.id, { goal: 'The bell buoy is hung, and the light is found dark.' })
  const [first] = (await invoke(a.win, 'getOutline', story.id)).scenes.filter((s) => s.chapterId === ch3.id)
  const hung = first?.id ?? (await invoke(a.win, 'createScene', ch3.id, { title: 'The bell is hung' })).id
  await invoke(a.win, 'updateScene', hung, { title: 'The bell is hung' })
  const card = (await invoke(a.win, 'getScene', hung)).card
  await invoke(a.win, 'updateSceneCard', hung, {
    ...card,
    when: 'Day 9, dawn',
    goal: 'The Board’s men hang the bell buoy off Bell Rock.',
    beats: ['The boat comes out at dawn', 'The chain jams and Wren frees it']
  })
  const unlit = (await invoke(a.win, 'createScene', ch3.id, { title: 'Scene 2' })).id
  await a.app.evaluate(
    ({ BrowserWindow }, [cw, ch]) => {
      const b = BrowserWindow.getAllWindows()[0]
      b.unmaximize()
      b.setContentSize(cw, ch)
    },
    [w, h]
  )
  await a.win.reload()
  await expect(a.win.locator('.scene-prose')).toBeVisible()
  return { ...a, storyId: story.id, ch3: ch3.id, hung, unlit }
}

test('zooming in from the story line: a chapter’s page and a scene’s page, and back out (the desk)', async ({ launch }) => {
  test.setTimeout(180_000)
  const fake = await fakeServer()
  try {
    const { win, storyId, ch3, hung, unlit } = await sample(launch, fake, DESK)
    await win.getByRole('navigation', { name: 'Rooms' }).getByRole('button', { name: /^Plan/ }).click()
    await win.locator('[data-desk-room]').getByRole('navigation', { name: 'Plan' }).getByRole('button', { name: 'Build with AI' }).click()
    await expect(area(win)).toHaveAttribute('data-plan-hub', 'writing')

    // ----- The whole story, quiet: no scene tools; each chapter one next step -----
    await line(win).locator('[data-row="planned"]').getByRole('button', { name: 'Pick up from here' }).click()
    const row = line(win).locator(`[data-chapter="${ch3}"]`)
    await expect(row.locator(`[data-step-for="${ch3}"]`)).toHaveText('Plan it')
    await row.getByRole('button', { name: /Show the scenes of Ch 3/ }).click()
    await expect(line(win).locator(`[data-scene-row="${unlit}"]`)).toBeVisible()
    await expect(line(win).locator('[data-scene-tool], [data-plan-chapter], [data-add-scenes], [data-fill-cards], [data-write-panel]')).toHaveCount(0)
    await shot(win, 'desk-overview')

    // ----- Its name opens its page -----
    await row.locator(`[data-chapter-zoom="${ch3}"]`).click()
    const page = area(win).locator(`[data-chapter-page="${ch3}"]`)
    await expect(page).toBeVisible()
    await expect(area(win)).toHaveAttribute('data-zoomed', 'chapter')
    await expect(trail(win)).toHaveText(/Whole story\s*Ch 3 · The Bell Tower/)
    await expect(page.getByRole('heading', { name: 'Ch 3 · The Bell Tower' })).toBeVisible()
    await expect(page.locator('[data-chapter-meta]')).toHaveText('Planned · 2 scenes')
    await expect(page.locator(`[data-write-chapter-btn="${ch3}"]`)).toHaveText('Write this chapter')
    await expect(page.getByLabel('What the chapter achieves')).toHaveValue('The bell buoy is hung, and the light is found dark.')
    await expect(page.locator('[data-chapter-size]').getByLabel('How many scenes')).toBeVisible()
    // Each scene: one action, the rest in ⋯.
    const hungRow = page.locator(`[data-scene-row="${hung}"]`)
    const unlitRow = page.locator(`[data-scene-row="${unlit}"]`)
    await expect(hungRow.locator('[data-scene-step]')).toHaveText('Write it')
    await expect(unlitRow.locator('[data-scene-step]')).toHaveText('Fill the card', { timeout: 10_000 })
    await shot(win, 'desk-chapter-page')
    await hungRow.getByRole('button', { name: 'More for Sc 1 The bell is hung' }).click()
    const menu = win.getByRole('menu')
    await expect(menu.getByRole('menuitem')).toHaveText(['Ideas', 'Interview me', 'Fill the card', 'Open'])
    await menu.getByRole('menuitem', { name: 'Ideas' }).click()
    await expect(hungRow.locator(`[data-scene-ideas="${hung}"]`)).toBeVisible()
    await hungRow.getByRole('button', { name: 'Close the ideas' }).click()
    // Fill the card, on the empty one: only its empty parts.
    await unlitRow.locator('[data-scene-step="fill"]').click()
    await expect(toastWith(win, /^Planned|already had everything/)).toBeVisible({ timeout: 30_000 })
    await expect.poll(async () => (await invoke(win, 'getScene', unlit)).card.goal).not.toBe('')

    // ----- Add scenes: the suggestions arrive on the page; What the AI saw comes back here -----
    await page.locator(`[data-add-scenes="${ch3}"]`).click()
    const batch = page.locator('[data-batch="chapter"]')
    await expect(batch.getByRole('button', { name: 'Keep all' })).toBeVisible({ timeout: 30_000 })
    await expect(batch.getByRole('group', { name: /^Scene: / }).first()).toContainText('Ch 3 · Sc 3')
    await batch.getByRole('button', { name: 'What the AI saw' }).click()
    await win.locator('main').getByRole('button', { name: 'Back to Ch 3 · The Bell Tower' }).click()
    await expect(area(win).locator(`[data-chapter-page="${ch3}"] [data-batch="chapter"]`).getByRole('button', { name: 'Keep all' })).toBeVisible()
    await area(win).locator('[data-batch="chapter"]').getByRole('button', { name: 'Keep all' }).click()
    await expect.poll(async () => (await invoke(win, 'getOutline', storyId)).scenes.filter((s) => s.chapterId === ch3).length).toBeGreaterThan(2)

    // ----- A scene's name opens its page: its card in short, and what the AI can do for it -----
    await area(win).locator(`[data-scene-zoom="${hung}"]`).click()
    const scene = area(win).locator(`[data-scene-page="${hung}"]`)
    await expect(scene).toBeVisible()
    await expect(trail(win)).toHaveText(/Whole story\s*Ch 3\s*Sc 1/)
    await expect(scene.getByRole('heading', { name: 'The bell is hung' })).toBeVisible()
    const card = scene.getByRole('region', { name: 'Scene card' })
    await expect(card).toContainText('The Board’s men hang the bell buoy off Bell Rock.')
    await expect(card).toContainText('Day 9, dawn')
    await expect(card).toContainText('The chain jams and Wren frees it')
    for (const t of ['ideas', 'interview', 'fill', 'write']) await expect(scene.locator(`[data-scene-tool="${t}"]`)).toBeVisible()
    await shot(win, 'desk-scene-page')
    await scene.locator('[data-scene-tool="ideas"]').click()
    const ideas = scene.locator(`[data-scene-ideas="${hung}"]`)
    await ideas.locator('[data-ask-ideas]').click()
    await expect(ideas.locator('[data-idea]')).toHaveCount(3, { timeout: 30_000 })
    await shot(win, 'desk-scene-page-ideas')

    // ----- The trail: back to the chapter, then to the whole story, the chapter in view -----
    await trail(win).getByRole('button', { name: 'Ch 3' }).click()
    await expect(area(win).locator(`[data-chapter-page="${ch3}"]`)).toBeVisible()
    await trail(win).getByRole('button', { name: 'Whole story' }).click()
    await expect(area(win).locator('[data-story-line]')).toBeVisible()
    await expect(area(win)).not.toHaveAttribute('data-zoomed', /.+/)
    await expect(line(win).locator(`[data-chapter="${ch3}"]`)).toBeInViewport()

    // ----- Write it, from the scene's page: the scene on the writing page, its draft started -----
    await line(win).locator(`[data-scene-zoom="${unlit}"]`).click()
    await area(win).locator(`[data-scene-page="${unlit}"] [data-scene-tool="write"]`).click()
    await expect(win.locator('.scene-prose')).toBeVisible()
    await expect.poll(async () => (await invoke(win, 'getScene', unlit)).text.length, { timeout: 30_000 }).toBeGreaterThan(0)
  } finally {
    await fake.close()
  }
})

test('every way in lands on the chapter’s or the scene’s page (the panels)', async ({ launch }) => {
  test.setTimeout(180_000)
  const fake = await fakeServer()
  try {
    const { win, ch3, hung } = await sample(launch, fake, PANELS, 1366, 768)
    const chapterRow = () => binder(win).locator('[data-row="chapter"]', { hasText: 'The Bell Tower' })
    const sceneRow = () => binder(win).locator('[data-row="scene"]', { hasText: 'The bell is hung' })

    // The binder's right-click on a chapter.
    await chapterRow().click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Build this chapter with AI' }).click()
    await expect(area(win).locator(`[data-chapter-page="${ch3}"]`)).toBeVisible()
    await expect(trail(win)).toHaveText(/Whole story\s*Ch 3 · The Bell Tower/)
    await shot(win, 'panels-chapter-page')

    // The binder's right-click on a scene.
    await areaButton(win, 'Write').click()
    await sceneRow().click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Build this scene with AI' }).click()
    await expect(area(win).locator(`[data-scene-page="${hung}"]`)).toBeVisible()
    await shot(win, 'panels-scene-page')

    // The scene card's link (the scene open on the writing page).
    await areaButton(win, 'Write').click()
    await sceneRow().click()
    await win.locator('[data-build-scene-link]').click()
    await expect(area(win).locator(`[data-scene-page="${hung}"]`)).toBeVisible()

    // The palette: this scene, then this chapter.
    await areaButton(win, 'Write').click()
    await sceneRow().click()
    await win.keyboard.press('Control+K')
    await win.keyboard.type('Build this scene')
    await win.getByRole('dialog', { name: 'Search' }).getByRole('option', { name: 'Build this scene with AI' }).click()
    await expect(area(win).locator(`[data-scene-page="${hung}"]`)).toBeVisible()
    await areaButton(win, 'Write').click()
    await sceneRow().click()
    await win.keyboard.press('Control+K')
    await win.keyboard.type('Build this chapter')
    await win.getByRole('dialog', { name: 'Search' }).getByRole('option', { name: 'Build this chapter with AI' }).click()
    await expect(area(win).locator(`[data-chapter-page="${ch3}"]`)).toBeVisible()

    // The chapter card's link.
    await areaButton(win, 'Write').click()
    await chapterRow().click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Chapter card' }).click()
    await win.locator('[data-build-chapter-link]').click()
    await expect(area(win).locator(`[data-chapter-page="${ch3}"]`)).toBeVisible()

    // An older way in: Write this chapter with AI… lands on the page with Write this chapter open.
    await areaButton(win, 'Write').click()
    await chapterRow().click({ button: 'right' })
    await win.getByRole('menuitem', { name: /^Write this chapter with AI/ }).click()
    const page = area(win).locator(`[data-chapter-page="${ch3}"]`)
    await expect(page.locator(`[data-write-panel="${ch3}"]`).getByTestId('chapter-writer-plan')).toContainText('The bell is hung')
    await expect(page.locator(`[data-write-chapter-btn="${ch3}"]`)).toHaveAttribute('aria-expanded', 'true')
    await shot(win, 'panels-chapter-page-write')
    // Interview me about this chapter: the page, at its plan, the first question there.
    await areaButton(win, 'Write').click()
    await chapterRow().click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Interview me about this chapter' }).click()
    await expect(page.locator(`[data-chapter-plan="${ch3}"]`).getByRole('region', { name: 'Interview' }).getByText('What happens in this chapter?')).toBeVisible()
  } finally {
    await fake.close()
  }
})
