// Building the world from a summary (milestone 4), end to end against the fake AI server, whose World
// builder replies are made from the summary one sentence at a time (tests/fake-provider/m4/world.mjs, with
// its rules at the top), so each test knows exactly what a summary makes.
import type { Page } from '@playwright/test'
import type { Entry } from '@shared/types'
import type { FakeProvider } from '../fake-provider/server.mjs'
import { createWorldFromWelcome, expect, invoke, openSettings, test } from './helpers'

/** One paragraph: two characters, two places (one inside the other), a group, an item, an absolute rule, a dated event, a question and a word. */
const SUMMARY = [
  'Mara Venn is a smuggler captain who owes the Salt Guild a fortune.',
  "Tobin is Mara Venn's younger brother.",
  'Saltmarsh is a port town in the Grey Coast.',
  'The Grey Coast is a cold land of fog and reefs.',
  'Mara keeps the Tide Compass.',
  'Magic always costs blood.',
  'The Great Flood happened in the year 312, when Tobin was born.',
  'Who sank the Merrow?',
  'The word "drowner" means a ghost that walks out of the sea.'
].join(' ')

const MADE = [
  'Mara Venn',
  'Tobin',
  'Saltmarsh',
  'The Grey Coast',
  'Salt Guild',
  'Tide Compass',
  'Magic',
  'The Great Flood',
  'Who sank the Merrow',
  'drowner'
]

const main = (win: Page) => win.locator('main')
const worldNav = (win: Page) => win.getByRole('navigation', { name: 'World' })
const summaryBox = (win: Page) => main(win).getByRole('textbox', { name: 'Your summary' })
const soFar = (win: Page) => main(win).getByRole('region', { name: 'Made so far' })
const results = (win: Page) => main(win).getByRole('region', { name: 'Made from your summary' })
const kind = (win: Page, label: string) => results(win).getByRole('region', { name: label, exact: true })
const step = (win: Page, words: string | RegExp) => main(win).getByRole('status').filter({ hasText: words })
const section = (win: Page, title: string) => win.locator('section').filter({ has: win.getByRole('heading', { name: title, exact: true }) })
const origin = (e: Entry, key: string): string => e.fieldOrigins[key] ?? e.origin
const entries = (win: Page): Promise<Entry[]> => invoke(win, 'listEntries')

function named(list: Entry[], name: string): Entry {
  const e = list.find((x) => x.name === name)
  if (!e) throw new Error(`No entry named ${name}`)
  return e
}

/** The fake AI server; fake/slow streams each reply a few words every `slowDelayMs`, so each step of a build can be seen. */
async function fakeServer(slowDelayMs: number): Promise<FakeProvider> {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  return startFakeProvider({ delayMs: 2, slowDelayMs })
}

/** Connects the fake server: fake/writer writes and, when given, the World builder has a model of its own. Reloads the window. */
async function connect(win: Page, fake: FakeProvider, world?: string): Promise<void> {
  const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
  const model = (modelId: string) => ({
    providerId: p.id,
    modelId,
    label: modelId,
    contextLength: 32000,
    promptPrice: 0.000003,
    completionPrice: 0.000015
  })
  await invoke(win, 'updateSettings', { models: { writer: model('fake/writer'), ...(world ? { world: model(world) } : {}) } })
  await win.reload()
  await expect(win.locator('.scene-prose')).toBeVisible()
}

async function openFromBinder(win: Page): Promise<void> {
  await worldNav(win).getByRole('button', { name: 'Build from a summary' }).click()
  await expect(main(win).getByRole('heading', { level: 1, name: 'Build the world from a summary' })).toBeVisible()
}

