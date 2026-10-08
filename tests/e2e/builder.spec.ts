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

type Box = { value: string; placeholder: string; scrollHeight: number; clientHeight: number }

/** The hints of the step's empty one-line boxes that don't fit on their one line. */
const hintsCut = (win: Page): Promise<string[]> =>
  main(win)
    .locator('textarea[rows="1"]')
    .evaluateAll((els) =>
      (els as unknown as Box[]).filter((t) => !t.value && t.scrollHeight > t.clientHeight + 1).map((t) => t.placeholder)
    )

/**
 * Opens the builder for a new entry the way Adam does: the list's Quick start (its empty state's
 * button, or the one in its header once it has entries), then (if asked) the steps.
 */
async function openBuilder(win: Page, list: 'Characters' | 'Places' | 'Items', opts: { guided?: boolean } = {}): Promise<void> {
  await binder(win).getByRole('button', { name: list }).click()
  await main(win)
    .getByRole('button', { name: /^Quick start (an? \w+ )?from a few notes$/ })
    .click()
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
    // He made it, but didn't write all of it: the note at the top says so, and never "You wrote this".
    await expect(main(second.win).getByRole('note')).toHaveText(
      'You made this. What you wrote stays as you wrote it; fields marked Drafted by AI can change with your story.'
    )
    await main(second.win).getByRole('button', { name: 'View as of a scene' }).click()
    await expect(main(second.win).getByText('Nothing has changed by this point.')).toBeVisible()
    await expect(main(second.win).getByText(/^You wrote this[,.]/)).toHaveCount(0)
    // His own words say they are his, beside the AI's.
    await expect(main(second.win).getByText('You wrote this', { exact: true }).first()).toBeVisible()
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
    // The profile only grows at the end: what has arrived stays put while the rest comes in below it.
    const summary = profile.getByText('Short summary', { exact: true })
    await expect(summary).toBeVisible()
    const at = (await summary.boundingBox())!.y
    for (let i = 0; i < 5; i++) {
      await win.waitForTimeout(150)
      expect((await summary.boundingBox())!.y).toBe(at)
    }
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

test('Ideas from the AI offers three, and the one picked is kept', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Builder')
    await useFakeModel(win, fake)
    await openBuilder(win, 'Characters', { guided: true })
    await main(win).getByRole('textbox', { name: 'Name' }).fill('Mara Venn')
    await step(win, 'Backstory and secrets').click()
    await main(win).getByLabel('Origin', { exact: true }).fill('Born on a barge')
    await main(win).getByRole('button', { name: 'Ask the AI for ideas for Origin' }).click()

    const options = main(win).getByRole('group', { name: 'Ideas for Origin' })
    const second = 'Origin, second option: something only Mara Venn would have.'
    await expect(options.getByRole('listitem')).toHaveCount(3)
    await expect(options).toContainText('Origin, third option: something only Mara Venn would have.')
    await options.getByRole('button', { name: 'Use idea 2 for Origin' }).click()
    await expect(options).toHaveCount(0)
    await expect(main(win).getByLabel('Origin', { exact: true })).toHaveValue(second)

    await expect.poll(async () => (await entryNamed(win, 'Mara Venn')).fields.origin).toBe(second)
    expect(origin(await entryNamed(win, 'Mara Venn'), 'origin')).toBe('ai')
    // It replaced his own words, so one click puts them back, as his. The toast sits above the buttons
    // along the foot of the step, and above the interview's question box, never over them.
    const replaced = win.getByText('Replaced origin with the idea you picked.')
    await expect(replaced).toBeVisible()
    const clear = async (below: ReturnType<Page['locator']>): Promise<boolean> => {
      const [t, b] = [await replaced.locator('..').boundingBox(), await below.boundingBox()]
      return !!t && !!b && t.y + t.height <= b.y
    }
    await expect.poll(() => clear(main(win).getByRole('button', { name: 'Flesh out with AI' }))).toBe(true)
    await step(win, 'Voice').click()
    await main(win).getByRole('button', { name: 'Interview Mara Venn' }).click()
    const ask = win.getByRole('complementary', { name: 'Interview' }).getByRole('textbox', { name: 'Ask Mara Venn something' })
    await expect(ask).toBeFocused()
    await expect.poll(() => clear(ask)).toBe(true)
    await win.keyboard.press('Escape')
    await step(win, 'Backstory and secrets').click()
    await win.getByRole('button', { name: 'Undo' }).click()
    await expect(main(win).getByLabel('Origin', { exact: true })).toHaveValue('Born on a barge')
    await expect.poll(async () => (await entryNamed(win, 'Mara Venn')).fields.origin).toBe('Born on a barge')
    expect(origin(await entryNamed(win, 'Mara Venn'), 'origin')).toBe('adam')
    // Closing a list of options leaves the field as it was.
    const secrets = main(win).getByLabel('Secrets they keep', { exact: true })
    const secretOptions = main(win).getByRole('group', { name: 'Ideas for Secrets they keep' })
    await main(win).getByRole('button', { name: 'Ask the AI for ideas for Secrets they keep' }).click()
    await expect(secretOptions.getByRole('listitem')).toHaveCount(3)
    await main(win).getByRole('button', { name: 'Close the ideas for Secrets they keep' }).click()
    await expect(secrets).toHaveValue('')

    // Words the AI drafted that an option replaced go back as the AI's.
    const drafted = 'Secrets they keep, first option: something only Mara Venn would have.'
    await main(win).getByRole('button', { name: 'Ask the AI for ideas for Secrets they keep' }).click()
    await secretOptions.getByRole('button', { name: 'Use idea 1 for Secrets they keep' }).click()
    await expect(secrets).toHaveValue(drafted)
    await main(win).getByRole('button', { name: 'Ask the AI for ideas for Secrets they keep' }).click()
    await secretOptions.getByRole('button', { name: 'Use idea 3 for Secrets they keep' }).click()
    await expect(secrets).toHaveValue('Secrets they keep, third option: something only Mara Venn would have.')
    await expect(win.getByText('Replaced secrets they keep with the idea you picked.')).toBeVisible()
    await win.getByRole('button', { name: 'Undo' }).click()
    await expect(secrets).toHaveValue(drafted)
    await expect.poll(async () => (await entryNamed(win, 'Mara Venn')).fields.secrets).toBe(drafted)
    expect(origin(await entryNamed(win, 'Mara Venn'), 'secrets')).toBe('ai')
    await expect(main(win).getByText('Drafted by AI')).toBeVisible()
  } finally {
    await fake.close()
  }
})

