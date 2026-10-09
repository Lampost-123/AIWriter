// The New look's timeline, "the river" (UI overhaul), on the desk and the sample world: scene cards along the world's
// days with a lane for each character under its full name, hovering and picking scenes and lanes, the keyboard, the
// filter, the lane picker, by chapter, plot thread lanes, a flashback, a lane's dossier and back, less motion, the
// panels, and a big invented world (200 scenes, 40 chapters, 60 characters) that keeps scrolling and zooming smoothly.
// Every name and date in the big world is made up here.
import type { ElectronApplication, Page } from '@playwright/test'
import type { ID } from '@shared/types'
import { emptySceneCard } from '@shared/defaults'
import { expect, invoke, test, type LaunchOptions } from './helpers'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk', AIWRITE_KEEPER_QUIET_MS: '600000' }
const room = (win: Page, name: string) =>
  win.getByRole('navigation', { name: 'Rooms' }).getByRole('button', { name: new RegExp(`^${name}`) })
const river = (win: Page) => win.locator('[data-timeline]')
const cards = (win: Page) => river(win).getByRole('list', { name: 'Timeline' })
const card = (win: Page, title: string) => river(win).locator('[data-card-n]', { hasText: title })
const lanes = (win: Page) => river(win).getByRole('list', { name: 'Lanes' })
const lane = (win: Page, name: string) => river(win).locator(`[data-lane-row]`, { has: win.locator('.tl-lh-name', { hasText: name }) })
const side = (win: Page) => river(win).getByRole('complementary', { name: /^About this/ })

type Launch = (o?: LaunchOptions) => Promise<{ app: ElectronApplication; win: Page; dataDir: string }>

async function sampleWorld(launch: Launch, env: Record<string, string> = DESK): Promise<{ app: ElectronApplication; win: Page }> {
  const a = await launch({ env })
  await expect(a.win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(a.win, 'openSampleWorld')
  await a.win.reload()
  await expect(a.win.locator('.scene-prose')).toContainText('A hundred and twelve steps')
  return a
}

async function size(app: ElectronApplication, win: Page, w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [cw, ch]) => BrowserWindow.getAllWindows()[0].setContentSize(cw, ch), [w, h] as [number, number])
  await expect.poll(async () => Math.abs(((await win.evaluate('innerWidth')) as number) - w)).toBeLessThanOrEqual(1)
}

async function openTimeline(win: Page): Promise<void> {
  await room(win, 'World').click()
  await win.locator('[data-desk-room]').getByRole('button', { name: 'Timeline' }).click()
  await expect(river(win).getByRole('heading', { level: 1, name: 'Timeline' })).toBeVisible()
  await expect(cards(win).getByRole('listitem').first()).toBeVisible()
}

/** An element's opacity once it has settled. */
const opacity = (l: ReturnType<Page['locator']>) => l.evaluate((e) => Number(e.ownerDocument.defaultView!.getComputedStyle(e).opacity))

