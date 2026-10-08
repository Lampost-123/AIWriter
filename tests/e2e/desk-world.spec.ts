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
  await gallery(win)
    .getByRole('button', { name: /^Order: / })
    .click()
  await win.getByRole('menuitemradio', { name: 'First appearance' }).click()
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
    // Its tools and tabs don't run into each other, and every tab shows whole (with the longest order chosen too).
    const tabs = (await gallery(win).getByRole('tablist').boundingBox())!
    const order = (await gallery(win).locator('.g-order').boundingBox())!
    expect(tabs.x + tabs.width).toBeLessThanOrEqual(order.x + 1)
    expect(
      await gallery(win)
        .getByRole('tablist')
        .evaluate((e) => e.scrollWidth - e.clientWidth),
      `${w}: tabs whole`
    ).toBeLessThanOrEqual(1)
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

const dossier = (win: Page) => win.getByRole('dialog').filter({ has: win.locator('.dz') })
const card = (win: Page, name: string) =>
  gallery(win)
    .locator('[data-gallery-card]')
    .filter({ has: win.locator('.g-name, .g-title', { hasText: name }) })
    .first()

test('a card opens its dossier: its sections, edited where they are shown; Esc goes back with the keyboard on the card', async ({
  launch
}) => {
  const { win } = await sampleWorld(launch)
  await room(win, 'World').click()
  const ansel = card(win, 'Ansel Crane')
  await ansel.focus()
  await win.keyboard.press('Enter')
  const d = dossier(win)
  await expect(d).toBeVisible()
  // The keyboard is on its heading; the gallery and the spine under it are out of reach.
  await expect(d.getByRole('heading', { level: 2 })).toBeFocused()
  await expect(gallery(win).locator('xpath=..')).toHaveAttribute('inert', '')
  await expect(d.getByRole('textbox', { name: 'Name' })).toHaveValue('Ansel Crane')
  await expect(d.locator('.dz-kicker')).toHaveText(/^Character · in \d+ scenes?$/)
  await expect(d.locator('.dz-fact', { hasText: 'Role' })).toContainText('Supporting')
  await expect(d.getByRole('button', { name: /^First appears: / })).toBeVisible()
  // The room's card stepped out: it became the dossier.
  await expect(ansel).toHaveAttribute('data-opened', 'true')

  // A section: its words, then Edit turns them into its fields; Done (or Esc in a field) turns them back.
  const looks = d.locator('[data-dz-section="looks"]')
  await looks.hover()
  await looks.getByRole('button', { name: 'Edit looks' }).click()
  // The keyboard goes to its first field.
  await expect(looks.getByLabel('Build', { exact: true })).toBeFocused()
  const eyes = looks.getByLabel('Eyes', { exact: true })
  await eyes.fill('pale, watchful grey')
  await win.keyboard.press('Escape')
  await expect(looks.getByLabel('Eyes', { exact: true })).toHaveCount(0)
  await expect(looks.getByRole('button', { name: 'Edit looks' })).toBeFocused()
  // (Esc in a field only finished the editing: the dossier is still open.)
  await expect(d).toBeVisible()
  await expect(looks).toContainText('pale, watchful grey')
  const id = (await ansel.getAttribute('data-gallery-card'))!
  await expect.poll(async () => (await invoke(win, 'getEntry', id)).fields.eyes).toBe('pale, watchful grey')

  // The name and the one-liner are edited as they stand; the card under the dossier follows.
  await d.getByRole('textbox', { name: 'Short summary' }).fill('The harbourmaster, who knows everyone')
  await expect.poll(async () => (await invoke(win, 'getEntry', id)).summary).toBe('The harbourmaster, who knows everyone')
  await expect(ansel).toContainText('The harbourmaster, who knows everyone')

  // A relationship opens the other entry's dossier in its place.
  const rel = d.locator('.dz-rel').first()
  const other = (await rel.locator('.dz-rel-n').textContent())!
  await rel.click()
  await expect(dossier(win).getByRole('textbox', { name: 'Name' })).toHaveValue(other)

  // Esc: back to the gallery, the keyboard on that entry's card.
  await win.locator('body').press('Escape')
  await expect(dossier(win)).toHaveCount(0)
  await expect(card(win, other)).toBeFocused()
  await expect(ansel).not.toHaveAttribute('data-opened', 'true')
})

