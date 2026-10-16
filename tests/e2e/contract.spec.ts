// Each scene's contract (long story memory fix 13), end to end against the fake provider: the Context tab shows the
// contract the briefing carries (built from the scene card); a draft is planned first and the plan says what must change
// (tests/fake-provider/plan.mjs: the card's beats, and a dragon the card never asks for, left out); the draft is checked
// against the contract as it lands (tests/fake-provider/repair.mjs): a beat it shows is kept, one it doesn't is asked
// about in the Issues tab, marked "Scene contract", and the check report says how the contract went. Settings › Models
// turns it off. Invented test text only.
import type { Page } from '@playwright/test'
import { createWorldFromWelcome, expect, invoke, openSettings, startFake, test, useFakeModel } from './helpers'

// Planning, the check as words land and contracts on; the memory reads a scene once and not again on its own; the
// critic after a draft waits.
const ON = {
  env: { AIWRITE_PLAN: 'on', AIWRITE_REPAIR: 'on', AIWRITE_CONTRACT: 'on', AIWRITE_KEEPER_QUIET_MS: '600000', AIWRITE_AFTER_DRAFT_MS: '600000' }
}

const scenePanel = (win: Page) => win.getByRole('complementary', { name: 'Scene panel' })
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')
const report = (win: Page) => scenePanel(win).getByRole('region', { name: 'Check report' })
// The fake writer's draft has Mara count the doors from the corner; nothing in it burns a letter.
const BEATS = ['Mara counts the doors from the corner.', 'Mara burns the letter in the fire.']
const OPTIONS = { targetWords: 600, creativity: 'balanced' as const, direction: '' }

test('a draft keeps to its scene contract: shown in the Context tab, planned, checked as it lands, and off in Settings', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch(ON)
    await createWorldFromWelcome(win, 'Harbour')
    const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the ferry.' })
    const tobin = await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'A ferryman.' })
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    const card = (await invoke(win, 'getScene', sceneId)).card
    await invoke(win, 'updateSceneCard', sceneId, { ...card, povId: mara.id, presentIds: [mara.id, tobin.id], beats: BEATS })
    await useFakeModel(win, fake)

    // The Context tab: the contract the briefing carries, from the card (no plan yet).
    await scenePanel(win).getByRole('tab', { name: 'Context' }).click()
    const context = scenePanel(win).getByRole('tabpanel', { name: 'Context' })
    await expect(context).toContainText('This scene’s contract', { timeout: 30_000 })
    const preview = await invoke(win, 'previewContext', sceneId, OPTIONS)
    expect(preview.blocks.find((b) => b.id === 'scene-contract')?.text).toContain(
      'Must change by the end of the scene:\n1. Mara counts the doors from the corner.\n2. Mara burns the letter in the fire.'
    )

    // A draft: planned first (the plan says what must change; the dragon the card never asks for is left out), then
    // checked against the contract as it lands.
    await win.locator('main header').getByRole('button', { name: 'Generate', exact: true }).click()
    await expect(toasts(win).getByText('A question about the new words is in the Issues tab.')).toBeVisible({ timeout: 60_000 })
    const [draft] = (await invoke(win, 'listGenerations', sceneId)).filter((g) => g.job === 'draft')
    const rec = await invoke(win, 'getGeneration', draft.id)
    const sent = rec.blocks.find((b) => b.id === 'scene-contract')!
    expect(sent.text).toContain('1. Mara counts the doors from the corner')
    expect(sent.text).toContain('2. Mara burns the letter in the fire')
    expect(sent.text).not.toContain('dragon')

    // The beat the draft doesn't show is asked about, marked as from the scene contract.
    await toasts(win).getByRole('button', { name: 'Show' }).click()
    const asked = scenePanel(win).getByRole('article', { name: /This scene was planned to show this, but the new words don’t yet: “Mara burns the letter in the fire\.” Write it in, or leave it for later\?/ })
    await expect(asked).toContainText('Scene contract')
    // The check report says how the contract went, item by item.
    await expect(report(win).getByRole('button', { name: 'Checked against the scene contract · 1 of 2 kept · 1 not shown yet' })).toBeVisible()
    await report(win).getByRole('button', { name: /^Checked against the scene contract/ }).click()
    await expect(report(win).locator('[data-report-check="contract"]')).toContainText('Kept · Must change · Mara counts the doors from the corner')
    await expect(report(win).locator('[data-report-check="contract"]')).toContainText('Not shown yet · Must change · Mara burns the letter in the fire')

    // Settings › Models: "Give each scene a contract", on by default. Off: no contract in the next draft.
    await openSettings(win, 'Models')
    const toggle = win.getByRole('switch', { name: 'Give each scene a contract' })
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(win.getByText('The AI reads a little more each time.', { exact: false })).toBeVisible()
    await toggle.click()
    await expect.poll(async () => (await invoke(win, 'getSettings')).sceneContracts).toBe(false)
    expect((await invoke(win, 'previewContext', sceneId, OPTIONS)).blocks.some((b) => b.id === 'scene-contract')).toBe(false)
  } finally {
    await fake.close()
  }
})
