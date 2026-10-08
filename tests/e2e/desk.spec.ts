// The New look's desk layout (UI overhaul, phase 2: the frame), walked through on the sample world: the Layout choice in
// Settings, the top bar (rooms, the command bar, the status island), every page in its room's frame, the story's spine
// and its flyout (the binder, with its keys), the page as a sheet (its head, the drop cap, typing at the scene's start),
// the shortcuts the page's tools carry, and the scene drawer (the scene panel over the page's edge).
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, invoke, test, useFakeModel, type LaunchOptions } from './helpers'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk' }
const rooms = (win: Page) => win.getByRole('navigation', { name: 'Rooms' })
const room = (win: Page, name: string) => rooms(win).getByRole('button', { name: new RegExp(`^${name}`) })
const flyout = (win: Page) => win.getByRole('complementary', { name: 'Story contents' })
const drawer = (win: Page) => win.locator('aside.desk-drawer')
const tools = (win: Page) => win.getByRole('toolbar', { name: 'Scene tools' })
const arrangement = (win: Page) => win.evaluate<string | null>('document.documentElement.dataset.arrangement ?? null')

async function sampleWorld(
  launch: (o?: LaunchOptions) => Promise<{ app: ElectronApplication; win: Page; dataDir: string }>,
  opts: LaunchOptions = {}
): Promise<{ app: ElectronApplication; win: Page; dataDir: string }> {
  const a = await launch({ ...opts, env: { ...DESK, ...opts.env } })
  await expect(a.win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(a.win, 'openSampleWorld')
  await a.win.reload()
  await expect(a.win.locator('.scene-prose')).toContainText('A hundred and twelve steps to the lamp room.')
  return a
}

async function size(app: ElectronApplication, win: Page, w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [cw, ch]) => BrowserWindow.getAllWindows()[0].setContentSize(cw, ch), [w, h] as [number, number])
  await expect.poll(() => win.evaluate('innerWidth')).toBe(w)
}

/** How far the window's content spills past its right edge (0 when nothing does). */
const overflow = (win: Page) =>
  win.evaluate<number>(`Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, ...[...document.querySelectorAll('[data-desk-topbar], .desk-room-head, [data-desk-tools]')].map((e) => e.scrollWidth - e.clientWidth + innerWidth)) - innerWidth`)

test('the Layout choice: only in the New look where the desk can be chosen; a pick shows at once and is kept', async ({ launch }) => {
  // A build where the desk isn't ready yet: no Layout choice (the panels, as today).
  {
    const { win } = await launch({ env: { AIWRITE_LOOK: 'new' } })
    await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
    await invoke(win, 'openSampleWorld')
    await win.reload()
    await expect(win.locator('.scene-prose')).toBeVisible()
    expect(await arrangement(win)).toBe('panels')
    await win.keyboard.press('Control+,')
    await win.getByRole('navigation').getByRole('button', { name: 'Appearance' }).click()
    await expect(win.getByRole('radiogroup', { name: 'Style' })).toBeVisible()
    await expect(win.getByRole('radiogroup', { name: 'Layout' })).toHaveCount(0)
  }
  // A try-out build: the panels to start with (app tests), the desk a click away.
  const { win, dataDir, app } = await sampleWorld(launch, { env: { AIWRITE_ARRANGEMENT: 'panels', AIWRITE_DESK_READY: '1' } })
  expect(await arrangement(win)).toBe('panels')
  await win.keyboard.press('Control+,')
  await win.getByRole('navigation').getByRole('button', { name: 'Appearance' }).click()
  const layout = win.getByRole('radiogroup', { name: 'Layout' })
  await expect(layout.getByRole('radio', { name: 'Panels' })).toHaveAttribute('aria-checked', 'true')
  await layout.getByRole('radio', { name: 'Desk' }).click()
  // At once: the desk's top bar with its rooms, no area rail.
  expect(await arrangement(win)).toBe('desk')
  await expect(rooms(win)).toBeVisible()
  await expect(win.getByRole('navigation', { name: 'Areas' })).toHaveCount(0)
  await expect.poll(async () => (await invoke(win, 'getSettings')).arrangement).toBe('desk')
  // Classic has no layout to choose.
  await win.getByRole('radiogroup', { name: 'Style' }).getByRole('radio', { name: 'Classic' }).click()
  await expect(layout).toHaveCount(0)
  expect(await win.evaluate<string>('document.documentElement.dataset.look ?? ""')).toBe('classic')
  await expect(rooms(win)).toHaveCount(0)
  await win.getByRole('radiogroup', { name: 'Style' }).getByRole('radio', { name: 'New look' }).click()
  await expect(rooms(win)).toBeVisible()
  await app.close()
  // Kept: the next launch opens on the desk.
  const again = await launch({ dataDir, env: { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'panels', AIWRITE_DESK_READY: '1' } })
  await expect(again.win.locator('.scene-prose')).toBeVisible()
  expect(await arrangement(again.win)).toBe('desk')
  await expect(rooms(again.win)).toBeVisible()
})

