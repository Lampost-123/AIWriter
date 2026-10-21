// The calm overhaul (Adam, 2026-10-19: the app is "annoying and frustrating"), end to end against the fake AI server:
// - one Check in the top bar: Check this scene opens the one Issues list beside the page, in sections (Slips, Questions,
//   Craft notes, Plot threads, Memory) with filters, the critic's notes among them (no Critique tab any more);
// - one note per draft: what the draft, check and repair and the live checks have to say, in one message;
// - plain waits: the status line names each step before the first word ("Catching up the memory…", "Planning the
//   scene…", "Writing…");
// - a check that waits for the memory says so at once, and Check now goes ahead;
// - refusals: a scene the memory model turned down shows in Issues › Memory with Try again and another of Adam's models;
//   a refused draft offers one click to try again with another model he has set up.
// The fake provider's refusal models: fake/refuse (a content filter), fake/wait (holds its words back, as a thinking
// model does). All text is invented.
import type { Page } from '@playwright/test'
import type { FakeProvider } from '../fake-provider/server.mjs'
import { binder, createWorldFromWelcome, expect, invoke, startFake, test, useFakeModel } from './helpers'

test.use({ smartPunctuation: false })

const prose = (win: Page) => win.locator('.scene-prose')
const scenePanel = (win: Page) => win.getByRole('complementary', { name: 'Scene panel' })
const issuesPanel = (win: Page) => scenePanel(win).getByRole('tabpanel', { name: /^Issues/ })
const section = (win: Page, id: string) => issuesPanel(win).locator(`[data-issue-section="${id}"]`)
const filter = (win: Page, id: string) => issuesPanel(win).locator(`[data-filter="${id}"]`)
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"] [data-toast]:not([data-leaving])')
const row = (win: Page, title: string) => binder(win).locator('[data-row]', { hasText: title }).first()
const checkButton = (win: Page) => win.locator('[data-check-button]')

const TEXT = 'Mara pushed the door open. Mara\'s eyes were green in the firelight. "You took your time," said Tobin.'
const DEAD = 'Tobin is dead by this point in the story, but speaks here.'
const EYES = /Mara’s eyes: this scene says “green”, but the memory says “blue”\./

/** A model of the fake server's, as Settings › Models keeps it. */
const model = (providerId: string, modelId: string) => ({ providerId, modelId, label: modelId, contextLength: 32000, promptPrice: null, completionPrice: null })

/** The fake server's provider, as saved by useFakeModel. */
async function providerId(win: Page): Promise<string> {
  const p = (await invoke(win, 'listProviders')).find((x) => x.name === 'Fake')
  if (!p) throw new Error('No fake provider')
  return p.id
}

/**
 * A world with Mara (blue eyes, in Adam's own words) and Tobin, who dies in Scene 1; Scene 2, "The tavern", open in the
 * page with words that disagree with both.
 */
async function tavern(win: Page, fake: FakeProvider): Promise<{ sceneId: string; storyId: string }> {
  await createWorldFromWelcome(win, 'Lowtown')
  await useFakeModel(win, fake)
  await invoke(win, 'createEntry', 'character', { name: 'Mara', fields: { eyes: 'blue' } })
  const tobin = await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'A ferryman.' })
  const [story] = await invoke(win, 'listStories')
  const outline = await invoke(win, 'getOutline', story.id)
  const scene = await invoke(win, 'createScene', outline.chapters[0].id, { title: 'The tavern' })
  await invoke(win, 'createChange', { kind: 'update', payload: { note: 'died in the fire' }, entryId: tobin.id, anchor: 'scene', sceneId: outline.scenes[0].id })
  await invoke(win, 'saveSceneText', scene.id, null, TEXT)
  await win.reload()
  await row(win, 'The tavern').click()
  await expect(prose(win)).toContainText('said Tobin')
  return { sceneId: scene.id, storyId: story.id }
}

