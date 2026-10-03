// Writing by hand: find and replace. Ctrl+F finds in the open scene (a bar over the page, matches marked, Enter
// and Shift+Enter, Match case and Whole word, Replace and Replace all through the editor so Ctrl+Z undoes them);
// Ctrl+Shift+F finds across the story, lists matches by scene with tick boxes, replaces the ticked ones (the open
// scene's unsaved typing kept), renames the entry in memory when asked, and one Undo puts it all back.
// All the text here is invented for the test.
import type { Page } from '@playwright/test'
import { createWorldFromWelcome, expect, invoke, test } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')
const bar = (win: Page) => win.getByRole('search', { name: 'Find in this scene' })
const storyFind = (win: Page) => win.getByRole('dialog', { name: 'Find and replace in the story' })

async function storyAndScene(win: Page): Promise<{ storyId: string; chapterId: string; sceneId: string }> {
  const [story] = await invoke(win, 'listStories')
  const { chapters, scenes } = await invoke(win, 'getOutline', story.id)
  return { storyId: story.id, chapterId: chapters[0].id, sceneId: scenes[0].id }
}

const savedText = async (win: Page, sceneId: string): Promise<string> => (await invoke(win, 'getScene', sceneId)).text

test('Ctrl+F finds and replaces in the open scene, over the page, and Ctrl+Z puts the words back', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Find in a scene')
  const { sceneId } = await storyAndScene(win)

  await expect(prose(win)).toBeFocused()
  await win.keyboard.type('Mara rode north. Mara’s horse was tired.')
  await win.keyboard.press('Enter')
  await win.keyboard.type('The road was long, and mara sang to Tamara.')
  await expect.poll(() => savedText(win, sceneId)).toContain('Tamara')
  const top = (await prose(win).boundingBox())!.y

  // The bar shows over the page: the words don't move.
  await win.keyboard.press('Control+f')
  await expect(bar(win)).toBeVisible()
  expect((await prose(win).boundingBox())!.y).toBe(top)
  const findBox = bar(win).getByRole('textbox', { name: 'Find' })
  await expect(findBox).toBeFocused()
  await findBox.fill('mara')
  await expect(bar(win).getByText('1 of 4')).toBeVisible()
  await expect(prose(win).locator('.aw-find')).toHaveCount(4)
  await expect(prose(win).locator('.aw-find-current')).toHaveCount(1)

  // Enter and Shift+Enter go through them.
  await findBox.press('Enter')
  await expect(bar(win).getByText('2 of 4')).toBeVisible()
  await findBox.press('Shift+Enter')
  await expect(bar(win).getByText('1 of 4')).toBeVisible()

  // Whole word leaves out Tamara (Mara’s still counts); Match case finds only "mara".
  await bar(win).getByRole('switch', { name: 'Whole word' }).click()
  await expect(bar(win).getByText('1 of 3')).toBeVisible()
  await bar(win).getByRole('switch', { name: 'Match case' }).click()
  await expect(bar(win).getByText('1 of 1')).toBeVisible()
  await bar(win).getByRole('switch', { name: 'Match case' }).click()
  await expect(bar(win).getByText('1 of 3')).toBeVisible()

  // Replace: one at a time, then the rest at once.
  await bar(win).getByRole('textbox', { name: 'Replace with' }).fill('Tobin')
  await bar(win).getByRole('button', { name: 'Replace', exact: true }).click()
  await expect(prose(win)).toContainText('Tobin rode north. Mara’s horse')
  await expect(bar(win).getByText('1 of 2')).toBeVisible()
  await bar(win).getByRole('button', { name: 'Replace all' }).click()
  await expect(toasts(win).getByText(/^Replaced twice in this scene\./)).toBeVisible()
  await expect(prose(win)).toContainText('Tobin rode north. Tobin’s horse was tired.')
  await expect(prose(win)).toContainText('and Tobin sang to Tamara.')
  await expect(bar(win).getByText('No matches')).toBeVisible()
  await expect.poll(() => savedText(win, sceneId)).toBe('Tobin rode north. Tobin’s horse was tired.\n\nThe road was long, and Tobin sang to Tamara.')

  // Straight after Replace all (the keyboard still on the bar), one Ctrl+Z takes it back, and Ctrl+Y does it again.
  await expect.poll(() => bar(win).evaluate((el) => el.contains(el.ownerDocument.activeElement))).toBe(true)
  await win.keyboard.press('Control+z')
  await expect(prose(win)).toContainText('Tobin rode north. Mara’s horse was tired.')
  await expect(prose(win)).toContainText('and mara sang to Tamara.')
  await expect(bar(win).getByText('1 of 2')).toBeVisible()
  await expect.poll(() => savedText(win, sceneId)).toContain('and mara sang')
  await win.keyboard.press('Control+y')
  await expect(prose(win)).toContainText('and Tobin sang to Tamara.')
  await win.keyboard.press('Control+z')
  await expect(prose(win)).toContainText('and mara sang to Tamara.')

  // In the Find box, Ctrl+Z undoes typing there and leaves the page alone.
  const find = bar(win).getByRole('textbox', { name: 'Find' })
  await find.click()
  await find.press('End')
  await find.pressSequentially('x')
  await expect(find).toHaveValue('marax')
  await find.press('Control+z')
  await expect(find).toHaveValue('mara')
  await expect(prose(win)).toContainText('Tobin rode north. Mara’s horse was tired.')

  // Esc closes the bar and the keyboard goes back into the page.
  await find.press('Escape')
  await expect(bar(win)).toBeHidden()
  await expect(prose(win)).toBeFocused()
  await expect(prose(win).locator('.aw-find')).toHaveCount(0)
})

