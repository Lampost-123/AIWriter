// Drafts and history (milestone 4): every AI change, Mark done and writing keep a version of the scene;
// the History page compares one with the scene now and restores it (Ctrl+Z takes it back); the Drafts
// tab keeps a scene's drafts, one of them in the page; and a damaged or unreachable history.db never stops
// a world opening.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { closeWindow, createWorldFromWelcome, expect, invoke, startFake, test, useFakeModel } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')
const toast = (win: Page, text: string) => toasts(win).locator('> div', { hasText: text })
const header = (win: Page) => win.locator('main header')
const generateButton = (win: Page) => header(win).getByRole('button', { name: 'Generate', exact: true })
const historyButton = (win: Page) => header(win).getByRole('button', { name: 'History of this scene', exact: true })
const versions = (win: Page) => win.getByRole('navigation', { name: 'Earlier versions' })
const comparison = (win: Page) => win.getByRole('region', { name: 'Comparison' })
const draftsTab = (win: Page) => win.getByRole('tabpanel', { name: 'Drafts' })
const draftRow = (win: Page, name: string) =>
  draftsTab(win)
    .getByRole('listitem')
    .filter({ has: win.getByText(name, { exact: true }) })

const FIRST = 'The rain had not stopped since dawn, and Mara waited by the door.'
const SECOND = 'Tobin came late, his coat dark with water.'
const UNREACHABLE = /^Earlier versions can't be reached right now/

async function firstScene(win: Page): Promise<string> {
  const [story] = await invoke(win, 'listStories')
  const { scenes } = await invoke(win, 'getOutline', story.id)
  return scenes[0].id
}

const savedText = async (win: Page, sceneId: string): Promise<string> => (await invoke(win, 'getScene', sceneId)).text
const labels = async (win: Page, sceneId: string): Promise<string[]> =>
  (await invoke(win, 'listSnapshots', sceneId)).snapshots.map((s) => s.label)

