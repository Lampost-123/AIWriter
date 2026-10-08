// The desk's story home (UI overhaul, D5.1), walked through on the sample world: the lamp mark and the story's name open
// it; the book with its title, premise and how much the story holds; Continue writing back to the scene Adam was in; the
// chapters on their shelf opening the story board; the threads, the cast and this week's writing; the footer; and Next
// scene ideas for the next planned scene (the fake provider's three directions).
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, invoke, startFake, test, useFakeModel, type LaunchOptions } from './helpers'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk' }
const home = (win: Page) => win.locator('[data-desk-home]')
const rooms = (win: Page) => win.getByRole('navigation', { name: 'Rooms' })

async function sampleWorld(
  launch: (o?: LaunchOptions) => Promise<{ app: ElectronApplication; win: Page }>,
  opts: LaunchOptions = {}
): Promise<{ app: ElectronApplication; win: Page }> {
  const a = await launch({ ...opts, env: { ...DESK, ...opts.env } })
  await expect(a.win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(a.win, 'openSampleWorld')
  await a.win.reload()
  await expect(a.win.locator('.scene-prose')).toContainText('A hundred and twelve steps to the lamp room.')
  return a
}

test('the story home: the lamp mark and the story’s name open it; the book, the shelf, the threads, the cast and the week', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  // A week of writing on this computer, with a daily target.
  const today = await win.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  await invoke(win, 'updateSettings', { goals: { daily: 150, days: [{ date: today, typed: 206, ai: 40 }] } })
  await win.reload()
  await expect(win.locator('.scene-prose')).toBeVisible()

  // The lamp mark: the story's home, in no room.
  await win.getByRole('button', { name: 'Story home' }).click()
  await expect(home(win)).toBeVisible()
  await expect(rooms(win).locator('[aria-current="page"]')).toHaveCount(0)
  await expect(win.getByRole('button', { name: 'Story home' })).toHaveAttribute('aria-current', 'page')
  await expect(home(win).getByRole('heading', { level: 1, name: 'The Keeper’s Light' })).toBeVisible()
  await expect(home(win)).toContainText('When a stranger brings word that the Gullhaven Light is to be put out for good')
  await expect(home(win).getByLabel('1,105 words, 2 chapters, 4 scenes, 3 done')).toBeVisible()
  // The generated cover, with the book's place among the stories.
  await expect(home(win).locator('[data-book-cover]')).toContainText('Book One')
  // The last lines Adam wrote, from the scene he is in.
  await expect(home(win)).toContainText('The last lines · Lighting the Lamp')
  await expect(home(win)).toContainText('thought better of it, and put it back.')

  // The chapters on the shelf, Adam's own marked; one opens the story board.
  const shelf = home(win).getByRole('region', { name: 'Chapters' })
  await expect(shelf.getByRole('button', { name: /^Chapter One, The Night Ferry\. 2 of 2 scenes done, 571 words, you are in it/ })).toBeVisible()
  await expect(shelf.getByRole('button', { name: /^Chapter Two, The Drowned Steps\. 1 of 2 scenes done, 534 words\./ })).toBeVisible()

  // The threads: open first, with how long; then resolved, with where.
  const lower = home(win).getByRole('region', { name: 'Threads, cast and this week' })
  await expect(lower.getByRole('button', { name: /^Open thread: Will the light go dark at midwinter\?/ })).toBeVisible()
  await expect(lower.getByRole('button', { name: /^Resolved thread: What is in the sealed letter\?.*Resolved in Ch 2, Sc 1/ })).toBeVisible()
  // The cast, the most important first.
  await expect(lower.getByRole('button', { name: /^Cast: Wren Halloway, .*4 characters · 3 places/ })).toBeVisible()
  // This week (typed and AI words kept), and the target.
  await expect(lower).toContainText(/246\s*words this week/)
  // It counts every story's words, and says so.
  await expect(lower).toContainText('Your writing this week, across all your stories')
  await expect(lower).toContainText('Target 150')
  await expect(lower.getByRole('img', { name: /today 246\. Daily target 150\./ })).toBeVisible()
  // The footer: the memory and the checks.
  await expect(home(win).locator('footer')).toContainText('No open issues')

  // Continue writing: back to the page, in the scene Adam was in.
  await home(win).getByRole('button', { name: /^Continue writing/ }).click()
  await expect(home(win)).toHaveCount(0)
  await expect(win.locator('.scene-prose')).toContainText('A hundred and twelve steps')
  await expect(rooms(win).getByRole('button', { name: /^Write/ })).toHaveAttribute('aria-current', 'page')

  // The story's name in the top bar opens the home too; its chevron still opens the story menu.
  await win.locator('[data-desk-topbar] [data-story-home]').click()
  await expect(home(win)).toBeVisible()
  await win.locator('[data-desk-topbar] [data-story-menu]').click()
  await expect(win.getByRole('menu')).toContainText('Stories in this world')
  await win.keyboard.press('Escape')

  // A chapter on the shelf opens the story board (the Plan room).
  await shelf.getByRole('button', { name: /^Chapter Two, The Drowned Steps/ }).click()
  await expect(rooms(win).getByRole('button', { name: /^Plan/ })).toHaveAttribute('aria-current', 'page')

  // The palette has it too.
  await win.keyboard.press('Control+K')
  await win.keyboard.type('story home')
  await win.keyboard.press('Enter')
  await expect(home(win)).toBeVisible()
})

