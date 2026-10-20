// Build with AI's look, in pictures (2026-10-20): the area on the desk in Dark and in the panels in Light, at 1366×768 and
// full screen: a new story at Your idea, Cast and world, the story line mid-story with a chapter's Plan this chapter
// open, and Write this chapter's plan to read. Written to BUILD_SHOTS (a folder) when it is set; nothing is checked
// beyond what each picture needs to be there. Run on its own to look at the area: BUILD_SHOTS=<folder> npx playwright
// test buildLook. Invented text only (the sample world, the fake provider).
import type { ElectronApplication, Page } from '@playwright/test'
import { join } from 'node:path'
import { expect, invoke, test, type LaunchOptions } from './helpers'
import type { FakeProvider } from '../fake-provider/server.mjs'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk', AIWRITE_KEEPER_QUIET_MS: '600000', AIWRITE_THEME: 'dark' }
const PANELS = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'panels', AIWRITE_KEEPER_QUIET_MS: '600000', AIWRITE_THEME: 'light' }
const area = (win: Page) => win.locator('[data-plan-hub]')

/** Build with AI, the way Adam opens it: the Plan room's first link (the desk), or the Plan area (the panels). */
async function openArea(win: Page, desk: boolean): Promise<void> {
  if (desk) {
    await win.getByRole('navigation', { name: 'Rooms' }).getByRole('button', { name: /^Plan/ }).click()
    await win.locator('[data-desk-room]').getByRole('navigation', { name: 'Plan' }).getByRole('button', { name: 'Build with AI' }).click()
  } else {
    await win.getByRole('navigation', { name: 'Areas' }).getByRole('button', { name: 'Plan', exact: true }).click()
    await win.locator('[data-area-list]').getByRole('button', { name: 'Build with AI' }).click()
  }
}

async function shot(win: Page, name: string): Promise<void> {
  const dir = process.env.BUILD_SHOTS
  if (!dir) return
  await win.waitForTimeout(450)
  await win.screenshot({ path: join(dir, `${name}.png`) })
}

async function size(app: ElectronApplication, win: Page, w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [cw, ch]) => {
    const b = BrowserWindow.getAllWindows()[0]
    b.unmaximize()
    b.setContentSize(cw, ch)
  }, [w, h])
  await expect.poll(async () => Math.abs(((await win.evaluate('innerWidth')) as number) - w)).toBeLessThanOrEqual(1)
}

async function sample(launch: (o?: LaunchOptions) => Promise<{ app: ElectronApplication; win: Page }>, fake: FakeProvider, env: Record<string, string>) {
  const a = await launch({ env })
  await expect(a.win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(a.win, 'openSampleWorld')
  const p = await invoke(a.win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
  await invoke(a.win, 'updateSettings', {
    models: { writer: { providerId: p.id, modelId: 'fake/writer', label: 'fake/writer', contextLength: 32000, promptPrice: 0.3 / 1e6, completionPrice: 1.2 / 1e6 } }
  })
  const [story] = await invoke(a.win, 'listStories')
  // Planned past where it is written: Ch 3 with two planned scenes, so a chapter can be planned and written.
  const ch3 = await invoke(a.win, 'createChapter', story.id, { title: 'The Bell Tower' })
  const [first] = (await invoke(a.win, 'getOutline', story.id)).scenes.filter((s) => s.chapterId === ch3.id)
  const s1 = first?.id ?? (await invoke(a.win, 'createScene', ch3.id, { title: 'The bell is hung' })).id
  await invoke(a.win, 'updateScene', s1, { title: 'The bell is hung' })
  const card = (await invoke(a.win, 'getScene', s1)).card
  await invoke(a.win, 'updateSceneCard', s1, { ...card, goal: 'The Board’s men hang the bell buoy off Bell Rock.', beats: ['The boat comes out at dawn'] })
  const s2 = (await invoke(a.win, 'createScene', ch3.id, { title: 'A lamp left unlit' })).id
  await invoke(a.win, 'updateSceneCard', s2, { ...card, goal: 'Iska finds the lamp room dark and the keeper gone.' })
  await a.win.reload()
  await expect(a.win.locator('.scene-prose')).toBeVisible()
  return { ...a, storyId: story.id, ch3: ch3.id }
}

for (const [name, env] of [
  ['desk-dark', DESK],
  ['panels-light', PANELS]
] as const) {
  test(`Build with AI in pictures: ${name}`, async ({ launch }) => {
    test.setTimeout(240_000)
    const { startFakeProvider } = await import('../fake-provider/server.mjs')
    const fake = await startFakeProvider({ delayMs: 2 })
    try {
      const { app, win, ch3 } = await sample(launch, fake, env)
      for (const [w, h, tag] of [
        [1366, 768, '1366'],
        [1920, 1080, 'full']
      ] as const) {
        await size(app, win, w, h)
        // Mid-story: the story line, with Plan this chapter open on Ch 3.
        await openArea(win, name === 'desk-dark')
        await expect(area(win)).toHaveAttribute('data-plan-hub', 'writing')
        await shot(win, `${name}-${tag}-line`)
        const row = area(win).locator(`[data-chapter="${ch3}"]`).first()
        if (!(await row.isVisible())) await area(win).locator('[data-row="planned"]').getByRole('button', { name: /^(Pick up from here|Open the plan)$/ }).click()
        if (!(await area(win).locator(`[data-chapter-plan="${ch3}"]`).isVisible())) await row.locator(`[data-plan-chapter="${ch3}"]`).click()
        await expect(area(win).locator(`[data-chapter-plan="${ch3}"]`)).toBeVisible()
        await shot(win, `${name}-${tag}-plan-chapter`)
        await area(win).locator('[data-nav="cast"]').click()
        await shot(win, `${name}-${tag}-cast`)
        await area(win).locator('[data-nav="idea"]').click()
        await shot(win, `${name}-${tag}-idea`)
        await area(win).locator('[data-nav="threads"]').click()
        await shot(win, `${name}-${tag}-threads`)
      }
      // Write this chapter: its plan to read.
      await area(win).locator('[data-nav="line"]').click()
      await area(win).locator(`[data-write-chapter-btn="${ch3}"]`).click()
      await area(win).getByTestId('chapter-writer-start').click()
      await expect(area(win).getByTestId('chapter-plan')).toBeVisible({ timeout: 60_000 })
      await area(win).getByTestId('chapter-plan').scrollIntoViewIfNeeded()
      await shot(win, `${name}-full-write-review`)
      await size(app, win, 1366, 768)
      await area(win).getByTestId('chapter-plan').evaluate((el) => el.scrollIntoView({ block: 'start' }))
      await shot(win, `${name}-1366-write-review`)
      await area(win).getByTestId('chapter-plan-cancel').click()
      // A new story, at Your idea.
      const made = await invoke(win, 'createStory', { title: 'The Ferryman’s Debt' })
      await invoke(win, 'updateSettings', { lastStoryId: made.id })
      await win.reload()
      await openArea(win, name === 'desk-dark')
      await expect(area(win)).toHaveAttribute('data-plan-hub', 'start')
      await shot(win, `${name}-1366-new-idea`)
      await size(app, win, 1920, 1080)
      await shot(win, `${name}-full-new-idea`)
    } finally {
      await fake.close()
    }
  })
}
