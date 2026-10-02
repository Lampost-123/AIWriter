// The story's Consistency page, end to end (milestone 5, Reports part): on a small world made through the
// API (Book 1 with twelve chapters, a word leaned on in Ch 1, a pet phrase in three chapters, a thread
// left open and one paid off with no setup) and issues written straight into world.db, the binder shows
// badges, the palette opens the page, issues show by chapter and scene and open their scene at the words,
// Ignore is undoable, the reports show and open where things are, and a check shows its progress and Stop.
//
// The issues and the checks themselves belong to the AI checks part. Where its handlers are still the
// groundwork's (listStoryIssues answering nothing), stand-ins in the main process answer from the same
// rows; checks are always stood in for, so no model is needed: they report progress and stop when asked.
import Database from 'better-sqlite3'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import type { CheckStart, Issue } from '@shared/contracts/checks'
import type { ID, SceneCard } from '@shared/types'
import { emptySceneCard } from '@shared/defaults'
import { binder, createWorldFromWelcome, expect, invoke, test } from './helpers'

const main = (win: Page) => win.locator('main')
const sceneRow = (win: Page, title: string) => binder(win).getByRole('treeitem', { name: title })
const scenePanel = (win: Page) => win.getByRole('complementary', { name: 'Scene panel' })
const selection = (win: Page) => win.evaluate<string>('String(getSelection() ?? "")')

interface Made {
  storyId: ID
  storyTitle: string
  ferry: ID
  landing: ID
  ford: ID
  chapters: ID[]
}

async function makeWorld(win: Page): Promise<Made> {
  const story = (await invoke(win, 'listStories'))[0]
  const outline = await invoke(win, 'getOutline', story.id)
  const ch1 = outline.chapters[0]
  await invoke(win, 'updateChapter', ch1.id, { title: 'Arrival' })
  const ferry = outline.scenes[0].id
  await invoke(win, 'updateScene', ferry, { title: 'The ferry' })
  const landing = (await invoke(win, 'createScene', ch1.id, { title: 'The landing', afterId: ferry })).id
  const chapters = [ch1.id]
  const firsts: ID[] = [ferry]
  for (let n = 2; n <= 12; n++) {
    const ch = await invoke(win, 'createChapter', story.id, { title: n === 2 ? 'The ford' : `Chapter ${n}` })
    chapters.push(ch.id)
    firsts.push((await invoke(win, 'createScene', ch.id, { title: n === 2 ? 'At the ford' : `Scene in chapter ${n}` })).id)
  }
  const ford = firsts[1]
  for (const name of ['Mara', 'Tobin', 'Kell', 'Ennis']) await invoke(win, 'createEntry', 'character', { name })

  const things = ['bell', 'gull', 'rope', 'wind', 'deck', 'boat', 'sail', 'lamp', 'gate']
  const leaning = things.map((t) => `Suddenly the ${t} moved.`).join(' ')
  await invoke(win, 'saveSceneText', ferry, null, `Mara looked across the water, her brown eyes half closed. She gave Tobin the ghost of a smile.\n\n${leaning}`)
  await invoke(win, 'saveSceneText', landing, null, 'Tobin spoke of the ledger as if he had always known about it.')
  await invoke(win, 'saveSceneText', ford, null, 'Kell gave her the ghost of a smile and turned away. The water runs cold here.')
  await invoke(win, 'saveSceneText', firsts[2], null, 'Ennis wore the ghost of a smile all evening.')

  const burned = (await invoke(win, 'createEntry', 'thread', { name: 'Who burned the mill?' })).id
  const lostMap = (await invoke(win, 'createEntry', 'thread', { name: 'The lost map' })).id
  await invoke(win, 'createChange', { kind: 'thread', payload: { status: 'open', note: '' }, entryId: burned, anchor: 'scene', sceneId: ferry })
  const card: Partial<SceneCard> = { paysOffIds: [lostMap] }
  await invoke(win, 'updateSceneCard', ford, { ...emptySceneCard(), ...card })
  return { storyId: story.id, storyTitle: story.title, ferry, landing, ford, chapters }
}

