// The New look's desk layout (UI overhaul, phase 2: the frame), walked through on the sample world: the Layout choice in
// Settings, the top bar (rooms, the command bar, the status island), every page in its room's frame, the story's spine
// (full with the whole story, or slim with its rings and their flyout) and a single click on each of its controls, the
// page as a sheet (its head, no drop cap, typing at the scene's start), the shortcuts the page's tools carry, and the
// scene drawer (the scene panel over the page's edge) with every way into it.
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { expect, invoke, startFake, test, useFakeModel, type LaunchOptions } from './helpers'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk' }
const rooms = (win: Page) => win.getByRole('navigation', { name: 'Rooms' })
const room = (win: Page, name: string) => rooms(win).getByRole('button', { name: new RegExp(`^${name}`) })
const flyout = (win: Page) => win.getByRole('complementary', { name: 'Story contents' })
const drawer = (win: Page) => win.locator('aside.desk-drawer')
const dock = (win: Page) => win.getByRole('toolbar', { name: 'AI dock' })
const dockMenu = async (win: Page) => {
  await dock(win).getByRole('button', { name: 'More ways to write' }).click()
  return win.getByRole('menu')
}
const topToggle = (win: Page) => win.locator('[data-desk-topbar]').getByRole('button', { name: /^Scene details/ })
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
  // Within a pixel: on CI's 1440×900 virtual screen (Linux, xvfb) a window as wide as the screen comes out 1439 wide, as
  // in handTyping.spec. The spill check measures against the window's real width, so it is just as strict there.
  await expect.poll(async () => Math.abs(((await win.evaluate('innerWidth')) as number) - w)).toBeLessThanOrEqual(1)
}

/** How far the window's content spills past its right edge (0 when nothing does). */
const overflow = (win: Page) =>
  win.evaluate<number>(`Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, ...[...document.querySelectorAll('[data-desk-topbar], .desk-room-head, [data-desk-dock]')].map((e) => e.scrollWidth - e.clientWidth + innerWidth)) - innerWidth`)

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
    await dock(win).getByRole('button', { name: /^Add below/ }).click()
    await expect(island).toHaveAttribute('data-desk-island', 'writing')
    await expect(island).toHaveAttribute('aria-label', /^Writing… \d+ words?$/)
    await dock(win).getByRole('button', { name: 'Stop' }).click()
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
  const views = ['write', 'codex', 'entries', 'style', 'settings', 'memory', 'timeline', 'map', 'threads', 'story', 'history', 'board', 'outline', 'chapter', 'worldBuilder', 'consistency', 'recipes']
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
    case 'board':
      return room(win, 'Plan').click()
    case 'outline':
      await room(win, 'Plan').click()
      return win.locator('[data-desk-room]').getByRole('button', { name: 'Outline helper' }).click()
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

const story = (win: Page) => win.getByRole('complementary', { name: 'Chapters and scenes' })
const spine = (win: Page) => win.locator('[data-desk-spine]')

/** One real press of the mouse at the middle of `target`, as a hand would click it (no forcing, no retries). */
async function press(win: Page, target: Locator): Promise<void> {
  const b = await target.boundingBox()
  if (!b) throw new Error('nothing to click')
  await win.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
}
/** What a single click did shows straight away. */
const AT_ONCE = { timeout: 1000 }

test('the spine: full by default with every chapter and scene beside the page; collapsed, the rings name and open their scenes; the shape is kept', async ({ launch }) => {
  const { win, dataDir, app } = await sampleWorld(launch)
  // Full (no one chose yet): the binder's rows on the spine's leather, chapters with their words, scenes with theirs.
  await expect(spine(win)).toHaveAttribute('data-shape', 'full')
  await expect(story(win)).toBeVisible()
  await expect(story(win)).toContainText('4 scenes')
  await expect(story(win).getByRole('treeitem', { name: /The Night Ferry/ })).toContainText('571')
  await expect(story(win).getByRole('treeitem', { name: /Low Tide/ })).toContainText('288')
  await expect(story(win).getByRole('treeitem', { name: /Lighting the Lamp/ })).toHaveAttribute('aria-selected', 'true')
  await expect(story(win).getByRole('button', { name: 'New scene' })).toBeVisible()
  // The sheet lies in the room beside it, never under it.
  const panel = (await story(win).boundingBox())!
  const sheet = (await win.locator('.desk-sheet').boundingBox())!
  expect(sheet.x).toBeGreaterThan(panel.x + panel.width + 8)
  // A row opens its scene at the first click.
  await press(win, story(win).getByRole('treeitem', { name: /Low Tide/ }))
  await expect(win.locator('[data-page-title] h1')).toHaveText('Low Tide', AT_ONCE)
  await expect(story(win)).toBeVisible()

  // Collapsed: the slim spine, with a ring for each scene; the sheet moves back to the middle of the window.
  await press(win, story(win).getByRole('button', { name: 'Collapse to the spine' }))
  await expect(spine(win)).toHaveAttribute('data-shape', 'slim', AT_ONCE)
  await expect(story(win)).toBeHidden()
  await expect(spine(win).locator('.spine-ring')).toHaveCount(4)
  await expect.poll(async () => (await invoke(win, 'getSettings')).layout.deskStory).toBe('slim')
  await expect
    .poll(async () => {
      const s = (await win.locator('.desk-sheet').boundingBox())!
      return Math.abs(s.x + s.width / 2 - (await win.evaluate<number>('innerWidth')) / 2)
    })
    // (Phase 3: with room for the margin notes' column beside it, the sheet may sit up to 32px left of the middle.)
    .toBeLessThan(12 + 32)
  // A ring names its scene while the pointer rests on it, and opens it at the first click.
  const ring = spine(win).getByRole('button', { name: /^What the Letter Said/ })
  const r = (await ring.boundingBox())!
  await win.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 3 })
  await expect(win.getByRole('tooltip')).toContainText('What the Letter Said')
  await expect(win.getByRole('tooltip')).toContainText('Chapter Two · The Drowned Steps')
  await expect(win.getByRole('tooltip')).toContainText('Done · 246 words')
  await win.mouse.down()
  await win.mouse.up()
  await expect(win.locator('[data-page-title] h1')).toHaveText('What the Letter Said', AT_ONCE)
  await expect(spine(win).locator('.spine-ring[aria-current="page"]')).toHaveAttribute('aria-label', /What the Letter Said/)
  // A click a little off a ring still opens its scene (the spine's width at its height is the ring's).
  const low = (await spine(win).getByRole('button', { name: /^Low Tide/ }).boundingBox())!
  await win.mouse.click(low.x + 6, low.y + low.height / 2)
  await expect(win.locator('[data-page-title] h1')).toHaveText('Low Tide', AT_ONCE)
  await expect(flyout(win)).toBeHidden()

  // The spine itself opens the flyout: the open scene's row selected and holding the keyboard; its keys work.
  await press(win, spine(win).getByRole('button', { name: 'Story contents' }))
  await expect(flyout(win)).toBeVisible(AT_ONCE)
  await expect(flyout(win)).toContainText('4 scenes')
  const lowTide = flyout(win).getByRole('treeitem', { name: /Low Tide/ })
  await expect(lowTide).toHaveAttribute('aria-selected', 'true')
  await expect(lowTide).toBeFocused()
  await win.keyboard.press('ArrowUp')
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-page-title]')).toContainText('What the Letter Said')
  await expect(flyout(win)).toBeHidden()
  // Esc closes it (the keyboard back on the spine), and so does a click on the page.
  await press(win, spine(win).getByRole('button', { name: 'Story contents' }))
  await expect(flyout(win)).toBeVisible(AT_ONCE)
  await win.keyboard.press('Escape')
  await expect(flyout(win)).toBeHidden()
  await expect(spine(win).getByRole('button', { name: 'Story contents' })).toBeFocused()
  await press(win, spine(win).getByRole('button', { name: 'Story contents' }))
  await expect(flyout(win)).toBeVisible(AT_ONCE)
  // A row in the flyout opens its scene at the first click.
  await press(win, flyout(win).getByRole('treeitem', { name: /A Letter for the Keeper/ }))
  await expect(win.locator('[data-page-title] h1')).toHaveText('A Letter for the Keeper', AT_ONCE)
  await expect(flyout(win)).toBeHidden()

  // Kept: the next launch opens on the slim spine; its chevron opens it out again, and that is kept too.
  await app.close()
  const again = await launch({ dataDir, env: DESK })
  await expect(again.win.locator('.scene-prose')).toBeVisible()
  await expect(spine(again.win)).toHaveAttribute('data-shape', 'slim')
  await press(again.win, spine(again.win).getByRole('button', { name: 'Show every chapter and scene' }))
  await expect(spine(again.win)).toHaveAttribute('data-shape', 'full', AT_ONCE)
  await expect(story(again.win)).toBeVisible()
  await expect.poll(async () => (await invoke(again.win, 'getSettings')).layout.deskStory).toBe('full')
})