test('one paragraph builds the world in one click, saving as it goes: his words are his, and one Undo takes it all away', async ({
  launch
}) => {
  const fake = await fakeServer(8)
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Grey Coast')
    await connect(win, fake)

    // Settings › Models: the World builder has its own model, the character builder's until one is chosen, and doesn't think.
    await openSettings(win, 'Models')
    const row = section(win, 'World builder model')
    await expect(row.getByText('Same as the character builder model')).toBeVisible()
    await expect(row.getByText('fake/writer', { exact: true })).toBeVisible()
    const thinking = row.getByRole('radiogroup', { name: 'World builder model thinking' })
    await expect(thinking.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true')
    await expect(thinking.getByRole('radio', { checked: true })).toHaveCount(1)
    expect((await invoke(win, 'getSettings')).thinking.world).toBe('off')

    // A World builder model of its own (a slow one, so each step can be seen), then the page from the binder.
    const writer = (await invoke(win, 'getSettings')).models.writer!
    await invoke(win, 'updateSettings', { models: { world: { ...writer, modelId: 'fake/slow', label: 'fake/slow' } } })
    await openFromBinder(win)
    await expect(summaryBox(win)).toBeFocused()
    await summaryBox(win).fill(SUMMARY)
    // What it would cost, before it starts.
    await expect(main(win).getByText(/^Estimated cost: (about \$\d+\.\d\d|less than a cent), with slow\.$/)).toBeVisible()

    // One click, nothing to approve: it says what it is doing, and each thing shows as soon as it is saved.
    await main(win).getByRole('button', { name: 'Build the world' }).click()
    await expect(step(win, 'Laying out characters: 1 of 2')).toBeVisible()
    await expect(summaryBox(win)).toHaveAttribute('readonly', '')
    await expect(soFar(win).getByRole('button', { name: 'Open Mara Venn', exact: true })).toBeVisible()
    expect(named(await entries(win), 'Mara Venn').kind).toBe('character')
    await expect(step(win, /^Laying out places: [12] of 2$/)).toBeVisible()

    // Done: everything it made, grouped by kind, each with Open.
    await expect(results(win).getByRole('status')).toHaveText(
      /^Built and saved 10 entries, 1 relationship and the world's themes and tone\. Your words are kept as you wrote them; the rest is drafted by AI\. It cost (about \$\d+\.\d\d|less than a cent)\.$/,
      { timeout: 60_000 }
    )
    await expect(summaryBox(win)).not.toHaveAttribute('readonly', '')
    for (const name of MADE) await expect(results(win).getByRole('button', { name: `Open ${name}`, exact: true })).toBeVisible()
    for (const [label, n] of [
      ['Characters', 2],
      ['Places', 2],
      ['Groups', 1],
      ['Items', 1],
      ['Lore and rules', 1],
      ['Events', 1],
      ['Plot threads', 1],
      ['Glossary', 1],
      ['Relationships', 1],
      ['Themes and tone', 2]
    ] as const) {
      await expect(kind(win, label).getByRole('listitem')).toHaveCount(n)
    }
    await expect(kind(win, 'Lore and rules').getByText('Never to be broken')).toBeVisible()
    await expect(kind(win, 'Relationships')).toContainText('Younger brother: Mara Venn')

    // Saved: the summary's own words exactly as written and his, the gaps drafted by AI.
    const list = await entries(win)
    expect(list.map((e) => e.name).sort()).toEqual([...MADE].sort())
    const mara = named(list, 'Mara Venn')
    expect(mara.summary).toBe('Mara Venn is a smuggler captain who owes the Salt Guild a fortune.')
    expect(origin(mara, 'summary')).toBe('adam')
    expect(mara.fields.traits).toBe('Core traits of Mara Venn, drafted to fit the world.')
    expect(origin(mara, 'traits')).toBe('ai')
    expect(named(list, 'Saltmarsh').parentId).toBe(named(list, 'The Grey Coast').id)
    expect(named(list, 'Tide Compass').kind).toBe('item')
    const magic = named(list, 'Magic')
    expect(magic).toMatchObject({ kind: 'lore', hardRule: true })
    expect(magic.fields.rules).toBe('Magic always costs blood.')
    expect(origin(magic, 'rules')).toBe('adam')
    const flood = named(list, 'The Great Flood')
    expect(flood.kind).toBe('event')
    expect(flood.fields.when).toBe('in the year 312')
    const thread = named(list, 'Who sank the Merrow')
    expect(thread.fields.promise).toBe('Who sank the Merrow?')
    // A plot thread open, and set up, before the story starts.
    const storyId = (await invoke(win, 'listStories'))[0].id
    const atStart = await invoke(win, 'getEntryAsOf', thread.id, { kind: 'start', storyId })
    expect(atStart.thread?.status).toBe('open')
    const world = await invoke(win, 'getWorld')
    expect(world?.themes).toBe('Debt, family and what the sea takes back.')
    expect(world?.tone).toBe('Salt-stung and wary, with dry humour.')
    // The timeline starts: the story's opening scene is on Day 1.
    const opening = (await invoke(win, 'getOutline', storyId)).scenes[0]
    expect((await invoke(win, 'getScene', opening.id)).card.when).toBe('Day 1')

    // Open goes to the entry's page, where the AI's fields say so; the page keeps the results meanwhile.
    await results(win).getByRole('button', { name: 'Open Mara Venn', exact: true }).click()
    await expect(main(win).getByRole('textbox', { name: 'Name' })).toHaveValue('Mara Venn')
    await expect(main(win).getByText('Drafted by AI').first()).toBeVisible()
    await win.keyboard.press('Control+K')
    await win.keyboard.type('build the world')
    await win.keyboard.press('Enter')
    await expect(results(win).getByRole('button', { name: 'Open Mara Venn', exact: true })).toBeVisible()

    // What changed: the whole build is one run, and any line of it can be undone there.
    await worldNav(win).getByRole('button', { name: 'What changed' }).click()
    const run = main(win).getByRole('region', { name: 'Built from your summary' })
    await expect(run).toHaveCount(1)
    await expect(run.getByRole('button', { name: /^Undo: / })).toHaveCount(13)
    await run.getByRole('button', { name: 'Undo: Tide Compass, New item' }).click()
    await expect.poll(async () => (await entries(win)).some((e) => e.name === 'Tide Compass')).toBe(false)

    // Back on the page, that line shows as undone; one Undo takes away the rest of the build.
    await openFromBinder(win)
    await expect(kind(win, 'Items').getByRole('listitem')).toContainText('Undone')
    await main(win).getByRole('button', { name: 'Undo the whole build' }).click()
    await expect(win.getByText('Build undone.')).toBeVisible()
    await expect.poll(async () => (await entries(win)).length).toBe(0)
    expect(await invoke(win, 'getWorld')).toMatchObject({ themes: '', tone: '' })
    await expect(results(win).getByRole('status')).toHaveText('The build was undone. Nothing it made is in your world now.')
    await expect(main(win).getByRole('button', { name: 'Undo the whole build' })).toHaveCount(0)

    // The toast's Undo brings it all back (but not the line undone on its own).
    await win.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(async () => (await entries(win)).length).toBe(9)
    expect((await entries(win)).some((e) => e.name === 'Tide Compass')).toBe(false)
    await expect(results(win).getByRole('button', { name: 'Open Mara Venn', exact: true })).toBeVisible()

    // The Timeline has something to show: the opening scene on Day 1, and the flood the summary dates.
    await worldNav(win).getByRole('button', { name: 'Timeline', exact: true }).click()
    const timeline = main(win).getByRole('list', { name: 'Timeline' })
    await expect(timeline.getByRole('button', { name: /^Book 1, Ch 1, Sc 1, Scene 1\. Day 1\./ })).toBeVisible()
    await expect(timeline.getByRole('button', { name: /The Great Flood\. in the year 312\./ })).toBeVisible()
  } finally {
    await fake.close()
  }
})