test('Interview: the character answers in character, and a reply becomes a sample line in one click', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { app, win } = await launch()
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
    // The button gave way to "Saved": the keyboard is back in the question box, ready for the next one.
    await expect(panel.getByRole('textbox', { name: 'Ask Brann Holt something' })).toBeFocused()
    await expect(main(win).getByLabel('Sample lines of dialogue', { exact: true })).toHaveValue(`"${reply}"`)

    await expect.poll(async () => (await entryNamed(win, 'Brann Holt')).fields.sampleLines).toBe(`"${reply}"`)
    expect(origin(await entryNamed(win, 'Brann Holt'), 'sampleLines')).toBe('adam')

    // In a narrow window the interview opens over the step, at a width that is still comfortable,
    // rather than squeezing the step beside it. Escape closes it, back to the button that opens it.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 600))
    const rail = (await steps(win).boundingBox())!
    await expect.poll(async () => Math.round((await panel.boundingBox())!.x)).toBe(Math.round(rail.x + rail.width))
    expect((await panel.boundingBox())!.width).toBeGreaterThan(420)
    await panel.getByRole('textbox', { name: 'Ask Brann Holt something' }).focus()
    await win.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(main(win).getByRole('button', { name: 'Interview', exact: true })).toBeFocused()
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
      /^Basics/,
      /^Look and feel/,
      /^Sights, sounds and smells/,
      /^History/,
      /^Who is there/,
      /^Review/,
      'Quick start from notes'
    ])
    const look = await step(win, 'Look and feel').boundingBox()
    await main(win).getByRole('textbox', { name: 'Name' }).fill('Saltmere')
    // Once it is saved there is no going back to Quick start, and the steps stay where they were.
    await expect(steps(win).getByRole('button', { name: 'Quick start from notes' })).toHaveCount(0)
    expect(await step(win, 'Look and feel').boundingBox()).toEqual(look)
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

