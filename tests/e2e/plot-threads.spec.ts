// The AI manages plot threads (2026-10-08), end to end against the fake provider (its plot thread sentences are listed
// at the top of tests/fake-provider/server.mjs): a mystery typed in a scene opens a plot thread, which shows on the
// board as found by the AI and on the scene card's "Sets up" with an AI tag; the payoff typed in a later scene resolves
// it, with the words on the board, and Undo there opens it again. Invented story text only. With AIWRITE_SHOTS set to
// a folder, screenshots of each step are saved there.
import type { Page } from '@playwright/test'
import type { FakeProvider } from '../fake-provider/server.mjs'
import { binder, createWorldFromWelcome, expect, invoke, test } from './helpers'

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
    await binder(win).getByRole('button', { name: 'Plot threads board', exact: true }).click()
    const card = main(win).getByRole('listitem').filter({ hasText: BELL })
    const column = (name: string) => main(win).getByRole('region', { name, exact: true })
    await expect(column('Open').getByRole('listitem').filter({ hasText: BELL })).toBeVisible()
    await expect(card).toContainText(`${BELL}?`)
    await expect(card).toContainText('Found by AI')
    await shot(win, 'board-open-found-by-ai')

    // The payoff, on the page in a later scene: resolved on its own, with the words that paid it off.
    await binder(win).getByRole('treeitem', { name: 'The ferryman' }).click()
    await prose(win).click()
    await win.keyboard.type('At last the answer came: the ferryman rang it for his drowned son.')
    await expect.poll(async () => (await threadsBoard(win, story.id))[0]?.column, { timeout: 30_000 }).toBe('resolved')
    const paid = (await invoke(win, 'getScene', second.id)).card
    expect(paid.paysOffIds).toHaveLength(1)
    expect(paid.threadLinks?.[`paysOff:${paid.paysOffIds[0]}`]).toBe('ai')

    await binder(win).getByRole('button', { name: 'Plot threads board', exact: true }).click()
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
