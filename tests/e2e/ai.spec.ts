// Drafting with a model, end to end, against the fake OpenAI-compatible server
// (tests/fake-provider/server.mjs): drafts that keep writing while Adam looks
// elsewhere, where a new draft goes, what the error messages offer, and the
// Models page's key checks.
import type { Page } from '@playwright/test'
import type { FakeProvider, FakeProviderOptions } from '../fake-provider/server.mjs'
import { binder, createWorldFromWelcome, expect, invoke, openSettings, test } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')
const generateButton = (win: Page) => win.locator('main header').getByRole('button', { name: 'Generate', exact: true })
const topBar = (win: Page) => win.locator('header').first()

async function fakeProvider(options: FakeProviderOptions = {}): Promise<FakeProvider> {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  return startFakeProvider({ delayMs: 5, ...options })
}

/** Connects the fake server as a provider and makes `modelId` the writer model, through the API. */
async function useWriter(win: Page, fake: FakeProvider, modelId: string, contextLength: number | null = 32000): Promise<void> {
  const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
  await invoke(win, 'updateSettings', {
    models: { writer: { providerId: p.id, modelId, label: modelId, contextLength, promptPrice: null, completionPrice: null } }
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

test('a draft keeps writing while another page is open, and every word reaches the scene', async ({ launch }) => {
  const fake = await fakeProvider({ slowWords: 900, slowDelayMs: 20 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    await useWriter(win, fake, 'fake/slow')
    const sceneId = await firstScene(win)

    await generateButton(win).click()
    await expect(prose(win)).toContainText('The rain')
    await binder(win).getByRole('button', { name: 'Characters' }).click()
    await expect(win.getByRole('heading', { name: 'No characters yet' })).toBeVisible()
    // The top bar says a draft is still being written, and Esc on this page leaves it alone.
    const writing = topBar(win).getByRole('button', { name: 'Writing…' })
    await expect(writing).toBeVisible()
    await win.keyboard.press('Escape')
    await writing.click()
    await expect(prose(win)).toBeVisible()
    await expect(generateButton(win)).toBeHidden()

    await binder(win).getByRole('button', { name: 'Characters' }).click()
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId))[0]?.status, { timeout: 30_000 }).toBe('complete')
    await expect(writing).toBeHidden()
    const [gen] = await invoke(win, 'listGenerations', sceneId)
    const rec = await invoke(win, 'getGeneration', gen.id)
    await expect.poll(async () => (await invoke(win, 'getScene', sceneId)).text.trim()).toBe(rec.response.trim())
  } finally {
    await fake.close()
  }
})

test('a draft keeps writing into its own scene while another scene is open, says when it is done, and one Ctrl+Z there takes it out', async ({
  launch
}) => {
  const fake = await fakeProvider({ slowWords: 300, slowDelayMs: 20 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const sceneId = await firstScene(win)
    const [story] = await invoke(win, 'listStories')
    const { chapters } = await invoke(win, 'getOutline', story.id)
    const other = await invoke(win, 'createScene', chapters[0].id, { title: 'The Ferry' })
    await useWriter(win, fake, 'fake/slow')
    const row = (title: string) => binder(win).locator('[data-row]', { hasText: title }).first()

    await generateButton(win).click()
    await expect(prose(win)).toContainText('The rain')
    await row('The Ferry').click()
    await expect(win.locator('main header').getByRole('button', { name: 'The Ferry' })).toBeVisible()
    await expect(prose(win)).not.toContainText('The rain')
    // The top bar can take Adam back to it from here.
    await expect(topBar(win).getByRole('button', { name: 'Writing…' })).toBeVisible()

    // One Generate draft at a time: this one says where the other is being written.
    await generateButton(win).click()
    await expect(toasts(win).getByText('A draft of “Scene 1” is still being written. Stop it there first, or wait for it to finish.')).toBeVisible()
    expect(await invoke(win, 'listGenerations', other.id)).toEqual([])

    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId))[0]?.status, { timeout: 30_000 }).toBe('complete')
    const done = toasts(win).getByText('The draft of “Scene 1” is finished.')
    await expect(done).toBeVisible()
    await expect(topBar(win).getByRole('button', { name: 'Writing…' })).toBeHidden()
    const [gen] = await invoke(win, 'listGenerations', sceneId)
    const rec = await invoke(win, 'getGeneration', gen.id)
    await expect.poll(async () => (await invoke(win, 'getScene', sceneId)).text.trim()).toBe(rec.response.trim())
    expect((await invoke(win, 'getScene', other.id)).text).toBe('')

    // Show goes to it; the whole draft is one step there, as if Adam had stayed.
    await toasts(win).locator(':scope > div').filter({ hasText: 'The draft of “Scene 1” is finished.' }).getByRole('button', { name: 'Show' }).click()
    await expect(win.locator('main header').getByRole('button', { name: 'Scene 1' })).toBeVisible()
    await expect(prose(win)).toContainText('The rain')
    await prose(win).click()
    await win.keyboard.press('Control+z')
    await expect(prose(win)).not.toContainText('The rain')
    await expect.poll(async () => (await invoke(win, 'getScene', sceneId)).text).toBe('')
  } finally {
    await fake.close()
  }
})