test('the top bar: rooms light the page’s room from the palette; the island says Saved, then Writing…, then Saved; Ctrl+, opens Settings', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 10, slowDelayMs: 40 })
  try {
    const { win } = await sampleWorld(launch)
    await useFakeModel(win, fake, 'fake/slow')
    await expect(room(win, 'Write')).toHaveAttribute('aria-current', 'page')
    // The status island: Saved, with the scene's words.
    const island = win.locator('[data-desk-island]')
    await expect(island).toHaveAttribute('data-desk-island', 'saved')
    await expect(island).toHaveAttribute('aria-label', /^Saved · [\d,]+ words/)

    // A page opened from the palette lights its room: the style guide is in Write, the timeline in World.
    for (const [query, heading, name] of [
      ['timeline', 'Timeline', 'World'],
      ['style guide', 'Style guide', 'Write'],
      ['open consistency', null, 'Check'],
      ['plot threads board', null, 'Plan']
    ] as const) {
      await win.keyboard.press('Control+K')
      await win.keyboard.type(query)
      await win.keyboard.press('Enter')
      if (heading) await expect(win.locator('main').getByRole('heading', { level: 1, name: heading })).toBeVisible()
      await expect(room(win, name)).toHaveAttribute('aria-current', 'page')
    }
    // The command bar: anything typed can be asked of the world.
    await win.getByRole('button', { name: /^Search or ask anything/ }).click()
    await win.keyboard.type('Who keeps the light?')
    await expect(win.getByRole('option', { name: /Ask the world: “Who keeps the light\?”/ })).toBeVisible()
    await win.keyboard.press('Escape')

    // Back to the page; a draft writing below: the island says Writing… with its words, then Saved again.
    await room(win, 'Write').click()
    await expect(room(win, 'Write')).toHaveAttribute('aria-current', 'page')
    await tools(win).getByRole('button', { name: 'Generate', exact: true }).click()
    await win.getByRole('button', { name: /^Add below/ }).click()
    await expect(island).toHaveAttribute('data-desk-island', 'writing')
    await expect(island).toHaveAttribute('aria-label', /^Writing… \d+ words?$/)
    await tools(win).getByRole('button', { name: 'Stop' }).click()
    await expect(island).toHaveAttribute('data-desk-island', 'saved')

    // Ctrl+, opens Settings (the room switch then lights no room).
    await win.locator('.scene-prose').click()
    await win.keyboard.press('Control+,')
    await expect(win.locator('main').getByRole('heading', { level: 1, name: 'Models' })).toBeVisible()
    await expect(rooms(win).locator('[aria-current="page"]')).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

test('every page opens in its room’s frame without spilling past the window, at 1440×900 and 960×600', async ({ launch }) => {
  const { app, win } = await sampleWorld(launch)
  const views = ['write', 'codex', 'entries', 'style', 'settings', 'memory', 'timeline', 'map', 'threads', 'story', 'history', 'outline', 'chapter', 'worldBuilder', 'consistency', 'recipes']
  for (const [w, h] of [
    [1440, 900],
    [960, 600]
  ] as const) {
    await size(app, win, w, h)
    for (const kind of views) {
      await openView(win, kind)
      await expect(win.locator(kind === 'write' ? '.desk-sheet' : '[data-desk-room]')).toBeVisible()
      await win.waitForTimeout(150)
      expect(await overflow(win), `${kind} at ${w}x${h}`).toBeLessThanOrEqual(0)
    }
  }
})

/** Opens a page the way Adam would: its room, then its link in the room's row (or the palette). */
async function openView(win: Page, kind: string): Promise<void> {
  const palette = async (q: string): Promise<void> => {
    await win.keyboard.press('Control+K')
    await win.keyboard.type(q)
    await win.keyboard.press('Enter')
  }
  switch (kind) {
    case 'write':
      return room(win, 'Write').click()
    case 'codex':
      return room(win, 'World').click()
    case 'entries':
      return palette('characters')
    case 'style':
      return palette('style guide')
    case 'settings':
      return palette('settings appearance')
    case 'memory':
      return palette('what changed')
    case 'timeline':
      return palette('timeline')
    case 'map':
      return palette('relationship map')
    case 'threads':
      return palette('plot threads board')
    case 'story':
      return palette('story settings')
    case 'history':
      return palette('scene history')
    case 'outline':
      return room(win, 'Plan').click()
    case 'chapter':
      await room(win, 'Plan').click()
      await win.locator('[data-desk-room]').getByRole('button', { name: /Plan a chapter/ }).click()
      return win.getByRole('menuitem', { name: /The Night Ferry/ }).click()
    case 'worldBuilder':
      return palette('build the world from a summary')
    case 'consistency':
      return palette('open consistency')
    case 'recipes':
      return palette('story recipes')
  }
}

test('the spine: a ring opens its scene, the spine opens the flyout; the binder’s keys work there; Esc closes it; pinned, it stays after a restart', async ({ launch }) => {
  const { win, dataDir, app } = await sampleWorld(launch)
  const spine = win.locator('[data-desk-spine]')
  // A ring for each scene, the open one lit.
  await expect(spine.locator('.spine-ring')).toHaveCount(4)
  await expect(spine.locator('.spine-ring[aria-current="page"]')).toHaveAttribute('aria-label', /Lighting the Lamp/)
  // A ring opens its scene straight away.
  await spine.getByRole('button', { name: /^Low Tide/ }).click()
  await expect(win.locator('[data-page-title]')).toContainText('Low Tide')
  await expect(flyout(win)).toBeHidden()

  // The spine opens the flyout: the story's chapters and scenes, the open one selected and holding the keyboard.
  await spine.getByRole('button', { name: 'Story contents' }).click()
  await expect(flyout(win)).toBeVisible()
  await expect(flyout(win)).toContainText('4 scenes')
  const lowTide = flyout(win).getByRole('treeitem', { name: /Low Tide/ })
  await expect(lowTide).toHaveAttribute('aria-selected', 'true')
  await expect(lowTide).toBeFocused()
  // The binder's keys: up a row, Enter opens it (and the flyout, done with, closes).
  await win.keyboard.press('ArrowUp')
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-page-title]')).toContainText('What the Letter Said')
  await expect(flyout(win)).toBeHidden()
  // Esc closes it, and a click on the page.
  await spine.getByRole('button', { name: 'Story contents' }).click()
  await expect(flyout(win)).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(flyout(win)).toBeHidden()
  await expect(spine.getByRole('button', { name: 'Story contents' })).toBeFocused()
  await spine.getByRole('button', { name: 'Story contents' }).click()
  await win.locator('.scene-prose').click()
  await expect(flyout(win)).toBeHidden()

  // Pinned open, it stays beside the page, through opening another scene and a restart.
  await spine.getByRole('button', { name: 'Story contents' }).click()
  await flyout(win).getByRole('button', { name: /^Pin open/ }).click()
  await expect(flyout(win)).toHaveAttribute('data-pinned', 'true')
  await flyout(win).getByRole('treeitem', { name: /Fog on the Quay|Low Tide/ }).first().click()
  await expect(flyout(win)).toBeVisible()
  await expect.poll(async () => (await invoke(win, 'getSettings')).layout.binderOpen).toBe(true)
  await app.close()
  const again = await launch({ dataDir, env: DESK })
  await expect(again.win.locator('.scene-prose')).toBeVisible()
  await expect(flyout(again.win)).toBeVisible()
  await expect(flyout(again.win)).toHaveAttribute('data-pinned', 'true')
})