test('the dossier does what the entry page does: as of a scene, "Appears in" opens a scene at its words, first appears with Undo, the portrait', async ({
  launch
}) => {
  const { win } = await sampleWorld(launch)
  const iska = (await invoke(win, 'listEntries', 'character')).find((e) => e.name === 'Iska Vey')!
  // A picture, as the interface gives one.
  const picture = (await win.evaluate(`(async () => {
    const canvas = new OffscreenCanvas(240, 240)
    canvas.getContext('2d').fillRect(0, 0, 240, 240)
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 })
    const res = await window.aiwrite.invoke('setEntryImage', ${JSON.stringify(iska.id)}, { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type })
    if (!res.ok) throw new Error(res.error.message)
    return res.value.image
  })()`)) as string
  await room(win, 'World').click()
  // The card shows the portrait as its picture; so does the dossier.
  await expect(card(win, 'Iska Vey').locator('img')).toHaveAttribute('src', picture)
  await card(win, 'Iska Vey').click()
  const d = dossier(win)
  await expect(d).toBeVisible()
  await expect(d.locator('.dz-portrait img')).toHaveAttribute('src', picture)

  // As of a scene: the slider, and back to editing.
  await d.getByRole('button', { name: 'View as of a scene' }).click()
  const slider = d.getByRole('slider', { name: 'As of' })
  await expect(slider).toBeFocused()
  await slider.press('Home')
  await expect(slider).toHaveAttribute('aria-valuetext', /^Start of /)
  await d.getByRole('button', { name: 'Back to editing' }).click()
  await expect(d.getByRole('slider', { name: 'As of' })).toHaveCount(0)
  await expect(d.getByRole('button', { name: 'View as of a scene' })).toBeFocused()

  // Where it first appears, changed and undone.
  const first = d.getByRole('button', { name: /^First appears: / })
  const was = (await first.textContent())!.trim()
  await first.click()
  const panel = win.getByRole('dialog').filter({ hasText: 'Worked out for you' })
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Add another point in the story' }).click()
  await panel.getByRole('combobox').fill('ch 2 sc 2')
  await win.getByRole('option', { name: /Ch 2, Sc 2/ }).click()
  await win.keyboard.press('Escape')
  await expect(d).toBeVisible()
  await expect.poll(async () => (await invoke(win, 'listFirstExists', iska.id)).length).toBe(2)
  await win.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await invoke(win, 'listFirstExists', iska.id)).length).toBe(1)
  await expect(d.getByRole('button', { name: /^First appears: / })).toHaveText(was)

  // "Appears in": a scene opens at the words that name her.
  const row = d
    .locator('[data-dz-section="appears"]')
    .getByRole('button', { name: /Ch \d, Sc \d/ })
    .last()
  const quote = ((await row.locator('.italic').textContent()) ?? '').replace(/^“…?|…?”$/g, '')
  await row.click()
  await expect(win.locator('.scene-prose')).toBeVisible()
  await expect(dossier(win)).toHaveCount(0)
  const chosen = (): Promise<string> =>
    win.evaluate(() => (globalThis as unknown as { getSelection(): { toString(): string } | null }).getSelection()?.toString() ?? '')
  await expect.poll(chosen).toBe(quote)
})

