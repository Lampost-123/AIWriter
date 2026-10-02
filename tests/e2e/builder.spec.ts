// The character builder and the lighter builders (milestone 3), against the fake AI server, whose
// builder replies are made from the notes and prompts (tests/fake-provider/server.mjs, fakeBuilderReply).
import type { Page } from '@playwright/test'
import type { Entry } from '@shared/types'
import { binder, createWorldFromWelcome, expect, invoke, startFake, test, useFakeModel } from './helpers'

const NOTES = `Brann Holt runs the ferry across the Narrows.
A grumpy ex-soldier who owes the Duke money.
Missing two fingers on his left hand.`

const main = (win: Page) => win.locator('main')
const steps = (win: Page) => win.getByRole('navigation', { name: 'Steps' })
const step = (win: Page, name: string) => steps(win).getByRole('button', { name: new RegExp(`^${name}\\b`) })

async function entryNamed(win: Page, name: string): Promise<Entry> {
  await expect.poll(async () => (await invoke(win, 'listEntries')).some((e) => e.name === name)).toBe(true)
  return (await invoke(win, 'listEntries')).find((e) => e.name === name)!
}

const origin = (e: Entry, key: string): string => e.fieldOrigins[key] ?? e.origin

/** Opens the builder for a new entry the way Adam does: the list's Quick start, then (if asked) the steps. */
async function openBuilder(win: Page, list: 'Characters' | 'Places', opts: { guided?: boolean } = {}): Promise<void> {
  await binder(win).getByRole('button', { name: list }).click()
  await main(win).getByRole('button', { name: 'Quick start from a few notes' }).click()
  await expect(main(win).getByRole('heading', { name: /from a few notes$/ })).toBeVisible()
  if (opts.guided) {
    await main(win).getByRole('button', { name: 'Go step by step instead' }).click()
    await expect(main(win).getByRole('heading', { level: 1, name: 'Basics' })).toBeVisible()
  }
}

test('a full character is built from a few lines of notes with one click, and survives a restart', async ({ launch }) => {
  const fake = await startFake()
  try {
    const first = await launch()
    const { win } = first
    await createWorldFromWelcome(win, 'Builder')
    await useFakeModel(win, fake)

    await openBuilder(win, 'Characters')
    await main(win).getByLabel('What you know about them').fill(NOTES)
    await main(win).getByRole('button', { name: 'Build the character' }).click()
    await expect(main(win).getByRole('status').filter({ hasText: 'Brann Holt is built and saved.' })).toBeVisible()

    // The finished profile shows which words are his and which the AI drafted.
    const profile = main(win).getByRole('region', { name: 'The profile so far' })
    await expect(profile).toContainText('A grumpy ex-soldier who owes the Duke money.')
    await expect(profile.getByText('Your words')).toHaveCount(4)
    await expect(profile.getByText('Drafted by AI').first()).toBeVisible()

    // Saved: his words exactly as written and his; the rest drafted by AI. Made by Adam, so it's never cleared away.
    const e = await entryNamed(win, 'Brann Holt')
    expect(e.origin).toBe('adam')
    expect(e.summary).toBe('Brann Holt runs the ferry across the Narrows.')
    expect(e.fields.traits).toBe('A grumpy ex-soldier who owes the Duke money.')
    expect(e.fields.marks).toBe('Missing two fingers on his left hand.')
    for (const k of ['name', 'summary', 'traits', 'marks']) expect(origin(e, k)).toBe('adam')
    expect(e.fields.hair).toBe('Hair of Brann Holt, drafted to fit the world.')
    for (const k of ['hair', 'origin', 'wants', 'speech', 'sampleLines', 'description']) expect(origin(e, k)).toBe('ai')

    // Looking it over step by step: the AI's fields say so.
    await main(win).getByRole('button', { name: 'Look it over step by step' }).click()
    await expect(main(win).getByRole('textbox', { name: 'Name' })).toHaveValue('Brann Holt')
    await step(win, 'Looks').click()
    await expect(main(win).getByLabel('Hair', { exact: true })).toHaveValue('Hair of Brann Holt, drafted to fit the world.')
    await expect(main(win).getByText('Drafted by AI').first()).toBeVisible()
    await first.close()

    const second = await launch({ dataDir: first.dataDir })
    await expect(binder(second.win)).toBeVisible()
    const again = await entryNamed(second.win, 'Brann Holt')
    expect(again.fields.marks).toBe('Missing two fingers on his left hand.')
    expect(origin(again, 'marks')).toBe('adam')
    expect(origin(again, 'hair')).toBe('ai')
    // Its page says which fields the AI drafted.
    await binder(second.win).getByRole('button', { name: 'Characters' }).click()
    await main(second.win).getByRole('listbox', { name: 'Characters' }).getByRole('option', { name: /^Brann Holt/ }).click()
    await expect(main(second.win).getByText('Drafted by AI').first()).toBeVisible()
  } finally {
    await fake.close()
  }
})

