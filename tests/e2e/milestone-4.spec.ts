// Milestone 4's acceptance checks ("Drafting"), walked through the interface the way Adam works, against the
// fake provider (tests/fake-provider/server.mjs, its milestone 4 replies in tests/fake-provider/m4/) and the fake
// speech engine (tests/fake-speech/). The fake AI's World builder reads the summary a sentence at a time
// (m4/world.mjs: "X is a port town in Y" is a place inside Y, "X keeps the Y" an item, "X always ..." a rule,
// "The X happened in W" an event, a question a plot thread, a name and "is" a character). Its edits are worked
// out from the selected words (m4/edits.mjs: Condense keeps the first sentence of a paragraph, Expand and More
// vivid add a sentence); its speaker marks give each untagged line of dialogue to the first two characters the
// scene names, in turn (m4/readAloud.mjs). The speech engine's one-click downloads run tests/fake-speech/install.mjs
// in place of each real step, and the server AI Write then starts is tests/fake-speech/server.mjs: it says which
// voice each line was asked for in, and writes down what Chromium's fake microphone (AIWRITE_FAKE_MIC=1) "said" as
// the words it is given.
//
//  1. Every AI edit can be accepted, rejected or undone. Adam selects a paragraph and asks for Condense: the
//     change shows in the page as a tracked change (the old words struck through, the new ones marked) and
//     nothing in the scene changes until he decides. Accept puts the new words in, and they are saved; one
//     Ctrl+Z takes them out again, back to his words exactly. Expand on another paragraph, then Reject: his
//     words stay as they were, and nothing of the change is ever saved.
//  2. Any earlier version of a scene can be compared and restored. Adam writes a paragraph, writes another a
//     little later, and accepts an AI change (More vivid). History shows the earlier versions; picking the
//     first one shows it side by side with the scene now. Restore puts it back (saved, with a message saying
//     Ctrl+Z takes it out); Ctrl+Z takes the restore back; it can be restored again; and the version kept
//     just before restoring can itself be restored, bringing the scene back to how it was.
//  3. After one-click downloads, a scene is read aloud with the narrator and each character in their own
//     voice. From nothing downloaded, one click on Download the voices downloads the speech engine and the
//     voices and starts the engine; Read scenes aloud loads them. Mara and Tobin each get a voice from the
//     list on their page. A scene of narration and untagged dialogue is read with Ctrl+L to the end: the
//     narration in the narrator's voice, and each line of dialogue in the voice of whoever the AI marked as
//     saying it, both of them having lines, and each with their own voice.
//  4. Holding the dictation key types spoken words into the scene at the cursor, and one Ctrl+Z takes them
//     out. Picking Parakeet downloads the speech engine and the dictation model with one click; Adam picks
//     F9 as the key, puts the cursor at the end of his first paragraph and holds F9 while he speaks: the
//     words go in there (the paragraph after it untouched) and are saved; one Ctrl+Z takes out just them.
//  5. A world typed as a one-paragraph summary comes out as characters, places, items, rules, events and plot
//     threads in one click, with Adam's words kept as written. From World › Build from a summary, Adam types
//     one paragraph and clicks Build the world once, with nothing to approve: the page lists two characters,
//     two places (one inside the other), an item, a rule never to break, a dated event and a plot thread, each
//     with Open. Each is saved with the sentence of his that it came from, word for word and his (not the
//     AI's), and every other field drafted and marked as the AI's; Mara Venn's page shows it so.
//
// What isn't being checked (the world, the fake AI as the writer model, the characters' names) is set up through
// the app's API, the same calls the interface makes, and the window is reloaded to show it.
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import type { Entry, EntryKind } from '@shared/types'
import { binder, createWorldFromWelcome, expect, invoke, openSettings, startFake, test, useFakeModel } from './helpers'

/** The memory waits long after any typing, so the only AI calls are the ones each check makes. */
const QUIET = { AIWRITE_KEEPER_QUIET_MS: '600000' }

// ---------- Finding things on screen ----------

const main = (win: Page) => win.locator('main')
const prose = (win: Page) => win.locator('.scene-prose')
const paras = (win: Page) => prose(win).locator('p')
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')
const header = (win: Page) => win.locator('main header')
const sceneRow = (win: Page, title: string) => binder(win).locator('[data-row="scene"]', { hasText: title }).first()

async function firstScene(win: Page): Promise<string> {
  const [story] = await invoke(win, 'listStories')
  const { scenes } = await invoke(win, 'getOutline', story.id)
  return scenes[0].id
}

