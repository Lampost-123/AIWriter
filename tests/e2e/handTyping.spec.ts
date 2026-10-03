// Writing by hand, walked through the way Adam uses it (all the words here are made up for the test):
//
//  - Smart punctuation as he types: curly quotes and apostrophes, -- to an em dash, a spaced hyphen to a spaced en
//    dash, ... to an ellipsis. Ctrl+Z or Backspace straight after puts back what he typed. Settings › Editor turns
//    it off, at once.
//  - Bold and Italic on the bar over selected words, pressed in while they're on.
//  - The Format menu on the scene's toolbar: Bold, Italic, Block quote, Scene break, Paste as plain text; and
//    Ctrl+Shift+V pasting plain text in the page.
//  - Settings › Appearance › Paragraphs: Book (indented, no gap). Settings › Editor › Typewriter scrolling.
import type { ElectronApplication, Page } from '@playwright/test'
import { binder, createWorldFromWelcome, expect, invoke, openSettings, test } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const para = (win: Page, i: number) => prose(win).locator(':scope > p').nth(i)
const selectionBar = (win: Page) => win.getByRole('toolbar', { name: 'Selected words' })
const sceneRow = (win: Page) => binder(win).locator('[data-row]', { hasText: 'Scene 1' }).first()
const formatMenu = (win: Page) => win.getByRole('menu')

async function backToPage(win: Page): Promise<void> {
  await sceneRow(win).click()
  await expect(prose(win)).toBeVisible()
}

async function resize(app: ElectronApplication, win: Page, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height])
  await expect.poll(async () => Math.abs(((await win.evaluate('window.innerWidth')) as number) - width)).toBeLessThanOrEqual(1)
  await win.waitForTimeout(400)
}

/** Copies words with formatting, as copying from a web page or another program would. */
async function copy(win: Page, text: string, html: string): Promise<void> {
  await win.evaluate(`navigator.clipboard.write([new ClipboardItem({
    'text/plain': new Blob([${JSON.stringify(text)}], { type: 'text/plain' }),
    'text/html': new Blob([${JSON.stringify(html)}], { type: 'text/html' })
  })])`)
}

/** Selects some words in the page (as dragging over them would). */
async function selectWords(win: Page, words: string): Promise<void> {
  await win.evaluate(`(() => {
    const words = ${JSON.stringify(words)}
    const walker = document.createTreeWalker(document.querySelector('.scene-prose'), NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent.indexOf(words)
      if (i < 0) continue
      const r = document.createRange()
      r.setStart(n, i)
      r.setEnd(n, i + words.length)
      const sel = document.getSelection()
      sel.removeAllRanges()
      sel.addRange(r)
      return
    }
    throw new Error('Not in the page: ' + words)
  })()`)
  await win.mouse.up()
}

test('smart punctuation as Adam types; Ctrl+Z or Backspace puts back what he typed; Settings › Editor turns it off', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Saltmarsh')
  await prose(win).click()

  await win.keyboard.type(`"Don't go--wait..." said Wren - and the '90s were over. 'Not yet,' she said.`)
  await expect(para(win, 0)).toHaveText('“Don’t go—wait…” said Wren – and the ’90s were over. ‘Not yet,’ she said.')

  // Ctrl+Z straight after a swap puts back the plain characters; typing on keeps them.
  await win.keyboard.press('Enter')
  await win.keyboard.type('Two--')
  await expect(para(win, 1)).toHaveText('Two—')
  await win.keyboard.press('Control+z')
  await expect(para(win, 1)).toHaveText('Two--')
  await win.keyboard.type(' three')
  await expect(para(win, 1)).toHaveText('Two-- three')

  // Backspace straight after does the same; a second Backspace deletes as usual.
  await win.keyboard.type(' "')
  await expect(para(win, 1)).toHaveText('Two-- three “')
  await win.keyboard.press('Backspace')
  await expect(para(win, 1)).toHaveText('Two-- three "')
  await win.keyboard.press('Backspace')
  await expect(para(win, 1)).toHaveText('Two-- three ')

  // Typing on after a swap, Ctrl+Z takes back the typing first, then the swap.
  await win.keyboard.type('"Hush')
  await expect(para(win, 1)).toHaveText('Two-- three “Hush')
  await win.keyboard.press('Control+z')
  await expect(para(win, 1)).toHaveText('Two-- three “')
  await win.keyboard.press('Control+z')
  await expect(para(win, 1)).toHaveText('Two-- three "')

  // Off in Settings › Editor: straight quotes from then on, without a restart.
  await openSettings(win, 'Editor')
  const smart = win.getByRole('switch', { name: 'Smart punctuation' })
  await expect(smart).toBeChecked()
  await expect(win.getByRole('switch', { name: 'Typewriter scrolling' })).not.toBeChecked()
  await smart.click()
  await expect(smart).not.toBeChecked()
  await expect.poll(async () => (await invoke(win, 'getSettings')).editor.smartPunctuation).toBe(false)
  await backToPage(win)
  await prose(win).click()
  await win.keyboard.press('Control+End')
  await win.keyboard.press('Enter')
  await win.keyboard.type(`"Plain--it's plain..."`)
  await expect(para(win, 2)).toHaveText(`"Plain--it's plain..."`)
})