test('the story home: Next scene ideas for the next planned scene, asked for only when opened', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await sampleWorld(launch)
    await useFakeModel(win, fake)
    // No planned scene with an empty card after Adam's: no button.
    await win.getByRole('button', { name: 'Story home' }).click()
    await expect(home(win).getByRole('button', { name: /^Continue writing/ })).toBeVisible()
    await expect(home(win).getByRole('button', { name: 'Next scene ideas' })).toHaveCount(0)

    // A planned scene at the end of Chapter Two (made-up title).
    const [story] = await invoke(win, 'listStories')
    const { chapters } = await invoke(win, 'getOutline', story.id)
    await invoke(win, 'createScene', chapters[1].id, { title: 'Fog on the Quay' })
    await win.reload()
    await expect(win.locator('.scene-prose')).toBeVisible()
    await win.getByRole('button', { name: 'Story home' }).click()
    fake.reset()
    const button = home(win).getByRole('button', { name: 'Next scene ideas' })
    await expect(button).toBeVisible()
    // Nothing is asked until it is opened.
    expect(fake.requestCounts()).toEqual({})
    await button.click()
    const ideas = win.getByRole('dialog', { name: 'Ideas for the next scene' })
    await expect(ideas).toContainText('Fog on the Quay · Chapter Two, scene 3 · planned')
    await expect(ideas.locator('li')).toHaveCount(3)
    await expect(ideas.locator('li').nth(1)).toContainText('A debt called in.')
    expect(fake.requestCounts()).toEqual({ 'fake/writer': 1 })
    // Add to the plan: the story board, with the ideas beside it.
    await ideas.getByRole('button', { name: 'Add to the plan' }).click()
    await expect(rooms(win).getByRole('button', { name: /^Plan/ })).toHaveAttribute('aria-current', 'page')
  } finally {
    await fake.close()
  }
})

test('the story home fits the window without spilling, and the panels never show it', async ({ launch }) => {
  const { app, win } = await sampleWorld(launch)
  for (const [w, h] of [
    [1920, 1080],
    [1440, 900],
    [1280, 800],
    [960, 600]
  ] as const) {
    await app.evaluate(({ BrowserWindow }, [cw, ch]) => BrowserWindow.getAllWindows()[0].setContentSize(cw, ch), [w, h] as [number, number])
    await expect.poll(async () => Math.abs(((await win.evaluate('innerWidth')) as number) - w)).toBeLessThanOrEqual(1)
    await win.getByRole('button', { name: 'Story home' }).click()
    await expect(home(win)).toBeVisible()
    const spill = await home(win).evaluate((e) => e.scrollWidth - e.clientWidth)
    expect(spill, `at ${w}x${h}`).toBeLessThanOrEqual(0)
    // The cast: every one shown has their name under them, readable, and no face covers another (once only two of the
    // four drawn circles were named, the others hidden under them).
    const people = await home(win).locator('.home-pt').evaluateAll((els) =>
      els.map((el) => {
        const face = el.querySelector('.home-pt-face')!.getBoundingClientRect()
        // (Run in the window: the tests' own types have no DOM, so an Element's own fields are enough.)
        const name = el.querySelector('.home-pt-name')!
        return { face: { x: face.x, y: face.y, w: face.width, h: face.height }, name: name.textContent ?? '', shown: name.getBoundingClientRect().width > 8, cut: name.scrollWidth > name.clientWidth, title: el.getAttribute('title') ?? '' }
      })
    )
    expect(people.map((p) => p.name), `at ${w}x${h}`).toEqual(['Wren', 'Iska', 'Edric', 'Ansel'])
    for (const p of people) {
      expect(p.shown, `${p.name}'s name at ${w}x${h}`).toBe(true)
      if (p.cut) expect(p.title, `${p.name} cut short shows whole on hover`).toMatch(new RegExp(`^${p.name}`))
    }
    for (let i = 0; i < people.length; i++)
      for (let j = i + 1; j < people.length; j++) {
        const [a, b] = [people[i].face, people[j].face]
        const apart = a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5
        expect(apart, `${people[i].name} and ${people[j].name} apart at ${w}x${h}`).toBe(true)
      }
  }
  // The panels: the home is the desk's own; the page shows instead.
  await invoke(win, 'updateSettings', { arrangement: 'panels' })
  await win.reload()
  await expect(win.locator('.scene-prose')).toBeVisible()
  await expect(home(win)).toHaveCount(0)
})