const savedText = async (win: Page, sceneId: string): Promise<string> => (await invoke(win, 'getScene', sceneId)).text

/** Writes paragraphs at the end of the open scene, each arriving whole, as when Adam pastes it. */
async function writeParagraphs(win: Page, text: string[]): Promise<void> {
  const empty = !(await prose(win).innerText()).trim()
  await prose(win).click()
  await win.keyboard.press('Control+End')
  for (const [i, p] of text.entries()) {
    if (i > 0 || !empty) await win.keyboard.press('Enter')
    await win.keyboard.insertText(p)
  }
  await expect(paras(win).last()).toHaveText(text[text.length - 1])
}

/**
 * True once the page has the caret at the start or end of paragraph `i`. The browser tells the page where a
 * click or a key put the caret a moment later, and a key pressed before then would act where it was.
 */
const CARET = `(i, end) => {
  const { $head, empty } = document.querySelector('.scene-prose').editor.state.selection
  return empty && $head.index(0) === i && $head.parentOffset === (end ? $head.parent.content.size : 0)
}`

/** Puts the caret at the end of paragraph `i` (or its start). */
async function caretAt(win: Page, i: number, where: 'end' | 'start' = 'end'): Promise<void> {
  await paras(win).nth(i).click()
  await win.keyboard.press(where === 'end' ? 'End' : 'Home')
  await expect.poll(() => win.evaluate(`(${CARET})(${i}, ${where === 'end'})`)).toBe(true)
}

// ---------- AI edits ----------

const selectionBar = (win: Page) => win.getByRole('toolbar', { name: 'Selected words' })
const tools = (win: Page) => win.locator('[data-ai-tools]')
const change = (win: Page) => win.getByRole('group', { name: 'The AI’s change' })
const oldWords = (win: Page) => prose(win).locator('.aw-sugg-old')
const newWords = (win: Page) => prose(win).locator('.aw-sugg-words')
const acceptButton = (win: Page) => change(win).getByRole('button', { name: /^Accept/ })
const rejectButton = (win: Page) => change(win).getByRole('button', { name: /^Reject/ })

/** Selects all of paragraph `i` with the keyboard (Home, then Shift+End), and waits for the bar over the words. */
async function selectParagraph(win: Page, i: number): Promise<void> {
  await caretAt(win, i, 'start')
  await win.keyboard.press('Shift+End')
  const words = (await paras(win).nth(i).textContent()) ?? ''
  await expect.poll(() => win.evaluate('document.getSelection().toString()')).toBe(words)
  await expect(selectionBar(win)).toBeVisible()
}

/** Runs one of the AI tools (behind Rewrite in the bar) on the selected words, and waits for its change. */
async function runTool(win: Page, name: string): Promise<void> {
  await selectionBar(win).getByRole('button', { name: 'Rewrite', exact: true }).click()
  await expect(tools(win)).toBeVisible()
  await tools(win)
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click()
  await expect(tools(win)).toBeHidden()
  await expect(acceptButton(win)).toBeVisible()
}

// ---------- 1. Every AI edit can be accepted, rejected or undone ----------

const TAVERN = 'The tavern was warm and loud. Rain hammered the shutters.'
const CROWD = 'Mara pushed through the crowd to the back table.'
const TAVERN_TEXT = [TAVERN, CROWD]
/** What the fake AI's Condense and Expand make of those paragraphs. */
const CONDENSED = 'The tavern was warm and loud.'
const EXPANDED = `${CROWD} She let the silence stretch until the fire popped.`

