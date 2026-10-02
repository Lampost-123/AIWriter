// Generate on a scene that already has text asks first: replace the text, or add the new draft
// below it. Against the fake OpenAI-compatible server (tests/fake-provider/server.mjs).
import type { Page } from '@playwright/test'
import type { FakeProvider, FakeProviderOptions } from '../fake-provider/server.mjs'
import { binder, closeWindow, createWorldFromWelcome, expect, invoke, test } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const scroller = (win: Page) => prose(win).locator('xpath=ancestor::div[contains(@class, "overflow-y-auto")][1]')
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')
const generateButton = (win: Page) => win.locator('main header').getByRole('button', { name: 'Generate', exact: true })
const stopButton = (win: Page) => win.locator('main header').getByRole('button', { name: 'Stop', exact: true })
const choiceHeading = (win: Page) => win.getByRole('heading', { name: 'This scene already has text' })
const replaceIt = (win: Page) => win.getByRole('button', { name: 'Replace it', exact: true })
const addBelow = (win: Page) => win.getByRole('button', { name: 'Add below', exact: true })
const replacedToast = (win: Page) => toasts(win).getByText("The new draft replaced the scene's text. The old text is kept in the Drafts tab.")
const row = (win: Page, title: string) => binder(win).locator('[data-row]', { hasText: title }).first()

const OLD = ['Adam wrote this.', 'And this, his second paragraph.']

async function fakeProvider(options: FakeProviderOptions = {}): Promise<FakeProvider> {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  return startFakeProvider({ delayMs: 5, ...options })
}

/** Connects the fake server as a provider and makes `modelId` the writer model, through the API. */
async function useWriter(win: Page, fake: FakeProvider, modelId: string): Promise<void> {
  const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
  await invoke(win, 'updateSettings', {
    models: { writer: { providerId: p.id, modelId, label: modelId, contextLength: 32000, promptPrice: null, completionPrice: null } }
  })
  // The window reads settings when it starts.
  await win.reload()
  await expect(prose(win)).toBeVisible()
}

async function firstScene(win: Page): Promise<string> {
  const [story] = await invoke(win, 'listStories')
  const { scenes } = await invoke(win, 'getOutline', story.id)
  return scenes[0].id
}

const chatRequests = (fake: FakeProvider): number => Object.values(fake.requestCounts()).reduce((a, b) => a + b, 0)
const paragraphIds = (win: Page) =>
  prose(win)
    .locator('p')
    .evaluateAll((ps) => ps.map((p) => p.getAttribute('data-pid')))
const savedText = async (win: Page, sceneId: string): Promise<string> => (await invoke(win, 'getScene', sceneId)).text
const lastStatus = async (win: Page, sceneId: string) => (await invoke(win, 'listGenerations', sceneId))[0]?.status
const lastRecord = async (win: Page, sceneId: string) => invoke(win, 'getGeneration', (await invoke(win, 'listGenerations', sceneId))[0].id)

/** Closes every message showing. */
async function dismissToasts(win: Page): Promise<void> {
  const close = toasts(win).getByRole('button', { name: 'Dismiss' })
  while ((await close.count()) > 0) await close.first().click()
}

/** Types Adam's two paragraphs into the page and waits for them to be saved. */
async function writeOldText(win: Page, sceneId: string): Promise<void> {
  await prose(win).click()
  await win.keyboard.type(OLD[0])
  await win.keyboard.press('Enter')
  await win.keyboard.type(OLD[1])
  await expect.poll(() => savedText(win, sceneId)).toBe(OLD.join('\n\n'))
}