test('into a world that has things already, a build adds only what is missing and never changes what Adam wrote', async ({ launch }) => {
  const fake = await fakeServer(8)
  try {
    const first = await launch()
    let win = first.win

    // A new world made with "Build from a summary" opens on this page, ready to type in.
    await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
    await win.getByLabel('World name').fill('Grey Coast')
    await win.getByRole('button', { name: 'Build from a summary' }).click()
    await expect(main(win).getByRole('heading', { level: 1, name: 'Build the world from a summary' })).toBeVisible()
    await expect(summaryBox(win)).toBeFocused()
    // No model yet: the page says what to do, before anything is started.
    await expect(main(win).getByText('Choose a writer model first, in Settings › Models.')).toBeVisible()
    await connect(win, fake)

    // His own Mara Venn, and his own tone for the world.
    const mine = await invoke(win, 'createEntry', 'character', { name: 'Mara Venn', summary: 'A harbour pilot.', fields: { age: '29' } })
    await invoke(win, 'updateWorld', { tone: 'Bleak.' })

    // From the command palette; Ctrl+Enter in the summary builds.
    await win.keyboard.press('Control+K')
    await win.keyboard.type('build the world')
    await win.keyboard.press('Enter')
    await summaryBox(win).fill(`${SUMMARY} Mara Venn is 34.`)
    await summaryBox(win).press('Control+Enter')
    await expect(results(win).getByRole('status')).toContainText("Built and saved 9 entries, 1 relationship and the world's themes.", {
      timeout: 60_000
    })

    // His page is as he left it, and there is still only one of her.
    const list = await entries(win)
    expect(list.filter((e) => e.name === 'Mara Venn')).toHaveLength(1)
    const after = named(list, 'Mara Venn')
    expect(after).toMatchObject({ id: mine.id, summary: 'A harbour pilot.', updatedAt: mine.updatedAt })
    expect(after.fields.age).toBe('29')
    expect((await invoke(win, 'getWorld'))?.tone).toBe('Bleak.')
    // The page says she was there already, and where the summary disagrees with her page (nothing changed).
    await expect(results(win).getByRole('heading', { name: /^Already in your world/ })).toBeVisible()
    await expect(results(win).getByRole('button', { name: 'Mara Venn', exact: true })).toBeVisible()
    await expect(results(win).getByText('Mara Venn: your summary says age or birth date is “34”, but the page says “29”.')).toBeVisible()
    // What it made links to her: Tobin is her younger brother.
    await expect(kind(win, 'Relationships')).toContainText('Younger brother: Mara Venn')

    // Building again adds nothing: it is all there.
    await main(win).getByRole('button', { name: 'Build the world' }).click()
    await expect(results(win).getByRole('status')).toContainText(
      'Everything in your summary is in your world already, so nothing was added.',
      {
        timeout: 60_000
      }
    )
    expect(await entries(win)).toHaveLength(10)
    expect(named(await entries(win), 'Mara Venn').updatedAt).toBe(mine.updatedAt)

    // After a restart the page opens with his summary, and what the last build made.
    await first.close()
    const second = await launch({ dataDir: first.dataDir })
    win = second.win
    await expect(win.locator('.scene-prose')).toBeVisible()
    await openFromBinder(win)
    await expect(summaryBox(win)).toHaveValue(`${SUMMARY} Mara Venn is 34.`)
    await expect(results(win).getByRole('status')).toContainText("Built and saved 9 entries, 1 relationship and the world's themes.")
    await expect(results(win).getByRole('button', { name: 'Open Tobin', exact: true })).toBeVisible()
  } finally {
    await fake.close()
  }
})