test('the river: scene cards along the days, the gap between them in words, a lane for each character under their full name, filling the page', async ({
  launch
}) => {
  const { app, win } = await sampleWorld(launch)
  await size(app, win, 1920, 1080)
  await openTimeline(win)
  // The scenes in the order they happen, each card saying where it is, its date, its place and whose eyes it's told through.
  const labels = await cards(win)
    .getByRole('button')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
  expect(labels.map((l) => l.split('.')[0])).toEqual([
    'The Keeper’s Light, Ch 1, Sc 1, Lighting the Lamp',
    'The Keeper’s Light, Ch 1, Sc 2, A Letter for the Keeper',
    'The Keeper’s Light, Ch 2, Sc 1, What the Letter Said',
    'The Keeper’s Light, Ch 2, Sc 2, Low Tide'
  ])
  await expect(card(win, 'Lighting the Lamp')).toContainText('Day 1, dusk')
  await expect(card(win, 'Lighting the Lamp')).toContainText('The Gullhaven Light')
  await expect(card(win, 'Lighting the Lamp')).toContainText('Wren Halloway')
  await expect(card(win, 'Lighting the Lamp')).toHaveAttribute('aria-current', 'location')
  await expect(river(win).locator('.tl-bandname-t')).toHaveText(['Day 1', 'Day 2', 'Day 3'])
  await expect(river(win).locator('.tl-gap')).toHaveText(['1 day later'])
  // Spaced by the time between them: the night after the dusk is nearer than the next morning.
  const xs = await cards(win)
    .getByRole('button')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left))
  expect(xs[1] - xs[0]).toBeLessThan(xs[2] - xs[1])
  expect(xs[2] - xs[1]).toBeLessThan(xs[3] - xs[2])

  // A lane for each character, under their whole name (never cut short), and "Lanes 4 of 4". The whole river is on
  // screen, so the lanes are the story's main cast: whose eyes it's told through first, then who's there most.
  await expect(lanes(win).getByRole('listitem')).toHaveCount(4)
  const names = river(win).locator('.tl-lh-name')
  await expect(names).toHaveText(['Wren Halloway', 'Iska Vey', 'Edric Halloway', 'Ansel Crane'])
  for (const n of await names.all()) expect(await n.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0)
  await expect(river(win).getByRole('button', { name: /^Lanes/ })).toContainText('4 of 4')
  // Wren tells every scene: four point-of-view marks; Edric is in two, apart: two runs and a thin line between.
  await expect(lane(win, 'Wren Halloway').locator('.tl-mark.is-pov')).toHaveCount(4)
  await expect(lane(win, 'Edric Halloway').locator('.tl-run')).toHaveCount(2)
  await expect(lane(win, 'Edric Halloway').locator('.tl-span')).toHaveCount(1)
  await expect(lane(win, 'Wren Halloway').getByRole('button')).toHaveAccessibleName(/^Wren Halloway: In 4 scenes · point of view in 4\./)

  // The lanes fill the page under the cards: no big empty sheet below them.
  const scroller = (await river(win).locator('.tl-scroller').boundingBox())!
  const last = (await lane(win, 'Ansel Crane').boundingBox())!
  expect(scroller.y + scroller.height - (last.y + last.height)).toBeLessThan(scroller.height * 0.2)
  expect(await win.evaluate<number>('document.documentElement.scrollWidth - innerWidth')).toBeLessThanOrEqual(0)
})

test('hovering a scene lights its people’s lanes, hovering a lane lights its scenes; a click opens the side card, and Open scene goes in', async ({
  launch
}) => {
  const { app, win } = await sampleWorld(launch)
  await size(app, win, 1600, 1000)
  await openTimeline(win)
  // Edric is in the first and third scenes: hovering his lane leaves those lit and the others stepped back.
  await lane(win, 'Edric Halloway').locator('.tl-lh').hover()
  await expect.poll(() => opacity(card(win, 'What the Letter Said'))).toBe(1)
  await expect.poll(() => opacity(card(win, 'Low Tide'))).toBeLessThan(0.6)
  await expect.poll(() => opacity(lane(win, 'Iska Vey'))).toBeLessThan(0.6)
  // Low Tide has Wren and Iska: their lanes stay lit, Edric's steps back.
  await card(win, 'Low Tide').hover()
  await expect.poll(() => opacity(lane(win, 'Iska Vey'))).toBe(1)
  await expect.poll(() => opacity(lane(win, 'Wren Halloway'))).toBe(1)
  await expect.poll(() => opacity(lane(win, 'Edric Halloway'))).toBeLessThan(0.6)

  // A click: the side card, with the place, who's there and the way in. Esc closes it.
  await card(win, 'A Letter for the Keeper').click()
  await expect(side(win)).toBeVisible()
  await expect(side(win).getByRole('heading', { level: 2 })).toHaveText('A Letter for the Keeper')
  await expect(side(win)).toContainText('Day 1, night')
  await expect(side(win)).toContainText('Gullhaven')
  await expect(side(win).getByRole('button', { name: /^Wren Halloway/ })).toContainText('Point of view')
  await expect(side(win).getByRole('button', { name: /^Iska Vey/ })).toBeVisible()
  await expect(card(win, 'A Letter for the Keeper')).toHaveAttribute('aria-pressed', 'true')
  await win.keyboard.press('Escape')
  await expect(side(win)).toHaveCount(0)
  await expect(river(win)).toBeVisible()
  await card(win, 'A Letter for the Keeper').click()
  await side(win).getByRole('button', { name: 'Open scene' }).click()
  await expect(win.locator('.desk-scene-title')).toHaveText('A Letter for the Keeper')
})

