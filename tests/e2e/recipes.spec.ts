// Story recipes, end to end with the fake AI server (tests/fake-provider/recipes.mjs): a made-up story pasted in and
// split into chapters, the recipe made in the background (the fake lets a name slip, which never reaches the
// recipe), the recipe library and its files outside every world, then a new story planned from the recipe with
// Adam's own guidance, its premise and chapters kept, and the recipe's style in the story's style guide.
import Database from 'better-sqlite3'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { binder, createWorldFromWelcome, expect, invoke, startFake, test } from './helpers'

// A made-up story, written for this test.
const STORY = `Chapter 1

The ferry came into Varn Harbour late, and the woman called Mara was the last one off it. She stood on the quay with her one bag and watched the gulls fight over a crust.

Nobody had come to meet her. She had written to Tobin twice, and twice he had not answered.

Chapter 2

The lodging house smelled of soap and old smoke. The landlady, a sharp woman named Edda, looked at Mara for a long time before she named a price.

That night the wind turned and the shutters knocked until morning.

Chapter 3

Tobin found her at last by the net lofts, three days later, with an apology he had clearly practised. Mara let him finish it before she laughed.

They walked out along the long pier together while the tide went out.`

const main = (win: Page) => win.locator('main')

async function palette(win: Page, words: string): Promise<void> {
  await win.keyboard.press('Control+K')
  await win.keyboard.type(words)
  await win.keyboard.press('Enter')
}

