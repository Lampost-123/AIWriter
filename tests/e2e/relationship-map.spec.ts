// The desk's relationship map (UI overhaul), walked through on the sample world: medallions and kinds of tie, pointing
// at a character lights its ties and shows both sides' feelings, a character's card and a tie's history, the timeline
// strip changing who is tied and saying what changed, the keyboard, dragging a character, and less motion. The panels
// and Classic keep their own map (world-views.spec.ts).
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, invoke, test, type LaunchOptions } from './helpers'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk', AIWRITE_KEEPER_QUIET_MS: '600000' }
const canvas = (win: Page) => win.getByRole('group', { name: 'Relationship map' })
const node = (win: Page, name: string) => canvas(win).locator('[data-map-node]').filter({ hasText: name })
const pill = (win: Page, words: string) => canvas(win).locator('[data-map-tie]').filter({ hasText: words })
const strip = (win: Page) => win.getByRole('slider', { name: 'As of' })

async function sampleMap(
  launch: (o?: LaunchOptions) => Promise<{ app: ElectronApplication; win: Page; dataDir: string }>,
  opts: LaunchOptions = {}
): Promise<{ app: ElectronApplication; win: Page; dataDir: string }> {
  const a = await launch({ ...opts, env: { ...DESK, ...opts.env } })
  await expect(a.win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(a.win, 'openSampleWorld')
  await a.win.reload()
  await expect(a.win.locator('.scene-prose')).toContainText('A hundred and twelve steps to the lamp room.')
  await a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 960))
  await expect.poll(() => a.win.evaluate('innerWidth')).toBe(1600)
  await openMap(a.win)
  return a
}

async function openMap(win: Page): Promise<void> {
  await win.getByRole('navigation', { name: 'Rooms' }).getByRole('button', { name: /^World/ }).click()
  await win.locator('[data-desk-room] [data-desk-sublinks]').getByRole('button', { name: 'Relationship map' }).click()
  await expect(node(win, 'Wren Halloway')).toBeVisible()
  // Let the room's arrival and the medallions' entrance finish.
  await win.waitForTimeout(700)
}

/** An element's opacity as drawn (its own and its parents' multiplied). */
const opacity = (l: ReturnType<Page['locator']>) =>
  l.evaluate((el) => {
    let o = 1
    for (let e: typeof el | null = el; e; e = e.parentElement) o *= Number(el.ownerDocument.defaultView!.getComputedStyle(e).opacity)
    return o
  })

test('medallions, kinds of tie and the strip: the sample world as of the scene Adam is in', async ({ launch }) => {
  const { win } = await sampleMap(launch)
  // Three characters, each a medallion with its drawing, the protagonist the largest and the point of view marked.
  await expect(canvas(win).locator('[data-map-node]')).toHaveCount(3)
  await expect(node(win, 'Wren Halloway')).toHaveAttribute('data-rank', 'lead')
  await expect(node(win, 'Wren Halloway')).toHaveAttribute('data-pov')
  await expect(node(win, 'Wren Halloway')).toContainText('Protagonist')
  await expect(node(win, 'Edric Halloway').locator('.aw-motif')).toHaveCount(1)
  const size = async (name: string) => (await node(win, name).boundingBox())!.width
  expect(await size('Wren Halloway')).toBeGreaterThan(await size('Edric Halloway'))
  // Daughter and godfather are family ties, drawn as such and named in the legend.
  await expect(pill(win, 'daughter')).toHaveAttribute('data-kind', 'family')
  await expect(pill(win, 'godfather')).toHaveAttribute('data-kind', 'family')
  await expect(win.locator('[data-map-legend]')).toContainText('Family 2')
  await expect(win.locator('[data-map-count]')).toHaveText('3 characters · 2 ties')
  // The strip: a stop for the start and each scene, the one shown named, with its chapter.
  await expect(win.locator('[data-map-stop]')).toHaveCount(5)
  await expect(strip(win)).toHaveAttribute('aria-valuetext', /Ch 1, Sc 1$/)
  await expect(win.locator('[data-map-timeline]')).toContainText('Lighting the Lamp')
  await expect(win.locator('[data-map-timeline]')).toContainText('The Night Ferry')
  // The map uses the sheet: its characters spread over most of the canvas, not a small cluster in the middle.
  const c = (await canvas(win).boundingBox())!
  const xs: number[] = []
  const ys: number[] = []
  for (const name of ['Wren Halloway', 'Edric Halloway', 'Ansel Crane']) {
    const b = (await node(win, name).boundingBox())!
    xs.push(b.x + b.width / 2)
    ys.push(b.y + b.height / 2)
  }
  const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  expect(spread).toBeGreaterThan(Math.min(c.width, c.height) * 0.35)
})