test('the page: its head, a drop cap that types like any letter, and every shortcut the page’s tools carry', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  const head = win.locator('[data-page-title]')
  await expect(head).toContainText('Chapter One · The Night Ferry')
  await expect(head.getByRole('heading', { level: 1 })).toHaveText('Lighting the Lamp')
  await expect(head).toContainText('Scene 1 of 2')
  await expect(head).toContainText('Told through Wren Halloway')
  // The drop cap: the first paragraph's first letter, three lines tall.
  const cap = await win.evaluate<string>("getComputedStyle(document.querySelector('.desk-sheet .scene-prose > p'), '::first-letter').initialLetter ?? ''")
  expect(cap).toMatch(/^3/)
  // Typing at the very start of the scene goes in front of the drop cap's letter, as anywhere else.
  await win.locator('.scene-prose').click()
  await win.keyboard.press('Control+Home')
  await win.keyboard.type('So. ')
  await expect(win.locator('.scene-prose > p').first()).toHaveText(/^So\. The wind came round/)
  await win.keyboard.press('Control+Z')
  await expect(win.locator('.scene-prose > p').first()).toHaveText(/^The wind came round/)
  // Names underlined in their kind's ink.
  await expect(win.locator('.scene-prose .aw-name[data-kind="character"]').first()).toBeVisible()

  // Shortcuts. Ctrl+K: the palette; Esc closes it.
  await win.keyboard.press('Control+K')
  await expect(win.getByRole('dialog', { name: /command/i }).or(win.getByRole('combobox')).first()).toBeVisible()
  await win.keyboard.press('Escape')
  // Ctrl+F: find in the scene.
  await win.locator('.scene-prose').click()
  await win.keyboard.press('Control+F')
  await expect(win.getByRole('textbox', { name: /^Find/ }).first()).toBeFocused()
  await win.keyboard.press('Escape')
  // Ctrl+Enter marks a scene done (Low Tide is drafted).
  await win.locator('[data-desk-spine]').getByRole('button', { name: /^Low Tide/ }).click()
  await expect(head).toContainText('Low Tide')
  await win.locator('.scene-prose').click()
  await win.keyboard.press('Control+Enter')
  await expect(tools(win).getByRole('button', { name: /Scene status: Done/ })).toBeVisible()
  // F11: focus mode; the spine steps away, the top bar dims; F11 again leaves.
  await win.keyboard.press('F11')
  await expect.poll(() => win.evaluate<boolean>("'focus' in document.documentElement.dataset")).toBe(true)
  await expect(win.locator('[data-desk-spine]')).toBeHidden()
  await win.keyboard.press('F11')
  await expect.poll(() => win.evaluate<boolean>("'focus' in document.documentElement.dataset")).toBe(false)
  // Ctrl+G: Generate (with no writer model, it says how to choose one).
  await win.locator('.scene-prose').click()
  await win.keyboard.press('Control+G')
  await expect(win.getByText(/writer model/i).first()).toBeVisible()
})

