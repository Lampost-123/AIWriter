// The timeline, the relationship map and the plot threads board, end to end. Each opens from its
// link in its area's list and teaches what it needs while the world is empty; then, on a small world made
// through the API (Book 1 with twelve chapters, Mara, Tobin and Kell, two places and three plot threads),
// the timeline shows a clash and opens scenes, the map changes with its strip, and the board highlights a
// thread left open and links to the scenes that set up and pay off each one.
import type { ElectronApplication, Page } from '@playwright/test'
import type { ID, SceneCard } from '@shared/types'
import { emptySceneCard } from '@shared/defaults'
import { binder, createWorldFromWelcome, expect, invoke, openPage, test, type PageName } from './helpers'

const main = (win: Page) => win.locator('main')
const open = (win: Page, link: PageName) => openPage(win, link)
const sceneRow = (win: Page, title: string) => binder(win).getByRole('treeitem', { name: title })

/** Sets the window's size, as Adam would by dragging its edge. */
async function windowSize(app: ElectronApplication, win: Page, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height])
  await expect.poll(() => win.evaluate('[innerWidth, innerHeight]')).toEqual([width, height])
}

/** Whether an element sits wholly inside another on screen. */
async function inside(win: Page, inner: ReturnType<Page['locator']>, outer: ReturnType<Page['locator']>): Promise<boolean> {
  const [a, b] = [await inner.boundingBox(), await outer.boundingBox()]
  if (!a || !b) return false
  return a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.width <= b.x + b.width + 0.5 && a.y + a.height <= b.y + b.height + 0.5
}

/** Whether two elements on screen don't overlap at all. */
async function apart(one: ReturnType<Page['locator']>, other: ReturnType<Page['locator']>): Promise<boolean> {
  const [a, b] = [await one.boundingBox(), await other.boundingBox()]
  if (!a || !b) return false
  return a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y
}

/**
 * What the map shows on screen: how many characters there are and how many sit wholly in the window
 * between the strip above and the legend below, how many names show and the smallest one's height, and
 * how many ties show their words and the smallest one's height.
 */
function readMap(win: Page) {
  return main(win)
    .locator('[data-desk-map]')
    .evaluate((el) => {
      const strip = el.querySelector('[data-map-timeline]')!.getBoundingClientRect()
      const legend = el.querySelector('[data-map-legend]')!.getBoundingClientRect()
      const canvas = el.querySelector('[role="group"]')!.getBoundingClientRect()
      const people = [...el.querySelectorAll('[data-map-node]')]
      const named = people.filter((b) => !b.querySelector('.dm-label')!.classList.contains('is-hidden'))
      const names = named.map((b) => b.querySelector('.dm-name')!)
      const words = [...el.querySelectorAll('[data-map-tie]')].filter((b) => !b.classList.contains('is-hidden'))
      const within = people.filter((b) => {
        const r = b.getBoundingClientRect()
        return r.left >= canvas.left && r.right <= canvas.right && r.top >= strip.bottom && r.bottom <= legend.top
      })
      return {
        characters: people.length,
        inWindow: within.length,
        names: names.length,
        smallestName: Math.min(...names.map((n) => n.getBoundingClientRect().height)),
        words: words.length,
        smallestWords: Math.min(...words.map((w) => w.getBoundingClientRect().height))
      }
    })
}

/** What the map shows once it has stopped moving and fading: the same twice in a row. */
async function settledMap(win: Page): ReturnType<typeof readMap> {
  let last = ''
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await readMap(win))
        const same = now === last
        last = now
        return same
      },
      { intervals: [250] }
    )
    .toBe(true)
  return JSON.parse(last)
}

/** Where an element is once it has stopped moving: the same twice in a row. */
async function settledBox(el: ReturnType<Page['locator']>): ReturnType<ReturnType<Page['locator']>['boundingBox']> {
  let last = ''
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await el.boundingBox())
        const same = now === last
        last = now
        return same
      },
      { intervals: [150] }
    )
    .toBe(true)
  return JSON.parse(last)
}

