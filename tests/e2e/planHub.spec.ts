// The Plan hub (Adam, 2026-10-20: "the one place to plan with AI", and coming back after part of a story is written to
// plan the next part), on the sample world against the fake provider (tests/fake-provider/m4/outline.mjs answers the
// hub's "[AIWRITE-OUTLINE v1] stage scenes" with as many scenes as asked, and "update" with the drifting cards put right;
// story.mjs answers Talk it over). Invented text only.
//
//  1. Mid-story, on the desk (Dark): the Plan room's first link opens it. YOU ARE HERE at the last scene written, said in a
//     line with no AI call; Adam's words and a thread he ticked reach the request (and What the AI saw); the next scene
//     arrives after the marker in the story line, and Keep puts it right after the last scene written, not at the end;
//     the story has moved on from the plan (a planned card dated before what was written), Show me lights it up, Update
//     the plan shows the card put right before Keep; the rest of the chapter talked over (the change shown first, made
//     only with "Make this change"); Pick up from here opens the plan chapter by chapter and plans a chapter's scenes;
//     an act with no chapters plans its chapters; the Plan before writing switch.
//  2. The panels (Light): the same hub mid-story, and a new story's start: "What is your story?", the one idea box (the
//     Story builder's plot), the cast and world, what to plan and how much, then the whole story planned and kept.
// Screenshots go to PLANHUB_SHOTS when it is set (a folder), for looking at.
import type { ElectronApplication, Page } from '@playwright/test'
import { join } from 'node:path'
import { areaButton, areaRow, expect, invoke, test, type LaunchOptions } from './helpers'
import type { FakeProvider } from '../fake-provider/server.mjs'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk', AIWRITE_KEEPER_QUIET_MS: '600000', AIWRITE_THEME: 'dark' }
const PANELS = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'panels', AIWRITE_KEEPER_QUIET_MS: '600000', AIWRITE_THEME: 'light' }
const hub = (win: Page) => win.locator('[data-plan-hub]')
const line = (win: Page) => hub(win).locator('[data-story-line]')
const group = (win: Page, kind: string, title: string) => hub(win).getByRole('group', { name: `${kind}: ${title}`, exact: true })
const toastWith = (win: Page, text: string) => win.locator('div.fixed[aria-live="polite"] > div', { hasText: text })
const talk = (win: Page) => hub(win).getByRole('region', { name: 'Talk it over' })

async function fakeServer(): Promise<FakeProvider> {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  return startFakeProvider({ delayMs: 2 })
}

async function shot(win: Page, name: string): Promise<void> {
  const dir = process.env.PLANHUB_SHOTS
  if (!dir) return
  await win.waitForTimeout(400)
  await win.screenshot({ path: join(dir, `${name}.png`) })
}