test('the spine in a narrower window: slim, its chevron opens the story over the page, and the full spine comes back with the room', async ({ launch }) => {
  const { app, win } = await sampleWorld(launch)
  await size(app, win, 1100, 760)
  // No room for the full spine beside the page: slim, though Adam never collapsed it.
  await expect(spine(win)).toHaveAttribute('data-shape', 'slim')
  await press(win, spine(win).getByRole('button', { name: 'Show every chapter and scene' }))
  await expect(flyout(win)).toBeVisible(AT_ONCE)
  await expect(flyout(win).getByRole('button', { name: /No room beside the page/ })).toBeDisabled()
  await win.keyboard.press('Escape')
  await size(app, win, 1440, 900)
  await expect(spine(win)).toHaveAttribute('data-shape', 'full')
  await expect(story(win)).toBeVisible()
})

test('the drawer’s ways in: Scene details in the top bar and by the scene’s head, its line, the palette for each tab; each tab at one click', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  const head = win.locator('[data-page-title]')
  const tab = (name: RegExp) => drawer(win).getByRole('tab', { name })
  // Scene details, at the end of the line under the title: the drawer, on the scene's card.
  await press(win, head.getByRole('button', { name: 'Scene details' }))
  await expect(drawer(win)).toBeVisible(AT_ONCE)
  await expect(tab(/Scene card|Card/)).toHaveAttribute('aria-selected', 'true')
  // Each tab answers the first click.
  for (const name of [/^Context/, /^Cast/, /^Issues/, /^Drafts/, /Scene card|Card/]) {
    await press(win, tab(name))
    await expect(tab(name)).toHaveAttribute('aria-selected', 'true', AT_ONCE)
  }
  // Pressed again, Scene details closes it.
  await press(win, head.getByRole('button', { name: 'Scene details' }))
  await expect(drawer(win)).toBeHidden()
  // The line itself ("Scene 1 of 2 · Told through …") opens the card.
  await press(win, head.getByRole('button', { name: /Scene 1 of 2/ }))
  await expect(tab(/Scene card|Card/)).toHaveAttribute('aria-selected', 'true', AT_ONCE)
  await press(win, drawer(win).getByRole('button', { name: 'Close the scene panel' }))
  await expect(drawer(win)).toBeHidden()
  // The top bar's Scene details, beside the search, says what it is and shows and hides it at one click, lit while open.
  const toggle = topToggle(win)
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(toggle).toHaveAttribute('title', /card, context, cast, issues and drafts/)
  await press(win, toggle)
  await expect(drawer(win)).toBeVisible(AT_ONCE)
  await expect(toggle).toHaveAttribute('aria-pressed', 'true', AT_ONCE)
  await press(win, toggle)
  await expect(drawer(win)).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false', AT_ONCE)
  // The AI dock at the foot of the page doesn't carry it (phase 3); the top bar's is only on the writing page.
  await expect(dock(win).getByRole('button', { name: /Scene details|Scene panel|Details/ })).toHaveCount(0)
  await room(win, 'Plan').click()
  await expect(toggle).toHaveCount(0)
  await room(win, 'Write').click()
  await expect(toggle).toBeVisible()
  // The palette opens it on any tab.
  for (const [query, name] of [
    ['scene issues', /^Issues/],
    ['scene cast', /^Cast/],
    ['scene context', /^Context/],
    ['scene drafts', /^Drafts/],
    ['scene card', /Scene card|Card/]
  ] as const) {
    await win.keyboard.press('Control+K')
    await win.keyboard.type(query)
    await win.keyboard.press('Enter')
    await expect(drawer(win)).toBeVisible()
    await expect(tab(name)).toHaveAttribute('aria-selected', 'true')
  }
})