test('milestone 4, check 1: every AI edit can be accepted, rejected or undone', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch({ env: QUIET })
    await createWorldFromWelcome(win, 'The Narrows')
    await useFakeModel(win, fake)
    const sceneId = await firstScene(win)
    await writeParagraphs(win, TAVERN_TEXT)
    await expect.poll(() => savedText(win, sceneId)).toBe(TAVERN_TEXT.join('\n\n'))

    await test.step('1. Condense shows as a tracked change; the scene is unchanged until Adam decides', async () => {
      await selectParagraph(win, 0)
      await runTool(win, 'Condense')
      // The old words struck through, the new ones marked after them.
      await expect(oldWords(win)).toHaveText(TAVERN)
      await expect(newWords(win)).toHaveText(CONDENSED)
      await expect(rejectButton(win)).toBeVisible()
      await expect(change(win)).toContainText('Condense')
      // Nothing of it is in the scene yet.
      await win.waitForTimeout(1200)
      expect(await savedText(win, sceneId)).toBe(TAVERN_TEXT.join('\n\n'))
    })

    await test.step('1. Accept keeps it: the new words take the old ones’ place, and are saved', async () => {
      await acceptButton(win).click()
      await expect(change(win)).toBeHidden()
      await expect(oldWords(win)).toHaveCount(0)
      await expect(newWords(win)).toHaveCount(0)
      await expect(paras(win)).toHaveText([CONDENSED, CROWD])
      await expect.poll(() => savedText(win, sceneId)).toBe([CONDENSED, CROWD].join('\n\n'))
    })

    await test.step('1. Ctrl+Z after accepting takes it back: Adam’s words exactly as they were', async () => {
      await expect(prose(win)).toBeFocused()
      await win.keyboard.press('Control+z')
      await expect(paras(win)).toHaveText(TAVERN_TEXT)
      await expect.poll(() => savedText(win, sceneId)).toBe(TAVERN_TEXT.join('\n\n'))
    })

    await test.step('1. Reject restores the old words, and nothing of the change is ever saved', async () => {
      await selectParagraph(win, 1)
      await runTool(win, 'Expand')
      await expect(oldWords(win)).toHaveText(CROWD)
      await expect(newWords(win)).toHaveText(EXPANDED)
      await rejectButton(win).click()
      await expect(change(win)).toBeHidden()
      await expect(oldWords(win)).toHaveCount(0)
      await expect(newWords(win)).toHaveCount(0)
      await expect(toasts(win).getByText('Change rejected.', { exact: true })).toBeVisible()
      await expect(paras(win)).toHaveText(TAVERN_TEXT)
      await win.waitForTimeout(1200)
      expect(await savedText(win, sceneId)).toBe(TAVERN_TEXT.join('\n\n'))
    })
  } finally {
    await fake.close()
  }
})

// ---------- 2. Any earlier version of a scene can be compared and restored ----------

const historyButton = (win: Page) => header(win).getByRole('button', { name: 'History of this scene', exact: true })
const versions = (win: Page) => win.getByRole('navigation', { name: 'Earlier versions' })
const comparison = (win: Page) => win.getByRole('region', { name: 'Comparison' })
const thenSide = (win: Page) => comparison(win).locator('[data-side="then"]')
const nowSide = (win: Page) => comparison(win).locator('[data-side="now"]')
const restoreButton = (win: Page) => comparison(win).getByRole('button', { name: 'Restore this version' })
/** The message a restore leaves (the newest, when the one from a restore before is still showing). */
const restored = (win: Page) =>
  toasts(win)
    .getByText(/^The version from today at .+ is back in the scene\. Ctrl\+Z takes it out again\.$/)
    .last()

const FIRST = 'The rain had not stopped since dawn, and Mara waited by the door.'
const SECOND = 'Tobin came late, his coat dark with water.'
/** What the fake AI's More vivid makes of the second paragraph. */
const VIVID = `${SECOND} The lamplight shivered on the wet stones.`
const NOW = [FIRST, VIVID]

const labels = async (win: Page, sceneId: string): Promise<string[]> =>
  (await invoke(win, 'listSnapshots', sceneId)).snapshots.map((s) => s.label)

/** Opens the scene's History from its toolbar. */
async function openHistory(win: Page): Promise<void> {
  await historyButton(win).click()
  await expect(win.getByRole('heading', { level: 1, name: 'History' })).toBeVisible()
  await expect(versions(win)).toBeVisible()
}

/** The first version kept (the oldest "While writing"): the scene with only its first paragraph. */
const firstVersion = (win: Page) =>
  versions(win)
    .getByRole('button', { name: /While writing/ })
    .last()

