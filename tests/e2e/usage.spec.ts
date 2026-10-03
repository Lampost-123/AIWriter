// Usage and cost (milestone 6), end to end against the fake AI server: a few AI calls, the page's totals (the
// same as the calls' own records), then a small monthly limit and the ask before the next Generate: "Not now"
// starts nothing, "Carry on this month" writes the draft.
import type { Page } from '@playwright/test'
import { dollars } from '@shared/contracts/usage'
import { createWorldFromWelcome, expect, invoke, startFake, test } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const generateButton = (win: Page) => win.locator('main header').getByRole('button', { name: 'Generate', exact: true })
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')

async function firstScene(win: Page): Promise<string> {
  const [story] = await invoke(win, 'listStories')
  const { scenes } = await invoke(win, 'getOutline', story.id)
  return scenes[0].id
}

async function palette(win: Page, action: string): Promise<void> {
  await win.keyboard.press('Control+k')
  await win.keyboard.type(action)
  await win.getByRole('option', { name: action }).first().click()
}

test('the page adds up the AI calls, and a small limit asks before the next draft', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    // A writer model with prices, so each call has a cost (the fake reports tokens, not dollars).
    const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
    await invoke(win, 'updateSettings', {
      models: {
        writer: { providerId: p.id, modelId: 'fake/writer', label: 'fake/writer', contextLength: 32000, promptPrice: 0.0001, completionPrice: 0.0002 }
      }
    })
    await win.reload()
    await expect(prose(win)).toBeVisible()
    const sceneId = await firstScene(win)

    await generateButton(win).click()
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId))[0]?.status, { timeout: 30_000 }).toBe('complete')
    const [draft] = await invoke(win, 'listGenerations', sceneId)
    expect(draft.cost).toBeGreaterThan(0)

    // The page, from the palette: this month's spending, the same as the records say.
    await palette(win, 'Usage and cost')
    await expect(win.getByRole('heading', { level: 1, name: 'Usage and cost' })).toBeVisible()
    await expect(win.getByText('No limit set; warnings off.')).toBeVisible()
    const report = await invoke(win, 'getUsage', { period: 'this-month', scope: 'library' })
    expect(report.total.calls).toBeGreaterThanOrEqual(1)
    expect(report.total.cost).toBeGreaterThanOrEqual(draft.cost!)
    expect(report.jobs.find((j) => j.label === 'Writing')?.cost).toBeCloseTo(draft.cost!, 6)
    // The page follows calls that finish while it shows (the memory reading the scene).
    await expect
      .poll(async () => win.getByText(dollars((await invoke(win, 'getUsage', { period: 'this-month', scope: 'library' })).total.cost)).count(), {
        timeout: 15_000
      })
      .toBeGreaterThan(1)
    await expect(win.getByRole('heading', { name: 'By job' })).toBeVisible()
    await expect(win.getByText('Writing', { exact: true })).toBeVisible()
    await expect(win.getByText('fake/writer', { exact: true })).toBeVisible()
    await win.getByRole('radio', { name: 'All time' }).click()
    await expect(win.getByText('By month')).toBeVisible()

    // A limit already passed: the page says so, and the window says it once.
    const limit = win.getByLabel('Limit in US dollars')
    await limit.fill('0.01')
    await limit.press('Enter')
    await expect(win.getByText(/of your \$0\.01 limit/)).toBeVisible()
    await expect(toasts(win).getByText("This month's AI spending has reached your $0.01 limit.", { exact: false })).toBeVisible()
    await expect(win.getByRole('button', { name: 'Carry on this month' }).first()).toBeVisible()

    // Back to the scene: Generate asks first. Not now starts nothing.
    await palette(win, 'Back to writing')
    await expect(prose(win)).toBeVisible()
    await generateButton(win).click()
    await win.getByRole('button', { name: 'Add below', exact: true }).click()
    const ask = win.getByRole('dialog', { name: "This month's AI spending has reached your $0.01 limit." })
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: 'Not now' }).click()
    await expect(ask).toBeHidden()
    await win.waitForTimeout(500)
    expect(await invoke(win, 'listGenerations', sceneId)).toHaveLength(1)

    // Carry on this month: the draft is written, and nothing asks again this month.
    await generateButton(win).click()
    await win.getByRole('button', { name: 'Add below', exact: true }).click()
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: 'Carry on this month' }).click()
    await expect(ask).toBeHidden()
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId)).length, { timeout: 30_000 }).toBe(2)
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId))[0]?.status, { timeout: 30_000 }).toBe('complete')
    expect(await invoke(win, 'getSpendState')).toMatchObject({ level: 'reached', carryOn: true, paused: false })
  } finally {
    await fake.close()
  }
})