test('the drawer: full height beside the page in a large window, the sheet between it and the spine; a tab’s page scrolls to its last field', async ({ launch }) => {
  const { app, win } = await sampleWorld(launch)
  await press(win, topToggle(win))
  await expect(drawer(win)).toBeVisible(AT_ONCE)
  // Its pages scroll inside it, with the last field wholly in view at the end (none of it under the drawer's edge).
  const page = drawer(win).locator('[role="tabpanel"][data-state="active"]')
  await expect(page).toHaveAttribute('data-more-below', '')
  await page.evaluate((el) => (el.scrollTop = el.scrollHeight))
  await expect(page).not.toHaveAttribute('data-more-below', '')
  const fits = await page.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const bottoms = [...el.querySelectorAll('*')].map((n) => n.getBoundingClientRect()).filter((r) => r.height > 0).map((r) => r.bottom)
    return { last: Math.max(...bottoms), edge: box.bottom }
  })
  expect(fits.last).toBeLessThanOrEqual(fits.edge - 8)
  // In a large window: docked beside the page, as tall as the spine, and the sheet clear of both. (A window the screen
  // can't hold, as on CI's 1440×900 screen, is checked at the size it gets: the sheet still clear of the spine.)
  for (const [w, h] of [
    [1920, 1080],
    [2560, 1440]
  ] as const) {
    await app.evaluate(({ BrowserWindow }, [cw, ch]) => BrowserWindow.getAllWindows()[0].setContentSize(cw, ch), [w, h] as [number, number])
    await win.waitForTimeout(700)
    const got = await win.evaluate<number>('innerWidth')
    const spineBox = (await story(win).boundingBox())!
    const sheet = (await win.locator('.desk-sheet').boundingBox())!
    expect(sheet.x, `sheet clear of the spine at ${got}`).toBeGreaterThanOrEqual(spineBox.x + spineBox.width + 8)
    if (got < w - 1) continue
    await expect(drawer(win)).toHaveAttribute('data-docked')
    const side = (await drawer(win).boundingBox())!
    expect(sheet.x + sheet.width, `sheet clear of the drawer at ${w}`).toBeLessThanOrEqual(side.x - 8)
    expect(Math.abs(side.y - spineBox.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(side.height - spineBox.height)).toBeLessThanOrEqual(1)
    expect(side.width).toBeGreaterThanOrEqual(420)
    // The five tabs on one line.
    const tabs = await drawer(win).getByRole('tab').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
    expect(new Set(tabs).size).toBe(1)
  }
})

test('the drawer in a smaller window makes room rather than covering the words: the sheet narrows, then the spine shows slim for now; a small window dims the page under it', async ({ launch }) => {
  const { app, win } = await sampleWorld(launch)
  const text = win.locator('.desk-sheet .scene-prose')
  /** The open drawer, the page's words, the spine and the dock: nothing overlaps the words, the dock on the sheet. */
  const clear = async (label: string): Promise<'full' | 'slim'> => {
    await win.waitForTimeout(500)
    const shape = (await spine(win).getAttribute('data-shape')) as 'full' | 'slim'
    const words = (await text.boundingBox())!
    const sheet = (await win.locator('.desk-sheet').boundingBox())!
    const side = (await drawer(win).boundingBox())!
    const spineRight = shape === 'full' ? (await story(win).boundingBox())!.x + (await story(win).boundingBox())!.width : 20 + 48
    expect(words.x, `${label}: words clear of the spine`).toBeGreaterThanOrEqual(spineRight + 8)
    expect(words.x + words.width, `${label}: words clear of the drawer`).toBeLessThanOrEqual(side.x - 8)
    expect(sheet.x + sheet.width, `${label}: sheet clear of the drawer`).toBeLessThanOrEqual(side.x)
    const bar = (await dock(win).boundingBox())!
    expect(bar.x, `${label}: dock on the sheet`).toBeGreaterThanOrEqual(sheet.x)
    expect(bar.x + bar.width, `${label}: dock on the sheet`).toBeLessThanOrEqual(sheet.x + sheet.width)
    expect(bar.x + bar.width, `${label}: dock clear of the drawer`).toBeLessThanOrEqual(side.x)
    return shape
  }
  const fullKept = async (): Promise<void> => {
    await expect.poll(async () => (await invoke(win, 'getSettings')).layout.deskStory ?? 'full').toBe('full')
  }

  // 1440×900, the whole story beside the page (Adam's maximised window): the sheet narrows, the spine stays full.
  await size(app, win, 1440, 900)
  await expect(spine(win)).toHaveAttribute('data-shape', 'full')
  await press(win, topToggle(win))
  await expect(drawer(win)).toHaveAttribute('data-docked')
  await clear('1440')
  await press(win, topToggle(win))
  await expect(drawer(win)).toHaveAttribute('data-state', 'closed')
  await expect(spine(win)).toHaveAttribute('data-shape', 'full')
  await fullKept()

  // 1366×768 and 1280×800: the spine shows slim while the drawer is open, and comes back full when it closes; the saved
  // choice never changes.
  for (const [w, h] of [
    [1366, 768],
    [1280, 800]
  ] as const) {
    await size(app, win, w, h)
    await expect(spine(win)).toHaveAttribute('data-shape', 'full')
    await press(win, topToggle(win))
    await expect(drawer(win)).toHaveAttribute('data-docked')
    expect(await clear(`${w}`)).toBe('slim')
    await fullKept()
    await press(win, topToggle(win))
    await expect(drawer(win)).toHaveAttribute('data-state', 'closed')
    await expect(spine(win)).toHaveAttribute('data-shape', 'full')
    await fullKept()
  }

  // 1100×800: no room beside the page at all. The drawer lies over a dimmed page; Esc closes it, and so does a click on
  // the dimmed page.
  await size(app, win, 1100, 800)
  await press(win, topToggle(win))
  await expect(drawer(win)).toHaveAttribute('data-state', 'open')
  await expect(drawer(win)).not.toHaveAttribute('data-docked')
  const scrim = win.locator('.desk-drawer-scrim')
  await expect(scrim).toHaveAttribute('data-state', 'open')
  await expect(scrim).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(drawer(win)).toHaveAttribute('data-state', 'closed')
  await expect(scrim).toBeHidden()
  await press(win, topToggle(win))
  await expect(scrim).toBeVisible()
  await scrim.click({ position: { x: 300, y: 300 } })
  await expect(drawer(win)).toHaveAttribute('data-state', 'closed')
  await fullKept()

  // 1920×1080 (when the screen holds it): the whole sheet beside the full spine and the drawer, as before.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1920, 1080))
  await win.waitForTimeout(500)
  if (((await win.evaluate('innerWidth')) as number) >= 1919) {
    const before = (await win.locator('.desk-sheet').boundingBox())!.width
    await press(win, topToggle(win))
    await expect(drawer(win)).toHaveAttribute('data-docked')
    expect(await clear('1920')).toBe('full')
    expect(Math.abs((await win.locator('.desk-sheet').boundingBox())!.width - before)).toBeLessThanOrEqual(1)
  }
})

