// The critic (Adam, 2026-10-04): a draft that lands is checked in the background with every check, continuity
// included, and the Issues tab shows a report, collapsed at first: when it was checked and how it went; opened, what
// each check looked at (the fake check model says "Looked at <check>.").
import type { Page } from '@playwright/test'
import { createWorldFromWelcome, expect, invoke, openSettings, startFake, test, useFakeModel } from './helpers'

const scenePanel = (win: Page) => win.getByRole('complementary', { name: 'Scene panel' })
const report = (win: Page) => scenePanel(win).getByRole('region', { name: 'Check report' })

test('every draft is checked, and the Issues tab reports what was checked, collapsed at first', async ({ launch }) => {
  const fake = await startFake()
  try {
    // The check starts 3 seconds after the draft ends (15 seconds in the app).
    const { win } = await launch({ env: { AIWRITE_AFTER_DRAFT_MS: '3000', AIWRITE_KEEPER_QUIET_MS: '500' } })
    await createWorldFromWelcome(win, 'Harbour')
    await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the ferry.' })
    await useFakeModel(win, fake)
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id

    await win.locator('main header').getByRole('button', { name: 'Generate', exact: true }).click()
    await expect.poll(async () => (await invoke(win, 'getCheckReport', sceneId))?.after ?? null, { timeout: 60_000 }).toBe('draft')

    await scenePanel(win).getByRole('tab', { name: /^Issues/ }).click()
    const toggle = report(win).getByRole('button', { name: /^Checked after the latest draft · 6 checks · / })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(report(win).locator('[data-report-check]')).toHaveCount(0)
    await toggle.click()
    await expect(report(win).locator('[data-report-check]')).toHaveCount(6)
    await expect(report(win).locator('[data-report-check="continuity"]')).toContainText('Continuity · Looked at continuity.')
    // The continuity check was given where things stood (nothing yet, in a world's first scene) and the story so far.
    const checks = (await invoke(win, 'listGenerations', sceneId)).length
    expect(checks).toBeGreaterThan(0)
  } finally {
    await fake.close()
  }
})

// Adam, 2026-10-17: "a way to disable auto checking and auto critic checks to save on token costs".
test('with automatic checks turned off, neither a draft nor Mark done is checked by itself, and Check still works', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch({ env: { AIWRITE_AFTER_DRAFT_MS: '1500', AIWRITE_KEEPER_QUIET_MS: '500' } })
    await createWorldFromWelcome(win, 'Harbour')
    await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the ferry.' })
    await useFakeModel(win, fake)
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id

    await openSettings(win, 'Models')
    const section = win.locator('section').filter({ has: win.getByRole('heading', { name: 'Automatic checks', exact: true }) })
    for (const name of ['Check a scene when I mark it done', 'Check each draft after it lands', 'Ask for a second opinion on what checks find', 'Let the critic read when writing a whole chapter']) {
      await expect(win.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'true')
    }
    await section.getByRole('button', { name: 'Turn them all off' }).click()
    await expect.poll(async () => {
      const s = await invoke(win, 'getSettings')
      return [s.checkNewWords, s.checkWhenDone, s.checkAfterDraft, s.checkSecondOpinion, s.chapterCritic]
    }).toEqual([false, false, false, false, false])
    await expect(win.getByRole('switch', { name: 'Check each draft after it lands' })).toHaveAttribute('aria-checked', 'false')
    await expect(section.getByRole('button', { name: 'Turn them all on' })).toBeVisible()
    await win.reload()

    await win.locator('main header').getByRole('button', { name: 'Generate', exact: true }).click()
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId))[0]?.status ?? null, { timeout: 60_000 }).toBe('complete')
    await invoke(win, 'markSceneDone', sceneId)
    // Time enough for either check to have started and come back, had there been one.
    await win.waitForTimeout(5000)
    expect(await invoke(win, 'getCheckReport', sceneId)).toBeNull()

    // Asked for, a check still runs.
    await invoke(win, 'startCheck', { runId: 'run-asked', target: { scope: 'scene', id: sceneId }, checks: ['facts', 'knowledge', 'timeline'] })
    await expect.poll(async () => (await invoke(win, 'getCheckReport', sceneId))?.after ?? null, { timeout: 60_000 }).toBe('request')
  } finally {
    await fake.close()
  }
})