/** The issues the checker would have raised, as rows of world.db and as the contract has them. */
function issuesFor(m: Made): Issue[] {
  const at = (n: number) => `2026-10-02T10:00:0${n}.000Z`
  const base = { storyId: m.storyId, sources: [], fix: null, memoryFix: null, updatedAt: at(9) }
  return [
    { ...base, id: 'issue-story', sceneId: null, kind: 'thread', severity: 'warning', status: 'open', quote: '', message: 'The lost map is paid off before anything sets it up.', createdAt: at(1) },
    { ...base, id: 'issue-knows', sceneId: m.landing, kind: 'knowledge', severity: 'warning', status: 'open', quote: 'the ledger', message: 'Tobin talks about the ledger before he learns of it.', createdAt: at(2) },
    { ...base, id: 'issue-tense', sceneId: m.ford, kind: 'style', severity: 'minor', status: 'open', quote: 'The water runs cold here.', message: 'This slips into the present tense.', createdAt: at(3) },
    { ...base, id: 'issue-done', sceneId: m.ford, kind: 'voice', severity: 'minor', status: 'ignored', quote: 'turned away', message: 'Kell sounds unlike himself.', createdAt: at(4) },
    { ...base, id: 'issue-eyes', sceneId: m.ferry, kind: 'fact', severity: 'must-fix', status: 'open', quote: 'her brown eyes', message: 'Mara’s eyes are grey in the memory, but brown here.', createdAt: at(5) },
    { ...base, id: 'issue-hand', sceneId: m.ferry, kind: 'fact', severity: 'warning', status: 'open', quote: 'Mara looked across the water', message: 'Mara looks with both eyes, but lost one in Ch 1.', createdAt: at(6) }
  ] as Issue[]
}

