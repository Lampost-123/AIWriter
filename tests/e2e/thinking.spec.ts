// How much the models think, end to end, against the fake OpenAI-compatible server
// (tests/fake-provider/server.mjs): Settings › Models offers a choice for the writer and
// one for the memory, the choice is kept after a restart, a draft asks the writer model
// for it (an OpenAI-compatible provider is sent reasoning_effort), What the AI saw says
// so, and the memory asks with its own choice.
import type { Page } from '@playwright/test'
import type { FakeProvider } from '../fake-provider/server.mjs'
import { binder, closeWindow, createWorldFromWelcome, expect, invoke, openSettings, test } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const generateButton = (win: Page) => win.locator('main header').getByRole('button', { name: 'Generate', exact: true })
const row = (win: Page, title: string) => binder(win).locator('[data-row]', { hasText: title }).first()
const section = (win: Page, title: string) => win.locator('section').filter({ has: win.getByRole('heading', { name: title, exact: true }) })
const thinking = (win: Page, title: string) => section(win, title).getByRole('radiogroup', { name: /thinking$/ })
const requests = (fake: FakeProvider): number => Object.values(fake.requestCounts()).reduce((a, b) => a + b, 0)

test('Settings › Models: the writer and the memory each choose how much to think, and a draft asks for it', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 2 })
  try {
    const first = await launch()
    let win = first.win
    await createWorldFromWelcome(win, 'Alpha')
    const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
    await invoke(win, 'updateSettings', {
      models: {
        writer: {
          providerId: p.id,
          modelId: 'fake/writer',
          label: 'fake/writer',
          contextLength: 32000,
          promptPrice: null,
          completionPrice: null
        }
      }
    })
    await win.reload()
    await expect(prose(win)).toBeVisible()

    // By default neither the writer, the memory nor the character builder thinks.
    await openSettings(win, 'Models')
    const writer = thinking(win, 'Writer model')
    const memory = thinking(win, 'Memory model')
    const builder = thinking(win, 'Character builder model')
    await expect(writer.getByRole('radio')).toHaveText(['Model decides', 'Off', 'Low', 'Medium', 'High'])
    await expect(writer.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true')
    await expect(writer.getByRole('radio', { checked: true })).toHaveCount(1)
    await expect(memory.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true')
    await expect(memory.getByRole('radio', { checked: true })).toHaveCount(1)
    await expect(builder.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true')
    await expect(section(win, 'Character builder model').getByText('Same as the writer model')).toBeVisible()
    await expect(section(win, 'Writer model').getByText('Answers straight away', { exact: false })).toBeVisible()
    await expect(section(win, 'Memory model').getByText('Answers straight away', { exact: false })).toBeVisible()

    // High for the writer: the hint under it changes, and the memory keeps its own choice.
    await writer.getByRole('radio', { name: 'High' }).click()
    await expect(writer.getByRole('radio', { name: 'High' })).toHaveAttribute('aria-checked', 'true')
    await expect(writer.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'false')
    await expect(section(win, 'Writer model').getByText('Thinks the most before it answers: slowest, and costs the most.')).toBeVisible()
    await expect(section(win, 'Writer model').getByText('Answers straight away', { exact: false })).toBeHidden()
    await expect(memory.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true')
    expect((await invoke(win, 'getSettings')).thinking).toMatchObject({ writer: 'high', memory: 'off', builder: 'off' })

    // The character builder has its own choice too.
    await builder.getByRole('radio', { name: 'Low' }).click()
    await expect(builder.getByRole('radio', { name: 'Low' })).toHaveAttribute('aria-checked', 'true')
    expect((await invoke(win, 'getSettings')).thinking).toMatchObject({ writer: 'high', memory: 'off', builder: 'low' })

    // Kept after closing and opening the app again.
    await closeWindow(first.app)
    win = (await launch({ dataDir: first.dataDir })).win
    await expect(prose(win)).toBeVisible()
    await openSettings(win, 'Models')
    await expect(thinking(win, 'Writer model').getByRole('radio', { name: 'High' })).toHaveAttribute('aria-checked', 'true')
    await expect(thinking(win, 'Memory model').getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true')
    await expect(thinking(win, 'Character builder model').getByRole('radio', { name: 'Low' })).toHaveAttribute('aria-checked', 'true')

    // A draft asks the writer model to think hard; for an OpenAI-compatible provider that's reasoning_effort.
    await row(win, 'Scene 1').click()
    await expect(prose(win)).toBeVisible()
    fake.reset()
    await generateButton(win).click()
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId))[0]?.status, { timeout: 30_000 }).toBe('complete')
    expect(fake.requestCounts()).toEqual({ 'fake/writer': 1 })
    const sent = fake.lastRequest()!.body
    expect(sent.reasoning_effort).toBe('high')
    expect(sent).not.toHaveProperty('reasoning')
    const [gen] = await invoke(win, 'listGenerations', sceneId)
    expect((await invoke(win, 'getGeneration', gen.id)).params.thinking).toBe('high')

    // What the AI saw says how much the model was asked to think.
    await win.getByRole('tab', { name: 'Drafts' }).click()
    await win
      .getByRole('button', { name: /What the AI saw/ })
      .first()
      .click()
    await expect(win.getByRole('heading', { level: 1, name: 'What the AI saw' })).toBeVisible()
    await expect(win.getByText('Thinking: High', { exact: true })).toBeVisible()

    // Leaving the scene lets the memory read the draft, with its own choice (Off), though it uses the writer model.
    await binder(win).getByRole('button', { name: 'Characters' }).click()
    await expect.poll(() => requests(fake), { timeout: 30_000 }).toBeGreaterThan(1)
    expect(fake.lastRequest()!.body.reasoning_effort).toBe('none')
  } finally {
    await fake.close()
  }
})