test('pointing at a character lights its ties and shows how both sides feel; a click opens its card', async ({ launch }) => {
  const { win } = await sampleMap(launch)
  // Edric: his tie to Wren lights and opens out with both feelings; Ansel and his tie step back.
  await node(win, 'Edric Halloway').hover()
  const daughter = pill(win, 'daughter')
  await expect(daughter).toHaveClass(/is-open/)
  await expect(daughter).toContainText('Wren →')
  await expect(daughter).toContainText('Fiercely protective')
  await expect(daughter).toContainText('Edric →')
  await expect(daughter).toContainText('Proud of her, and ashamed to need her')
  await expect.poll(() => opacity(node(win, 'Ansel Crane'))).toBeLessThan(0.5)
  await expect.poll(() => opacity(node(win, 'Wren Halloway'))).toBeGreaterThan(0.9)
  await win.mouse.move(2, 2)
  await expect.poll(() => opacity(node(win, 'Ansel Crane'))).toBeGreaterThan(0.9)

  // A click: Wren's card, each tie with both feelings and since when.
  await node(win, 'Wren Halloway').click()
  const card = win.locator('[data-map-card="character"]')
  await expect(card).toBeVisible()
  await expect(card).toContainText('Wren Halloway')
  await expect(card).toContainText('Point of view here')
  await expect(card.locator('[data-map-card-tie]')).toHaveCount(2)
  const edric = card.locator('[data-map-card-tie]').filter({ hasText: 'Edric Halloway' })
  await expect(edric).toContainText('Wren → Fiercely protective; impatient with his pride')
  await expect(edric).toContainText('Edric → Proud of her, and ashamed to need her')
  await expect(edric).toContainText('Since before the story begins')
  // Esc closes it, back on Wren.
  await win.keyboard.press('Escape')
  await expect(card).toHaveCount(0)
  await expect(node(win, 'Wren Halloway')).toBeFocused()

  // Open page goes to her dossier.
  await node(win, 'Wren Halloway').click()
  await card.getByRole('button', { name: 'Open page' }).click()
  await expect(win.getByRole('dialog').filter({ has: win.locator('.dz') })).toBeVisible()
})

test('the strip changes who is tied, says what changed, and a tie’s card tells its history', async ({ launch }) => {
  const { win } = await sampleMap(launch)
  const wren = async () => node(win, 'Wren Halloway').boundingBox()
  const before = await wren()
  await expect(node(win, 'Iska Vey')).toHaveCount(0)
  // Low Tide, the last scene: Iska and Wren become uneasy allies.
  await strip(win).focus()
  await win.keyboard.press('End')
  await expect(node(win, 'Iska Vey')).toBeVisible()
  await expect(pill(win, 'uneasy allies')).toBeVisible()
  await expect(pill(win, 'uneasy allies')).toHaveAttribute('data-kind', 'duty')
  await expect(win.locator('[data-map-note]')).toContainText('New')
  await expect(win.locator('[data-map-note]')).toContainText('Iska Vey and Wren Halloway: uneasy allies')
  await expect(win.locator('[data-map-count]')).toHaveText('4 characters · 3 ties')
  await expect(win.locator('[data-map-timeline]')).toContainText('Low Tide')
  // A keyboard move is quick.
  await expect(win.locator('[data-desk-map]')).toHaveAttribute('data-quick')
  // Characters keep their places as the strip moves.
  await expect.poll(async () => JSON.stringify(await wren())).toBe(JSON.stringify(before))

  // The tie's card: both of them, how each feels (one warm, one wary), and where it began.
  await pill(win, 'uneasy allies').click()
  const card = win.locator('[data-map-card="tie"]')
  await expect(card).toBeVisible()
  await expect(card).toContainText('Lopsided')
  await expect(card).toContainText('Admires her nerve')
  await expect(card).toContainText('Doesn’t trust her yet, but needs her')
  const history = card.locator('[data-map-history] li')
  await expect(history).toHaveCount(1)
  await expect(history.first()).toContainText('Ch 2 · Sc 2')
  await expect(history.first()).toContainText('Now')

  // Back to the start: Iska is gone again, and the card with her.
  await card.getByRole('button', { name: 'Close' }).click()
  await strip(win).focus()
  await win.keyboard.press('Home')
  await expect(node(win, 'Iska Vey')).toHaveCount(0)
  await expect(pill(win, 'uneasy allies')).toHaveCount(0)
  // A click on a stop goes there; the note says when nothing changes.
  await win.locator('[data-map-stop]').nth(2).click()
  await expect(strip(win)).toHaveAttribute('aria-valuetext', /Ch 1, Sc 2$/)
  await expect(win.locator('[data-map-note]')).toContainText('No ties change in this scene')
  await expect(win.locator('[data-desk-map]')).not.toHaveAttribute('data-quick')
})

