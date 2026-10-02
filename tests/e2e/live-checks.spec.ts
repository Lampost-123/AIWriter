// The live checks (milestone 5): a phrase to avoid, a misspelt name and a word used too often nearby are
// underlined as Adam writes; the card over each puts a name right (one Ctrl+Z step), asks the AI tools to
// rewrite a sentence, or marks the flag as intended, which keeps it hidden after the scene is opened again
// and after the app restarts. Against the fake AI server for Rewrite (tests/fake-provider/m4/edits.mjs).
import type { Page } from '@playwright/test'
import { binder, closeWindow, createWorldFromWelcome, expect, invoke, startFake, test } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const paras = (win: Page) => prose(win).locator('p')
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')
const flags = (win: Page, kind: string) => prose(win).locator(`.aw-live-${kind}`)
const card = (win: Page) => win.locator('[data-live-card]')
const row = (win: Page, title: string) => binder(win).locator('[data-row]', { hasText: title }).first()

const P1 = 'Suddenly the door opened and Marra stepped in.'
const P2 = 'The dark hall was cold. A dark wind moved through the dark trees, and nobody spoke.'
const TEXT = [P1, P2]

/** The memory waits long after any change, so the only AI calls are the ones the test makes. */
const QUIET = { env: { AIWRITE_KEEPER_QUIET_MS: '600000' } }