test('the page: its head, typing at the scene’s very start, and every shortcut the page’s tools carry', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  const head = win.locator('[data-page-title]')
  await expect(head).toContainText('Chapter One · The Night Ferry')
  await expect(head.getByRole('heading', { level: 1 })).toHaveText('Lighting the Lamp')
  await expect(head).toContainText('Scene 1 of 2')
  await expect(head).toContainText('Told through Wren Halloway')
  // No drop cap (Adam's wish): the first paragraph's first letter is the size of every other.
  const cap = await win.evaluate<string>("getComputedStyle(document.querySelector('.desk-sheet .scene-prose > p'), '::first-letter').initialLetter ?? ''")
  expect(cap === '' || cap === 'normal').toBe(true)
  // Typing at the very start of the scene goes in front of its first letter, as anywhere else.
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
  await win.getByRole('complementary', { name: 'Chapters and scenes' }).getByRole('treeitem', { name: /Low Tide/ }).click()
  await expect(head).toContainText('Low Tide')
  await win.locator('.scene-prose').click()
  await win.keyboard.press('Control+Enter')
  await expect.poll(() => statusOf(win, 'Low Tide')).toBe('done')
  await expect((await dockMenu(win)).getByRole('menuitem', { name: /Reopen the scene/ })).toBeVisible()
  await win.keyboard.press('Escape')
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
  // Shut to start with (the desk's first run); open, the page makes room for it (its words never under it).
  await expect(drawer(win)).toBeHidden()

  await win.keyboard.press('Control+K')
  await win.keyboard.type('ideas for this scene')
  await win.keyboard.press('Enter')
  await expect(drawer(win)).toBeVisible()
  await expect(drawer(win).getByRole('tab', { name: /Scene card|Card/ })).toHaveAttribute('aria-selected', 'true')
  await expect
    .poll(async () => {
      const [sheet, side] = [(await win.locator('.desk-sheet').boundingBox())!, (await drawer(win).boundingBox())!]
      return Math.round(side.x - (sheet.x + sheet.width))
    })
    .toBeGreaterThanOrEqual(0)

  // Ctrl+click on a name: the entry shows in the drawer.
  await win.locator('.scene-prose .aw-name', { hasText: 'Edric Halloway' }).first().click({ modifiers: ['Control'] })
  await expect(drawer(win)).toContainText('Edric Halloway')

  // Esc inside it closes it, and the caret goes back to the page.
  await drawer(win).getByRole('button', { name: 'Close the scene panel' }).focus()
  await win.keyboard.press('Escape')
  await expect(drawer(win)).toBeHidden()
  await expect.poll(async () => (await invoke(win, 'getSettings')).layout.inspectorOpen).toBe(false)

  // Ask the world opens in the drawer too.
  await (await dockMenu(win)).getByRole('menuitemcheckbox', { name: 'Ask the world' }).click()
  await expect(drawer(win)).toBeVisible()
  await expect(drawer(win).getByRole('textbox').first()).toBeFocused()
})

// ---------- Phase 3: the AI dock ----------

/** Opens a scene by its title: from the whole story beside the page, or the slim spine's rings. */
async function openNamed(win: Page, title: string): Promise<void> {
  const item = story(win).getByRole('treeitem', { name: new RegExp(title) })
  if (await item.count()) await item.click()
  else await spine(win).getByRole('button', { name: new RegExp(`^${title}`) }).click()
  await expect(win.locator('[data-page-title] h1')).toHaveText(title)
}

/** The open scene's status, as saved. */
async function statusOf(win: Page, title: string): Promise<string | undefined> {
  const [s] = await invoke(win, 'listStories')
  return (await invoke(win, 'getOutline', s.id)).scenes.find((x) => x.title === title)?.status
}

/** The open story's first scene and chapter. */
async function firstScene(win: Page): Promise<{ sceneId: string; chapterId: string }> {
  const [story] = await invoke(win, 'listStories')
  const { scenes, chapters } = await invoke(win, 'getOutline', story.id)
  return { sceneId: scenes[0].id, chapterId: chapters[0].id }
}

test('the dock’s Continue writes on from the end of the scene as a change; Tab accepts it; the steer box’s words go with it', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 10 })
  try {
    const { win } = await sampleWorld(launch, { env: { AIWRITE_KEEPER_QUIET_MS: '600000' } })
    await useFakeModel(win, fake)
    const paras = win.locator('.scene-prose > p')
    const before = await paras.count()
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle')
    // The caret at the start of the scene: Continue still carries on from its end.
    await win.locator('.scene-prose').click()
    await win.keyboard.press('Control+Home')
    const steer = dock(win).getByRole('textbox', { name: 'Steer the next bit (optional)' })
    await steer.fill('The ferry horn sounds twice')
    await steer.press('Enter')
    // The change waits at the end, and the dock offers Accept and Reject (its idle face, with the steer box, steps away).
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'review')
    await expect(dock(win).getByRole('button', { name: /^Accept/ })).toBeVisible()
    await expect(dock(win)).toContainText(/Continue · \d+ words/)
    // One clear Accept and Reject, in the dock: the row under the change keeps What the AI saw.
    const row = win.getByRole('group', { name: 'The AI’s change' })
    await expect(row).toContainText('Tab accepts, Esc rejects')
    await expect(row.getByRole('button', { name: /^(Accept|Reject)/ })).toHaveCount(0)
    await expect(row.getByRole('button', { name: 'What the AI saw' })).toBeVisible()
    await expect(win.getByRole('button', { name: /^Accept/ })).toHaveCount(1)
    await expect(paras.last().locator('.aw-sugg-new')).toHaveCount(1)
    // The steer box's words went to the AI as the direction (the record keeps them; edit records aren't listed per scene).
    const sent = JSON.stringify(fake.lastRequest()?.body.messages ?? [])
    expect(sent).toContain('The ferry horn sounds twice')
    await win.keyboard.press('Tab')
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle')
    // The steer box emptied once the AI started with its words (they are for one Continue only).
    await expect(steer).toHaveValue('')
    await expect.poll(() => paras.count()).toBeGreaterThan(before)
    await expect(paras.last()).toHaveText(/for the first time that evening she sat/)
    // Ctrl+Shift+Enter does the same; Esc in the page rejects it.
    await win.locator('.scene-prose').click()
    await win.keyboard.press('Control+Shift+Enter')
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'review')
    await win.keyboard.press('Escape')
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle')
    await expect(win.locator('.scene-prose .aw-sugg-new')).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

