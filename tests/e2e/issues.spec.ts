// The consistency checker's AI checks and the Issues tab (milestone 5), end to end against the fake AI server,
// whose check replies read the memory and the scene in the request (tests/fake-provider/m5/check.mjs: a wrong
// eye colour, a dead character speaking). The acceptance checks: a planted contradiction is caught after
// marking the scene done; Ignore hides an issue and it stays ignored after re-checking and after a restart;
// Fix the text shows a tracked change and accepting it marks the issue fixed; Update the memory changes the entry.
import type { Page } from '@playwright/test'
import type { FakeProvider } from '../fake-provider/server.mjs'
import { binder, closeWindow, createWorldFromWelcome, expect, invoke, openSettings, startFake, test, useFakeModel } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const scenePanel = (win: Page) => win.getByRole('complementary', { name: 'Scene panel' })
const issuesTab = (win: Page) => scenePanel(win).getByRole('tab', { name: /^Issues/ })
const issuesPanel = (win: Page) => scenePanel(win).getByRole('tabpanel', { name: /^Issues/ })
const issue = (win: Page, words: string | RegExp) => issuesPanel(win).getByRole('article').filter({ hasText: words })
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')
const change = (win: Page) => win.getByRole('group', { name: 'The AI’s change' })
const row = (win: Page, title: string) => binder(win).locator('[data-row]', { hasText: title }).first()

const TEXT = 'Mara pushed the door open. Mara\'s eyes were green in the firelight. "You took your time," said Tobin.'
const DEAD = 'Tobin is dead by this point in the story, but speaks here.'
const EYES = /Mara: this scene says eyes is “green”, but the memory says “blue”\./

/**
 * A world with Mara (blue eyes, in Adam's own words) and Tobin, who dies in Scene 1; Scene 2, "The tavern",
 * is open in the page, empty. The memory waits long after any change, so the only reads are the ones the
 * tests cause (marking done reads the scene at once).
 */
async function setUp(win: Page, fake: FakeProvider): Promise<{ sceneId: string; maraId: string }> {
  await createWorldFromWelcome(win, 'Lowtown')
  await useFakeModel(win, fake)
  const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara', fields: { eyes: 'blue' } })
  const tobin = await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'A ferryman.' })
  const [story] = await invoke(win, 'listStories')
  const outline = await invoke(win, 'getOutline', story.id)
  const scene = await invoke(win, 'createScene', outline.chapters[0].id, { title: 'The tavern' })
  await invoke(win, 'createChange', { kind: 'update', payload: { note: 'died in the fire' }, entryId: tobin.id, anchor: 'scene', sceneId: outline.scenes[0].id })
  await win.reload()
  await row(win, 'The tavern').click()
  await expect(row(win, 'The tavern')).toHaveAttribute('aria-selected', 'true')
  await expect(prose(win)).toBeVisible()
  return { sceneId: scene.id, maraId: mara.id }
}

/** Types the scene and marks it done (Ctrl+Enter). */
async function writeAndMarkDone(win: Page): Promise<void> {
  await prose(win).click()
  await win.keyboard.type(TEXT)
  await win.keyboard.press('Control+Enter')
  await expect(toasts(win).getByText('Scene marked done.')).toBeVisible()
}