test('milestone 4, check 2: any earlier version of a scene can be compared and restored', async ({ launch }) => {
  const fake = await startFake()
  try {
    // Writing keeps a version every 10 minutes; here every 1.5 seconds.
    const { win } = await launch({ env: { ...QUIET, AIWRITE_HISTORY_WRITING_MS: '1500' } })
    await createWorldFromWelcome(win, 'The Narrows')
    await useFakeModel(win, fake)
    const sceneId = await firstScene(win)

    await test.step('setup: Adam writes a paragraph, another a little later, and accepts an AI change', async () => {
      await writeParagraphs(win, [FIRST])
      await expect.poll(() => savedText(win, sceneId)).toBe(FIRST)
      await expect.poll(() => labels(win, sceneId)).toEqual(['While writing'])
      await win.waitForTimeout(1600)
      await writeParagraphs(win, [SECOND])
      await expect.poll(() => savedText(win, sceneId)).toBe(`${FIRST}\n\n${SECOND}`)
      await expect.poll(async () => (await labels(win, sceneId)).length).toBe(2)
      await selectParagraph(win, 1)
      await runTool(win, 'More vivid')
      await acceptButton(win).click()
      await expect(paras(win)).toHaveText(NOW)
      await expect.poll(() => savedText(win, sceneId)).toBe(NOW.join('\n\n'))
    })

    await test.step('2. History shows the earlier versions; each is compared side by side with the scene now', async () => {
      await openHistory(win)
      // It opens on the newest version that differs from now: the scene before the AI's change.
      await expect(thenSide(win).filter({ hasText: SECOND }).first()).toBeVisible()
      await expect(thenSide(win).filter({ hasText: 'lamplight' })).toHaveCount(0)
      await expect(nowSide(win).filter({ hasText: 'The lamplight shivered on the wet stones.' }).first()).toBeVisible()
      await expect(comparison(win).locator('mark').first()).toBeVisible()
      // The first version, beside the scene now: just its first paragraph, against both of today's.
      await firstVersion(win).click()
      await expect(firstVersion(win)).toHaveAttribute('aria-current', 'true')
      await expect(comparison(win).getByRole('heading', { name: 'While writing' })).toBeVisible()
      await expect(comparison(win).getByText('This version', { exact: true })).toBeVisible()
      await expect(thenSide(win).filter({ hasText: FIRST }).first()).toBeVisible()
      await expect(thenSide(win).filter({ hasText: SECOND })).toHaveCount(0)
      await expect(nowSide(win).filter({ hasText: FIRST }).first()).toBeVisible()
      await expect(nowSide(win).filter({ hasText: 'The lamplight shivered on the wet stones.' }).first()).toBeVisible()
    })

    await test.step('2. Restore brings it back into the scene, saved', async () => {
      await restoreButton(win).click()
      await expect(prose(win)).toBeVisible()
      await expect(paras(win)).toHaveText([FIRST])
      await expect(restored(win)).toBeVisible()
      await expect.poll(() => savedText(win, sceneId)).toBe(FIRST)
      await expect.poll(async () => (await labels(win, sceneId))[0]).toBe('Before restoring')
    })

    await test.step('2. Ctrl+Z takes the restore back', async () => {
      await expect(prose(win)).toBeFocused()
      await win.keyboard.press('Control+z')
      await expect(paras(win)).toHaveText(NOW)
      await expect.poll(() => savedText(win, sceneId)).toBe(NOW.join('\n\n'))
    })

    await test.step('2. It can be restored again', async () => {
      await openHistory(win)
      await firstVersion(win).click()
      await expect(thenSide(win).filter({ hasText: SECOND })).toHaveCount(0)
      await restoreButton(win).click()
      await expect(paras(win)).toHaveText([FIRST])
      await expect(restored(win)).toBeVisible()
      await expect.poll(() => savedText(win, sceneId)).toBe(FIRST)
    })

    await test.step('2. The version kept before restoring can be restored too: the scene as it was', async () => {
      await openHistory(win)
      await versions(win)
        .getByRole('button', { name: /Before restoring/ })
        .first()
        .click()
      await expect(comparison(win).getByRole('heading', { name: 'Before restoring' })).toBeVisible()
      await expect(thenSide(win).filter({ hasText: 'The lamplight shivered on the wet stones.' }).first()).toBeVisible()
      await restoreButton(win).click()
      await expect(paras(win)).toHaveText(NOW)
      await expect(restored(win)).toBeVisible()
      await expect.poll(() => savedText(win, sceneId)).toBe(NOW.join('\n\n'))
    })
  } finally {
    await fake.close()
  }
})

// ---------- The speech engine, downloaded with one click ----------

const FAKE_SPEECH = resolve(__dirname, '..', 'fake-speech')

/** A port nothing listens on, so no other speech server on this computer is found by chance. */
function unusedPort(): Promise<number> {
  return new Promise((done) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => done(port))
    })
  })
}

/**
 * The app's environment for the fake speech engine: each download step runs install.mjs (quickly, nothing
 * fetched), and the server AI Write starts is server.mjs, with `options` (as AIWRITE_FAKE_SPEECH_OPTIONS).
 */
const speechEnv = (options: Record<string, unknown> = {}): Record<string, string> => ({
  AIWRITE_FAKE_SPEECH_INSTALL: join(FAKE_SPEECH, 'install.mjs'),
  AIWRITE_FAKE_SPEECH_RUN: join(FAKE_SPEECH, 'server.mjs'),
  AIWRITE_FAKE_SPEECH_OPTIONS: JSON.stringify({ guard: true, ...options }),
  AIWRITE_FAKE_SPEECH_GPU: 'NVIDIA GeForce RTX 4090'
})