test('Cancel stops the build and keeps what was saved; one Undo still takes it away', async ({ launch }) => {
  const fake = await fakeServer(25)
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Grey Coast')
    await connect(win, fake, 'fake/slow')

    // From the empty codex, beside its other two ways to start.
    await worldNav(win).getByRole('button', { name: 'Codex' }).click()
    await expect(main(win).getByRole('button', { name: 'Quick start from a few notes' })).toBeVisible()
    await main(win).getByRole('button', { name: 'Build from a summary' }).click()
    await expect(main(win).getByRole('heading', { level: 1, name: 'Build the world from a summary' })).toBeVisible()
    await summaryBox(win).fill(SUMMARY)
    await main(win).getByRole('button', { name: 'Build the world' }).click()

    // Once the first character is saved, Cancel.
    await expect(soFar(win).getByRole('button', { name: 'Open Mara Venn', exact: true })).toBeVisible({ timeout: 60_000 })
    await main(win).getByRole('button', { name: 'Cancel' }).click()
    await expect(results(win).getByRole('status')).toHaveText(/^Cancelled\. What was made before is kept: \d+ entr(y|ies)\./, {
      timeout: 30_000
    })

    // What was saved stays, and the page lists exactly that.
    const kept = await entries(win)
    expect(kept.map((e) => e.name)).toContain('Mara Venn')
    expect(kept.length).toBeLessThan(MADE.length)
    for (const e of kept) await expect(results(win).getByRole('button', { name: `Open ${e.name}`, exact: true })).toBeVisible()
    await expect(results(win).getByRole('button', { name: /^Open / })).toHaveCount(kept.length)
    // Nothing goes on in the background: the list stays as it is.
    await win.waitForTimeout(600)
    expect(await entries(win)).toHaveLength(kept.length)

    // One Undo takes away what was saved.
    await main(win).getByRole('button', { name: 'Undo the whole build' }).click()
    await expect.poll(async () => (await entries(win)).length).toBe(0)
  } finally {
    await fake.close()
  }
})