test('the top bar’s Check opens one Issues list in sections, with filters and the critic’s notes among them', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch({ env: { AIWRITE_KEEPER_QUIET_MS: '600000' } })
    const { sceneId } = await tavern(win, fake)

    // One Check, in the top bar: this scene, this chapter or the whole story.
    await checkButton(win).click()
    const menu = win.getByRole('menu', { name: 'Check' })
    await expect(menu.getByRole('menuitem', { name: /^Check this scene/ })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /^Check this chapter/ })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /^Check the whole story/ })).toBeVisible()
    await expect(menu.getByRole('menuitemcheckbox', { name: /^Craft notes too/ })).toHaveAttribute('aria-checked', 'false')
    await menu.getByRole('menuitem', { name: /^Check this scene/ }).click()

    // The scene's Issues list opens beside the page at once, and says how the check goes.
    await expect(scenePanel(win).getByRole('tab', { name: /^Issues/ })).toHaveAttribute('data-state', 'active')
    await expect(issuesPanel(win).getByRole('button', { name: 'Check this scene' })).toBeVisible({ timeout: 30_000 })

    // One list, in sections: the dead man speaking is a slip; the eye colour (the text or Adam's note?) a question.
    await expect(section(win, 'slips').getByRole('heading', { name: /^Slips/ })).toBeVisible()
    await expect(section(win, 'slips').getByRole('article').filter({ hasText: DEAD })).toBeVisible()
    await expect(section(win, 'questions').getByRole('article').filter({ hasText: EYES })).toBeVisible()
    await expect(issuesPanel(win)).toContainText(/1 slip · 1 question/)
    await expect(filter(win, 'slips')).toContainText('1')

    // The filters show one section at a time.
    await filter(win, 'questions').click()
    await expect(filter(win, 'questions')).toHaveAttribute('aria-pressed', 'true')
    await expect(section(win, 'slips')).toHaveCount(0)
    await expect(section(win, 'questions').getByRole('article')).toHaveCount(1)
    await filter(win, 'memory').click()
    await expect(section(win, 'memory')).toContainText('The memory has read this scene and is sure of what it found.')

    // The critic is the list's Craft notes now: no Critique tab of its own.
    await expect(scenePanel(win).getByRole('tab', { name: 'Critique' })).toHaveCount(0)
    await filter(win, 'craft').click()
    await expect(issuesPanel(win).getByRole('button', { name: 'Critique scene' })).toBeVisible()
    await filter(win, 'all').click()
    await expect(section(win, 'slips')).toBeVisible()

    // Craft notes too: the next check has the critic read the scene as well, and its notes join the list.
    await checkButton(win).click()
    await win.getByRole('menu', { name: 'Check' }).getByRole('menuitemcheckbox', { name: /^Craft notes too/ }).click()
    await expect(win.getByRole('menu', { name: 'Check' }).getByRole('menuitemcheckbox', { name: /^Craft notes too/ })).toHaveAttribute('aria-checked', 'true')
    await win.getByRole('menu', { name: 'Check' }).getByRole('menuitem', { name: /^Check this scene/ }).click()
    await expect(section(win, 'craft').locator('[data-craft-summary]')).toContainText(/notes? from the critic/, { timeout: 30_000 })
    await expect.poll(async () => (await invoke(win, 'getCritique', { scope: 'scene', id: sceneId }))?.critique.notes.length ?? 0).toBeGreaterThan(0)
    await section(win, 'craft').getByRole('button', { name: 'Show' }).click()
    await expect(filter(win, 'craft')).toHaveAttribute('aria-pressed', 'true')
    await expect(issuesPanel(win).getByRole('region', { name: 'Critique' })).toBeVisible()
  } finally {
    await fake.close()
  }
})