/** Settings' speech engine section (the everyday one, above More). */
const engine = (win: Page): Locator =>
  win
    .locator('section')
    .filter({ has: win.getByRole('heading', { level: 2, name: 'Speech engine', exact: true }) })
    .first()

/** One of the facts at the top of it: Voices, Dictation or Runs on. */
const fact = (win: Page, label: string): Locator =>
  engine(win)
    .locator('dl > div')
    .filter({ has: win.locator('dt', { hasText: label }) })
    .locator('dd')

/** Opens Settings › Read aloud and dictation, where nothing is downloaded or running yet. */
async function openSpeechSettings(win: Page): Promise<void> {
  await openSettings(win, 'Read aloud and dictation')
  await expect(engine(win).getByText('Not running', { exact: true })).toBeVisible()
  await expect(fact(win, 'Voices')).toHaveText('Not downloaded')
}

// ---------- 3. A scene read aloud, the narrator and each character in their own voice ----------

/** One request the speech server was asked to speak. */
interface Spoken {
  input: string
  voice?: string
  voice_design?: string
}

/** What AI Write's own (fake) speech server has been asked to say so far. */
async function spoken(address: string): Promise<Spoken[]> {
  const res = await fetch(`${address.replace(/\/v1$/, '')}/__spoken`)
  return (await res.json()) as Spoken[]
}

const readingBar = (win: Page) => win.getByRole('region', { name: 'Reading aloud' })

/**
 * From now on, notes every 30 ms which words are highlighted and who the reading bar says is speaking, each
 * change once, so the test can tell afterwards who read each line. (Run in the window, so written as a script.)
 */
const watchReading = (win: Page): Promise<unknown> =>
  win.evaluate(`(() => {
    const heard = []
    setInterval(() => {
      const lit = [...document.querySelectorAll('.scene-prose .aw-reading')].map((el) => el.textContent || '').join('')
      const bar = document.querySelector('[role="region"][aria-label="Reading aloud"] p')?.textContent || ''
      const last = heard[heard.length - 1]
      if (lit.trim() && (!last || last.lit !== lit || last.bar !== bar)) heard.push({ lit, bar })
    }, 30)
    window.__heard = heard
  })()`)

/** Who the reading bar said was speaking while these words were lit (the last it said, once it had caught up). */
async function whoRead(win: Page, words: string): Promise<string | undefined> {
  const heard = (await win.evaluate('window.__heard')) as { lit: string; bar: string }[]
  return heard
    .filter((h) => h.lit.includes(words))
    .at(-1)
    ?.bar.split(' · ')[0]
}

/** Each character and the voice Adam picks for them from the list on their page. */
const CAST = [
  { name: 'Mara', summary: 'Runs the harbour ferry. Thirty-four, sharp-tongued.', voice: { id: 'young-woman', name: 'Young woman' } },
  { name: 'Tobin', summary: 'An old boatman who has seen every tide twice.', voice: { id: 'old-man', name: 'Old man' } }
]
const NARRATOR_VOICE = 'narrator'

/**
 * The scene: narration that names the two of them (so the AI is told about them), around a conversation whose lines
 * have no tags, so the AI's marks say who says each.
 */
const NARRATION = [
  'Mara and Tobin met on the harbour wall as the lamps went out one by one, and the last boats nosed in against the stones.',
  'The door closed behind them, and for the first time in three days the fire was warm.'
]
const DIALOGUE = [
  '"Get out of the rain before the whole harbour sees you standing there."',
  '"I was waiting for the ferry, and I would wait all night if I had to."',
  '"Then wait inside, where the fire is lit and nobody is watching."'
]
const READ_ALOUD_SCENE = [NARRATION[0], ...DIALOGUE, NARRATION[1]]
/** Words of each line, as the voice is sent them and the highlight shows them (quote marks aside). */
const wordsOf = (line: string): string => line.replace(/^"|"$/g, '').slice(0, 30)

