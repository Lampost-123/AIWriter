// The Map room's Under suggestion page (the story map, phase 2, Adam 2026-10-24), on the desk: a story with hypnosis in
// it, tracking turned on, its scenes read for commands by the fake memory model (tests/fake-provider/commands.mjs): two
// clothing commands that stack, a planted trigger that waits and is then set off, Adam's own change with Undo, and the
// writer's briefing telling it all. Pictures go to test-results/map/ (and AIWRITE_SHOTS, when set).
import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, invoke, startFake, test } from './helpers'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk', AIWRITE_THEME: 'dark', AIWRITE_KEEPER_QUIET_MS: '300' }
const rooms = (win: Page) => win.getByRole('navigation', { name: 'Rooms' })
const page = (win: Page) => win.getByRole('region', { name: 'Under suggestion' })

const SCENES = [
  'The watch swung on its chain. “You won’t wear socks any more,” Mara told Tam. Tam nodded, and it felt like her own idea.',
  'Later, by the fire, Mara leaned close. “You won’t wear a bra either,” Mara whispered to Tam. Tam smiled and said nothing.',
  '“When you hear the word banana, you will take your shoes off,” Mara told Tam. Tam blinked awake and remembered none of it.',
  'At breakfast, Mara asked for a banana. Tam slipped her shoes off under the table without a thought.'
]

async function shot(win: Page, name: string): Promise<void> {
  const dir = join('test-results', 'map')
  mkdirSync(dir, { recursive: true })
  // Let the room's arrival and any glide settle first.
  await win.waitForTimeout(700)
  const file = join(dir, `${name}.png`)
  await win.screenshot({ path: file })
  if (process.env.AIWRITE_SHOTS) copyFileSync(file, join(process.env.AIWRITE_SHOTS, `${name}.png`))
}

test('Under suggestion: commands read from the story, stacked, set off, changed by Adam and told to the writer', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch({ env: DESK })
    await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
    const w = await invoke(win, 'createWorld', 'Hollow House')
    await invoke(win, 'openWorld', w.id)
    const [story] = await invoke(win, 'listStories')
    await invoke(win, 'updateStory', story.id, { title: 'The Quiet Hours' })
    const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
    await invoke(win, 'updateSettings', { models: { writer: { providerId: p.id, modelId: 'fake/writer', label: 'fake/writer', contextLength: 32000, promptPrice: null, completionPrice: null } } })
    const tam = await invoke(win, 'createEntry', 'character', { name: 'Tam Hollis', summary: 'Mara’s lodger.' })
    const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara Venn', summary: 'Owns Hollow House.' })
    const o = await invoke(win, 'getOutline', story.id)
    await invoke(win, 'updateChapter', o.chapters[0].id, { title: 'The Watch' })
    const ids = [o.scenes[0].id]
    for (const title of ['By the Fire', 'Banana', 'Breakfast', 'The Garden']) ids.push((await invoke(win, 'createScene', o.chapters[0].id, { title, afterId: ids[ids.length - 1] })).id)
    await invoke(win, 'updateScene', ids[0], { title: 'The Watch' })
    for (let i = 0; i < SCENES.length; i++) await invoke(win, 'saveSceneText', ids[i], null, SCENES[i])
    const card = await invoke(win, 'getScene', ids[4]).then((s) => s.card)
    await invoke(win, 'updateSceneCard', ids[4], { ...card, povId: tam.id, presentIds: [mara.id], goal: 'Tam and Mara in the garden.' })
    await win.reload()

    // The Map room, beside Plan, opens on Under suggestion; with tracking off it says what it does.
    await expect(rooms(win).getByRole('button', { name: /^Map/ })).toBeVisible()
    await rooms(win).getByRole('button', { name: /^Map/ }).click()
    await expect(page(win)).toBeVisible()
    await expect(page(win).getByRole('heading', { name: 'Keep track of suggestions and commands' })).toBeVisible()
    await shot(win, '1-map-room-off')

    // Turned on, the story is read for commands, scene by scene.
    await page(win).getByRole('button', { name: 'Turn it on for this story' }).click()
    await expect(page(win).getByRole('heading', { name: 'Tam Hollis' })).toBeVisible({ timeout: 30_000 })
    await expect(page(win).getByRole('article')).toHaveCount(3, { timeout: 30_000 })
    await expect(page(win)).toContainText('Wears, by command: no socks, no bra, no shoes')
    await expect(page(win).getByRole('article', { name: /banana/ })).toContainText('Set off')
    await expect(page(win).getByRole('article', { name: /banana/ })).toContainText('In effect')
    await shot(win, '2-under-suggestion')
    await page(win).getByRole('article', { name: /banana/ }).scrollIntoViewIfNeeded()
    await shot(win, '2b-trigger-set-off')

    // As of the third scene: the trigger is planted and waits; the shoes are still on.
    await page(win).getByRole('combobox', { name: 'As of which scene' }).click()
    await win.getByRole('option', { name: /Ch 1, Sc 3/ }).click()
    await expect(page(win).getByRole('article', { name: /banana/ })).toContainText('Waiting for its trigger')
    await expect(page(win)).toContainText('Wears, by command: no socks, no bra')
    await expect(page(win).getByRole('complementary', { name: 'Triggers waiting' })).toContainText('When she hears the word \'banana\'')
    await shot(win, '3-trigger-waiting')

    // Adam ends one himself from a scene on, and can take it back.
    await page(win).getByRole('combobox', { name: 'As of which scene' }).click()
    await win.getByRole('option', { name: 'The end of the story so far' }).click()
    const socks = page(win).getByRole('article', { name: /socks/ })
    await socks.getByRole('button', { name: 'End it…' }).click()
    await socks.getByRole('combobox', { name: 'It ends in' }).click()
    await win.getByRole('option', { name: /Ch 1, Sc 4/ }).click()
    await socks.getByRole('textbox', { name: /A note for yourself/ }).fill('She found her socks again')
    await shot(win, '4-ending-it')
    await socks.getByRole('button', { name: 'End it there' }).click()
    await expect(page(win)).toContainText('Wears, by command: no bra, no shoes')
    await expect(socks).toContainText('Ended by you')
    await shot(win, '5-ended-by-you')

    // The writer is told, for a scene with Tam in it.
    const preview = await invoke(win, 'previewContext', ids[4], { direction: '', targetWords: null, creativity: 'balanced' })
    const block = preview.blocks.find((b) => b.id === 'commands')
    expect(block?.title).toBe('Under suggestion')
    expect(block?.text).toContain('Tam Hollis wears, by command: no bra, no shoes.')
    expect(block?.text).not.toContain('no socks')
  } finally {
    await fake.close()
  }
})
