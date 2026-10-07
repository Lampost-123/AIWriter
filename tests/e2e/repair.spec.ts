// Check and repair (Adam, 2026-10-07; step 3 of the consistency plan): as soon as a draft lands, its words are checked
// claim by claim against where things stood. Here Adam's own words take Mara's hood off and send Tobin to the docks
// (the fake memory model reads "hood off" and "gone to the docks", each with its words), and Add below's fake draft
// then says "Mara kept her hood low" and "Tobin was where he had promised to be". The first is mended in place, in
// amber, with Undo; the second needs Adam's choice, so it is asked as a question in the Issues tab.
import type { Page } from '@playwright/test'
import { createWorldFromWelcome, expect, invoke, startFake, test, useFakeModel } from './helpers'

// Repair on; the memory reads the scene once there is a model and not again on its own; the critic waits.
const ON = { env: { AIWRITE_REPAIR: 'on', AIWRITE_KEEPER_QUIET_MS: '600000', AIWRITE_AFTER_DRAFT_MS: '600000' } }

const prose = (win: Page) => win.locator('.scene-prose')
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')
const scenePanel = (win: Page) => win.getByRole('complementary', { name: 'Scene panel' })
const ADAMS = 'Mara took off her hood. Tobin left for the docks.'

test('a draft that slips is mended in amber with Undo as it lands, and a slip that needs a choice is asked', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch(ON)
    await createWorldFromWelcome(win, 'Harbour')
    await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the ferry.' })
    await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'A ferryman.' })
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    await invoke(win, 'saveSceneText', sceneId, null, ADAMS)
    await useFakeModel(win, fake)
    await expect(prose(win)).toContainText(ADAMS)

    // Add below: the draft carries on from Adam's words.
    await win.locator('main header').getByRole('button', { name: 'Generate', exact: true }).click()
    await win.getByRole('button', { name: 'Add below', exact: true }).click()

    // The slip is mended in place as the draft lands, shown in amber, and said with Undo.
    const mended = prose(win).locator('.aw-repair')
    await expect(mended).toHaveText('kept her hood down', { timeout: 60_000 })
    await expect(mended).toHaveAttribute('title', /the AI had written “kept her hood low”\. Mara took her hood off earlier/)
    await expect(prose(win)).toContainText('Mara kept her hood down and her left sleeve pinned')
    await expect(prose(win).locator('p').first()).toHaveText(ADAMS)
    const note = toasts(win).getByText(/^Mended a slip in the new words, in amber: Mara took her hood off earlier.*A question about them is in the Issues tab\.$/)
    await expect(note).toBeVisible()
    // Saved with the scene, as any change is.
    await expect.poll(async () => (await invoke(win, 'getScene', sceneId)).text, { timeout: 15_000 }).toContain('Mara kept her hood down')

    // The slip that needs a choice is one question in the Issues tab, on the draft's own words.
    await toasts(win).getByRole('button', { name: 'Show' }).click()
    const question = scenePanel(win).getByRole('article', { name: /Tobin left for the docks earlier in the scene\. Should he come back first/ })
    await expect(question).toBeVisible()
    await expect(question).toContainText('“Tobin was where he had promised to be”')

    // Undo puts back what the AI wrote, and that slip isn't mended or raised again.
    await toasts(win).getByRole('button', { name: 'Undo' }).click()
    await expect(prose(win)).toContainText('Mara kept her hood low and her left sleeve pinned')
    await expect(prose(win).locator('.aw-repair')).toHaveCount(0)
    await expect(toasts(win).getByText('Put back as the AI wrote it. It won’t be changed again.')).toBeVisible()
    await expect.poll(async () => (await invoke(win, 'listIssues', sceneId)).find((i) => i.quote === 'Mara kept her hood low')?.status ?? null).toBe('ignored')
  } finally {
    await fake.close()
  }
})

test('Continue’s words are checked once accepted: a slip that needs a choice is asked, and Adam’s words are left as they are', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch(ON)
    await createWorldFromWelcome(win, 'Harbour')
    await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the ferry.' })
    await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'A ferryman.' })
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    await invoke(win, 'saveSceneText', sceneId, null, ADAMS)
    await useFakeModel(win, fake)
    await expect(prose(win)).toContainText(ADAMS)

    // Continue at the end of Adam's words, then Accept: the fake Continue brings Tobin back with no words doing it.
    await prose(win).locator('p').first().click()
    await win.keyboard.press('End')
    await win.keyboard.press('Control+k')
    await win.getByRole('combobox', { name: 'Search, or find an action' }).fill('Continue from the cursor')
    await win.getByRole('option', { name: /Continue from the cursor/ }).click()
    const change = win.getByRole('group', { name: 'The AI’s change' })
    await change.getByRole('button', { name: /^Accept/ }).click()
    await expect(prose(win)).toContainText('Tobin set his cup down at last.')

    await expect(toasts(win).getByText('A question about the new words is in the Issues tab.')).toBeVisible({ timeout: 60_000 })
    await toasts(win).getByRole('button', { name: 'Show' }).click()
    const question = scenePanel(win).getByRole('article', { name: /Tobin left for the docks earlier in the scene\. Should he come back first/ })
    await expect(question).toContainText('“Tobin set his cup down at last”')
    await expect(prose(win).locator('.aw-repair')).toHaveCount(0)
    await expect(prose(win).locator('p').first()).toHaveText(ADAMS)
  } finally {
    await fake.close()
  }
})