test('Bold and Italic on the selected words bar; the Format menu; paste as plain text', async ({ launch }) => {
  const { app, win } = await launch()
  await resize(app, win, 1400, 900)
  await createWorldFromWelcome(win, 'Saltmarsh')
  await prose(win).click()
  await win.keyboard.type('The lantern swung in the wind.')

  // The bar over selected words starts with Bold and Italic, pressed in while they're on.
  await selectWords(win, 'lantern')
  const bar = selectionBar(win)
  await expect(bar).toBeVisible()
  const bold = bar.getByRole('button', { name: 'Bold' })
  const italic = bar.getByRole('button', { name: 'Italic' })
  await expect(bold).toHaveAttribute('aria-pressed', 'false')
  await expect(bold).toHaveAttribute('title', 'Bold (Ctrl+B)')
  await bold.click()
  await expect(prose(win).locator('strong')).toHaveText('lantern')
  await expect(bold).toHaveAttribute('aria-pressed', 'true')
  await italic.click()
  await expect(prose(win).locator('em')).toHaveText('lantern')
  await expect(italic).toHaveAttribute('aria-pressed', 'true')
  // Pressed again, it comes off; the words stay selected and the caret stays in the page.
  await bold.click()
  await expect(prose(win).locator('strong')).toHaveCount(0)
  await expect(bold).toHaveAttribute('aria-pressed', 'false')
  await expect(prose(win)).toBeFocused()
  await win.keyboard.press('Escape')

  // The Format menu: Bold for what is typed next, ticked while it's on.
  await win.keyboard.press('Control+End')
  const format = win.getByRole('button', { name: 'Format' })
  await format.click()
  const menu = formatMenu(win)
  await expect(menu.getByRole('menuitemcheckbox', { name: /Bold/ })).toHaveAttribute('aria-checked', 'false')
  await expect(menu.getByRole('menuitemcheckbox', { name: /Bold/ })).toContainText('Ctrl+B')
  await expect(menu.getByRole('menuitem', { name: /Paste as plain text/ })).toContainText('Ctrl+Shift+V')
  await menu.getByRole('menuitemcheckbox', { name: /Bold/ }).click()
  await expect(menu).toBeHidden()
  await expect(prose(win)).toBeFocused()
  await win.keyboard.type(' Loud')
  await expect(prose(win).locator('strong')).toHaveText(' Loud')
  await format.click()
  await expect(menu.getByRole('menuitemcheckbox', { name: /Bold/ })).toHaveAttribute('aria-checked', 'true')
  await menu.getByRole('menuitemcheckbox', { name: /Bold/ }).click()
  await win.keyboard.type(' quiet.')
  await expect(para(win, 0)).toHaveText('The lantern swung in the wind. Loud quiet.')
  await expect(prose(win).locator('strong')).toHaveText(' Loud')

  // Block quote, ticked while the caret is in one, and a scene break.
  await win.keyboard.press('Enter')
  await win.keyboard.type('A line from an old song.')
  await format.click()
  await menu.getByRole('menuitemcheckbox', { name: /Block quote/ }).click()
  await expect(prose(win).locator('blockquote')).toHaveText('A line from an old song.')
  await format.click()
  await expect(menu.getByRole('menuitemcheckbox', { name: /Block quote/ })).toHaveAttribute('aria-checked', 'true')
  await win.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await prose(win).locator('blockquote').click()
  await win.keyboard.press('End')
  await win.keyboard.press('Enter')
  await win.keyboard.press('Enter')
  await format.click()
  await menu.getByRole('menuitem', { name: 'Scene break' }).click()
  await expect(prose(win).locator('hr')).toHaveCount(1)
  await expect(prose(win)).toBeFocused()

  // Ctrl+Shift+V: words copied with formatting come in plain, each line a paragraph.
  // Nothing in the words is turned into formatting either: *stars* stay stars.
  await copy(win, 'Copied *words*\nA second line', '<p><b>Copied</b> <i>*words*</i></p><p><b>A second line</b></p>')
  await win.keyboard.type('Pasted: ')
  await win.keyboard.press('Control+Shift+V')
  await expect(prose(win).locator(':scope > p', { hasText: 'Pasted: Copied *words*' })).toHaveCount(1)
  await expect(prose(win).locator(':scope > p', { hasText: 'A second line' })).toHaveCount(1)
  await expect(prose(win).locator(':scope > p', { hasText: 'Pasted:' }).locator('strong, em')).toHaveCount(0)
  await expect(prose(win).locator(':scope > p', { hasText: 'A second line' }).locator('strong, em')).toHaveCount(0)
  // An ordinary Ctrl+V still keeps the formatting.
  await win.keyboard.press('Enter')
  await win.keyboard.press('Control+v')
  await expect(prose(win).locator('strong', { hasText: 'Copied' })).toHaveCount(1)

  // Format › Paste as plain text reads what was copied itself.
  await copy(win, 'From the menu', '<em>From the menu</em>')
  await win.keyboard.press('Enter')
  await format.click()
  await menu.getByRole('menuitem', { name: /Paste as plain text/ }).click()
  await expect(prose(win).locator(':scope > p', { hasText: 'From the menu' })).toHaveCount(1)
  await expect(prose(win).locator('em', { hasText: 'From the menu' })).toHaveCount(0)
  await expect(prose(win)).toBeFocused()
})