test('marking a scene done catches a planted contradiction; Ignore keeps it ignored after re-checking and a restart; Fix the text marks it fixed', async ({
  launch
}) => {
  const fake = await startFake()
  try {
    const first = await launch({ env: { AIWRITE_KEEPER_QUIET_MS: '600000' } })
    let win = first.win
    const { sceneId } = await setUp(win, fake)
    await writeAndMarkDone(win)

    // A quiet word once the checks have run, with the way to what they found.
    const found = toasts(win).filter({ hasText: 'Found 2 things to look at in this scene.' })
    await expect(found).toBeVisible({ timeout: 30_000 })
    await found.getByRole('button', { name: 'Show' }).click()
    await expect(issuesTab(win)).toHaveAttribute('data-state', 'active')
    // The tab's count, red because one must be fixed.
    await expect(issuesTab(win)).toHaveAccessibleName('Issues 2 open, 1 must fix')

    // Must fix first: the dead character speaking, in red, with the words and what it conflicts with.
    const cards = issuesPanel(win).getByRole('article')
    await expect(cards).toHaveCount(2)
    await expect(cards.first()).toContainText('Must fix')
    await expect(cards.first()).toContainText(DEAD)
    await expect(cards.first()).toContainText('"You took your time," said Tobin.')
    await expect(cards.first().getByRole('button', { name: 'Update the memory' })).toHaveCount(0)
    // The wrong eye colour: worth a look (the memory keeper's clash with Adam's note, with the check's rewrite).
    const eyes = issue(win, EYES)
    await expect(eyes).toContainText('Worth a look')
    await expect(eyes.getByRole('button', { name: 'Update the memory' })).toBeVisible()

    // The link opens Mara beside the page; Back returns to the tab.
    await eyes.getByRole('button', { name: 'Mara', exact: true }).click()
    await expect(scenePanel(win).getByRole('button', { name: /^Back/ })).toBeVisible()
    await scenePanel(win).getByRole('button', { name: /^Back/ }).click()
    await expect(issuesTab(win)).toHaveAttribute('data-state', 'active')

    // Ignore: gone at once, never raised again.
    await issue(win, DEAD).getByRole('button', { name: 'Ignore' }).click()
    await expect(issue(win, DEAD)).toHaveCount(0)
    await expect(toasts(win).getByText('Ignored. It won’t be raised again.')).toBeVisible()
    await expect(issuesPanel(win).getByRole('button', { name: 'Show ignored (1)' })).toBeVisible()

    // Fix the text: the check's rewrite as a tracked change; nothing changes until Accept, which marks it fixed.
    await eyes.getByRole('button', { name: 'Fix the text' }).click()
    await expect(change(win)).toBeVisible()
    await expect(prose(win).locator('.aw-sugg-words')).toHaveText("Mara's eyes were blue in the firelight.")
    expect((await invoke(win, 'getScene', sceneId)).text).toContain('green')
    await change(win).getByRole('button', { name: /^Accept/ }).click()
    await expect(prose(win)).toContainText("Mara's eyes were blue in the firelight.")
    await expect(issue(win, EYES)).toHaveCount(0)
    await expect.poll(async () => (await invoke(win, 'listIssues', sceneId)).map((i) => i.status).sort()).toEqual(['fixed', 'ignored'])
    await expect(issuesPanel(win).getByRole('heading', { name: 'Nothing to look at' })).toBeVisible()

    // Checking the scene again (every check) doesn't bring the ignored one back.
    await issuesPanel(win).getByRole('button', { name: 'Check this scene' }).click()
    await expect(issuesPanel(win).getByRole('status')).toContainText('Checking…')
    await expect(issuesPanel(win).getByRole('button', { name: 'Check this scene' })).toBeVisible({ timeout: 30_000 })
    await expect(issuesPanel(win).getByRole('article')).toHaveCount(0)
    await expect(issuesPanel(win).getByRole('button', { name: 'Show ignored (1)' })).toBeVisible()
    await closeWindow(first.app)

    // After a restart it is still ignored, and checking again still doesn't raise it; Reopen brings it back.
    const second = await launch({ dataDir: first.dataDir, env: { AIWRITE_KEEPER_QUIET_MS: '600000' } })
    win = second.win
    await expect(prose(win)).toContainText('said Tobin')
    await issuesTab(win).click()
    await expect(issuesPanel(win).getByRole('heading', { name: 'Nothing to look at' })).toBeVisible()
    await issuesPanel(win).getByRole('button', { name: 'Check this scene' }).click()
    await expect(issuesPanel(win).getByRole('button', { name: 'Check this scene' })).toBeVisible({ timeout: 30_000 })
    await expect(issuesPanel(win).getByRole('article')).toHaveCount(0)
    await issuesPanel(win).getByRole('button', { name: 'Show ignored (1)' }).click()
    await expect(issuesPanel(win).getByRole('list', { name: 'Ignored' })).toContainText(DEAD)
    await issuesPanel(win).getByRole('button', { name: 'Reopen' }).click()
    await expect(issue(win, DEAD)).toBeVisible()
  } finally {
    await fake.close()
  }
})

