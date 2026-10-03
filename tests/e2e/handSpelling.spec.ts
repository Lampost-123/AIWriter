// Writing by hand: word counts and today's writing, the daily target and streak, the spell check switch, synonyms
// on right-click and Add to this world's glossary. Nothing here depends on Chromium's spelling dictionaries (which
// may need downloading): the underlines themselves aren't checked, only what the app does around them.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { binder, createWorldFromWelcome, expect, invoke, openSettings, test } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const countButton = (win: Page) => win.getByRole('button', { name: /^[\d,]+ words?$/ })
const panel = (win: Page) => win.getByRole('dialog')
/** The file noting the world words put in the dictionary (src/main/spelling). */
const tracked = (dataDir: string): string => join(dataDir, 'app', 'spelling-world-words.json')

/** Back to the page from Settings (the top bar's Settings button goes back where Adam was). */
async function backToPage(win: Page): Promise<void> {
  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(prose(win)).toBeVisible()
}

/** Where a word is on screen, for a right-click on it. */
async function wordBox(win: Page, word: string): Promise<{ x: number; y: number }> {
  return win.evaluate((w) => {
    // The window's DOM (these tests are typed without it).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = (globalThis as any).document
    const root = doc.querySelector('.scene-prose')
    const walker = doc.createTreeWalker(root, 4 /* text nodes */)
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

/** The right-click menu isn't shown on screen in tests: the app's menu is kept for the test to read and click. */
async function catchMenus(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Menu }) => {
    Menu.prototype.popup = function (this: Electron.Menu) {
      ;(globalThis as unknown as { lastMenu: Electron.Menu }).lastMenu = this
    }
  })
}

interface ShownItem {
  label: string
  enabled: boolean
  type: string
  submenu?: ShownItem[]
}

const lastMenu = (app: ElectronApplication): Promise<ShownItem[] | null> =>
  app.evaluate(() => {
    const m = (globalThis as unknown as { lastMenu?: Electron.Menu }).lastMenu
    const show = (menu: Electron.Menu): ShownItem[] =>
      menu.items.map((i) => ({ label: i.label, enabled: i.enabled, type: i.type, submenu: i.submenu ? show(i.submenu) : undefined }))
    return m ? show(m) : null
  })

test('the word count shows the scene, chapter, story and selection, and today’s words towards a target', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Counting')

  await openSettings(win, 'Editor')
  await win.getByLabel('Words a day').fill('10')
  await expect.poll(async () => (await invoke(win, 'getSettings')).goals.daily).toBe(10)
  await backToPage(win)

  await prose(win).click()
  await win.keyboard.type('The lamps of Harrowgate burned low over the wet stones.')
  await expect(countButton(win)).toHaveText('10 words')

  await countButton(win).click()
  const p = panel(win)
  await expect(p.getByText('Scene', { exact: true })).toBeVisible()
  await expect(p.getByText('Chapter', { exact: true })).toBeVisible()
  await expect(p.getByText('Story', { exact: true })).toBeVisible()
  await expect(p.getByText('under a page, under a minute').first()).toBeVisible()
  await expect(p.getByText('10 of 10 words')).toBeVisible()
  await expect(p.getByRole('progressbar', { name: 'Today’s target' })).toHaveAttribute('aria-valuenow', '10')
  await expect(p.getByText('AI words kept')).toBeVisible()
  await expect(p.getByText('1 day in a row')).toBeVisible()
  // The caret stayed in the page.
  await expect(prose(win)).toBeFocused()
  await win.keyboard.press('Escape')
  await expect(p).toBeHidden()

  // A selection's words show too.
  await win.keyboard.press('Control+a')
  await countButton(win).click()
  await expect(panel(win).getByText('Selection', { exact: true })).toBeVisible()
  await win.keyboard.press('Escape')

  // Opening another scene and coming back counts nothing as typed.
  const chapter = binder(win).locator('[data-row="chapter"]').first()
  await chapter.hover()
  await chapter.getByRole('button', { name: 'Add a scene to this chapter' }).click()
  await win.getByRole('textbox', { name: 'Scene title' }).press('Enter')
  await binder(win).locator('[data-row]', { hasText: 'Scene 1' }).first().click()
  await expect(prose(win)).toContainText('Harrowgate')
  await countButton(win).click()
  await expect(panel(win).getByText('10 of 10 words')).toBeVisible()
  await win.keyboard.press('Escape')

  // The day is kept on this computer (a few seconds after typing).
  await expect
    .poll(async () => (await invoke(win, 'getSettings')).goals.days, { timeout: 20_000 })
    .toEqual([expect.objectContaining({ typed: 10, ai: 0 })])
})