test('the builder warns about a near-duplicate name, in full in the smallest window', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { app, win } = await launch()
    await createWorldFromWelcome(win, 'Builder')
    await invoke(win, 'createEntry', 'character', { name: 'Mara' })
    await invoke(win, 'createEntry', 'character', { name: 'Brann Holt' })
    await useFakeModel(win, fake)
    // The smallest window, with the binder showing beside the builder.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(960, 600))
    await win.reload()
    await win.getByRole('button', { name: 'Show or hide the binder' }).click()
    await expect(binder(win)).toBeVisible()
    /** The warning's words, and whether any of them is cut short. */
    const warning = async (): Promise<{ text: string | null; cut: boolean }> =>
      main(win)
        .getByRole('status')
        .filter({ hasText: 'Same one?' })
        .evaluate((el) => ({
          text: el.textContent,
          cut: [el, ...el.querySelectorAll('*')].some((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)
        }))

    await binder(win).getByRole('button', { name: 'Characters' }).click()
    await main(win).getByRole('button', { name: 'Quick start a character from a few notes' }).click()
    await main(win).getByRole('button', { name: 'Go step by step instead' }).click()
    await main(win).getByRole('textbox', { name: 'Name' }).fill('Marra')
    await expect(main(win).getByRole('status').filter({ hasText: 'Very close to Mara, another character. Same one?' })).toBeVisible()
    expect(await warning()).toEqual({ text: 'Very close to Mara, another character. Same one? Open Mara', cut: false })
    // The name's Ideas button stays where it was.
    await expect(main(win).getByRole('button', { name: 'Ask the AI for ideas for Name' })).toBeVisible()
    await main(win).getByRole('textbox', { name: 'Name' }).fill('Marra Holt')
    await expect(main(win).getByText('Same one?')).toHaveCount(0)

    // Quick start says it under the profile's name, whole.
    await binder(win).getByRole('button', { name: 'Characters' }).click()
    await main(win).getByRole('button', { name: 'Quick start a character from a few notes' }).click()
    await main(win).getByLabel('What you know about them').fill(NOTES)
    await main(win).getByRole('button', { name: 'Build the character' }).click()
    await expect(main(win).getByRole('status').filter({ hasText: 'Brann Holt is built and saved.' })).toBeVisible()
    expect(await warning()).toEqual({
      text: 'There’s already another character called Brann Holt. Same one? Open Brann Holt',
      cut: false
    })
  } finally {
    await fake.close()
  }
})

test('an entry opened in the builder from its page goes back to it in one click, with what was changed', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Builder')
  await invoke(win, 'createEntry', 'character', { name: 'Mara Venn', summary: 'A smuggler' })
  await binder(win).getByRole('button', { name: 'Characters' }).click()
  await main(win)
    .getByRole('listbox', { name: 'Characters' })
    .getByRole('option', { name: /^Mara Venn/ })
    .click()
  await main(win).getByRole('button', { name: 'Open in the builder' }).click()
  await expect(main(win).getByRole('heading', { level: 1, name: 'Basics' })).toBeVisible()
  await main(win).getByLabel('Pronouns', { exact: true }).fill('she/her')
  await main(win).getByRole('button', { name: 'Back to Mara Venn' }).click()
  await expect(main(win).getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Mara Venn')
  await expect(main(win).getByRole('button', { name: 'Open in the builder' })).toBeVisible()
  await expect.poll(async () => (await entryNamed(win, 'Mara Venn')).fields.pronouns).toBe('she/her')
})

