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
const quickStart = (win: Page) => win.getByRole('heading', { level: 1, name: /from a few notes$/ })

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
  for (const label of ['Build a character with AI', 'Build a place with AI', 'Build a group with AI', 'Build an item with AI'])
    await expect(menu.getByRole('menuitem', { name: label })).toBeVisible()
  await win.keyboard.press('Escape')

  // An empty portrait after the characters opens Quick start: a few notes, then the AI's questions.
  const slot = win.locator('.g-sec[data-kind="character"]').getByRole('button', { name: /^Build a character with AI/ })
  await expect(slot).toBeVisible()
  await slot.click()
  await expect(quickStart(win)).toHaveText('Build a character from a few notes')
  await expect(win.getByRole('button', { name: 'Next: a few questions' })).toBeVisible()
  // The steps are one click away, explained the first time.
  await win.getByRole('button', { name: 'Go step by step instead' }).click()
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
  await expect(quickStart(win)).toHaveText('Build a character from a few notes')

  // The palette finds it under "builder".
  await win.keyboard.press('Control+K')
  await win.keyboard.type('builder')
  await expect(win.getByRole('option', { name: /^Build a place with AI/ })).toBeVisible()
  await win.getByRole('option', { name: /^Build a place with AI/ }).click()
  await expect(quickStart(win)).toHaveText('Build a place from a few notes')
  // Once read, the line about the builder doesn't come back.
  await win.getByRole('button', { name: 'Go step by step instead' }).click()
  await expect(win.locator('.bld')).toHaveAttribute('data-kind', 'place')
  await expect(heading(win)).toHaveText('Basics')
  await expect(win.getByRole('note')).toHaveCount(0)
})

test('a few notes, a few questions from the AI (answered, left to it, skipped), and the finished character at Review', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await sampleWorld(launch)
    await useFakeModel(win, fake)
    await win.getByRole('button', { name: 'Story home' }).click()
    await win.getByRole('button', { name: 'Build a character with AI' }).click()
    await expect(quickStart(win)).toHaveText('Build a character from a few notes')
    await win.getByLabel('What you know about them').fill('Tamsin Rook is the ferry’s bell-ringer.\nShe never sleeps on land.')
    await win.getByRole('button', { name: 'Next: a few questions' }).click()

    // The AI's questions come one at a time in its amber bubbles; the notes wait, not to be typed over.
    const chat = win.getByRole('region', { name: 'Follow-up questions' })
    await expect(chat).toContainText('A few quick questions')
    await expect(chat).toContainText('Question 1 of 3')
    await expect(chat).toContainText('What does Tamsin want most right now?')
    await expect(win.getByLabel('What you know about them')).not.toBeEditable()
    const answer = win.getByRole('textbox', { name: /^Your answer/ })
    await expect(answer).toBeFocused()
    // His answer, in a line (Enter answers).
    await answer.fill('To hear the bell ring true once more.')
    await win.keyboard.press('Enter')
    await expect(chat.locator('.qs-me')).toHaveText('To hear the bell ring true once more.')
    await expect(chat).toContainText('What is Tamsin afraid of?')
    // Left to the AI.
    await win.getByRole('button', { name: 'Let the AI decide' }).click()
    await expect(chat.getByText('Left to the AI')).toBeVisible()
    await expect(chat).toContainText('What does Tamsin do without thinking?')
    // Skipped.
    await win.getByRole('button', { name: 'Skip', exact: true }).click()
    await expect(chat.getByText('Skipped')).toBeVisible()
    await expect(chat).toContainText('That’s plenty to go on.')

    // Built from the notes and the answers, it opens at Review with the finished card.
    await win.getByRole('button', { name: 'Build the character' }).click()
    await expect(heading(win)).toHaveText('Review')
    const finished = win.getByRole('img', { name: /^Tamsin Rook, as their card will show in the world/ })
    await expect(finished).toBeVisible()
    const e = await entryNamed(win, 'Tamsin Rook')
    expect(e.fields.wants).toBe('To hear the bell ring true once more.')
    expect(e.fieldOrigins.wants ?? e.origin).toBe('adam')
    expect(e.fields.fears).toBe('Fears of Tamsin Rook, decided by the AI.')
    expect(e.fieldOrigins.fears).toBe('ai')
    // The skipped one was drafted as any other field.
    expect(e.fields.habits).toBe('Habits and quirks of Tamsin Rook, drafted to fit the world.')
    await expect(win.getByRole('region', { name: 'Goals and arc' })).toContainText('To hear the bell ring true once more.')
  } finally {
    await fake.close()
  }
})

test('the questions can be skipped all at once, or the notes changed first', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await sampleWorld(launch)
    await useFakeModel(win, fake)
    await room(win, 'World').click()
    await win.getByRole('button', { name: 'New entry' }).click()
    await win.getByRole('menuitem', { name: 'Build a character with AI' }).click()
    const notes = win.getByLabel('What you know about them')
    await notes.fill('Orrin Vale, who mends nets.')
    await notes.press('Control+Enter')
    const chat = win.getByRole('region', { name: 'Follow-up questions' })
    await expect(chat).toContainText('What does Orrin want most right now?')
    // Change my notes goes back to them, as they were.
    await win.getByRole('button', { name: 'Change my notes' }).click()
    await expect(chat).toHaveCount(0)
    await expect(notes).toBeEditable()
    await notes.fill('Orrin Vale, who mends nets for the whole harbour.')
    await win.getByRole('button', { name: 'Next: a few questions' }).click()
    await expect(chat).toContainText('Question 1 of 3')
    await win.getByRole('button', { name: 'Skip the rest' }).click()
    await expect(chat.getByText('Skipped')).toHaveCount(3)
    await win.getByRole('button', { name: 'Build the character' }).click()
    await expect(heading(win)).toHaveText('Review')
    const e = await entryNamed(win, 'Orrin Vale')
    expect(e.summary).toBe('Orrin Vale, who mends nets for the whole harbour.')
    expect(e.fields.wants).toBe('What they want of Orrin Vale, drafted to fit the world.')
  } finally {
    await fake.close()
  }
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