/** Writes the issues into the open world's database, as the checker would. */
async function seedIssues(win: Page, issues: Issue[]): Promise<void> {
  const world = await invoke(win, 'getWorld')
  const db = new Database(join(world!.folder, 'world.db'))
  try {
    db.pragma('busy_timeout = 5000')
    const add = db.prepare(
      `INSERT INTO issues (id, scene_id, story_id, kind, severity, status, quote, message, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const i of issues) {
      const payload = JSON.stringify({ key: `test:${i.id}`, sources: i.sources, fix: i.fix, memoryFix: i.memoryFix })
      add.run(i.id, i.sceneId, i.storyId, i.kind, i.severity, i.status, i.quote, i.message, payload, i.createdAt, i.updatedAt)
    }
  } finally {
    db.close()
  }
}

/** Stand-ins for the AI checks part's issue handlers, answering from the same issues, while its own aren't built. */
async function standInForIssues(app: ElectronApplication, issues: Issue[]): Promise<void> {
  await app.evaluate(({ ipcMain, BrowserWindow }, list) => {
    const changed = (i: { storyId: string | null; sceneId: string | null }): void =>
      BrowserWindow.getAllWindows()[0].webContents.send('event:issues:changed', { storyId: i.storyId, sceneIds: i.sceneId ? [i.sceneId] : [] })
    const swap = (name: string, fn: (arg: never) => unknown): void => {
      ipcMain.removeHandler(`api:${name}`)
      ipcMain.handle(`api:${name}`, (_e, arg: unknown) => ({ ok: true, value: fn(arg as never) }))
    }
    const set = (id: string, status: string) => {
      const i = list.find((x) => x.id === id)!
      i.status = status as typeof i.status
      setTimeout(() => changed(i), 0)
      return i
    }
    swap('listStoryIssues', () => list)
    swap('issueCounts', () => {
      const out: Record<string, { count: number; mustFix: number }> = {}
      for (const i of list) {
        if (i.status !== 'open' || !i.sceneId) continue
        const c = (out[i.sceneId] ??= { count: 0, mustFix: 0 })
        c.count++
        if (i.severity === 'must-fix') c.mustFix++
      }
      return out
    })
    swap('ignoreIssue', (id: string) => set(id, 'ignored'))
    swap('reopenIssue', (id: string) => set(id, 'open'))
  }, issues)
}

/** Stand-ins for starting and stopping a check: they report the first scene, then wait to be stopped (or end at once for one scene). */
async function standInForChecks(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const g = globalThis as unknown as { checkStarts: CheckStart[] }
    g.checkStarts = []
    const send = (event: string, payload: unknown): void => BrowserWindow.getAllWindows()[0].webContents.send(`event:${event}`, payload)
    const swap = (name: string, fn: (arg: never) => unknown): void => {
      ipcMain.removeHandler(`api:${name}`)
      ipcMain.handle(`api:${name}`, (_e, arg: unknown) => ({ ok: true, value: fn(arg as never) }))
    }
    swap('startCheck', (input: CheckStart) => {
      g.checkStarts.push(input)
      const one = input.target.scope === 'scene'
      setTimeout(() => {
        send('checks:progress', { runId: input.runId, target: input.target, done: 0, total: one ? 1 : 3, current: 'Ch 1, Sc 1: The ferry' })
        if (one) setTimeout(() => send('checks:done', { runId: input.runId, target: input.target, status: 'complete', error: null, found: 2 }), 300)
      }, 100)
    })
    swap('stopCheck', (runId: string) => {
      const run = g.checkStarts.find((s) => s.runId === runId)
      if (run) setTimeout(() => send('checks:done', { runId, target: run.target, status: 'stopped', error: null, found: 0 }), 50)
    })
  })
}

const checkStarts = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { checkStarts: CheckStart[] }).checkStarts)

test('the Consistency page: issues by scene, the reports, badges, checking, and the palette', async ({ launch }) => {
  const { app, win } = await launch()
  await createWorldFromWelcome(win, 'Consistency')
  const m = await makeWorld(win)
  const issues = issuesFor(m)
  await seedIssues(win, issues)
  if ((await invoke(win, 'listStoryIssues', m.storyId)).length === 0) await standInForIssues(app, issues)
  await standInForChecks(app)
  // The window reads the world afresh, as if Adam had just opened it.
  await win.reload()
  await expect(win.locator('.scene-prose')).toBeVisible()

  // Badges: a count on scenes with open issues, red when one must be fixed; nothing on the others.
  await expect(sceneRow(win, 'The ferry').getByTitle('2 issues, 1 must fix')).toBeVisible()
  await expect(sceneRow(win, 'The ferry')).toHaveAccessibleName(/2 issues, 1 must fix/)
  await expect(sceneRow(win, 'The landing').getByTitle('1 issue', { exact: true })).toBeVisible()
  await expect(sceneRow(win, 'At the ford').getByTitle('1 issue', { exact: true })).toBeVisible()
  await expect(sceneRow(win, 'Scene in chapter 3').getByTitle(/issue/)).toHaveCount(0)
  // A folded chapter shows its scenes' total.
  const ch1 = binder(win).locator('[data-row="chapter"]').filter({ hasText: 'Arrival' })
  await ch1.getByRole('button', { name: 'Hide scenes' }).click()
  await expect(ch1.getByTitle('3 issues, 1 must fix')).toBeVisible()
  await ch1.getByRole('button', { name: 'Show scenes' }).click()
  await expect(ch1.getByTitle(/issue/)).toHaveCount(0)

  // The palette opens the page.
  await win.keyboard.press('Control+K')
  await win.getByRole('combobox', { name: 'Search, or find an action' }).fill('consistency')
  await expect(win.getByRole('dialog', { name: 'Search' }).getByRole('option', { name: 'Open consistency' })).toHaveAttribute('aria-selected', 'true')
  await win.keyboard.press('Enter')
  await expect(main(win).getByRole('heading', { level: 1, name: 'Consistency' })).toBeVisible()
  await expect(main(win)).toContainText(m.storyTitle)
  await expect(binder(win).getByRole('button', { name: 'Consistency', exact: true })).toHaveAttribute('aria-current', 'page')

  // Issues: the whole story first, then by chapter and scene in story order, must fix first.
  await expect(main(win).getByRole('tab', { name: /Issues/ })).toHaveAttribute('aria-selected', 'true')
  await expect(main(win).getByText('5 open issues, 1 must fix')).toBeVisible()
  const regions = main(win).getByRole('region')
  await expect(regions).toHaveText([/^The whole story/, /^Ch 1\s*Arrival/, /^Ch 2\s*The ford/])
  await expect(regions.nth(0)).toContainText('The lost map is paid off before anything sets it up.')
  const arrival = main(win).getByRole('region', { name: 'Ch 1: Arrival' })
  await expect(arrival.getByRole('heading', { level: 3 })).toHaveText(['Sc 1 · The ferry', 'Sc 2 · The landing'])
  const cards = arrival.locator('[data-issue]')
  await expect(cards).toHaveCount(3)
  await expect(cards.nth(0)).toContainText('Must fix')
  await expect(cards.nth(0)).toContainText('Mara’s eyes are grey in the memory, but brown here.')
  await expect(cards.nth(0)).toContainText('her brown eyes')
  await expect(cards.nth(1)).toContainText('Worth a look')
  // Ignored ones show only when asked.
  const ford = main(win).getByRole('region', { name: 'Ch 2: The ford' })
  await expect(ford.locator('[data-issue]')).toHaveCount(1)
  await main(win).getByLabel('Show ignored (1)').check()
  await expect(ford.locator('[data-issue]')).toHaveCount(2)
  await expect(ford.locator('[data-issue]').nth(1)).toContainText('Ignored')
  await main(win).getByLabel('Show ignored (1)').uncheck()

  // Ignore, then Undo from its toast; the badge follows.
  await main(win).locator('[data-issue="issue-knows"]').getByRole('button', { name: 'Ignore' }).click()
  await expect(win.getByText('Issue ignored. It won’t be raised again.')).toBeVisible()
  await expect(main(win).locator('[data-issue="issue-knows"]')).toHaveCount(0)
  await expect(sceneRow(win, 'The landing').getByTitle(/issue/)).toHaveCount(0)
  await win.getByRole('button', { name: 'Undo' }).click()
  await expect(main(win).locator('[data-issue="issue-knows"]')).toBeVisible()
  await expect(sceneRow(win, 'The landing').getByTitle('1 issue', { exact: true })).toBeVisible()

  // Clicking an issue opens its scene at the words, with the Issues tab.
  await cards.nth(0).getByRole('button', { name: 'Mara’s eyes are grey in the memory, but brown here.' }).click()
  await expect(win.locator('.scene-prose')).toBeVisible()
  await expect(sceneRow(win, 'The ferry')).toHaveAttribute('aria-selected', 'true')
  await expect(scenePanel(win).getByRole('tab', { name: 'Issues', selected: true })).toBeVisible()
  await expect.poll(() => selection(win)).toBe('her brown eyes')

  // Repetition: the word Ch 1 leans on, and the pet phrase across three chapters, which opens where it is first used.
  await binder(win).getByRole('button', { name: 'Consistency', exact: true }).click()
  await main(win).getByRole('tab', { name: /Repetition/ }).click()
  const byChapter = main(win).getByRole('region', { name: 'By chapter' })
  await expect(byChapter.getByRole('button', { name: 'suddenly, used 9 times' })).toBeVisible()
  await expect(byChapter).not.toContainText('Mara')
  const pets = main(win).getByRole('region', { name: 'Pet phrases' })
  await expect(pets.getByRole('listitem').filter({ hasText: 'ghost of a smile' })).toContainText('In 3 chapters, 3 times · Ch 1, Ch 2 and Ch 3')
  await pets.getByRole('button', { name: '“ghost of a smile”' }).click()
  await expect(sceneRow(win, 'The ferry')).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => selection(win)).toBe('ghost of a smile')

  // Plot threads: one open too long, one paid off with no setup, each linking to its scene and its page.
  await binder(win).getByRole('button', { name: 'Consistency', exact: true }).click()
  await expect(main(win).getByRole('tab', { name: /Repetition/ })).toHaveAttribute('aria-selected', 'true')
  await main(win).getByRole('tab', { name: /Plot threads/ }).click()
  const long = main(win).getByRole('region', { name: 'Open too long' })
  await expect(long).toContainText('Who burned the mill?')
  await expect(long).toContainText(`Open for 12 chapters, since ${m.storyTitle}, Ch 1, Sc 1`)
  const noSetup = main(win).getByRole('region', { name: 'Paid off with no setup' })
  await expect(noSetup).toContainText('The lost map')
  await noSetup.getByRole('button', { name: `${m.storyTitle}, Ch 2, Sc 1` }).click()
  await expect(sceneRow(win, 'At the ford')).toHaveAttribute('aria-selected', 'true')
  await binder(win).getByRole('button', { name: 'Consistency', exact: true }).click()
  await main(win).getByRole('button', { name: 'The lost map' }).click()
  await expect(binder(win).getByRole('button', { name: /^Plot threads\s*\d/ })).toHaveAttribute('aria-current', 'page')

  // Checking the story: facts, knowledge and timeline, with progress on the page and in the binder, and Stop.
  await binder(win).getByRole('button', { name: 'Consistency', exact: true }).click()
  await main(win).getByRole('button', { name: 'Check this story', exact: true }).click()
  await expect(main(win).getByText('Checking Ch 1, Sc 1: The ferry · 1 of 3')).toBeVisible()
  await expect(binder(win).getByRole('status', { name: 'Check running' })).toContainText('Checking Ch 1, Sc 1 · 1 of 3')
  expect((await checkStarts(app))[0]).toMatchObject({ target: { scope: 'story', id: m.storyId }, checks: ['facts', 'knowledge', 'timeline'] })
  await main(win).getByRole('button', { name: 'Stop' }).click()
  await expect(win.getByText(`Check of ${m.storyTitle} stopped.`)).toBeVisible()
  await expect(binder(win).getByRole('status', { name: 'Check running' })).toHaveCount(0)
  await expect(main(win).getByRole('button', { name: 'Check this story', exact: true })).toBeVisible()

  // Voice and style too, from the small menu.
  await main(win).getByRole('button', { name: 'More ways to check this story' }).click()
  await win.getByRole('menuitem', { name: /Voice and style too/ }).click()
  await expect(binder(win).getByRole('status', { name: 'Check running' })).toBeVisible()
  expect((await checkStarts(app))[1].checks).toEqual(['facts', 'knowledge', 'timeline', 'voice', 'style'])
  await binder(win).getByRole('button', { name: 'Stop the check' }).click()
  await expect(binder(win).getByRole('status', { name: 'Check running' })).toHaveCount(0)

  // Checking one scene from its row menu runs every check; when it ends, its toast offers the page.
  await sceneRow(win, 'The landing').click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Check this scene' }).click()
  await expect(win.getByText('Checked Ch 1, Sc 2. 2 new issues.')).toBeVisible()
  expect((await checkStarts(app))[2]).toMatchObject({ target: { scope: 'scene', id: m.landing }, checks: ['facts', 'knowledge', 'timeline', 'voice', 'style'] })
})
