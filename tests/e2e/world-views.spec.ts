// The timeline, the relationship map and the plot threads board, end to end. Each opens from its
// binder link and teaches what it needs while the world is empty; then, on a small world made through
// the API (Book 1 with twelve chapters, Mara, Tobin and Kell, two places and three plot threads), the
// timeline shows a clash and opens scenes, the map changes with its slider, and the board highlights a
// thread left open and links to the scenes that set up and pay off each one.
import type { Page } from '@playwright/test'
import type { ID, SceneCard } from '@shared/types'
import { emptySceneCard } from '@shared/defaults'
import { binder, createWorldFromWelcome, expect, invoke, test } from './helpers'

const main = (win: Page) => win.locator('main')
const open = (win: Page, link: string) => binder(win).getByRole('button', { name: link, exact: true }).click()
const sceneRow = (win: Page, title: string) => binder(win).getByRole('treeitem', { name: title })

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

test('the timeline: lanes, a clash in plain words, and a click opens the scene', async ({ launch }) => {
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

  // Mara can't be in Ashford and at the mill on the same day.
  const clashes = main(win).getByRole('region', { name: 'Clashes' })
  await expect(clashes).toContainText('1 clash on the timeline')
  await clashes.getByRole('button', { name: 'Mara is in Ashford and Harrow Mill on Day 12.' }).click()
  const first = timeline.getByRole('button', { name: /^Book 1, Ch 1, Sc 1, Scene 1\. Day 12\. Mara is in Ashford/ })
  await expect(first).toBeFocused()

  // Scenes keep the order they happen in; those with no date keep their reading order, marked so.
  const names = await timeline.getByRole('button').evaluateAll((els) => els.slice(0, 4).map((e) => e.getAttribute('aria-label') ?? ''))
  expect(names.map((n) => n.split('.')[0])).toEqual([
    'Book 1, Ch 1, Sc 1, Scene 1',
    'Book 1, Ch 1, Sc 2, The mill burns',
    'Book 1, Ch 2, Sc 1, Tobin returns',
    'Book 1, Ch 3, Sc 1, Scene in chapter 3'
  ])
  await expect(timeline.getByRole('button', { name: /Scene in chapter 3\. No date\./ })).toBeVisible()

  // The keyboard moves between rows.
  await first.press('ArrowDown')
  await expect(timeline.getByRole('button', { name: /The mill burns/ })).toBeFocused()

  // Lanes follow characters, or plot threads.
  await expect(main(win).getByRole('button', { name: /^Lanes/ })).toContainText('2 of 2')
  await main(win).getByRole('radio', { name: 'Plot threads' }).click()
  await expect(main(win).getByTitle('Who burned the mill?')).toBeVisible()

  // Clicking a scene opens it.
  await timeline.getByRole('button', { name: /Tobin returns/ }).click()
  await expect(win.locator('.scene-prose')).toBeVisible()
  await expect(sceneRow(win, 'Tobin returns')).toHaveAttribute('aria-selected', 'true')
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
  await expect(slider).toHaveAttribute('aria-valuetext', 'Book 1, Ch 1, Sc 1')
  await expect(map.getByRole('button', { name: 'Mara', exact: true })).toBeVisible()
  await expect(map.getByRole('button', { name: /^Mara and Tobin: friend\. Mara feels fond\. Tobin feels wary\.$/ })).toBeVisible()
  await expect(map.getByRole('button', { name: 'Kell', exact: true })).toHaveCount(0)

  // How each feels shows beside the line on focus.
  await map.getByRole('button', { name: /^Mara and Tobin/ }).focus()
  await expect(main(win).getByText('Mara feels fond')).toBeVisible()

  // At the end of the book they are rivals, and Kell owes Tobin money.
  await slider.focus()
  await win.keyboard.press('End')
  await expect(map.getByRole('button', { name: /^Mara and Tobin: rival\./ })).toBeVisible()
  await expect(map.getByRole('button', { name: /^Kell and Tobin: owes money\./ })).toBeVisible()
  await expect(map.getByRole('button', { name: 'Kell', exact: true })).toBeVisible()
  await expect(main(win).getByText('3 characters, 2 relationships')).toBeVisible()

  // Characters stay where they were as the slider moves.
  const box = async () => map.getByRole('button', { name: 'Mara', exact: true }).boundingBox()
  const before = await box()
  await win.keyboard.press('Home')
  await expect(map.getByRole('button', { name: /^Mara and Tobin: friend\./ })).toBeVisible()
  await expect(map.getByRole('button', { name: 'Kell', exact: true })).toHaveCount(0)
  expect(await box()).toEqual(before)

  // The keyboard and the buttons move and zoom the map.
  await map.focus()
  await win.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await box())?.x).toBeGreaterThan(before!.x)
  await main(win).getByRole('button', { name: 'Zoom out' }).click()
  await expect.poll(async () => (await box())?.width).toBeLessThan(before!.width)
  await main(win).getByRole('button', { name: 'Fit the map to the window' }).click()

  // Clicking a character opens its page.
  await slider.focus()
  await win.keyboard.press('End')
  await map.getByRole('button', { name: 'Kell', exact: true }).click()
  await expect(binder(win).getByRole('button', { name: /^Characters/ })).toHaveAttribute('aria-current', 'page')
})

test('the plot threads board: open, resolved and planned, a thread left open highlighted, and links to scenes', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')

  // With no plot threads yet, the board says what they are and makes one.
  await open(win, 'Plot threads board')
  await expect(main(win).getByRole('heading', { level: 1, name: 'Plot threads' })).toBeVisible()
  await expect(main(win).getByRole('heading', { name: 'No plot threads yet' })).toBeVisible()
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
