// From a plan to a written chapter in Build with AI (Adam, 2026-10-20: "Start writing" did nothing he could see; there
// was no way to say how many scenes or how long when planning a chapter; and he could only write one scene at a time).
// On the sample world against the fake provider (tests/fake-provider/m4/outline.mjs: a chapter's plan always answers
// with three scenes, whatever was asked, so the count is held to here). Invented text only.
//
//  1. Mid-story on the desk: the rest of Ch 2 planned and kept; the batch all decided offers Write the first scene (the
//     scene on the writing page, its draft started), also after What the AI saw and back. Not Write this chapter: Ch 2
//     has words, which writing it whole would write again.
//  2. The planned stretch's row offers Write Ch 3 straight away; on Ch 3's own page, Add scenes, kept: the batch offers
//     Write this chapter, which opens on the page at the start (its plan comes first).
//  3. Plan it for Ch 4 (no scenes yet), on its page: How many scenes (2) and its length (4,000 words) reach the AI's
//     request, the third scene the AI gave anyway is left out, the length is the chapter card's target; then Write this
//     chapter.
// Pictures go to CHAPTERFLOW_SHOTS when it is set (a folder), for looking at.
import type { ElectronApplication, Page } from '@playwright/test'
import { join } from 'node:path'
import { expect, invoke, test, type LaunchOptions } from './helpers'
import type { FakeProvider } from '../fake-provider/server.mjs'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk', AIWRITE_KEEPER_QUIET_MS: '600000', AIWRITE_THEME: 'dark' }
const hub = (win: Page) => win.locator('[data-plan-hub]')
const line = (win: Page) => hub(win).locator('[data-story-line]')
const head = (win: Page) => hub(win).locator('[data-batch-head]')

async function shot(win: Page, name: string): Promise<void> {
  const dir = process.env.CHAPTERFLOW_SHOTS
  if (!dir) return
  await win.waitForTimeout(400)
  await win.screenshot({ path: join(dir, `${name}.png`) })
}

async function fakeServer(): Promise<FakeProvider> {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  return startFakeProvider({ delayMs: 2 })
}

/** The sample world with the fake as its model, and Ch 3 "The Bell Tower" planned (one scene) past where it is written. */
async function sample(
  launch: (o?: LaunchOptions) => Promise<{ app: ElectronApplication; win: Page }>,
  fake: FakeProvider
): Promise<{ win: Page; storyId: string; ch2: string; ch3: string; ch4: string }> {
  const a = await launch({ env: DESK })
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
  // Ch 4 "The Board Meets", with no scenes yet.
  const ch4 = await invoke(a.win, 'createChapter', story.id, { title: 'The Board Meets' })
  for (const sc of (await invoke(a.win, 'getOutline', story.id)).scenes.filter((x) => x.chapterId === ch4.id)) await invoke(a.win, 'deleteScene', sc.id)
  const outline = await invoke(a.win, 'getOutline', story.id)
  await a.app.evaluate(({ BrowserWindow }) => {
    const b = BrowserWindow.getAllWindows()[0]
    b.unmaximize()
    b.setContentSize(1600, 960)
  })
  await a.win.reload()
  await expect(a.win.locator('.scene-prose')).toBeVisible()
  return { win: a.win, storyId: story.id, ch2: outline.chapters[1].id, ch3: ch3.id, ch4: ch4.id }
}

async function openBuild(win: Page): Promise<void> {
  await win.getByRole('navigation', { name: 'Rooms' }).getByRole('button', { name: /^Plan/ }).click()
  await win.locator('[data-desk-room]').getByRole('navigation', { name: 'Plan' }).getByRole('button', { name: 'Build with AI' }).click()
  await expect(hub(win)).toHaveAttribute('data-plan-hub', 'writing')
}

