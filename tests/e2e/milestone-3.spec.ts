// Milestone 3's acceptance checks ("Builders and views"), walked through the interface the way Adam
// works, against the fake provider (tests/fake-provider/server.mjs). Its character builder takes the
// first words of the notes as the name, keeps each line of the notes word for word (as the summary,
// core traits, distinguishing marks and secrets) and drafts every other field. Its memory model reads
// "<Name> lost her|his <thing>." and "<Name> learned that <fact>.", and adds a <Name> it doesn't know
// as a new character.
//
//  1. A full character is built from a few lines of notes with one click: Quick start from the
//     Characters list, with the character builder left on "Same as the writer model". The whole
//     character is saved at once: the name and Adam's lines exactly as he wrote them, and not marked
//     as the AI's; every other field filled in and marked "Drafted by AI". All of it is still there
//     after the app is closed and opened again.
//  2. Any entry can be viewed as of any scene. Five scenes in two chapters, written in the editor and
//     read by the memory by itself: Mara (whom Adam made) learns something in four of them and loses
//     her left hand in the third; Kell (whom only the text knows) is met in the second; and the
//     Gilded Eel, a place, burns in the third (a change Adam noted himself). "View as of a scene" goes
//     through the start of the book and every scene, and at each one the three pages show just what
//     holds there: nothing of a change before its scene, and the change, marked, from its scene on;
//     Kell is "Not in the story yet" until he is met. Back to editing returns to the page in one click.
//  3. Search finds anything in under 100 ms. In a world of 300 scenes of about 100 words and 200
//     entries with other names, summaries and private notes: words in one scene, an entry's name,
//     another name an entry goes by, a chapter summary, a private note and a word found all over the
//     book are each found, the main process taking under 100 ms to search (the median of seven
//     searches, after one to warm up). Ctrl+K and typing shows the result, and Enter opens it.
//
// The memory reads a scene a moment after typing stops (AIWRITE_KEEPER_QUIET_MS, short here) and
// when Adam leaves the scene; nothing memory-related is clicked to make it catch up. What isn't being
// checked (the chapters, the entries Adam made, the big world) is set up through the app's API, the
// same calls the interface makes, and the window is reloaded to show it.
import type { Page } from '@playwright/test'
import type { ApiMethod, Bridge, IpcResult } from '@shared/api'
import type { SearchGroupId, SearchResults } from '@shared/contracts/search'
import { CHARACTER_GROUPS } from '@shared/fields'
import type { Entry, EntryInput, EntryKind, ID } from '@shared/types'
import { binder, closeWindow, createWorldFromWelcome, expect, invoke, openSettings, startFake, test, useFakeModel } from './helpers'

/** How long the memory may take to catch up (it usually takes a second or two). */
const MEMORY = { timeout: 30_000 }

// ---------- Finding things on screen ----------

const main = (win: Page) => win.locator('main')
const prose = (win: Page) => win.locator('.scene-prose')
const paragraph = (win: Page, text: string) => prose(win).locator('p', { hasText: text })
const sceneHeader = (win: Page) => win.locator('main header')
const sceneRow = (win: Page, title: string) => binder(win).locator('[data-row="scene"]', { hasText: title })
const nameBox = (win: Page) => win.getByRole('textbox', { name: 'Name', exact: true })
/** A section of an entry page that opens and closes, by its title (its button also says how many of its fields are filled). */
const sectionToggle = (win: Page, title: string) => main(win).getByRole('button', { name: new RegExp(`^${title}`) })
/** A field on an entry page with what is said under it (such as "Drafted by AI"), by its label. */
const fieldBox = (win: Page, label: string) => main(win).getByLabel(label, { exact: true }).locator('xpath=ancestor::div[label][1]')

/** Opens a scene from the binder and waits for its page. */
async function openScene(win: Page, title: string): Promise<void> {
  await sceneRow(win, title).click()
  await expect(sceneHeader(win).getByRole('button', { name: title, exact: true })).toBeVisible()
  await expect(prose(win)).toBeVisible()
}

/** Writes paragraphs at the end of the open scene, each arriving whole, as when Adam pastes it. */
async function writeParagraphs(win: Page, paras: string[]): Promise<void> {
  const empty = !(await prose(win).innerText()).trim()
  await prose(win).click()
  await win.keyboard.press('Control+End')
  for (const [i, p] of paras.entries()) {
    if (i > 0 || !empty) await win.keyboard.press('Enter')
    await win.keyboard.insertText(p)
  }
  await expect(paragraph(win, paras[paras.length - 1])).toBeVisible()
}

/** Opens an entry from its list (the binder opens the list first if another is showing). */
async function openEntry(win: Page, list: 'Characters' | 'Places', name: string): Promise<void> {
  const listbox = main(win).getByRole('listbox', { name: list, exact: true })
  if (!(await listbox.isVisible())) await binder(win).getByRole('button', { name: list }).click()
  const row = listbox.getByRole('option', { name: new RegExp(`^${name}`) })
  await row.click()
  await expect(row).toHaveAttribute('aria-selected', 'true')
}

/** Opens a section of the entry page (sections stay open from one page to the next). */
async function openSection(win: Page, title: string): Promise<void> {
  const toggle = sectionToggle(win, title)
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
}