test('spell check can be switched off and on in Settings › Editor, and follows the UK or US spelling', async ({ launch }) => {
  const { app, win } = await launch()
  await createWorldFromWelcome(win, 'Spelling')
  await expect(prose(win)).toHaveAttribute('spellcheck', 'true')

  await openSettings(win, 'Editor')
  const toggle = win.getByRole('switch', { name: 'Check spelling as I type' })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await expect(prose(win)).toHaveAttribute('spellcheck', 'false')
  await expect.poll(() => app.evaluate(({ session }) => session.defaultSession.isSpellCheckerEnabled())).toBe(false)
  expect((await invoke(win, 'getSettings')).editor.spellCheck).toBe(false)
  await toggle.click()
  await expect(prose(win)).toHaveAttribute('spellcheck', 'true')
  await expect.poll(() => app.evaluate(({ session }) => session.defaultSession.isSpellCheckerEnabled())).toBe(true)

  // Adam's writing preference, then the world's style guide.
  const prefs = await invoke(win, 'getWritingPrefs')
  await invoke(win, 'setWritingPrefs', { ...prefs, spelling: 'US' })
  expect(await invoke(win, 'syncSpelling', null)).toMatchObject({ spelling: 'US', language: 'en-US' })
  const world = await invoke(win, 'getWorld')
  await invoke(win, 'updateWorld', { style: { ...world!.style, spelling: 'UK' } })
  expect(await invoke(win, 'syncSpelling', null)).toMatchObject({ spelling: 'UK', language: 'en-GB' })
})

test('a synonym picked on right-click replaces the word, keeping its capitals, as one undo step', async ({ launch }) => {
  const { app, win } = await launch()
  await createWorldFromWelcome(win, 'Synonyms')
  await catchMenus(app)
  await prose(win).click()
  await win.keyboard.type('Happy, she said. She was happy.')

  const { x, y } = await wordBox(win, 'Happy')
  await win.mouse.click(x, y, { button: 'right' })
  await expect.poll(() => lastMenu(app)).not.toBeNull()
  const menu = (await lastMenu(app))!
  const synonyms = menu.find((i) => i.label === 'Synonyms')
  expect(synonyms?.submenu?.length).toBeGreaterThan(1)
  // Each sense under its part of speech, which can't be picked.
  expect(synonyms!.submenu![0]).toMatchObject({ label: 'Adjective', enabled: false })
  const pick = synonyms!.submenu!.find((i) => i.enabled && i.type === 'normal')!
  expect(pick.label.charAt(0)).toBe(pick.label.charAt(0).toUpperCase())
  await app.evaluate((_e, label) => {
    const m = (globalThis as unknown as { lastMenu: Electron.Menu }).lastMenu
    const sub = m.items.find((i) => i.label === 'Synonyms')!.submenu!
    sub.items.find((i) => i.label === label)!.click()
  }, pick.label)
  await expect(prose(win)).toHaveText(`${pick.label}, she said. She was happy.`)
  // Cut, Copy and Paste are still there.
  expect(menu.map((i) => i.label)).toEqual(expect.arrayContaining(['Cut', 'Copy', 'Paste', 'Select all']))

  await win.keyboard.press('Control+z')
  await expect(prose(win)).toHaveText('Happy, she said. She was happy.')

  // The same list the menu shows, in the spelling that applies.
  const senses = await invoke(win, 'synonymsOf', 'colour')
  expect(senses.flatMap((s) => s.words).some((w) => w.includes('color'))).toBe(false)
})

