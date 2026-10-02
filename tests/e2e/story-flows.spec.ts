// The automatic story flows end to end, against the fake provider (its story flow replies are
// described at fakeStoryFlowReply in tests/fake-provider/server.mjs): what changed in a time gap, a
// prequel's starting cast, and "When did these happen?", each listed under What changed with Undo
// and, for a judgement call, a question Adam can answer any time. The stories are set up through the
// API, as the Stories part's screens are being built at the same time.
import type { Page } from '@playwright/test'
import type { ID, StoryKind } from '@shared/types'
import type { StoryFlowKind, StoryFlowStatus } from '@shared/contracts/storyFlows'
import type { FakeProvider } from '../fake-provider/server.mjs'
import { binder, createWorldFromWelcome, expect, invoke, openSettings, startFake, test } from './helpers'

/** Connects the fake server as both the writer model and the memory model. */
async function useFake(win: Page, fake: FakeProvider, memory = 'fake/memory'): Promise<void> {
  const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
  const model = (modelId: string) => ({
    providerId: p.id,
    modelId,
    label: modelId,
    contextLength: 32000,
    promptPrice: null,
    completionPrice: null
  })
  await invoke(win, 'updateSettings', { models: { writer: model('fake/writer'), memory: model(memory) } })
  await win.reload()
  await expect(win.locator('.scene-prose')).toBeVisible()
}

async function place(win: Page, storyId: ID, kind: StoryKind, startStoryId: ID | null, leadsIntoId: ID | null = null): Promise<void> {
  await invoke(win, 'setStoryPlacement', storyId, {
    kind,
    startStoryId,
    startAt: 'end',
    startRefId: null,
    endAt: null,
    endRefId: null,
    leadsIntoId
  })
}

/** How a flow ended (polled, as the call itself returns at once). */
async function finished(win: Page, storyId: ID, flow: StoryFlowKind): Promise<StoryFlowStatus> {
  let last: StoryFlowStatus | undefined
  await expect
    .poll(
      async () => {
        last = (await invoke(win, 'listStoryFlows', storyId)).find((s) => s.flow === flow)
        return last?.state
      },
      { timeout: 30_000 }
    )
    .toMatch(/^(done|failed)$/)
  return last!
}

/** What each of an entry's changes says: an update's note, a plot thread's status. */
const notes = async (win: Page, entryId: ID): Promise<string[]> =>
  (await invoke(win, 'listChanges', entryId)).map((c) =>
    c.kind === 'update' ? c.payload.note : c.kind === 'thread' ? c.payload.status : c.kind
  )

async function openWhatChanged(win: Page) {
  await binder(win).getByRole('button', { name: 'What changed' }).click()
  const list = win.locator('main')
  await expect(list.getByRole('heading', { level: 1, name: 'What changed' })).toBeVisible()
  return list
}