async function entryNamed(win: Page, name: string): Promise<Entry> {
  await expect.poll(async () => (await invoke(win, 'listEntries')).some((e) => e.name === name)).toBe(true)
  return (await invoke(win, 'listEntries')).find((e) => e.name === name)!
}

// ---------- 1. A character from a few lines of notes ----------

const TOBIN = 'Tobin Reed'
/** Adam's notes, one thing per line. */
const NOTE_LINES = [
  'Tobin Reed runs the last ferry across the Narrows.',
  'Slow, patient and slippery; hears everything said on his deck and repeats none of it.',
  'A rope burn across his right palm that never healed.',
  'Takes money from Corwin Venn to keep his ferry on the far bank on certain nights.'
]
const NOTES = NOTE_LINES.join('\n')
/** Where the builder keeps each line of the notes, word for word. */
const HIS: Record<string, string> = { summary: NOTE_LINES[0], traits: NOTE_LINES[1], marks: NOTE_LINES[2], secrets: NOTE_LINES[3] }
const FIELDS = CHARACTER_GROUPS.flatMap((g) => g.fields)
/** Every other part of a character's profile: the AI drafts these. */
const DRAFTED = ['aliases', 'description', ...FIELDS.map((f) => f.key).filter((k) => !(k in HIS))]
const LABELS: Record<string, string> = {
  aliases: 'Aliases',
  description: 'Description',
  summary: 'Short summary',
  ...Object.fromEntries(FIELDS.map((f) => [f.key, f.label]))
}

const origin = (e: Entry, key: string): string => e.fieldOrigins[key] ?? e.origin
const valueOf = (e: Entry, key: string): string =>
  key === 'aliases' ? e.aliases.join(', ') : key === 'description' ? e.description : key === 'summary' ? e.summary : (e.fields[key] ?? '')

/** The saved character: Adam's words exactly as he wrote them, and his; everything else filled in by the AI, and the AI's. */
function expectWholeCharacter(e: Entry): void {
  expect(e.kind).toBe('character')
  expect(e.name).toBe(TOBIN)
  expect(origin(e, 'name'), 'the name is his').toBe('adam')
  for (const [key, words] of Object.entries(HIS)) {
    expect(valueOf(e, key), `${LABELS[key]} is his line, word for word`).toBe(words)
    expect(origin(e, key), `${LABELS[key]} is his`).toBe('adam')
  }
  for (const key of DRAFTED) {
    expect(valueOf(e, key).trim(), `${LABELS[key]} is filled in`).not.toBe('')
    expect(origin(e, key), `${LABELS[key]} is drafted by AI`).toBe('ai')
  }
  expect(e.fields.hair).toBe(`Hair of ${TOBIN}, drafted to fit the world.`)
}

/** Picks a model for writing in Settings › Models. */
async function chooseWriter(win: Page, modelId: string): Promise<void> {
  const writer = modelSection(win, 'Writer model')
  const change = writer.getByRole('button', { name: 'Change', exact: true })
  if (await change.isVisible()) await change.click()
  await win
    .getByRole('listbox', { name: 'Models' })
    .getByRole('option', { name: new RegExp(`^${modelId.replace('/', '\\/')}\\b`) })
    .click()
  await expect(writer.getByTitle(modelId, { exact: true })).toBeVisible()
}

/** One model's part of Settings › Models, by its heading. */
const modelSection = (win: Page, title: string) =>
  main(win)
    .locator('section')
    .filter({ has: win.getByRole('heading', { name: title, exact: true }) })