test('Add to this world’s glossary makes a glossary entry for the word, with Undo', async ({ launch }) => {
  const { app, win } = await launch()
  await createWorldFromWelcome(win, 'Glossary')
  // The menu item sends this (it shows for a misspelt word, which needs the spelling dictionary).
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('event:spelling:addToGlossary', { word: 'Quillmarrow' }))
  await expect(win.getByText('“Quillmarrow” is in this world’s glossary now.')).toBeVisible()
  await expect.poll(async () => (await invoke(win, 'listEntries', 'glossary')).map((e) => e.name)).toEqual(['Quillmarrow'])
  await win.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await invoke(win, 'listEntries', 'glossary')).length).toBe(0)
})

test('the world’s names count as correct while it is open, and are taken out after it closes or after a crash', async ({ launch }) => {
  const env = { AIWRITE_SPELL_WORLD_WORDS: '1' }
  const first = await launch({ env })
  const { app, win } = first
  const words = (): Promise<string[]> => app.evaluate(({ session }) => session.defaultSession.listWordsInSpellCheckerDictionary())
  try {
    await createWorldFromWelcome(win, 'Names')
    await invoke(win, 'createEntry', 'character', { name: 'Zorvathine Quellmoor', aliases: ['Vathi'] })
    const state = await invoke(win, 'syncSpelling', null)
    expect(state.worldWords).toBeGreaterThan(0)
    await expect.poll(words).toEqual(expect.arrayContaining(['Zorvathine', 'Quellmoor', 'Vathi']))

    // Another world: the first one's names go.
    await invoke(win, 'createWorld', 'Other')
    await expect.poll(words).not.toContain('Zorvathine')

    // As after a crash: a word in the dictionary, noted as put there for a world, that nothing took out again.
    await app.evaluate(({ session }) => session.defaultSession.addWordToSpellCheckerDictionary('Plimvexory'))
  } finally {
    await first.close()
  }
  // Closing took the open world's words out, and noted that none are left.
  expect(JSON.parse(readFileSync(tracked(first.dataDir), 'utf8'))).toEqual([])
  writeFileSync(tracked(first.dataDir), JSON.stringify(['Plimvexory']))
  // The next start takes it out.
  const second = await launch({ dataDir: first.dataDir, env })
  try {
    await expect.poll(() => JSON.parse(readFileSync(tracked(first.dataDir), 'utf8'))).toEqual([])
    const after: string[] = await second.app.evaluate(({ session }) => session.defaultSession.listWordsInSpellCheckerDictionary())
    expect(after).not.toContain('Plimvexory')
    expect(after).not.toContain('Zorvathine')
  } finally {
    // Never leave these made-up words in this computer's dictionary, whatever happened above.
    await second.app.evaluate(({ session }) => {
      for (const w of ['Plimvexory', 'Zorvathine', 'Quellmoor', 'Vathi', "Zorvathine's", "Quellmoor's", "Vathi's"]) session.defaultSession.removeWordFromSpellCheckerDictionary(w)
    })
  }
})

test('a draft’s words count as AI words kept, not typed, and come off again when it is undone', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 2 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Drafts')
    const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
    await invoke(win, 'updateSettings', {
      models: { writer: { providerId: p.id, modelId: 'fake/writer', label: 'fake/writer', contextLength: 32000, promptPrice: null, completionPrice: null } }
    })
    await win.reload()
    await expect(prose(win)).toBeVisible()
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id

    await win.locator('main header').getByRole('button', { name: 'Generate', exact: true }).click()
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId))[0]?.status, { timeout: 30_000 }).toBe('complete')
    await expect(countButton(win)).not.toHaveText('0 words')
    const sceneWords = Number((await countButton(win).innerText()).replace(/\D/g, ''))

    await countButton(win).click()
    const kept = panel(win).getByText('AI words kept').locator('..')
    await expect(kept).toContainText(`${sceneWords.toLocaleString()} words`)
    await expect(panel(win).getByText('Typed', { exact: true }).locator('..')).toContainText('0 words')
    await win.keyboard.press('Escape')

    // Ctrl+Z takes the whole draft out again, and its words off today's.
    await prose(win).click()
    await win.keyboard.press('Control+z')
    await expect(countButton(win)).toHaveText('0 words')
    await countButton(win).click()
    await expect(panel(win).getByText('AI words kept').locator('..')).toContainText('0 words')
  } finally {
    await fake.close()
  }
})