test('Interview me asks one question at a time; each answer goes into the summary in his own words, under its topic', async ({
  launch
}) => {
  const fake = await fakeServer(8)
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Grey Coast')
    // A World builder model that waits a moment before it answers, so the question on its way can be seen.
    await connect(win, fake, 'fake/wait')
    await openFromBinder(win)
    const start = 'Mara Venn is a smuggler captain who owes the Salt Guild a fortune.'
    await summaryBox(win).fill(start)

    // One question at a time (tests/fake-provider/m4/worldInterview.mjs asks its topics in order).
    await main(win).getByRole('button', { name: 'Interview me' }).click()
    const interview = main(win).getByRole('region', { name: 'Interview' })
    await expect(interview.getByRole('heading', { name: 'Interview · Question 1' })).toBeVisible()
    await expect(interview.getByRole('status')).toHaveText('Reading your summary…')
    await expect(interview.getByText('What is the story about, and what sets it going?')).toBeVisible()
    await expect(interview.getByText('Premise', { exact: true })).toBeVisible()
    await expect(interview.getByText('Each answer is added to the end of your summary, in your own words.')).toBeVisible()
    const answer = interview.getByRole('textbox', { name: 'Your answer' })
    await expect(answer).toBeFocused()

    // Answer one: it goes into the summary at once, word for word, and the next question comes.
    const premise = 'A debt comes due, and Mara has one season to pay it.'
    await answer.fill(premise)
    await interview.getByRole('button', { name: 'Add to summary' }).click()
    const once = `${start}\n\nPremise: ${premise}`
    await expect(summaryBox(win)).toHaveValue(once)
    await expect(interview.getByRole('status')).toHaveText('Thinking of the next question…')
    await expect(interview.getByText('Who are the main characters, and what does each of them want?')).toBeVisible()
    await expect(interview.getByRole('heading', { name: 'Interview · Question 2' })).toBeVisible()
    await expect(interview.getByText('1 answer added to your summary.')).toBeVisible()

    // Skip one: the summary stays as it is, and the next topic comes.
    await interview.getByRole('button', { name: 'Skip' }).click()
    await expect(interview.getByText('Where and when does the story take place?')).toBeVisible()
    await expect(interview.getByRole('heading', { name: 'Interview · Question 3' })).toBeVisible()
    await expect(summaryBox(win)).toHaveValue(once)

    // Enter adds an answer too, and the toast's Undo takes the last one out again.
    await answer.fill('The Grey Coast, in the year 340.')
    await answer.press('Enter')
    await expect(summaryBox(win)).toHaveValue(`${once}\n\nSetting: The Grey Coast, in the year 340.`)
    await expect(interview.getByText('What rules does the world run on, and what do they cost?')).toBeVisible()
    await win.locator('div.fixed[aria-live="polite"]').getByRole('button', { name: 'Undo' }).click()
    await expect(summaryBox(win)).toHaveValue(once)
    await expect(interview.getByText('1 answer added to your summary.')).toBeVisible()

    // He can still edit the summary by hand while being interviewed.
    await summaryBox(win).press('ControlOrMeta+End')
    await summaryBox(win).pressSequentially(' Soon.')
    const edited = `${once} Soon.`
    await expect(summaryBox(win)).toHaveValue(edited)

    // Stop: the interview goes, and the summary is kept in the world as he left it.
    await interview.getByRole('button', { name: 'Stop' }).click()
    await expect(interview).toBeHidden()
    await expect(main(win).getByRole('button', { name: 'Interview me' })).toBeVisible()
    await expect.poll(async () => (await invoke(win, 'getWorldBuilder')).summary).toBe(edited)

    // Each question was one call to the World builder model, and nothing else was asked of it.
    expect(fake.requestCounts()['fake/wait']).toBe(4)
    expect(String(fake.lastRequest()?.body.messages[0].content)).toMatch(/^\[AIWRITE-WORLD v1\] interview/)
  } finally {
    await fake.close()
  }
})