test('the desk: Check sits in the top bar beside Scene details, and its list is the drawer’s Issues', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch({ env: { AIWRITE_ARRANGEMENT: 'desk', AIWRITE_KEEPER_QUIET_MS: '600000' } })
    await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
    await invoke(win, 'openSampleWorld')
    await useFakeModel(win, fake)
    const bar = win.locator('[data-desk-topbar]')
    await expect(bar.locator('[data-check-button]')).toBeVisible()
    await bar.locator('[data-check-button]').click()
    await win.getByRole('menu', { name: 'Check' }).getByRole('menuitem', { name: /^Check this scene/ }).click()
    const drawer = win.locator('aside.desk-drawer')
    await expect(drawer.getByRole('tab', { name: /^Issues/ })).toHaveAttribute('data-state', 'active')
    await expect(drawer.getByRole('tabpanel', { name: /^Issues/ }).getByRole('button', { name: 'Check this scene' })).toBeVisible({ timeout: 30_000 })
    // The critic's notes are the list's Craft notes, on the desk too.
    await expect(drawer.getByRole('tab', { name: 'Critique' })).toHaveCount(0)
    await drawer.locator('[data-filter="craft"]').click()
    await drawer.getByRole('button', { name: 'Critique scene' }).click()
    const cards = drawer.getByRole('region', { name: 'Critique' }).getByRole('article')
    await expect(cards).toHaveCount(2, { timeout: 30_000 })
  } finally {
    await fake.close()
  }
})

test('one note per draft: what check and repair found is said in the same message as the draft', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch({ env: { AIWRITE_REPAIR: 'on', AIWRITE_KEEPER_QUIET_MS: '600000', AIWRITE_AFTER_DRAFT_MS: '600000' } })
    await createWorldFromWelcome(win, 'Harbour')
    await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the ferry.' })
    await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'A ferryman.' })
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    await invoke(win, 'saveSceneText', sceneId, null, 'Mara took off her hood. Tobin left for the docks.')
    await useFakeModel(win, fake)

    // Add below: the draft below a scene break slips twice; each slip is asked about (repair.spec.ts).
    await win.locator('main header').getByRole('button', { name: 'Draft the scene', exact: true }).click()
    await win.getByRole('button', { name: 'Add below', exact: true }).click()
    const note = toasts(win).filter({ hasText: /^2 questions in Issues/ })
    await expect(note).toBeVisible({ timeout: 60_000 })
    // One message for the draft, never one for each thing said.
    await expect(toasts(win).filter({ hasText: /questions about the new words|underlined in the new draft|is finished/ })).toHaveCount(0)
    // The row under the draft says "Draft written"; the note gives only the news.
    await expect(toasts(win).filter({ hasText: /questions in Issues/ })).toHaveCount(1)
    // Its button goes to the questions.
    await note.getByRole('button', { name: 'Show' }).click()
    await expect(section(win, 'questions').getByRole('article')).toHaveCount(2)
  } finally {
    await fake.close()
  }
})

test('plain waits: the status line names each step before the first word', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 2, waitMs: 2500 })
  try {
    const { win } = await launch({ env: { AIWRITE_KEEPER_QUIET_MS: '600000', AIWRITE_PLAN: 'on' } })
    await createWorldFromWelcome(win, 'Harbour')
    await useFakeModel(win, fake)
    // The memory (and the plan, which is the memory model's) takes its time, as a thinking model does.
    await invoke(win, 'updateSettings', { models: { memory: model(await providerId(win), 'fake/wait') } })
    const [story] = await invoke(win, 'listStories')
    const outline = await invoke(win, 'getOutline', story.id)
    // Scene 1 has words the memory hasn't read; Scene 2 is drafted.
    await invoke(win, 'saveSceneText', outline.scenes[0].id, null, 'Mara crossed the quay. The ferry was late.')
    await invoke(win, 'createScene', outline.chapters[0].id, { title: 'The crossing' })
    await win.reload()
    await row(win, 'The crossing').click()
    await expect(prose(win)).toBeVisible()

    // Every status the line shows is written down as it shows.
    // (A string, as the app tests' own TypeScript has no window: tests/e2e run in Node.)
    await win.evaluate(`(() => {
      const seen = []
      window.seenStatus = seen
      const header = document.querySelector('main header')
      new MutationObserver(() => {
        for (const el of header.querySelectorAll('[role="status"] .truncate')) {
          const t = el.textContent || ''
          if (t && seen[seen.length - 1] !== t) seen.push(t)
        }
      }).observe(header, { subtree: true, childList: true, characterData: true })
    })()`)
    await win.locator('main header').getByRole('button', { name: 'Draft the scene', exact: true }).click()
    await expect(prose(win)).toContainText('The rain had not let up', { timeout: 60_000 })
    const seen = await win.evaluate<string[]>('window.seenStatus')
    // The memory catching up with the scene before, then planning, then writing: never a bare "Getting ready…" all along.
    // (The scene header has little room: its words are the short ones, "Updating memory…", the full ones on hover.)
    const at = (re: RegExp): number => seen.findIndex((t) => re.test(t))
    const memory = /^(Catching up the memory|Updating memory…|Memory: \d+ of \d+)/
    expect(at(memory)).toBeGreaterThanOrEqual(0)
    expect(at(/^Planning the scene…$/)).toBeGreaterThan(at(memory))
    expect(at(/^Writing…$/)).toBeGreaterThan(at(/^Planning the scene…$/))
  } finally {
    await fake.close()
  }
})