test('milestone 3, check 1: a full character is built from a few lines of notes with one click', async ({ launch }) => {
  const fake = await startFake()
  try {
    const first = await launch()
    const { win } = first
    await createWorldFromWelcome(win, 'The Northern Reaches')

    await test.step('setup: the fake server as the writer model; the character builder left as it is', async () => {
      await openSettings(win, 'Models')
      await win.getByRole('button', { name: 'Add another provider' }).click()
      const form = win.locator('form').filter({ hasText: 'Add a provider' })
      await form.getByLabel('Name').fill('Test server')
      await form.getByLabel('Base URL').fill(fake.url)
      await form.getByRole('button', { name: 'Add provider' }).click()
      await expect(win.getByText(/^Connected to Test server in .+ It offers \d+ models\.$/)).toBeVisible()
      await chooseWriter(win, 'fake/writer')
      // Adam never chose a model for the builder: it uses the writer model.
      const builder = modelSection(win, 'Character builder model')
      await expect(builder.getByText('Same as the writer model', { exact: true })).toBeVisible()
      await expect(builder.getByTitle('fake/writer', { exact: true })).toBeVisible()
    })

    await test.step('1. Quick start from the Characters list: Adam pastes his notes and clicks once', async () => {
      await binder(win).getByRole('button', { name: 'Characters' }).click()
      await expect(main(win).getByRole('heading', { name: 'No characters yet' })).toBeVisible()
      await main(win).getByRole('button', { name: 'Quick start from a few notes' }).click()
      await expect(main(win).getByRole('heading', { level: 1, name: 'Build a character from a few notes' })).toBeVisible()
      const notes = main(win).getByLabel('What you know about them')
      await expect(notes).toBeFocused()
      await win.keyboard.insertText(NOTES)
      await expect(notes).toHaveValue(NOTES)
      fake.reset()

      await main(win).getByRole('button', { name: 'Build the character' }).click()
      await expect(main(win).getByRole('status').filter({ hasText: 'is built and saved' })).toHaveText(
        `${TOBIN} is built and saved. Your words are kept as you wrote them; the rest is drafted by AI.`
      )
      // One click, one request to the writer model to build it; then one more, on its own, for the voice it is read aloud in.
      await expect.poll(() => fake.requestCounts()).toEqual({ 'fake/writer': 2 })

      // The finished profile says whose words each field holds.
      const profile = main(win).getByRole('region', { name: 'The profile so far' })
      await expect(profile.getByText('Saved', { exact: true })).toBeVisible()
      for (const line of NOTE_LINES) await expect(profile).toContainText(line)
      await expect(profile.getByText('Your words', { exact: true })).toHaveCount(1 + NOTE_LINES.length)
      await expect(profile.getByText('Drafted by AI', { exact: true })).toHaveCount(DRAFTED.length)

      expectWholeCharacter(await entryNamed(win, TOBIN))
    })

    await test.step('1. closed and opened again, the whole character is still there, and its page says what the AI drafted', async () => {
      await closeWindow(first.app)
      const second = await launch({ dataDir: first.dataDir })
      const again = second.win
      await expect(binder(again)).toBeVisible()
      expectWholeCharacter(await entryNamed(again, TOBIN))

      await binder(again).getByRole('button', { name: 'Characters' }).click()
      await main(again)
        .getByRole('listbox', { name: 'Characters', exact: true })
        .getByRole('option', { name: /^Tobin Reed/ })
        .click()
      await expect(nameBox(again)).toHaveValue(TOBIN)
      for (const g of CHARACTER_GROUPS) {
        await openSection(again, g.label)
        // Every field of every section is filled in.
        await expect(sectionToggle(again, g.label)).toContainText(`${g.fields.length} of ${g.fields.length}`)
      }
      // His lines, as he wrote them, with nothing to say the AI wrote them.
      for (const [key, words] of Object.entries(HIS)) {
        await expect(main(again).getByLabel(LABELS[key], { exact: true })).toHaveValue(words)
        await expect(fieldBox(again, LABELS[key])).not.toContainText('Drafted by AI')
      }
      // Everything else says the AI drafted it.
      for (const key of DRAFTED) await expect(fieldBox(again, LABELS[key]), LABELS[key]).toContainText('Drafted by AI')
      await expect(main(again).getByText('Drafted by AI', { exact: true })).toHaveCount(DRAFTED.length)
      await expect(main(again).getByLabel('Hair', { exact: true })).toHaveValue(`Hair of ${TOBIN}, drafted to fit the world.`)
    })
  } finally {
    await fake.close()
  }
})

// ---------- 2. Any entry as of any scene ----------

/** Book 1: two chapters, five scenes. The memory reads the sentences about Mara and Kell. */
const SCENES = [
  {
    chapter: 1,
    title: 'The ferry',
    text: ['The ferry was late again, and the river ran high against the Lowtown steps.', 'Mara learned that the ferry was sold.']
  },
  {
    chapter: 1,
    title: 'The toll steps',
    text: [
      'Rain hammered the toll steps while the keeper counted coins into his iron box.',
      'Mara learned that the toll had doubled. A stranger pushed past her on the stairs, swearing at the wind.',
      'Kell lost his hat.'
    ]
  },
  {
    chapter: 1,
    title: 'Fire at the Eel',
    text: [
      'Smoke poured from the windows of the Gilded Eel, and the quay filled with shouting.',
      'The rope came tight around her wrist, the barge swung back, and the dock took what it wanted. Mara lost her left hand.'
    ]
  },
  {
    chapter: 2,
    title: 'Ashes',
    text: [
      'By morning the quay was ash and silence, and the river carried the last of the beams away.',
      'Mara learned that Kell had lit the fire.'
    ]
  },
  {
    chapter: 2,
    title: 'The letter',
    text: ['A letter waited under her door, sealed in grey wax.', 'Mara learned that the Duke had paid him.']
  }
]
/** The slider's stops: the start of the book, then every scene. */
const STOPS = [
  'Start of Book 1',
  'Book 1, Ch 1, Sc 1',
  'Book 1, Ch 1, Sc 2',
  'Book 1, Ch 1, Sc 3',
  'Book 1, Ch 2, Sc 1',
  'Book 1, Ch 2, Sc 2'
]
/** What Mara learns, in order, and the stop she knows it from. */
const MARA_KNOWS = [
  { fact: 'the ferry was sold', from: 1 },
  { fact: 'the toll had doubled', from: 2 },
  { fact: 'Kell had lit the fire', from: 4 },
  { fact: 'the Duke had paid him', from: 5 }
]
/** The stop where Kell is first met. */
const KELL_MET = 2
/** The stop where Mara loses her hand and the Gilded Eel burns. */
const FIRE = 3
const EEL = {
  name: 'The Gilded Eel',
  summary: 'A smoky riverside tavern where nobody asks questions.',
  before: 'Smoke, wet wool and quiet threats.',
  after: 'Charred beams, wet ash and the smell of lamp oil.'
}
/** The line at the top of an entry Adam made, as of a point. */
const MINE = {
  unchanged: 'You wrote this, and none of it has changed by this point.',
  changed: 'You wrote this. What has changed by this point is marked.'
}

