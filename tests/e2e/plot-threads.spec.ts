// The AI manages plot threads (2026-10-08), end to end against the fake provider (its plot thread sentences are listed
// at the top of tests/fake-provider/server.mjs): a mystery typed in a scene opens a plot thread, which shows on the
// board as found by the AI and on the scene card's "Sets up" with an AI tag; the payoff typed in a later scene resolves
// it, with the words on the board, and Undo there opens it again. Invented story text only. With AIWRITE_SHOTS set to
// a folder, screenshots of each step are saved there.
import type { Page } from '@playwright/test'
import type { FakeProvider } from '../fake-provider/server.mjs'
import { binder, createWorldFromWelcome, expect, invoke, openPage, openWrite, test } from './helpers'

const shots = process.env.AIWRITE_SHOTS
const prose = (win: Page) => win.locator('.scene-prose')
const main = (win: Page) => win.locator('main')
const sceneCard = (win: Page) => win.getByRole('tabpanel', { name: 'Scene card' })
const BELL = 'Who rang the drowned bell'

/** A screenshot once what moves on screen has settled (only with AIWRITE_SHOTS). */
async function shot(win: Page, name: string): Promise<void> {
  if (!shots) return
  await win.waitForTimeout(900)
  await win.screenshot({ path: `${shots}/${name}.png` })
}

async function fakeProvider(): Promise<FakeProvider> {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  return startFakeProvider({ delayMs: 2 })
}

/** Connects the fake server as the writer model (the memory uses it when no memory model is chosen). */
async function useModel(win: Page, fake: FakeProvider): Promise<void> {
  const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
  await invoke(win, 'updateSettings', {
    models: { writer: { providerId: p.id, modelId: 'fake/writer', label: 'fake/writer', contextLength: 32000, promptPrice: null, completionPrice: null } }
  })
  await win.reload()
  await expect(prose(win)).toBeVisible()
}

const threadsBoard = async (win: Page, storyId: string) => (await invoke(win, 'getThreadsBoard', storyId)).threads

