// The right-click menu in the page has AI Write's own actions, the same as the bar over selected words: with nothing
// selected, Ask about this paragraph; on selected words, Ask about this, Edit this and the AI tools under Rewrite
// (one of them run from the menu writes its tracked change into the page); Cut, Copy and Paste stay at the foot.
// Against the fake AI server (tests/fake-provider/m4/edits.mjs).
import type { ElectronApplication, Page } from '@playwright/test'
import { createWorldFromWelcome, expect, invoke, startFake, test } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const paras = (win: Page) => prose(win).locator('p')
const askBox = (win: Page) => win.getByRole('region', { name: 'Ask the world' }).getByRole('textbox', { name: 'Ask about your world' })
const change = (win: Page) => win.getByRole('group', { name: 'The AI’s change' })

const P1 = 'The tavern was warm and loud. Rain hammered the shutters.'
const P2 = 'Mara pushed through the crowd to the back table.'

/** The right-click menu isn't shown on screen in tests: the app's menu is kept for the test to read and click. */
async function catchMenus(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Menu }) => {
    Menu.prototype.popup = function (this: Electron.Menu) {
      ;(globalThis as unknown as { lastMenu: Electron.Menu | null }).lastMenu = this
    }
  })
}

const forget = (app: ElectronApplication): Promise<void> =>
  app.evaluate(() => {
    ;(globalThis as unknown as { lastMenu: unknown }).lastMenu = null
  })

/** The labels of the menu last shown (a submenu's, by the labels leading to it); separators are "---". */
const menuLabels = (app: ElectronApplication, path: string[] = []): Promise<string[] | null> =>
  app.evaluate((_e, path) => {
    let m = (globalThis as unknown as { lastMenu?: Electron.Menu | null }).lastMenu
    for (const label of path) m = m?.items.find((i) => i.label === label)?.submenu
    return m ? m.items.map((i) => (i.type === 'separator' ? '---' : i.label)) : null
  }, path)

/** Clicks an item in the menu last shown (inside submenus, by the labels leading to it). */
const pick = (app: ElectronApplication, path: string[]): Promise<void> =>
  app.evaluate((_e, path) => {
    let items = (globalThis as unknown as { lastMenu: Electron.Menu }).lastMenu.items
    for (const label of path.slice(0, -1)) items = items.find((i) => i.label === label)!.submenu!.items
    items.find((i) => i.label === path[path.length - 1])!.click()
  }, path)

/** Where some words are on screen, for a right-click on them. */
async function wordBox(win: Page, word: string): Promise<{ x: number; y: number }> {
  return win.evaluate((w) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = (globalThis as any).document
    const walker = doc.createTreeWalker(doc.querySelector('.scene-prose'), 4 /* text nodes */)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n.textContent as string).indexOf(w)
      if (i < 0) continue
      const r = doc.createRange()
      r.setStart(n, i)
      r.setEnd(n, i + w.length)
      const box = r.getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    }
    throw new Error(`not on the page: ${w}`)
  }, word)
}

/** Selects a paragraph's words in the page (as a drag over them would). */
async function selectWords(win: Page, words: string): Promise<void> {
  await prose(win).focus()
  await win.evaluate((w) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = (globalThis as any).document
    const walker = doc.createTreeWalker(doc.querySelector('.scene-prose'), 4 /* text nodes */)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n.textContent as string).indexOf(w)
      if (i < 0) continue
      const r = doc.createRange()
      r.setStart(n, i)
      r.setEnd(n, i + w.length)
      const sel = doc.getSelection()
      sel.removeAllRanges()
      sel.addRange(r)
      return
    }
    throw new Error(`not on the page: ${w}`)
  }, words)
}

async function rightClick(app: ElectronApplication, win: Page, word: string): Promise<string[]> {
  await forget(app)
  const at = await wordBox(win, word)
  await win.mouse.click(at.x, at.y, { button: 'right' })
  await expect.poll(() => menuLabels(app)).toContain('Cut')
  return (await menuLabels(app))!
}

test('right-click in the page offers Ask about this paragraph, and on selected words the bar’s actions and AI tools', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { app, win } = await launch({ env: { AIWRITE_KEEPER_QUIET_MS: '600000' } })
    await createWorldFromWelcome(win, 'Alpha')
    const [story] = await invoke(win, 'listStories')
    const { scenes } = await invoke(win, 'getOutline', story.id)
    const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
    await invoke(win, 'updateSettings', {
      models: { writer: { providerId: p.id, modelId: 'fake/writer', label: 'fake/writer', contextLength: 32000, promptPrice: null, completionPrice: null } }
    })
    await invoke(win, 'saveSceneText', scenes[0].id, null, [P1, P2].join('\n\n'))
    await win.reload()
    await expect(paras(win)).toHaveText([P1, P2])
    await catchMenus(app)

    // Nothing selected: after the word's synonyms, Ask about this paragraph, then Cut, Copy and Paste. Read aloud is
    // off, so no Listen from here.
    await prose(win).click()
    let labels = await rightClick(app, win, 'crowd')
    const ask = labels.indexOf('Ask about this paragraph')
    expect(ask).toBeGreaterThanOrEqual(0)
    expect(labels.slice(ask, ask + 3)).toEqual(['Ask about this paragraph', '---', 'Cut'])
    expect(labels).toEqual(expect.arrayContaining(['Synonyms', 'Copy', 'Paste', 'Select all']))
    expect(labels).not.toContain('Listen from here')
    await pick(app, ['Ask about this paragraph'])
    await expect(askBox(win)).toHaveValue(/^About this passage: “Mara pushed through the crowd to the back table\.”/)

    // Selected words: the bar's actions, with the AI tools under Rewrite.
    await selectWords(win, P1)
    labels = await rightClick(app, win, 'tavern')
    const first = labels.indexOf('Ask about this')
    expect(labels.slice(first, first + 5)).toEqual(['Ask about this', 'Edit this', 'Rewrite', '---', 'Cut'])
    expect(await menuLabels(app, ['Rewrite'])).toEqual(['Expand', 'Condense', 'More vivid', 'Change tone', 'Alternatives', '---', 'Continue after these words'])
    expect(await menuLabels(app, ['Rewrite', 'Change tone'])).toContain('Warm')

    // Condense from the menu: the tracked change, as from the bar.
    await pick(app, ['Rewrite', 'Condense'])
    await expect(prose(win).locator('.aw-sugg-words')).toHaveText('The tavern was warm and loud.')
    await expect(prose(win).locator('.aw-sugg-old')).toHaveText(P1)
    await expect(change(win)).toContainText('Condense')
  } finally {
    await fake.close()
  }
})