test('a pasted story becomes a recipe with none of its names, and a new story is planned from it', async ({ launch }) => {
  test.setTimeout(150_000)
  const fake = await startFake()
  try {
    const { win, dataDir } = await launch()
    await createWorldFromWelcome(win, 'Grey Coast')
    const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
    const writer = { providerId: p.id, modelId: 'fake/writer', label: 'Fake writer', contextLength: 32000, promptPrice: 0.000003, completionPrice: 0.000015 }
    await invoke(win, 'updateSettings', { models: { writer } })
    await win.reload()
    await expect(win.locator('.scene-prose')).toBeVisible()

    // The recipe library, from the palette: empty to start with.
    await palette(win, 'Story recipes')
    await expect(main(win).getByRole('heading', { level: 1, name: 'Story recipes' })).toBeVisible()
    await expect(main(win).getByText('the story’s themes, writing style and structure, without its words', { exact: false }).first()).toBeVisible()
    await expect(main(win).getByText('No recipes yet')).toBeVisible()

    // Make one: the story pasted in, split into its three chapters, and what it costs before anything is sent.
    await main(win).getByRole('button', { name: 'Make a recipe from a story' }).click()
    await main(win).getByRole('radio', { name: 'Paste the text' }).click()
    await main(win).getByLabel('The story’s text').fill(STORY)
    await main(win).getByRole('button', { name: 'Read it' }).click()
    await expect(main(win).getByText('3 chapters, 3 scenes')).toBeVisible()
    await expect(main(win).getByRole('listitem', { name: 'Chapter: Chapter 2' })).toBeVisible()
    await expect(main(win).getByText(/(About \$[\d.]+|Less than a cent) with Fake writer, to read 3 chapters/)).toBeVisible()
    await main(win).getByRole('button', { name: 'Make the recipe' }).click()

    // It is made in the background; its page fills in once it is ready, under the name the AI suggested.
    await expect(main(win).getByLabel('The recipe’s name')).toHaveValue('A quiet coastal mystery', { timeout: 60_000 })
    const cast = main(win).getByRole('textbox', { name: 'Cast roles', exact: true })
    await expect(cast).toHaveValue(/The lead: an outsider who learns to stay\./)
    await expect(main(win).getByRole('textbox', { name: 'Point of view', exact: true })).toHaveValue('Close third person, one character at a time')
    for (const part of ['Themes', 'Writing style', 'Sample passage', 'Shape', 'Beats', 'Cast roles', 'Pacing', 'Devices']) {
      await expect(main(win).getByRole('textbox', { name: part, exact: true })).not.toHaveValue(/Mara|Tobin|Edda|Varn/)
    }

    // The library lists it, with the story's length, never its title or names.
    await main(win).getByRole('button', { name: 'Back to the recipe library' }).click()
    const list = main(win).getByRole('list', { name: 'Recipes' })
    await expect(list.getByRole('listitem')).toHaveCount(1)
    await expect(list.getByText('A quiet coastal mystery')).toBeVisible()
    await expect(list.getByText(/From a story of 3 chapters/)).toBeVisible()

    // On this computer only, in the library's Recipes folder, outside every world; its spending has no words.
    const recipes = join(dataDir, 'library', 'Recipes')
    const ids = readdirSync(recipes).filter((n) => /^[0-9a-f-]{36}$/.test(n))
    expect(ids).toHaveLength(1)
    expect(JSON.parse(readFileSync(join(recipes, ids[0], 'recipe.json'), 'utf8')).name).toBe('A quiet coastal mystery')
    expect(existsSync(join(recipes, ids[0], 'source.json'))).toBe(true)
    expect(existsSync(join(recipes, ids[0], 'making.json'))).toBe(false)
    expect((await invoke(win, 'listWorlds')).map((w) => w.name)).toEqual(['Grey Coast'])
    const ledger = new Database(join(recipes, 'spending.db'), { readonly: true })
    try {
      const rows = ledger.prepare('SELECT job, messages_json, response, prompt_tokens FROM generations').all() as { job: string; messages_json: string; response: string }[]
      expect(rows.length).toBe(5)
      expect(rows.every((r) => r.job === 'recipe' && r.messages_json === '[]' && !/Mara|ferry/i.test(r.response))).toBe(true)
    } finally {
      ledger.close()
    }
    const world = (await invoke(win, 'getWorld'))!
    const worldDb = new Database(join(world.folder, 'world.db'), { readonly: true })
    try {
      expect((worldDb.prepare("SELECT count(*) AS n FROM generations WHERE messages_json LIKE '%Varn Harbour%'").get() as { n: number }).n).toBe(0)
    } finally {
      worldDb.close()
    }
    const usage = await invoke(win, 'getUsage', { period: 'this-month', scope: 'library' })
    expect(usage.jobs.map((j) => j.label)).toContain('Story recipes')
    expect(usage.worlds).toBe(1)

    // A new story from it: the New story dialog opens with the recipe picked, and Adam adds his own guidance.
    await list.getByRole('button', { name: /^A quiet coastal mystery From/ }).click()
    await main(win).getByRole('button', { name: 'Start a new story from it' }).click()
    const dialog = win.getByRole('dialog', { name: 'New story' })
    await expect(dialog.getByLabel('From a recipe')).toContainText('A quiet coastal mystery')
    await dialog.getByLabel('Title').fill('Station Nine')
    await dialog.getByLabel('Your own ideas for it').fill('set it on a space station')
    await dialog.getByRole('button', { name: 'Create' }).click()
    await expect(dialog).toBeHidden()

    // The plan page: the premise (carrying his guidance) and the chapters arrive as suggestions to keep.
    await expect(main(win).getByRole('heading', { level: 1, name: 'Plan “Station Nine”' })).toBeVisible()
    const premise = main(win).getByRole('region', { name: 'Suggested premise' })
    await expect(premise).toContainText('Set as asked: set it on a space station', { timeout: 30_000 })
    await expect(main(win).getByText(/Here is the plan:/)).toBeVisible({ timeout: 30_000 })
    await premise.getByRole('button', { name: 'Keep' }).click()
    await expect(premise.getByText('Kept')).toBeVisible()
    await main(win).getByRole('button', { name: 'Keep all that’s left' }).click()
    await expect(binder(win).getByText('Grey Water', { exact: true })).toBeVisible()

    // An ordinary story: its premise, its chapters, and the recipe's style and themes as its own.
    const stories = await invoke(win, 'listStories')
    const story = stories.find((s) => s.title === 'Station Nine')!
    expect(story.premise).toContain('space station')
    expect(story.style.pov).toBe('Close third person, one character at a time')
    expect(story.style.samplePassage).toContain('The kettle had boiled twice')
    expect(story.tone).toBe('Quiet, wry and hopeful')
    expect(story.themes).toContain('Belonging')
    expect(story.style.genres).toEqual(['mystery', 'cosy'])
    expect(story.style.intensity).toEqual({ violence: 2, language: 2 })
    const outline = await invoke(win, 'getOutline', story.id)
    expect(outline.chapters.map((c) => c.title)).toContain('Grey Water')
    expect(outline.scenes.length).toBeGreaterThan(3)
  } finally {
    await fake.close()
  }
})