test('underlines a phrase to avoid, a misspelt name and a repeated word; puts the name right, rewrites, and ignores for good', async ({
  launch
}) => {
  const fake = await startFake()
  try {
    const first = await launch(QUIET)
    const { win } = first
    await createWorldFromWelcome(win, 'Alpha')
    const [story] = await invoke(win, 'listStories')
    const { scenes, chapters } = await invoke(win, 'getOutline', story.id)
    const sceneId = scenes[0].id
    await invoke(win, 'createScene', chapters[0].id, { title: 'Scene 2' })
    await invoke(win, 'createEntry', 'character', { name: 'Mara' })
    const world = (await invoke(win, 'getWorld'))!
    await invoke(win, 'updateWorld', { style: { ...world.style, avoidPhrases: ['suddenly'] } })
    const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
    await invoke(win, 'updateSettings', {
      models: { writer: { providerId: p.id, modelId: 'fake/writer', label: 'fake/writer', contextLength: 32000, promptPrice: null, completionPrice: null } }
    })
    await invoke(win, 'saveSceneText', sceneId, null, TEXT.join('\n\n'))
    await win.reload()
    await expect(paras(win)).toHaveText(TEXT)

    // Each kind is underlined in its own way.
    await expect(flags(win, 'spelling')).toHaveText(['Marra'])
    await expect(flags(win, 'phrase')).toHaveText(['Suddenly'])
    await expect(flags(win, 'repetition')).toHaveText(['dark', 'dark'])

    // Change to Mara puts just those letters right, and one Ctrl+Z takes it back.
    await flags(win, 'spelling').hover()
    await expect(card(win)).toContainText('“Marra” looks like a misspelling of Mara.')
    await card(win).getByRole('button', { name: 'Change to Mara' }).click()
    await expect(card(win)).toHaveCount(0)
    await expect(paras(win).first()).toHaveText('Suddenly the door opened and Mara stepped in.')
    await expect(flags(win, 'spelling')).toHaveCount(0)
    await win.keyboard.press('Control+z')
    await expect(paras(win).first()).toHaveText(P1)
    await expect(flags(win, 'spelling')).toHaveText(['Marra'])
    await win.keyboard.press('Control+y')
    await expect(paras(win).first()).toHaveText('Suddenly the door opened and Mara stepped in.')

    // Rewrite asks the AI tools for that sentence, as a change to accept or reject.
    await win.mouse.move(0, 0)
    await flags(win, 'phrase').hover()
    await expect(card(win)).toContainText('“suddenly” is on your list of phrases to avoid.')
    await card(win).getByRole('button', { name: 'Rewrite' }).click()
    const change = win.getByRole('group', { name: 'The AI’s change' })
    const struck = () => prose(win).locator('.aw-sugg-old').allTextContents().then((t) => t.join(''))
    await expect.poll(struck).toBe('Suddenly the door opened and Mara stepped in.')
    await expect(change.getByRole('button', { name: /^Reject/ })).toBeVisible()
    await change.getByRole('button', { name: /^Reject/ }).click()
    await expect(prose(win).locator('.aw-sugg-old')).toHaveCount(0)
    await expect(flags(win, 'phrase')).toHaveText(['Suddenly'])

    // Ignore hides it at once; Undo brings it back.
    await win.mouse.move(0, 0)
    await flags(win, 'repetition').first().hover()
    await expect(card(win)).toContainText('“dark” is used 3 times in a few paragraphs.')
    await card(win).getByRole('button', { name: 'Ignore' }).click()
    await expect(flags(win, 'repetition')).toHaveCount(0)
    const ignored = toasts(win).locator('> div', { hasText: 'Marked “dark” as intended. It won’t be flagged again in this scene.' })
    await expect(ignored).toBeVisible()
    await ignored.getByRole('button', { name: 'Undo' }).click()
    await expect(flags(win, 'repetition')).toHaveText(['dark', 'dark'])

    // Ignoring the phrase to avoid keeps it hidden.
    await win.mouse.move(0, 0)
    await flags(win, 'phrase').hover()
    await card(win).getByRole('button', { name: 'Ignore' }).click()
    await expect(flags(win, 'phrase')).toHaveCount(0)
    await expect(toasts(win).getByText('Marked “Suddenly” as intended. It won’t be flagged again in this paragraph.')).toBeVisible()

    // Opening another scene and coming back: still hidden, while the others are still there.
    await row(win, 'Scene 2').click()
    await expect(paras(win)).toHaveText([''])
    await row(win, 'Scene 1').click()
    await expect(flags(win, 'repetition')).toHaveText(['dark', 'dark'])
    await expect(flags(win, 'phrase')).toHaveCount(0)

    // And after a restart.
    await closeWindow(first.app)
    const again = await launch({ dataDir: first.dataDir, ...QUIET })
    await expect(paras(again.win)).toHaveText(['Suddenly the door opened and Mara stepped in.', P2])
    await expect(flags(again.win, 'repetition')).toHaveText(['dark', 'dark'])
    await expect(flags(again.win, 'phrase')).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

test('the card opens from the keyboard and takes Tab, and no underline shows while text is typed into a name', async ({ launch }) => {
  const { win } = await launch(QUIET)
  await createWorldFromWelcome(win, 'Alpha')
  const [story] = await invoke(win, 'listStories')
  const { scenes } = await invoke(win, 'getOutline', story.id)
  await invoke(win, 'createEntry', 'character', { name: 'Mara' })
  await invoke(win, 'saveSceneText', scenes[0].id, null, 'The door opened and Marra stepped in.')
  await win.reload()
  await expect(flags(win, 'spelling')).toHaveText(['Marra'])

  // A click into the word shows its card; Tab goes into it and Enter presses its first button.
  await flags(win, 'spelling').click()
  await expect(card(win)).toBeVisible()
  await win.keyboard.press('Tab')
  await expect(card(win).getByRole('button', { name: 'Change to Mara' })).toBeFocused()
  await win.keyboard.press('Enter')
  await expect(paras(win)).toHaveText(['The door opened and Mara stepped in.'])
  await expect(prose(win)).toBeFocused()

  // A name being typed isn't flagged half-way; once the caret moves on, a misspelling is.
  await prose(win).press('End')
  await win.keyboard.type(' Then Mar')
  await win.waitForTimeout(700)
  await expect(flags(win, 'spelling')).toHaveCount(0)
  await win.keyboard.type('a waved.')
  await win.waitForTimeout(700)
  await expect(flags(win, 'spelling')).toHaveCount(0)
  await win.keyboard.type(' Maar')
  await win.waitForTimeout(700)
  await expect(flags(win, 'spelling')).toHaveCount(0)
  for (let i = 0; i < 5; i++) await win.keyboard.press('ArrowLeft')
  await expect(flags(win, 'spelling')).toHaveText(['Maar'])
})
