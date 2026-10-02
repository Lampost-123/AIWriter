// Milestone 1's acceptance checks, walked through the interface the way Adam
// works: make a world, connect a provider and pick a writer model, create two
// characters and a place, fill in a scene card, generate a draft, edit it,
// close the window, reopen, and find everything still there, with "What the
// AI saw" showing exactly the briefing the model was sent.
//
// The model is the fake OpenAI-compatible server (tests/fake-provider/server.mjs),
// started on a free port for this test and stopped at the end.
import type { ElectronApplication, Page } from '@playwright/test'
import { countWords } from '../../src/shared/defaults'
import { binder, createWorldFromWelcome, expect, openSettings, test } from './helpers'

/** Closes the window the way Adam does (the X), so pending saves run first, and waits for the app to exit. */
async function closeWindow(app: ElectronApplication): Promise<void> {
  const closed = new Promise<void>((r) => app.once('close', () => r()))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
}

const prose = (win: Page) => win.locator('.scene-prose')
const sceneCard = (win: Page) => win.getByRole('tabpanel', { name: 'Scene card' })
const generateButton = (win: Page) => win.locator('main header').getByRole('button', { name: 'Generate', exact: true })
const nameBox = (win: Page) => win.getByRole('textbox', { name: 'Name', exact: true })
/** Paragraphs with their whitespace tidied, for comparing the page with the text the model sent. */
const paragraphs = (text: string): string[] =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

const MARA = { name: 'Mara Venn', summary: 'A disgraced heir turned smuggler, missing her left hand.', pronouns: 'she/her' }
const TOBIN = { name: 'Tobin Reed', summary: 'A ferryman who owes Mara a favour.' }
const EEL = { name: 'The Gilded Eel', summary: 'A smoky riverside tavern where nobody asks questions.', atmosphere: 'Smoke, wet wool and quiet threats.' }
const BEATS = ['Mara reaches the Gilded Eel in the rain', 'Tobin offers her passage, for a favour', 'Someone knocks at the door']
const EDIT = 'Mara reached for the latch. This line is mine.'

/** Creates a character or place from its screen: a new entry opens with "New …" selected, so its name is typed straight over it. */
async function newEntry(win: Page, button: string, name: string): Promise<void> {
  await win.getByRole('button', { name: button, exact: true }).click()
  await expect(nameBox(win)).toBeFocused()
  await expect(nameBox(win)).toHaveValue(/^New (character|place)$/)
  await win.keyboard.type(name)
  await expect(win.locator('[data-entry]').filter({ hasText: name })).toBeVisible()
}

