// "Fill in the whole story" (the story index, 2026-10-19), where Adam looks after the memory, in the New look only
// (Classic is retired): on the desk, What changed has it on the ledger's side; the button asks first with roughly what it
// costs, then fills in every scene not yet filled, with a quiet note when done; with no model yet the dialog says why.
// In the New look's panels the What changed page has it too. Against the fake provider. The world's own look at the
// recent chapters is held off (AIWRITE_INDEX_OPEN_MS), so the fill finds every scene still to do.
import type { Page } from '@playwright/test'
import { expect, invoke, startFake, test, useFakeModel } from './helpers'

const HOLD = { AIWRITE_KEEPER_QUIET_MS: '600000', AIWRITE_INDEX_OPEN_MS: '600000' }
const DESK = { ...HOLD, AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk' }
const sheet = (win: Page) => win.locator('[data-desk-room]')

/** The sample world, open at its first scene. */
async function sampleWorld(win: Page): Promise<void> {
  await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(win, 'openSampleWorld')
  await win.reload()
  await expect(win.locator('.scene-prose')).toBeVisible()
}

/** The desk's What changed page (the Check room's). */
async function openWhatChanged(win: Page): Promise<void> {
  await win
    .getByRole('navigation', { name: 'Rooms' })
    .getByRole('button', { name: /^Check/ })
    .click()
  await sheet(win).locator('[data-desk-sublinks]').getByRole('button', { name: 'What changed' }).click()
}

test('the desk: the button says what it costs, fills in every scene, and says when it is done', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch({ env: DESK })
    await sampleWorld(win)
    await useFakeModel(win, fake)
    const [story] = await invoke(win, 'listStories')
    const outline = await invoke(win, 'getOutline', story.id)
    // Two more scenes with words, not filled in yet (nor read by the memory, which waits out its quiet time).
    for (const text of ['Wren waited on the quay in her grey cloak.', 'Wren crossed the bridge at dusk.']) {
      const scene = await invoke(win, 'createScene', outline.chapters[0].id, {})
      await invoke(win, 'saveSceneText', scene.id, null, text)
    }
    const estimate = await invoke(win, 'estimateStoryFill', story.id)
    expect(estimate.scenes).toBeGreaterThanOrEqual(2)

    await openWhatChanged(win)
    const card = sheet(win).getByRole('region', { name: 'Fill in the whole story' })
    await expect(card).toHaveClass(/lg-fill/)
    await expect(card).toContainText('where everyone ends up')
    await card.getByRole('button', { name: 'Fill in the whole story…' }).click()

    const dialog = win.getByRole('dialog', { name: 'Fill in the whole story' })
    await expect(dialog).toContainText('Keep writing meanwhile')
    await expect(dialog.getByTestId('story-fill-cost')).toContainText(
      `Free with your local model, fake/writer. It reads ${estimate.scenes} scenes`
    )
    await dialog.getByRole('button', { name: 'Fill in', exact: true }).click()
    await expect(dialog).toBeHidden()

    await expect(win.getByText(`“${story.title}” is filled in: ${estimate.scenes} scenes.`)).toBeVisible({ timeout: 30_000 })
    await expect(card.getByRole('button', { name: 'Fill in the whole story…' })).toBeVisible()
    expect((await invoke(win, 'getMemoryStatus')).filling).toBeUndefined()
    // Asked again: nothing left to fill in.
    await card.getByRole('button', { name: 'Fill in the whole story…' }).click()
    await expect(dialog).toContainText('Every scene of this story is filled in already.')
    await dialog.locator('button', { hasText: 'Close' }).click()
    await expect(dialog).toBeHidden()
  } finally {
    await fake.close()
  }
})

test('the desk with no model yet: the dialog says why, and Fill in waits', async ({ launch }) => {
  const { win } = await launch({ env: DESK })
  await sampleWorld(win)
  await openWhatChanged(win)
  await sheet(win).getByRole('button', { name: 'Fill in the whole story…' }).click()
  const dialog = win.getByRole('dialog', { name: 'Fill in the whole story' })
  await expect(dialog.getByTestId('story-fill-cost')).toContainText('Settings › Models')
  await expect(dialog.getByRole('button', { name: 'Fill in', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
})

test('the New look’s panels: What changed has the button too', async ({ launch }) => {
  const { win } = await launch({ env: { ...HOLD, AIWRITE_LOOK: 'new' } })
  await sampleWorld(win)
  await win.getByRole('navigation', { name: 'Areas' }).getByRole('button', { name: 'Check', exact: true }).click()
  await win.locator('[data-area-list]').getByRole('button', { name: /^What changed/ }).click()
  const card = win.getByRole('region', { name: 'Fill in the whole story' })
  await card.getByRole('button', { name: 'Fill in the whole story…' }).click()
  await expect(win.getByRole('dialog', { name: 'Fill in the whole story' })).toBeVisible()
})
