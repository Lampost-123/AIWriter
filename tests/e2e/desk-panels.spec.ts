// The desk's panels and menus behave alike (UI polish, 2026-10-21): Esc closes Ask the world when its box is empty, a
// scene's right-click menu opens where the click was, Ctrl+H opens Replace, and Ask in focus mode never covers the words.
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, invoke, test, type LaunchOptions } from './helpers'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk' }
const top = (win: Page) => win.locator('[data-desk-topbar]')
const askBox = (win: Page) => win.getByPlaceholder(/Ask, brainstorm/)
const askClose = (win: Page) => win.getByRole('button', { name: 'Close Ask the world' })

async function sampleWorld(
  launch: (o?: LaunchOptions) => Promise<{ app: ElectronApplication; win: Page; dataDir: string }>
): Promise<{ app: ElectronApplication; win: Page }> {
  const a = await launch({ env: DESK })
  await expect(a.win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(a.win, 'openSampleWorld')
  await a.win.reload()
  await expect(a.win.locator('.scene-prose')).toContainText('A hundred and twelve steps to the lamp room.')
  await a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
  await expect.poll(async () => Math.abs(((await a.win.evaluate('innerWidth')) as number) - 1440)).toBeLessThanOrEqual(1)
  return a
}

test('Esc closes Ask the world when its box is empty, never a question being written', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  await top(win).getByRole('button', { name: 'Ask the world' }).click()
  await expect(askBox(win)).toBeFocused()
  // Words in the box: Esc leaves them, and Ask, where they are.
  await askBox(win).fill('How old is Wren?')
  await win.keyboard.press('Escape')
  await expect(askClose(win)).toBeVisible()
  await expect(askBox(win)).toHaveValue('How old is Wren?')
  // Empty: Esc closes it, and the keyboard goes back to the page.
  await askBox(win).fill('')
  await win.keyboard.press('Escape')
  await expect(askClose(win)).toBeHidden()
  await expect(win.locator('.scene-prose')).toBeFocused()
})

test('in focus mode Ask the world sits beside the page, never over its words', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  await top(win).getByRole('button', { name: 'Ask the world' }).click()
  await expect(askClose(win)).toBeVisible()
  await win.locator('.scene-prose').click()
  await win.keyboard.press('F11')
  await expect.poll(() => win.evaluate<boolean>("'focus' in document.documentElement.dataset")).toBe(true)
  await expect
    .poll(async () => {
      const [words, side] = [(await win.locator('.desk-sheet .scene-prose').boundingBox())!, (await win.locator('aside.desk-drawer').boundingBox())!]
      return Math.round(side.x - (words.x + words.width))
    })
    .toBeGreaterThanOrEqual(8)
  await win.keyboard.press('F11')
})

test('in focus mode the scene panel left open makes no room: the page sits in the middle', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  await top(win).getByRole('button', { name: 'Details' }).click()
  await expect(win.locator('aside.desk-drawer')).toBeVisible()
  await win.locator('.scene-prose').click()
  await win.keyboard.press('F11')
  await expect.poll(() => win.evaluate<boolean>("'focus' in document.documentElement.dataset")).toBe(true)
  await expect
    .poll(async () => {
      const sheet = (await win.locator('.desk-sheet').boundingBox())!
      return Math.abs(Math.round(sheet.x + sheet.width / 2 - 720))
    })
    .toBeLessThanOrEqual(2)
  await win.keyboard.press('F11')
})

test('a scene’s right-click menu opens where the click was', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  const row = win.getByRole('complementary', { name: 'Chapters and scenes' }).getByRole('treeitem', { name: /Low Tide/ })
  const box = (await row.boundingBox())!
  const at = { x: box.x + 40, y: box.y + box.height / 2 }
  await win.mouse.click(at.x, at.y, { button: 'right' })
  const menu = win.getByRole('menu')
  await expect(menu).toBeVisible()
  const m = (await menu.boundingBox())!
  expect(Math.abs(m.x - at.x)).toBeLessThanOrEqual(8)
  expect(Math.abs(m.y - at.y)).toBeLessThanOrEqual(8)
  await win.keyboard.press('Escape')
})

test('Ctrl+H opens the find bar with the keyboard in Replace with; Ctrl+F in Find', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  await win.locator('.scene-prose').click()
  await win.keyboard.press('Control+h')
  await expect(win.getByRole('textbox', { name: 'Replace with' })).toBeFocused()
  await win.keyboard.press('Control+f')
  await expect(win.getByRole('textbox', { name: 'Find', exact: true })).toBeFocused()
})
