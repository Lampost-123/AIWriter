// Check and repair (Adam, 2026-10-07; step 3 of the consistency plan): as soon as a draft lands, its words are checked
// claim by claim against where things stood. Only what plainly can't be true at that same moment is mended without
// asking (Adam, 2026-10-07, after the trap story showed the repair too eager); the rest is asked.
// - Add below: Adam's words take Mara's hood off and send Tobin to the docks (the fake memory model reads "hood off"
//   and "gone to the docks", each with its words), and the fake draft, below a scene break, says "Mara kept her hood
//   low" and "Tobin was where he had promised to be". Across a scene break anything may have happened, so both are
//   asked, the first with its fix to review; nothing is changed.
// - Continue: Adam's words put Tobin's cup on the shelf, and Continue's words, straight after, have him "set his cup
//   down at last": a plain contradiction about something held, at the same moment, mended in amber with Undo.
import type { Page } from '@playwright/test'
import { createWorldFromWelcome, expect, invoke, openSettings, startFake, test, useFakeModel } from './helpers'

// Repair on; the memory reads the scene once there is a model and not again on its own; the critic waits.
const ON = { env: { AIWRITE_REPAIR: 'on', AIWRITE_KEEPER_QUIET_MS: '600000', AIWRITE_AFTER_DRAFT_MS: '600000' } }

const prose = (win: Page) => win.locator('.scene-prose')
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')
const scenePanel = (win: Page) => win.getByRole('complementary', { name: 'Scene panel' })
const ADAMS = 'Mara took off her hood. Tobin left for the docks.'
const CUP = 'Mara took off her hood. Tobin put his cup on the shelf.'

async function setUp(win: Page, fake: Awaited<ReturnType<typeof startFake>>, text: string): Promise<string> {
  await createWorldFromWelcome(win, 'Harbour')
  await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the ferry.' })
  await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'A ferryman.' })
  const [story] = await invoke(win, 'listStories')
  const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
  await invoke(win, 'saveSceneText', sceneId, null, text)
  await useFakeModel(win, fake)
  await expect(prose(win)).toContainText(text)
  return sceneId
}

test('a draft below a scene break that slips is asked about, never changed: each slip one question, with its fix to review', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch(ON)
    const sceneId = await setUp(win, fake, ADAMS)

    // Add below: the draft goes below a scene break.
    await win.locator('main header').getByRole('button', { name: 'Generate', exact: true }).click()
    await win.getByRole('button', { name: 'Add below', exact: true }).click()

    await expect(toasts(win).getByText('2 questions about the new words are in the Issues tab.')).toBeVisible({ timeout: 60_000 })
    await expect(prose(win).locator('.aw-repair')).toHaveCount(0)
    await expect(prose(win)).toContainText('Mara kept her hood low and her left sleeve pinned')
    await expect(prose(win).locator('p').first()).toHaveText(ADAMS)

    // Each slip is one question in the Issues tab, on the draft's own words.
    await toasts(win).getByRole('button', { name: 'Show' }).click()
    const hood = scenePanel(win).getByRole('article', { name: /Mara took her hood off earlier, so it isn't low over her face now\. Change it, or keep it as it is\?/ })
    await expect(hood).toContainText('“Mara kept her hood low”')
    await expect(hood.locator('[data-suggested-fix]')).toContainText('“Mara kept her hood down”')
    await expect(hood.getByRole('button', { name: 'Review the fix' })).toBeVisible()
    const tobin = scenePanel(win).getByRole('article', { name: /Tobin left for the docks earlier in the scene\. Should he come back first/ })
    await expect(tobin).toContainText('“Tobin was where he had promised to be”')
    expect((await invoke(win, 'listIssues', sceneId)).filter((i) => i.status === 'open')).toHaveLength(2)
  } finally {
    await fake.close()
  }
})

test('Continue’s words are checked once accepted: a plain slip about something held is mended in amber, with Undo', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch(ON)
    const sceneId = await setUp(win, fake, CUP)

    // Continue at the end of Adam's words, then Accept.
    await prose(win).locator('p').first().click()
    await win.keyboard.press('End')
    await win.keyboard.press('Control+k')
    await win.getByRole('combobox', { name: 'Search, or find an action' }).fill('Continue from the cursor')
    await win.getByRole('option', { name: /Continue from the cursor/ }).click()
    const change = win.getByRole('group', { name: 'The AI’s change' })
    await change.getByRole('button', { name: /^Accept/ }).click()

    // Mended in place as the words go in, shown in amber, and said with Undo; Adam's words are as they were.
    const mended = prose(win).locator('.aw-repair')
    await expect(mended).toHaveText('looked at his cup', { timeout: 60_000 })
    await expect(mended).toHaveAttribute('title', /the AI had written “set his cup down”\. Tobin had just put his cup on the shelf/)
    await expect(prose(win)).toContainText('Tobin looked at his cup at last.')
    await expect(prose(win).locator('p').first()).toHaveText(CUP)
    await expect(toasts(win).getByText(/^Mended a slip in the new words, in amber: Tobin had just put his cup on the shelf/)).toBeVisible()
    await expect.poll(async () => (await invoke(win, 'getScene', sceneId)).text, { timeout: 15_000 }).toContain('Tobin looked at his cup at last.')

    // Undo puts back what the AI wrote, and that slip isn't mended or raised again.
    await toasts(win).getByRole('button', { name: 'Undo' }).click()
    await expect(prose(win)).toContainText('Tobin set his cup down at last.')
    await expect(prose(win).locator('.aw-repair')).toHaveCount(0)
    await expect(toasts(win).getByText('Put back as the AI wrote it. It won’t be changed again.')).toBeVisible()
    await expect.poll(async () => (await invoke(win, 'listIssues', sceneId)).find((i) => i.quote === 'Tobin set his cup down at last')?.status ?? null).toBe('ignored')
  } finally {
    await fake.close()
  }
})

test('Settings › Models has the off switch: off, a draft that slips is left as written and nothing is asked', async ({ launch }) => {
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

    // On by default; turned off in Settings › Models.
    await openSettings(win, 'Models')
    const toggle = win.getByRole('switch', { name: 'Check new words straight away' })
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(win.getByText('After a draft, beat or Continue, fix small slips in amber and ask about the rest.')).toBeVisible()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect.poll(async () => (await invoke(win, 'getSettings')).checkNewWords).toBe(false)

    await win.reload()
    await expect(prose(win)).toContainText(ADAMS)
    await win.locator('main header').getByRole('button', { name: 'Generate', exact: true }).click()
    await win.getByRole('button', { name: 'Add below', exact: true }).click()
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId))[0]?.status ?? null, { timeout: 60_000 }).toBe('complete')
    await expect(prose(win)).toContainText('Mara kept her hood low and her left sleeve pinned')
    // Time enough for a check to have come back, had there been one.
    await win.waitForTimeout(2000)
    await expect(prose(win).locator('.aw-repair')).toHaveCount(0)
    expect(await invoke(win, 'listIssues', sceneId)).toEqual([])
    await expect(toasts(win).getByText(/Issues tab|Mended/)).toHaveCount(0)
  } finally {
    await fake.close()
  }
})