/** The sample world (two chapters, four scenes, all written), with the fake as its model, at a given window size. */
async function sampleWorld(
  launch: (o?: LaunchOptions) => Promise<{ app: ElectronApplication; win: Page }>,
  fake: FakeProvider,
  env: Record<string, string>,
  size: [number, number] = [1600, 960]
): Promise<{ app: ElectronApplication; win: Page; storyId: string }> {
  const a = await launch({ env })
  await expect(a.win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(a.win, 'openSampleWorld')
  const p = await invoke(a.win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
  await invoke(a.win, 'updateSettings', {
    models: { writer: { providerId: p.id, modelId: 'fake/writer', label: 'fake/writer', contextLength: 32000, promptPrice: null, completionPrice: null } }
  })
  const [story] = await invoke(a.win, 'listStories')
  await a.win.reload()
  await expect(a.win.locator('.scene-prose')).toContainText('A hundred and twelve steps to the lamp room.')
  await a.app.evaluate(({ BrowserWindow }, [w, h]) => {
    const b = BrowserWindow.getAllWindows()[0]
    b.unmaximize()
    b.setContentSize(w, h)
  }, size)
  await expect.poll(async () => Math.abs(((await a.win.evaluate('innerWidth')) as number) - size[0])).toBeLessThanOrEqual(1)
  return { ...a, storyId: story.id }
}

/**
 * What the story has planned past where it is written: Ch 3 "The Bell Tower" with one planned scene whose card is dated
 * before what was written (Day 1, when the writing has got to Day 3), Ch 4 "The Board Meets" with no scenes yet, and an
 * act with no chapters.
 */
async function planAhead(win: Page, storyId: string): Promise<{ ch3: string; ch4: string; drifting: string; actId: string }> {
  const ch3 = await invoke(win, 'createChapter', storyId, { title: 'The Bell Tower' })
  const [planned] = (await invoke(win, 'getOutline', storyId)).scenes.filter((s) => s.chapterId === ch3.id)
  const drifting = planned?.id ?? (await invoke(win, 'createScene', ch3.id, { title: 'The bell is hung' })).id
  await invoke(win, 'updateScene', drifting, { title: 'The bell is hung' })
  const card = (await invoke(win, 'getScene', drifting)).card
  await invoke(win, 'updateSceneCard', drifting, { ...card, when: 'Day 1, morning', goal: 'The Board’s men hang the bell buoy off Bell Rock.', beats: ['The boat comes out at dawn'] })
  const ch4 = await invoke(win, 'createChapter', storyId, { title: 'The Board Meets' })
  for (const sc of (await invoke(win, 'getOutline', storyId)).scenes.filter((s) => s.chapterId === ch4.id)) await invoke(win, 'deleteScene', sc.id)
  const act = await invoke(win, 'createAct', storyId, { title: 'Midwinter' })
  return { ch3: ch3.id, ch4: ch4.id, drifting, actId: act.id }
}

const lastAsked = (fake: FakeProvider): { system: string; user: string } => {
  const m = fake.lastRequest()!.body.messages as { role: string; content: string }[]
  return { system: m[0].content, user: m.filter((x) => x.role === 'user').map((x) => x.content).join('\n') }
}

test('mid-story on the desk: where you are, what happens next in Adam’s words, the next scene kept after the last one written, the plan put right', async ({
  launch
}) => {
  const fake = await fakeServer()
  try {
    const { win, storyId } = await sampleWorld(launch, fake, DESK)
    const ahead = await planAhead(win, storyId)
    await win.reload()
    await expect(win.locator('.scene-prose')).toBeVisible()

    // The Plan room's first link.
    await win.getByRole('navigation', { name: 'Rooms' }).getByRole('button', { name: /^Plan/ }).click()
    const plan = win.locator('[data-desk-room]').getByRole('navigation', { name: 'Plan' })
    await expect(plan.getByRole('button').first()).toHaveText(/Plan with AI/)
    await plan.getByRole('button', { name: 'Plan with AI' }).click()
    await expect(hub(win)).toHaveAttribute('data-plan-hub', 'writing')

    // The header: the story, what is written, the way to the idea, cast and world.
    await expect(hub(win).getByRole('heading', { level: 1 })).toHaveText('The Keeper’s Light')
    await expect(hub(win).locator('[data-written]')).toHaveText(/^Written: Ch 1 to Ch 2, Sc 2 · [\d,]+ words$/)
    await expect(hub(win).getByRole('button', { name: 'The idea, cast and world' })).toBeVisible()

    // You are here, the last scene written in a line (its summary: no AI call), the threads waiting.
    const next = hub(win).locator('[data-next-card]')
    await expect(next).toContainText('YOU ARE HERE · CH 2, SC 2')
    await expect(next.getByRole('heading', { name: 'What happens next?' })).toBeVisible()
    await expect(next.locator('[data-last-written]')).toHaveText(/^Last written: At low tide Wren leads Iska across the Drowned Steps/)
    const threads = next.getByRole('group', { name: 'Threads waiting' })
    await expect(threads).toContainText('Will the light go dark at midwinter? (since Ch 2)')
    // Only what makes sense here: Ch 3 is planned already, so no "next chapter"; the sample has no acts to finish.
    await expect(next.getByRole('group', { name: 'What to plan' }).getByRole('button')).toHaveText(['the next scene', 'the rest of Ch 2'])

    // The story line: the chapter before folded away, this one's scenes, the marker, the plan ahead, the empty act.
    const rows = line(win).locator('[data-row]')
    await expect(rows).toHaveCount(5)
    await expect(line(win).locator('[data-row="written-chapters"]')).toContainText('Ch 1 · written')
    await expect(line(win).locator('[data-row="current"]')).toContainText('Ch 2 · Sc 1 What the Letter Said · Sc 2 Low Tide')
    await expect(line(win).locator('[data-row="here"]')).toHaveText('YOU ARE HERE')
    await expect(line(win).locator('[data-row="planned"]')).toContainText('Ch 3 to Ch 4 · planned, not written')
    await expect(line(win).locator('[data-row="acts-only"]')).toContainText('Act 1 · acts only')

    // The story has moved on from the plan: no AI call to find it.
    const drift = hub(win).locator('[data-drift-card]')
    await expect(drift.getByRole('heading', { name: 'The story has moved on from the plan' })).toBeVisible()
    await expect(drift).toContainText('Ch 3, Sc 1 “The bell is hung”:')
    await expect(drift).toContainText('is earlier than Ch 2, Sc 2')
    await shot(win, 'desk-dark-mid-story')

    // Show me: the plan opens at that scene and lights it up.
    await drift.getByRole('button', { name: 'Show me' }).click()
    const lit = line(win).locator(`[data-planned-chapters] [data-scene-row="${ahead.drifting}"]`)
    await expect(lit).toBeVisible()
    await expect(lit).toHaveClass(/is-lit/)
    await expect(line(win).locator(`[data-drift-note="${ahead.drifting}"]`)).toContainText('is earlier than Ch 2, Sc 2')

    // ----- What happens next, in Adam's words, with a thread: the next scene -----
    await next.getByLabel('Tell it in your own words, or leave it to the AI').fill('Iska writes her report by lamplight, and leaves out the rope.')
    await threads.getByRole('button', { name: /Will the light go dark at midwinter/ }).click()
    await expect(threads.getByRole('button', { name: /Will the light go dark at midwinter/ })).toHaveAttribute('aria-pressed', 'true')
    await next.locator('[data-plan-it]').click()
    const scene = group(win, 'Scene', 'Arrival at the docks')
    await expect(scene).toBeVisible({ timeout: 30_000 })
    const asked = lastAsked(fake)
    expect(asked.system).toContain('[AIWRITE-OUTLINE v1] stage scenes')
    expect(asked.user).toContain('## How the last scene written ends\n')
    expect(asked.user).toContain(
      '## What the author wants (make it happen)\nIska writes her report by lamplight, and leaves out the rope.\n\nBring back this plot thread: Will the light go dark at midwinter? (open since Ch 2).'
    )
    expect(asked.user).toContain('Suggest exactly 1 scene of the chapter “The Drowned Steps” (it is in the story already): the one that comes right after “Low Tide” (Ch 2, Sc 2)')
    // In the story line, right after YOU ARE HERE, named where it would go.
    await expect(line(win).locator('[data-row="here"] + .hub-line-batch')).toContainText('Ch 2 · Sc 3')
    await expect(scene.locator('[data-box]')).toContainText('Mara arrives at the docks and finds it watched.')

    // What the AI saw has his words.
    await hub(win).locator('[data-batch-head]').getByRole('button', { name: 'What the AI saw' }).click()
    await expect(win.locator('main')).toContainText('Iska writes her report by lamplight, and leaves out the rope.')
    await win.locator('main').getByRole('button', { name: 'Back to the plan' }).click()
    await expect(hub(win)).toBeVisible()

    // Keep: right after the last scene written, in its chapter (not at the end of the binder).
    await scene.getByRole('button', { name: 'Keep “Arrival at the docks”' }).click()
    await expect(toastWith(win, 'Added “Arrival at the docks” to the story.')).toBeVisible()
    // All decided: the batch folds to its head, and the scene is in the story line, planned, after the marker.
    await expect(hub(win).locator('[data-batch-head]')).toContainText('All decided · 1 kept')
    await expect(line(win).locator('[data-row="planned-scenes"]')).toContainText('Ch 2 · Sc 3 Arrival at the docks')
    await expect
      .poll(async () => {
        const o = await invoke(win, 'getOutline', storyId)
        const ch2 = o.chapters[1].id
        return o.scenes.filter((s) => s.chapterId === ch2).map((s) => s.title)
      })
      .toEqual(['What the Letter Said', 'Low Tide', 'Arrival at the docks'])

    // ----- Update the plan: the card put right, shown before anything changes -----
    await drift.getByRole('button', { name: 'Update the plan' }).click()
    const update = drift.locator('[data-plan-update]')
    await expect(update.locator(`[data-update-scene="${ahead.drifting}"]`)).toContainText('Day 4, morning')
    await expect(update).toContainText('The Board’s men hang the bell buoy off Bell Rock.')
    expect((await invoke(win, 'getScene', ahead.drifting)).card.when).toBe('Day 1, morning')
    await update.getByRole('button', { name: 'Keep these changes' }).click()
    await expect(toastWith(win, 'Updated the plan: 1 scene card now follow')).toBeVisible()
    await expect.poll(async () => (await invoke(win, 'getScene', ahead.drifting)).card.when).toBe('Day 4, morning')
    // The plan fits again: the card goes.
    await expect(drift).toHaveCount(0, { timeout: 15_000 })

    // ----- The rest of the chapter, talked over: the change shown first, made only with "Make this change" -----
    await next.getByRole('button', { name: 'the rest of Ch 2' }).click()
    await next.getByLabel('Tell it in your own words, or leave it to the AI').fill('')
    await next.locator('[data-plan-it]').click()
    const bargain = group(win, 'Scene', 'A bargain at the docks')
    await expect(bargain).toBeVisible({ timeout: 30_000 })
    await expect(hub(win).locator('[data-earlier]')).toHaveCount(0)
    // The rest of the chapter carries on after its last scene so far (the one just kept), and shows after it.
    expect(lastAsked(fake).user).toContain('that come after “Arrival at the docks” (Ch 2, Sc 3), the chapter’s last scene so far')
    await expect(line(win).locator('[data-row="planned-scenes"] + .hub-line-batch')).toContainText('Ch 2 · Sc 4')
    const box = talk(win).getByLabel('What would you like changed?')
    await box.fill('Is it too soon for the Board to know?')
    await talk(win).getByRole('button', { name: 'Send' }).click()
    await expect(talk(win)).toContainText('The second chapter is where Ada catches the wrecker.')
    await expect(talk(win).locator('[data-talk-preview]')).toHaveCount(0)
    await box.fill('Have A bargain at the docks end on grey coats across the water.')
    await talk(win).getByRole('button', { name: 'Send' }).click()
    await expect(talk(win).locator('[data-talk-preview]')).toContainText('A bargain at the docks')
    await expect(bargain).not.toContainText('grey coats across the water')
    await talk(win).getByRole('button', { name: 'Make this change' }).click()
    await expect(bargain).toContainText('Have A bargain at the docks end on grey coats across the water.')
    await expect(talk(win)).toContainText('Applied')

    // ----- Pick up from here: the plan chapter by chapter; Ch 4 has no scenes yet -----
    // (Show me opened it: folded away, then picked up again.)
    const plannedRow = line(win).locator('[data-row="planned"]')
    await plannedRow.getByRole('button', { name: 'Fold away' }).click()
    await expect(line(win).locator('[data-planned-chapters]')).toHaveCount(0)
    await plannedRow.getByRole('button', { name: 'Pick up from here' }).click()
    const ch4 = line(win).locator(`[data-chapter="${ahead.ch4}"]`)
    await expect(ch4).toContainText('Ch 4 · The Board Meets')
    await expect(ch4).toContainText('no scenes yet')
    await ch4.locator('[data-plan-scenes]').click()
    const visitor = ch4.getByRole('group', { name: /^Scene: / }).first()
    await expect(visitor).toBeVisible({ timeout: 30_000 })
    await expect(ch4.locator('.hub-line-batch')).toContainText('Ch 4 · Sc 1')
    await hub(win).locator('[data-batch-head]').getByRole('button', { name: 'Keep all' }).click()
    await expect
      .poll(async () => (await invoke(win, 'getOutline', storyId)).scenes.filter((s) => s.chapterId === ahead.ch4).length)
      .toBeGreaterThan(0)

    // ----- An act with no chapters: plan its chapters, under it -----
    await line(win).locator('[data-row="acts-only"]').getByRole('button', { name: 'Plan its chapters' }).click()
    await expect(line(win).locator('[data-row="acts-only"] + .hub-line-batch').getByRole('group', { name: /^Chapter: / }).first()).toBeVisible({
      timeout: 30_000
    })
    expect(lastAsked(fake).user).toContain('Suggest the chapters of the act “Midwinter” (it is in the story already)')

    // ----- Plan before writing, from here -----
    const planFirst = hub(win).locator('[data-plan-first]').getByRole('switch')
    await expect(planFirst).toHaveAttribute('aria-checked', 'true')
    await planFirst.click()
    await expect.poll(async () => (await invoke(win, 'getSettings')).planFirst).toBe(false)
    await planFirst.click()
    await expect.poll(async () => (await invoke(win, 'getSettings')).planFirst).toBe(true)
    await shot(win, 'desk-dark-mid-story-planned')

    // Leaving and coming back: the suggestions and what Adam wrote are still there.
    await win.getByRole('navigation', { name: 'Rooms' }).getByRole('button', { name: /^World/ }).click()
    await win.getByRole('navigation', { name: 'Rooms' }).getByRole('button', { name: /^Plan/ }).click()
    await win.locator('[data-desk-room]').getByRole('navigation', { name: 'Plan' }).getByRole('button', { name: 'Plan with AI' }).click()
    await expect(line(win).locator('[data-row="acts-only"] + .hub-line-batch').getByRole('group', { name: /^Chapter: / }).first()).toBeVisible()
  } finally {
    await fake.close()
  }
})

test('the panels: the hub mid-story, then a new story from its idea to its plan in the story', async ({ launch }) => {
  const fake = await fakeServer()
  try {
    const { win, storyId } = await sampleWorld(launch, fake, PANELS, [1440, 900])
    await planAhead(win, storyId)
    await win.reload()
    await expect(win.locator('.scene-prose')).toBeVisible()

    // The Plan area's first row.
    await areaButton(win, 'Plan').click()
    await expect(win.locator('[data-area-list]').getByRole('button').first()).toHaveText(/Plan with AI/)
    await expect(hub(win)).toHaveAttribute('data-plan-hub', 'writing')
    await expect(hub(win).locator('[data-next-card]')).toContainText('YOU ARE HERE · CH 2, SC 2')
    await expect(hub(win).locator('[data-drift-card]')).toBeVisible()
    await shot(win, 'panels-light-mid-story')

    // With no scene open, Next scene ideas opens the hub at the next scene (never greyed out).
    await expect(areaRow(win, 'Next scene ideas')).toBeEnabled()

    // ----- A new story: its start, from the palette's Plan with AI -----
    const made = await invoke(win, 'createStory', { title: 'The Ferryman’s Debt' })
    await invoke(win, 'updateSettings', { lastStoryId: made.id })
    await win.reload()
    // A story made with no chapters: the binder offers to plan it with AI.
    await expect(win.getByRole('button', { name: 'Plan it with AI' })).toBeVisible()
    await win.keyboard.press('Control+K')
    await win.keyboard.type('Plan with AI')
    await win.getByRole('dialog', { name: 'Search' }).getByRole('option', { name: 'Plan with AI' }).click()
    await expect(hub(win)).toHaveAttribute('data-plan-hub', 'start')
    const start = hub(win).locator('[data-start-card]')
    await expect(start.getByRole('heading', { name: 'What is your story?' })).toBeVisible()
    await expect(hub(win).locator('[data-written]')).toHaveText('Nothing written yet')
    await expect(start.locator('[data-cast-status]')).toContainText('Cast and world: Not planned yet.')
    await expect(start.getByRole('group', { name: 'What to plan' }).getByRole('button')).toHaveText(['the whole story', 'the first act', 'the first chapter'])
    // How much: from the idea's length (none chosen yet), never a fixed size; In stages or All at once.
    await expect(start.locator('[data-size]')).toContainText('About 27 scenes.')
    await expect(start.locator('[data-size]')).toContainText('Sized for a story with no length chosen yet.')
    await expect(line(win).locator('[data-line-empty]')).toContainText('Your story line will lie here')
    // The one idea box is the Story builder's plot.
    const idea = start.getByLabel(/^Your idea, in your own words/)
    await idea.fill('A ferryman who owes the Duke money is paid to smuggle the heir out of Varn before the river freezes.')
    await expect.poll(async () => (await invoke(win, 'getStoryBrief', made.id)).plot).toBe(
      'A ferryman who owes the Duke money is paid to smuggle the heir out of Varn before the river freezes.'
    )
    await shot(win, 'panels-light-start')

    // The whole story, planned from the idea (the Story builder's request), with a premise written for it.
    await start.locator('[data-plan-it]').click()
    await expect(group(win, 'Chapter', 'Grey Water')).toBeVisible({ timeout: 30_000 })
    expect(lastAsked(fake).system.startsWith('[AIWRITE-STORY v1] outline')).toBe(true)
    await expect(hub(win).locator('[data-premise-card]')).toBeVisible()
    await hub(win).locator('[data-batch-head]').getByRole('button', { name: 'Keep all' }).click()
    await expect.poll(async () => (await invoke(win, 'getOutline', made.id)).chapters.map((c) => c.title)).toEqual(['Grey Water', 'The Long Night'])
    // Planned, nothing written: the hub says so, the batch folds to its head, and the plan shows chapter by chapter.
    await expect(hub(win)).toHaveAttribute('data-plan-hub', 'planned')
    await expect(hub(win).locator('[data-batch-head]')).toContainText('All decided · 7 kept')
    await expect(hub(win).locator('[data-next-card]').getByRole('heading', { name: 'What do you want to plan?' })).toBeVisible()
    const planned = line(win).locator('[data-planned-chapters]')
    await expect(planned).toContainText('Ch 1 · Grey Water')
    await expect(planned).toContainText('Ch 2 · The Long Night')
    await shot(win, 'panels-light-start-planned')

    // Carrying the plan on with nothing written yet: more scenes for Ch 1, after its last scene, with Adam's words.
    await hub(win).locator('[data-next-card]').getByLabel('Tell it in your own words, or leave it to the AI').fill('The ferry is late, and the Duke’s men are early.')
    const grey = (await invoke(win, 'getOutline', made.id)).chapters[0]
    await line(win).locator(`[data-chapter="${grey.id}"]`).getByRole('button', { name: 'Add scenes to Ch 1' }).click()
    const added = line(win).locator(`[data-chapter="${grey.id}"] .hub-line-batch`)
    await expect(added.getByRole('group', { name: /^Scene: / }).first()).toBeVisible({ timeout: 30_000 })
    expect(lastAsked(fake).user).toContain('## What the author wants (make it happen)\nThe ferry is late, and the Duke’s men are early.')
    expect(lastAsked(fake).user).toContain('that come after “Salvage Rights” (Ch 1, Sc 2), the chapter’s last scene so far')
    await expect(added).toContainText('Ch 1 · Sc 3')
    await added.locator('[data-batch-head]').getByRole('button', { name: 'Keep all' }).click()
    await expect
      .poll(async () => (await invoke(win, 'getOutline', made.id)).scenes.filter((s) => s.chapterId === grey.id).map((s) => s.title))
      .toEqual(['The Dark Lamp', 'Salvage Rights', 'Arrival at the docks', 'A bargain at the docks'])
  } finally {
    await fake.close()
  }
})

test('a new story on the desk: its start, the way to the idea, cast and world and back', async ({ launch }) => {
  const { win } = await launch({ env: DESK })
  await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await win.getByLabel('World name').fill('Grey Coast')
  await win.getByRole('button', { name: 'Create world' }).click()
  await expect(win.locator('.scene-prose')).toBeVisible()
  await win.getByRole('navigation', { name: 'Rooms' }).getByRole('button', { name: /^Plan/ }).click()
  await win.locator('[data-desk-room]').getByRole('navigation', { name: 'Plan' }).getByRole('button', { name: 'Plan with AI' }).click()
  await expect(hub(win)).toHaveAttribute('data-plan-hub', 'start')
  const start = hub(win).locator('[data-start-card]')
  await expect(start.getByRole('heading', { name: 'What is your story?' })).toBeVisible()
  await start.getByLabel(/^Your idea, in your own words/).fill('A lighthouse keeper’s daughter has one winter to find out who is wrecking ships on purpose.')
  await shot(win, 'desk-dark-start')

  // The idea, cast and world: the Story builder's first steps, the same idea in its plot; its Plan step comes back here.
  await hub(win).getByRole('button', { name: 'The idea, cast and world' }).click()
  await expect(win.locator('main').getByLabel('Your plot')).toHaveValue('A lighthouse keeper’s daughter has one winter to find out who is wrecking ships on purpose.')
  await win.locator('main [data-step-bar] [data-step="outline"]').first().click()
  await expect(hub(win)).toHaveAttribute('data-plan-hub', 'start')
  await expect(hub(win).getByRole('button', { name: 'Back to the Story builder' })).toBeVisible()
  await hub(win).getByRole('button', { name: 'Back to the Story builder' }).click()
  await expect(win.locator('main').getByLabel('Your plot')).toBeVisible()
})

test('carrying on a story that has chapters: more scenes for a written chapter, the empty cards filled in, never over what a card says', async ({
  launch
}) => {
  const fake = await fakeServer()
  try {
    const { win, storyId } = await sampleWorld(launch, fake, PANELS, [1440, 900])
    const ahead = await planAhead(win, storyId)
    // A scene in Ch 3 with only a title and a When: its card is empty (no goal, no beats).
    const vigil = (await invoke(win, 'createScene', ahead.ch3, { title: 'The keeper’s vigil' })).id
    const card = (await invoke(win, 'getScene', vigil)).card
    await invoke(win, 'updateSceneCard', vigil, { ...card, when: 'Day 5, dusk' })
    await win.reload()
    await expect(win.locator('.scene-prose')).toBeVisible()
    await areaButton(win, 'Plan').click()
    await expect(hub(win)).toHaveAttribute('data-plan-hub', 'writing')
    const next = hub(win).locator('[data-next-card]')
    await next.getByLabel('Tell it in your own words, or leave it to the AI').fill('Edric goes down to the harbour alone.')

    // ----- 1. More scenes for a chapter already written: Ch 1, after its last scene -----
    const written = line(win).locator('[data-row="written-chapters"]')
    await written.getByRole('button', { name: 'Open' }).click()
    const [ch1] = (await invoke(win, 'getOutline', storyId)).chapters
    const row1 = line(win).locator(`[data-chapter="${ch1.id}"]`)
    await row1.getByRole('button', { name: 'Add scenes to Ch 1' }).click()
    const batch1 = row1.locator('.hub-line-batch')
    await expect(batch1.getByRole('group', { name: /^Scene: / }).first()).toBeVisible({ timeout: 30_000 })
    const asked = lastAsked(fake).user
    expect(asked).toContain('Suggest the scenes of the chapter “The Night Ferry” (it is in the story already) that come after “A Letter for the Keeper” (Ch 1, Sc 2), the chapter’s last scene so far')
    expect(asked).toContain('## What the author wants (make it happen)\nEdric goes down to the harbour alone.')
    await expect(batch1).toContainText('Ch 1 · Sc 3')
    await batch1.getByRole('button', { name: /^Keep “/ }).first().click()
    await expect
      .poll(async () => {
        const o = await invoke(win, 'getOutline', storyId)
        return o.scenes.filter((s) => s.chapterId === ch1.id).map((s) => s.title)
      })
      .toEqual(['Lighting the Lamp', 'A Letter for the Keeper', 'Arrival at the docks'])

    // ----- 3. The empty cards of a chapter, filled in from the story so far -----
    await line(win).locator('[data-row="planned"]').getByRole('button', { name: 'Pick up from here' }).click()
    const row3 = line(win).locator(`[data-chapter="${ahead.ch3}"]`)
    await row3.getByRole('button', { name: 'Fill in 1 empty card' }).click()
    const vigilCard = row3.getByRole('group', { name: 'Scene: The keeper’s vigil', exact: true })
    await expect(vigilCard).toBeVisible({ timeout: 30_000 })
    await expect(vigilCard).toContainText('Ch 3 · Sc 2')
    const fill = lastAsked(fake)
    expect(fill.system.startsWith('[AIWRITE-OUTLINE v1] update fill')).toBe(true)
    expect(fill.user).toContain('### Scene: The keeper’s vigil\nWhen: Day 5, dusk\nWhat its card needs:')
    // Nothing on the card until it is kept.
    expect((await invoke(win, 'getScene', vigil)).card.goal).toBe('')
    await vigilCard.getByRole('button', { name: 'Keep “The keeper’s vigil”' }).click()
    await expect(toastWith(win, 'Filled in the card of “The keeper’s vigil”.')).toBeVisible()
    await expect.poll(async () => (await invoke(win, 'getScene', vigil)).card.goal).toBe('Put right to follow what was written: The keeper’s vigil now comes after it.')
    const filled = (await invoke(win, 'getScene', vigil)).card
    // Only what was empty: its own When stays; the beats were empty, so they are filled.
    expect(filled.when).toBe('Day 5, dusk')
    expect(filled.beats).toEqual(['They pick up where the last scene left off', 'What changed is said plainly', 'It leads on to what comes next'])
    // The card that had a goal was never asked about, and is as it was.
    expect((await invoke(win, 'getScene', ahead.drifting)).card.goal).toBe('The Board’s men hang the bell buoy off Bell Rock.')
    // Undo takes the filled parts back off.
    await toastWith(win, 'Filled in the card of').getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await invoke(win, 'getScene', vigil)).card.goal).toBe('')
    expect((await invoke(win, 'getScene', vigil)).card.when).toBe('Day 5, dusk')
    await shot(win, 'panels-light-carry-on')
  } finally {
    await fake.close()
  }
})