test('the keyboard: arrows move between scenes, Enter opens the side card and then the scene, Esc closes', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  await openTimeline(win)
  // One card takes Tab: the scene Adam is in.
  await expect(cards(win).locator('[tabindex="0"]')).toHaveCount(1)
  await card(win, 'Lighting the Lamp').focus()
  await win.keyboard.press('ArrowRight')
  await expect(card(win, 'A Letter for the Keeper')).toBeFocused()
  await win.keyboard.press('End')
  await expect(card(win, 'Low Tide')).toBeFocused()
  await win.keyboard.press('ArrowLeft')
  await expect(card(win, 'What the Letter Said')).toBeFocused()
  await win.keyboard.press('Enter')
  await expect(side(win).getByRole('heading', { level: 2 })).toHaveText('What the Letter Said')
  // With the side card open the arrows carry it along.
  await win.keyboard.press('ArrowRight')
  await expect(side(win).getByRole('heading', { level: 2 })).toHaveText('Low Tide')
  await expect(card(win, 'Low Tide')).toBeFocused()
  await win.keyboard.press('Escape')
  await expect(side(win)).toHaveCount(0)
  await expect(card(win, 'Low Tide')).toBeFocused()
  await win.keyboard.press('Enter')
  await win.keyboard.press('Enter')
  await expect(win.locator('.desk-scene-title')).toHaveText('Low Tide')
})

test('the filter, the lane picker, by chapter and plot thread lanes', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  await openTimeline(win)
  // The filter: Ansel is in one scene, so the others step back; the river keeps its shape.
  await river(win)
    .getByRole('button', { name: /^Filter/ })
    .click()
  await win.getByRole('group', { name: 'Characters' }).getByText('Ansel Crane').click()
  await win.keyboard.press('Escape')
  await expect(river(win).getByRole('button', { name: /^Filter/ })).toContainText('1')
  await expect(river(win).locator('.tl-card.is-out')).toHaveCount(3)
  await expect(river(win).locator('.tl-card:not(.is-out)')).toHaveText(/A Letter for the Keeper/)
  await river(win)
    .getByRole('button', { name: /^Filter/ })
    .click()
  await win.getByRole('button', { name: 'Clear the filter' }).click()
  await win.keyboard.press('Escape')
  await expect(river(win).locator('.tl-card.is-out')).toHaveCount(0)

  // The lane picker: each character with their drawing; Ansel's lane goes, and comes back with Show all.
  await river(win)
    .getByRole('button', { name: /^Lanes/ })
    .click()
  const picker = win.getByRole('group', { name: 'Lanes' })
  await expect(picker.locator('.tl-pick')).toHaveCount(4)
  await expect(picker.locator('.tl-pick-art')).toHaveCount(4)
  await picker.getByText('Ansel Crane').click()
  await expect(river(win).getByRole('button', { name: /^Lanes/ })).toContainText('3 of 4')
  await expect(lanes(win).getByRole('listitem')).toHaveCount(3)
  await win.getByRole('button', { name: 'Show all' }).click()
  await win.keyboard.press('Escape')
  await expect(lanes(win).getByRole('listitem')).toHaveCount(4)

  // By chapter: a band for each chapter, by its name; the choice is remembered.
  await river(win).getByRole('radio', { name: 'By chapter' }).click()
  await expect(river(win).locator('.tl-bandname-t')).toHaveText(['The Night Ferry', 'The Drowned Steps'])
  await expect(river(win).locator('.tl-bandname-k')).toHaveText(['Ch 1', 'Ch 2'])
  await win.reload()
  await expect(win.locator('.scene-prose')).toBeVisible()
  await openTimeline(win)
  await expect(river(win).getByRole('radio', { name: 'By chapter' })).toHaveAttribute('aria-checked', 'true')
  await river(win).getByRole('radio', { name: 'By day' }).click()

  // Plot threads: the letter's question set up and paid off (a knot); the midwinter one still open, trailing off.
  await river(win).getByRole('radio', { name: 'Plot threads' }).click()
  await expect(river(win).locator('.tl-lh-name')).toHaveText(['What is in the sealed letter?', 'Will the light go dark at midwinter?'])
  await expect(lane(win, 'What is in the sealed letter?').locator('.tl-mark.is-resolved')).toHaveCount(1)
  await expect(lane(win, 'What is in the sealed letter?').getByRole('button')).toHaveAccessibleName(/Paid off/)
  await expect(lane(win, 'Will the light go dark at midwinter?').locator('.tl-tail')).toHaveCount(1)
})

