// The character builder on the desk (UI overhaul, the builder and entry editing), on the sample world with the fake AI:
// it can be found (the World room's New entry menu, the empty portrait after the characters, the dossier, the story
// home's cast, the palette), its steps change on one click each, an idea picked from the AI fills its field, a kept
// suggestion too, Review shows the finished card, and with less motion nothing slides.
import type { ElectronApplication, Page } from '@playwright/test'
import type { Entry } from '@shared/types'
import { expect, invoke, startFake, test, useFakeModel, type LaunchOptions } from './helpers'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk', AIWRITE_KEEPER_QUIET_MS: '600000' }
const room = (win: Page, name: string) => win.getByRole('navigation', { name: 'Rooms' }).getByRole('button', { name: new RegExp(`^${name}`) })
const card = (win: Page, name: string) => win.locator(`[data-gallery-card][aria-label^="${name},"]`).first()
const dossier = (win: Page) => win.getByRole('dialog').filter({ has: win.locator('.dz') })
const steps = (win: Page) => win.getByRole('navigation', { name: 'Steps' })
const step = (win: Page, name: string) => steps(win).getByRole('button', { name: new RegExp(`^${name}\\b`) })
const heading = (win: Page) => win.locator('.bld').getByRole('heading', { level: 1 })

async function sampleWorld(
  launch: (o?: LaunchOptions) => Promise<{ app: ElectronApplication; win: Page; dataDir: string }>
): Promise<{ app: ElectronApplication; win: Page }> {
  const a = await launch({ env: DESK })
  await expect(a.win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(a.win, 'openSampleWorld')
  await a.win.reload()
  await expect(a.win.locator('.scene-prose')).toContainText('A hundred and twelve steps to the lamp room.')
  return a
}

async function entryNamed(win: Page, name: string): Promise<Entry> {
  await expect.poll(async () => (await invoke(win, 'listEntries')).some((e) => e.name === name)).toBe(true)
  return (await invoke(win, 'listEntries')).find((e) => e.name === name)!
}

/** Iska Vey's builder, from her dossier's "Build with AI". */
async function iskasBuilder(win: Page): Promise<void> {
  await room(win, 'World').click()
  await card(win, 'Iska Vey').click()
  await expect(dossier(win)).toBeVisible()
  await dossier(win).getByRole('button', { name: 'Build with AI' }).click()
  await expect(heading(win)).toHaveText('Basics')
}

test('the builder can be found: the New entry menu, the empty portrait, the dossier, the story home, the palette', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  await room(win, 'World').click()
  await expect(card(win, 'Iska Vey')).toBeVisible()

  // The New entry menu has the builders, by name.
  await win.getByRole('button', { name: 'New entry' }).click()
  const menu = win.getByRole('menu')
  for (const label of ['Build a character with AI', 'Build a place with AI', 'Build a group with AI', 'Build an item with AI', 'Quick start from a few notes'])
    await expect(menu.getByRole('menuitem', { name: label })).toBeVisible()
  await win.keyboard.press('Escape')

  // An empty portrait after the characters opens the steps, explained the first time.
  const slot = win.locator('.g-sec[data-kind="character"]').getByRole('button', { name: /^Build a character with AI/ })
  await expect(slot).toBeVisible()
  await slot.click()
  await expect(heading(win)).toHaveText('Basics')
  await expect(win.getByRole('note')).toContainText('the AI can suggest each part')
  await win.getByRole('button', { name: 'Got it, hide this' }).click()
  await expect(win.getByRole('note')).toHaveCount(0)

  // The dossier says it in words.
  await room(win, 'World').click()
  await card(win, 'Wren Halloway').click()
  await expect(dossier(win).getByRole('button', { name: 'Build with AI' })).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(dossier(win)).toHaveCount(0)

  // The story home's cast.
  await win.getByRole('button', { name: 'Story home' }).click()
  await win.getByRole('button', { name: 'Build a character with AI' }).click()
  await expect(heading(win)).toHaveText('Basics')
  // Once read, the line about the builder doesn't come back.
  await expect(win.getByRole('note')).toHaveCount(0)

  // The palette finds it under "builder".
  await win.keyboard.press('Control+K')
  await win.keyboard.type('builder')
  await expect(win.getByRole('option', { name: /^Build a place with AI/ })).toBeVisible()
  await win.getByRole('option', { name: /^Build a place with AI/ }).click()
  await expect(win.locator('.bld')).toHaveAttribute('data-kind', 'place')
  await expect(heading(win)).toHaveText('Basics')
})