test('writing, Mark done and a draft each keep a version; History shows the newest that differs beside the scene now, restores it, and Ctrl+Z takes it back', async ({
  launch
}) => {
  const fake = await startFake()
  try {
    // Writing keeps a version every 10 minutes; here every 1.5 seconds.
    const { win } = await launch({ env: { AIWRITE_HISTORY_WRITING_MS: '1500' } })
    await createWorldFromWelcome(win, 'Alpha')
    await useFakeModel(win, fake)
    const sceneId = await firstScene(win)

    // Nothing kept yet: the History page says what it will hold.
    await historyButton(win).click()
    await expect(win.getByRole('heading', { level: 1, name: 'History' })).toBeVisible()
    await expect(win.getByRole('heading', { name: 'No earlier versions yet' })).toBeVisible()
    await win.getByRole('button', { name: 'Back to writing' }).click()

    // The scene's first save keeps a version, and writing on keeps another.
    await prose(win).click()
    await win.keyboard.type(FIRST)
    await expect.poll(() => savedText(win, sceneId)).toBe(FIRST)
    await expect.poll(() => labels(win, sceneId)).toEqual(['While writing'])
    await win.waitForTimeout(1600)
    await prose(win).click()
    await win.keyboard.press('Control+End')
    await win.keyboard.press('Enter')
    await win.keyboard.type(SECOND)
    await expect.poll(() => savedText(win, sceneId)).toBe(`${FIRST}\n\n${SECOND}`)
    await expect.poll(() => labels(win, sceneId)).toEqual(['While writing', 'While writing'])

    // Marked done: the same text isn't kept twice, so the newest version now says it was marked done.
    await win.keyboard.press('Control+Enter')
    await expect(toasts(win).getByText('Scene marked done.')).toBeVisible()
    await expect.poll(() => labels(win, sceneId)).toEqual(['Marked done', 'While writing'])

    // A new draft from the AI takes the text's place. The scene just before it is that version, now linked to the draft.
    await generateButton(win).click()
    await win.getByRole('button', { name: 'Replace it', exact: true }).click()
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId))[0]?.status).toBe('complete')
    const [draft] = await invoke(win, 'listGenerations', sceneId)
    await expect.poll(async () => (await savedText(win, sceneId)).startsWith(FIRST)).toBe(false)
    const aiText = await savedText(win, sceneId)
    const done = (await invoke(win, 'listSnapshots', sceneId)).snapshots.find((s) => s.label === 'Marked done')!
    expect(done).toMatchObject({ kind: 'done', generationId: draft.id })
    expect((await invoke(win, 'getSnapshot', done.id)).text).toBe(`${FIRST}\n\n${SECOND}`)

    // History, from the scene's toolbar: the newest version that differs from the scene now comes first, with
    // What the AI saw for the draft that came after it.
    await historyButton(win).click()
    await expect(win.getByRole('heading', { level: 1, name: 'History' })).toBeVisible()
    await expect(comparison(win).getByRole('heading', { name: 'Marked done' })).toBeVisible()
    await expect(comparison(win).getByRole('button', { name: /What the AI saw/ })).toBeVisible()
    await expect(comparison(win).getByText(/^\d+ paragraphs? differs?\. The words that differ are marked\.$/)).toBeVisible()
    // The draft took the place of all of it: the two read side by side, both from the top.
    await expect(comparison(win).locator('[data-side="then"]').first()).toContainText(FIRST)
    await expect(comparison(win).locator('[data-side="then"]').first()).toContainText(SECOND)
    await expect(comparison(win).locator('[data-side="now"]').first()).toContainText(aiText.split('\n\n')[0])

    // The version from the scene's first save, compared with the AI's draft now in the scene.
    const firstSave = versions(win)
      .getByRole('button', { name: /While writing/ })
      .last()
    await firstSave.click()
    await expect(comparison(win).getByRole('heading', { name: 'While writing' })).toBeVisible()
    // The scene now has none of that version's paragraph, so all of it is marked.
    await expect(comparison(win).locator('mark', { hasText: FIRST })).toBeVisible()
    // The arrow keys move through the list.
    await firstSave.focus()
    await win.keyboard.press('Home')
    await expect(versions(win).getByRole('button').first()).toHaveAttribute('aria-current', 'true')
    await win.keyboard.press('End')
    await expect(firstSave).toHaveAttribute('aria-current', 'true')
    await expect(comparison(win).getByRole('heading', { name: 'While writing' })).toBeVisible()

    // Restore: back on the writing page with that version in the scene, saved; the scene as it was is kept first.
    await comparison(win).getByRole('button', { name: 'Restore this version' }).click()
    await expect(prose(win)).toBeVisible()
    await expect(prose(win).locator('p')).toHaveText([FIRST])
    await expect(toasts(win).getByText(/^The version from today at .+ is back in the scene\. Ctrl\+Z takes it out again\.$/)).toBeVisible()
    await expect.poll(() => savedText(win, sceneId)).toBe(FIRST)
    await expect.poll(async () => (await labels(win, sceneId))[0]).toBe('Before restoring')

    // Ctrl+Z takes the restore back: the AI's draft is the scene's text again.
    await win.keyboard.press('Control+z')
    await expect.poll(() => savedText(win, sceneId)).toBe(aiText)
    await expect(prose(win)).not.toContainText(FIRST)

    // The version kept before restoring is the scene now, and the list says so; the page opens on one that differs.
    await historyButton(win).click()
    await expect(versions(win).getByRole('button', { name: /Before restoring/ })).toContainText('Same as now')
    await expect(comparison(win).getByText(/^\d+ paragraphs? differs?\./)).toBeVisible()
    await expect(comparison(win).getByRole('heading', { name: 'Before restoring' })).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

