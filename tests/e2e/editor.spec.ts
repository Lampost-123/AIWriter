import type { ElectronApplication, Page } from '@playwright/test'
import { binder, createWorldFromWelcome, expect, invoke, openSettings, test } from './helpers'

/** Closes the window the way Adam does (the X), so pending saves run first, and waits for the app to exit. */
async function closeWindow(app: ElectronApplication): Promise<void> {
  const closed = new Promise<void>((r) => app.once('close', () => r()))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
}

const row = (win: Page, title: string) => binder(win).locator('[data-row]', { hasText: title }).first()
const prose = (win: Page) => win.locator('.scene-prose')
const scroller = (win: Page) => win.locator('main .overflow-y-auto').first()
const scrollTop = (win: Page) => scroller(win).evaluate((el) => el.scrollTop)

/** Adds a scene at the end of the first chapter from the binder, keeping its suggested title. */
async function addScene(win: Page): Promise<void> {
  const chapter = binder(win).locator('[data-row="chapter"]').first()
  await chapter.hover()
  await chapter.getByRole('button', { name: 'Add a scene to this chapter' }).click()
  await win.getByRole('textbox', { name: 'Scene title' }).press('Enter')
}

test('typing goes straight into the page after creating a world and after opening a scene', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  await expect(prose(win)).toBeFocused()
  await win.keyboard.type('abc')
  await expect(prose(win)).toContainText('abc')

  await addScene(win)
  await row(win, 'Scene 1').click()
  await expect(prose(win)).toBeFocused()
  await win.keyboard.type('def')
  await row(win, 'Scene 2').click()
  await expect(prose(win)).toBeFocused()
  await win.keyboard.type('xyz')

  const [story] = await invoke(win, 'listStories')
  const { scenes } = await invoke(win, 'getOutline', story.id)
  await expect.poll(async () => (await invoke(win, 'getScene', scenes[0].id)).text).toBe('abcdef')
  await expect.poll(async () => (await invoke(win, 'getScene', scenes[1].id)).text).toBe('xyz')
})

test('the caret moved by a key stays where it went when the page redraws before the app has heard of the move', async ({ launch }) => {
  // The arrow keys move the caret in the page first; the editor hears of it a moment later. The live checks' underlines
  // (or beat marks, find marks, the reading's highlight) redrawing in that moment once put the caret back, so arrow
  // presses on a busy computer were lost (features/editor/pageCaret.ts). Here a key moves the page's caret and a redraw
  // is sent in the same moment, every time.
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Harbour')
  await win.keyboard.type('The ferry was late again. Mara counted the lamps.')
  const moved = await win.evaluate<{ from: number; to: number; text: string }>(`(() => {
    const view = document.querySelector('.scene-prose').editor.view
    const text = view.dom.querySelector('p').firstChild
    // Shift+Right as the browser carries it out: the key reaches the editor, then the page's selection moves.
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }))
    getSelection().setBaseAndExtent(text, 26, text, 30)
    view.dispatch(view.state.tr.setMeta('aiwriteTestRedraw', true).setMeta('addToHistory', false))
    const { from, to } = view.state.selection
    return { from, to, text: view.state.doc.textBetween(from, to) }
  })()`)
  expect(moved.text).toBe('Mara')
  await expect.poll(() => win.evaluate('String(getSelection())')).toBe('Mara')
  await win.keyboard.type('Nell')
  await expect(prose(win)).toContainText('The ferry was late again. Nell counted the lamps.')
})

test('leaving the page and coming back keeps the place in a long scene', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  const [story] = await invoke(win, 'listStories')
  const { scenes } = await invoke(win, 'getOutline', story.id)
  const para = 'The harbour lamps burned low while the fishermen hauled their nets across the slick stones, and Mara watched the water.'
  await invoke(win, 'saveSceneText', scenes[0].id, null, Array.from({ length: 300 }, (_, i) => `${i + 1}. ${para}`).join('\n\n'))
  // Open it afresh (from another scene) so the page shows the stored text.
  await addScene(win)
  await row(win, 'Scene 1').click()
  await expect(prose(win)).toContainText('300. The harbour')

  await scroller(win).evaluate((el) => (el.scrollTop = 8000))
  await binder(win).getByRole('button', { name: 'Characters' }).click()
  await expect(win.getByRole('heading', { name: 'No characters yet' })).toBeVisible()
  await row(win, 'Scene 1').click()
  await expect(prose(win)).toBeVisible()
  expect(await scrollTop(win)).toBeCloseTo(8000, -1)

  // A different place, through Settings, so an old remembered spot would fail too.
  await scroller(win).evaluate((el) => (el.scrollTop = 12000))
  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(win.getByRole('heading', { level: 1 })).toBeVisible()
  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(prose(win)).toBeVisible()
  expect(await scrollTop(win)).toBeCloseTo(12000, -1)
})