test('the dock’s Add below drafts below a scene break with no question, and one Ctrl+Z takes it away; Esc stops a draft', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 10, slowDelayMs: 60 })
  try {
    const { win } = await sampleWorld(launch, { env: { AIWRITE_KEEPER_QUIET_MS: '600000' } })
    await useFakeModel(win, fake)
    const prose = win.locator('.scene-prose')
    const text = await prose.innerText()
    await dock(win).getByRole('button', { name: /^Add below/ }).click()
    await expect(prose.locator('hr')).toHaveCount(1)
    await expect(win.getByRole('heading', { name: 'This scene already has text' })).toHaveCount(0)
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle', { timeout: 20000 })
    await win.keyboard.press('Control+z')
    await expect(prose.locator('hr')).toHaveCount(0)
    expect(await prose.innerText()).toBe(text)

    // Esc stops a draft being written; the words so far stay.
    await useFakeModel(win, fake, 'fake/slow')
    await dock(win).getByRole('button', { name: /^Add below/ }).click()
    await expect(dock(win)).toContainText(/Writing… \d+ words?/)
    await win.keyboard.press('Escape')
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle')
    await expect(prose.locator('hr')).toHaveCount(1)
  } finally {
    await fake.close()
  }
})

test('the dock: Ctrl+G opens Generate’s panels over it; the menu has the toolbar’s tools; an empty scene offers Draft the scene', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  // No writer model in this world: Ctrl+G says how to choose one, once, over the dock.
  await win.locator('.scene-prose').click()
  await win.keyboard.press('Control+G')
  const heading = win.getByRole('heading', { name: 'Choose a writer model first' })
  await expect(heading).toHaveCount(1)
  expect((await heading.boundingBox())!.y).toBeLessThan((await dock(win).boundingBox())!.y)
  await win.keyboard.press('Escape')
  await expect(heading).toHaveCount(0)

  // The menu: every way to write, and the scene's tools.
  const menu = await dockMenu(win)
  for (const name of ['Rewrite the scene', 'Fresh take', 'Draft three', 'Beat by beat', 'Draft options…', 'Reopen the scene', 'Scene history'])
    await expect(menu.getByRole('menuitem', { name })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Status: Done/ })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Format' })).toBeVisible()
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Ask the world' })).toBeVisible()
  // Scene details isn't on the dock: it has its own place, by the scene's head (and the top bar).
  await expect(menu.getByRole('menuitemcheckbox', { name: /Scene details|Scene panel/ })).toHaveCount(0)
  await win.keyboard.press('Escape')

  // An empty scene: Continue becomes Draft the scene.
  const { chapterId } = await firstScene(win)
  await invoke(win, 'createScene', chapterId, { title: 'Blank Page' })
  await win.reload()
  await openNamed(win, 'Blank Page')
  await expect(dock(win).getByRole('button', { name: /^Draft the scene/ })).toBeVisible()
  await expect(dock(win).getByRole('button', { name: /^Continue/ })).toHaveCount(0)
})

test('the dock’s More says what it is: its word in a large window, what it holds on hover, and the dock fits from 1366 to 1920', async ({ launch }) => {
  // Adam: a bare "⋯" beside Add below didn't say what it was for.
  const { app, win } = await sampleWorld(launch)
  const more = dock(win).getByRole('button', { name: /^More ways to write/ })
  await expect(more).toHaveAttribute('title', /^More: Rewrite the scene, Fresh take, Draft three, Beat by beat .*Mark done/)
  for (const [w, h] of [[1920, 1080], [1450, 900], [1366, 768]] as const) {
    await size(app, win, w, h)
    const bar = (await dock(win).boundingBox())!
    const box = (await more.boundingBox())!
    expect(box.x + box.width, `More inside the dock at ${w}`).toBeLessThanOrEqual(bar.x + bar.width)
    expect(await dock(win).evaluate((d) => d.scrollWidth - d.clientWidth), `nothing spills from the dock at ${w}`).toBe(0)
    for (const name of [/^Add below/, /^Continue/]) await expect(dock(win).getByRole('button', { name })).toBeInViewport()
    if (w === 1920) await expect(more).toHaveText('More')
  }
  const menu = await dockMenu(win)
  await expect(menu.getByText('More ways to write', { exact: true })).toBeVisible()
  await expect(menu.getByText('This scene’s tools', { exact: true })).toBeVisible()
})

test('the shortcuts the panels’ toolbar carries each work once on the desk: Ctrl+Enter, Ctrl+G, Esc', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 10, slowDelayMs: 60 })
  try {
    const { win } = await sampleWorld(launch, { env: { AIWRITE_KEEPER_QUIET_MS: '600000' } })
    await useFakeModel(win, fake, 'fake/slow')
    const toasts = win.locator('div.fixed[aria-live="polite"]')
    // Ctrl+Enter on a drafted scene: marked done once (heard twice, it would also say it is already done).
    await openNamed(win, 'Low Tide')
    await win.locator('.scene-prose').click()
    await win.keyboard.press('Control+Enter')
    await expect.poll(() => statusOf(win, 'Low Tide')).toBe('done')
    await win.waitForTimeout(400)
    await expect(toasts).not.toContainText('already marked done')
    // Ctrl+G: one choice, over the dock; Enter picks Add below; Esc stops it.
    await win.locator('.scene-prose').click()
    await win.keyboard.press('Control+G')
    await expect(win.getByRole('heading', { name: 'This scene already has text' })).toHaveCount(1)
    await win.keyboard.press('Enter')
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'busy')
    await expect(dock(win)).toContainText(/Writing… \d+ words?/)
    await win.keyboard.press('Escape')
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle')
  } finally {
    await fake.close()
  }
})