test('switching worlds mid-draft stops it with every word kept, and no false "Recovered" message', async ({ launch }) => {
  const fake = await fakeProvider({ slowWords: 3000, slowDelayMs: 25 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    await useWriter(win, fake, 'fake/slow')
    const sceneId = await firstScene(win)

    await generateButton(win).click()
    await expect(prose(win)).toContainText('Mara kept her hood low')
    await topBar(win).getByRole('button', { name: /Alpha/ }).click()
    await win.getByRole('menuitem', { name: 'New world…' }).click()
    await win.getByRole('dialog').getByLabel('World name').fill('Beta')
    await win.getByRole('dialog').getByRole('button', { name: 'Create world' }).click()
    await expect(topBar(win).getByRole('button', { name: /Beta/ })).toBeVisible()
    await expect(win.getByText('Drafting stopped because you switched worlds. The text so far is kept.')).toBeVisible()
    await expect(topBar(win)).toContainText('0 words')

    await topBar(win).getByRole('button', { name: /Beta/ }).click()
    await win.getByRole('menuitem', { name: 'Alpha' }).click()
    await expect(topBar(win).getByRole('button', { name: /Alpha/ })).toBeVisible()
    await expect(prose(win)).toContainText('Mara kept her hood low')
    expect(await invoke(win, 'listRecovery')).toEqual([])
    const [gen] = await invoke(win, 'listGenerations', sceneId)
    expect(gen.status).toBe('stopped')
    const rec = await invoke(win, 'getGeneration', gen.id)
    expect((await invoke(win, 'getScene', sceneId)).text.trim()).toBe(rec.response.trim())
    await win.waitForTimeout(500)
    await expect(win.getByText(/Recovered unsaved writing/)).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

test('deleting the scene a draft is writing into stops the draft, nothing is left failing to save, and Undo brings every word back', async ({
  launch
}) => {
  const fake = await fakeProvider({ slowWords: 3000, slowDelayMs: 25 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const sceneId = await firstScene(win)
    const [story] = await invoke(win, 'listStories')
    const { chapters } = await invoke(win, 'getOutline', story.id)
    await invoke(win, 'createScene', chapters[0].id, { title: 'The Ferry' })
    await useWriter(win, fake, 'fake/slow')

    await generateButton(win).click()
    await expect(prose(win)).toContainText('Mara kept her hood low')
    await binder(win).locator('[data-row]', { hasText: 'Scene 1' }).first().focus()
    await win.keyboard.press('Delete')
    await expect(
      toasts(win).getByText('Drafting stopped because the scene was deleted. Undo brings it back with the text so far.')
    ).toBeVisible()
    await expect(toasts(win).getByText('“Scene 1” deleted.')).toBeVisible()
    await expect(win.locator('main header').getByRole('button', { name: 'The Ferry' })).toBeVisible()
    expect((await invoke(win, 'listGenerations', sceneId))[0].status).toBe('stopped')

    // Nothing keeps trying to save into the deleted scene, and the open one saves as usual.
    await win.waitForTimeout(3000)
    await expect(topBar(win)).not.toContainText('Not saved')
    await prose(win).click()
    await win.keyboard.type('The ferry left at dawn.')
    await expect(topBar(win)).toContainText('Saved')
    await expect(topBar(win)).not.toContainText('Not saved')

    await toasts(win).getByRole('button', { name: 'Undo' }).click()
    await expect(binder(win).locator('[data-row]', { hasText: 'Scene 1' })).toHaveCount(1)
    const [gen] = await invoke(win, 'listGenerations', sceneId)
    const rec = await invoke(win, 'getGeneration', gen.id)
    expect(rec.response.length).toBeGreaterThan(0)
    expect((await invoke(win, 'getScene', sceneId)).text.trim()).toBe(rec.response.trim())
    expect(await invoke(win, 'listRecovery')).toEqual([])
  } finally {
    await fake.close()
  }
})

test('Add below on a scene with text puts the draft below a scene break, and one Ctrl+Z takes both away', async ({ launch }) => {
  const fake = await fakeProvider({ words: 60 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    await useWriter(win, fake, 'fake/writer')
    await prose(win).click()
    await win.keyboard.type('Adam wrote this.')

    // Said before Generate is pressed.
    await win.getByRole('button', { name: 'Draft options' }).click()
    await expect(win.getByText('This scene already has text. You can replace it with the new draft, or add the draft below it.')).toBeVisible()
    await win.keyboard.press('Escape')

    // Generate asks where the draft goes; Add below keeps the text and puts the draft after it.
    await generateButton(win).click()
    await win.getByRole('button', { name: 'Add below', exact: true }).click()
    const sceneId = await firstScene(win)
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId))[0]?.status).toBe('complete')
    await expect(prose(win).locator('hr')).toHaveCount(1)
    await expect(prose(win).locator('p').first()).toHaveText('Adam wrote this.')
    await expect(prose(win)).toContainText('The rain')
    await prose(win).click()
    await win.keyboard.press('Control+z')
    await expect(prose(win).locator('hr')).toHaveCount(0)
    await expect(prose(win)).toHaveText('Adam wrote this.')
  } finally {
    await fake.close()
  }
})

test('error and cut-off messages offer the right next step', async ({ launch }) => {
  const fake = await fakeProvider()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const sceneId = await firstScene(win)

    // Out of credit: the message points to Settings, and so does its button.
    await useWriter(win, fake, 'fake/credit')
    await generateButton(win).click()
    const credit = toasts(win).getByText(/out of credit/)
    await expect(credit).toBeVisible()
    await toasts(win).getByRole('button', { name: 'Open Settings' }).click()
    await expect(win.getByRole('heading', { level: 1, name: 'Models' })).toBeVisible()
    expect((await invoke(win, 'listGenerations', sceneId))[0].cost).toBeNull()

    // Cut off by the reply limit: said plainly, with the record a click away.
    await useWriter(win, fake, 'fake/length')
    await generateButton(win).click()
    await expect(toasts(win).getByText(/ran out of room before the end of the scene/)).toBeVisible()
    await toasts(win).getByRole('button', { name: 'What the AI saw' }).click()
    await expect(win.getByRole('heading', { level: 1, name: 'What the AI saw' })).toBeVisible()
    await expect(win.getByText(/ran out of room before the end of the scene/).first()).toBeVisible()
  } finally {
    await fake.close()
  }
})

test('a length the model cannot write is refused before anything is sent', async ({ launch }) => {
  const fake = await fakeProvider()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const sceneId = await firstScene(win)
    // A new scene's length is Auto.
    await expect(win.getByRole('group', { name: 'Quick lengths' }).getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true')
    const scene = await invoke(win, 'getScene', sceneId)
    await invoke(win, 'updateSceneCard', sceneId, { ...scene.card, targetWords: 6000, lengthSet: true })
    await useWriter(win, fake, 'fake/writer', 8192)

    await generateButton(win).click()
    await expect(toasts(win).getByText(/This model can write about [\d,]+ words in one go/)).toBeVisible()
    expect(chatRequests(fake)).toBe(0)
    await toasts(win).getByRole('button', { name: 'Draft options' }).click()
    await expect(win.getByRole('heading', { name: 'Draft options' })).toBeVisible()

    // Emptying the length box goes back to Auto, which comes down to what this model can write.
    const length = win.getByRole('dialog').getByLabel('Length', { exact: true })
    await expect(length).toHaveValue('6000')
    await length.fill('')
    await expect(length).toHaveAttribute('placeholder', 'Auto')
    await expect(win.getByText('Auto: the AI picks the length the scene needs.')).toBeVisible()
    await expect(win.getByRole('button', { name: "Use the card's 6,000" })).toBeVisible()
    await win.keyboard.press('Escape')
    await generateButton(win).click()
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId))[0]?.status).toBe('complete')
    const rec = await invoke(win, 'getGeneration', (await invoke(win, 'listGenerations', sceneId))[0].id)
    expect(rec.params.autoLength).toBe(true)
    expect(rec.messages[1].content).toMatch(/between 800 and [\d,]+ words/)
  } finally {
    await fake.close()
  }
})