/** What the memory has on the characters: who they are, what happens to them and what they learn. */
async function memoryOf(win: Page): Promise<string[]> {
  const out: string[] = []
  for (const e of await invoke(win, 'listEntries', 'character')) {
    out.push(e.name)
    for (const c of await invoke(win, 'listChanges', e.id)) {
      if (c.kind === 'update') out.push(`${e.name}: ${c.payload.note}`)
      if (c.kind === 'knowledge') out.push(`${e.name} knows ${c.payload.fact}`)
    }
  }
  return out.sort()
}
const REMEMBERED = [
  'Kell',
  'Kell: lost his hat',
  'Mara Venn',
  'Mara Venn: lost her left hand',
  ...MARA_KNOWS.map((k) => `Mara Venn knows ${k.fact}`)
].sort()

const slider = (win: Page) => main(win).getByRole('slider', { name: 'As of' })
/** A part of an entry as of a point, by its heading. */
const part = (win: Page, title: string) =>
  main(win)
    .locator('section')
    .filter({ has: win.getByRole('heading', { level: 3, name: title, exact: true }) })
/** One value of an entry as of a point, by its label; "Changed" shows beside the label once a change has set it. */
const shownValue = (win: Page, label: string) =>
  main(win)
    .locator('dl > div')
    .filter({ has: win.locator('dt > span', { hasText: new RegExp(`^${label}$`) }) })

/** Words on the page in view (the scene Adam was writing stays open, out of sight, behind it). */
const shown = (win: Page, words: string) => main(win).getByText(words).filter({ visible: true })

/** The entry shown as of a point: its name, and the point on the slider. */
async function expectPage(win: Page, name: string, i: number): Promise<void> {
  await expect(main(win).getByRole('heading', { level: 2, name, exact: true })).toBeVisible()
  await expect(slider(win)).toHaveAttribute('aria-valuetext', STOPS[i])
}

/** "What has happened so far": where, and what, in order. */
async function expectHappened(win: Page, happened: [string, string][]): Promise<void> {
  const section = part(win, 'What has happened so far')
  if (!happened.length) return expect(section.getByText('Nothing yet at this point.', { exact: true })).toBeVisible()
  await expect(section.getByRole('listitem')).toHaveCount(happened.length)
  for (const [k, [where, what]] of happened.entries()) {
    await expect(section.getByRole('listitem').nth(k)).toContainText(where)
    await expect(section.getByRole('listitem').nth(k)).toContainText(what)
  }
}

/** "Knows at this point": the facts, in the order they were learned. */
async function expectKnows(win: Page, facts: string[]): Promise<void> {
  const section = part(win, 'Knows at this point')
  if (!facts.length) return expect(section.getByText('Nothing noted yet.', { exact: true })).toBeVisible()
  await expect(section.getByRole('listitem')).toHaveCount(facts.length)
  for (const [k, fact] of facts.entries()) await expect(section.getByRole('listitem').nth(k)).toContainText(fact)
}

/** Mara as of stop `i`: what she knows grows scene by scene; her hand is lost from the fire on; Adam's own words never change. */
async function expectMara(win: Page, i: number): Promise<void> {
  await expectPage(win, 'Mara Venn', i)
  await expectKnows(
    win,
    MARA_KNOWS.filter((k) => k.from <= i).map((k) => k.fact)
  )
  for (const k of MARA_KNOWS.filter((k) => k.from > i)) await expect(shown(win, k.fact)).toHaveCount(0)
  const marks = shownValue(win, 'Distinguishing marks')
  if (i < FIRE) {
    await expect(main(win).getByText(MINE.unchanged, { exact: true })).toBeVisible()
    await expectHappened(win, [])
    await expect(marks).toHaveCount(0)
    await expect(shown(win, 'left hand')).toHaveCount(0)
  } else {
    await expect(main(win).getByText(MINE.changed, { exact: true })).toBeVisible()
    await expectHappened(win, [[STOPS[FIRE], 'Lost her left hand']])
    await expect(marks.locator('dd')).toHaveText('left hand lost')
    await expect(marks.getByText('Changed', { exact: true })).toBeVisible()
  }
  await expect(shownValue(win, 'Eyes').locator('dd')).toHaveText('grey')
  await expect(shownValue(win, 'Eyes').getByText('Changed', { exact: true })).toHaveCount(0)
}

/** Kell as of stop `i`: not in the story until the scene he is met in; from there, with the hat he lost there. */
async function expectKell(win: Page, i: number): Promise<void> {
  await expectPage(win, 'Kell', i)
  if (i < KELL_MET) {
    const absent = main(win).getByRole('status').filter({ hasText: 'Not in the story yet at this point' })
    await expect(absent).toBeVisible()
    await expect(absent).toContainText(`First appears: ${STOPS[KELL_MET]}.`)
    await expect(part(win, 'What has happened so far')).toHaveCount(0)
    return
  }
  await expect(shownValue(win, 'Short summary').locator('dd')).toHaveText('Someone called Kell.')
  await expectHappened(win, [[STOPS[KELL_MET], 'Lost his hat']])
  await expect(shownValue(win, 'Distinguishing marks').locator('dd')).toHaveText('hat lost')
  await expect(shownValue(win, 'Distinguishing marks').getByText('Changed', { exact: true })).toBeVisible()
  await expect(main(win).getByRole('status').filter({ hasText: 'Not in the story yet' })).toHaveCount(0)
}