/** A tie's name on the map: the two of them (named in the map's own order), what they are, and perhaps how each feels. */
function tieName(a: string, b: string, words: string, feels?: [string, string]): RegExp {
  const one = (x: string, y: string, fx?: string, fy?: string): string =>
    `${x} and ${y}: ${words}\\.` + (fx ? ` ${x} feels ${fx}\\. ${y} feels ${fy}\\.$` : '')
  return new RegExp(`^(?:${one(a, b, feels?.[0], feels?.[1])}|${one(b, a, feels?.[1], feels?.[0])})`)
}

/**
 * Book 1: Ch 1 has "Scene 1" (Day 12, Mara in Ashford) and "The mill burns" (Day 12 at dusk, Mara at
 * Harrow Mill: a clash); Ch 2 has "Tobin returns" (Day 14); Chs 3 to 12 have one undated scene each.
 * Mara and Tobin are friends before the story begins and rivals from "Tobin returns"; Kell owes Tobin
 * money from Ch 3. "Who burned the mill?" opens in Scene 1 and is still open; "The lost map" opens there
 * and is resolved in "Tobin returns"; "The stranger at the ferry" is only on Ch 5's scene card.
 */
async function makeWorld(win: Page): Promise<void> {
  const [story] = await invoke(win, 'listStories')
  const outline = await invoke(win, 'getOutline', story.id)
  const [ch1] = outline.chapters
  const [s1] = outline.scenes
  const burns = await invoke(win, 'createScene', ch1.id, { title: 'The mill burns', afterId: s1.id })
  const chapterScenes: ID[] = []
  for (let n = 2; n <= 12; n++) {
    const ch = await invoke(win, 'createChapter', story.id, { title: `Chapter ${n}` })
    chapterScenes[n] = (await invoke(win, 'createScene', ch.id, { title: n === 2 ? 'Tobin returns' : `Scene in chapter ${n}` })).id
  }
  const returns = chapterScenes[2]

  const entry = async (kind: 'character' | 'place' | 'thread', name: string, fields: Record<string, string> = {}): Promise<ID> =>
    (await invoke(win, 'createEntry', kind, { name, fields })).id
  const mara = await entry('character', 'Mara')
  const tobin = await entry('character', 'Tobin')
  const kell = await entry('character', 'Kell')
  const ashford = await entry('place', 'Ashford')
  const mill = await entry('place', 'Harrow Mill')
  const burned = await entry('thread', 'Who burned the mill?', { promise: 'Someone set the fire, and the reader will learn who.' })
  const lostMap = await entry('thread', 'The lost map')
  const stranger = await entry('thread', 'The stranger at the ferry')

  const card = (id: ID, c: Partial<SceneCard>) => invoke(win, 'updateSceneCard', id, { ...emptySceneCard(), ...c })
  await card(s1.id, { when: 'Day 12', povId: mara, presentIds: [mara], locationId: ashford })
  await card(burns.id, { when: 'Day 12, at dusk', presentIds: [mara], locationId: mill })
  await card(returns, { when: 'Day 14', povId: tobin, presentIds: [mara, tobin], locationId: ashford })
  await card(chapterScenes[5], { setsUpIds: [stranger] })
  await card(chapterScenes[12], { paysOffIds: [burned] })

  const tie = (from: ID, to: ID, type: string, feels: string, otherFeels: string, sceneId?: ID) =>
    invoke(win, 'createChange', {
      kind: 'relationship',
      payload: { otherId: to, type, feels, otherFeels },
      entryId: from,
      ...(sceneId ? { anchor: 'scene' as const, sceneId } : { anchor: 'baseline' as const })
    })
  await tie(mara, tobin, 'friend', 'fond', 'wary')
  await tie(mara, tobin, 'rival', 'betrayed', 'guilty', returns)
  await tie(kell, tobin, 'owes money', 'ashamed', 'patient', chapterScenes[3])

  const thread = (entryId: ID, status: 'open' | 'resolved', sceneId: ID) =>
    invoke(win, 'createChange', { kind: 'thread', payload: { status, note: '' }, entryId, anchor: 'scene', sceneId })
  await thread(burned, 'open', s1.id)
  await thread(lostMap, 'open', s1.id)
  await thread(lostMap, 'resolved', returns)

  // The window reads the world afresh, as if Adam had just opened it.
  await win.reload()
  await expect(binder(win)).toBeVisible()
  await expect(win.locator('.scene-prose')).toBeVisible()
}