test('Generate on a scene with text asks first; Esc or a click elsewhere sends nothing; Replace it takes its place, keeps the old text with the draft, and Ctrl+Z puts it back straight away', async ({
  launch
}) => {
  const fake = await fakeProvider({ words: 60 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    await useWriter(win, fake, 'fake/writer')
    const sceneId = await firstScene(win)
    await writeOldText(win, sceneId)
    const ids = await paragraphIds(win)
    expect(ids).toHaveLength(2)
    expect(ids.every((id) => !!id)).toBe(true)

    // The choice, in plain words. Nothing is sent yet.
    await generateButton(win).click()
    await expect(choiceHeading(win)).toBeVisible()
    await expect(win.getByText('Where should the new draft go?')).toBeVisible()
    await expect(win.getByText('The new draft takes its place.')).toBeVisible()
    await expect(win.getByText('The new draft goes below a scene break.')).toBeVisible()
    await expect(win.getByText('Either way, Ctrl+Z undoes it.')).toBeVisible()
    // Opened with a click, nothing looks picked yet; Tab reaches the answers.
    await expect(replaceIt(win)).not.toBeFocused()
    await expect(addBelow(win)).not.toBeFocused()
    await win.keyboard.press('Tab')
    await expect(replaceIt(win)).toBeFocused()
    await win.keyboard.press('Escape')
    await expect(choiceHeading(win)).toBeHidden()

    // A click elsewhere closes it too.
    await generateButton(win).click()
    await expect(choiceHeading(win)).toBeVisible()
    await prose(win).click({ position: { x: 4, y: 4 } })
    await expect(choiceHeading(win)).toBeHidden()

    // Ctrl+G from the page asks the same, with Add below ready for Enter (what Ctrl+G always did) and
    // showing it; the arrow keys move between the answers; Esc puts the keyboard back in the page.
    await win.keyboard.press('Control+g')
    await expect(choiceHeading(win)).toBeVisible()
    await expect(addBelow(win)).toBeFocused()
    await expect(addBelow(win)).toHaveCSS('outline-style', 'solid')
    await win.keyboard.press('ArrowUp')
    await expect(replaceIt(win)).toBeFocused()
    await expect(replaceIt(win)).toHaveCSS('outline-style', 'solid')
    await win.keyboard.press('ArrowDown')
    await expect(addBelow(win)).toBeFocused()
    await win.keyboard.press('Escape')
    await expect(choiceHeading(win)).toBeHidden()
    await expect(prose(win)).toBeFocused()

    await win.waitForTimeout(300)
    expect(chatRequests(fake)).toBe(0)
    expect(await invoke(win, 'listGenerations', sceneId)).toEqual([])
    await expect(prose(win).locator('p')).toHaveText(OLD)

    // Replace it, picked with the mouse: the draft takes the old text's place, with no scene break, and is saved word for word.
    await generateButton(win).click()
    await replaceIt(win).click()
    await expect.poll(() => lastStatus(win, sceneId)).toBe('complete')
    await expect(prose(win)).toContainText('The rain')
    await expect(prose(win)).not.toContainText(OLD[0])
    await expect(prose(win).locator('hr')).toHaveCount(0)
    await expect(replacedToast(win)).toBeVisible()
    const rec = await lastRecord(win, sceneId)
    await expect.poll(async () => (await savedText(win, sceneId)).trim()).toBe(rec.response.trim())
    // The draft's paragraphs are new ones (the memory reads them, and the old ones count as gone).
    const draftIds = await paragraphIds(win)
    expect(draftIds.some((id) => ids.includes(id))).toBe(false)
    // The old text is kept with the draft's record, paragraph ids and all, so it can be had back at any time.
    expect(rec.replaced).toBe(true)
    expect(rec.replacedText?.text).toBe(OLD.join('\n\n'))
    expect(JSON.stringify(rec.replacedText?.doc)).toContain(ids[0])

    // The keyboard went back into the page, so Ctrl+Z works straight away, as the choice said: the old
    // text comes back exactly, paragraph ids and all; redo brings the draft back.
    await expect(prose(win)).toBeFocused()
    await win.keyboard.press('Control+z')
    await expect(prose(win).locator('p')).toHaveText(OLD)
    expect(await paragraphIds(win)).toEqual(ids)
    await expect.poll(() => savedText(win, sceneId)).toBe(OLD.join('\n\n'))
    await win.keyboard.press('Control+Shift+z')
    await expect(prose(win)).toContainText('The rain')
    await expect(prose(win)).not.toContainText(OLD[0])
    expect(await paragraphIds(win)).toEqual(draftIds)

    // The message's Undo does the same.
    await toasts(win).getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(prose(win).locator('p')).toHaveText(OLD)
    expect(await paragraphIds(win)).toEqual(ids)
    await expect(prose(win)).toBeFocused()
  } finally {
    await fake.close()
  }
})

test('Add below puts the draft after the text, below a scene break, by keyboard or mouse; Ctrl+Z then works, even from the Generate button', async ({
  launch
}) => {
  const fake = await fakeProvider({ words: 60 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    await useWriter(win, fake, 'fake/writer')
    const sceneId = await firstScene(win)
    await writeOldText(win, sceneId)

    // Ctrl+G then Enter adds below, as Ctrl+G always did.
    await win.keyboard.press('Control+g')
    await expect(choiceHeading(win)).toBeVisible()
    await expect(addBelow(win)).toBeFocused()
    await win.keyboard.press('Enter')
    await expect(choiceHeading(win)).toBeHidden()
    await expect.poll(() => lastStatus(win, sceneId)).toBe('complete')
    await expect(prose(win).locator('hr')).toHaveCount(1)
    await expect(prose(win).locator('p').nth(0)).toHaveText(OLD[0])
    await expect(prose(win).locator('p').nth(1)).toHaveText(OLD[1])
    await expect(prose(win)).toContainText('The rain')
    await expect(replacedToast(win)).toHaveCount(0)
    expect((await lastRecord(win, sceneId)).replacedText).toBeNull()

    // The keyboard went back to the page, so Ctrl+Z works straight away and takes the draft and its break away.
    await expect(prose(win)).toBeFocused()
    await win.keyboard.press('Control+z')
    await expect(prose(win).locator('hr')).toHaveCount(0)
    await expect(prose(win).locator('p')).toHaveText(OLD)

    // Picked with the mouse, the keyboard goes into the page too.
    await generateButton(win).click()
    await addBelow(win).click()
    await expect(prose(win)).toBeFocused()
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId)).length).toBe(2)
    await expect.poll(() => lastStatus(win, sceneId)).toBe('complete')
    await expect(prose(win).locator('hr')).toHaveCount(1)

    // With the keyboard on the Generate button, Ctrl+Z still undoes in the page.
    await generateButton(win).focus()
    await win.keyboard.press('Control+z')
    await expect(prose(win).locator('hr')).toHaveCount(0)
    await expect(prose(win).locator('p')).toHaveText(OLD)
    await expect(choiceHeading(win)).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

test('an empty scene drafts straight away, with no choice', async ({ launch }) => {
  const fake = await fakeProvider({ words: 60 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    await useWriter(win, fake, 'fake/writer')
    const sceneId = await firstScene(win)

    await generateButton(win).click()
    await expect.poll(() => lastStatus(win, sceneId)).toBe('complete')
    await expect(prose(win)).toContainText('The rain')
    await expect(choiceHeading(win)).toHaveCount(0)
    await expect(prose(win).locator('hr')).toHaveCount(0)

    // Emptied by hand: Ctrl+G drafts straight away too.
    await prose(win).click()
    await win.keyboard.press('Control+a')
    await win.keyboard.press('Delete')
    await expect.poll(() => savedText(win, sceneId)).toBe('')
    await win.keyboard.press('Control+g')
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId)).length).toBe(2)
    await expect.poll(() => lastStatus(win, sceneId)).toBe('complete')
    await expect(choiceHeading(win)).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

test('replacing a long scene shows the top of the scene; Esc in the page stops it, keeping the draft so far with the old text one Ctrl+Z away', async ({
  launch
}) => {
  const fake = await fakeProvider({ slowWords: 3000, slowDelayMs: 25 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const sceneId = await firstScene(win)
    const old = Array.from(
      { length: 40 },
      (_, i) => `Old paragraph ${i + 1}, which Adam wrote before he asked for a new draft of this scene.`
    )
    await invoke(win, 'saveSceneText', sceneId, null, old.join('\n\n'))
    await useWriter(win, fake, 'fake/slow')
    await expect(prose(win)).toContainText('Old paragraph 40,')

    // Reading the end of the scene.
    await scroller(win).evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    expect(await scroller(win).evaluate((el) => el.scrollTop)).toBeGreaterThan(500)

    await generateButton(win).click()
    await replaceIt(win).click()
    await expect(prose(win)).toContainText('The rain')
    // The old text went with the first words, and the page shows the top of the scene where the draft begins.
    expect(await scroller(win).evaluate((el) => el.scrollTop)).toBeLessThan(5)
    await expect(prose(win)).not.toContainText('Old paragraph')
    await expect(prose(win).locator('p').first()).toBeInViewport()

    // Esc stops it with the keyboard in the page too (the page otherwise keeps Esc for itself).
    await prose(win).locator('p').first().click()
    await expect(prose(win)).toBeFocused()
    await win.keyboard.press('Escape')
    await expect(generateButton(win)).toBeVisible()
    await expect.poll(() => lastStatus(win, sceneId)).toBe('stopped')
    await expect(replacedToast(win)).toBeVisible()
    const rec = await lastRecord(win, sceneId)
    await expect.poll(async () => (await savedText(win, sceneId)).trim()).toBe(rec.response.trim())
    await expect(prose(win)).not.toContainText('Old paragraph')
    expect(rec.replacedText?.text).toBe(old.join('\n\n'))

    await win.keyboard.press('Control+z')
    await expect(prose(win).locator('p')).toHaveText(old)
    await expect.poll(() => savedText(win, sceneId)).toBe(old.join('\n\n'))
  } finally {
    await fake.close()
  }
})

test('while a replacing draft waits for its first words, the old text is held: nothing typed goes with it, and what was typed before is kept with the draft', async ({
  launch
}) => {
  const fake = await fakeProvider({ waitMs: 2500 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    await useWriter(win, fake, 'fake/wait')
    const sceneId = await firstScene(win)
    await writeOldText(win, sceneId)
    const typedBefore = [OLD[0], `${OLD[1]} La`]

    // Adam types a little more, then asks for a new draft from the keyboard and picks Replace it.
    await win.keyboard.type(' La')
    await win.keyboard.press('Control+g')
    await expect(addBelow(win)).toBeFocused()
    await win.keyboard.press('ArrowUp')
    await win.keyboard.press('Enter')

    // Held: dimmed, and typing (also after clicking into it) changes nothing.
    await expect(prose(win)).toHaveClass(/replace-waiting/)
    await expect(prose(win)).toHaveAttribute('contenteditable', 'false')
    await expect(prose(win)).toHaveCSS('opacity', '0.5')
    await win.keyboard.type('te edit.')
    await prose(win).locator('p').last().click()
    await win.keyboard.type(' More.')
    await win.keyboard.press('Control+z')
    await expect(prose(win).locator('p')).toHaveText(typedBefore)
    expect(await lastStatus(win, sceneId)).toBe('streaming')

    // The first words take its place, with nothing glued to them; the old text, with what was typed
    // before, is kept with the draft.
    await expect.poll(() => lastStatus(win, sceneId), { timeout: 10_000 }).toBe('complete')
    await expect(prose(win)).toContainText('The rain')
    await expect(prose(win)).not.toContainText('edit')
    await expect(prose(win)).not.toContainText('More.')
    await expect(prose(win).locator('p').first()).toHaveText(/^The rain/)
    await expect(prose(win)).not.toHaveClass(/replace-waiting/)
    await expect(prose(win)).toHaveCSS('opacity', '1')
    expect((await lastRecord(win, sceneId)).replacedText?.text).toBe(typedBefore.join('\n\n'))

    // The keyboard is back in the page once the draft is in: Ctrl+Z puts all of it back.
    await expect(prose(win)).toBeFocused()
    await win.keyboard.press('Control+z')
    await expect(prose(win).locator('p')).toHaveText(typedBefore)
    await expect.poll(() => savedText(win, sceneId)).toBe(typedBefore.join('\n\n'))

    // Stopped before any words came: the text is let go of, as it was, with nothing to say about it.
    await dismissToasts(win)
    await generateButton(win).click()
    await replaceIt(win).click()
    await expect(prose(win)).toHaveClass(/replace-waiting/)
    await stopButton(win).click()
    await expect(generateButton(win)).toBeVisible()
    await expect(prose(win)).not.toHaveClass(/replace-waiting/)
    await expect(prose(win)).toHaveAttribute('contenteditable', 'true')
    await expect(prose(win).locator('p')).toHaveText(typedBefore)
    await win.waitForTimeout(300)
    await expect(toasts(win).locator('p')).toHaveCount(0)
    await prose(win).locator('p').last().click()
    await win.keyboard.press('End')
    await win.keyboard.type('te edit.')
    await expect.poll(() => savedText(win, sceneId)).toBe(`${OLD[0]}\n\n${OLD[1]} Late edit.`)
  } finally {
    await fake.close()
  }
})

test('Ctrl+Z while a replacing draft writes undoes Adam’s own edits first, then stops the draft and puts the old text back', async ({ launch }) => {
  const fake = await fakeProvider({ slowWords: 3000, slowDelayMs: 25 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    await useWriter(win, fake, 'fake/slow')
    const sceneId = await firstScene(win)
    await writeOldText(win, sceneId)
    const ids = await paragraphIds(win)

    await generateButton(win).click()
    await replaceIt(win).click()
    await expect(prose(win)).toContainText('The rain')
    // An edit of Adam's own while it writes undoes as usual, and the draft carries on.
    await prose(win).locator('p').first().click({ position: { x: 2, y: 2 } })
    await win.keyboard.type('X')
    await expect(prose(win).locator('p').first()).toHaveText(/^X/)
    await win.keyboard.press('Control+z')
    await expect(prose(win).locator('p').first()).toHaveText(/^The rain/)
    expect(await lastStatus(win, sceneId)).toBe('streaming')
    // Past it, Ctrl+Z stops the draft and puts the old text back exactly.
    await win.keyboard.press('Control+z')
    await expect(prose(win).locator('p')).toHaveText(OLD)
    expect(await paragraphIds(win)).toEqual(ids)
    await expect(generateButton(win)).toBeVisible()
    await expect.poll(() => lastStatus(win, sceneId)).toBe('stopped')
    await expect(toasts(win).getByText("Drafting stopped, and the scene's text is back as it was.")).toBeVisible()
    await expect(replacedToast(win)).toHaveCount(0)
    await expect.poll(() => savedText(win, sceneId)).toBe(OLD.join('\n\n'))
    await win.waitForTimeout(400)
    await expect(prose(win).locator('p')).toHaveText(OLD)

    // Picked with the mouse, the keyboard stays on Stop while it writes: Ctrl+Z there does the same.
    await generateButton(win).click()
    await replaceIt(win).click()
    await expect(prose(win)).toContainText('The rain')
    await expect(stopButton(win)).toBeFocused()
    await win.keyboard.press('Control+z')
    await expect(prose(win).locator('p')).toHaveText(OLD)
    await expect(generateButton(win)).toBeVisible()
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId)).map((g) => g.status)).toEqual(['stopped', 'stopped'])
  } finally {
    await fake.close()
  }
})

test('opening another scene during a Replace says where the replaced text is kept, and it can be put back from that scene’s Drafts tab', async ({
  launch
}) => {
  const fake = await fakeProvider({ slowWords: 3000, slowDelayMs: 25 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const sceneId = await firstScene(win)
    const [story] = await invoke(win, 'listStories')
    const { chapters } = await invoke(win, 'getOutline', story.id)
    await invoke(win, 'createScene', chapters[0].id, { title: 'Scene 2' })
    await useWriter(win, fake, 'fake/slow')
    await writeOldText(win, sceneId)

    await generateButton(win).click()
    await replaceIt(win).click()
    await expect(prose(win)).toContainText('The rain')
    await row(win, 'Scene 2').click()
    await expect(
      toasts(win).getByText(
        "Drafting stopped because you opened another scene. The text so far is kept, and the text it replaced can be put back from that scene's Drafts tab."
      )
    ).toBeVisible()

    // Back in the first scene, Ctrl+Z can't reach the old text any more; its Drafts tab can.
    await row(win, 'Scene 1').click()
    await expect(prose(win)).toContainText('The rain')
    await win.getByRole('tab', { name: 'Drafts' }).click()
    const draft = win.getByRole('button', { name: /What the AI saw/ }).first()
    await expect(draft).toContainText('Replaced')
    await draft.click()
    await expect(win.getByRole('heading', { level: 1, name: 'What the AI saw' })).toBeVisible()
    await win.getByRole('button', { name: 'Put it back', exact: true }).click()
    await expect(prose(win).locator('p')).toHaveText(OLD)
    await expect(toasts(win).getByText('The text this draft replaced is back in the scene. Ctrl+Z takes it out again.')).toBeVisible()
    await expect.poll(() => savedText(win, sceneId)).toBe(OLD.join('\n\n'))
    await expect(prose(win)).toBeFocused()
    await win.keyboard.press('Control+z')
    await expect(prose(win)).toContainText('The rain')
    await expect(prose(win)).not.toContainText(OLD[0])
  } finally {
    await fake.close()
  }
})

test('a reply that brings nothing leaves the old text as it was, and keeps no copy', async ({ launch }) => {
  const fake = await fakeProvider()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    await useWriter(win, fake, 'fake/empty')
    const sceneId = await firstScene(win)
    await writeOldText(win, sceneId)
    const ids = await paragraphIds(win)

    await generateButton(win).click()
    await replaceIt(win).click()
    await expect.poll(async () => (await lastStatus(win, sceneId)) ?? 'not started').not.toMatch(/^(not started|streaming)$/)
    await expect(generateButton(win)).toBeVisible()
    await expect(prose(win).locator('p')).toHaveText(OLD)
    expect(await paragraphIds(win)).toEqual(ids)
    expect(await savedText(win, sceneId)).toBe(OLD.join('\n\n'))
    await expect(replacedToast(win)).toHaveCount(0)
    // Let go of: the page can be typed in again, and the draft's record keeps no text it didn't replace.
    await expect(prose(win)).toHaveAttribute('contenteditable', 'true')
    await expect(prose(win)).not.toHaveClass(/replace-waiting/)
    const rec = await lastRecord(win, sceneId)
    expect(rec.replaced).toBe(false)
    expect(rec.replacedText).toBeNull()
  } finally {
    await fake.close()
  }
})

test('a Replace that fails part-way says so once, with how to have the old text back', async ({ launch }) => {
  const fake = await fakeProvider({ words: 80 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    await useWriter(win, fake, 'fake/midstream-error')
    const sceneId = await firstScene(win)
    await writeOldText(win, sceneId)

    await generateButton(win).click()
    await replaceIt(win).click()
    await expect.poll(() => lastStatus(win, sceneId)).toBe('error')
    await expect(toasts(win).getByText(/The text that arrived is kept\. Ctrl\+Z puts the scene's old text back\.$/)).toBeVisible()
    await expect(replacedToast(win)).toHaveCount(0)
    await expect(toasts(win).locator('p')).toHaveCount(1)
    await expect(prose(win)).toContainText('The rain')

    await expect(prose(win)).toBeFocused()
    await win.keyboard.press('Control+z')
    await expect(prose(win).locator('p')).toHaveText(OLD)
  } finally {
    await fake.close()
  }
})

test('from the draft options, Ctrl+Enter asks with Add below ready for Enter, and Esc goes back to the options as they were', async ({ launch }) => {
  const fake = await fakeProvider({ words: 60 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    await useWriter(win, fake, 'fake/writer')
    const sceneId = await firstScene(win)
    await writeOldText(win, sceneId)

    const direction = win.getByLabel('Direction for this draft (optional)')
    await win.getByRole('button', { name: 'Draft options' }).click()
    await direction.click()
    await win.keyboard.type('Make it tense')
    await win.keyboard.press('Control+Enter')
    await expect(choiceHeading(win)).toBeVisible()
    await expect(addBelow(win)).toBeFocused()
    await expect(addBelow(win)).toHaveCSS('outline-style', 'solid')
    await win.keyboard.press('Escape')
    await expect(choiceHeading(win)).toBeHidden()
    await expect(win.getByRole('heading', { name: 'Draft options' })).toBeVisible()
    await expect(direction).toBeFocused()
    await expect(direction).toHaveValue('Make it tense')

    // Generate draft (clicked) asks too, with nothing picked; Tab reaches the answers.
    await win.getByRole('button', { name: /^Generate draft/ }).click()
    await expect(choiceHeading(win)).toBeVisible()
    await win.keyboard.press('Tab')
    await expect(replaceIt(win)).toBeFocused()
    await win.keyboard.press('Tab')
    await expect(addBelow(win)).toBeFocused()
    await win.keyboard.press('Enter')
    await expect.poll(() => lastStatus(win, sceneId)).toBe('complete')
    await expect(prose(win).locator('hr')).toHaveCount(1)
    expect(JSON.stringify(fake.lastRequest()?.body.messages)).toContain('Make it tense')
    await expect(prose(win)).toBeFocused()
  } finally {
    await fake.close()
  }
})

test('after a Replace, the old text can be copied or put back from the Drafts tab once the app has been closed', async ({ launch }) => {
  const fake = await fakeProvider({ words: 60 })
  try {
    const first = await launch()
    let win = first.win
    await createWorldFromWelcome(win, 'Alpha')
    await useWriter(win, fake, 'fake/writer')
    const sceneId = await firstScene(win)
    await writeOldText(win, sceneId)
    const ids = await paragraphIds(win)
    await generateButton(win).click()
    await replaceIt(win).click()
    await expect.poll(() => lastStatus(win, sceneId)).toBe('complete')
    await expect.poll(async () => (await savedText(win, sceneId)).startsWith('The rain')).toBe(true)

    await closeWindow(first.app)
    const second = await launch({ dataDir: first.dataDir })
    win = second.win
    await expect(prose(win)).toContainText('The rain')

    await win.getByRole('tab', { name: 'Drafts' }).click()
    const draft = win.getByRole('button', { name: /What the AI saw/ }).first()
    await expect(draft).toContainText('Replaced')
    await draft.click()
    await expect(win.getByRole('heading', { level: 1, name: 'What the AI saw' })).toBeVisible()
    await expect(win.getByText('The text this draft replaced', { exact: true })).toBeVisible()
    await expect(win.getByText(OLD[1])).toBeVisible()

    await win.getByRole('button', { name: 'Copy', exact: true }).click()
    await expect(toasts(win).getByText('Copied the text this draft replaced.')).toBeVisible()
    // Windows' clipboard hands text back with \r\n line ends.
    expect((await second.app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n')).toBe(OLD.join('\n\n'))

    await win.getByRole('button', { name: 'Put it back', exact: true }).click()
    await expect(prose(win).locator('p')).toHaveText(OLD)
    expect(await paragraphIds(win)).toEqual(ids)
    await expect.poll(() => savedText(win, sceneId)).toBe(OLD.join('\n\n'))
    // Put back again: nothing to do.
    await win.getByRole('tab', { name: 'Drafts' }).click()
    await win.getByRole('button', { name: /What the AI saw/ }).first().click()
    await win.getByRole('button', { name: 'Put it back', exact: true }).click()
    await expect(toasts(win).getByText('The scene already has this text.')).toBeVisible()
    await expect(prose(win).locator('p')).toHaveText(OLD)
  } finally {
    await fake.close()
  }
})