test('the next-beat chip: the card’s next beat; it ticks as its words land, then offers Mark done; Ctrl+Enter still marks done', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  const [story] = await invoke(win, 'listStories')
  const { scenes } = await invoke(win, 'getOutline', story.id)
  // Low Tide (drafted): two beats on the page already, the third still to write. Lighting the Lamp: no beats.
  const lowTide = scenes.find((s) => s.title === 'Low Tide')!
  const { card } = await invoke(win, 'getScene', lowTide.id)
  const beats = ['Wren takes Iska out over the Drowned Steps', 'Iska takes Wren’s good hand on the weed', 'Ansel rings the hand bell from the quay']
  await invoke(win, 'updateSceneCard', lowTide.id, { ...card, beats })
  await win.reload()
  await expect(win.locator('.scene-prose')).toBeVisible()
  const chip = win.locator('[data-desk-chip]')
  await expect(chip).toHaveCount(0)

  await openNamed(win, 'Low Tide')
  await expect(chip).toHaveAttribute('data-desk-chip', 'next')
  await expect(chip).toContainText('Next beat')
  await expect(chip).toContainText('Ansel rings the hand bell from the quay')

  // Its words land: the beat is ticked, then the chip asks whether the scene is done.
  await win.locator('.scene-prose').click()
  await win.keyboard.press('Control+End')
  await win.keyboard.press('Enter')
  await win.keyboard.type('On the quay, Ansel rang the bell until the fog let go of it.')
  await expect(chip).toHaveAttribute('data-desk-chip', 'all', { timeout: 8000 })
  await expect(chip).toContainText('Done for this scene: mark it done?')
  await chip.getByRole('button', { name: 'Mark done' }).click()
  await expect(chip).toHaveAttribute('data-desk-chip', 'done')
  await expect(chip).toContainText(/Scene done · [\d,]+ words/)
  await expect.poll(() => statusOf(win, 'Low Tide')).toBe('done')

  // Reopened from the dock's menu, Ctrl+Enter marks it done again (heard once).
  await (await dockMenu(win)).getByRole('menuitem', { name: 'Reopen the scene' }).click()
  await expect(chip).toHaveAttribute('data-desk-chip', 'all')
  await win.locator('.scene-prose').click()
  await win.keyboard.press('Control+Enter')
  await expect(chip).toHaveAttribute('data-desk-chip', 'done')
})

test('the margin: the scene card pinned beside the title, tethered to it, kept there through resizing; tabs on the sheet’s edge in a smaller window', async ({ launch }) => {
  const { app, win } = await sampleWorld(launch)
  const [story] = await invoke(win, 'listStories')
  const { scenes } = await invoke(win, 'getOutline', story.id)
  const { card } = await invoke(win, 'getScene', scenes[0].id)
  await invoke(win, 'updateSceneCard', scenes[0].id, { ...card, beats: ['Wren climbs the hundred and twelve steps', 'Ansel rings the hand bell on the quay'] })
  await win.reload()
  await expect(win.locator('.scene-prose')).toBeVisible()
  const note = win.locator('[data-slip="card"]')
  const title = win.locator('.desk-scene-title')
  const sheet = win.locator('.desk-sheet')

  /** The card beside the title (its top 28px above the title's), over the sheet's right edge by 16px. */
  const aligned = async (): Promise<void> => {
    await expect
      .poll(async () => {
        const [n, t, s] = [await note.boundingBox(), await title.boundingBox(), await sheet.boundingBox()]
        if (!n || !t || !s) return 'missing'
        return Math.abs(n.y - (t.y - 28)) <= 4 && Math.abs(n.x - (s.x + s.width - 16)) <= 4 ? 'aligned' : `${n.x},${n.y} vs ${s.x + s.width - 16},${t.y - 28}`
      })
      .toBe('aligned')
  }

  // A large window: the column beside the sheet (with the whole story open beside the page on the left).
  for (const [w, h] of [[1920, 1080]] as const) {
    await size(app, win, w, h)
    await expect(win.locator('[data-desk-margin="column"]')).toBeAttached()
    await expect(note).toBeVisible()
    await expect(note).toContainText('Scene card')
    await expect(note).toContainText('The Gullhaven Light')
    await expect(note).toContainText('Told through Wren Halloway')
    // Its beats: the first is on the page (ticked), the second is next.
    await expect(note.getByRole('listitem', { name: /hundred and twelve steps, written/ })).toBeVisible()
    await expect(note.getByRole('listitem', { name: /hand bell on the quay, next/ })).toBeVisible()
    await expect(note.locator('.desk-tether path')).toHaveCount(1)
    await aligned()
    // Nothing spills past the window.
    expect(await win.evaluate<number>('document.querySelector(".desk-scroller").scrollWidth - document.querySelector(".desk-scroller").clientWidth')).toBeLessThanOrEqual(0)
  }

  // Bigger text: the page re-wraps and the card stays beside the title.
  await invoke(win, 'updateSettings', { editor: { fontSize: 22 } })
  await aligned()

  // Hovered, the slip straightens.
  await note.hover()
  await expect.poll(() => win.evaluate<string>("getComputedStyle(document.querySelector('[data-slip=card] .desk-slip')).rotate")).toMatch(/^(0deg|none)$/)

  // Edit opens the whole card in the scene drawer; the margin steps away while it is open.
  await note.getByRole('button', { name: 'Edit' }).click()
  await expect(drawer(win)).toBeVisible()
  await expect(drawer(win).getByRole('tab', { name: /Scene card|Card/ })).toHaveAttribute('aria-selected', 'true')
  await expect(win.locator('[data-desk-margin]')).toHaveAttribute('data-away', 'true')
  await drawer(win).getByRole('button', { name: 'Close the scene panel' }).click()
  await expect(win.locator('[data-desk-margin]')).not.toHaveAttribute('data-away', 'true')

  // At 1440 with the whole story open beside the page there is no room for the column: the card folds into a tab on the
  // sheet's edge; so it does in a smaller window, where it opens as a pop-up.
  await size(app, win, 1440, 900)
  await expect(win.locator('[data-desk-margin="tabs"]')).toBeAttached()
  await size(app, win, 1100, 800)
  await expect(win.locator('[data-desk-margin="tabs"]')).toBeAttached()
  await expect(note).toHaveCount(0)
  const tab = win.locator('[data-slip-tab="card"]')
  await expect(tab).toBeVisible()
  await expect
    .poll(async () => {
      const [t, s] = [(await tab.boundingBox())!, (await sheet.boundingBox())!]
      return Math.abs(t.x + t.width / 2 - (s.x + s.width))
    })
    .toBeLessThanOrEqual(4)
  await tab.click()
  await expect(win.getByRole('dialog').getByText('Scene card')).toBeVisible()
  await expect(win.getByRole('dialog')).toContainText('The Gullhaven Light')
})