test('What the AI saw → an entry → back again, and back to the Drafts tab', async ({ launch }) => {
  const fake = await fakeProvider()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const sceneId = await firstScene(win)
    const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara' })
    const scene = await invoke(win, 'getScene', sceneId)
    await invoke(win, 'updateSceneCard', sceneId, { ...scene.card, povId: mara.id, beats: ['Mara walks in.'] })
    await useWriter(win, fake, 'fake/writer')

    await generateButton(win).click()
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId))[0]?.status).toBe('complete')
    await win.getByRole('tab', { name: 'Drafts' }).click()
    await win.getByRole('button', { name: /What the AI saw/ }).first().click()
    await expect(win.getByRole('heading', { level: 1, name: 'What the AI saw' })).toBeVisible()
    await win.getByRole('button', { name: /Point-of-view character: Mara/ }).click()
    await win.getByTitle('Open Mara').click()

    const back = win.getByRole('button', { name: 'Back to What the AI saw' })
    await expect(back).toBeVisible()
    await back.click()
    await expect(win.getByRole('heading', { level: 1, name: 'What the AI saw' })).toBeVisible()
    // The part that was open is open again.
    await expect(win.getByRole('button', { name: /Point-of-view character: Mara/ })).toHaveAttribute('aria-expanded', 'true')
    await win.getByRole('button', { name: /^Back to/ }).click()
    await expect(win.getByRole('tab', { name: 'Drafts' })).toHaveAttribute('aria-selected', 'true')
  } finally {
    await fake.close()
  }
})