test('the timeline: lanes, a clash in plain words, and a double-click opens the scene', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')

  // With no dates yet, the timeline explains the When box.
  await open(win, 'Timeline')
  await expect(main(win).getByRole('heading', { level: 1, name: 'Timeline' })).toBeVisible()
  await expect(main(win).getByRole('heading', { name: 'No dates yet' })).toBeVisible()
  await expect(main(win).getByText('When box')).toBeVisible()

  await makeWorld(win)
  await open(win, 'Timeline')
  const timeline = main(win).getByRole('list', { name: 'Timeline' })
  await expect(timeline.getByRole('listitem').first()).toBeVisible()

  // Mara can't be in Ashford and at the mill on the same day. Picking the sentence brings her first scene to the keyboard.
  await main(win).getByRole('button', { name: '1 clash' }).click()
  await win.getByRole('list', { name: 'Clashes' }).getByRole('button', { name: 'Mara is in Ashford and Harrow Mill on Day 12.' }).click()
  const first = timeline.getByRole('button', { name: /^Book 1, Ch 1, Sc 1, Scene 1\. Day 12\. Mara is in Ashford/ })
  await expect(first).toBeFocused()
  await expect(timeline.getByRole('button', { name: /^Book 1, Ch 1, Sc 2, The mill burns/ }).locator('.tl-c-clash')).toHaveCount(1)

  // Scenes keep the order they happen in; those with no date keep their reading order, marked so.
  const names = await timeline.getByRole('button').evaluateAll((els) => els.slice(0, 4).map((e) => e.getAttribute('aria-label') ?? ''))
  expect(names.map((n) => n.split('.')[0])).toEqual([
    'Book 1, Ch 1, Sc 1, Scene 1',
    'Book 1, Ch 1, Sc 2, The mill burns',
    'Book 1, Ch 2, Sc 1, Tobin returns',
    'Book 1, Ch 3, Sc 1, Scene in chapter 3'
  ])
  await expect(timeline.getByRole('button', { name: /Scene in chapter 3\. No date\./ })).toBeVisible()

  // The keyboard moves between scenes.
  await first.press('ArrowDown')
  await expect(timeline.getByRole('button', { name: /The mill burns/ })).toBeFocused()

  // Lanes follow characters (the cast of the chapter in view until Adam picks), or plot threads.
  await expect(main(win).getByRole('button', { name: /^Lanes/ })).toContainText(/\d of 2/)
  await main(win).getByRole('radio', { name: 'Plot threads' }).click()
  // A thread's lane shows its whole name (the serif's italic may reach a pixel past its lines; nothing is cut).
  const laneName = main(win).locator('.tl-lh-name', { hasText: 'Who burned the mill?' })
  await expect(laneName).toBeVisible()
  expect(await laneName.evaluate((e) => e.scrollHeight <= e.clientHeight + 1 && e.scrollWidth <= e.clientWidth)).toBe(true)

  // A long When shows in full on hover.
  await expect(timeline.getByTitle('Day 12, at dusk', { exact: true })).toBeVisible()

  // A click opens the scene's side card; a double-click opens the scene.
  await timeline.getByRole('button', { name: /Tobin returns/ }).click()
  await expect(main(win).getByRole('complementary', { name: 'About this scene' })).toBeVisible()
  await timeline.getByRole('button', { name: /Tobin returns/ }).dblclick()
  await expect(win.locator('.scene-prose')).toBeVisible()
  await expect(sceneRow(win, 'Tobin returns')).toHaveAttribute('aria-selected', 'true')
})