/** The Gilded Eel as of stop `i`: as Adam wrote it until the fire; burned, and marked so, from then on. */
async function expectEel(win: Page, i: number): Promise<void> {
  await expectPage(win, EEL.name, i)
  const atmosphere = shownValue(win, 'Atmosphere')
  if (i < FIRE) {
    await expect(main(win).getByText(MINE.unchanged, { exact: true })).toBeVisible()
    await expect(atmosphere.locator('dd')).toHaveText(EEL.before)
    await expect(atmosphere.getByText('Changed', { exact: true })).toHaveCount(0)
    await expectHappened(win, [])
    await expect(shown(win, EEL.after)).toHaveCount(0)
  } else {
    await expect(main(win).getByText(MINE.changed, { exact: true })).toBeVisible()
    await expect(atmosphere.locator('dd')).toHaveText(EEL.after)
    await expect(atmosphere.getByText('Changed', { exact: true })).toBeVisible()
    await expectHappened(win, [[STOPS[FIRE], 'Burned to the waterline']])
  }
  await expect(shownValue(win, 'Short summary').locator('dd')).toHaveText(EEL.summary)
}

test('milestone 3, check 2: any entry can be viewed as of any scene', async ({ launch }) => {
  test.setTimeout(240_000)
  const fake = await startFake()
  try {
    const { win } = await launch({ env: { AIWRITE_KEEPER_QUIET_MS: '700' } })
    await createWorldFromWelcome(win, 'The Narrows')

    await test.step('setup: Book 1 in two chapters; Mara and the Gilded Eel, made by Adam; the Eel burns in scene 3', async () => {
      const [book] = await invoke(win, 'listStories')
      const outline = await invoke(win, 'getOutline', book.id)
      const chapters = [outline.chapters[0].id, (await invoke(win, 'createChapter', book.id)).id]
      const scenes: ID[] = [outline.scenes[0].id]
      await invoke(win, 'updateScene', scenes[0], { title: SCENES[0].title })
      for (const s of SCENES.slice(1)) scenes.push((await invoke(win, 'createScene', chapters[s.chapter - 1], { title: s.title })).id)
      await invoke(win, 'createEntry', 'character', {
        name: 'Mara Venn',
        aliases: ['Mara'],
        summary: 'A disgraced heir turned smuggler, who trusts nobody on the river.',
        fields: { pronouns: 'she/her', eyes: 'grey', traits: 'Watchful, dry and stubborn.' },
        originStoryId: book.id
      })
      const eel = await invoke(win, 'createEntry', 'place', {
        name: EEL.name,
        summary: EEL.summary,
        fields: { atmosphere: EEL.before },
        originStoryId: book.id
      })
      // Adam notes on the Eel's page that it burns in scene 3.
      await invoke(win, 'createChange', {
        entryId: eel.id,
        anchor: 'scene',
        sceneId: scenes[FIRE - 1],
        kind: 'update',
        payload: { note: 'burned to the waterline', fields: { atmosphere: EEL.after } }
      })
      // The fake server as the writer model, which the memory uses too; the window reloads and shows all this.
      await useFakeModel(win, fake)
    })

    await test.step('the five scenes are written; the memory reads them by itself', async () => {
      for (const s of SCENES) {
        await openScene(win, s.title)
        await writeParagraphs(win, s.text)
      }
      await binder(win).getByRole('button', { name: 'Characters' }).click()
      await expect.poll(() => memoryOf(win), MEMORY).toEqual(REMEMBERED)
    })

    await test.step('2. "View as of a scene" opens at the scene Adam was in', async () => {
      await openEntry(win, 'Characters', 'Mara Venn')
      await expect(nameBox(win)).toHaveValue('Mara Venn')
      await main(win).getByRole('button', { name: 'View as of a scene' }).click()
      await expect(slider(win)).toBeFocused()
      await expect(slider(win)).toHaveAttribute('aria-valuetext', STOPS[STOPS.length - 1])
    })

    // Adam moves the slider on Mara's page (to the start of the book, then a scene at a time), looks at
    // Kell and the Eel at that point, and comes back to Mara. Each page is checked as it opens, so what
    // it shows is that entry at that point, never what was on screen a moment before.
    for (const [i, at] of STOPS.entries()) {
      await test.step(`2. as of ${at}: Kell, the Gilded Eel and Mara`, async () => {
        await slider(win).press(i === 0 ? 'Home' : 'ArrowRight')
        await expect(slider(win)).toHaveAttribute('aria-valuetext', at)
        await openEntry(win, 'Characters', 'Kell')
        await expectKell(win, i)
        await openEntry(win, 'Places', EEL.name)
        await expectEel(win, i)
        await openEntry(win, 'Characters', 'Mara Venn')
        await expectMara(win, i)
      })
    }

    await test.step('2. Back to editing, in one click', async () => {
      await main(win).getByRole('button', { name: 'Back to editing' }).click()
      await expect(nameBox(win)).toHaveValue('Mara Venn')
      await expect(nameBox(win)).toBeEditable()
      await expect(slider(win)).toHaveCount(0)
      await expect(main(win).getByRole('button', { name: 'View as of a scene' })).toBeFocused()
      // The other pages open for editing again too.
      await openEntry(win, 'Places', EEL.name)
      await expect(nameBox(win)).toHaveValue(EEL.name)
      await expect(slider(win)).toHaveCount(0)
    })
  } finally {
    await fake.close()
  }
})