test('Quick start keeps the notes, and a build still running, when Adam leaves and comes back', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Builder')
    await useFakeModel(win, fake, 'fake/slow')
    const notes = main(win).getByLabel('What you know about them')

    // Off to check something before building: the notes are still there.
    await openBuilder(win, 'Characters')
    await notes.fill(NOTES)
    await binder(win).getByRole('button', { name: 'Places' }).click()
    await openBuilder(win, 'Characters')
    await expect(notes).toHaveValue(NOTES)

    // Leaving while it builds: it carries on, and coming back shows it, with Stop.
    await main(win).getByRole('button', { name: 'Build the character' }).click()
    await expect(main(win).getByRole('region', { name: 'The profile so far' }).getByText('Saved', { exact: true })).toBeVisible()
    await binder(win).getByRole('button', { name: 'Places' }).click()
    await openBuilder(win, 'Characters')
    await expect(main(win).getByRole('region', { name: 'The profile so far' })).toContainText('Brann Holt')
    await main(win).getByRole('button', { name: 'Stop' }).click()
    await expect(main(win).getByRole('status').filter({ hasText: 'Stopped. What had fully arrived is saved.' })).toBeVisible()
    expect((await invoke(win, 'listEntries')).filter((e) => e.kind === 'character')).toHaveLength(1)

    // A build that is over is done with: the next Quick start starts afresh.
    await binder(win).getByRole('button', { name: 'Places' }).click()
    await openBuilder(win, 'Characters')
    await expect(notes).toHaveValue('')
    await expect(main(win).getByRole('region', { name: 'The profile so far' })).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

test('a build that stops part way keeps what arrived, and finishes the rest of the same character', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Builder')
    await useFakeModel(win, fake, 'fake/midstream-error')
    await openBuilder(win, 'Characters')
    await main(win).getByLabel('What you know about them').fill(NOTES)
    await main(win).getByRole('button', { name: 'Build the character' }).click()

    // No tick and no "Stopped" (Adam didn't stop it): it says what happened, and the problem says why.
    await expect(main(win).getByRole('status').filter({ hasText: 'It stopped part way. What had arrived is saved.' })).toBeVisible()
    await expect(main(win).getByRole('alert')).toContainText('Fake is having trouble right now')
    const part = await entryNamed(win, 'Brann Holt')
    expect(part.fields.marks).toBe('Missing two fingers on his left hand.')
    expect(part.fields.speech ?? '').toBe('')

    // Finishing can't start without a writer model: it says so, and what is saved stays on screen,
    // ready to finish once there is one.
    const finish = main(win).getByRole('button', { name: 'Finish the rest' })
    await invoke(win, 'updateSettings', { models: { writer: null } })
    await finish.click()
    await expect(main(win).getByRole('alert')).toContainText('Choose a writer model first')
    await expect(finish).toBeVisible()
    await expect(main(win).getByRole('button', { name: 'Look it over step by step' })).toBeVisible()
    await expect(main(win).getByRole('status').filter({ hasText: 'It stopped part way. What had arrived is saved.' })).toBeVisible()
    expect((await invoke(win, 'listEntries')).filter((e) => e.kind === 'character')).toHaveLength(1)

    // The service is back: finishing fills in only the empty fields, of the same character.
    const [p] = await invoke(win, 'listProviders')
    const writer = {
      providerId: p.id,
      modelId: 'fake/writer',
      label: 'Writer',
      contextLength: 32000,
      promptPrice: null,
      completionPrice: null
    }
    await invoke(win, 'updateSettings', { models: { writer } })
    await finish.click()
    const built = main(win).getByRole('status').filter({ hasText: 'Brann Holt is built and saved.' })
    await expect(built).toBeVisible()
    const all = (await invoke(win, 'listEntries')).filter((e) => e.kind === 'character')
    expect(all).toHaveLength(1)
    expect(all[0].fields.marks).toBe('Missing two fingers on his left hand.')
    expect(origin(all[0], 'marks')).toBe('adam')
    expect(all[0].fields.speech).toBe('How they speak of Brann Holt, drafted to fit the world.')
    expect(origin(all[0], 'speech')).toBe('ai')

    // The notes it was built from can't be typed over, or built from twice by mistake.
    const notes = main(win).getByLabel('What you know about them')
    await expect(notes).not.toBeEditable()
    await expect(notes).toHaveAttribute('title', 'To build another character, choose Start another.')
    await notes.focus()
    await win.keyboard.type('More')
    await win.keyboard.press('Control+Enter')
    await expect(notes).toHaveValue(NOTES)
    await expect(built).toBeVisible()
    await expect(main(win).getByRole('button', { name: 'Stop' })).toHaveCount(0)
    // Start another clears them, ready to type in.
    await main(win).getByRole('button', { name: 'Start another' }).click()
    await expect(notes).toHaveValue('')
    await expect(notes).toBeEditable()
    await expect(notes).toBeFocused()
    await win.keyboard.type('A tall woman')
    await expect(notes).toHaveValue('A tall woman')
    expect((await invoke(win, 'listEntries')).filter((e) => e.kind === 'character')).toHaveLength(1)
  } finally {
    await fake.close()
  }
})