test('the timeline and the board at a small window: every scene title and column stays on screen', async ({ launch }) => {
  const { app, win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  await makeWorld(win)
  await windowSize(app, win, 960, 600)
  // In a window this small the binder floats over the writing page, shown with the top bar's binder button.
  await win.getByRole('button', { name: 'Show or hide the binder' }).click()

  await open(win, 'Timeline')
  const timeline = main(win).getByRole('list', { name: 'Timeline' })
  await expect(timeline.getByRole('listitem').first()).toBeVisible()
  await expect(main(win).getByRole('button', { name: /^Lanes/ })).toContainText(/\d of 2/)
  // The river scrolls inside itself; the page never does, and a card shows its whole title and place.
  expect(await win.evaluate<number>('document.documentElement.scrollWidth - innerWidth')).toBeLessThanOrEqual(0)
  const scroller = main(win).locator('.tl-scroller')
  const burns = timeline.getByRole('button', { name: /The mill burns/ })
  await burns.scrollIntoViewIfNeeded()
  expect(await inside(win, burns.getByText('The mill burns'), scroller)).toBe(true)
  expect(await inside(win, burns.getByText('Ch 1 · Sc 2'), scroller)).toBe(true)

  await open(win, 'Plot threads board')
  const planned = main(win).getByRole('region', { name: 'Planned', exact: true })
  await expect(planned).toContainText('The stranger at the ferry')
  expect(await inside(win, planned, main(win))).toBe(true)
  // Where a thread is set up is never cut short.
  await expect(planned.getByRole('button', { name: 'Book 1, Ch 5, Sc 1' })).toBeVisible()
  expect(await inside(win, planned.getByRole('button', { name: 'Book 1, Ch 5, Sc 1' }), planned)).toBe(true)
})

test('the relationship map: portraits joined by labelled lines that change with the slider', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')

  // With no relationships yet, the map says where they come from.
  await open(win, 'Relationship map')
  await expect(main(win).getByRole('heading', { level: 1, name: 'Relationship map' })).toBeVisible()
  await expect(main(win).getByRole('heading', { name: 'No relationships yet' })).toBeVisible()

  await makeWorld(win)
  await open(win, 'Relationship map')
  const map = main(win).getByRole('group', { name: 'Relationship map' })

  // It opens at the scene Adam is in: Mara and Tobin are friends, and Kell isn't tied to anyone yet.
  const slider = main(win).getByRole('slider', { name: 'As of' })
  const person = (name: string) => map.getByRole('button', { name, exact: true })
  await expect(slider).toHaveAttribute('aria-valuetext', 'Book 1, Ch 1, Sc 1')
  await expect(person('Mara')).toBeVisible()
  await expect(map.getByRole('button', { name: tieName('Mara', 'Tobin', 'friend', ['fond', 'wary']) })).toBeVisible()
  await expect(person('Kell')).toHaveCount(0)

  // How each feels shows on the line's words on focus, covering neither of them.
  const friends = map.getByRole('button', { name: tieName('Mara', 'Tobin', 'friend') })
  await friends.focus()
  await expect(friends).toHaveClass(/is-open/)
  await expect(friends).toContainText('Mara → fond')
  await expect(friends).toContainText('Tobin → wary')
  await settledBox(friends)
  for (const who of ['Mara', 'Tobin']) expect(await apart(friends, person(who))).toBe(true)

  // At the end of the book they are rivals, and Kell owes Tobin money. Kell, who wasn't there at the
  // start, turns up inside the window: the map was fitted to everyone the strip can show.
  await slider.focus()
  await win.keyboard.press('End')
  await expect(map.getByRole('button', { name: tieName('Mara', 'Tobin', 'rival') })).toBeVisible()
  await expect(map.getByRole('button', { name: tieName('Kell', 'Tobin', 'owes money') })).toBeVisible()
  await expect(person('Kell')).toBeVisible()
  await expect(main(win).locator('[data-map-count]')).toHaveText('3 characters · 2 ties')
  expect(await inside(win, person('Kell'), map)).toBe(true)
  await expect.poll(async () => (await readMap(win)).inWindow).toBe(3)

  // Characters stay where they were as the strip moves.
  const box = async () => person('Mara').boundingBox()
  const before = await settledBox(person('Mara'))
  await win.keyboard.press('Home')
  await expect(map.getByRole('button', { name: tieName('Mara', 'Tobin', 'friend') })).toBeVisible()
  await expect(person('Kell')).toHaveCount(0)
  await expect.poll(box).toEqual(before)

  // The keyboard and the buttons move and zoom the map (Shift and an arrow move it; the arrows alone go between characters).
  const apartBy = async (): Promise<number> => {
    const [a, b] = [await person('Mara').boundingBox(), await person('Tobin').boundingBox()]
    return Math.hypot(a!.x + a!.width / 2 - (b!.x + b!.width / 2), a!.y + a!.height / 2 - (b!.y + b!.height / 2))
  }
  const far = await apartBy()
  await map.focus()
  await win.keyboard.press('Shift+ArrowLeft')
  await expect.poll(async () => (await box())?.x).toBeGreaterThan(before!.x)
  await main(win).getByRole('button', { name: 'Zoom out' }).click()
  await expect.poll(apartBy).toBeLessThan(far - 10)
  await main(win).getByRole('button', { name: 'Fit everyone on screen' }).click()

  // Clicking a character opens its card, and Open page its page.
  await slider.focus()
  await win.keyboard.press('End')
  await person('Kell').click()
  await main(win).locator('[data-map-card="character"]').getByRole('button', { name: 'Open page' }).click()
  await expect(binder(win).getByRole('button', { name: /^Characters/ })).toHaveAttribute('aria-current', 'page')
})