test('Stop during Quick start keeps what had fully arrived, saved', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Builder')
    await useFakeModel(win, fake, 'fake/slow')

    await openBuilder(win, 'Characters')
    await main(win).getByLabel('What you know about them').fill(NOTES)
    await main(win).getByRole('button', { name: 'Build the character' }).click()
    const profile = main(win).getByRole('region', { name: 'The profile so far' })
    await expect(profile.getByText('Saved', { exact: true })).toBeVisible()
    await main(win).getByRole('button', { name: 'Stop' }).click()
    await expect(main(win).getByRole('status').filter({ hasText: 'Stopped. What had fully arrived is saved.' })).toBeVisible()

    const e = await entryNamed(win, 'Brann Holt')
    // Only whole fields were kept: none of them stops part way.
    const fields = Object.entries(e.fields).filter(([, v]) => v)
    expect(fields.length).toBeLessThan(30)
    for (const [k, v] of fields) {
      if (k === 'sampleLines' || k === 'role' || origin(e, k) === 'adam') continue
      expect(v).toMatch(/drafted to fit the world\.$/)
    }
    // The finished profile can still be opened and walked through.
    await main(win).getByRole('button', { name: 'Look it over step by step' }).click()
    await expect(main(win).getByRole('textbox', { name: 'Name' })).toHaveValue('Brann Holt')
  } finally {
    await fake.close()
  }
})