test('drawings: the cast and the places show drawings picked from their words; the entry page and the cover change them', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  await win.getByRole('button', { name: 'Story home' }).click()
  // The cover: the story's drawing (a lantern, from "keeper" and "light").
  await expect(home(win).locator('[data-book-cover] [data-motif="lantern"]')).toBeVisible()
  // The cast, with no portraits, each a different drawing: Wren the lantern (her words call for it most), Edric his boat, Iska a letter.
  const cast = home(win).getByRole('button', { name: /^Cast:/ })
  await expect(cast.locator('[data-motif]')).toHaveCount(4)
  await expect(cast.locator('[data-motif="letter"]')).toHaveCount(1)
  await expect(cast.locator('[data-motif="lantern"]')).toHaveCount(1)
  await expect(cast.locator('[data-motif="boat"]')).toHaveCount(1)

  // On the story board, a scene's place shows its drawing on its tile.
  await rooms(win).getByRole('button', { name: /^Plan/ }).click()
  await expect(win.locator('[data-board-card]', { hasText: 'Low Tide' }).locator('[data-motif="stairs"]')).toBeVisible()

  // Edric's dossier: his drawing, picked from his words (the lantern being Wren's, his next), and Change.
  await rooms(win).getByRole('button', { name: /^World/ }).click()
  await win.locator('[data-desk-room]').getByText(/^Keeper of the Gullhaven Light for forty years/).first().click()
  const picker = win.locator('[data-motif-picker]')
  await expect(picker).toContainText('Drawing: small boat')
  await expect(picker).toContainText('Picked from its words')
  await picker.getByRole('button', { name: 'Change' }).click()
  const grid = win.getByRole('radiogroup', { name: 'Drawings for Edric Halloway' })
  // The ones his words suit come first.
  await expect(grid.getByRole('radio').first()).toHaveAccessibleName('A lantern')
  await expect(grid.getByRole('radio', { name: 'A small boat' })).toHaveAttribute('aria-checked', 'true')
  await grid.getByRole('radio', { name: 'A bell' }).click()
  await expect(picker).toContainText('Drawing: bell')
  await expect(picker).toContainText('You chose it')
  const edric = (await invoke(win, 'listEntries', 'character')).find((e) => e.name === 'Edric Halloway')!
  expect((await invoke(win, 'getArtChoices')).entries[edric.id]).toEqual({ motif: 'bell', by: 'adam' })
  // Nothing of the entry itself changed (its words, its history).
  expect((await invoke(win, 'getEntry', edric.id)).fields.motif).toBeUndefined()

  // Back home: Edric's face is a bell now. The cover: a colour and a drawing of Adam's own.
  await win.getByRole('button', { name: 'Story home' }).click()
  await expect(cast.locator('[data-motif="bell"]')).toHaveCount(1)
  await home(win).getByRole('button', { name: 'Change the cover' }).click()
  await win.getByRole('radiogroup', { name: 'Cover drawing' }).getByRole('radio', { name: 'A sailing ship' }).click()
  await expect(home(win).locator('[data-book-cover] [data-motif="ship"]')).toBeVisible()
  const [story] = await invoke(win, 'listStories')
  expect((await invoke(win, 'getArtChoices')).stories[story.id]).toEqual({ motif: 'ship' })
  await win.getByRole('button', { name: 'Use its own cover' }).click()
  await expect(home(win).locator('[data-book-cover] [data-motif="lantern"]')).toBeVisible()

  // The panels: the entry page has no drawing picker.
  await invoke(win, 'updateSettings', { arrangement: 'panels' })
  await win.reload()
  await expect(win.locator('.scene-prose')).toBeVisible()
  await expect(win.locator('[data-motif-picker]')).toHaveCount(0)
})