test('a version with the same words in other formatting says so, and can still be restored', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  const sceneId = await firstScene(win)
  await prose(win).click()
  await win.keyboard.type(FIRST)
  await expect.poll(() => savedText(win, sceneId)).toBe(FIRST)
  await expect.poll(() => labels(win, sceneId)).toEqual(['While writing'])

  // The same words, all in italics now.
  await win.keyboard.press('Control+a')
  await win.keyboard.press('Control+i')
  await expect(prose(win).locator('em')).toHaveText(FIRST)
  await expect.poll(async () => JSON.stringify((await invoke(win, 'getScene', sceneId)).doc)).toContain('italic')

  await historyButton(win).click()
  await expect(comparison(win).getByRole('heading', { name: 'While writing' })).toBeVisible()
  await expect(
    comparison(win).getByText('The words are the same as the scene now. Only the formatting or line breaks differ.')
  ).toBeVisible()
  await expect(versions(win).getByRole('button', { name: /While writing/ })).not.toContainText('Same as now')
  await comparison(win).getByRole('button', { name: 'Restore this version' }).click()
  await expect(prose(win).locator('p')).toHaveText([FIRST])
  await expect(prose(win).locator('em')).toHaveCount(0)
  await expect.poll(async () => JSON.stringify((await invoke(win, 'getScene', sceneId)).doc)).not.toContain('italic')
})

