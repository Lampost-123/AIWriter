// The outline in stages and no dead ends (overhaul phase 5, 2026-10-19), on the desk (the New look) with the sample
// world, against the fake provider (tests/fake-provider/m4/outline.mjs answers "[AIWRITE-OUTLINE v1] stage <level>":
// acts with a "Chapters:" line, chapters with no scenes, a chapter's scenes, 2 for "Rain on the Narrows" and 3 for "The
// Ferryman's Price", and one scene's card, "The visitor at the gate").
//
//  1. Planned in stages: the acts first, each with about how many chapters; Plan its chapters asks for one act's
//     chapters only, which arrive under it; Plan its scenes asks for one chapter's scenes, as many as it needs. Keep goes
//     where Adam chooses in the binder (after a chapter of the story's), and the toast says where; a kept chapter with
//     its scenes offers Write this chapter, which opens Write the whole chapter for it.
//  2. No dead ends: an empty scene card offers Plan this scene (Undo puts the card back); Beat by beat with no beats
//     offers Suggest beats, then Write beat by beat; Write the whole chapter offers Plan these scenes for scenes with
//     nothing on their cards.
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, invoke, test, type LaunchOptions } from './helpers'
import type { FakeProvider } from '../fake-provider/server.mjs'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk', AIWRITE_KEEPER_QUIET_MS: '600000' }
const rooms = (win: Page) => win.getByRole('navigation', { name: 'Rooms' })
const room = (win: Page, name: string) => rooms(win).getByRole('button', { name: new RegExp(`^${name}`) })
const links = (win: Page, name: string) => win.locator('[data-desk-room]').getByRole('navigation', { name })
// The Plan hub (the outline helper since 2026-10-20), and its newest batch's head.
const outline = (win: Page) => win.locator('[data-plan-hub]')
const batchHead = (win: Page) => outline(win).locator('[data-batch-head]').first()
const toastWith = (win: Page, text: string) => win.locator('div.fixed[aria-live="polite"] > div', { hasText: text })
const group = (win: Page, kind: string, title: string) => outline(win).getByRole('group', { name: `${kind}: ${title}`, exact: true })
const spineScene = (win: Page, title: string) => win.locator('[data-desk-spine] [data-row="scene"]', { hasText: title }).first()
const dock = (win: Page) => win.getByRole('toolbar', { name: 'AI dock' })
// Write this chapter, open on its chapter's own page in Build with AI (2026-10-20; a dialog before).
const writerDialog = (win: Page) => win.locator('[data-plan-hub] [data-write-stage]')

async function fakeServer(): Promise<FakeProvider> {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  return startFakeProvider({ delayMs: 2 })
}