test('the scene drawer: Ideas for this scene opens it on the card; a name Ctrl+clicked shows there; Ask the world opens there; Esc closes it', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  // Shut to start with (the desk's first run), over the page's edge when open: the page never moves for it.
  await expect(drawer(win)).toBeHidden()
  // (Once the sheet has settled from its first rise.)
  await win.waitForTimeout(600)
  const before = await win.locator('.desk-sheet').boundingBox()

  await win.keyboard.press('Control+K')
  await win.keyboard.type('ideas for this scene')
  await win.keyboard.press('Enter')
  await expect(drawer(win)).toBeVisible()
  await expect(drawer(win).getByRole('tab', { name: /Scene card|Card/ })).toHaveAttribute('aria-selected', 'true')
  expect(await win.locator('.desk-sheet').boundingBox()).toEqual(before)

  // Ctrl+click on a name: the entry shows in the drawer.
  await win.locator('.scene-prose .aw-name', { hasText: 'Edric Halloway' }).first().click({ modifiers: ['Control'] })
  await expect(drawer(win)).toContainText('Edric Halloway')

  // Esc inside it closes it, and the caret goes back to the page.
  await drawer(win).getByRole('button', { name: 'Close the scene panel' }).focus()
  await win.keyboard.press('Escape')
  await expect(drawer(win)).toBeHidden()
  await expect.poll(async () => (await invoke(win, 'getSettings')).layout.inspectorOpen).toBe(false)

  // Ask the world opens in the drawer too.
  await tools(win).getByRole('button', { name: 'Ask the world' }).click()
  await expect(drawer(win)).toBeVisible()
  await expect(drawer(win).getByRole('textbox').first()).toBeFocused()
})