test('Ctrl+Shift+F replaces the ticked matches across the story, renames the character in memory, and one Undo puts everything back', async ({
  launch
}) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Find in a story')
  const { storyId, chapterId, sceneId: first } = await storyAndScene(win)

  // Three scenes over two chapters, one marked done, and a character named Mara.
  await invoke(win, 'updateScene', first, { title: 'The ford' })
  const p = (text: string, bold?: string) => ({
    type: 'paragraph',
    content: bold
      ? [{ type: 'text', text: bold, marks: [{ type: 'bold' }] }, { type: 'text', text }]
      : [{ type: 'text', text }]
  })
  await invoke(win, 'saveSceneText', first, { type: 'doc', content: [p(' crossed the ford.', 'Mara')] }, 'Mara crossed the ford.')
  const second = (await invoke(win, 'createScene', chapterId, { title: 'Night camp' })).id
  await invoke(win, 'saveSceneText', second, { type: 'doc', content: [p('At night Mara’s fire burned low.')] }, 'At night Mara’s fire burned low.')
  const ch2 = (await invoke(win, 'createChapter', storyId, { title: 'The hills' })).id
  const third = (await invoke(win, 'createScene', ch2, { title: 'Morning' })).id
  await invoke(win, 'saveSceneText', third, { type: 'doc', content: [p('Nobody saw Mara go.')] }, 'Nobody saw Mara go.')
  await invoke(win, 'markSceneDone', third)
  const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara' })
  await win.reload()
  await expect(prose(win)).toContainText('Mara crossed the ford.')

  // Writing not saved yet is found and kept.
  await prose(win).click()
  await win.keyboard.press('Control+End')
  await win.keyboard.type(' Mara waved.')
  await win.keyboard.press('Control+Shift+f')
  await expect(storyFind(win)).toBeVisible()
  await storyFind(win).getByRole('textbox', { name: 'Find in the story' }).fill('mara')
  await expect(storyFind(win).getByText('4 matches in 3 scenes.')).toBeVisible()
  const list = storyFind(win).getByRole('list', { name: 'Matches' })
  await expect(list.getByText('Chapter 1, scene 1')).toBeVisible()
  await expect(list.getByText('Chapter 1, scene 2')).toBeVisible()
  await expect(list.getByText('Chapter 2, scene 1')).toBeVisible()

  await storyFind(win).getByRole('textbox', { name: 'Replace with' }).fill('Maren')
  const rename = storyFind(win).getByRole('checkbox', {
    name: 'Also rename the character Mara to Maren in memory (Mara stays as another name)'
  })
  await expect(rename).not.toBeChecked()
  await rename.check()

  // Every match starts ticked; a scene's box ticks all of its own.
  const replaceAll = storyFind(win).getByRole('button', { name: 'Replace all 4' })
  await expect(replaceAll).toBeVisible()
  await storyFind(win).getByRole('checkbox', { name: 'The ford: all its matches' }).uncheck()
  await expect(storyFind(win).getByRole('button', { name: 'Replace 2 of 4' })).toBeVisible()
  await storyFind(win).getByRole('checkbox', { name: 'The ford: all its matches' }).check()
  await replaceAll.click()

  await expect(storyFind(win)).toBeHidden()
  const done = toasts(win).locator('> div', { hasText: 'Replaced 4 times in 3 scenes. Mara is now Maren in memory.' })
  await expect(done).toBeVisible()
  await expect(prose(win)).toContainText('Maren crossed the ford. Maren waved.')
  await expect(prose(win).locator('strong', { hasText: 'Maren' })).toHaveCount(1)
  await expect.poll(() => savedText(win, first)).toBe('Maren crossed the ford. Maren waved.')
  expect(await savedText(win, second)).toBe('At night Maren’s fire burned low.')
  expect(await savedText(win, third)).toBe('Nobody saw Maren go.')
  expect((await invoke(win, 'getScene', third)).status).toBe('done')
  expect(await invoke(win, 'getEntry', mara.id)).toMatchObject({ name: 'Maren', aliases: ['Mara'] })
  const labels = (await invoke(win, 'listSnapshots', second)).snapshots.map((s) => s.label)
  expect(labels).toContain('Before find and replace')
  expect((await invoke(win, 'listSnapshots', first)).snapshots.map((s) => s.label)).toContain('Before find and replace')

  // One Undo puts every scene back, the open one (with the typing) included, and the name.
  await done.getByRole('button', { name: 'Undo' }).click()
  await expect(toasts(win).getByText('Put the words back in 3 scenes. The old name is back in memory.')).toBeVisible()
  await expect(prose(win)).toContainText('Mara crossed the ford. Mara waved.')
  await expect(prose(win).locator('strong', { hasText: 'Mara' })).toHaveCount(1)
  await expect.poll(() => savedText(win, first)).toBe('Mara crossed the ford. Mara waved.')
  expect(await savedText(win, second)).toBe('At night Mara’s fire burned low.')
  expect(await savedText(win, third)).toBe('Nobody saw Mara go.')
  expect(await invoke(win, 'getEntry', mara.id)).toMatchObject({ name: 'Mara', aliases: [] })
})