test('milestone 4, check 3: after one-click downloads, a scene is read aloud with the narrator and each character in their own voice', async ({
  launch
}) => {
  test.setTimeout(180_000)
  const fake = await startFake()
  try {
    const address = `http://127.0.0.1:${await unusedPort()}/v1`
    const { win } = await launch({ env: { ...QUIET, ...speechEnv() } })
    await createWorldFromWelcome(win, 'Harbour')
    const ids: Record<string, string> = {}
    for (const c of CAST) ids[c.name] = (await invoke(win, 'createEntry', 'character', { name: c.name, summary: c.summary })).id
    await invoke(win, 'updateSettings', { speech: { serverUrl: address } })
    await useFakeModel(win, fake)

    await test.step('3. one click on Download the voices downloads the speech engine and the voices, and starts it', async () => {
      await openSpeechSettings(win)
      const section = engine(win)
      await section.getByRole('button', { name: 'Download the voices' }).click()
      await expect(win.getByText('The voices are downloaded.')).toBeVisible({ timeout: 60_000 })
      await expect(section.getByText('Connected', { exact: true })).toBeVisible()
      await expect(fact(win, 'Voices')).toHaveText(/^Ready/)
      await expect(section.getByRole('switch', { name: 'Start with AI Write' })).toBeChecked()
    })

    await test.step('3. Read scenes aloud loads the voices', async () => {
      const on = win.getByRole('switch', { name: 'Read scenes aloud' })
      await on.click()
      await expect(on).toBeChecked()
      await expect(win.getByText('The voices are ready.')).toBeVisible({ timeout: 30_000 })
      await expect(
        win.getByRole('radiogroup', { name: "Narrator's voice" }).getByRole('radio', { name: 'Narrator', exact: true })
      ).toHaveAttribute('aria-checked', 'true')
    })

    await test.step('3. Mara and Tobin each get a voice from the list on their page', async () => {
      await binder(win).getByRole('button', { name: 'Characters' }).click()
      for (const c of CAST) {
        const row = main(win)
          .getByRole('listbox', { name: 'Characters', exact: true })
          .getByRole('option', { name: new RegExp(`^${c.name}`) })
        await row.click()
        await expect(row).toHaveAttribute('aria-selected', 'true')
        const voiceBox = win.getByRole('region', { name: 'Read-aloud voice' })
        await expect(voiceBox).toBeVisible()
        await voiceBox.getByRole('combobox', { name: 'Or a voice from the list' }).click()
        await win.getByRole('option', { name: new RegExp(`^${c.voice.name}`) }).click()
        await expect(voiceBox.getByRole('combobox', { name: 'Or a voice from the list' })).toContainText(c.voice.name)
        await expect.poll(async () => (await invoke(win, 'getEntryReadAloud', ids[c.name])).voice.voice).toBe(c.voice.id)
      }
    })

    await test.step('3. Ctrl+L reads the scene to the end: the narrator, then each character in their own voice', async () => {
      await sceneRow(win, 'Scene 1').click()
      await expect(prose(win)).toBeVisible()
      await writeParagraphs(win, READ_ALOUD_SCENE)
      await win.keyboard.press('Control+Home')
      await watchReading(win)
      await win.keyboard.press('Control+l')
      await expect(readingBar(win)).toContainText('Narrator', { timeout: 30_000 })
      await expect(readingBar(win)).toContainText('Read to the end of the story.', { timeout: 60_000 })

      const said = await spoken(address)
      const request = (line: string): Spoken | undefined => said.find((s) => s.input.includes(wordsOf(line)))
      // The narration: read by the narrator, in the narrator's voice.
      for (const line of NARRATION) {
        expect(await whoRead(win, wordsOf(line)), line).toBe('Narrator')
        expect(request(line)?.voice, line).toBe(NARRATOR_VOICE)
        expect(request(line)?.voice_design ?? '', line).toBe('')
      }
      // Each line of dialogue: read as the character the AI marked, in the voice picked for them.
      const speakers = new Set<string>()
      for (const line of DIALOGUE) {
        const who = await whoRead(win, wordsOf(line))
        const character = CAST.find((c) => c.name === who)
        expect(character, `who says ${line} (the reading bar said ${who})`).toBeDefined()
        speakers.add(character!.name)
        expect(request(line)?.voice, line).toBe(character!.voice.id)
      }
      // Both of them speak, and the narrator, Mara and Tobin each have a voice of their own.
      expect([...speakers].sort()).toEqual(['Mara', 'Tobin'])
      expect(new Set([NARRATOR_VOICE, ...CAST.map((c) => c.voice.id)]).size).toBe(3)
      // The page keeps the words as written (whichever quote marks it shows them with).
      const straight = (ps: string[]): string[] => ps.map((p) => p.replace(/[“”]/g, '"'))
      expect(straight(await paras(win).allTextContents())).toEqual(READ_ALOUD_SCENE)
    })
  } finally {
    await fake.close()
  }
})