test('each step opens on one click, sliding in from its side; the rail counts what is filled', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  await iskasBuilder(win)
  // Basics: her name in the band, its fields in cards, an example in an empty box.
  await expect(win.locator('.bld-band')).toContainText('Iska Vey')
  await expect(win.getByRole('region', { name: 'The essentials' })).toBeVisible()
  await expect(win.getByLabel('Age or birth date', { exact: true })).toHaveAttribute('placeholder', 'e.g. 34')
  for (const s of ['Looks', 'Personality', 'Backstory and secrets', 'Goals and arc', 'Voice', 'Relationships', 'Review', 'Basics']) {
    await step(win, s).click()
    await expect(heading(win)).toHaveText(s)
    await expect(step(win, s)).toHaveAttribute('aria-current', 'step')
  }
  // Going forward slides in from the right, back from the left.
  await step(win, 'Looks').click()
  await expect(win.locator('.bld-step')).toHaveAttribute('data-dir', 'fwd')
  await step(win, 'Basics').click()
  await expect(win.locator('.bld-step')).toHaveAttribute('data-dir', 'back')
  // From the keyboard, at once.
  await step(win, 'Personality').focus()
  await win.keyboard.press('Enter')
  await expect(heading(win)).toHaveText('Personality')
  await expect(win.locator('.bld-step')).not.toHaveAttribute('data-dir', /./)

  // Typing in a field counts on the rail.
  await expect(step(win, 'Personality')).toContainText('Not started')
  await win.getByLabel('Core traits', { exact: true }).fill('Careful with words, careless with her own safety.')
  await expect(step(win, 'Personality')).toContainText('1 of 7')
})

test('an idea from the AI fills its field, a kept suggestion too, and Review shows the finished card', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await sampleWorld(launch)
    await useFakeModel(win, fake)
    await iskasBuilder(win)

    // Ideas: three takes on one field, in the AI's amber; the one picked is in the field and saved.
    await step(win, 'Backstory and secrets').click()
    const ideasButton = win.getByRole('button', { name: 'Ask the AI for ideas for Origin' })
    await expect(ideasButton).toHaveText('Ideas')
    await expect(ideasButton).toHaveAttribute('title', /three different takes on origin/)
    await ideasButton.click()
    const ideas = win.getByRole('group', { name: 'Ideas for Origin' })
    await expect(ideas.getByRole('listitem')).toHaveCount(3)
    await expect(ideas.getByRole('button', { name: 'Use idea 2 for Origin' })).toBeEnabled()
    await ideas.getByRole('button', { name: 'Use idea 2 for Origin' }).click()
    await expect(ideas).toHaveCount(0)
    const second = 'Origin, second option: something only Iska Vey would have.'
    await expect(win.getByLabel('Origin', { exact: true })).toHaveValue(second)
    await expect.poll(async () => (await entryNamed(win, 'Iska Vey')).fields.origin).toBe(second)

    // Flesh out: suggestions for the step's empty fields; one kept is in its field.
    await step(win, 'Goals and arc').click()
    await win.getByRole('button', { name: 'Flesh out with AI' }).click()
    const wants = win.getByRole('group', { name: 'Suggestion for What they want' })
    await expect(wants).toBeVisible()
    await win.getByRole('button', { name: 'Keep the suggestion for What they want' }).click()
    await expect(win.getByLabel('What they want', { exact: true })).toHaveValue('Suggested what they want for Iska Vey.')
    await expect.poll(async () => (await entryNamed(win, 'Iska Vey')).fields.wants).toBe('Suggested what they want for Iska Vey.')

    // Review: the finished card, large, beside every step's words; Save opens her page.
    await step(win, 'Review').click()
    const finished = win.getByRole('img', { name: /^Iska Vey, as their card will show in the world/ })
    await expect(finished).toBeVisible()
    await expect(finished).toContainText('A clerk of the Harbour Board')
    await expect(win.getByRole('region', { name: 'Backstory and secrets' })).toContainText(second)
    await win.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dossier(win)).toBeVisible()
  } finally {
    await fake.close()
  }
})

test('with less motion, a step is simply there and the drawing stays still', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  await win.emulateMedia({ reducedMotion: 'reduce' })
  await iskasBuilder(win)
  await step(win, 'Looks').click()
  await expect(heading(win)).toHaveText('Looks')
  await expect(win.locator('.bld-step')).not.toHaveAttribute('data-dir', /./)
  const moving = await win.evaluate<string[]>(
    `['.bld-medal', '.bld-medal-halo', '.bld-step'].map((s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).animationName : 'none' })`
  )
  expect(moving).toEqual(['none', 'none', 'none'])
  await win.emulateMedia({ reducedMotion: 'no-preference' })
})