test('Undo across the story leaves the open scene alone when a new line went in at its start since', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Undo after Enter')
  const { sceneId } = await storyAndScene(win)
  await expect(prose(win)).toBeFocused()
  await win.keyboard.type('Mara walked.')
  await expect.poll(() => savedText(win, sceneId)).toBe('Mara walked.')

  await win.keyboard.press('Control+Shift+f')
  await storyFind(win).getByRole('textbox', { name: 'Find in the story' }).fill('Mara')
  await storyFind(win).getByRole('textbox', { name: 'Replace with' }).fill('Kell')
  await storyFind(win).getByRole('button', { name: 'Replace all 1' }).click()
  const done = toasts(win).locator('> div', { hasText: 'Replaced once in one scene.' })
  await expect(done).toBeVisible()
  await expect(prose(win)).toContainText('Kell walked.')

  // Enter at the very start of the scene, then Undo: the words stay as they are, and the message says why.
  await prose(win).click()
  await win.keyboard.press('Control+Home')
  await win.keyboard.press('Enter')
  await done.getByRole('button', { name: 'Undo' }).click()
  await expect(toasts(win).getByText('“Scene 1” changed since, so it was left as it is.')).toBeVisible()
  await expect(prose(win)).toContainText('Kell walked.')
  await expect(prose(win)).not.toContainText('Mara')
  await expect.poll(() => savedText(win, sceneId)).toBe('Kell walked.')
})

test('a match in the story’s list opens its scene there, with the find bar', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Find and open')
  const { chapterId } = await storyAndScene(win)
  const other = (await invoke(win, 'createScene', chapterId, { title: 'Far off' })).id
  const words = 'The lamp was lit. The lamp went out. The lamp was lit again.'
  await invoke(win, 'saveSceneText', other, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: words }] }] }, words)

  await win.keyboard.press('Control+Shift+f')
  await storyFind(win).getByRole('textbox', { name: 'Find in the story' }).fill('lamp')
  await expect(storyFind(win).getByText('3 matches in one scene.')).toBeVisible()
  // The second match (each shows the words around it).
  await storyFind(win).getByRole('button', { name: /lamp/ }).nth(1).click()
  await expect(storyFind(win)).toBeHidden()
  await expect(prose(win)).toContainText('The lamp went out.')
  await expect(bar(win)).toBeVisible()
  await expect(bar(win).getByText('2 of 3')).toBeVisible()
  await expect(prose(win).locator('.aw-find-current')).toHaveText('lamp')
})
