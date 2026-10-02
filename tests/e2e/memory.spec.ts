// The memory keeps itself up to date with the text, end to end, against the fake provider (its
// memory replies are described at the top of tests/fake-provider/server.mjs): typing a sentence
// adds a fact, editing it changes the fact, deleting it takes the fact away, with no clicks.
import type { Page } from '@playwright/test'
import type { FakeProvider } from '../fake-provider/server.mjs'
import { binder, createWorldFromWelcome, expect, invoke, test } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const row = (win: Page, title: string) => binder(win).locator('[data-row]', { hasText: title }).first()

async function fakeProvider(): Promise<FakeProvider> {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  return startFakeProvider({ delayMs: 2 })
}

/** Connects the fake server and makes `modelId` the writer model (the memory uses it when no memory model is chosen). */
async function useModel(win: Page, fake: FakeProvider, modelId = 'fake/writer'): Promise<void> {
  const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
  await invoke(win, 'updateSettings', {
    models: { writer: { providerId: p.id, modelId, label: modelId, contextLength: 32000, promptPrice: null, completionPrice: null } }
  })
  await win.reload()
  await expect(prose(win)).toBeVisible()
}

const names = async (win: Page): Promise<string[]> => (await invoke(win, 'listEntries')).map((e) => e.name)

async function notes(win: Page): Promise<string[]> {
  const [mara] = (await invoke(win, 'listEntries')).filter((e) => e.name === 'Mara')
  if (!mara) return []
  return (await invoke(win, 'listChanges', mara.id)).map((c) => (c.kind === 'update' ? c.payload.note : ''))
}

test('typing a sentence adds a fact; editing it changes the fact; deleting it takes it away', async ({ launch }) => {
  const fake = await fakeProvider()
  try {
    const { win } = await launch({ env: { AIWRITE_KEEPER_QUIET_MS: '700' } })
    await createWorldFromWelcome(win, 'Alpha')
    await useModel(win, fake)
    await prose(win).click()
    await win.keyboard.type('The ferry was late. Mara lost her left hand.')

    // A moment without typing and the memory reads it: Mara, and what happened to her.
    await expect.poll(() => notes(win), { timeout: 30_000 }).toEqual(['lost her left hand'])
    await binder(win).getByRole('button', { name: 'What changed' }).click()
    const list = win.locator('main')
    await expect(list.getByRole('region', { name: 'Book 1, Ch 1, Sc 1' })).toBeVisible()
    await expect(list.getByRole('button', { name: 'Undo: Mara, New character' })).toBeVisible()
    await expect(list.getByRole('button', { name: 'Undo: Mara, Lost her left hand' })).toBeVisible()

    // Editing the words changes the fact.
    await row(win, 'Scene 1').click()
    await prose(win).click()
    await win.keyboard.press('Control+End')
    for (let i = 0; i < 'left hand.'.length; i++) await win.keyboard.press('Backspace')
    await win.keyboard.type('right hand.')
    await expect.poll(() => notes(win), { timeout: 30_000 }).toEqual(['lost her right hand'])

    // Deleting them takes the fact away, and Mara with it (nothing else mentions her).
    await win.keyboard.press('Control+A')
    await win.keyboard.type('The ferry was late.')
    await expect.poll(() => names(win), { timeout: 30_000 }).not.toContain('Mara')
    const log = await invoke(win, 'listMemoryLog', {})
    expect(log.map((l) => l.text)).toContain('Lost her right hand: those words were deleted')
    expect(log.every((l) => l.where === 'Book 1, Ch 1, Sc 1')).toBe(true)
  } finally {
    await fake.close()
  }
})

test('without a model the memory waits, and says how to choose one', async ({ launch }) => {
  const { win } = await launch({ env: { AIWRITE_KEEPER_QUIET_MS: '500' } })
  await createWorldFromWelcome(win, 'Alpha')
  await win.keyboard.type('Mara lost her left hand.')
  await expect
    .poll(async () => (await invoke(win, 'getMemoryStatus')).error, { timeout: 30_000 })
    .toBe('Choose a writer model in Settings > Models to keep the memory up to date.')
  await expect(
    win
      .locator('header')
      .first()
      .getByRole('button', { name: /Memory isn't updating/ })
  ).toBeVisible()
})