test('Flesh out fills only the empty fields, with Keep and Discard on each', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Builder')
    await useFakeModel(win, fake)

    // Leaving before a name is typed leaves nothing behind.
    await openBuilder(win, 'Characters', { guided: true })
    await main(win).getByLabel('Pronouns', { exact: true }).fill('she/her')
    await binder(win).getByRole('button', { name: 'Places' }).click()
    await expect(main(win).getByRole('heading', { name: 'No places yet' })).toBeVisible()
    expect(await invoke(win, 'listEntries')).toEqual([])

    await openBuilder(win, 'Characters', { guided: true })
    await main(win).getByRole('textbox', { name: 'Name' }).fill('Mara Venn')
    await expect(step(win, 'Basics')).toBeVisible()
    await step(win, 'Looks').click()
    await expect(main(win).getByRole('heading', { level: 1, name: 'Looks' })).toBeVisible()
    await main(win).getByLabel('Build', { exact: true }).fill('Tall and wiry')
    await main(win).getByRole('button', { name: 'Flesh out with AI' }).click()

    // Suggestions for the empty fields only; his words stay as they are.
    const hair = main(win).getByRole('group', { name: 'Suggestion for Hair' })
    await expect(hair).toContainText('Suggested hair for Mara Venn.')
    await expect(main(win).getByRole('group', { name: 'Suggestion for Build' })).toHaveCount(0)
    await expect(main(win).getByLabel('Build', { exact: true })).toHaveValue('Tall and wiry')
    await expect(main(win).getByText(/suggestions to look at$/)).toBeVisible()
    // The step shows suggestions are waiting.
    await expect(step(win, 'Looks')).toHaveAccessibleName(/suggestions waiting/)

    await main(win).getByRole('button', { name: 'Keep the suggestion for Hair' }).click()
    await expect(main(win).getByLabel('Hair', { exact: true })).toHaveValue('Suggested hair for Mara Venn.')
    await main(win).getByRole('button', { name: 'Discard the suggestion for Eyes' }).click()
    await expect(main(win).getByLabel('Eyes', { exact: true })).toHaveValue('')
    await expect(main(win).getByRole('group', { name: 'Suggestion for Eyes' })).toHaveCount(0)

    await expect.poll(async () => (await entryNamed(win, 'Mara Venn')).fields.hair).toBe('Suggested hair for Mara Venn.')
    let e = await entryNamed(win, 'Mara Venn')
    expect(origin(e, 'hair')).toBe('ai')
    expect(origin(e, 'build')).toBe('adam')
    expect(e.fields.build).toBe('Tall and wiry')
    expect(e.fields.eyes ?? '').toBe('')
    expect(e.fields.face ?? '').toBe('')

    // Keep all takes the rest; changing a kept field makes it his.
    await main(win).getByRole('button', { name: 'Keep all' }).click()
    await expect(main(win).getByRole('group', { name: /^Suggestion for/ })).toHaveCount(0)
    await main(win).getByLabel('Hair', { exact: true }).fill('Black, cut short')
    await expect(main(win).getByText('Changed by you')).toBeVisible()
    await main(win).getByLabel('Face', { exact: true }).focus()
    await expect.poll(async () => origin(await entryNamed(win, 'Mara Venn'), 'hair')).toBe('adam')
    e = await entryNamed(win, 'Mara Venn')
    expect(e.fields.face).toBe('Suggested face for Mara Venn.')
    expect(origin(e, 'face')).toBe('ai')
    await expect(step(win, 'Looks')).toHaveAccessibleName(/partly done|complete/)
  } finally {
    await fake.close()
  }
})

test('Give me options offers three, and the one picked is kept', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Builder')
    await useFakeModel(win, fake)
    await openBuilder(win, 'Characters', { guided: true })
    await main(win).getByRole('textbox', { name: 'Name' }).fill('Mara Venn')
    await step(win, 'Backstory and secrets').click()
    await main(win).getByLabel('Origin', { exact: true }).fill('Born on a barge')
    await main(win).getByRole('button', { name: 'Give me options for Origin' }).click()

    const options = main(win).getByRole('group', { name: 'Options for Origin' })
    const second = 'Origin, second option: something only Mara Venn would have.'
    await expect(options.getByRole('listitem')).toHaveCount(3)
    await expect(options).toContainText('Origin, third option: something only Mara Venn would have.')
    await options.getByRole('button', { name: 'Use option 2 for Origin' }).click()
    await expect(options).toHaveCount(0)
    await expect(main(win).getByLabel('Origin', { exact: true })).toHaveValue(second)

    await expect.poll(async () => (await entryNamed(win, 'Mara Venn')).fields.origin).toBe(second)
    expect(origin(await entryNamed(win, 'Mara Venn'), 'origin')).toBe('ai')
    // Closing a list of options leaves the field as it was.
    await main(win).getByRole('button', { name: 'Give me options for Secrets they keep' }).click()
    await expect(main(win).getByRole('group', { name: 'Options for Secrets they keep' }).getByRole('listitem')).toHaveCount(3)
    await main(win).getByRole('button', { name: 'Close the options for Secrets they keep' }).click()
    await expect(main(win).getByLabel('Secrets they keep', { exact: true })).toHaveValue('')
  } finally {
    await fake.close()
  }
})