test('Models page: a rejected key is marked Not working, also after coming back; online presets need a key', async ({ launch }) => {
  const fake = await fakeProvider()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    await openSettings(win, 'Models')

    // An online service's preset: the key isn't optional, and an empty one is caught before saving.
    await win.getByRole('button', { name: 'Add another provider' }).click()
    const form = win.locator('form').filter({ hasText: 'Add a provider' })
    await form.getByRole('button', { name: 'OpenAI', exact: true }).click()
    await expect(form.getByLabel('API key', { exact: true })).toBeVisible()
    await expect(form.getByText('API key (optional)')).toHaveCount(0)
    await form.getByRole('button', { name: 'Add provider' }).click()
    await expect(win.getByText('Paste your OpenAI API key first.', { exact: false })).toBeVisible()
    expect(await invoke(win, 'listProviders')).toHaveLength(0)
    await win.getByRole('button', { name: 'Cancel' }).click()

    // A key the provider turns down: the message points to the button on this page.
    await win.getByRole('button', { name: 'Add another provider' }).click()
    await form.getByLabel('Name').fill('Fake')
    await form.getByLabel('Base URL').fill(fake.url)
    await form.getByLabel('API key (optional)').fill('bad')
    await form.getByRole('button', { name: 'Add provider' }).click()
    const card = win.locator('main').getByText('Not working')
    await expect(card).toBeVisible()
    await expect(win.getByText(/Click Edit and paste it again/)).toBeVisible()

    await binder(win).getByRole('button', { name: 'Characters' }).click()
    await openSettings(win, 'Models')
    await expect(card).toBeVisible()
  } finally {
    await fake.close()
  }
})