test('a time gap fills in what changed, listed under What changed with Undo and "Still open?"', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'The Reach')
    await useFake(win, fake)
    const [book1] = await invoke(win, 'listStories')
    const outline = await invoke(win, 'getOutline', book1.id)
    const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: "A smith's daughter." })
    const mill = await invoke(win, 'createEntry', 'place', { name: 'Harrow Mill' })
    const fire = await invoke(win, 'createEntry', 'thread', { name: 'Who burned the mill?' })
    await invoke(win, 'createChange', {
      kind: 'thread',
      payload: { status: 'open', note: 'The mill burns and nobody knows who set the fire.' },
      entryId: fire.id,
      anchor: 'scene',
      storyId: book1.id,
      sceneId: outline.scenes[0].id
    })

    // Without the time since the previous story, it says what to do first.
    const dark = await invoke(win, 'createStory', { title: 'The Long Dark', startStoryId: book1.id })
    await invoke(win, 'fillTimeGap', dark.id)
    expect(await finished(win, dark.id, 'time-gap')).toMatchObject({
      state: 'failed',
      message: 'Add the time since the previous story first.'
    })

    await invoke(win, 'updateStory', dark.id, { timeGap: '200 years', premise: 'The Reach, long after Mara.' })
    await invoke(win, 'fillTimeGap', dark.id)
    expect(await finished(win, dark.id, 'time-gap')).toEqual({
      storyId: dark.id,
      flow: 'time-gap',
      state: 'done',
      message: 'Added 2 changes and closed 1 plot thread, listed under What changed.'
    })
    expect(await notes(win, mara.id)).toEqual(['died long ago'])
    const story = (await invoke(win, 'listChanges', mara.id))[0]
    expect([story.anchor, story.storyId, story.origin]).toEqual(['story-start', dark.id, 'ai'])

    const list = await openWhatChanged(win)
    const group = list.getByRole('region', { name: 'Before The Long Dark starts' })
    await expect(group).toBeVisible()
    await expect(group.getByRole('button', { name: 'Undo: Mara, Died long ago' })).toBeVisible()
    await expect(group.getByRole('button', { name: 'Undo: Harrow Mill, Fell into ruin' })).toBeVisible()
    // A new field value is named as the entry page names it.
    await expect(group.getByText('Who rules or lives there: Nobody now but crows', { exact: true })).toBeVisible()
    await expect(group.getByText('Start of The Long Dark')).toHaveCount(3)
    await expect(list.getByText('Everything the memory added or changed, newest first.')).toBeVisible()

    // The thread was left unanswered, by default; Adam says it is still open, then changes his mind.
    const thread = group.getByRole('listitem').filter({ hasText: 'Plot thread left unanswered' })
    const question = thread.getByRole('group', { name: 'Still open?' })
    await expect(question.getByRole('button', { name: 'Left unanswered' })).toHaveAttribute('aria-pressed', 'true')
    await question.getByRole('button', { name: 'Still open' }).click()
    await expect(question.getByRole('button', { name: 'Still open' })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => notes(win, fire.id)).toEqual(['open'])
    await question.getByRole('button', { name: 'Left unanswered' }).click()
    await expect.poll(() => notes(win, fire.id)).toEqual(['open', 'resolved'])

    // Undo takes Mara's change away again.
    await group.getByRole('button', { name: 'Undo: Mara, Died long ago' }).click()
    await expect(win.getByText('Undone.', { exact: true })).toBeVisible()
    await expect(group.getByRole('listitem').filter({ hasText: 'Died long ago' }).getByText('Undone')).toBeVisible()
    await expect.poll(() => notes(win, mara.id)).toEqual([])
    expect(await notes(win, mill.id)).toEqual(['fell into ruin'])
  } finally {
    await fake.close()
  }
})

test("a prequel's starting cast is drafted by AI, and each exists from the prequel's start", async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'The Reach')
    await useFake(win, fake)
    const [book1] = await invoke(win, 'listStories')
    const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Heir to the Reach.' })
    const tobin = await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'A ferryman.' })
    const young = await invoke(win, 'createStory', { title: 'Young Mara', startStoryId: null })

    // Only a prequel gets one.
    await invoke(win, 'draftStartingCast', young.id, [mara.id])
    expect(await finished(win, young.id, 'starting-cast')).toMatchObject({ state: 'failed' })

    await place(win, young.id, 'prequel', book1.id, book1.id)
    await invoke(win, 'draftStartingCast', young.id, [mara.id, tobin.id])
    expect(await finished(win, young.id, 'starting-cast')).toMatchObject({
      state: 'done',
      message: 'Drafted 2 starting descriptions, listed under What changed.'
    })
    const [start] = await invoke(win, 'listChanges', mara.id)
    expect([start.kind, start.anchor, start.storyId, start.origin]).toEqual(['full', 'story-start', young.id, 'ai'])
    expect(start.kind === 'full' && start.payload.description).toContain('Mara is young here')
    const points = await invoke(win, 'listExistsPoints', tobin.id)
    expect(points.some((p) => p.kind === 'story-pre' && p.storyId === young.id)).toBe(true)

    const list = await openWhatChanged(win)
    const group = list.getByRole('region', { name: 'Starting cast for Young Mara' })
    await expect(group.getByRole('button', { name: 'Undo: Mara, Starting description, drafted by AI' })).toBeVisible()
    await expect(group.getByRole('button', { name: 'Undo: Tobin, Starting description, drafted by AI' })).toBeVisible()
    await group.getByRole('button', { name: 'Undo: Tobin, Starting description, drafted by AI' }).click()
    await expect.poll(async () => (await invoke(win, 'listChanges', tobin.id)).length).toBe(0)
    await expect
      .poll(async () => (await invoke(win, 'listExistsPoints', tobin.id)).some((p) => p.storyId === young.id))
      .toBe(false)
  } finally {
    await fake.close()
  }
})

