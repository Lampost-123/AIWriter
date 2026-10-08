// The desk's World room (UI overhaul phase 4), walked through on the sample world: the gallery of everything in the
// world beside the story's spine (kind tabs whose counts match what they show, the underline, the cards in their own
// materials, coming back to where Adam was), and the room's other pages in its frame.
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, invoke, test, type LaunchOptions } from './helpers'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk' }
const rooms = (win: Page) => win.getByRole('navigation', { name: 'Rooms' })
const room = (win: Page, name: string) => rooms(win).getByRole('button', { name: new RegExp(`^${name}`) })
const gallery = (win: Page) => win.locator('[data-world-gallery]')
const tab = (win: Page, name: string) => gallery(win).getByRole('tab', { name: new RegExp(`^${name}`) })
const cards = (win: Page) => gallery(win).locator('[data-gallery-card]')
const pane = (win: Page) => gallery(win).locator('.g-pane')

async function sampleWorld(
  launch: (o?: LaunchOptions) => Promise<{ app: ElectronApplication; win: Page; dataDir: string }>,
  opts: LaunchOptions = {}
): Promise<{ app: ElectronApplication; win: Page; dataDir: string }> {
  const a = await launch({ ...opts, env: { ...DESK, AIWRITE_KEEPER_QUIET_MS: '600000', ...opts.env } })
  await expect(a.win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(a.win, 'openSampleWorld')
  await a.win.reload()
  await expect(a.win.locator('.scene-prose')).toContainText('A hundred and twelve steps to the lamp room.')
  return a
}

async function size(app: ElectronApplication, win: Page, w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [cw, ch]) => BrowserWindow.getAllWindows()[0].setContentSize(cw, ch), [w, h] as [number, number])
  await expect.poll(async () => Math.abs(((await win.evaluate('innerWidth')) as number) - w)).toBeLessThanOrEqual(1)
}

test('the gallery: a tab for each kind, counting what it holds; each tab shows just those cards, the underline under it', async ({
  launch
}) => {
  const { win } = await sampleWorld(launch)
  await room(win, 'World').click()
  await expect(gallery(win)).toBeVisible()
  await expect(gallery(win).getByRole('heading', { level: 1 })).toContainText('Gullhaven')
  await expect(gallery(win).getByText('4 characters · 3 places · 1 group · 1 lore · 2 plot threads')).toBeVisible()

  // The counts are the world's: every entry, plot threads too.
  const entries = await invoke(win, 'listEntries')
  const counts: Record<string, number> = {}
  for (const e of entries) counts[e.kind] = (counts[e.kind] ?? 0) + 1
  const expected: [string, string, number][] = [
    ['All', 'all', entries.length],
    ['Characters', 'character', counts.character],
    ['Places', 'place', counts.place],
    ['Groups', 'group', counts.group],
    ['Lore', 'lore', counts.lore],
    ['Plot threads', 'thread', counts.thread]
  ]
  expect(entries.length).toBe(11)
  await expect(gallery(win).getByRole('tab')).toHaveCount(expected.length)
  await expect(cards(win)).toHaveCount(11)
  const underline = gallery(win).locator('.g-uline')
  let clip = ''
  for (const [label, kind, n] of expected) {
    await tab(win, label).click()
    await expect(tab(win, label)).toHaveAttribute('aria-selected', 'true')
    await expect(tab(win, label).locator('.g-count')).toHaveText(String(n))
    await expect(cards(win)).toHaveCount(n)
    if (kind !== 'all') {
      // Only that kind's section, its heading counting its cards.
      await expect(gallery(win).locator('.g-sec[data-kind]')).toHaveCount(1)
      await expect(gallery(win).locator(`.g-sec[data-kind="${kind}"] .g-n`)).toHaveText(String(n))
      // The room's "By kind" link lights up, saying which.
      await expect(win.locator('[data-desk-room] [data-desk-sublinks] [aria-current="page"]')).toContainText(label)
    }
    // The underline follows, in the kind's ink.
    await expect(underline).toHaveAttribute('data-kind', kind)
    const now = await underline.getAttribute('style').then((v) => v ?? '')
    expect(now).not.toBe(clip)
    clip = now
  }

  // Cards are drawn as their kind's material, the story's lead larger.
  await tab(win, 'All').click()
  await expect(cards(win)).toHaveCount(11)
  expect(await gallery(win).locator('[data-shape="portrait"][data-gallery-card]').count()).toBe(counts.character)
  expect(await gallery(win).locator('[data-shape="landscape"][data-gallery-card]').count()).toBe(counts.place)
  expect(await gallery(win).locator('[data-shape="index"][data-gallery-card]').count()).toBe(counts.thread)
  await expect(gallery(win).locator('[data-featured][data-gallery-card]')).toHaveCount(1)
  await expect(gallery(win).locator('[data-featured][data-gallery-card]')).toHaveAttribute('aria-label', /^Wren Halloway/)

  // From the keyboard the tabs move with the arrows, at once.
  await tab(win, 'All').focus()
  await win.keyboard.press('ArrowRight')
  await expect(tab(win, 'Characters')).toHaveAttribute('aria-selected', 'true')
  await expect(tab(win, 'Characters')).toBeFocused()
  await expect(cards(win)).toHaveCount(counts.character)
  await expect(gallery(win).locator('.g-gal')).not.toHaveAttribute('data-leaving', 'true')

  // The room's "By kind" link and the palette land on the same tab.
  await win.keyboard.press('Control+K')
  await win.keyboard.type('places')
  await win.keyboard.press('Enter')
  await expect(tab(win, 'Places')).toHaveAttribute('aria-selected', 'true')
  await expect(cards(win)).toHaveCount(counts.place)

  // Find narrows the cards; the tabs keep the world's counts.
  await tab(win, 'All').click()
  await gallery(win).getByRole('searchbox', { name: 'Find in the world' }).fill('Halloway')
  await expect(cards(win)).toHaveCount(2)
  await expect(tab(win, 'All').locator('.g-count')).toHaveText('11')
  await gallery(win).getByRole('button', { name: 'Clear search' }).click()
  await expect(cards(win)).toHaveCount(11)
})