test('a flashback is marked, and a lane opens its dossier, which goes back to the timeline', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  // Low Tide is moved to before dawn on Day 1: told last, it happens first.
  const [story] = await invoke(win, 'listStories')
  const outline = await invoke(win, 'getOutline', story.id)
  const low = outline.scenes.find((s) => s.title === 'Low Tide')!
  const scene = await invoke(win, 'getScene', low.id)
  await invoke(win, 'updateSceneCard', low.id, { ...emptySceneCard(), ...scene.card, when: 'Day 1, before dawn' })
  await openTimeline(win)
  await expect(cards(win).getByRole('button').first()).toHaveAccessibleName(
    /Low Tide\. Day 1, before dawn\..*A flashback, told after Ch 2, Sc 1\./
  )
  await expect(card(win, 'Low Tide')).toContainText('Flashback')
  await expect(river(win).locator('.tl-arc.is-flashback')).toHaveCount(1)
  await expect(river(win).locator('.tl-sub')).toContainText('1 flashback')

  await lane(win, 'Iska Vey').locator('.tl-lh').click()
  const back = win.getByRole('button', { name: 'Back to the timeline' })
  await expect(back).toBeVisible()
  await back.click()
  await expect(river(win).getByRole('heading', { level: 1, name: 'Timeline' })).toBeVisible()
})

test('a clash in plain words: picking it brings its scenes into view', async ({ launch }) => {
  const { app, win } = await sampleWorld(launch)
  await size(app, win, 1920, 1080)
  // What the Letter Said moves to Day 3: Wren is then at the Gullhaven Light and the Drowned Steps on the same day.
  const [story] = await invoke(win, 'listStories')
  const outline = await invoke(win, 'getOutline', story.id)
  const what = outline.scenes.find((s) => s.title === 'What the Letter Said')!
  const scene = await invoke(win, 'getScene', what.id)
  await invoke(win, 'updateSceneCard', what.id, { ...emptySceneCard(), ...scene.card, when: 'Day 3, morning' })
  await openTimeline(win)
  // Wren and Iska are both in the two places on Day 3.
  await river(win).getByRole('button', { name: '2 clashes' }).click()
  const list = win.getByRole('list', { name: 'Clashes' })
  await expect(list.getByRole('button')).toHaveText([/^Wren Halloway is in .* on Day 3\.$/, /^Iska Vey is in .* on Day 3\.$/])
  await list.getByRole('button').first().click()
  await expect(card(win, 'What the Letter Said')).toBeFocused()
  await expect(card(win, 'What the Letter Said').locator('.tl-c-clash')).toHaveCount(1)
  await expect(card(win, 'Low Tide').locator('.tl-c-clash')).toHaveCount(1)
})