test('entity notes: Edric’s beside his paragraph, the lore rule with In memory; they follow their words through typing and resizing, push apart, and grow into a card', async ({ launch }) => {
  const { app, win } = await sampleWorld(launch)
  await size(app, win, 1920, 1080)
  await expect(win.locator('[data-desk-margin="column"]')).toBeAttached()
  const paras = win.locator('.desk-sheet .scene-prose > p')
  const note = (name: string) => win.locator('[data-slip^="entity:"]', { hasText: name })
  const edric = note('Edric Halloway')
  const lore = note('The light is never dark')
  const place = win.locator('[data-slip^="entity:"][data-kind="place"]', { hasText: 'Gullhaven' })
  /** A note's top against its paragraph's top (within 4px). */
  const beside = async (n: Locator, i: number): Promise<void> => {
    await expect
      .poll(async () => {
        const [a, b] = [await n.boundingBox(), await paras.nth(i).boundingBox()]
        return a && b ? Math.round(Math.abs(a.y - b.y)) : 'missing'
      })
      .toBeLessThanOrEqual(4)
  }

  await expect(edric).toBeVisible()
  await expect(edric).toContainText('Character')
  await expect(edric).toContainText('Keeper of the Gullhaven Light for forty years')
  await expect(edric.locator('.desk-tether path')).toHaveCount(1)
  await beside(edric, 1)
  await expect(lore).toBeVisible()
  await expect(lore).toContainText('Lore')
  await expect(lore).toContainText('In memory')
  // The point-of-view character never gets a note (the scene card names her); plot threads never do either.
  await expect(note('Wren Halloway')).toHaveCount(0)
  await expect(note('What is in the sealed letter?')).toHaveCount(0)

  // Two notes about the same paragraph push apart (the place, then the lore rule below it), never overlapping.
  await expect
    .poll(async () => {
      const [p, l] = [(await place.boundingBox())!, (await lore.boundingBox())!]
      return Math.round(l.y - (p.y + p.height))
    })
    .toBeGreaterThanOrEqual(6)

  // A new line typed above Edric's paragraph: his note follows it down.
  const before = (await edric.boundingBox())!.y
  await paras.nth(1).click({ position: { x: 4, y: 8 } })
  await win.keyboard.press('Home')
  await win.keyboard.type('A gull went over, crying.')
  await win.keyboard.press('Enter')
  await expect(paras.nth(1)).toHaveText('A gull went over, crying.')
  await expect.poll(async () => (await edric.boundingBox())!.y).toBeGreaterThan(before + 20)
  await beside(edric, 2)
  // Bigger text (the page re-wraps) and a narrower window: still beside it.
  await invoke(win, 'updateSettings', { editor: { fontSize: 21 } })
  await beside(edric, 2)
  await size(app, win, 1800, 1000)
  await beside(edric, 2)
  await win.keyboard.press('Control+Z')
  await beside(edric, 1)

  // Put away (its ×), the place's note goes and the lore note glides up to its paragraph.
  await place.hover()
  await place.getByRole('button', { name: /note away/ }).click()
  await expect(place).toHaveCount(0)
  await expect.poll(() => lore.evaluate((el) => el.getAnimations().length)).toBeGreaterThan(0)
  await beside(lore, 4)

  // Edric's slip grows into his card: how he speaks, where things stand, and the ways on.
  await edric.getByRole('button', { name: /Edric Halloway: open the card/ }).click()
  const card = win.getByRole('dialog', { name: 'Edric Halloway' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('How they speak')
  await expect(card).toContainText('Where things stand')
  await expect(card.getByRole('button', { name: 'Open their page' })).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(card).toHaveCount(0)
  await edric.getByRole('button', { name: /Edric Halloway: open the card/ }).click()
  await card.getByRole('button', { name: 'Show beside the page' }).click()
  await expect(drawer(win)).toBeVisible()
  await expect(drawer(win)).toContainText('Edric Halloway')
})

test('check and memory notes: an issue’s note beside its words with Rewrite and Keep; Keep ignores it; the memory’s note after it reads the scene', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { app, win } = await sampleWorld(launch, { env: { AIWRITE_KEEPER_QUIET_MS: '600000' } })
    await useFakeModel(win, fake)
    await expect(win.locator('.scene-prose')).toContainText('A hundred and twelve steps')
    await size(app, win, 1920, 1080)
    const [story] = await invoke(win, 'listStories')
    const { scenes } = await invoke(win, 'getOutline', story.id)
    const sceneId = scenes[0].id
    // A planted contradiction (the memory says Wren's eyes are grey), and something for the memory to learn.
    await win.locator('.scene-prose').click()
    await win.keyboard.press('Control+End')
    await win.keyboard.press('Enter')
    await win.keyboard.type('Wren’s eyes were green in the lamplight. Wren learned that the ferry was a day early.')
    await expect.poll(async () => (await invoke(win, 'getScene', sceneId)).text).toContain('lamplight')

    // The check: its note beside the paragraph with its words, Rewrite and Keep.
    await invoke(win, 'startCheck', { runId: 'desk-check', target: { scope: 'scene', id: sceneId }, checks: ['facts'] })
    const check = win.locator('[data-slip^="issue:"]')
    await expect(check).toBeVisible({ timeout: 30_000 })
    await expect(check).toContainText('“Wren’s eyes were green')
    await expect(check.locator('.desk-tether path')).toHaveCount(1)
    const last = win.locator('.desk-sheet .scene-prose > p').last()
    await expect
      .poll(async () => {
        const [a, b] = [(await check.boundingBox())!, (await last.boundingBox())!]
        return Math.round(a.y - b.y)
      })
      .toBeGreaterThanOrEqual(-4)
    // Rewrite: the check's suggested words as a tracked change in the page (rejected again here).
    await check.getByRole('button', { name: 'Rewrite' }).click()
    await expect(win.getByRole('group', { name: 'The AI’s change' })).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(win.getByRole('group', { name: 'The AI’s change' })).toHaveCount(0)
    // Keep: the note goes and the issue is ignored.
    await check.getByRole('button', { name: 'Keep' }).click()
    await expect(check).toHaveCount(0)
    await expect.poll(async () => (await invoke(win, 'listIssues', sceneId)).map((i) => i.status)).toContain('ignored')

    // The memory reads the scene: one note, "Memory · N facts updated", beside the words it learned from.
    await invoke(win, 'updateMemoryNow', sceneId)
    const memory = win.locator('[data-slip^="memory:"]')
    await expect(memory).toBeVisible({ timeout: 30_000 })
    await expect(memory).toContainText(/Memory · \d+ facts? updated/)
    await expect(memory).toContainText('Wren Halloway')
    // A click opens What changed for the scene.
    await memory.getByRole('button', { name: /Open What changed/ }).click()
    await expect(win.getByRole('heading', { name: /What changed/ }).first()).toBeVisible()
  } finally {
    await fake.close()
  }
})