async function sampleWorld(
  launch: (o?: LaunchOptions) => Promise<{ app: ElectronApplication; win: Page }>,
  fake: FakeProvider
): Promise<{ app: ElectronApplication; win: Page }> {
  const a = await launch({ env: DESK })
  await expect(a.win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(a.win, 'openSampleWorld')
  const p = await invoke(a.win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
  await invoke(a.win, 'updateSettings', {
    models: { writer: { providerId: p.id, modelId: 'fake/writer', label: 'fake/writer', contextLength: 32000, promptPrice: null, completionPrice: null } }
  })
  await a.win.reload()
  await expect(a.win.locator('.scene-prose')).toContainText('A hundred and twelve steps to the lamp room.')
  return a
}

async function choose(win: Page, label: string, option: string): Promise<void> {
  await outline(win).getByRole('combobox', { name: label, exact: true }).click()
  await win.getByRole('option', { name: option, exact: true }).click()
  await expect(outline(win).getByRole('combobox', { name: label, exact: true })).toHaveText(option)
}

const lastAsked = (fake: FakeProvider): { system: string; user: string } => {
  const m = fake.lastRequest()!.body.messages as { role: string; content: string }[]
  return { system: m[0].content, user: m.filter((x) => x.role === 'user').map((x) => x.content).join('\n') }
}

test('the outline in stages: the acts, then one act’s chapters, then one chapter’s scenes; Keep goes where Adam chooses', async ({ launch }) => {
  test.setTimeout(150_000)
  const fake = await fakeServer()
  try {
    const { win } = await sampleWorld(launch, fake)
    const [story] = await invoke(win, 'listStories')
    const before = await invoke(win, 'getOutline', story.id)
    const firstChapter = before.chapters[0]
    await room(win, 'Plan').click()
    await links(win, 'Plan').getByRole('button', { name: 'Build with AI' }).click()
    await expect(outline(win)).toBeVisible()

    // ----- More of the story; how to plan: in stages, the acts first -----
    await outline(win).getByRole('group', { name: 'What to plan' }).getByRole('button', { name: 'more of the story' }).click()
    await outline(win).getByRole('radio', { name: 'In stages' }).click()
    await expect(outline(win).getByRole('radio', { name: 'In stages' })).toHaveAttribute('aria-checked', 'true')
    await expect(outline(win).getByRole('combobox', { name: 'Scenes in each chapter', exact: true })).toHaveCount(0)
    await choose(win, 'Acts', '2 acts')
    await choose(win, 'Chapters', '5 chapters')
    await expect(outline(win).locator('[data-plan-mode="stages"]')).toContainText('First the acts')
    fake.reset()
    await outline(win).locator('[data-plan-it]').click()
    await expect(batchHead(win)).toContainText('2 suggestions to keep, change or discard')
    let asked = lastAsked(fake)
    expect(asked.system.startsWith('[AIWRITE-OUTLINE v1] stage acts')).toBe(true)
    expect(asked.user).toContain('Suggest 2 acts, with about 5 chapters in all')
    await expect(outline(win).locator('[data-suggestion="act"]')).toHaveCount(2)
    await expect(outline(win).locator('[data-suggestion="chapter"]')).toHaveCount(0)
    const arrival = group(win, 'Act', 'The Arrival')
    await expect(arrival.locator('[data-stage]').first()).toContainText('About 3 chapters')

    // ----- One act's chapters only, arriving under it -----
    await outline(win).getByRole('button', { name: 'Plan its chapters: “The Arrival”' }).click()
    await expect(group(win, 'Act', 'The Arrival').locator('[data-suggestion="chapter"]')).toHaveCount(3)
    await expect(batchHead(win)).toContainText('5 suggestions to keep, change or discard')
    asked = lastAsked(fake)
    expect(asked.system.startsWith('[AIWRITE-OUTLINE v1] stage chapters')).toBe(true)
    expect(asked.user).toContain('Suggest the chapters of the act “The Arrival”: about 3 chapters')
    expect(asked.user).toContain('# Act: The Arrival (plan this one)')
    expect(asked.user).toContain('# Act: The Turning')
    await expect(arrival.locator('[data-suggestion="chapter"]')).toHaveCount(3)
    await expect(group(win, 'Act', 'The Turning').locator('[data-suggestion="chapter"]')).toHaveCount(0)
    await expect(arrival.locator('[data-suggestion="scene"]')).toHaveCount(0)

    // ----- One chapter's scenes, as many as each needs -----
    await outline(win).getByRole('button', { name: 'Plan its scenes: “Rain on the Narrows”' }).click()
    await expect(group(win, 'Chapter', 'Rain on the Narrows').locator('[data-suggestion="scene"]')).toHaveCount(2)
    await expect(batchHead(win)).toContainText('7 suggestions to keep, change or discard')
    asked = lastAsked(fake)
    expect(asked.system.startsWith('[AIWRITE-OUTLINE v1] stage scenes')).toBe(true)
    expect(asked.user).toContain('Suggest the scenes of the chapter “Rain on the Narrows”: as many as it needs')
    await outline(win).getByRole('button', { name: "Plan its scenes: “The Ferryman's Price”" }).click()
    await expect(group(win, 'Chapter', "The Ferryman's Price").locator('[data-suggestion="scene"]')).toHaveCount(3)
    await expect(batchHead(win)).toContainText('10 suggestions to keep, change or discard')
    await expect(group(win, 'Chapter', 'Rain on the Narrows').locator('[data-suggestion="scene"]')).toHaveCount(2)
    await expect(group(win, 'Chapter', "The Ferryman's Price").locator('[data-suggestion="scene"]')).toHaveCount(3)

    // ----- Keep where Adam chooses: after the story's first chapter, with its scenes -----
    const firstTitle = firstChapter.title.trim()
    await group(win, 'Chapter', 'Rain on the Narrows').locator('[data-keep-place]').first().click()
    const menu = win.getByRole('menu', { name: 'Where to keep “Rain on the Narrows”' })
    await expect(menu).toContainText('Where the outline puts it')
    await menu.getByRole('menuitem', { name: `After “${firstTitle}”` }).click()
    await expect(toastWith(win, `Added “Rain on the Narrows” to the story, with 2 scenes, after “${firstTitle}”.`)).toBeVisible()
    const after = await invoke(win, 'getOutline', story.id)
    const titles = after.chapters.map((c) => c.title)
    expect(titles.indexOf('Rain on the Narrows')).toBe(titles.indexOf(firstChapter.title) + 1)
    const rain = after.chapters.find((c) => c.title === 'Rain on the Narrows')!
    expect(rain.actId).toBeNull()
    expect(after.scenes.filter((s) => s.chapterId === rain.id)).toHaveLength(2)
    // Its suggested act stays a suggestion.
    await expect(group(win, 'Act', 'The Arrival')).toHaveAttribute('data-state', 'open')
    await expect(group(win, 'Chapter', 'Rain on the Narrows')).toHaveAttribute('data-state', 'kept')

    // ----- Its scenes kept: Write this chapter opens Write the whole chapter for it, on the chapter's own page -----
    await group(win, 'Chapter', 'Rain on the Narrows').locator('[data-write-chapter]').first().click()
    await expect(writerDialog(win)).toBeVisible()
    await expect(writerDialog(win).getByTestId('chapter-writer-plan')).toContainText('empty: will be written')
    await expect(writerDialog(win).getByTestId('chapter-writer-start')).toBeEnabled()
    await writerDialog(win).getByRole('button', { name: 'Close Write this chapter' }).click()
    await expect(writerDialog(win)).toHaveCount(0)
    // It opened on the chapter's own page: the trail goes back to the whole story, the suggestions there as they were.
    await outline(win).getByRole('navigation', { name: 'Trail' }).getByRole('button', { name: 'Whole story' }).click()

    // ----- Where the outline puts it: the act at the end, with what is still open in it -----
    await outline(win).getByRole('button', { name: 'Keep “The Arrival”', exact: true }).click()
    const done = await invoke(win, 'getOutline', story.id)
    const act = done.acts!.find((a) => a.title === 'The Arrival')!
    expect(done.chapters.filter((c) => c.actId === act.id).map((c) => c.title)).toEqual(["The Ferryman's Price", 'Lanterns at Low Tide'])
    expect(done.chapters.find((c) => c.title === 'Rain on the Narrows')!.actId).toBeNull()
  } finally {
    await fake.close()
  }
})

test('no dead ends: Plan this scene on an empty card, Suggest beats for Beat by beat, Plan these scenes for the whole chapter', async ({ launch }) => {
  test.setTimeout(150_000)
  const fake = await fakeServer()
  try {
    const { win } = await sampleWorld(launch, fake)
    const [story] = await invoke(win, 'listStories')
    const o = await invoke(win, 'getOutline', story.id)
    const empty = await invoke(win, 'createScene', o.chapters[1].id, { title: 'Scene 3' })
    await win.reload()
    await expect(win.locator('.scene-prose')).toBeVisible()
    await spineScene(win, 'Scene 3').click()

    // ----- Plan this scene: the card's empty parts filled, the scene named; Undo puts it back -----
    await win.locator('[data-scene-details]').click()
    const card = win.getByRole('tabpanel', { name: 'Scene card' })
    await expect(card.locator('[data-plan-scene]')).toHaveText('Plan this scene')
    fake.reset()
    await card.locator('[data-plan-scene]').click()
    await expect(toastWith(win, 'Planned “The visitor at the gate”: filled in the goal, beats, When')).toBeVisible()
    expect(lastAsked(fake).system.startsWith('[AIWRITE-OUTLINE v1] stage scene')).toBe(true)
    await expect.poll(async () => (await invoke(win, 'getScene', empty.id)).card.goal).toBe('A stranger at the gate asks Mara for the one thing she swore to keep.')
    const planned = await invoke(win, 'getScene', empty.id)
    expect(planned.card.beats).toHaveLength(4)
    expect(planned.card.when).toBe('Day 2, evening')
    expect(planned.title).toBe('The visitor at the gate')
    await toastWith(win, 'Planned “The visitor at the gate”').getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await invoke(win, 'getScene', empty.id)).card.goal).toBe('')
    await expect.poll(async () => (await invoke(win, 'getScene', empty.id)).title).toBe('Scene 3')
    expect((await invoke(win, 'getScene', empty.id)).card.beats).toEqual([])

    // ----- Beat by beat with no beats: Suggest beats, then Write beat by beat -----
    await dock(win).getByRole('button', { name: 'More ways to write' }).click()
    await win.getByRole('menu').getByRole('menuitem', { name: 'Beat by beat' }).click()
    await expect(win.getByRole('heading', { name: "This scene's card has no beats yet" })).toBeVisible()
    await win.locator('[data-suggest-beats]').click()
    await expect(win.getByRole('heading', { name: 'The scene card has its beats' })).toBeVisible()
    await expect(toastWith(win, 'Added 4 beats to the scene card.')).toBeVisible()
    await expect.poll(async () => (await invoke(win, 'getScene', empty.id)).card.beats.length).toBe(4)
    // Only the beats: nothing else on the card changes.
    expect((await invoke(win, 'getScene', empty.id)).card.goal).toBe('')
    await win.getByRole('button', { name: 'Write beat by beat' }).click()
    await expect(win.locator('[data-beat-bar]')).toBeVisible()

    // ----- Write the whole chapter: scenes with nothing on their cards get Plan these scenes -----
    const chapter = await invoke(win, 'createChapterAt', story.id, { actId: null, title: 'The Long Watch' })
    const scenesNow = (await invoke(win, 'getOutline', story.id)).scenes.filter((s) => s.chapterId === chapter.id)
    if (scenesNow.length < 2) await invoke(win, 'createScene', chapter.id, { title: `Scene ${scenesNow.length + 1}` })
    if (scenesNow.length < 1) await invoke(win, 'createScene', chapter.id, { title: 'Scene 2' })
    const watch = (await invoke(win, 'getOutline', story.id)).scenes.filter((s) => s.chapterId === chapter.id)
    expect(watch.length).toBeGreaterThanOrEqual(2)
    await win.reload()
    await expect(win.locator('.scene-prose')).toBeVisible()
    await win.locator('[data-desk-spine] [data-row="scene"]').filter({ hasText: watch[0].title }).last().click()
    await win.keyboard.press('Control+K')
    await win.keyboard.type('Whole chapter')
    await win.getByRole('option', { name: /^Whole chapter with AI/ }).first().click()
    await expect(writerDialog(win)).toBeVisible()
    const unplanned = writerDialog(win).getByTestId('chapter-writer-unplanned')
    await expect(unplanned).toContainText(`${watch.length} scenes have nothing on their cards to write from`)
    await expect(writerDialog(win).getByTestId('chapter-writer-start')).toBeDisabled()
    await unplanned.getByRole('button', { name: 'Plan these scenes' }).click()
    await expect(toastWith(win, `Planned ${watch.length} scenes of the chapter.`)).toBeVisible()
    await expect(unplanned).toHaveCount(0)
    await expect(writerDialog(win).getByTestId('chapter-writer-plan')).not.toContainText('nothing on its card')
    await expect(writerDialog(win).getByTestId('chapter-writer-start')).toBeEnabled()
    for (const s of watch) expect((await invoke(win, 'getScene', s.id)).card.goal).not.toBe('')
  } finally {
    await fake.close()
  }
})