test('the gallery is where Adam left it when he comes back, scrolled to the same card', async ({ launch }) => {
  const { app, win } = await sampleWorld(launch)
  await size(app, win, 1280, 720)
  await room(win, 'World').click()
  await expect(cards(win)).toHaveCount(11)
  await pane(win).evaluate((e) => (e.scrollTop = 520))
  await win.waitForTimeout(100)
  const was = await pane(win).evaluate((e) => e.scrollTop)
  expect(was).toBeGreaterThan(300)
  await room(win, 'Write').click()
  await expect(win.locator('.desk-sheet')).toBeVisible()
  await room(win, 'World').click()
  await expect(cards(win)).toHaveCount(11)
  await expect.poll(() => pane(win).evaluate((e) => e.scrollTop)).toBeGreaterThan(was - 3)
  expect(Math.abs((await pane(win).evaluate((e) => e.scrollTop)) - was)).toBeLessThan(3)
})

test('the World room beside the story’s spine: the sheet clear of it and centred in the room it leaves, from 1280 to 2560 wide', async ({
  launch
}) => {
  const { app, win } = await sampleWorld(launch)
  await room(win, 'World').click()
  await expect(gallery(win)).toBeVisible()
  const spine = win.locator('[data-desk-spine]')
  const sheet = win.locator('.desk-room-sheet')
  for (const [w, h] of [
    [1280, 800],
    [1366, 768],
    [1440, 900],
    [1920, 1080],
    [2560, 1440]
  ] as const) {
    await size(app, win, w, h)
    await win.waitForTimeout(400)
    await expect(spine).toHaveAttribute('data-shape', 'full')
    const s = (await spine.locator('.spine-capsule').boundingBox())!
    const p = (await sheet.boundingBox())!
    // Clear of the spine, and nothing spills past the window.
    expect(p.x, `${w}: sheet clear of the spine`).toBeGreaterThanOrEqual(s.x + s.width + 16)
    expect(p.x + p.width, `${w}: sheet inside the window`).toBeLessThanOrEqual(w)
    const spill = await win.evaluate<number>('document.documentElement.scrollWidth - innerWidth')
    expect(spill).toBeLessThanOrEqual(0)
    // Centred in the room right of the spine.
    const left = p.x - (s.x + s.width)
    const right = w - (p.x + p.width)
    expect(Math.abs(left - right), `${w}: centred`).toBeLessThanOrEqual(Math.max(24, w * 0.02))
    // Its tools and tabs don't run into each other.
    const tabs = (await gallery(win).getByRole('tablist').boundingBox())!
    const order = (await gallery(win).locator('.g-order').boundingBox())!
    expect(tabs.x + tabs.width).toBeLessThanOrEqual(order.x + 1)
  }
  // A window too narrow for the full spine: the slim one, and the sheet beside it.
  await size(app, win, 1100, 800)
  await expect(spine).toHaveAttribute('data-shape', 'slim')
  await win.waitForTimeout(400)
  const s = (await spine.locator('.spine-slim').boundingBox())!
  const p = (await sheet.boundingBox())!
  expect(p.x).toBeGreaterThanOrEqual(s.x + s.width + 16)
})

test('the World room’s other pages open in its frame beside the spine: by kind, the map, the timeline, building from a summary', async ({
  launch
}) => {
  const { app, win } = await sampleWorld(launch)
  await size(app, win, 1440, 900)
  await room(win, 'World').click()
  const links = win.locator('[data-desk-room] [data-desk-sublinks]')
  const spine = win.locator('[data-desk-spine]')
  const sheet = win.locator('.desk-room-sheet')
  const clear = async (what: string): Promise<void> => {
    const s = (await spine.locator('.spine-capsule').boundingBox())!
    const p = (await sheet.boundingBox())!
    expect(p.x, what).toBeGreaterThanOrEqual(s.x + s.width + 16)
    expect(await win.evaluate<number>('document.documentElement.scrollWidth - innerWidth'), what).toBeLessThanOrEqual(0)
  }
  await links.getByRole('button', { name: /^By kind/ }).click()
  await win.getByRole('menuitem', { name: /^Characters/ }).click()
  await expect(tab(win, 'Characters')).toHaveAttribute('aria-selected', 'true')
  await clear('by kind')
  await links.getByRole('button', { name: 'Relationship map' }).click()
  await expect(win.locator('[data-desk-room="world"]')).toBeVisible()
  await expect(links.getByRole('button', { name: 'Relationship map' })).toHaveAttribute('aria-current', 'page')
  await expect(gallery(win)).toHaveCount(0)
  await clear('map')
  await links.getByRole('button', { name: 'Timeline' }).click()
  await expect(links.getByRole('button', { name: 'Timeline' })).toHaveAttribute('aria-current', 'page')
  await clear('timeline')
  await links.getByRole('button', { name: 'Build from a summary' }).click()
  await expect(links.getByRole('button', { name: 'Build from a summary' })).toHaveAttribute('aria-current', 'page')
  await clear('build from a summary')
  // Back to everything.
  await links.getByRole('button', { name: /^Everything/ }).click()
  await expect(tab(win, 'All')).toHaveAttribute('aria-selected', 'true')
})