test('the writing loop: world, model, characters, place, scene card, draft, edit, reopen, What the AI saw', async ({ launch }) => {
  test.setTimeout(150_000)
  const { startFakeProvider, fakeProse } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 20, words: 120 })
  // What the fake model writes for a request with room for 120 words or more.
  const draft = fakeProse(120)
  try {
    const first = await launch()
    const win = first.win
    await createWorldFromWelcome(win, 'The Northern Reaches')

    // ----- Settings › Models: add the provider, test it, pick and test a writer model -----
    await openSettings(win, 'Models')
    await win.getByRole('button', { name: 'Add another provider' }).click()
    const form = win.locator('form').filter({ hasText: 'Add a provider' })
    await form.getByLabel('Name').fill('Test server')
    await form.getByLabel('Base URL').fill(fake.url)
    await form.getByRole('button', { name: 'Add provider' }).click()
    // Adding it tests the connection straight away; Test runs the check again.
    await expect(win.getByText(/^Connected to Test server in .+ It offers \d+ models\.$/)).toBeVisible()
    await win.locator('main').getByRole('button', { name: 'Test', exact: true }).click()
    await expect(win.getByText(/^Connected to Test server in .+ It offers \d+ models\.$/)).toBeVisible()
    await win.getByRole('listbox', { name: 'Models' }).getByRole('option', { name: /^fake\/writer\b/ }).click()
    await win.getByRole('button', { name: 'Test this model' }).click()
    await expect(win.getByText(/The model answered in/)).toBeVisible()

    // ----- Two characters and a place, from their screens -----
    await binder(win).getByRole('button', { name: 'Characters' }).click()
    await expect(win.getByRole('heading', { name: 'No characters yet' })).toBeVisible()
    await newEntry(win, 'Create a character', MARA.name)
    await win.getByLabel('Short summary').fill(MARA.summary)
    await win.getByLabel('Pronouns').fill(MARA.pronouns)
    await newEntry(win, 'New character', TOBIN.name)
    await win.getByLabel('Short summary').fill(TOBIN.summary)

    await binder(win).getByRole('button', { name: 'Places' }).click()
    await expect(win.getByRole('heading', { name: 'No places yet' })).toBeVisible()
    await newEntry(win, 'Create a place', EEL.name)
    await win.getByLabel('Short summary').fill(EEL.summary)
    await win.getByLabel('Atmosphere').fill(EEL.atmosphere)

    // ----- The scene card: point of view, who is there, where, and the beats -----
    await binder(win).locator('[data-row]', { hasText: 'Scene 1' }).first().click()
    await expect(prose(win)).toBeVisible()
    const card = sceneCard(win)
    await card.getByRole('combobox', { name: 'Point of view' }).click()
    await win.getByRole('option', { name: MARA.name, exact: true }).click()
    await expect(card.getByRole('combobox', { name: 'Point of view' })).toHaveText(MARA.name)

    const cast = card.getByRole('combobox', { name: 'Characters present' })
    const castOptions = win.getByRole('listbox', { name: 'Characters' })
    await cast.fill('Mar')
    await castOptions.getByRole('option', { name: new RegExp(MARA.name) }).click()
    await cast.fill('Tob')
    await castOptions.getByRole('option', { name: new RegExp(TOBIN.name) }).click()
    await cast.press('Escape')
    await expect(card.getByRole('button', { name: `Remove ${MARA.name}` })).toBeVisible()
    await expect(card.getByRole('button', { name: `Remove ${TOBIN.name}` })).toBeVisible()

    await card.getByRole('combobox', { name: 'Location' }).click()
    await win.getByRole('option', { name: EEL.name, exact: true }).click()
    await expect(card.getByRole('combobox', { name: 'Location' })).toHaveText(EEL.name)

    await card.getByRole('textbox', { name: 'Beats', exact: true }).click()
    for (const [i, beat] of BEATS.entries()) {
      if (i > 0) await win.keyboard.press('Enter')
      await win.keyboard.type(beat)
    }
    await expect(card.getByRole('textbox', { name: 'Beat 3', exact: true })).toHaveValue(BEATS[2])

    // ----- Generate, and wait for the draft to finish -----
    fake.reset()
    await generateButton(win).click()
    await expect(win.locator('main header').getByRole('button', { name: 'Stop' })).toBeVisible()
    await expect(generateButton(win)).toBeVisible({ timeout: 30_000 })
    expect(fake.requestCounts()).toEqual({ 'fake/writer': 1 })

    // The draft is on the page, word for word as the model wrote it, and listed under Drafts.
    await expect.poll(async () => paragraphs(await prose(win).innerText())).toEqual(paragraphs(draft))
    await win.getByRole('tab', { name: 'Drafts' }).click()
    const draftRow = win.getByRole('button', { name: /What the AI saw/ })
    await expect(draftRow).toHaveCount(1)
    await expect(draftRow).toContainText(`${countWords(draft)} words`)
    const sent = fake.lastRequest()!.body
    expect(sent.model).toBe('fake/writer')

    // The briefing the model received uses the characters, the place and the beats.
    const briefing = sent.messages.map((m) => m.content).join('\n\n')
    for (const text of [MARA.name, MARA.summary, MARA.pronouns, TOBIN.name, TOBIN.summary, EEL.name, EEL.summary, EEL.atmosphere, ...BEATS]) {
      expect(briefing, `the briefing mentions "${text}"`).toContain(text)
    }
    expect(sent.messages[sent.messages.length - 1].content).toMatch(new RegExp(`1\\. ${BEATS[0]}\\n2\\. ${BEATS[1]}\\n3\\. ${BEATS[2]}`))

    // ----- Edit the draft: click the empty page below the text and add a line at the end -----
    await win.getByRole('tab', { name: 'Scene card' }).click()
    const box = (await prose(win).boundingBox())!
    await win.mouse.click(box.x + 40, box.y + box.height + 60)
    await expect(prose(win)).toBeFocused()
    await win.keyboard.press('Enter')
    await win.keyboard.type(EDIT)
    await expect.poll(async () => paragraphs(await prose(win).innerText())).toEqual([...paragraphs(draft), EDIT])

    // ----- Close the window as Adam does, and open the app again on the same data -----
    await closeWindow(first.app)
    const second = await launch({ dataDir: first.dataDir })
    const again = second.win
    await expect(prose(again)).toBeVisible()

    // The scene, with the draft and the edit.
    await expect.poll(async () => paragraphs(await prose(again).innerText())).toEqual([...paragraphs(draft), EDIT])
    // The scene card.
    const card2 = sceneCard(again)
    await expect(card2.getByRole('combobox', { name: 'Point of view' })).toHaveText(MARA.name)
    await expect(card2.getByRole('button', { name: `Remove ${MARA.name}` })).toBeVisible()
    await expect(card2.getByRole('button', { name: `Remove ${TOBIN.name}` })).toBeVisible()
    await expect(card2.getByRole('combobox', { name: 'Location' })).toHaveText(EEL.name)
    await expect(card2.getByRole('textbox', { name: 'Beats', exact: true })).toHaveValue(BEATS[0])
    await expect(card2.getByRole('textbox', { name: 'Beat 2', exact: true })).toHaveValue(BEATS[1])
    await expect(card2.getByRole('textbox', { name: 'Beat 3', exact: true })).toHaveValue(BEATS[2])
    // The writer model.
    await expect(again.locator('main header').getByTitle(/^Writer model: fake\/writer\./)).toBeVisible()

    // ----- Drafts › What the AI saw: the same briefing the model received -----
    await again.getByRole('tab', { name: 'Drafts' }).click()
    await again.getByRole('button', { name: /What the AI saw/ }).click()
    await expect(again.getByRole('heading', { level: 1, name: 'What the AI saw' })).toBeVisible()
    await expect(again.getByText('Test server', { exact: true })).toBeVisible()
    for (const part of [`Point-of-view character: ${MARA.name}`, 'Also in the scene', 'Setting', 'Scene card']) {
      await expect(again.locator('main button[aria-expanded]', { hasText: part })).toBeVisible()
    }
    await again.getByText('Show the exact messages sent').click()
    const shown = again.locator('main pre')
    await expect(shown).toHaveCount(sent.messages.length)
    expect(await shown.allTextContents()).toEqual(sent.messages.map((m) => m.content))
    expect(paragraphs((await again.locator('main section').filter({ hasText: 'What came back' }).locator('.font-serif').textContent()) ?? '')).toEqual(
      paragraphs(draft)
    )

    // ----- The characters and the place are still there -----
    await binder(again).getByRole('button', { name: 'Characters' }).click()
    const list = again.locator('[data-entry]')
    await expect(list).toHaveCount(2)
    await expect(list.filter({ hasText: MARA.name })).toContainText(MARA.summary)
    await expect(list.filter({ hasText: TOBIN.name })).toContainText(TOBIN.summary)
    await list.filter({ hasText: MARA.name }).click()
    await expect(nameBox(again)).toHaveValue(MARA.name)
    await expect(again.getByLabel('Pronouns')).toHaveValue(MARA.pronouns)
    await binder(again).getByRole('button', { name: 'Places' }).click()
    await expect(list).toHaveCount(1)
    await list.filter({ hasText: EEL.name }).click()
    await expect(nameBox(again)).toHaveValue(EEL.name)
    await expect(again.getByLabel('Short summary')).toHaveValue(EEL.summary)
    await expect(again.getByLabel('Atmosphere')).toHaveValue(EEL.atmosphere)
  } finally {
    await fake.close()
  }
})