test('a plan all decided: Write this chapter and Write the first scene do what they say; Plan this chapter takes how many scenes and how long', async ({
  launch
}) => {
  test.setTimeout(180_000)
  const fake = await fakeServer()
  try {
    const { win, storyId, ch2, ch3, ch4 } = await sample(launch, fake)
    await openBuild(win)

    // ----- The rest of Ch 2, planned and kept -----
    const next = hub(win).locator('[data-next-card]')
    await next.getByRole('button', { name: 'the rest of Ch 2' }).click()
    await next.locator('[data-plan-it]').click()
    await expect(head(win).getByRole('button', { name: 'Keep all' })).toBeVisible({ timeout: 30_000 })
    await head(win).getByRole('button', { name: 'Keep all' }).click()
    await expect(head(win)).toContainText('All decided · 2 kept')
    const kept = (await invoke(win, 'getOutline', storyId)).scenes.filter((s) => s.chapterId === ch2).slice(2)
    expect(kept.map((s) => s.title)).toEqual(['Arrival at the docks', 'A bargain at the docks'])
    // No "Start writing" that only opens an empty page; no Write this chapter for a chapter with words.
    await expect(head(win).getByRole('button', { name: 'Start writing' })).toHaveCount(0)
    await expect(head(win).getByRole('button', { name: /^Write (this chapter|Ch)/ })).toHaveCount(0)
    await shot(win, 'batch-all-decided')

    // ----- What the AI saw and back, then Write the first scene: the scene on the writing page, its draft started -----
    await head(win).getByRole('button', { name: 'What the AI saw' }).click()
    await win.locator('main').getByRole('button', { name: 'Back to Build with AI' }).click()
    await expect(head(win)).toContainText('All decided · 2 kept')
    await head(win).getByRole('button', { name: 'Write the first scene' }).click()
    await expect(hub(win)).toHaveCount(0)
    await expect(win.locator('main h1').getByRole('button', { name: 'Arrival at the docks', exact: true })).toBeVisible()
    await expect.poll(async () => (await invoke(win, 'getScene', kept[0].id)).text.length, { timeout: 30_000 }).toBeGreaterThan(0)

    // ----- Plan this chapter: how many scenes and how long -----
    await openBuild(win)
    // The planned chapters are listed straight in the line (no row around them), each with its own one next step.
    await expect(line(win).locator('[data-row="planned"]')).toHaveCount(0)
    await expect(line(win).locator(`[data-planned-chapters] [data-chapter="${ch3}"]`)).toBeVisible()
    await shot(win, 'planned-row-write')

    // ----- Ch 3's own page: Add scenes, kept; the batch offers Write this chapter, open on the page at the start -----
    await line(win).locator(`[data-chapter-zoom="${ch3}"]`).click()
    const page3 = hub(win).locator(`[data-chapter-page="${ch3}"]`)
    await page3.locator(`[data-add-scenes="${ch3}"]`).click()
    await expect(head(win).getByRole('button', { name: 'Keep all' })).toBeVisible({ timeout: 30_000 })
    await head(win).getByRole('button', { name: 'Keep all' }).click()
    await expect(head(win)).toContainText('All decided')
    await shot(win, 'batch-write-chapter')
    await head(win).getByRole('button', { name: 'Write this chapter' }).click()
    const panel = page3.locator(`[data-write-panel="${ch3}"]`)
    await expect(panel).toBeVisible()
    await expect(panel).toHaveAttribute('data-write-stage', 'start')
    await expect(page3.locator(`[data-write-chapter-btn="${ch3}"]`)).toHaveAttribute('aria-expanded', 'true')
    await panel.getByRole('button', { name: 'Close Write this chapter' }).click()

    // ----- Plan it for Ch 4, on its page: how many scenes and how long -----
    await hub(win).getByRole('navigation', { name: 'Trail' }).getByRole('button', { name: 'Whole story' }).click()
    await expect(line(win).locator(`[data-step-for="${ch4}"]`)).toHaveText('Plan it')
    await line(win).locator(`[data-step-for="${ch4}"]`).click()
    const page4 = hub(win).locator(`[data-chapter-page="${ch4}"]`)
    const plan = page4.locator(`[data-chapter-plan="${ch4}"]`)
    const size = page4.locator('[data-chapter-size]')
    await expect(size.getByLabel('How many scenes')).toHaveText('Auto')
    await size.getByLabel('How many scenes').click()
    await win.getByRole('option', { name: '2 scenes', exact: true }).click()
    await size.getByLabel('Length of the chapter').fill('4000')
    // Its card's target, saved as it is typed (the chapter has no scenes, and 2 are asked for).
    await expect.poll(async () => (await invoke(win, 'getChapterCard', ch4)).totalWords).toBe(4000)
    await expect(size.locator('[data-size-hint]')).toHaveText('About 2,000 words a scene.')
    await shot(win, 'plan-this-chapter-size')
    await plan.locator('[data-suggest-scenes]').click()
    await expect(plan.getByRole('group', { name: /^Scene: / })).toHaveCount(2, { timeout: 30_000 })
    const m = fake.lastRequest()!.body.messages as { role: string; content: string }[]
    expect(m[0].content).toContain('- Suggest exactly 2 scenes: the author asked for that many, no more and no fewer.')
    expect(m.filter((x) => x.role === 'user').map((x) => x.content).join('\n')).toMatch(
      /Suggest exactly 2 scenes\. The whole chapter is to be about 4,000 words long, so each scene is about 2,000 words/
    )
    // The AI gave three anyway: only two are offered, and Keep all keeps two.
    await expect(plan.getByRole('group', { name: 'Scene: The name on the door' })).toHaveCount(0)
    await plan.getByRole('button', { name: 'Keep all' }).click()
    await expect
      .poll(async () => (await invoke(win, 'getOutline', storyId)).scenes.filter((s) => s.chapterId === ch4).map((s) => s.title))
      .toEqual(['A letter at dawn', 'Questions at the market'])
    // Then Write this chapter, from the plan.
    await plan.locator('[data-write-chapter-row]').getByRole('button', { name: 'Write this chapter' }).click()
    await expect(page4.locator(`[data-write-panel="${ch4}"]`)).toBeVisible()
  } finally {
    await fake.close()
  }
})