test('a suggestion kept or discarded while Flesh out is still writing stays that way', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  // Slow enough to decide on the first suggestions while the rest are still on their way.
  const fake = await startFakeProvider({ delayMs: 2, slowDelayMs: 150 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Builder')
    await useFakeModel(win, fake, 'fake/slow')
    await openBuilder(win, 'Characters', { guided: true })
    await main(win).getByRole('textbox', { name: 'Name' }).fill('Mara Venn')
    await step(win, 'Looks').click()
    await main(win).getByRole('button', { name: 'Flesh out with AI' }).click()

    const stop = main(win).getByRole('button', { name: 'Stop' })
    await expect(main(win).getByRole('group', { name: 'Suggestion for Face' })).toBeVisible()
    await expect(stop).toBeVisible()
    await main(win).getByRole('button', { name: 'Discard the suggestion for Build' }).click()
    await main(win).getByRole('button', { name: 'Keep the suggestion for Face' }).click()
    await expect(stop).toBeVisible()

    // Once it has finished, the rest are there and those two are as he left them.
    await expect(stop).toHaveCount(0, { timeout: 15_000 })
    await expect(main(win).getByRole('group', { name: 'Suggestion for Hair' })).toBeVisible()
    await expect(main(win).getByRole('group', { name: 'Suggestion for Build' })).toHaveCount(0)
    await expect(main(win).getByRole('group', { name: 'Suggestion for Face' })).toHaveCount(0)
    await expect(main(win).getByLabel('Build', { exact: true })).toHaveValue('')
    await expect(main(win).getByLabel('Face', { exact: true })).toHaveValue('Suggested face for Mara Venn.')
    // Emptying the kept field doesn't bring the suggestion back either.
    await main(win).getByLabel('Face', { exact: true }).fill('')
    await expect(main(win).getByRole('group', { name: 'Suggestion for Face' })).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

test('relationships are picked from the characters already in the world', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Builder')
  await invoke(win, 'createEntry', 'character', { name: 'Mara Venn', summary: 'A smuggler' })
  await invoke(win, 'createEntry', 'group', { name: 'Ferry Guild' })
  await openBuilder(win, 'Characters', { guided: true })
  await main(win).getByRole('textbox', { name: 'Name' }).fill('Brann Holt')
  await step(win, 'Relationships').click()
  await expect(main(win).getByRole('heading', { level: 1, name: 'Relationships' })).toBeVisible()

  // Only characters, and nothing new is made here: a group's name finds nobody.
  const picker = main(win).getByRole('combobox', { name: 'Add someone Brann Holt knows' })
  await picker.fill('Ferry Guild')
  await expect(main(win).getByText('None of your characters is called “Ferry Guild”. Add them first, then pick them here.')).toBeVisible()
  await expect(win.getByRole('option')).toHaveCount(0)
  await picker.fill('Mara')
  await expect(win.getByRole('option')).toHaveCount(1)
  await win.getByRole('option', { name: /^Mara Venn/ }).click()

  // Straight into what they are to each other, saved as Adam types.
  const linked = main(win).getByLabel('How Brann Holt is linked to Mara Venn')
  await expect(linked).toBeFocused()
  await linked.fill('old friend')
  await expect(step(win, 'Relationships')).toHaveAccessibleName(/complete/)
  const brann = await entryNamed(win, 'Brann Holt')
  await expect
    .poll(async () => {
      const c = (await invoke(win, 'listChanges', brann.id)).find((x) => x.kind === 'relationship')
      return c?.kind === 'relationship' ? c.payload.type : null
    })
    .toBe('old friend')
  await step(win, 'Review').click()
  await expect(main(win).getByRole('region', { name: 'Relationships' })).toContainText('Mara Venn · old friend')
})

test('one-line fields keep their hint on one line, and the heading over options fits beside them, in a narrow window too', async ({
  launch
}) => {
  const fake = await startFake()
  try {
    const { app, win } = await launch()
    await createWorldFromWelcome(win, 'Builder')
    await useFakeModel(win, fake)
    const fits = async (): Promise<void> => {
      await expect(main(win).locator('textarea[rows="1"]').first()).toBeVisible()
      expect(await hintsCut(win)).toEqual([])
    }

    await openBuilder(win, 'Characters', { guided: true })
    await fits()
    // A hint too long for its box ends in "…" on its one line rather than wrap.
    const long = 'A hint far too long for its box, which goes on past the edge of it and on and on and further still'
    const wraps = await main(win)
      .getByLabel('Short summary', { exact: true })
      .evaluate((el, hint) => {
        const box = el as unknown as Box
        box.placeholder = hint
        return box.scrollHeight > box.clientHeight + 1
      }, long)
    expect(wraps).toBe(false)
    await main(win).getByRole('textbox', { name: 'Name' }).fill('Mara Venn')
    await step(win, 'Looks').click()
    await expect(main(win).getByRole('heading', { level: 1, name: 'Looks' })).toBeVisible()
    await fits()
    // The heading says what closing the options does, whole, over a field at half width.
    await main(win).getByLabel('Hair', { exact: true }).fill('Grey')
    await main(win).getByRole('button', { name: 'Ask the AI for ideas for Hair' }).click()
    const options = main(win).getByRole('group', { name: 'Ideas for Hair' })
    await expect(options.getByRole('listitem')).toHaveCount(3)
    const heading = options.getByText('Pick one, or close this to keep yours')
    await expect(heading).toBeVisible()
    expect(await heading.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await options.getByRole('button', { name: 'Close the ideas for Hair' }).click()

    // The narrowest the window goes.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 700))
    await expect.poll(() => win.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)).toBeLessThanOrEqual(960)
    await fits()
    await step(win, 'Basics').click()
    await fits()

    await openBuilder(win, 'Items', { guided: true })
    await fits()
  } finally {
    await fake.close()
  }
})
