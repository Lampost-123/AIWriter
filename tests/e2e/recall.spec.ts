// Recall in the Cast tab (Adam, 2026-10-04): where things stand as the scene ends. Worked out on request (the fake
// memory model says who the scene names is "in the scene", wearing the cloak it mentions); a value Adam changes is
// kept; a character he takes out goes; when the scene's words change, it says it is out of date until read again.
import type { Page } from '@playwright/test'
import { createWorldFromWelcome, expect, invoke, startFake, test, useFakeModel } from './helpers'

const scenePanel = (win: Page) => win.getByRole('complementary', { name: 'Scene panel' })
const recall = (win: Page) => scenePanel(win).getByRole('region', { name: 'Recall' })

test('Recall: worked out, changed by hand, a character taken out, and out of date when the words change', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the ferry.' })
    await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'A ferryman.' })
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    await invoke(win, 'saveSceneText', sceneId, null, 'Mara stood at the rail in her grey cloak. Tobin watched.')
    await useFakeModel(win, fake)

    await scenePanel(win).getByRole('tab', { name: 'Cast' }).click()
    await expect(recall(win)).toContainText('Not worked out yet.')
    await recall(win).getByRole('button', { name: 'Work it out' }).click()
    const mara = recall(win).locator('[data-recall-character="Mara"]')
    await expect(mara).toContainText('in the scene')
    await expect(mara).toContainText('grey cloak')
    await expect(recall(win).locator('[data-recall-character="Tobin"]')).toBeVisible()
    await expect(recall(win)).toContainText('evening')

    // Adam changes what Mara wears: kept, and said to be his.
    await mara.getByRole('button', { name: /^Wearing: grey cloak/ }).click()
    await mara.getByRole('textbox', { name: 'Wearing' }).fill('a red coat')
    await mara.getByRole('textbox', { name: 'Wearing' }).press('Enter')
    await expect(mara).toContainText('a red coat')
    await expect(recall(win)).toContainText('Includes your changes.')
    expect((await invoke(win, 'getRecall', sceneId)).state?.characters.find((c) => c.name === 'Mara')?.wearing).toBe('a red coat')

    // Tobin taken out.
    await recall(win).getByRole('button', { name: 'Take Tobin out' }).click()
    await expect(recall(win).locator('[data-recall-character="Tobin"]')).toHaveCount(0)

    // The words change: out of date, and read again it follows the new words (Adam's changes go with the old ones).
    await invoke(win, 'saveSceneText', sceneId, null, 'Mara stood at the rail in her blue cloak.')
    expect((await invoke(win, 'getRecall', sceneId)).current).toBe(false)
    await scenePanel(win).getByRole('tab', { name: 'Context' }).click()
    await scenePanel(win).getByRole('tab', { name: 'Cast' }).click()
    await expect(recall(win).locator('[data-recall-stale]')).toBeVisible()
    await recall(win).getByRole('button', { name: 'Read again' }).click()
    await expect(recall(win).locator('[data-recall-stale]')).toHaveCount(0)
    await expect(mara).toContainText('blue cloak')
    await expect(recall(win)).not.toContainText('Includes your changes.')
  } finally {
    await fake.close()
  }
})