test('"When did these happen?" sorts a book\'s changes when a story is set before it, and each answer applies', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'The Reach')
    await useFake(win, fake)
    const [book1] = await invoke(win, 'listStories')
    const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara' })
    const mill = await invoke(win, 'createEntry', 'place', { name: 'Harrow Mill' })
    const tobin = await invoke(win, 'createEntry', 'character', { name: 'Tobin' })

    // Book 2, a hundred years on: the time gap drafts two changes at its start; Adam adds one of his own.
    const book2 = await invoke(win, 'createStory', { title: 'Book 2', startStoryId: book1.id })
    await invoke(win, 'updateStory', book2.id, { timeGap: '100 years' })
    await invoke(win, 'fillTimeGap', book2.id)
    expect(await finished(win, book2.id, 'time-gap')).toMatchObject({ state: 'done' })
    await invoke(win, 'createChange', {
      kind: 'update',
      payload: { note: 'took over the ferry' },
      entryId: tobin.id,
      anchor: 'story-start',
      storyId: book2.id,
      sceneId: null
    })

    // The Quiet Year, written later, goes between them, and its first scene rebuilds the mill.
    const quiet = await invoke(win, 'createStory', { title: 'The Quiet Year', startStoryId: book1.id })
    const chapter = await invoke(win, 'createChapter', quiet.id, { title: 'Chapter 1' })
    const scene = await invoke(win, 'createScene', chapter.id, { title: 'The mill' })
    const text = 'The walls of Harrow Mill go up again, stone by stone.'
    await invoke(win, 'saveSceneText', scene.id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, text)
    await place(win, book2.id, 'continues', quiet.id)
    await invoke(win, 'sortStartChanges', quiet.id, book2.id)
    expect(await finished(win, quiet.id, 'when')).toMatchObject({ state: 'done', message: 'Sorted 3 changes, listed under What changed.' })

    // Mara's death moved before The Quiet Year; the mill's ruin happens in it (removed); Tobin's stays on Book 2.
    const startOf = async (entryId: ID): Promise<ID[]> =>
      (await invoke(win, 'listChanges', entryId)).filter((c) => c.anchor === 'story-start').map((c) => c.storyId!)
    expect(await startOf(mara.id)).toEqual([quiet.id])
    expect(await startOf(mill.id)).toEqual([])
    expect(await startOf(tobin.id)).toEqual([book2.id])

    const list = await openWhatChanged(win)
    const group = list.getByRole('region', { name: 'When did these happen?' })
    const line = (words: string) => group.getByRole('listitem').filter({ hasText: words })
    await expect(line('Died long ago').getByText('Start of The Quiet Year')).toBeVisible()
    await expect(line('Fell into ruin').getByText('Happens in The Quiet Year, Ch 1, Sc 1', { exact: true })).toBeVisible()
    await expect(line('Took over the ferry').getByText('Start of Book 2')).toBeVisible()
    // The time gap's lines say where each change is now; the mill's is answered for by its line above.
    const gap = list.getByRole('region', { name: 'Before Book 2 starts' })
    const gapLine = (words: string) => gap.getByRole('listitem').filter({ hasText: words })
    await expect(gapLine('Died long ago').getByText('Start of The Quiet Year')).toBeVisible()
    await expect(gapLine('Fell into ruin').getByText('Happens in The Quiet Year, Ch 1, Sc 1', { exact: true })).toBeVisible()
    await expect(gapLine('Fell into ruin').getByRole('button', { name: /^Undo/ })).toHaveCount(0)
    const tobinQuestion = line('Took over the ferry').getByRole('group', { name: 'When did this happen?' })
    await expect(tobinQuestion.getByRole('button', { name: 'After it' })).toHaveAttribute('aria-pressed', 'true')

    // Adam: Tobin took over the ferry before The Quiet Year after all.
    await tobinQuestion.getByRole('button', { name: 'Before the new story' }).click()
    await expect.poll(() => startOf(tobin.id)).toEqual([quiet.id])
    await expect(line('Took over the ferry').getByText('Start of The Quiet Year')).toBeVisible()
    expect((await invoke(win, 'listChanges', tobin.id))[0].origin).toBe('adam')

    // Undo puts the mill's change back on Book 2.
    await line('Fell into ruin').getByRole('button', { name: /^Undo: Harrow Mill/ }).click()
    await expect.poll(() => startOf(mill.id)).toEqual([book2.id])
    await expect(gapLine('Fell into ruin').getByText('Start of Book 2')).toBeVisible()
    await expect(gapLine('Fell into ruin').getByRole('button', { name: 'Undo: Harrow Mill, Fell into ruin' })).toBeVisible()

    // Adam deletes Mara's change on her page: the line says so, with nothing left to answer or undo.
    const maraChange = (await invoke(win, 'listChanges', mara.id))[0]
    await invoke(win, 'deleteChange', maraChange.id)
    await expect(line('Died long ago').getByText('No longer in the memory')).toBeVisible()
    await expect(line('Died long ago').getByRole('group', { name: 'When did this happen?' })).toHaveCount(0)
    await expect(line('Died long ago').getByRole('button', { name: /^Undo/ })).toHaveCount(0)
    expect(await startOf(mara.id)).toEqual([])
  } finally {
    await fake.close()
  }
})