// ---------- 3. Search in a big world ----------

/** A small, steady source of random numbers (mulberry32), so the big world is the same on every run. */
function randomFrom(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FIRST = ['Aldous', 'Brann', 'Corwin', 'Dela', 'Edda', 'Fenn', 'Garrick', 'Hesketh', 'Ilsa', 'Jory', 'Kestrel', 'Lorne']
const LAST = ['Ashby', 'Blackwood', 'Carver', 'Dunmore', 'Ellery', 'Fairweather', 'Greaves', 'Holloway', 'Ingram', 'Jessop']
const TRADES = ['Cooper', 'Boatwright', 'Chandler', 'Tanner', 'Ropemaker', 'Toll-keeper', 'Smith', 'Fisher', 'Carter', 'Glazier', 'Mason']
const PLACE_WORDS = [
  ['Old', 'North', 'South', 'Upper', 'Lower', 'Grey', 'Salt', 'Low', 'High', 'Black'],
  ['Quay', 'Steps', 'Market', 'Wharf', 'Gate']
]
const ITEM_WORDS = [
  ['Brass', 'Iron', 'Silver', 'Copper', 'Bone', 'Oak'],
  ['Key', 'Compass', 'Ring', 'Knife', 'Seal']
]
const WHO = ['She', 'He', 'The keeper', 'A boatman', 'The girl', 'Nobody', ...FIRST]
const VERBS = [
  'carried',
  'watched',
  'counted',
  'pulled',
  'pushed',
  'crossed',
  'opened',
  'closed',
  'lifted',
  'dropped',
  'found',
  'kept',
  'sold',
  'tied'
]
const ADJECTIVES = ['old', 'cold', 'wet', 'grey', 'dark', 'quiet', 'heavy', 'narrow', 'bitter', 'warm', 'thin', 'broad', 'low', 'deep']
const NOUNS = ['rope', 'barge', 'door', 'lamp', 'crate', 'cask', 'coin', 'letter', 'net', 'oar', 'cloak', 'sack', 'gate', 'cart', 'kettle']
const PLACES = ['quay', 'steps', 'market', 'wharf', 'warehouse', 'boatshed', 'tavern', 'yard', 'stair', 'bridge', 'ford', 'mill']
const PREPOSITIONS = ['under', 'past', 'along', 'through', 'beside', 'behind', 'across', 'toward', 'over']

/** What Adam looks for in the big world, and where it is. */
const FIND = {
  /** Book 1, Ch 10, Sc 12 */
  scene: { chapter: 9, scene: 11, title: 'Bells before dawn', words: 'The bells of Quillmere rang twice before dawn.' },
  name: { character: 103, name: 'Isolde Marrowgate' },
  alias: { character: 77, alias: 'the Lantern Widow' },
  summary: { chapter: 6, text: 'Mara hears the drowned bell of Saltreach and follows it down to the old quay.' },
  note: { place: 37, text: 'Keeps the Harrowgate ledger under the hearthstone, wrapped in oilcloth.' }
}
const BIG = { chapters: 12, scenes: 25, characters: 120, places: 50, items: 30 }

interface BigWorld {
  chapters: { title: string; summary: string; scenes: { title: string; text: string }[] }[]
  entries: { kind: EntryKind; input: EntryInput }[]
}

/** 300 scenes of about 100 words in 12 chapters, each chapter with a summary, and 200 entries with other names, summaries and notes. */
function bigWorld(): BigWorld {
  const r = randomFrom(3)
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  const sentence = (): string =>
    `${pick(WHO)} ${pick(VERBS)} the ${pick(ADJECTIVES)} ${pick(NOUNS)} ${pick(PREPOSITIONS)} the ${pick(PLACES)}` +
    (r() < 0.25 ? `, and the river ran ${pick(ADJECTIVES)} and ${pick(ADJECTIVES)}.` : '.')
  const sentences = (n: number): string => Array.from({ length: n }, sentence).join(' ')
  const chapters: BigWorld['chapters'] = []
  for (let c = 0; c < BIG.chapters; c++) {
    const scenes = []
    for (let s = 0; s < BIG.scenes; s++) {
      const paras = [sentences(3), sentences(4), sentences(3)]
      if (c === FIND.scene.chapter && s === FIND.scene.scene) paras[1] = `${paras[1]} ${FIND.scene.words}`
      const title =
        c === FIND.scene.chapter && s === FIND.scene.scene
          ? FIND.scene.title
          : `${pick(['Rain', 'Fog', 'Night', 'Smoke'])} at the ${pick(PLACES)}`
      scenes.push({ title, text: paras.join('\n\n') })
    }
    const summary = c === FIND.summary.chapter ? FIND.summary.text : `${sentences(2)} ${sentences(1)}`
    chapters.push({ title: `Chapter ${c + 1}`, summary, scenes })
  }
  const entries: BigWorld['entries'] = []
  for (let i = 0; i < BIG.characters; i++) {
    const name = i === FIND.name.character ? FIND.name.name : `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length)]}`
    const trade = TRADES[(i * 7) % TRADES.length]
    const aliases = [`${name.split(' ')[0]} the ${trade}`, ...(i === FIND.alias.character ? [FIND.alias.alias] : [])]
    entries.push({
      kind: 'character',
      input: {
        name,
        aliases,
        summary: `A ${pick(ADJECTIVES)} ${trade.toLowerCase()} from the ${pick(PLACES)}.`,
        description: sentences(3),
        notes: sentences(1),
        fields: { traits: sentences(1), fears: sentences(1) }
      }
    })
  }
  for (let i = 0; i < BIG.places; i++) {
    const [first, second] = PLACE_WORDS
    entries.push({
      kind: 'place',
      input: {
        name: `${first[i % first.length]} ${second[Math.floor(i / first.length)]}`,
        aliases: [`the ${pick(ADJECTIVES)} ${pick(PLACES)}`],
        summary: sentences(1),
        notes: i === FIND.note.place ? FIND.note.text : sentences(1),
        fields: { atmosphere: sentences(2) }
      }
    })
  }
  for (let i = 0; i < BIG.items; i++) {
    const [first, second] = ITEM_WORDS
    entries.push({
      kind: 'item',
      input: {
        name: `${first[i % first.length]} ${second[Math.floor(i / first.length)]}`,
        summary: sentences(1),
        notes: sentences(1),
        fields: { powers: sentences(1) }
      }
    })
  }
  return { chapters, entries }
}

/** Makes the big world through the app's API, from the window, as the interface would: one call after another. */
function makeBigWorld(win: Page, storyId: ID, world: BigWorld): Promise<{ chapters: ID[]; scenes: ID[][]; entries: ID[] }> {
  return win.evaluate(
    async ([storyId, world]) => {
      const { aiwrite } = globalThis as unknown as { aiwrite: Bridge }
      const call = async <T = { id: ID }>(method: ApiMethod, ...args: unknown[]): Promise<T> => {
        const res = (await aiwrite.invoke(method, ...args)) as IpcResult<T>
        if (!res.ok) throw new Error(`${method}: ${res.error.message}`)
        return res.value
      }
      const outline = await call<{ chapters: { id: ID }[]; scenes: { id: ID }[] }>('getOutline', storyId)
      const made = { chapters: [] as ID[], scenes: [] as ID[][], entries: [] as ID[] }
      for (const [c, chapter] of world.chapters.entries()) {
        const chapterId = c === 0 ? outline.chapters[0].id : (await call('createChapter', storyId, { title: chapter.title })).id
        const ids: ID[] = []
        for (const [s, scene] of chapter.scenes.entries()) {
          const first = c === 0 && s === 0
          const id = first ? outline.scenes[0].id : (await call('createScene', chapterId, { title: scene.title })).id
          if (first) await call('updateScene', id, { title: scene.title })
          await call('saveSceneText', id, null, scene.text)
          ids.push(id)
        }
        await call('setSummary', 'chapter', chapterId, chapter.summary)
        made.chapters.push(chapterId)
        made.scenes.push(ids)
      }
      for (const e of world.entries) made.entries.push((await call('createEntry', e.kind, e.input)).id)
      return made
    },
    [storyId, world] as const
  )
}

interface Timed {
  results: SearchResults
  /** How long each search took in the main process, as it reports it. */
  inMain: number[]
  /** How long each took from the window: asked, searched and answered. */
  roundTrip: number[]
}

/** Searches `runs` times in a row from the window, as the palette does, timing each. */
function timedSearch(win: Page, words: string, storyId: ID, runs: number): Promise<Timed> {
  return win.evaluate(
    async ([words, storyId, runs]) => {
      const { aiwrite } = globalThis as unknown as { aiwrite: Bridge }
      const inMain: number[] = []
      const roundTrip: number[] = []
      let results: SearchResults | null = null
      for (let i = 0; i < runs; i++) {
        const started = performance.now()
        const res = (await aiwrite.invoke('search', words, { storyId })) as IpcResult<SearchResults>
        roundTrip.push(Math.round((performance.now() - started) * 10) / 10)
        if (!res.ok) throw new Error(res.error.message)
        results = res.value
        inMain.push(res.value.ms)
      }
      return { results: results!, inMain, roundTrip }
    },
    [words, storyId, runs] as const
  )
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

const palette = (win: Page) => win.getByRole('dialog', { name: 'Search' })
const searchBox = (win: Page) => win.getByRole('combobox', { name: 'Search, or find an action' })

test('milestone 3, check 3: search finds anything in under 100 ms', async ({ launch }) => {
  test.setTimeout(300_000)
  // No model is chosen, and the memory waits long after any typing: nothing else runs while searching.
  const { win } = await launch({ env: { AIWRITE_KEEPER_QUIET_MS: '600000' } })
  await createWorldFromWelcome(win, 'The Long Coast')
  const [book] = await invoke(win, 'listStories')
  const world = bigWorld()

  const made = await test.step('setup: 300 scenes of about 100 words, 12 chapter summaries and 200 entries', async () => {
    // On the style guide, which lists nothing that grows as the world does.
    await binder(win).getByRole('button', { name: 'Style guide' }).click()
    await expect(win.getByRole('heading', { level: 1, name: 'Style guide' })).toBeVisible()
    const started = Date.now()
    const made = await makeBigWorld(win, book.id, world)
    await win.reload()
    await expect(binder(win)).toBeVisible()
    const { scenes } = await invoke(win, 'getOutline', book.id)
    expect(scenes).toHaveLength(BIG.chapters * BIG.scenes)
    const words = scenes.reduce((n, s) => n + s.wordCount, 0)
    expect(words / scenes.length).toBeGreaterThan(90)
    expect(words / scenes.length).toBeLessThan(110)
    expect(await invoke(win, 'listEntries')).toHaveLength(BIG.characters + BIG.places + BIG.items)
    console.log(
      `The big world: ${scenes.length} scenes, ${words} words, ${world.entries.length} entries, made in ${Date.now() - started} ms.`
    )
    return made
  })

  const riverScenes = world.chapters.flatMap((c) => c.scenes).filter((s) => /\briver/i.test(`${s.title} ${s.text}`)).length
  const looks: { what: string; words: string; group: SearchGroupId; key: string | null; total: number; detail?: string }[] = [
    {
      what: 'Words in one scene',
      words: 'quillmere',
      group: 'scenes',
      key: `scene:${made.scenes[FIND.scene.chapter][FIND.scene.scene]}`,
      total: 1,
      detail: 'Book 1, Ch 10, Sc 12'
    },
    {
      what: "An entry's name",
      words: 'isolde marrowgate',
      group: 'character',
      key: `entry:${made.entries[FIND.name.character]}`,
      total: 1
    },
    {
      what: 'Another name it goes by',
      words: 'lantern widow',
      group: 'character',
      key: `entry:${made.entries[FIND.alias.character]}`,
      total: 1
    },
    {
      what: 'A chapter summary',
      words: 'drowned bell saltreach',
      group: 'summaries',
      key: `summary:chapter:${made.chapters[FIND.summary.chapter]}`,
      total: 1
    },
    {
      what: 'A private note',
      words: 'hearthstone ledger',
      group: 'notes',
      key: `note:entry:${made.entries[BIG.characters + FIND.note.place]}`,
      total: 1
    },
    { what: 'A word all over the book', words: 'river', group: 'scenes', key: null, total: riverScenes }
  ]

  await test.step('3. each kind of thing is found, in under 100 ms (the median of seven searches, after one to warm up)', async () => {
    // The first search after the world is made reads it all into the index.
    const warm = await invoke(win, 'search', 'warm up', { storyId: book.id })
    const report = [`The search to warm up: ${warm.ms} ms in the main process`]
    for (const look of looks) {
      const { results, inMain, roundTrip } = await timedSearch(win, look.words, book.id, 7)
      const group = results.groups.find((g) => g.id === look.group)
      expect(group?.total, `${look.what} ("${look.words}"): how many are found`).toBe(look.total)
      if (look.key) expect(group?.hits[0]?.key, `${look.what} ("${look.words}") comes first`).toBe(look.key)
      else expect(group?.hits.length).toBe(4)
      if (look.detail) expect(group?.hits[0]?.detail).toBe(look.detail)
      report.push(
        `${look.what} ("${look.words}"): median ${median(inMain)} ms in the main process, ${median(roundTrip)} ms from the window` +
          ` (each: ${inMain.join(', ')} ms; ${roundTrip.join(', ')} ms)`
      )
      expect(median(inMain), `${look.what}: the main process's search`).toBeLessThan(100)
      expect(median(roundTrip), `${look.what}: from the window and back`).toBeLessThan(100)
    }
    console.log(`Search timings, ${BIG.chapters * BIG.scenes} scenes and ${world.entries.length} entries:\n${report.join('\n')}`)
    await test.info().attach('search timings', { body: report.join('\n'), contentType: 'text/plain' })
  })

  await test.step('3. Ctrl+K and typing shows it; Enter opens the scene at the words', async () => {
    await win.keyboard.press('Control+K')
    await expect(searchBox(win)).toBeFocused()
    await win.keyboard.type('quillmere')
    const hit = palette(win).getByRole('group', { name: 'Scenes', exact: true }).getByRole('option').first()
    await expect(hit).toContainText('Quillmere rang twice before dawn')
    await expect(hit).toContainText('Book 1, Ch 10, Sc 12')
    await expect(hit.locator('mark')).toHaveText('Quillmere')
    await expect(hit).toHaveAttribute('aria-selected', 'true')
    await win.keyboard.press('Enter')
    await expect(palette(win)).toBeHidden()
    await expect(sceneHeader(win).getByRole('button', { name: FIND.scene.title, exact: true })).toBeVisible()
    await expect(paragraph(win, FIND.scene.words)).toBeVisible()
  })
})