// ---------- 4. Dictation ----------

/** What the fake speech engine writes down from the fake microphone. */
const DICTATED = 'Somewhere below, a door slammed.'
const LAMP = ['She lit the lamp.', 'The wind rattled the shutters all night.']
const marker = (win: Page) => win.locator('[data-dictation-marker]')

test('milestone 4, check 4: holding the dictation key types spoken words into the scene at the cursor, and one Ctrl+Z takes them out', async ({
  launch
}) => {
  test.setTimeout(120_000)
  const address = `http://127.0.0.1:${await unusedPort()}/v1`
  const { win } = await launch({ env: { ...QUIET, ...speechEnv({ dictation: DICTATED }), AIWRITE_FAKE_MIC: '1' } })
  await createWorldFromWelcome(win, 'Harbour')
  await invoke(win, 'updateSettings', { speech: { serverUrl: address } })
  const sceneId = await firstScene(win)

  await test.step('setup: Adam has written two paragraphs', async () => {
    await writeParagraphs(win, LAMP)
    await expect.poll(() => savedText(win, sceneId)).toBe(LAMP.join('\n\n'))
  })

  await test.step('4. picking Parakeet downloads the speech engine and the dictation model with one click', async () => {
    await openSpeechSettings(win)
    const section = engine(win)
    await section.getByRole('radio', { name: 'Parakeet' }).click()
    await expect(section.getByText('Connected', { exact: true })).toBeVisible({ timeout: 60_000 })
    await expect(fact(win, 'Dictation')).toHaveText(/^Parakeet, (ready|loaded)$/, { timeout: 60_000 })
    await expect(section.getByRole('switch', { name: 'Start with AI Write' })).toBeChecked()
  })

  await test.step('4. F9 is picked as the key to hold', async () => {
    await win.getByRole('button', { name: /^(Pick a key|Change)$/ }).click()
    await expect(win.getByTestId('dictation-key')).toHaveText('Press a key…')
    await win.keyboard.press('F9')
    await expect(win.getByTestId('dictation-key')).toHaveText('F9')
    await win.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(prose(win)).toBeVisible()
  })

  await test.step('4. holding F9 types what was said at the cursor, and it is saved', async () => {
    await caretAt(win, 0)
    // With a key picked, the microphone is kept ready, so the moment before the key goes down is heard too.
    await win.waitForTimeout(1000)
    await win.keyboard.down('F9')
    await expect(marker(win)).toContainText('Listening')
    await win.waitForTimeout(1300)
    await win.keyboard.up('F9')
    const said = [`${LAMP[0]} ${DICTATED}`, LAMP[1]]
    await expect(paras(win)).toHaveText(said)
    await expect(marker(win)).toHaveCount(0)
    await expect.poll(() => savedText(win, sceneId)).toBe(said.join('\n\n'))
  })

  await test.step('4. one Ctrl+Z takes out just the words', async () => {
    await expect(prose(win)).toBeFocused()
    await win.keyboard.press('Control+z')
    await expect(paras(win)).toHaveText(LAMP)
    await expect.poll(() => savedText(win, sceneId)).toBe(LAMP.join('\n\n'))
  })
})

// ---------- 5. The world from a one-paragraph summary ----------

/** Adam's summary, one paragraph: what each sentence makes is in the comment at the top. */
const WORLD = {
  mara: 'Mara Venn is a smuggler captain who runs the night ferry.',
  tobin: 'Tobin Reed is an old boatman who taught her every tide.',
  saltmarsh: 'Saltmarsh is a port town in the Grey Coast.',
  coast: 'The Grey Coast is a cold land of fog and reefs.',
  compass: 'Mara keeps the Tide Compass.',
  magic: 'Magic always costs blood.',
  flood: 'The Great Flood happened in the year 312.',
  thread: 'Who sank the Merrow?'
}
const WORLD_SUMMARY = Object.values(WORLD).join(' ')

/** Each kind the page groups what it made under, and what it made of the summary. */
const WORLD_MADE: [string, string[]][] = [
  ['Characters', ['Mara Venn', 'Tobin Reed']],
  ['Places', ['Saltmarsh', 'The Grey Coast']],
  ['Items', ['Tide Compass']],
  ['Lore and rules', ['Magic']],
  ['Events', ['The Great Flood']],
  ['Plot threads', ['Who sank the Merrow']]
]