test('Interview: the character answers in character, and a reply becomes a sample line in one click', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Builder')
    await useFakeModel(win, fake)
    await openBuilder(win, 'Characters', { guided: true })
    await main(win).getByRole('textbox', { name: 'Name' }).fill('Brann Holt')
    await step(win, 'Voice').click()
    await main(win).getByRole('button', { name: 'Interview Brann Holt' }).click()

    const panel = win.getByRole('complementary', { name: 'Interview' })
    await panel.getByRole('textbox', { name: 'Ask Brann Holt something' }).fill('What do you think of the Duke?')
    await win.keyboard.press('Enter')
    const reply = 'You want to know about the Duke? I\'ll say this once: I keep my own counsel, and I pay my debts.'
    await expect(panel.getByRole('list', { name: 'Conversation' })).toContainText(reply)
    await panel.getByRole('button', { name: 'Save as a sample line' }).click()
    await expect(panel.getByText('Saved as a sample line')).toBeVisible()
    await expect(main(win).getByLabel('Sample lines of dialogue', { exact: true })).toHaveValue(`"${reply}"`)

    await expect.poll(async () => (await entryNamed(win, 'Brann Holt')).fields.sampleLines).toBe(`"${reply}"`)
    expect(origin(await entryNamed(win, 'Brann Holt'), 'sampleLines')).toBe('adam')
  } finally {
    await fake.close()
  }
})

test('a place goes through the lighter builder, step by step, to its page', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Builder')
    await useFakeModel(win, fake)
    await openBuilder(win, 'Places', { guided: true })
    await expect(steps(win).getByRole('button')).toHaveText([
      'Quick start from notes',
      /^Basics/,
      /^Look and feel/,
      /^Sights, sounds and smells/,
      /^History/,
      /^Who is there/,
      /^Review/
    ])
    await main(win).getByRole('textbox', { name: 'Name' }).fill('Saltmere')
    await main(win).getByRole('button', { name: 'Next: Look and feel' }).click()
    await main(win).getByLabel('Atmosphere', { exact: true }).fill('Salt, tar and wet rope')
    await main(win).getByRole('button', { name: 'Next: Sights, sounds and smells' }).click()
    await main(win).getByRole('button', { name: 'Flesh out with AI' }).click()
    await main(win).getByRole('button', { name: 'Keep the suggestion for Sights, sounds and smells' }).click()
    const senses = main(win).getByLabel('Sights, sounds and smells', { exact: true })
    await expect(senses).toHaveValue('Suggested sights, sounds and smells for Saltmere.')
    await expect(step(win, 'Sights, sounds and smells')).toHaveAccessibleName(/complete/)

    await step(win, 'Review').click()
    const review = main(win)
    await expect(review.getByRole('region', { name: 'Look and feel' })).toContainText('Salt, tar and wet rope')
    await expect(review.getByRole('region', { name: 'Sights, sounds and smells' })).toContainText('Drafted by AI')
    await review.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(main(win).getByRole('textbox', { name: 'Name' })).toHaveValue('Saltmere')
    await expect(main(win).getByRole('listbox', { name: 'Places' })).toContainText('Saltmere')

    const e = await entryNamed(win, 'Saltmere')
    expect(e.kind).toBe('place')
    expect(e.fields.atmosphere).toBe('Salt, tar and wet rope')
    expect(origin(e, 'senses')).toBe('ai')
  } finally {
    await fake.close()
  }
})

test('the builder warns about a near-duplicate name', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Builder')
  await invoke(win, 'createEntry', 'character', { name: 'Mara' })
  await binder(win).getByRole('button', { name: 'Characters' }).click()
  await main(win).getByRole('button', { name: 'Quick start a character from a few notes' }).click()
  await main(win).getByRole('button', { name: 'Go step by step instead' }).click()
  await main(win).getByRole('textbox', { name: 'Name' }).fill('Marra')
  await expect(main(win).getByRole('status').filter({ hasText: 'Very close to Mara, another character. Same one?' })).toBeVisible()
  await main(win).getByRole('textbox', { name: 'Name' }).fill('Marra Holt')
  await expect(main(win).getByText('Same one?')).toHaveCount(0)
})