test('Book paragraphs in Settings › Appearance, and typewriter scrolling in Settings › Editor', async ({ launch }) => {
  const { app, win } = await launch()
  await resize(app, win, 1280, 800)
  await createWorldFromWelcome(win, 'Saltmarsh')
  await prose(win).click()
  await win.keyboard.type('The first paragraph of the scene.')
  await win.keyboard.press('Enter')
  await win.keyboard.type('The second, which follows it.')
  await win.keyboard.press('Enter')
  await win.keyboard.type('---')
  await win.keyboard.type('After the break.')
  await win.keyboard.press('Enter')
  await win.keyboard.type('And one more.')
  await expect(prose(win).locator('hr')).toHaveCount(1)
  // Written as text: this file is typed for Node, not the window.
  const style = (i: number, prop: string): Promise<string> =>
    win.evaluate<string>(
      `getComputedStyle(document.querySelectorAll('.scene-prose > p')[${i}]).getPropertyValue(${JSON.stringify(prop)})`
    )

  // Spaced, as before: a gap, no indent.
  expect(await style(1, 'text-indent')).toBe('0px')
  expect(parseFloat(await style(0, 'margin-bottom'))).toBeGreaterThan(5)

  await openSettings(win, 'Appearance')
  await win.getByLabel('Paragraphs').click()
  await win.getByRole('option', { name: /Book/ }).click()
  await expect.poll(async () => (await invoke(win, 'getSettings')).editor.paragraphStyle).toBe('book')
  await backToPage(win)
  // Book: no gap; indented, but not the first paragraph, nor the one after a scene break.
  expect(await style(0, 'margin-bottom')).toBe('0px')
  expect(await style(0, 'text-indent')).toBe('0px')
  expect(parseFloat(await style(1, 'text-indent'))).toBeGreaterThan(10)
  expect(await style(2, 'text-indent')).toBe('0px')
  expect(parseFloat(await style(3, 'text-indent'))).toBeGreaterThan(10)

  // Typewriter scrolling: the line being typed stays about 40% of the way down the page.
  await openSettings(win, 'Editor')
  await win.getByRole('switch', { name: 'Typewriter scrolling' }).click()
  await expect.poll(async () => (await invoke(win, 'getSettings')).editor.typewriter).toBe(true)
  await backToPage(win)
  await prose(win).click()
  await win.keyboard.press('Control+End')
  for (let i = 0; i < 30; i++) {
    await win.keyboard.press('Enter')
    await win.keyboard.type(`Line ${i + 1} of the long night.`)
  }
  const where = (): Promise<number> =>
    win.evaluate<number>(`(() => {
      const scroller = document.querySelector('.scene-prose').closest('.overflow-y-auto')
      const box = scroller.getBoundingClientRect()
      const caret = document.getSelection().getRangeAt(0).getBoundingClientRect()
      return (caret.top - box.top) / scroller.clientHeight
    })()`)
  await expect.poll(async () => Math.abs((await where()) - 0.4)).toBeLessThan(0.06)
  // It stays there line after line.
  for (let i = 0; i < 5; i++) {
    await win.keyboard.press('Enter')
    await win.keyboard.type('Still typing.')
  }
  await expect.poll(async () => Math.abs((await where()) - 0.4)).toBeLessThan(0.06)
})