test('drafts: New draft keeps the text as Draft 1 and its Undo never loses what was written in the copy; switching, Ctrl+Z, rename and delete with Undo', async ({
  launch
}) => {
  const { app, win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  const sceneId = await firstScene(win)

  // An empty scene has nothing to start a draft from yet, and says so.
  await win.getByRole('tab', { name: 'Drafts' }).click()
  await expect(draftsTab(win).getByText('No drafts yet')).toBeVisible()
  await expect(draftsTab(win).getByText(/^Drafts start once the scene has words/)).toBeVisible()
  await expect(draftsTab(win).getByRole('button', { name: 'New draft' })).toHaveCount(0)

  await prose(win).click()
  await win.keyboard.type(FIRST)
  await expect.poll(() => savedText(win, sceneId)).toBe(FIRST)

  // New draft keeps this text as Draft 1 and goes on in a copy, Draft 2.
  const copied = 'Draft 2 is a copy of Draft 1 to work on. Draft 1 is kept as it was.'
  await draftsTab(win).getByRole('button', { name: 'New draft' }).click()
  await expect(toasts(win).getByText(copied)).toBeVisible()
  await expect(draftRow(win, 'Draft 2')).toContainText('In the page')
  await expect(draftRow(win, 'Draft 2')).toContainText('Started just now')
  await expect(draftRow(win, 'Draft 1')).toContainText(FIRST)
  await expect(prose(win).locator('p')).toHaveText([FIRST])

  // Undo straight away: the copy goes, and Draft 1 is the draft in the page again.
  await toast(win, copied).getByRole('button', { name: 'Undo' }).click()
  await expect(draftsTab(win).getByText('No drafts yet')).toBeVisible()
  expect((await invoke(win, 'listDrafts', sceneId)).drafts.map((d) => [d.name, d.current])).toEqual([['Draft 1', true]])
  await expect(prose(win).locator('p')).toHaveText([FIRST])

  // Again, but Draft 2 is rewritten before Undo: it is kept with its changes, and Draft 1 goes back in the page.
  await draftsTab(win).getByRole('button', { name: 'New draft' }).click()
  await expect(draftRow(win, 'Draft 2')).toContainText('In the page')
  await expect(draftRow(win, 'Draft 1')).toContainText('Kept just now')
  await prose(win).click()
  await win.keyboard.press('Control+a')
  await win.keyboard.type(SECOND)
  await expect.poll(() => savedText(win, sceneId)).toBe(SECOND)
  await toast(win, copied).getByRole('button', { name: 'Undo' }).click()
  await expect(
    toasts(win).getByText("Back to Draft 1. Draft 2 has changes, so it's kept as a draft too; Ctrl+Z switches back to it.")
  ).toBeVisible()
  await expect(prose(win).locator('p')).toHaveText([FIRST])
  await expect(draftRow(win, 'Draft 1')).toContainText('In the page')
  // It began with the scene, not just now.
  await expect(draftRow(win, 'Draft 1')).toContainText("The scene's first draft")
  await expect(draftRow(win, 'Draft 2')).toContainText(SECOND)
  await expect.poll(() => savedText(win, sceneId)).toBe(FIRST)

  // Ctrl+Z switches back to Draft 2, and Ctrl+Shift+Z to Draft 1 again; the drafts follow.
  await win.keyboard.press('Control+z')
  await expect(prose(win).locator('p')).toHaveText([SECOND])
  await expect(draftRow(win, 'Draft 2')).toContainText('In the page')
  await expect.poll(() => savedText(win, sceneId)).toBe(SECOND)
  await win.keyboard.press('Control+Shift+z')
  await expect(prose(win).locator('p')).toHaveText([FIRST])
  await expect(draftRow(win, 'Draft 1')).toContainText('In the page')

  // Switching puts Draft 2 in the page (and the scene's text, the only one the memory reads); Draft 1 is kept.
  await draftsTab(win).getByRole('button', { name: 'Switch to Draft 2' }).click()
  await expect(prose(win).locator('p')).toHaveText([SECOND])
  await expect(toasts(win).getByText('Switched to Draft 2. Draft 1 is kept as it was; Ctrl+Z switches back.')).toBeVisible()
  await expect(draftRow(win, 'Draft 2')).toContainText('In the page')
  await expect(draftRow(win, 'Draft 1')).toContainText(FIRST)
  await expect.poll(() => savedText(win, sceneId)).toBe(SECOND)
  expect(await labels(win, sceneId)).toContain('Before switching drafts')
  await win.keyboard.press('Control+z')
  await expect(prose(win).locator('p')).toHaveText([FIRST])
  await expect(draftRow(win, 'Draft 1')).toContainText('In the page')

  // Rename Draft 2, then delete it; Undo brings it back.
  await draftsTab(win).getByRole('button', { name: 'Rename Draft 2' }).click()
  const name = draftsTab(win).getByRole('textbox', { name: 'New name for Draft 2' })
  await expect(name).toBeFocused()
  await name.fill('The darker one')
  await name.press('Enter')
  await expect(draftRow(win, 'The darker one')).toContainText(SECOND)
  // Escape leaves the name as it was.
  await draftsTab(win).getByRole('button', { name: 'Rename The darker one' }).click()
  await draftsTab(win).getByRole('textbox', { name: 'New name for The darker one' }).fill('Not this')
  await win.keyboard.press('Escape')
  await expect(draftsTab(win).getByRole('button', { name: 'Rename The darker one' })).toBeFocused()
  expect((await invoke(win, 'listDrafts', sceneId)).drafts.map((d) => d.name)).toEqual(['Draft 1', 'The darker one'])
  await draftsTab(win).getByRole('button', { name: 'Delete The darker one' }).click()
  await expect(toasts(win).getByText('“The darker one” deleted.')).toBeVisible()
  await expect(draftRow(win, 'The darker one')).toHaveCount(0)
  await toast(win, '“The darker one” deleted.').getByRole('button', { name: 'Undo' }).click()
  await expect(draftRow(win, 'The darker one')).toContainText(SECOND)
  // The draft in the page can't be deleted: it has no Delete.
  await expect(draftsTab(win).getByRole('button', { name: 'Delete Draft 1' })).toHaveCount(0)

  // In a small window the toolbar keeps History (as its icon), and the Drafts tab leads there too.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(960, 600))
  await expect.poll(() => win.evaluate('window.innerWidth')).toBe(960)
  await expect(historyButton(win)).toBeVisible()
  await draftsTab(win).getByRole('button', { name: 'Earlier versions' }).click()
  await expect(win.getByRole('heading', { level: 1, name: 'History' })).toBeVisible()
  await expect(versions(win).getByRole('button', { name: /Before switching drafts/ })).toHaveCount(2)
})

test('a damaged or unreachable history.db never stops a world from opening: History starts afresh or says so, and Try again tries at once', async ({
  launch
}) => {
  const first = await launch({ env: { AIWRITE_HISTORY_WRITING_MS: '1000' } })
  let win = first.win
  await createWorldFromWelcome(win, 'Alpha')
  const sceneId = await firstScene(win)
  const folder = (await invoke(win, 'getWorld'))!.folder
  await prose(win).click()
  await win.keyboard.type(FIRST)
  await expect.poll(() => savedText(win, sceneId)).toBe(FIRST)
  await expect.poll(() => labels(win, sceneId)).toEqual(['While writing'])
  await closeWindow(first.app)

  // Kept across a restart.
  const second = await launch({ dataDir: first.dataDir, env: { AIWRITE_HISTORY_WRITING_MS: '1000' } })
  win = second.win
  await expect(prose(win)).toContainText(FIRST)
  expect(await labels(win, sceneId)).toEqual(['While writing'])
  await closeWindow(second.app)

  // The file is damaged while the app is closed (a bad disk, a sync gone wrong).
  writeFileSync(join(folder, 'history.db'), 'This is not a database any more. '.repeat(500))
  const third = await launch({ dataDir: first.dataDir, env: { AIWRITE_HISTORY_WRITING_MS: '1000' } })
  win = third.win
  // The world opens with its writing as it was.
  await expect(prose(win)).toContainText(FIRST)
  expect(readdirSync(folder).some((f) => /^history\.db\.damaged-\d{8}-\d{6}$/.test(f))).toBe(true)

  await historyButton(win).click()
  await expect(win.getByText(/^History had to start afresh because its file was damaged/)).toBeVisible()
  await expect(win.getByRole('heading', { name: 'No earlier versions yet' })).toBeVisible()

  // And History keeps versions again.
  await win.getByRole('button', { name: 'Back to writing' }).click()
  await prose(win).click()
  await win.keyboard.press('Control+End')
  await win.keyboard.type(' More.')
  await expect.poll(() => labels(win, sceneId)).toEqual(['While writing'])
  await closeWindow(third.app)

  // history.db can't be opened at all (here a folder is in its place; often another program holds the file).
  for (const f of ['history.db', 'history.db-wal', 'history.db-shm']) rmSync(join(folder, f), { force: true })
  mkdirSync(join(folder, 'history.db'))
  const fourth = await launch({ dataDir: first.dataDir })
  win = fourth.win
  await expect(prose(win)).toContainText(`${FIRST} More.`)
  // The Drafts tab says so in plain words; Try again tries at once (still out of reach here).
  await win.getByRole('tab', { name: 'Drafts' }).click()
  await expect(draftsTab(win).getByText(UNREACHABLE)).toBeVisible()
  await draftsTab(win).getByRole('button', { name: 'Try again' }).click()
  await expect(draftsTab(win).getByRole('button', { name: 'Try again' })).toBeEnabled()
  await expect(draftsTab(win).getByText(UNREACHABLE)).toBeVisible()
  // So does the History page; once the file can be opened, its Try again shows the scene's history straight away.
  await historyButton(win).click()
  await expect(win.getByText(UNREACHABLE)).toBeVisible()
  rmSync(join(folder, 'history.db'), { recursive: true, force: true })
  await win.getByRole('button', { name: 'Try again' }).click()
  await expect(win.getByRole('heading', { name: 'No earlier versions yet' })).toBeVisible()
  await win.getByRole('button', { name: 'Back to writing' }).click()
  await win.getByRole('tab', { name: 'Drafts' }).click()
  await expect(draftsTab(win).getByText('No drafts yet')).toBeVisible()
  await expect(draftsTab(win).getByRole('button', { name: 'New draft' })).toBeVisible()
})