test('a check waiting for the memory says so at once, and Check now goes ahead', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 2, waitMs: 6000 })
  try {
    const { win } = await launch({ env: { AIWRITE_KEEPER_QUIET_MS: '600000' } })
    await tavern(win, fake)
    // The memory takes its time reading the scene; the check itself is quick.
    const p = await providerId(win)
    await invoke(win, 'updateSettings', { models: { memory: model(p, 'fake/wait'), check: model(p, 'fake/writer') } })

    await checkButton(win).click()
    await win.getByRole('menu', { name: 'Check' }).getByRole('menuitem', { name: /^Check this scene/ }).click()
    const progress = issuesPanel(win).locator('[data-check-progress]')
    await expect(progress).toContainText('Waiting for the memory to catch up', { timeout: 10_000 })
    // The top bar's Check says it too.
    await expect(checkButton(win)).toHaveAttribute('aria-label', /Waiting for the memory/)
    await issuesPanel(win).getByRole('button', { name: 'Check now' }).click()
    await expect(issuesPanel(win).getByRole('button', { name: 'Check this scene' })).toBeVisible({ timeout: 30_000 })
    await expect(section(win, 'slips').getByRole('article').filter({ hasText: DEAD })).toBeVisible()
  } finally {
    await fake.close()
  }
})

test('a scene the memory model turns down shows in Issues › Memory, with Try again and another of Adam’s models', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch({ env: { AIWRITE_KEEPER_QUIET_MS: '600000' } })
    await createWorldFromWelcome(win, 'Harbour')
    await useFakeModel(win, fake)
    const p = await providerId(win)
    await invoke(win, 'updateSettings', { models: { memory: model(p, 'fake/refuse') } })
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    await invoke(win, 'saveSceneText', sceneId, null, 'Mara and Tobin, upstairs, as the storm came in.')
    await win.reload()
    await expect(prose(win)).toContainText('upstairs')
    await invoke(win, 'updateMemoryNow', sceneId)
    await expect.poll(async () => (await invoke(win, 'memoryRefusal', sceneId))?.kind ?? null, { timeout: 30_000 }).toBe('read')

    // The Issues list's Memory section says so, with the two ways on (the top bar's Check › Show the issues).
    await checkButton(win).click()
    await win.getByRole('menu', { name: 'Check' }).getByRole('menuitem', { name: /^Show the issues/ }).click()
    await expect(scenePanel(win).getByRole('tab', { name: /^Issues/ })).toHaveAttribute('data-state', 'active')
    const note = section(win, 'memory').locator('[data-memory-note="refused"]')
    await expect(note).toContainText('The memory model (fake/refuse) turned this scene down')
    await expect(filter(win, 'memory')).toContainText('1')
    await expect(note.getByRole('button', { name: 'Try again' })).toBeVisible()

    // Try again asks once more (and is turned down once more).
    await note.getByRole('button', { name: 'Try again' }).click()
    await expect(toasts(win).filter({ hasText: 'Trying again. The memory is reading this scene.' })).toBeVisible()
    await expect.poll(async () => (await invoke(win, 'memoryRefusal', sceneId))?.kind ?? null, { timeout: 30_000 }).toBe('read')

    // Another of Adam's models (his writer model) reads it, and becomes the memory model, with Undo.
    await note.getByRole('button', { name: 'Use fake/writer for the memory' }).click()
    await expect(toasts(win).filter({ hasText: 'The memory now uses fake/writer. It is reading this scene.' })).toBeVisible()
    await expect.poll(async () => (await invoke(win, 'getSettings')).models.memory?.modelId).toBe('fake/writer')
    await expect.poll(async () => invoke(win, 'memoryRefusal', sceneId), { timeout: 30_000 }).toBeNull()
    await expect(section(win, 'memory').locator('[data-memory-note]')).toHaveCount(0, { timeout: 30_000 })
  } finally {
    await fake.close()
  }
})