/** Keeps each View Transition the window starts: what it was for (the root's mark) and the animations it ran. */
const watchTransitions = (win: Page): Promise<void> =>
  win.evaluate(`(() => {
    window.vts = []
    const start = document.startViewTransition.bind(document)
    document.startViewTransition = (update) => {
      const seen = { mark: document.documentElement.dataset.vt ?? '', parts: [] }
      window.vts.push(seen)
      const vt = start(update)
      vt.ready.then(() => {
        seen.parts = document.getAnimations()
          .filter((a) => a.effect && a.effect.pseudoElement)
          .map((a) => ({ part: a.effect.pseudoElement, ms: Number(a.effect.getTiming().duration), delay: Number(a.effect.getTiming().delay) }))
      }, () => undefined)
      return vt
    }
  })()`)
type Seen = { mark: string; parts: { part: string; ms: number; delay: number }[] }
const transitions = (win: Page): Promise<Seen[]> => win.evaluate<Seen[]>('window.vts')

test('the flip: a click turns the card into its dossier (a View Transition) and Back turns it back; Enter and Esc at once; less motion crossfades', async ({
  launch
}) => {
  const { win } = await sampleWorld(launch)
  await room(win, 'World').click()
  await expect(cards(win)).toHaveCount(11)
  await win.waitForTimeout(700)
  await watchTransitions(win)

  // A click: the card turns away and grows towards the dossier, which turns in after it.
  const wren = card(win, 'Wren Halloway')
  await wren.click()
  await expect(dossier(win)).toBeVisible()
  await expect.poll(async () => (await transitions(win)).length).toBe(1)
  await expect.poll(async () => (await transitions(win))[0].parts.length).toBeGreaterThan(0)
  const open = (await transitions(win))[0]
  expect(open.mark).toBe('page flip')
  expect(open.parts).toEqual(
    expect.arrayContaining([
      { part: '::view-transition-old(vt-card)', ms: 260, delay: 0 },
      { part: '::view-transition-new(vt-dossier)', ms: 260, delay: 260 }
    ])
  )
  // Once it has landed: no marks left, the keyboard on the dossier's heading.
  await expect.poll(() => win.evaluate<string | null>('document.documentElement.dataset.vt ?? null')).toBeNull()
  expect(await win.evaluate<string>(`document.documentElement.style.getPropertyValue('--flip-dx')`)).toBe('')
  await expect(dossier(win).getByRole('heading', { level: 2 })).toBeFocused()

  // Back (the pointer): the dossier turns away and the card turns back in; the keyboard on the card.
  await dossier(win).getByRole('button', { name: 'Back to the world' }).click()
  await expect(dossier(win)).toHaveCount(0)
  await expect.poll(async () => (await transitions(win)).length).toBe(2)
  await expect.poll(async () => (await transitions(win))[1].parts.length).toBeGreaterThan(0)
  const back = (await transitions(win))[1]
  expect(back.mark).toBe('page flip-back')
  expect(back.parts).toEqual(
    expect.arrayContaining([
      { part: '::view-transition-old(vt-dossier)', ms: 210, delay: 0 },
      { part: '::view-transition-new(vt-card)', ms: 210, delay: 210 }
    ])
  )
  await expect(wren).toBeFocused()
  await expect.poll(() => win.evaluate<string | null>('document.documentElement.dataset.vt ?? null')).toBeNull()

  // Enter on a card opens it at once, and Esc goes back at once with the keyboard on the card: no transitions.
  await wren.press('Enter')
  await expect(dossier(win)).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(dossier(win)).toHaveCount(0)
  await expect(wren).toBeFocused()
  expect(await transitions(win)).toHaveLength(2)

  // Less motion: a short crossfade of the page, nothing turns.
  await win.emulateMedia({ reducedMotion: 'reduce' })
  await card(win, 'Iska Vey').click()
  await expect(dossier(win)).toBeVisible()
  await expect.poll(async () => (await transitions(win)).length).toBe(3)
  await expect.poll(async () => (await transitions(win))[2].parts.length).toBeGreaterThan(0)
  const fade = (await transitions(win))[2]
  expect(fade.mark).toBe('page flip-fade')
  const vtParts = fade.parts.filter((p) => p.part.startsWith('::view-transition'))
  expect(vtParts.every((p) => /\((page|toasts)\)$/.test(p.part))).toBe(true)
  expect(fade.parts).toEqual(expect.arrayContaining([{ part: '::view-transition-new(page)', ms: 150, delay: 0 }]))
  await win.emulateMedia({ reducedMotion: 'no-preference' })
})