test('a scene title being typed is kept when the window closes before Enter', async ({ launch }) => {
  const first = await launch()
  await createWorldFromWelcome(first.win, 'Alpha')
  await first.win.locator('main header').getByRole('button', { name: 'Scene 1' }).click()
  await first.win.getByRole('textbox', { name: 'Scene title' }).fill('The Knock at the Door')
  await closeWindow(first.app)

  const second = await launch({ dataDir: first.dataDir })
  await expect(binder(second.win)).toBeVisible()
  const [story] = await invoke(second.win, 'listStories')
  const { scenes } = await invoke(second.win, 'getOutline', story.id)
  expect(scenes[0].title).toBe('The Knock at the Door')
  await expect(row(second.win, 'The Knock at the Door')).toBeVisible()
})

test('a scene added from a row menu keeps its name box, even if it opens before the menu has finished closing', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  for (const item of ['Add scene after', 'Rename']) {
    await row(win, 'Scene 1').click({ button: 'right' })
    // The menu hands focus back a moment after it closes. Usually the new scene's name box opens
    // later than that, but not always: make that moment come late every time.
    await win.evaluate(() => {
      const w = globalThis as unknown as { setTimeout: typeof setTimeout; plainTimeout?: typeof setTimeout }
      const plain = (w.plainTimeout = w.setTimeout)
      w.setTimeout = ((fn: () => void, ms?: number) => plain(fn, ms || 300)) as typeof setTimeout
    })
    await win.getByRole('menuitem', { name: item }).click()
    const box = binder(win).getByRole('textbox', { name: 'Scene title' })
    await expect(box).toBeFocused()
    await win.waitForTimeout(500)
    await win.evaluate(() => {
      const w = globalThis as unknown as { setTimeout: typeof setTimeout; plainTimeout?: typeof setTimeout }
      w.setTimeout = w.plainTimeout!
    })
    await expect(box).toBeFocused()
    await win.keyboard.press('Control+A')
    await win.keyboard.type(`From ${item}`)
    await win.keyboard.press('Enter')
    await expect(row(win, `From ${item}`)).toBeVisible()
  }
})

test("the top bar's Saved is the scene's, so it shows only on the writing page", async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  const note = win.locator('header').first().locator('[aria-live]', { hasText: /^Sav/ })
  await win.keyboard.type('A few words.')
  await expect(note).toHaveText('Saved')
  await expect(note).toHaveCSS('opacity', '1')
  // An entry page has its own save note: the bar's goes quiet, and screen readers aren't told "Saved".
  await binder(win).getByRole('button', { name: 'Characters' }).click()
  await expect(win.getByRole('heading', { name: 'No characters yet' })).toBeVisible()
  await expect(note).toHaveCSS('opacity', '0')
  await expect(note.locator('[aria-hidden="true"]')).toHaveText('Saved')
  await row(win, 'Scene 1').click()
  await expect(note).toHaveCSS('opacity', '1')
})

test('emptying a drafted scene puts it back to planned', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  await win.keyboard.type('A few words.')
  const status = win.locator('main header').getByRole('button', { name: /Scene status/ })
  await expect(status).toHaveAccessibleName('Scene status: Drafted')
  await win.keyboard.press('Control+A')
  await win.keyboard.press('Backspace')
  await expect(status).toHaveAccessibleName('Scene status: Planned')
})

test('deletes share one Undo that waits while hovered; Ctrl+Z and Recently deleted bring things back', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  await addScene(win)
  await addScene(win)
  const undo = win.getByRole('button', { name: 'Undo' })
  const toastText = (t: string) => win.locator('[aria-live="polite"]').getByText(t)

  // Delete, then hover the toast: it stays well past its usual time.
  await row(win, 'Scene 2').focus()
  await win.keyboard.press('Delete')
  await expect(toastText('“Scene 2” deleted.')).toBeVisible()
  await toastText('“Scene 2” deleted.').hover()
  await win.waitForTimeout(16_000)
  await expect(undo).toBeVisible()
  await win.mouse.move(10, 400)

  // A second delete joins the same toast.
  await row(win, 'Scene 3').focus()
  await win.keyboard.press('Delete')
  await expect(toastText('2 scenes deleted.')).toBeVisible()
  await expect(undo).toHaveCount(1)

  // Ctrl+Z in the binder brings back the newest; Undo brings back the rest.
  await win.keyboard.press('Control+Z')
  await expect(row(win, 'Scene 3')).toBeVisible()
  await expect(toastText('“Scene 2” deleted.')).toBeVisible()
  await undo.click()
  await expect(row(win, 'Scene 2')).toBeVisible()
  await expect(undo).toHaveCount(0)

  // Once the toast is gone, Recently deleted still has it.
  await row(win, 'Scene 3').focus()
  await win.keyboard.press('Delete')
  await win.getByRole('button', { name: 'Dismiss' }).click()
  await expect(row(win, 'Scene 3')).toHaveCount(0)
  await openSettings(win, 'Recently deleted')
  const list = win.getByRole('list', { name: 'Recently deleted' })
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await expect(list).toContainText('Scene in Book 1 › Chapter 1')
  await list.getByRole('button', { name: 'Restore “Scene 3”' }).click()
  await expect(win.getByText('Nothing deleted lately')).toBeVisible()
  await expect(row(win, 'Scene 3')).toBeVisible()
})