test('arrival: a room’s pieces arrive the first time it shows, never again; the first scene’s guide is a slip at the top of the sheet', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  // The World room, first time: its sheet rises in. Again later: it is simply there.
  await room(win, 'World').click()
  await expect(win.locator('[data-desk-room="world"]')).toHaveAttribute('data-arrive', 'true')
  await room(win, 'Plan').click()
  await expect(win.locator('[data-desk-room="plan"]')).toBeVisible()
  await room(win, 'World').click()
  await expect(win.locator('[data-desk-room="world"]')).toBeVisible()
  await expect(win.locator('[data-desk-room="world"]')).not.toHaveAttribute('data-arrive', 'true')
  // Back to writing: the spine doesn't slide in again.
  await room(win, 'Write').click()
  await expect(spine(win)).toBeVisible()
  await expect(spine(win)).not.toHaveAttribute('data-arrive', 'true')

  // The first scene's guide, on the desk: a slip at the top of the sheet, above the scene's head, never over the words.
  const [first] = await invoke(win, 'listStories')
  const { chapters } = await invoke(win, 'getOutline', first.id)
  const empty = await invoke(win, 'createScene', chapters[1].id, { title: 'The Fog Bell' })
  // (The scene open before it is done, with beats on its card: its chip says so, and mustn't carry over.)
  const { scenes } = await invoke(win, 'getOutline', first.id)
  const lamp = await invoke(win, 'getScene', scenes[0].id)
  await invoke(win, 'updateSceneCard', scenes[0].id, { ...lamp.card, beats: ['Wren climbs the hundred and twelve steps'] })
  const worldId = (await invoke(win, 'getWorld'))!.id
  await invoke(win, 'updateSettings', { firstRun: { worldId, step: 'guide', sceneId: empty.id } })
  await win.reload()
  await expect(win.locator('[data-desk-chip]')).toContainText('Scene done')
  await story(win).getByRole('treeitem', { name: /The Fog Bell/ }).click()
  await expect(win.locator('[data-page-title] h1')).toHaveText('The Fog Bell')
  await expect(win.locator('[data-desk-chip]')).toHaveCount(0)
  const guide = win.getByRole('region', { name: 'Your first scene' })
  await expect(guide).toBeVisible()
  await expect(win.locator('.desk-sheet [data-desk-guide]')).toHaveCount(1)
  await expect(guide).toContainText('Fill in the scene card')
  // The empty page's placeholder points at the dock (the desk has no Generate button).
  await expect(win.locator('.scene-prose p.is-editor-empty').first()).toHaveAttribute('data-placeholder', 'Start writing, or use Draft the scene below.')
  await expect(guide.getByRole('button', { name: 'Open the scene card' })).toBeVisible()
  const [g, head, prose] = [(await guide.boundingBox())!, (await win.locator('[data-page-title]').boundingBox())!, (await win.locator('.scene-prose').boundingBox())!]
  expect(g.y + g.height).toBeLessThanOrEqual(head.y + 1)
  expect(g.y + g.height).toBeLessThanOrEqual(prose.y)
  await guide.getByRole('button', { name: 'Close the guide' }).click()
  await expect(guide).toHaveCount(0)
  await expect.poll(async () => (await invoke(win, 'getSettings')).firstRun ?? null).toBeNull()
})

test('beat markers on the sheet: each beat’s label lies on the sheet above its first line, and its band runs where the lamp line does', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 5, words: 60, varyBeats: true })
  try {
    const { app, win } = await sampleWorld(launch)
    const [story] = await invoke(win, 'listStories')
    const { scenes } = await invoke(win, 'getOutline', story.id)
    const card = (await invoke(win, 'getScene', scenes[0].id)).card
    await invoke(win, 'updateSceneCard', scenes[0].id, { ...card, beats: ['Wren climbs to the lamp room.', 'Edric watches the ferry.'], targetWords: 1500 })
    await useFakeModel(win, fake)
    const bar = win.locator('[data-beat-bar]')
    const menu = await dockMenu(win)
    await menu.getByRole('menuitem', { name: 'Beat by beat' }).click()
    await win.getByRole('button', { name: 'Add below', exact: true }).filter({ hasText: 'The new draft goes below' }).click()
    await expect(bar.getByRole('status')).toHaveText('Beat 2 of 2', { timeout: 30_000 })
    await bar.getByRole('button', { name: 'Write the next beat', exact: true }).click()
    await expect(bar.getByRole('status')).toHaveText('All 2 beats are written', { timeout: 30_000 })
    for (const [w, h] of [[1920, 1080], [1280, 800]] as const) {
      await size(app, win, w, h)
      const second = win.locator('.scene-prose p[data-beat="2"]').first()
      await second.scrollIntoViewIfNeeded()
      await second.hover()
      const label = win.locator('[data-beat-label="2"]')
      await expect(label.getByRole('button', { name: /^Beat 2/ })).toHaveCSS('opacity', '1')
      const sheet = (await win.locator('.desk-sheet').boundingBox())!
      const tag = (await label.boundingBox())!
      const first = (await second.boundingBox())!
      // On the sheet (once it lay half on the desk, past the sheet's edge), and above the beat's first line.
      expect(tag.x, `label inside the sheet at ${w}`).toBeGreaterThanOrEqual(sheet.x)
      expect(tag.y + tag.height, `label above the beat at ${w}`).toBeLessThanOrEqual(first.y + 1)
      // The band stands where the lamp line does (-28px, 2px wide, inside the band's 3px).
      expect(await second.evaluate((p) => getComputedStyle(p, '::before').left)).toBe('-29px')
    }
  } finally {
    await fake.close()
  }
})