test('Classic and the panels have no flip: the codex opens an entry’s page as before', async ({ launch }) => {
  const a = await launch({ env: { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'panels', AIWRITE_KEEPER_QUIET_MS: '600000' } })
  await expect(a.win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(a.win, 'openSampleWorld')
  await a.win.reload()
  await expect(a.win.locator('.scene-prose')).toBeVisible()
  const win = a.win
  await win.getByRole('navigation', { name: 'Areas' }).getByRole('button', { name: 'World', exact: true }).click()
  await expect(win.locator('main').getByRole('heading', { level: 1, name: 'Codex' })).toBeVisible()
  await expect(win.locator('[data-world-gallery]')).toHaveCount(0)
  await win.waitForTimeout(500)
  await watchTransitions(win)
  await win.locator('main').getByRole('button', { name: 'Wren Halloway', exact: true }).click()
  await expect(win.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Wren Halloway')
  await expect(win.locator('[data-dossier]')).toHaveCount(0)
  // The panels' ordinary page crossfade, never a flip.
  await expect.poll(async () => (await transitions(win)).length).toBe(1)
  expect((await transitions(win))[0].mark).toBe('page')
})

test('the gallery orders by first appearance too, and the dossier says where it is first seen', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  await room(win, 'World').click()
  await expect(cards(win)).toHaveCount(11)
  await gallery(win)
    .getByRole('button', { name: /^Order: / })
    .click()
  await win.getByRole('menuitemradio', { name: 'First appearance' }).click()
  await expect(gallery(win).getByRole('button', { name: /^Order: / })).toHaveAccessibleName('Order: First appearance')
  await expect(gallery(win).locator('.g-sec[data-kind="character"] .g-hint')).toHaveText('in order of first appearance')
  // The order is the cards' first scenes in story order (those in no scene last, by name).
  const codex = await invoke(win, 'listCodex')
  const people = codex
    .filter((c) => c.kind === 'character')
    .sort((a, b) => (a.first?.order ?? Infinity) - (b.first?.order ?? Infinity) || a.name.localeCompare(b.name))
  const shown = await gallery(win)
    .locator('.g-sec[data-kind="character"] [data-gallery-card]')
    .evaluateAll((els) => els.map((e) => e.querySelector('.g-name')?.textContent ?? ''))
  expect(shown).toEqual(people.map((c) => c.name))
  // The dossier: "First seen" is that scene, and opens it.
  const lead = people[0]
  await card(win, lead.name).click()
  const fact = dossier(win).locator('.dz-fact', { hasText: 'First seen' })
  await expect(fact).toContainText(lead.first!.label.replace(/^.*?(?=Ch \d)/, ''))
  await fact.getByRole('button').click()
  await expect(dossier(win)).toHaveCount(0)
  await expect(win.locator('.scene-prose')).toBeVisible()
  expect((await invoke(win, 'getSettings')).lastSceneId).toBe(lead.first!.sceneId)
})

test('the story’s spine in every room: Plan, World, Check and the story’s home beside it, each clear of it and centred', async ({ launch }) => {
  const { app, win } = await sampleWorld(launch)
  const spine = win.locator('[data-desk-spine]')
  const sheet = win.locator('.desk-room-sheet')
  for (const [w, h] of [
    [1440, 900],
    [1920, 1080]
  ] as const) {
    await size(app, win, w, h)
    for (const name of ['Plan', 'World', 'Check']) {
      await room(win, name).click()
      await expect(win.locator('[data-desk-room]')).toHaveAttribute('data-spine', 'full')
      await win.waitForTimeout(400)
      await expect(spine).toHaveAttribute('data-shape', 'full')
      const s = (await spine.locator('.spine-capsule').boundingBox())!
      const p = (await sheet.boundingBox())!
      expect(p.x, `${name} at ${w}`).toBeGreaterThanOrEqual(s.x + s.width + 16)
      expect(Math.abs(p.x - (s.x + s.width) - (w - (p.x + p.width))), `${name} at ${w}: centred`).toBeLessThanOrEqual(24)
      expect(await win.evaluate<number>('document.documentElement.scrollWidth - innerWidth')).toBeLessThanOrEqual(0)
      if (name === 'Plan') {
        // The story board lies on the desk (its sheet steps aside), never under the spine.
        const b = (await win.locator('[data-desk-board]').boundingBox())!
        const first = (await win.locator('[data-board-card]').first().boundingBox())!
        expect(b.x, `the board at ${w}`).toBeGreaterThanOrEqual(s.x + s.width + 16)
        expect(first.x, `the board's first card at ${w}`).toBeGreaterThanOrEqual(s.x + s.width + 16)
      }
    }
    // The story's home, in no room, beside it too.
    await win.getByRole('button', { name: 'Story home' }).click()
    const col = win.locator('[data-desk-home] .home-col')
    await expect(col).toBeVisible()
    await win.waitForTimeout(400)
    await expect(spine).toHaveAttribute('data-shape', 'full')
    const s = (await spine.locator('.spine-capsule').boundingBox())!
    const c = (await col.boundingBox())!
    expect(c.x, `the home at ${w}`).toBeGreaterThanOrEqual(s.x + s.width + 16)
    expect(Math.abs(c.x - (s.x + s.width) - (w - (c.x + c.width))), `the home at ${w}: centred`).toBeLessThanOrEqual(32)
  }
  // A window too narrow for the full spine: the board beside the slim one.
  await size(app, win, 1100, 800)
  await room(win, 'Plan').click()
  await expect(spine).toHaveAttribute('data-shape', 'slim')
  await win.waitForTimeout(400)
  {
    const s = (await spine.locator('.spine-slim').boundingBox())!
    const first = (await win.locator('[data-board-card]').first().boundingBox())!
    expect(first.x, 'the board beside the slim spine').toBeGreaterThanOrEqual(s.x + s.width + 16)
  }
  await size(app, win, 1920, 1080)
  // Collapsed, it is the slim spine in every room, and the choice is kept.
  await room(win, 'Plan').click()
  await spine.getByRole('button', { name: 'Collapse to the spine' }).click()
  await expect(spine).toHaveAttribute('data-shape', 'slim')
  await room(win, 'Check').click()
  await expect(spine).toHaveAttribute('data-shape', 'slim')
  await expect(win.locator('[data-desk-room]')).toHaveAttribute('data-spine', 'slim')
  await expect.poll(async () => (await invoke(win, 'getSettings')).layout.deskStory).toBe('slim')
  // Settings belongs to no room: no spine.
  await win.keyboard.press('Control+,')
  await expect(win.locator('[data-desk-room="settings"]')).toBeVisible()
  await expect(spine).toHaveCount(0)
})

test('the cards and the dossier show each entry’s drawing, none twice side by side; the dossier’s picker sits under the name', async ({
  launch
}) => {
  const { win } = await sampleWorld(launch)
  await room(win, 'World').click()
  await expect(gallery(win)).toBeVisible()
  const named = (name: string) => cards(win).filter({ has: win.locator('.g-name, .g-title', { hasText: name }) }).first()
  // No portraits in the sample world: each card has its drawing (Wren the lantern, Edric his boat, the steps their stairs).
  await expect(named('Wren Halloway').locator('[data-motif="lantern"]')).toHaveCount(1)
  await expect(named('Edric Halloway').locator('[data-motif="boat"]')).toHaveCount(1)
  await expect(named('The Drowned Steps').locator('[data-motif="stairs"]')).toHaveCount(1)
  await expect(named('The Harbour Board').locator('[data-motif]')).toHaveCount(1)
  const shown = await cards(win).locator('[data-motif]').evaluateAll((els) => els.map((e) => e.getAttribute('data-motif')))
  expect(new Set(shown).size).toBe(shown.length)

  // Edric's dossier: the same drawing on its portrait, and the picker right under his name, beside the portrait.
  await named('Edric Halloway').click()
  const d = win.locator('[data-dossier]')
  await expect(d).toBeVisible()
  await expect(d.locator('.dz-portrait [data-motif="boat"]')).toHaveCount(1)
  const picker = d.locator('[data-motif-picker]')
  await expect(picker).toContainText('Drawing: small boat')
  // (The memory's counts say what they count: "3 scenes", never the markup's [object Object].)
  await expect(d).not.toContainText('[object Object]')
  await win.waitForTimeout(600)
  const nameBox = (await d.locator('.dz-name-h').boundingBox())!
  const pick = (await picker.boundingBox())!
  const portrait = (await d.locator('.dz-portrait').boundingBox())!
  expect(pick.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height - 1)
  expect(pick.y - (nameBox.y + nameBox.height)).toBeLessThanOrEqual(40)
  expect(pick.x).toBeGreaterThanOrEqual(portrait.x + portrait.width)
  // Choosing another: the card and the portrait follow; his own portrait would still win.
  await picker.getByRole('button', { name: 'Change' }).click()
  await win.getByRole('radiogroup', { name: 'Drawings for Edric Halloway' }).getByRole('radio', { name: 'A bell' }).click()
  await expect(d.locator('.dz-portrait [data-motif="bell"]')).toHaveCount(1)
  await d.getByRole('button', { name: 'Back to the world' }).click()
  await expect(d).toHaveCount(0)
  await expect(named('Edric Halloway').locator('[data-motif="bell"]')).toHaveCount(1)
  // The panels' entry page has no picker.
  await invoke(win, 'updateSettings', { arrangement: 'panels' })
  await win.reload()
  await expect(win.locator('.scene-prose')).toBeVisible()
  await expect(win.locator('[data-motif-picker]')).toHaveCount(0)
})

test('a character’s read-aloud voice is in the dossier’s facts, and its section sits right under who they are', async ({ launch }) => {
  // Adam couldn't find where to give a character a voice: it was at the foot of the dossier, after the private notes.
  const { win } = await sampleWorld(launch)
  await room(win, 'World').click()
  await card(win, 'Wren Halloway').click()
  const d = dossier(win)
  await expect(d).toBeVisible()
  const fact = d.locator('.dz-fact', { hasText: 'Read-aloud voice' })
  await expect(fact).toContainText('Not set')
  // Read aloud off: the fact says so on hover and goes to Settings, where it is turned on.
  await expect(fact.getByRole('button')).toHaveAttribute('title', /^Read aloud is off\./)
  await fact.getByRole('button').click()
  await expect(win.getByRole('heading', { level: 1, name: 'Read aloud and dictation' })).toBeVisible()

  // Read aloud on: the voice's section comes straight after "Who they are", and the fact goes to it.
  await invoke(win, 'updateSettings', { speech: { readAloud: true } })
  await win.reload()
  await expect(rooms(win)).toBeVisible()
  await room(win, 'World').click()
  await card(win, 'Wren Halloway').click()
  await expect(d).toBeVisible()
  const titles = await d.locator('.dz-col').first().locator(':scope > .dz-sec .dz-sec-h, :scope > .dz-voice-box').evaluateAll((els) =>
    els.map((e) => (e.classList.contains('dz-voice-box') ? 'VOICE' : (e.textContent ?? '').trim()))
  )
  expect(titles[0]).toMatch(/^Who they are/)
  expect(titles[1]).toBe('VOICE')
  await expect(d.locator('.dz-voice-box')).toContainText('Read-aloud voice')
  await d.locator('.dz-fact', { hasText: 'Read-aloud voice' }).getByRole('button').click()
  await expect(d.locator('.dz-voice-box')).toBeInViewport()
})
