// Recall in the Cast tab (Adam, 2026-10-04): where things stand as the scene ends. Worked out on its own once the
// memory has read the scene (the fake memory model says who the scene names is "in the scene", wearing the cloak it
// mentions, each with the words that show it); a value Adam changes is kept; a character he takes out goes; when the
// scene's words change, it says it is out of date until read again. At the cursor (Adam, 2026-10-07): where things
// stand at that point in the scene, read on from the checkpoint before it.
import type { Page } from '@playwright/test'
import { createWorldFromWelcome, expect, invoke, startFake, test, useFakeModel } from './helpers'

// The memory reads the scene as soon as there is a model, and not again on its own while a test runs.
const QUIET = { env: { AIWRITE_KEEPER_QUIET_MS: '600000' } }

const scenePanel = (win: Page) => win.getByRole('complementary', { name: 'Scene panel' })
const recall = (win: Page) => scenePanel(win).getByRole('region', { name: 'Recall' })

test('Recall: worked out, changed by hand, a character taken out, and out of date when the words change', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch(QUIET)
    await createWorldFromWelcome(win, 'Harbour')
    await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the ferry.' })
    await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'A ferryman.' })
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    await invoke(win, 'saveSceneText', sceneId, null, 'Mara stood at the rail in her grey cloak. Tobin watched. The door was barred.')
    await useFakeModel(win, fake)

    // Worked out on its own once the memory has read the scene, each value with the words it came from: each piece of
    // clothing and each thing in the place on its own line.
    await scenePanel(win).getByRole('tab', { name: 'Cast' }).click()
    const mara = recall(win).locator('[data-recall-character="Mara"]')
    await expect(mara).toContainText('in the scene', { timeout: 30_000 })
    await expect(mara.getByRole('button', { name: /^Wearing: grey cloak on/ })).toHaveAttribute(
      'title',
      'From the words: “in her grey cloak”'
    )
    await expect(recall(win).locator('[data-recall-character="Tobin"]')).toBeVisible()
    await expect(recall(win)).toContainText('evening')
    const things = recall(win).locator('[data-recall-things]')
    await expect(things.getByRole('button', { name: /^the door: barred/ })).toHaveAttribute(
      'title',
      'From the words: “The door was barred”'
    )

    // Adam changes one piece of what Mara wears, and adds another: kept, and said to be his.
    await mara.getByRole('button', { name: /^Wearing: grey cloak/ }).click()
    await mara.getByRole('textbox', { name: 'Wearing' }).fill('grey cloak off, over the rail')
    await mara.getByRole('textbox', { name: 'Wearing' }).press('Enter')
    await expect(mara.getByRole('button', { name: /^Wearing: grey cloak off, over the rail/ })).toBeVisible()
    await expect(recall(win)).toContainText('Includes your changes.')
    await mara.getByRole('button', { name: 'Add a piece of clothing' }).click()
    await mara.getByRole('textbox', { name: 'Add a piece of clothing' }).fill('boots on')
    await mara.getByRole('textbox', { name: 'Add a piece of clothing' }).press('Enter')
    await expect(mara.getByRole('button', { name: /^Wearing: boots on/ })).toBeVisible()
    expect((await invoke(win, 'getRecall', sceneId)).state?.characters.find((c) => c.name === 'Mara')?.clothes).toEqual([
      { name: 'grey cloak', state: 'off, over the rail' },
      { name: 'boots', state: 'on' }
    ])

    // And a thing in the place: the door unbarred, a lamp added, and taken out again (left empty).
    await things.getByRole('button', { name: /^the door: barred/ }).click()
    await things.getByRole('textbox', { name: 'the door' }).fill('open')
    await things.getByRole('textbox', { name: 'the door' }).press('Enter')
    await expect(things.getByRole('button', { name: /^the door: open/ })).toBeVisible()
    await things.getByRole('button', { name: 'Add a thing' }).click()
    await things.getByRole('textbox', { name: 'Add a thing' }).fill('the lamp: lit')
    await things.getByRole('textbox', { name: 'Add a thing' }).press('Enter')
    await expect(things.getByRole('button', { name: /^the lamp: lit/ })).toBeVisible()
    await things.getByRole('button', { name: /^the lamp: lit/ }).click()
    await things.getByRole('textbox', { name: 'the lamp' }).fill('')
    await things.getByRole('textbox', { name: 'the lamp' }).press('Enter')
    await expect(things.getByRole('button', { name: /^the lamp/ })).toHaveCount(0)
    expect((await invoke(win, 'getRecall', sceneId)).state?.things).toEqual([{ name: 'the door', state: 'open' }])

    // Tobin taken out.
    await recall(win).getByRole('button', { name: 'Take Tobin out' }).click()
    await expect(recall(win).locator('[data-recall-character="Tobin"]')).toHaveCount(0)

    // The words change: out of date, and read again it follows the new words (Adam's changes go with the old ones).
    // The page saves the scene it shows once, about a second after showing it; wait for that, or it can land after the
    // new words below and put the old ones back.
    await expect.poll(async () => (await invoke(win, 'getScene', sceneId)).doc, { timeout: 15_000 }).not.toBeNull()
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

test('Recall at the cursor: where things stand at that point, read on from the checkpoint before it', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch(QUIET)
    await createWorldFromWelcome(win, 'Harbour')
    await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the ferry.' })
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    await invoke(win, 'saveSceneText', sceneId, null, 'Mara stood at the rail in her grey cloak.')
    await useFakeModel(win, fake)
    await scenePanel(win).getByRole('tab', { name: 'Cast' }).click()
    await expect(recall(win).locator('[data-recall-character="Mara"]')).toContainText('grey cloak', { timeout: 30_000 })

    // At the end of the words read so far: worked out there, to read, not to change.
    await recall(win).getByRole('button', { name: 'At the cursor' }).click()
    await expect(recall(win).getByRole('heading')).toHaveText('Recall: at the cursor')
    await win.locator('.scene-prose p').first().click()
    await win.keyboard.press('End')
    const mara = recall(win).locator('[data-recall-character="Mara"]')
    await expect(recall(win).locator('[data-recall-at="exact"]')).toBeVisible()
    await expect(mara).toContainText('grey cloak')
    await expect(mara.getByRole('button')).toHaveCount(0)

    // Further on, past what was read: the nearest point before it until worked out here, from only the new words.
    await win.keyboard.press('Enter')
    await win.keyboard.type('Mara came back in her blue cloak.')
    await expect(recall(win).locator('[data-recall-at="earlier"]')).toBeVisible()
    await expect(mara).toContainText('grey cloak')
    await recall(win).getByRole('button', { name: 'Work it out here' }).click()
    await expect(recall(win).locator('[data-recall-at="exact"]')).toBeVisible()
    await expect(mara).toContainText('blue cloak')
    await expect(recall(win).getByRole('button', { name: 'Work it out here' })).toHaveCount(0)

    // Back to the scene's end.
    await recall(win).getByRole('button', { name: 'Scene end' }).click()
    await expect(recall(win).getByRole('heading')).toHaveText('Recall: as this scene ends')
  } finally {
    await fake.close()
  }
})