test('with less motion the lanes are there at once; Jump to now brings the open scene into view', async ({ launch }) => {
  const { app, win } = await sampleWorld(launch)
  await win.emulateMedia({ reducedMotion: 'reduce' })
  await size(app, win, 1100, 800)
  // A scene far along: Low Tide, the last.
  const [story] = await invoke(win, 'listStories')
  const outline = await invoke(win, 'getOutline', story.id)
  await openTimeline(win)
  await expect(river(win).locator('.tl-body')).not.toHaveClass(/is-arriving/)
  await expect(river(win).locator('.tl-draw, .tl-pop')).toHaveCount(0)
  // Nothing keeps moving (what the room's arrival started ends at once, too).
  const running = () =>
    river(win).evaluate((e) =>
      e
        .getAnimations({ subtree: true })
        .filter((a: { playState: string }) => a.playState === 'running')
        .map((a: { animationName?: string }) => a.animationName ?? 'a transition')
    )
  await expect.poll(running, { timeout: 3000 }).toEqual([])
  // Jump to now: into view, with the keyboard on it.
  await river(win)
    .locator('.tl-scroller')
    .evaluate((e) => (e.scrollLeft = e.scrollWidth))
  await river(win).getByRole('button', { name: 'Jump to now' }).click()
  await expect(card(win, 'Lighting the Lamp')).toBeFocused()
  await expect(card(win, 'Lighting the Lamp')).toBeInViewport()
  expect(outline.scenes.length).toBe(4)
})

test('the panels show the river too', async ({ launch }) => {
  const { win } = await sampleWorld(launch, { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'panels' })
  await win.keyboard.press('Control+K')
  await win.keyboard.type('timeline')
  await win.keyboard.press('Enter')
  await expect(river(win)).toBeVisible()
  await expect(cards(win).getByRole('listitem')).toHaveCount(4)
  // The window is narrower than the river: the cast of the chapter in view, Chapter One.
  await expect(river(win).locator('.tl-lh-name')).toHaveText(['Wren Halloway', 'Edric Halloway', 'Ansel Crane', 'Iska Vey'])
})