test('the plot threads board: open, resolved and planned, a thread left open highlighted, and links to scenes', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')

  // With no plot threads yet, the board says what they are and makes one.
  await open(win, 'Plot threads board')
  await expect(main(win).getByRole('heading', { level: 1, name: 'Plot threads board', exact: true })).toBeVisible()
  await expect(main(win).getByRole('heading', { name: 'No plot threads yet' })).toBeVisible()
  // The example's own question mark ends its sentence (no full stop after it).
  await expect(main(win).getByText(/like “Who burned the mill\?” Make one,/)).toBeVisible()
  await main(win).getByRole('button', { name: 'Create a plot thread' }).click()
  await expect(binder(win).getByRole('button', { name: /^Plot threads\s*\d/ })).toHaveAttribute('aria-current', 'page')

  await makeWorld(win)
  await open(win, 'Plot threads board')
  const column = (name: string) => main(win).getByRole('region', { name, exact: true })
  const card = (name: string) => main(win).getByRole('listitem').filter({ hasText: name })

  // Open for twelve chapters: highlighted, with where it was set up and where a scene card means to pay it off.
  const burned = card('Who burned the mill?')
  await expect(column('Open').getByRole('listitem')).toHaveCount(1)
  await expect(burned).toContainText('Someone set the fire, and the reader will learn who.')
  await expect(burned).toContainText('Open for 12 chapters')
  await expect(burned).toContainText('Set up in Book 1, Ch 1, Sc 1')
  await expect(burned).toContainText('To be paid off in Book 1, Ch 12, Sc 1')

  // Resolved, with where it was paid off; and planned threads, only on a scene card or nowhere yet.
  await expect(column('Resolved').getByRole('listitem')).toHaveCount(1)
  await expect(card('The lost map')).toContainText('Paid off in Book 1, Ch 2, Sc 1')
  await expect(column('Planned')).toContainText('The stranger at the ferry')
  await expect(card('The stranger at the ferry')).toContainText('To be set up in Book 1, Ch 5, Sc 1')
  await expect(card('New plot thread')).toContainText('Not set up in a scene yet')

  // A place opens its scene.
  await card('The lost map').getByRole('button', { name: 'Book 1, Ch 2, Sc 1' }).click()
  await expect(win.locator('.scene-prose')).toBeVisible()
  await expect(sceneRow(win, 'Tobin returns')).toHaveAttribute('aria-selected', 'true')

  // The thread's name opens its page.
  await open(win, 'Plot threads board')
  await card('Who burned the mill?').getByRole('button', { name: 'Who burned the mill?' }).click()
  await expect(binder(win).getByRole('button', { name: /^Plot threads\s*\d/ })).toHaveAttribute('aria-current', 'page')
})