test('the keyboard: arrows move between characters, Enter opens a card, Esc closes it', async ({ launch }) => {
  const { win } = await sampleMap(launch)
  await canvas(win).focus()
  await win.keyboard.press('ArrowRight')
  // The first arrow goes to the point of view.
  await expect(node(win, 'Wren Halloway')).toBeFocused()
  const seen = new Set<string>()
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
    await win.keyboard.press(key)
    seen.add((await win.evaluate<string>('document.activeElement?.getAttribute("aria-label") ?? ""')) || '')
  }
  // Somewhere along the way it reached someone other than Wren.
  expect([...seen].some((n) => n === 'Edric Halloway' || n === 'Ansel Crane')).toBe(true)
  const name = await win.evaluate<string>('document.activeElement?.getAttribute("aria-label") ?? ""')
  await win.keyboard.press('Enter')
  await expect(win.locator('[data-map-card="character"]')).toContainText(name)
  await win.keyboard.press('Escape')
  await expect(win.locator('[data-map-card]')).toHaveCount(0)
  await expect(node(win, name)).toBeFocused()
  // + zooms in, 0 fits again.
  const w = async () => (await node(win, 'Wren Halloway').boundingBox())!.x
  await win.keyboard.press('0')
  await win.waitForTimeout(400)
  const x0 = await w()
  await win.keyboard.press('+')
  await expect.poll(w).not.toBe(x0)
  await win.keyboard.press('0')
  await expect.poll(w).toBeCloseTo(x0, 0)
})

test('a dragged character keeps its new place, after a restart too', async ({ launch }) => {
  const { win } = await sampleMap(launch)
  const storyId = (await invoke(win, 'listStories'))[0].id
  const place = async () => {
    const m = await invoke(win, 'getRelationshipMap', storyId, null, null)
    const n = m.nodes.find((x) => x.name === 'Ansel Crane')!
    return { x: n.x, y: n.y }
  }
  const start = await place()
  const ansel = node(win, 'Ansel Crane')
  const b = (await ansel.boundingBox())!
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  await win.mouse.move(cx, cy)
  await win.mouse.down()
  for (let i = 1; i <= 8; i++) await win.mouse.move(cx - i * 12, cy + i * 6)
  await win.mouse.up()
  // It moved on screen, and the drag didn't open its card.
  await expect(win.locator('[data-map-card]')).toHaveCount(0)
  expect((await ansel.boundingBox())!.x - b.x).toBeLessThan(-80)
  // Kept with the world, left and down of where it was.
  await expect.poll(async () => (await place()).x).toBeLessThan(start.x - 20)
  const kept = await place()
  expect(kept.y).toBeGreaterThan(start.y)
  // After a reload it is still there.
  await win.reload()
  await openMap(win)
  expect(await place()).toEqual(kept)
})

test('with less motion the map changes at once: nothing draws, glides or fades', async ({ launch }) => {
  const { win } = await sampleMap(launch)
  await win.emulateMedia({ reducedMotion: 'reduce' })
  const running = () =>
    win.evaluate<number>(
      `document.getAnimations().filter((a) => a.playState === 'running' && Number(a.effect?.getTiming().duration) > 1 && a.effect?.target?.closest?.('[data-desk-map]')).length`
    )
  await strip(win).focus()
  await win.keyboard.press('End')
  await expect(node(win, 'Iska Vey')).toBeVisible()
  expect(await running()).toBe(0)
  await node(win, 'Wren Halloway').hover()
  expect(await running()).toBe(0)
  await node(win, 'Wren Halloway').click()
  await expect(win.locator('[data-map-card]')).toBeVisible()
  expect(await running()).toBe(0)
  await win.emulateMedia({ reducedMotion: 'no-preference' })
})

test('the panels keep their own map', async ({ launch }) => {
  const { win } = await launch({ env: { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'panels' } })
  await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(win, 'openSampleWorld')
  await win.reload()
  await expect(win.locator('.scene-prose')).toBeVisible()
  await win.keyboard.press('Control+K')
  await win.keyboard.type('Relationship map')
  await win.getByRole('option', { name: /^Relationship map/ }).first().click()
  await expect(win.getByRole('group', { name: 'Relationship map' })).toBeVisible()
  await expect(win.locator('[data-desk-map]')).toHaveCount(0)
  await expect(win.getByRole('slider', { name: 'As of' })).toBeVisible()
})