test('restoring a backup while a flow is working leaves no line saying it still is', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  // The memory model holds its reply back for a minute, so the flow is still working at the restore.
  const fake = await startFakeProvider({ delayMs: 2, waitMs: 60_000 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'The Reach')
    const [book1] = await invoke(win, 'listStories')
    // Someone for the time to change, so the AI is asked.
    await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: "A smith's daughter." })
    const book2 = await invoke(win, 'createStory', { title: 'Book 2', startStoryId: book1.id })
    await invoke(win, 'updateStory', book2.id, { timeGap: '200 years' })
    await useFake(win, fake, 'fake/wait')
    // The backup made as the world opened is in (so the one made now is the newest), then Back up now.
    await expect.poll(async () => (await invoke(win, 'listBackups')).length).toBe(1)
    await openSettings(win, 'Backups')
    const rows = win.getByRole('list', { name: 'Backups' }).getByRole('listitem')
    await expect(rows).toHaveCount(1)
    await win.getByRole('button', { name: 'Back up now' }).click()
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('Made by you')

    const openBook2 = async (): Promise<void> => {
      await binder(win).getByRole('button', { name: 'Book 1', exact: true }).click()
      await win.getByRole('menuitem', { name: 'Settings for Book 2' }).click()
      await expect(win.getByRole('heading', { level: 1, name: 'Book 2' })).toBeVisible()
    }
    await openBook2()
    const fill = win.getByRole('button', { name: 'What changed before this story starts?' })
    const working = win.getByRole('status').filter({ hasText: /Working/ })
    await fill.click()
    await expect(working).toContainText('Working out what changed in the 200 years')
    await expect(fill).toBeDisabled()

    // The restore reopens the world, which stops the flow without a word.
    await openSettings(win, 'Backups')
    await rows.first().getByRole('button', { name: /^Restore the backup from/ }).click()
    await rows.first().getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(win.getByText(/Restored the backup from/)).toBeVisible()
    await openBook2()
    await expect(fill).toBeEnabled()
    await expect(working).toHaveCount(0)
    expect(await invoke(win, 'listStoryFlows', book2.id)).toEqual([])
  } finally {
    await fake.close()
  }
})