test('Classic shows the river too, in its own look: lanes, the side card, and a double-click into the scene', async ({ launch }) => {
  const { win } = await sampleWorld(launch, { AIWRITE_KEEPER_QUIET_MS: '600000' })
  await expect(win.locator('html')).toHaveAttribute('data-look', 'classic')
  await win.getByRole('complementary', { name: 'Binder' }).getByRole('button', { name: 'Timeline', exact: true }).click()
  await expect(river(win)).toBeVisible()
  await expect(cards(win).getByRole('listitem')).toHaveCount(4)
  await expect(river(win).locator('.tl-lh-name')).toHaveText(['Wren Halloway', 'Edric Halloway', 'Ansel Crane', 'Iska Vey'])
  // Classic's own type (not the New look's serif) and lane inks of its own, not all one grey.
  const font = await river(win)
    .locator('.tl-h1')
    .evaluate((e) => e.ownerDocument.defaultView!.getComputedStyle(e).fontFamily)
  expect(font).not.toContain('Literata')
  const inks = await river(win)
    .locator('.tl-run')
    .evaluateAll((els) => [...new Set(els.map((e) => e.ownerDocument.defaultView!.getComputedStyle(e).stroke))])
  expect(inks.length).toBeGreaterThanOrEqual(3)
  await card(win, 'Low Tide').click()
  await expect(side(win).getByRole('heading', { level: 2 })).toHaveText('Low Tide')
  await card(win, 'What the Letter Said').dblclick()
  await expect(win.getByRole('complementary', { name: 'Binder' }).getByRole('treeitem', { name: 'What the Letter Said' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
})

test('until Adam picks, the lanes are the main cast of the chapter in view, following him chapter by chapter; his pick then stays', async ({
  launch
}) => {
  const { app, win } = await sampleWorld(launch)
  // Narrow enough that the river scrolls, so one chapter at a time is in the middle.
  await size(app, win, 1200, 800)
  await openTimeline(win)
  const scroller = river(win).locator('.tl-scroller')
  await scroller.evaluate((e) => (e.scrollLeft = 0))
  // Chapter One: Wren tells it; Edric is in its first scene, Ansel and Iska in its second.
  await expect(river(win).locator('.tl-lh-name')).toHaveText(['Wren Halloway', 'Edric Halloway', 'Ansel Crane', 'Iska Vey'])
  // Chapter Two: Wren, then Iska (in both its scenes), then Edric; Ansel's lane goes.
  await scroller.evaluate((e) => (e.scrollLeft = e.scrollWidth))
  await expect(river(win).locator('.tl-lh-name')).toHaveText(['Wren Halloway', 'Iska Vey', 'Edric Halloway'])
  await expect(river(win).getByRole('button', { name: /^Lanes/ })).toContainText('3 of 4')
  // Picking his own: they stay, wherever he scrolls.
  await river(win)
    .getByRole('button', { name: /^Lanes/ })
    .click()
  await win.getByRole('group', { name: 'Lanes' }).getByText('Ansel Crane').click()
  await win.keyboard.press('Escape')
  await scroller.evaluate((e) => (e.scrollLeft = 0))
  await win.waitForTimeout(300)
  await expect(river(win).locator('.tl-lh-name')).toHaveCount(4)
  await scroller.evaluate((e) => (e.scrollLeft = e.scrollWidth))
  await win.waitForTimeout(300)
  await expect(river(win).locator('.tl-lh-name')).toHaveCount(4)
  // Follow the chapter again.
  await river(win)
    .getByRole('button', { name: /^Lanes/ })
    .click()
  await win.getByRole('button', { name: 'Follow the chapter' }).click()
  await win.keyboard.press('Escape')
  await expect(river(win).locator('.tl-lh-name')).toHaveText(['Wren Halloway', 'Iska Vey', 'Edric Halloway'])
})

/** 40 chapters of 5 scenes, 60 characters, 12 places and 8 plot threads, all invented, added to the sample world's story. */
async function bigWorld(win: Page): Promise<void> {
  const [story] = await invoke(win, 'listStories')
  const first = [
    'Ada',
    'Bram',
    'Cora',
    'Dov',
    'Elin',
    'Fenn',
    'Greta',
    'Hal',
    'Ines',
    'Jory',
    'Kit',
    'Lune',
    'Mabry',
    'Nell',
    'Osric',
    'Pell',
    'Quill',
    'Rhosyn',
    'Sable',
    'Tam'
  ]
  const last = ['Ashcombe', 'Brightwater', 'Cole']
  const people: ID[] = []
  for (let i = 0; i < 60; i++)
    people.push((await invoke(win, 'createEntry', 'character', { name: `${first[i % 20]} ${last[Math.floor(i / 20)]}`, fields: {} })).id)
  const places: ID[] = []
  for (let i = 0; i < 12; i++) places.push((await invoke(win, 'createEntry', 'place', { name: `Quay ${i + 1}`, fields: {} })).id)
  const threads: ID[] = []
  for (let i = 0; i < 8; i++) threads.push((await invoke(win, 'createEntry', 'thread', { name: `Question ${i + 1}?`, fields: {} })).id)
  const times = ['dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night']
  let n = 0
  for (let c = 0; c < 40; c++) {
    const ch = await invoke(win, 'createChapter', story.id, { title: `Tide ${c + 1}` })
    for (let s = 0; s < 5; s++) {
      const scene = await invoke(win, 'createScene', ch.id, { title: `Scene ${n + 1}` })
      const pov = people[(n * 7) % 12]
      await invoke(win, 'updateSceneCard', scene.id, {
        ...emptySceneCard(),
        when: n === 61 ? 'Day 2, before dawn' : `Day ${4 + Math.floor(n / 3)}, ${times[n % 6]}`,
        povId: pov,
        presentIds: [pov, people[(n * 3 + 1) % 24], people[(n * 5 + 2) % 60], people[(n + 9) % 60]],
        locationId: places[n % 12],
        setsUpIds: n % 23 === 0 ? [threads[(n / 23) % 8]] : [],
        paysOffIds: n % 31 === 0 && n > 0 ? [threads[(n / 31) % 8]] : []
      })
      n++
    }
  }
}

test('a big world (200 scenes, 40 chapters, 60 characters) draws only what is on screen and scrolls and zooms with no long frames', async ({
  launch
}) => {
  test.setTimeout(180_000)
  const { app, win } = await sampleWorld(launch)
  await bigWorld(win)
  await win.reload()
  await expect(win.locator('.scene-prose')).toBeVisible()
  await size(app, win, 1600, 1000)
  await openTimeline(win)
  // Until he picks, the cast of the chapter in view: a few of the 64.
  await expect(river(win).getByRole('button', { name: /^Lanes/ })).toContainText(/\d+ of 64/)
  // Show every lane: the river still draws only the cards and lanes on screen.
  await river(win)
    .getByRole('button', { name: /^Lanes/ })
    .click()
  await win.getByRole('button', { name: 'Show all' }).click()
  await win.keyboard.press('Escape')
  await expect(river(win).getByRole('button', { name: /^Lanes/ })).toContainText('64 of 64')
  await win.waitForTimeout(2500)
  expect(await river(win).locator('[data-card-n]').count()).toBeLessThan(40)
  expect(await river(win).locator('[data-lane-row]').count()).toBeLessThan(45)

  if (process.env.PERF_THROTTLE) {
    const cdp = await win.context().newCDPSession(win)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.PERF_THROTTLE) })
  }
  await win.evaluate(`(() => {
    window.__long = []
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)) }).observe({ type: 'long-animation-frame' })
  })()`)
  // Scrolling along and down, a step each frame, then laying it out by chapter and back.
  await river(win)
    .locator('.tl-scroller')
    .evaluate(
      (el) =>
        new Promise<void>((done) => {
          let n = 0
          const view = el.ownerDocument.defaultView!
          const step = (): void => {
            el.scrollLeft += 60
            el.scrollTop += 8
            if (++n < 200) view.requestAnimationFrame(step)
            else done()
          }
          view.requestAnimationFrame(step)
        })
    )
  await river(win).getByRole('radio', { name: 'By chapter' }).click()
  await win.waitForTimeout(600)
  await river(win).getByRole('radio', { name: 'By day' }).click()
  await win.waitForTimeout(600)
  const long = (await win.evaluate('window.__long')) as number[]
  // On this PC: not one frame over 50 ms. On CI (a slower, software-drawn screen; PERF_THROTTLE=5 holds the CPU back to
  // match here) the frames are judged by their spread instead, as the relationship map's are: most long frames well
  // under a tenth of a second, none stuck for long.
  if (process.env.CI || process.env.PERF_THROTTLE) {
    const sorted = [...long].sort((x, y) => x - y)
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
    console.log(`timeline perf (slow machine): ${long.length} long frames, median ${median} ms, p95 ${p95} ms`)
    expect(median).toBeLessThan(120)
    expect(p95).toBeLessThan(400)
    expect(Math.max(0, ...long)).toBeLessThan(800)
  } else
    expect(
      long.filter((d) => d > 50),
      `long frames: ${long.join(', ')}`
    ).toEqual([])
  expect(await river(win).locator('[data-card-n]').count()).toBeLessThan(40)
})