test('a refused draft offers one click to try again with another model Adam has set up', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch({ env: { AIWRITE_KEEPER_QUIET_MS: '600000' } })
    await createWorldFromWelcome(win, 'Harbour')
    await useFakeModel(win, fake, 'fake/refuse')
    // His chat model is another he has set up.
    await invoke(win, 'updateSettings', { models: { chat: model(await providerId(win), 'fake/writer') } })
    await win.reload()
    await expect(prose(win)).toBeVisible()

    await win.locator('main header').getByRole('button', { name: 'Draft the scene', exact: true }).click()
    const note = toasts(win).filter({ hasText: /refused|turned .* down/ })
    await expect(note).toBeVisible({ timeout: 30_000 })
    await expect(toasts(win)).toHaveCount(1)
    await note.getByRole('button', { name: 'Try with fake/writer' }).click()
    await expect(prose(win)).toContainText('The rain had not let up', { timeout: 30_000 })
    // That one draft only: the writer model is still the one Adam chose.
    expect((await invoke(win, 'getSettings')).models.writer?.modelId).toBe('fake/refuse')
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId)).map((g) => g.modelId)).toContain('fake/writer')
  } finally {
    await fake.close()
  }
})

test('panels: the corner messages keep clear of the receipt at the foot of the page, in a small window too', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { app, win } = await launch({
      env: { AIWRITE_PLAN: 'on', AIWRITE_REPAIR: 'on', AIWRITE_CONTRACT: 'on', AIWRITE_KEEPER_QUIET_MS: '600000', AIWRITE_AFTER_DRAFT_MS: '600000' }
    })
    await createWorldFromWelcome(win, 'Harbour')
    const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the ferry.' })
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    const card = (await invoke(win, 'getScene', sceneId)).card
    await invoke(win, 'updateSceneCard', sceneId, { ...card, povId: mara.id, presentIds: [mara.id], beats: ['Mara waits in the tavern.'], targetWords: 600 })
    await useFakeModel(win, fake)
    await app.evaluate(({ BrowserWindow }) => {
      const b = BrowserWindow.getAllWindows()[0]
      b.unmaximize()
      b.setContentSize(1024, 700)
    })
    await expect.poll(() => win.evaluate('innerWidth')).toBe(1024)
    // A draft with a direction, part of which doesn't land: the receipt at the foot of the page.
    await win.getByRole('button', { name: 'Draft options' }).click()
    await win.getByLabel('Direction for this draft (optional)').fill('Mara counts the doors from the corner. More dialogue.')
    await win.keyboard.press('Escape')
    await win.locator('main header').getByRole('button', { name: 'Draft the scene', exact: true }).click()
    const receipt = win.locator('[data-page-foot] [data-direction-receipt]')
    await expect(receipt).toHaveAttribute('data-direction-receipt', 'missing', { timeout: 60_000 })
    // A message in the corner meanwhile (a check of the whole story ends with one).
    await checkButton(win).click()
    await win.getByRole('menu', { name: 'Check' }).getByRole('menuitem', { name: /^Check the whole story/ }).click()
    const note = toasts(win).filter({ hasText: /^Checked Book 1/ })
    await expect(note).toBeVisible({ timeout: 30_000 })
    await expect(receipt).toBeVisible()
    // Wholly above the receipt's band: never over the pill.
    await expect
      .poll(async () => {
        const t = (await note.boundingBox())!
        const r = (await receipt.boundingBox())!
        return t.y + t.height <= r.y
      })
      .toBe(true)
  } finally {
    await fake.close()
  }
})
