// Story memory step 5 (Adam, 2026-10-07): before a draft, the briefing keeps the entries of the last two scenes, sends
// what was said word for word, and searches the story so far for what the scene is about, by keyword and (with the
// search model) by meaning. Here the search model is a stand-in (AIWRITE_SEARCH_MODEL=stub): nothing is downloaded.
// Every word of this story is made up for the test.
import { existsSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { createWorldFromWelcome, expect, invoke, openSettings, startFake, test, useFakeModel } from './helpers'

const ON = { env: { AIWRITE_RECALL: 'on', AIWRITE_SEARCH_MODEL: 'stub', AIWRITE_KEEPER_QUIET_MS: '600000' } }
const OPTIONS = { direction: '', targetWords: 300, creativity: 'balanced' as const }
const PROMISE = '“I swear I will come back for you before the snow.”'

test('the briefing finds an earlier promise by meaning, sends what was said word for word, and keeps who was just there', async ({ launch }) => {
  const { win, dataDir } = await launch(ON)
  await createWorldFromWelcome(win, 'Harbour')
  const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the ferry.' })
  const tobin = await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'A ferryman.' })
  const kell = await invoke(win, 'createEntry', 'character', { name: 'Kell', summary: 'A dockhand.' })
  const [story] = await invoke(win, 'listStories')
  const outline = await invoke(win, 'getOutline', story.id)
  const first = outline.scenes[0].id
  const second = (await invoke(win, 'createScene', outline.chapters[0].id, { title: 'The docks', afterId: first })).id
  const third = (await invoke(win, 'createScene', outline.chapters[0].id, { title: 'Night', afterId: second })).id
  await invoke(win, 'saveSceneText', first, null, `Rain on the roofs.\n\nAt the old well Mara took his hands. ${PROMISE} Tobin said nothing.`)
  await invoke(win, 'saveSceneText', second, null, 'The ferry was late. Kell counted the coins twice and said nothing.')
  // Mara's promise, as the memory keeps something said: on her and on Tobin, who heard it.
  for (const who of [mara, tobin]) {
    await invoke(win, 'createChange', {
      entryId: who.id,
      anchor: 'scene',
      sceneId: first,
      kind: 'knowledge',
      payload: { factId: 'promise-1', fact: 'Mara will come back for Tobin before the snow', said: { kind: 'promise', by: mara.id, words: PROMISE } }
    })
  }
  const card = (await invoke(win, 'getScene', third)).card
  await invoke(win, 'updateSceneCard', third, { ...card, povId: mara.id, presentIds: [mara.id], beats: ['Mara thinks of the vow she made at the well'] })

  const preview = await invoke(win, 'previewContext', third, OPTIONS)
  const said = preview.blocks.find((b) => b.id === 'said')
  expect(said?.text).toContain(`Mara’s promise to Tobin (Book 1, Ch 1, Sc 1): ${PROMISE}`)
  const recalled = preview.blocks.find((b) => b.id === 'recalled')
  expect(recalled?.text).toContain('At the old well Mara took his hands.')
  // Kell was in the scene before (named in its words): he stays.
  expect(preview.entries?.find((e) => e.entryId === kell.id)?.blockId).toBe('mentioned')
  // The search index is a file of its own beside world.db.
  const folder = join(dataDir, 'library', readdirSync(join(dataDir, 'library')).find((n) => existsSync(join(dataDir, 'library', n, 'world.db')))!)
  await expect.poll(() => existsSync(join(folder, 'search-index.db'))).toBe(true)

  // A draft is sent the same.
  const fake = await startFake()
  try {
    await useFakeModel(win, fake)
    const { generationId } = await invoke(win, 'startDraft', third, OPTIONS)
    await expect.poll(async () => (await invoke(win, 'getGeneration', generationId)).status, { timeout: 60_000 }).toBe('complete')
    const sent = (await invoke(win, 'getGeneration', generationId)).messages.map((m) => m.content).join('\n')
    expect(sent).toContain('## What was said, word for word')
    expect(sent).toContain(PROMISE)
    expect(sent).toContain('## Earlier passages that may matter')
  } finally {
    await fake.close()
  }
})

test('Find by meaning is on by default, offers the search model, and can be turned off', async ({ launch }) => {
  const { win } = await launch(ON)
  await createWorldFromWelcome(win, 'Harbour')
  await openSettings(win, 'Models')
  const toggle = win.getByRole('switch', { name: 'Find by meaning' })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(win.getByRole('button', { name: /^Download the search model \(133 MB\)$/ })).toBeVisible()
  await expect(win.getByText('Until then, passages are found by their words.')).toBeVisible()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect.poll(async () => (await invoke(win, 'getSettings')).findByMeaning).toBe(false)
  await expect(win.getByRole('button', { name: /Download the search model/ })).toHaveCount(0)
})

test('the search model downloads by itself a little after start-up, says when it failed, and Remove keeps it from coming back', async ({ launch }) => {
  // A local server that is "down": nothing goes near Hugging Face.
  const asked: string[] = []
  const server = createServer((req, res) => {
    asked.push(req.url ?? '')
    res.writeHead(503).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const { win } = await launch({ env: { AIWRITE_RECALL: 'on', AIWRITE_SEARCH_MODEL_AUTO: 'on', AIWRITE_SEARCH_MODEL_AUTO_MS: '1000', AIWRITE_SEARCH_MODEL_URL: url } })
    await createWorldFromWelcome(win, 'Harbour')
    await expect.poll(() => asked.length).toBeGreaterThan(0)
    expect(asked[0]).toContain('/resolve/')
    await openSettings(win, 'Models')
    await expect(win.getByText(/server said 503/)).toBeVisible()
    await expect(win.getByText('It will try again by itself later. Until then, passages are found by their words.')).toBeVisible()
    // Not again straight away: the next try is an hour off.
    const tries = asked.length
    await win.waitForTimeout(1500)
    expect(asked.length).toBe(tries)
    expect((await invoke(win, 'getSearchModel')).auto).toBe(true)
    // Remove (or Stop) is Adam saying no: it no longer downloads by itself until he presses Download.
    await invoke(win, 'removeSearchModel')
    expect((await invoke(win, 'getSettings')).searchModelAuto).toBe(false)
    expect((await invoke(win, 'getSearchModel')).auto).toBe(false)
  } finally {
    server.close()
  }
})