test('the memory opens a plot thread from the text and resolves it from the payoff; the board can undo the resolve', async ({ launch }) => {
  const fake = await fakeProvider()
  try {
    const { win } = await launch({ env: { AIWRITE_KEEPER_QUIET_MS: '700' } })
    await createWorldFromWelcome(win, 'Marsh')
    const [story] = await invoke(win, 'listStories')
    const [chapter] = (await invoke(win, 'getOutline', story.id)).chapters
    const second = await invoke(win, 'createScene', chapter.id, { title: 'The ferryman' })
    await useModel(win, fake)

    // A mystery set up in the first scene: the memory opens a plot thread, with its promise and a clue.
    await prose(win).click()
    await win.keyboard.type('The marsh was still at dusk. Nobody knew who rang the drowned bell. A clue: wet footprints led up the tower stair.')
    await expect.poll(async () => (await threadsBoard(win, story.id)).map((t) => [t.name, t.column, t.aiMade]), { timeout: 30_000 }).toEqual([
      [BELL, 'open', true]
    ])

    // On the scene card it is under Sets up, tagged as the AI's.
    await win.getByRole('tab', { name: 'Scene card' }).click()
    const tag = sceneCard(win).getByTestId('ai-link')
    await expect(tag).toHaveCount(1)
    await expect(sceneCard(win).getByText(BELL, { exact: true })).toBeVisible()
    await tag.scrollIntoViewIfNeeded()
    await shot(win, 'scene-card-ai-link')

    // On the board: open, found by the AI, with its promise.
    await openPage(win, 'Plot threads board')
    const card = main(win).getByRole('listitem').filter({ hasText: BELL })
    const column = (name: string) => main(win).getByRole('region', { name, exact: true })
    await expect(column('Open').getByRole('listitem').filter({ hasText: BELL })).toBeVisible()
    await expect(card).toContainText(`${BELL}?`)
    await expect(card).toContainText('Found by AI')
    await shot(win, 'board-open-found-by-ai')

    // The payoff, on the page in a later scene: resolved on its own, with the words that paid it off.
    await openWrite(win)
    await binder(win).getByRole('treeitem', { name: 'The ferryman' }).click()
    await prose(win).click()
    await win.keyboard.type('At last the answer came: the ferryman rang it for his drowned son.')
    await expect.poll(async () => (await threadsBoard(win, story.id))[0]?.column, { timeout: 30_000 }).toBe('resolved')
    const paid = (await invoke(win, 'getScene', second.id)).card
    expect(paid.paysOffIds).toHaveLength(1)
    expect(paid.threadLinks?.[`paysOff:${paid.paysOffIds[0]}`]).toBe('ai')

    await openPage(win, 'Plot threads board')
    await expect(column('Resolved').getByRole('listitem').filter({ hasText: BELL })).toBeVisible()
    await expect(card.getByTestId('thread-payoff')).toHaveText('“At last the answer came: the ferryman rang it for his drowned son.”')
    await expect(card).toContainText('Resolved by AI')
    await shot(win, 'board-resolved-with-quote')

    // Undo: open again, off the scene card, and the same words don't resolve it again.
    await card.getByRole('button', { name: 'Undo' }).click()
    await expect(column('Open').getByRole('listitem').filter({ hasText: BELL })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Undo' })).toHaveCount(0)
    expect((await invoke(win, 'getScene', second.id)).card.paysOffIds).toEqual([])
    await shot(win, 'board-resolve-undone')
  } finally {
    await fake.close()
  }
})

// The promises ledger (long story memory fix 10): a thread still open past the chapter it was to be paid off by shows
// in Worth a look, where Pay off later gives it a later chapter (with Undo) and Mark as dropped drops it; the board shows
// it in Dropped with Pick up again, says it is overdue, and the ledger's "Pay off by" sets its chapter. No AI is used.
test('the promises ledger: an overdue thread in Worth a look, Pay off later and Mark as dropped, and Pay off by on the ledger', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Marsh')
  const [story] = await invoke(win, 'listStories')
  const outline = await invoke(win, 'getOutline', story.id)
  const first = outline.chapters[0]
  const ferry = await invoke(win, 'createChapter', story.id, { title: 'The Ferry' })
  const tower = await invoke(win, 'createChapter', story.id, { title: 'The Tower' })
  const s1 = outline.scenes[0].id
  const s2 = (await invoke(win, 'createScene', ferry.id, { title: 'Crossing' })).id
  const s3 = (await invoke(win, 'createScene', tower.id, { title: 'The stair' })).id
  await invoke(win, 'saveSceneText', s1, null, 'Nobody knew who rang the drowned bell.')
  await invoke(win, 'saveSceneText', s2, null, 'The ferry crossed in fog.')
  await invoke(win, 'saveSceneText', s3, null, 'Wet footprints went up the tower stair.')
  const bell = await invoke(win, 'createEntry', 'thread', { name: 'The drowned bell', fields: { promise: 'Who rang it?' } })
  await invoke(win, 'createChange', { kind: 'thread', payload: { status: 'open', note: 'the bell rang' }, entryId: bell.id, anchor: 'scene', storyId: story.id, sceneId: s1 })
  await invoke(win, 'planThread', bell.id, { payBy: first.id })
  const due = async () => (await threadsBoard(win, story.id)).find((t) => t.id === bell.id)?.due ?? null

  // Worth a look: due by the end of Ch 1, and the story is written into Ch 3.
  await openPage(win, 'What changed')
  const waiting = () => main(win).getByRole('group', { name: 'Plot threads left waiting' })
  await expect(waiting()).toContainText('The drowned bell: Still open, and due by the end of Ch 1')
  await expect(waiting()).toContainText('Last touched in')
  await shot(win, 'promise-worth-a-look')

  // Pay off later: Ch 3, so nothing is overdue; Undo puts Ch 1 back.
  await waiting().getByRole('button', { name: /^Pay off later: / }).click()
  await win.getByRole('menuitem', { name: 'Ch 3 · The Tower' }).click()
  await expect(win.getByText('“The drowned bell” is to be paid off by the end of Ch 3.')).toBeVisible()
  await expect(waiting()).toHaveCount(0)
  await expect.poll(async () => (await due())?.chapterId).toBe(tower.id)
  await win.getByRole('button', { name: 'Undo', exact: true }).last().click()
  await expect.poll(async () => (await due())?.chapterId).toBe(first.id)
  await expect(waiting()).toBeVisible()

  // Mark as dropped: off the list; on the board in Dropped, where Pick up again opens it again.
  await waiting().getByRole('button', { name: /^Mark as dropped: / }).click()
  await expect(win.getByText('Marked “The drowned bell” as dropped. The AI won’t bring it up again.')).toBeVisible()
  await expect(waiting()).toHaveCount(0)
  await openPage(win, 'Plot threads board')
  const column = (name: string) => main(win).getByRole('region', { name, exact: true })
  await expect(column('Dropped').getByRole('listitem').filter({ hasText: 'The drowned bell' })).toBeVisible()
  await shot(win, 'board-dropped')
  await column('Dropped').getByRole('button', { name: 'Pick up again' }).click()
  const open = column('Open').getByRole('listitem').filter({ hasText: 'The drowned bell' })
  await expect(open).toBeVisible()
  await expect(open.getByTestId('thread-due')).toHaveText('Overdue: due by the end of Ch 1')

  // The ledger: where it stands, where it was set up, and Pay off by.
  await main(win).getByRole('radio', { name: 'Ledger' }).click()
  const row = main(win).getByTestId('threads-ledger').getByRole('row').filter({ hasText: 'The drowned bell' })
  await expect(row).toContainText('Open')
  await expect(row).toContainText('Overdue')
  await expect(row).toContainText('Not since it was set up')
  await row.getByRole('combobox', { name: 'Pay off “The drowned bell” by' }).click()
  await win.getByRole('option', { name: 'Ch 3 · The Tower' }).click()
  await expect(win.getByText('“The drowned bell” is to be paid off by the end of Ch 3.')).toBeVisible()
  await expect.poll(async () => (await due())?.state).toBe('now')
  await expect(row).not.toContainText('Overdue')
  await shot(win, 'ledger-pay-off-by')
})
