// A story planned from a recipe starts with its cast built (Adam, 0.7.4 bug: "it still does not seem to be filling out
// chars info and bio when starting a fresh story built from a recipe by the AI"). The plan names its cast only in its
// premise and summaries, with no "Characters:" lines on its chapter cards, as a real model often answers ("[[fake:
// named cast]]" in the guidance, tests/fake-provider/recipes.mjs). Keeping it still starts the World builder, which
// makes each character with a bio and looks (tests/fake-provider/m4/world.mjs).
import type { Page } from '@playwright/test'
import { createWorldFromWelcome, expect, invoke, startFake, test } from './helpers'

// A made-up story, written for this test.
const STORY = `Chapter 1

The ferry came into Varn Harbour late, and the woman called Mara was the last one off it.

Chapter 2

The lodging house smelled of soap and old smoke. The landlady named a price.

Chapter 3

Tobin found her at last by the net lofts, three days later, with an apology he had clearly practised.`

const main = (win: Page) => win.locator('main')
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')

test('a story planned from a recipe starts with its characters built, each with a bio and looks', async ({ launch }) => {
  test.setTimeout(180_000)
  const fake = await startFake()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Grey Coast')
    const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
    const writer = { providerId: p.id, modelId: 'fake/writer', label: 'Fake writer', contextLength: 32000, promptPrice: null, completionPrice: null }
    await invoke(win, 'updateSettings', { models: { writer } })
    await win.reload()
    await expect(win.locator('.scene-prose')).toBeVisible()

    // A recipe, made from a pasted story through the Recipes pages.
    await win.keyboard.press('Control+K')
    await win.keyboard.type('Story recipes')
    await win.keyboard.press('Enter')
    await main(win).getByRole('button', { name: 'Make a recipe from a story' }).click()
    await main(win).getByRole('radio', { name: 'Paste the text' }).click()
    await main(win).getByLabel('The story’s text').fill(STORY)
    await main(win).getByRole('button', { name: 'Read it' }).click()
    await main(win).getByRole('button', { name: 'Make the recipe' }).click()
    await expect(main(win).getByLabel('The recipe’s name')).toHaveValue('A quiet coastal mystery', { timeout: 60_000 })

    // A new story from it, planned on the plan page, and everything kept.
    await main(win).getByRole('button', { name: 'Start a new story from it' }).click()
    const dialog = win.getByRole('dialog', { name: 'New story' })
    await dialog.getByLabel('Title').fill('The Old Light')
    await dialog.getByLabel('Your own ideas for it').fill('a lighthouse town [[fake: named cast]]')
    await dialog.getByRole('button', { name: 'Create' }).click()
    const premise = main(win).getByRole('region', { name: 'Suggested premise' })
    await expect(main(win).getByText(/Here is the plan:/)).toBeVisible({ timeout: 30_000 })
    await premise.getByRole('button', { name: 'Keep' }).click()
    await main(win).getByRole('button', { name: 'Keep all that’s left' }).click()
    expect(await invoke(win, 'listEntries', 'character')).toEqual([])

    // The World builder lays out the story's cast in the background, and says when it is done.
    await expect(toasts(win).getByText(/^Your story’s world is ready/)).toBeVisible({ timeout: 60_000 })
    const people = await invoke(win, 'listEntries', 'character')
    expect(people.map((e) => e.name).sort()).toEqual(['Ada Lorne', 'Bram Holt'])
    for (const e of people) {
      // A bio, and looks (build, hair...), not a bare name.
      expect(e.summary).not.toBe('')
      expect(e.description).not.toBe('')
      for (const key of ['build', 'hair']) expect(String(e.fields[key] ?? '')).toContain(e.name)
    }
  } finally {
    await fake.close()
  }
})
