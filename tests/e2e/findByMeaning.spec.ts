// Story memory step 5 (Adam, 2026-10-07): before a draft, the briefing keeps the entries of the last two scenes, sends
// what was said word for word, and searches the story so far for what the scene is about, by keyword and (with the
// search model) by meaning. Here the search model is a stand-in (AIWRITE_SEARCH_MODEL=stub): nothing is downloaded.
// Every word of this story is made up for the test.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createWorldFromWelcome, expect, invoke, openSettings, test } from './helpers'

const ON = { env: { AIWRITE_RECALL: 'on', AIWRITE_SEARCH_MODEL: 'stub', AIWRITE_KEEPER_QUIET_MS: '600000' } }
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

  const preview = await invoke(win, 'previewContext', third, undefined)
  const said = preview.blocks.find((b) => b.id === 'said')
  expect(said?.text).toContain(`Mara’s promise to Tobin (Book 1, Ch 1, Sc 1): ${PROMISE}`)
  const recalled = preview.blocks.find((b) => b.id === 'recalled')
  expect(recalled?.text).toContain('At the old well Mara took his hands.')
  // Kell was in the scene before (named in its words): he stays.
  expect(preview.entries?.find((e) => e.entryId === kell.id)?.blockId).toBe('mentioned')
  // The search index is a file of its own beside world.db.
  const folder = join(dataDir, 'library', readdirSync(join(dataDir, 'library')).find((n) => existsSync(join(dataDir, 'library', n, 'world.db')))!)
  await expect.poll(() => existsSync(join(folder, 'search-index.db'))).toBe(true)
})

test('Find by meaning is on by default, offers the search model, and can be turned off', async ({ launch }) => {
  const { win } = await launch(ON)
  await createWorldFromWelcome(win, 'Harbour')
  await openSettings(win, 'Models')
  const toggle = win.getByRole('switch', { name: 'Find by meaning' })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(win.getByRole('button', { name: /^Download the search model \(134 MB\)$/ })).toBeVisible()
  await expect(win.getByText('Until then, passages are found by their words.')).toBeVisible()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect.poll(async () => (await invoke(win, 'getSettings')).findByMeaning).toBe(false)
  await expect(win.getByRole('button', { name: /Download the search model/ })).toHaveCount(0)
})