/** Where each thing keeps the sentence of Adam's it came from (its kind, the field, and the words). */
const HIS_WORDS: [string, EntryKind, string, string][] = [
  ['Mara Venn', 'character', 'summary', WORLD.mara],
  ['Tobin Reed', 'character', 'summary', WORLD.tobin],
  ['Saltmarsh', 'place', 'summary', WORLD.saltmarsh],
  ['Tide Compass', 'item', 'summary', WORLD.compass],
  ['Magic', 'lore', 'rules', WORLD.magic],
  ['The Great Flood', 'event', 'when', 'in the year 312'],
  ['Who sank the Merrow', 'thread', 'promise', WORLD.thread]
]

const worldResults = (win: Page) => main(win).getByRole('region', { name: 'Made from your summary' })
const fieldOrigin = (e: Entry, key: string): string => e.fieldOrigins[key] ?? e.origin
const fieldValue = (e: Entry, key: string): string => (key === 'summary' ? e.summary : (e.fields[key] ?? ''))

test("milestone 4, check 5: a world typed as a one-paragraph summary comes out as characters, places, items, rules, events and plot threads in one click, with Adam's words kept as written", async ({
  launch
}) => {
  const fake = await startFake()
  try {
    const { win } = await launch({ env: QUIET })
    await createWorldFromWelcome(win, 'Grey Coast')
    await useFakeModel(win, fake)

    await test.step('5. Adam types one paragraph and clicks Build the world once', async () => {
      await win.getByRole('navigation', { name: 'World' }).getByRole('button', { name: 'Build from a summary' }).click()
      await expect(main(win).getByRole('heading', { level: 1, name: 'Build the world from a summary' })).toBeVisible()
      const summary = main(win).getByRole('textbox', { name: 'Your summary' })
      await expect(summary).toBeFocused()
      await win.keyboard.insertText(WORLD_SUMMARY)
      await expect(summary).toHaveValue(WORLD_SUMMARY)
      await main(win).getByRole('button', { name: 'Build the world' }).click()
      // Nothing to approve on the way: it is all built and saved.
      await expect(worldResults(win).getByRole('status')).toHaveText(
        /^Built and saved 8 entries.* Your words are kept as you wrote them; the rest is drafted by AI\./,
        { timeout: 60_000 }
      )
    })

    await test.step('5. the page lists what it made, by kind: characters, places, an item, a rule, an event, a plot thread', async () => {
      for (const [label, names] of WORLD_MADE) {
        const group = worldResults(win).getByRole('region', { name: label, exact: true })
        await expect(group.getByRole('listitem'), label).toHaveCount(names.length)
        for (const name of names) await expect(group.getByRole('button', { name: `Open ${name}`, exact: true })).toBeVisible()
      }
      await expect(worldResults(win).getByRole('region', { name: 'Lore and rules', exact: true })).toContainText('Never to be broken')
    })

    await test.step('5. each is saved with Adam’s words as he wrote them, and his; the rest drafted by AI', async () => {
      const list = await invoke(win, 'listEntries')
      expect(list.map((e) => e.name).sort()).toEqual(WORLD_MADE.flatMap(([, names]) => names).sort())
      const find = (name: string): Entry => list.find((e) => e.name === name)!
      for (const [name, kind, key, words] of HIS_WORDS) {
        const e = find(name)
        expect(e.kind, name).toBe(kind)
        expect(fieldValue(e, key), `${name}: ${key} is his, word for word`).toBe(words)
        expect(fieldOrigin(e, key), `${name}: ${key} is his`).toBe('adam')
      }
      expect(find('Magic').hardRule).toBe(true)
      expect(find('Saltmarsh').parentId).toBe(find('The Grey Coast').id)
      expect(find('Mara Venn').aliases).toContain('Mara')
      // What the summary doesn't say is drafted, and marked as the AI's.
      const mara = find('Mara Venn')
      expect(mara.fields.traits).toBe('Core traits of Mara Venn, drafted to fit the world.')
      expect(fieldOrigin(mara, 'traits')).toBe('ai')
    })

    await test.step('5. Open goes to her page: his words there as written, the AI’s fields marked so', async () => {
      await worldResults(win).getByRole('button', { name: 'Open Mara Venn', exact: true }).click()
      await expect(main(win).getByRole('textbox', { name: 'Name' })).toHaveValue('Mara Venn')
      const summary = main(win).getByLabel('Short summary', { exact: true })
      await expect(summary).toHaveValue(WORLD.mara)
      await expect(summary.locator('xpath=ancestor::div[label][1]')).not.toContainText('Drafted by AI')
      await expect(main(win).getByText('Drafted by AI').first()).toBeVisible()
    })
  } finally {
    await fake.close()
  }
})