test('the relationship map stays readable with a big cast, at any window size', async ({ launch }) => {
  const { app, win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  await invoke(win, 'createStory', { title: 'Book 2', startStoryId: (await invoke(win, 'listStories'))[0].id })

  // 25 characters, each tied to the next one round and to the one seven along: 50 relationships.
  // prettier-ignore
  const names = ['Ash', 'Bryn', 'Cato', 'Dara', 'Elsa', 'Finn', 'Gus', 'Hale', 'Ida', 'Jory', 'Kit', 'Lark', 'Mara', 'Nell', 'Oak',
    'Pell', 'Quin', 'Rook', 'Sela', 'Tobin', 'Uma', 'Vale', 'Wen', 'Wenceslas Feathergill', 'Yara']
  const ids: ID[] = []
  for (const name of names) ids.push((await invoke(win, 'createEntry', 'character', { name, fields: {} })).id)
  const types = ['sister', 'rival', 'owes money', 'old friend', 'mentor']
  for (let i = 0; i < ids.length; i++) {
    for (const step of [1, 7]) {
      const otherId = ids[(i + step) % ids.length]
      const payload = { otherId, type: types[(i + step) % types.length], feels: '', otherFeels: '' }
      await invoke(win, 'createChange', { kind: 'relationship', payload, entryId: ids[i], anchor: 'baseline' })
    }
  }
  await win.reload()
  await expect(binder(win)).toBeVisible()
  await windowSize(app, win, 1280, 800)

  await open(win, 'Relationship map')
  const map = main(win).getByRole('group', { name: 'Relationship map' })
  await expect(map.getByRole('button', { name: 'Mara', exact: true })).toBeVisible()
  // With two books, the map can be seen through either.
  await expect(main(win).getByRole('combobox', { name: 'Story' })).toBeVisible()

  // Everyone is in the window, between the strip and the legend, and many names show, at full size. (The New look's
  // map gives the names room first, and a tie's words show as one of the two is pointed at.)
  await expect.poll(async () => (await readMap(win)).inWindow).toBe(25)
  const big = await settledMap(win)
  expect(big.characters).toBe(25)
  expect(big.names).toBeGreaterThanOrEqual(6)
  expect(big.smallestName).toBeGreaterThanOrEqual(17)
  if (big.words) expect(big.smallestWords).toBeGreaterThanOrEqual(17)

  // Pointing at a character whose name had no room shows it, and its ties' words with how each feels, at full size.
  const hidden = await map.evaluate((el) =>
    [...el.querySelectorAll('[data-map-node]')]
      .filter((b) => {
        // (One that can be pointed at: nothing on top of its middle.)
        const r = b.getBoundingClientRect()
        const top = el.ownerDocument.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return b.querySelector('.dm-label')!.classList.contains('is-hidden') && !!top && b.contains(top)
      })
      .map((b) => b.getAttribute('aria-label') as string)
  )
  expect(hidden.length).toBeGreaterThan(0)
  const who = map.getByRole('button', { name: hidden[0], exact: true })
  await who.hover()
  await expect(who.locator('.dm-label')).not.toHaveClass(/is-hidden/)
  await expect(who.locator('.dm-label')).toHaveCSS('opacity', '1')
  const lit = map.locator('[data-map-tie].is-open')
  await expect(lit.filter({ hasText: `${hidden[0].split(' ')[0]} →` }).first()).toBeVisible()
  const heights = await lit.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(17)
  await win.mouse.move(2, 2)

  // In the smallest window, fitted again, everyone still fits and the names that show are just as big.
  await windowSize(app, win, 960, 600)
  await main(win).getByRole('button', { name: 'Fit everyone on screen' }).click()
  await expect.poll(async () => (await readMap(win)).inWindow).toBe(25)
  const small = await settledMap(win)
  expect(small.inWindow).toBe(25)
  expect(small.names).toBeGreaterThanOrEqual(6)
  expect(small.smallestName).toBeGreaterThanOrEqual(17)

  // One step in, more names and words show, all at full size.
  await main(win).getByRole('button', { name: 'Zoom in' }).click()
  const closer = await settledMap(win)
  expect(closer.names + closer.words).toBeGreaterThan(small.names + small.words)
  expect(closer.words).toBeGreaterThanOrEqual(1)
  expect(closer.smallestName).toBeGreaterThanOrEqual(17)
  expect(closer.smallestWords).toBeGreaterThanOrEqual(17)
})

test('in the smallest window a small cast opens with everyone on the map, and "As seen in" beside the title', async ({ launch }) => {
  const { app, win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  const [book] = await invoke(win, 'listStories')
  // Nine characters in a chain, which the layout spreads wider than the smallest window shows readably.
  const names = ['Ash Blythe', 'Bryn Cole', 'Cato Marsh', 'Dara Venn', 'Elsa Rook', 'Finn Hale', 'Gus Ward', 'Hale Brook', 'Ida Stone']
  const ids: ID[] = []
  for (const name of names) ids.push((await invoke(win, 'createEntry', 'character', { name, fields: {} })).id)
  for (let i = 0; i + 1 < ids.length; i++) {
    const payload = { otherId: ids[i + 1], type: 'old friend', feels: '', otherFeels: '' }
    await invoke(win, 'createChange', { kind: 'relationship', payload, entryId: ids[i], anchor: 'baseline' })
  }
  const side = await invoke(win, 'createStory', { title: 'The Ferrywoman', startStoryId: book.id })
  await invoke(win, 'setStoryPlacement', side.id, {
    kind: 'side',
    startStoryId: book.id,
    startAt: 'pre',
    startRefId: null,
    endAt: 'end',
    endRefId: null,
    leadsIntoId: null
  })
  await win.reload()
  await expect(binder(win)).toBeVisible()
  await windowSize(app, win, 960, 600)
  await win.getByRole('button', { name: 'Show or hide the binder' }).click()

  await open(win, 'Relationship map')
  const map = main(win).getByRole('group', { name: 'Relationship map' })
  await expect(main(win).locator('[data-map-count]')).toHaveText('9 characters · 8 ties')
  // Everyone counted is in the window, between the strip and the legend.
  await expect.poll(async () => (await readMap(win)).inWindow).toBe(9)
  // "As seen in" sits beside the title, so the map below keeps its height.
  const [title, seenIn] = [
    await main(win).getByRole('heading', { level: 1, name: 'Relationship map' }).boundingBox(),
    await main(win).getByRole('combobox', { name: 'As seen in' }).boundingBox()
  ]
  expect(seenIn!.y).toBeLessThan(title!.y + title!.height + 40)
  expect((await map.boundingBox())!.height).toBeGreaterThanOrEqual(370)
})