test('Update the memory makes the text’s value Adam’s, and Undo puts it back', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch({ env: { AIWRITE_KEEPER_QUIET_MS: '600000' } })
    const { sceneId, maraId } = await setUp(win, fake)
    await writeAndMarkDone(win)
    await toasts(win).filter({ hasText: /^Found 2 things/ }).getByRole('button', { name: 'Show' }).click({ timeout: 30_000 })

    await issue(win, EYES).getByRole('button', { name: 'Update the memory' }).click()
    await expect(toasts(win).getByText('Updated Mara’s eyes in the memory to “green”.')).toBeVisible()
    await expect(issue(win, EYES)).toHaveCount(0)
    await expect.poll(async () => (await invoke(win, 'getEntry', maraId)).fields.eyes).toBe('green')
    const mara = await invoke(win, 'getEntry', maraId)
    expect(mara.fieldOrigins.eyes ?? mara.origin).toBe('adam')

    // Undo: the note as it was, and the issue back.
    await toasts(win)
      .filter({ hasText: 'Updated Mara’s eyes' })
      .getByRole('button', { name: 'Undo' })
      .click()
    await expect.poll(async () => (await invoke(win, 'getEntry', maraId)).fields.eyes).toBe('blue')
    await expect(issue(win, EYES)).toBeVisible()
    expect((await invoke(win, 'listIssues', sceneId)).filter((i) => i.status === 'open')).toHaveLength(2)

    // Settings › Models: the checks have a model of their own, the memory model's until one is chosen, and don't think.
    await openSettings(win, 'Models')
    const section = win.locator('section').filter({ has: win.getByRole('heading', { name: 'Consistency check model', exact: true }) })
    await expect(section.getByText('Same as the memory model')).toBeVisible()
    await expect(section.getByText('fake/writer', { exact: true })).toBeVisible()
    const thinking = section.getByRole('radiogroup', { name: 'Consistency check model thinking' })
    await expect(thinking.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true')
    expect((await invoke(win, 'getSettings')).thinking.check).toBe('off')
  } finally {
    await fake.close()
  }
})

test('without a model Check this scene says what to set up, and marking done says nothing', async ({ launch }) => {
  const { win } = await launch({ env: { AIWRITE_KEEPER_QUIET_MS: '600000' } })
  await createWorldFromWelcome(win, 'Lowtown')
  await prose(win).click()
  await win.keyboard.type(TEXT)
  await win.keyboard.press('Control+Enter')
  await expect(toasts(win).getByText('Scene marked done.')).toBeVisible()
  await issuesTab(win).click()
  await expect(issuesPanel(win).getByRole('heading', { name: 'Nothing to look at' })).toBeVisible()
  await issuesPanel(win).getByRole('button', { name: 'Check this scene' }).click()
  await expect(issuesPanel(win).getByText('Choose a writer model first, in Settings › Models.')).toBeVisible()
  await expect(issuesPanel(win).getByRole('button', { name: 'Open Settings' })).toBeVisible()
  await expect(toasts(win).getByText(/^Found/)).toHaveCount(0)
})

test('five tabs fit the scene panel at its narrowest, with the count over the Issues tab', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch({ env: { AIWRITE_KEEPER_QUIET_MS: '600000' } })
    await setUp(win, fake)
    await invoke(win, 'updateSettings', { layout: { inspectorWidth: 260 } })
    await win.reload()
    await expect(row(win, 'The tavern')).toHaveAttribute('aria-selected', 'true')
    await writeAndMarkDone(win)
    await expect(toasts(win).getByText(/^Found 2 things/)).toBeVisible({ timeout: 30_000 })
    const list = scenePanel(win).getByRole('tablist')
    const box = await list.boundingBox()
    expect(box!.width).toBeLessThanOrEqual(262)
    for (const name of ['Scene card', 'Context', 'Cast', /^Issues/, 'Drafts']) {
      const tab = list.getByRole('tab', { name })
      const t = await tab.boundingBox()
      expect(t!.x + t!.width).toBeLessThanOrEqual(box!.x + box!.width + 0.5)
    }
    // Overflow would show as a scroll width wider than the list.
    expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  } finally {
    await fake.close()
  }
})
