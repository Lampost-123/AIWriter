// Milestone 4's outline part, walked through the way Adam works, against the fake provider (its
// tests/fake-provider/m4/outline.mjs answers "[AIWRITE-OUTLINE v1]" requests with a fixed plan: acts "The
// Arrival", "The Turning"...; chapters "Rain on the Narrows", "The Ferryman's Price", "Lanterns at Low
// Tide"...; scenes "Arrival at the docks", "A bargain at the docks"...; and three scene ideas).
//
//  1. The outline helper suggests acts, chapters and scene cards from the story's premise (an empty
//     premise gets a quiet word, not an error), and nothing is added until Adam clicks. He changes a
//     scene, discards a chapter (Undo brings it back), keeps one scene (its chapter and act come with
//     it; Undo takes them out again), then keeps all that's left. What he kept is in the binder under
//     its acts, in order, each scene's card filled in. The first Keep takes the place of the empty
//     Chapter 1 and Scene 1 the story was made with, and its Undo puts them back; What the AI saw and
//     back; Start writing. A kept scene
//     deleted while the helper isn't showing waits for a decision again when it opens. Asked again, it
//     carries on from what the story has.
//  2. A suggestion can be stopped part way, and leaving the page doesn't lose it; what arrived can be
//     kept. One that fails says why in plain words, and Undo brings back the suggestions it replaced.
//     What was kept and is then deleted in the binder waits for a decision again. Replaced suggestions
//     can be brought back until one of the new ones is kept.
//  3. Acts in the binder: a story without acts looks as it always has, and is given one from a
//     chapter's menu (with Undo); acts fold and unfold, are renamed and given a purpose, get a new
//     chapter, take a chapter moved from another act (with Undo), and are deleted with their chapters
//     (with Undo, and from Recently deleted).
//  4. Next scene ideas: an empty scene card offers three directions; Use this fills the card and names
//     a scene still called "Scene 1", with Undo; other ideas that fail leave the ones on screen; Stop
//     keeps what arrived; the button stays put while the card is filled in; from the palette too, where
//     Use this adds to what the card has; What the AI saw and back.
import type { Page } from '@playwright/test'
import type { FakeProvider } from '../fake-provider/server.mjs'
import { binder, createWorldFromWelcome, expect, invoke, openSettings, test, useFakeModel } from './helpers'

const PREMISE =
  'Mara, a ferryman who owes the Duke more than she can pay, is hired to smuggle the heir out of Varn before the river freezes.'

// ---------- Finding things on screen ----------

const main = (win: Page) => win.locator('main')
const heading = (win: Page) => main(win).getByRole('heading', { level: 1 })
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')
/** The toast saying this (there may be others). */
const toastWith = (win: Page, text: string) => toasts(win).locator(':scope > div', { hasText: text })
const undoIn = (win: Page, text: string) => toastWith(win, text).getByRole('button', { name: 'Undo' })
const palette = (win: Page) => win.getByRole('dialog', { name: 'Search' })

/** One of the outline helper's suggestions, with what is inside it. */
const suggestion = (win: Page, kind: 'Act' | 'Chapter' | 'Scene', title: string) =>
  main(win).getByRole('group', { name: `${kind}: ${title}`, exact: true })
const keepButton = (win: Page, title: string) => main(win).getByRole('button', { name: `Keep “${title}”`, exact: true })

const actRows = (win: Page) => binder(win).locator('[data-row="act"]')
const actRow = (win: Page, title: string) => binder(win).locator('[data-row="act"]', { hasText: title })
/** An act in the binder with its chapters and their scenes. */
const actBlock = (win: Page, title: string) => actRow(win, title).locator('xpath=..')
const chapterRow = (win: Page, title: string) => binder(win).locator('[data-row="chapter"]', { hasText: title })
const sceneRow = (win: Page, title: string) => binder(win).locator('[data-row="scene"]', { hasText: title })

const sceneCard = (win: Page) => win.getByRole('tabpanel', { name: 'Scene card' })
const ideasList = (win: Page) => sceneCard(win).getByRole('region', { name: 'Ideas for this scene' })

/** Picks how much the helper suggests. */
async function choose(win: Page, label: string, option: string): Promise<void> {
  await main(win).getByRole('combobox', { name: label, exact: true }).click()
  await win.getByRole('option', { name: option, exact: true }).click()
  await expect(main(win).getByRole('combobox', { name: label, exact: true })).toHaveText(option)
}

/** Opens the outline helper from the story menu. */
async function openHelper(win: Page, story = 'Book 1'): Promise<void> {
  await binder(win).getByRole('button', { name: story, exact: true }).click()
  await win.getByRole('menuitem', { name: 'Outline helper' }).click()
  await expect(main(win).getByLabel('Premise', { exact: true })).toBeVisible()
}

/** The fake server, its slow model ("fake/slow") taking `slowDelayMs` between pieces. */
async function startFake(slowDelayMs = 40): Promise<FakeProvider> {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  return startFakeProvider({ delayMs: 2, slowDelayMs })
}

/** Makes `modelId` the writer model (which the outline helper uses when it has none of its own), without a reload. */
async function setModel(win: Page, modelId: string): Promise<void> {
  const p = (await invoke(win, 'listProviders')).find((x) => x.name === 'Fake')!
  await invoke(win, 'updateSettings', {
    models: { writer: { providerId: p.id, modelId, label: modelId, contextLength: 32000, promptPrice: null, completionPrice: null } }
  })
}

// ---------- The outline helper ----------

test('the outline helper suggests acts, chapters and scene cards from the premise, and adds only what Adam keeps', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Varn')
    const [story] = await invoke(win, 'listStories')
    await invoke(win, 'updateStory', story.id, { premise: PREMISE })
    await invoke(win, 'createEntry', 'thread', { name: 'Who burned the mill?' })
    await useFakeModel(win, fake)

    // ----- From the story menu, with the story's premise; a new story is planned from the start -----
    await openHelper(win)
    await expect(heading(win)).toHaveText('Plan the story from its premise')
    const premiseBox = main(win).getByLabel('Premise', { exact: true })
    await expect(premiseBox).toHaveValue(PREMISE)

    // With no premise, a quiet word on what to write first: nothing has gone wrong.
    await premiseBox.fill('')
    await expect(premiseBox).toHaveAttribute('placeholder', /^For example: /)
    await main(win).getByRole('button', { name: 'Suggest an outline' }).click()
    await expect(main(win).getByText('Write the premise first: a line or two on what the story is about is enough.')).toBeVisible()
    await expect(main(win).getByRole('alert')).toHaveCount(0)
    await expect(premiseBox).toBeFocused()
    await premiseBox.fill(PREMISE)
    await expect(main(win).getByText('Write the premise first', { exact: false })).toHaveCount(0)
    await expect(main(win).getByRole('combobox', { name: 'Acts', exact: true })).toHaveText('3 acts')
    await choose(win, 'Acts', '2 acts')
    await choose(win, 'Chapters', '3 chapters')
    await choose(win, 'Scenes in each chapter', '2 scenes in each')
    await expect(main(win).getByText('About 6 scenes.')).toBeVisible()

    fake.reset()
    await main(win).getByRole('button', { name: 'Suggest an outline' }).click()
    await expect(main(win).getByText('Here is the outline: 2 acts, 3 chapters and 6 scenes. Keep what you like.')).toBeVisible()
    expect(fake.requestCounts()).toEqual({ 'fake/writer': 1 })
    const sent = fake.lastRequest()!.body.messages
    expect(sent[0].content.startsWith('[AIWRITE-OUTLINE v1] outline')).toBe(true)
    expect(sent[1].content).toContain(`Premise: ${PREMISE}`)
    expect(sent[1].content).toContain('## Open plot threads\n- Who burned the mill?')
    expect(sent[1].content).toContain('Suggest 2 new acts with 3 chapters in all')
    expect(sent[1].content).toContain('The story has nothing written or planned yet: start it from the premise.')

    // The suggestions, in order: each act, the chapters in it and their scene cards. None is in the story yet.
    expect(
      await main(win)
        .locator('[data-suggestion]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    ).toEqual([
      'Act: The Arrival',
      'Chapter: Rain on the Narrows',
      'Scene: Arrival at the docks',
      'Scene: A bargain at the docks',
      "Chapter: The Ferryman's Price",
      'Scene: Arrival at the ferry',
      'Scene: A bargain at the ferry',
      'Act: The Turning',
      'Chapter: Lanterns at Low Tide',
      'Scene: Arrival at the market',
      'Scene: A bargain at the market'
    ])
    await expect(suggestion(win, 'Chapter', 'Rain on the Narrows')).toContainText('“Who burned the mill?” comes back to haunt her')
    await expect(main(win).locator('[data-suggestion][data-state="open"]')).toHaveCount(11)
    await expect(actRows(win)).toHaveCount(0)
    expect((await invoke(win, 'getOutline', story.id)).chapters.map((c) => c.title)).toEqual(['Chapter 1'])

    // ----- Change a scene: its title, what happens and its beats -----
    await main(win).getByRole('button', { name: 'Edit “Arrival at the docks”' }).click()
    const form = main(win).getByRole('form', { name: 'Edit the scene' })
    await expect(form.getByLabel('Title', { exact: true })).toBeFocused()
    await form.getByLabel('Title', { exact: true }).fill('Arrival in the rain')
    await form.getByLabel('What happens', { exact: true }).fill('Mara lands at the docks in the rain, and the guild is waiting.')
    await form.getByLabel('Beats', { exact: true }).fill('Mara lands in the rain\nShe spots the watcher\nShe slips away')
    await form.getByRole('button', { name: 'Save changes' }).click()
    await expect(form).toHaveCount(0)
    const changed = suggestion(win, 'Scene', 'Arrival in the rain')
    await expect(changed).toContainText('Changed by you')
    await expect(changed.locator('li')).toHaveText(['Mara lands in the rain', 'She spots the watcher', 'She slips away'])

    // ----- Discard a chapter: its scenes go with it, and Undo brings them back -----
    await main(win).getByRole('button', { name: "Discard “The Ferryman's Price”" }).click()
    const discarded = "Discarded “The Ferryman's Price” and its 2 scenes."
    await expect(toastWith(win, discarded)).toBeVisible()
    await expect(suggestion(win, 'Chapter', "The Ferryman's Price")).toHaveCount(0)
    await expect(suggestion(win, 'Scene', 'Arrival at the ferry')).toHaveCount(0)
    await undoIn(win, discarded).click()
    await expect(suggestion(win, 'Scene', 'Arrival at the ferry')).toBeVisible()
    await main(win).getByRole('button', { name: "Discard “The Ferryman's Price”" }).click()
    await expect(suggestion(win, 'Chapter', "The Ferryman's Price")).toHaveCount(0)

    // ----- Keep one scene: its chapter and act come with it, after what the story has -----
    await keepButton(win, 'A bargain at the docks').click()
    const keptOne = 'Added “A bargain at the docks” to the story, in a new chapter and act.'
    await expect(toastWith(win, keptOne)).toBeVisible()
    for (const [kind, title] of [
      ['Act', 'The Arrival'],
      ['Chapter', 'Rain on the Narrows'],
      ['Scene', 'A bargain at the docks']
    ] as const)
      await expect(suggestion(win, kind, title)).toHaveAttribute('data-state', 'kept')
    await expect(suggestion(win, 'Scene', 'Arrival in the rain')).toHaveAttribute('data-state', 'open')
    await expect(actRows(win)).toHaveCount(1)
    await expect(actBlock(win, 'The Arrival').locator('[data-row="chapter"]')).toContainText(['Rain on the Narrows'])
    await expect(actBlock(win, 'The Arrival').locator('[data-row="scene"]')).toHaveCount(1)
    await expect(actBlock(win, 'The Arrival').locator('[data-row="scene"]')).toContainText(['A bargain at the docks'])
    // The first Keep takes the place of the empty Chapter 1 and Scene 1 the story was made with: nothing is left above it.
    await expect(chapterRow(win, 'Chapter 1')).toHaveCount(0)
    await expect(main(win).getByRole('button', { name: /^Remove the empty/ })).toHaveCount(0)
    expect((await invoke(win, 'getOutline', story.id)).chapters.map((c) => c.title)).toEqual(['Rain on the Narrows'])

    // Undo takes them out of the story again, and they wait for a decision once more.
    await undoIn(win, keptOne).click()
    await expect(actRows(win)).toHaveCount(0)
    await expect(chapterRow(win, 'Chapter 1')).toHaveCount(1)
    await expect(suggestion(win, 'Act', 'The Arrival')).toHaveAttribute('data-state', 'open')
    expect((await invoke(win, 'getOutline', story.id)).chapters.map((c) => c.title)).toEqual(['Chapter 1'])

    // ----- Keep it again, then everything that's left -----
    await keepButton(win, 'A bargain at the docks').click()
    await toastWith(win, keptOne).getByRole('button', { name: 'Dismiss' }).click()
    await main(win).getByRole('button', { name: 'Keep all that’s left' }).click()
    await expect(toastWith(win, 'Added an act, a chapter and 3 scenes to the story.')).toBeVisible()
    await expect(
      main(win).getByText('Everything is decided. What you kept is in the binder, with each scene’s card filled in.')
    ).toBeVisible()
    await expect(main(win).getByRole('button', { name: 'Keep all that’s left' })).toHaveCount(0)

    // In the binder: each act with its chapters and scenes, in the order suggested.
    await expect(actRows(win)).toHaveCount(2)
    await expect(actRows(win)).toContainText(['The Arrival', 'The Turning'])
    await expect(actBlock(win, 'The Arrival').locator('[data-row="chapter"]')).toHaveCount(1)
    await expect(actBlock(win, 'The Arrival').locator('[data-row="scene"]')).toHaveCount(2)
    await expect(actBlock(win, 'The Arrival').locator('[data-row="scene"]')).toContainText([
      'Arrival in the rain',
      'A bargain at the docks'
    ])
    await expect(actBlock(win, 'The Turning').locator('[data-row="chapter"]')).toContainText(['Lanterns at Low Tide'])
    await expect(actBlock(win, 'The Turning').locator('[data-row="scene"]')).toContainText([
      'Arrival at the market',
      'A bargain at the market'
    ])
    await expect(chapterRow(win, "The Ferryman's Price")).toHaveCount(0)
    const kept = await invoke(win, 'getOutline', story.id)
    expect(kept.acts!.map((a) => [a.title, a.purpose])).toEqual([
      ['The Arrival', 'Mara reaches the city and learns what the guild wants of her.'],
      ['The Turning', 'Her loyalties split when the guild turns on the people she came to protect.']
    ])
    const actTitle = new Map(kept.acts!.map((a) => [a.id, a.title]))
    expect(kept.chapters.map((c) => [c.title, c.actId ? actTitle.get(c.actId) : null])).toEqual([
      ['Rain on the Narrows', 'The Arrival'],
      ['Lanterns at Low Tide', 'The Turning']
    ])
    expect(kept.chapters[0].goal).toBe('Mara finds her footing in the city, and “Who burned the mill?” comes back to haunt her.')
    // Each scene's card is filled in: what happens as its goal, and its beats (Adam's own, where he changed them).
    const cardOf = async (title: string) => (await invoke(win, 'getScene', kept.scenes.find((s) => s.title === title)!.id)).card
    expect(await cardOf('Arrival in the rain')).toMatchObject({
      goal: 'Mara lands at the docks in the rain, and the guild is waiting.',
      beats: ['Mara lands in the rain', 'She spots the watcher', 'She slips away']
    })
    expect(await cardOf('A bargain at the market')).toMatchObject({
      goal: 'Tobin offers Mara a deal at the market that she can’t refuse.',
      beats: ['Tobin names his price', 'Mara haggles and loses', 'They shake on it, both lying']
    })

    // ----- What the AI saw, and back -----
    await main(win).getByRole('button', { name: 'What the AI saw' }).click()
    await expect(main(win).getByRole('heading', { level: 1, name: 'What the AI saw' })).toBeVisible()
    await expect(main(win).getByText(/^The exact briefing for this outline, written /)).toBeVisible()
    await main(win).getByRole('button', { name: 'Back to the outline helper' }).click()
    await expect(main(win).getByText('Everything is decided.', { exact: false })).toBeVisible()
    await expect(suggestion(win, 'Scene', 'Arrival in the rain')).toHaveAttribute('data-state', 'kept')

    // ----- Start writing: the first scene kept, its card filled in, offers no ideas -----
    await main(win).getByRole('button', { name: 'Start writing' }).click()
    await expect(win.locator('main header').getByRole('button', { name: 'Arrival in the rain', exact: true })).toBeVisible()
    await win.getByRole('tab', { name: 'Scene card' }).click()
    await expect(sceneCard(win).getByRole('textbox', { name: 'Beats', exact: true })).toHaveValue('Mara lands in the rain')
    await expect(sceneCard(win).getByRole('textbox', { name: 'Beat 3', exact: true })).toHaveValue('She slips away')
    await expect(sceneCard(win).getByRole('button', { name: 'Ideas for this scene' })).toHaveCount(0)

    // ----- A kept scene deleted while the helper isn't showing waits for a decision again, from the first frame -----
    // (Once the toasts have gone, so nothing looks at what was kept until the helper opens.)
    const dismiss = toasts(win).getByRole('button', { name: 'Dismiss' })
    while ((await dismiss.count()) > 0) await dismiss.first().click()
    await sceneRow(win, 'A bargain at the market').click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Delete scene' }).click()
    await expect(sceneRow(win, 'A bargain at the market')).toHaveCount(0)
    // Anything drawn showing it as kept, even for a moment, is noted.
    await win.evaluate(`(() => {
      window.sawKept = false
      const look = () => {
        if (document.querySelector('[data-state="kept"][aria-label="Scene: A bargain at the market"]')) window.sawKept = true
      }
      new MutationObserver(look).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state'] })
    })()`)

    // ----- From the palette, asked again: it carries on from what the story has, in its last act -----
    await win.keyboard.press('Control+K')
    await win.keyboard.type('Outline helper')
    await palette(win).getByRole('option', { name: 'Outline helper' }).click()
    await expect(heading(win)).toHaveText('Plan what comes next')
    await expect(suggestion(win, 'Scene', 'A bargain at the market')).toHaveAttribute('data-state', 'open')
    await expect(suggestion(win, 'Scene', 'Arrival at the market')).toHaveAttribute('data-state', 'kept')
    expect(await win.evaluate('window.sawKept')).toBe(false)
    await expect(main(win).getByText('New acts go after the story’s acts.')).toBeVisible()
    await choose(win, 'Acts', 'No new acts')
    await expect(main(win).getByText('The chapters go in the story’s last act, “The Turning”.')).toBeVisible()
    await choose(win, 'Chapters', '1 chapter')
    await choose(win, 'Scenes in each chapter', '1 scene in each')
    fake.reset()
    await main(win).getByRole('button', { name: 'Suggest again' }).click()
    await expect(main(win).getByText('Here is the outline: 1 chapter and 1 scene. Keep what you like.')).toBeVisible()
    const again = fake.lastRequest()!.body.messages[1].content
    expect(again).toContain('## What the story has so far\nAct: The Arrival')
    expect(again).toContain('  Chapter: Lanterns at Low Tide')
    expect(again).toContain("They carry on the story's last act, “The Turning”.")
    await keepButton(win, "The Ferryman's Price").click()
    await expect(toastWith(win, "Added “The Ferryman's Price” to the story, with a scene.")).toBeVisible()
    await expect(actBlock(win, 'The Turning').locator('[data-row="chapter"]')).toHaveCount(2)
    await expect(actBlock(win, 'The Turning').locator('[data-row="chapter"]')).toContainText([
      'Lanterns at Low Tide',
      "The Ferryman's Price"
    ])
  } finally {
    await fake.close()
  }
})

test('a suggestion can be stopped part way and what arrived kept; leaving the page loses nothing; a failed one says why', async ({
  launch
}) => {
  const fake = await startFake(80)
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Varn')
    const [story] = await invoke(win, 'listStories')
    await invoke(win, 'updateStory', story.id, { premise: PREMISE })
    await useFakeModel(win, fake, 'fake/slow')

    // A story with nothing written offers its plan in the binder.
    await binder(win).getByRole('button', { name: 'Plan it with the outline helper' }).click()
    await expect(heading(win)).toHaveText('Plan the story from its premise')
    await main(win).getByRole('button', { name: 'Suggest an outline' }).click()
    await expect(main(win).getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await expect(suggestion(win, 'Scene', 'Arrival at the docks')).toBeVisible()
    // While it arrives, the suggestions can't be kept yet.
    await expect(keepButton(win, 'The Arrival')).toHaveCount(0)

    // Away to the scene and back: it is still arriving, with Stop.
    await sceneRow(win, 'Scene 1').click()
    await expect(win.locator('main header').getByRole('button', { name: 'Scene 1', exact: true })).toBeVisible()
    await openHelper(win)
    await expect(main(win).getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await expect(main(win).getByText(/^Suggesting… .+ so far$/)).toBeVisible()
    await expect(suggestion(win, 'Scene', 'Arrival at the docks')).toBeVisible()

    await main(win).getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(main(win).getByText(/^Stopped\. What had arrived is below: /)).toBeVisible()
    await keepButton(win, 'Arrival at the docks').click()
    await expect(toastWith(win, 'Added “Arrival at the docks” to the story, in a new chapter and act.')).toBeVisible()
    await expect(actBlock(win, 'The Arrival').locator('[data-row="scene"]')).toContainText(['Arrival at the docks'])

    // A request that fails says why in plain words. The suggestions it replaced come back with Undo.
    await setModel(win, 'fake/credit')
    await main(win).getByRole('button', { name: 'Suggest again' }).click()
    await expect(main(win).getByText(/says your account is out of credit\. Top up there/)).toBeVisible()
    await expect(suggestion(win, 'Act', 'The Arrival')).toHaveCount(0)
    await undoIn(win, 'Replaced the earlier suggestions you hadn’t decided on.').click()
    await expect(suggestion(win, 'Scene', 'Arrival at the docks')).toHaveAttribute('data-state', 'kept')
    await expect(suggestion(win, 'Act', 'The Arrival')).toHaveAttribute('data-state', 'kept')
    await expect(main(win).getByText(/out of credit/)).toHaveCount(0)
    await expect(main(win).getByText(/^Stopped\. What had arrived is below: /)).toBeVisible()

    // Deleted from the binder, what was kept waits for a decision again, and Keep makes it anew.
    await actRow(win, 'The Arrival').click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Delete act' }).click()
    await expect(toastWith(win, '“The Arrival” and its chapter deleted.')).toBeVisible()
    await expect(actRows(win)).toHaveCount(0)
    await expect(heading(win)).toHaveText('Plan the story from its premise')
    await expect(suggestion(win, 'Act', 'The Arrival')).toHaveAttribute('data-state', 'open')
    await expect(suggestion(win, 'Scene', 'Arrival at the docks')).toHaveAttribute('data-state', 'open')
    await keepButton(win, 'Arrival at the docks').click()
    await expect(toastWith(win, 'Added “Arrival at the docks” to the story, in a new chapter and act.')).toHaveCount(1)
    await expect(actBlock(win, 'The Arrival').locator('[data-row="scene"]')).toContainText(['Arrival at the docks'])
    await expect(suggestion(win, 'Scene', 'Arrival at the docks')).toHaveAttribute('data-state', 'kept')
    expect((await invoke(win, 'getOutline', story.id)).acts!.map((a) => a.title)).toEqual(['The Arrival'])

    // Asked again, the undecided ones can come back with Undo until Adam keeps one of the new ones.
    await setModel(win, 'fake/writer')
    await main(win).getByRole('button', { name: 'Suggest again' }).click()
    const replacedNote = toastWith(win, 'Replaced the earlier suggestions you hadn’t decided on.')
    await expect(replacedNote).toBeVisible()
    await expect(main(win).getByText(/^Here is the outline: /)).toBeVisible()
    await main(win).locator('[data-suggestion="scene"][data-state="open"]').first().getByRole('button', { name: /^Keep/ }).click()
    await expect(main(win).locator('[data-suggestion="scene"][data-state="kept"]')).toHaveCount(1)
    await expect(replacedNote).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

// ---------- Acts in the binder ----------

test('acts in the binder fold, are renamed and given a purpose, take chapters, and are deleted with Undo', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Varn')
  const [story] = await invoke(win, 'listStories')

  // A story with no acts looks as it always has: its chapters at the top level.
  await expect(actRows(win)).toHaveCount(0)
  await expect(chapterRow(win, 'Chapter 1')).toHaveAttribute('aria-level', '1')

  // ----- A story written without acts is given one from a chapter's menu, reading in the same order; Undo joins it back -----
  await invoke(win, 'createChapter', story.id, { title: 'Chapter 2' })
  await win.reload()
  await chapterRow(win, 'Chapter 1').click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Start a new act here' }).click()
  const started = 'Started a new act at “Chapter 1”.'
  await expect(toastWith(win, started)).toBeVisible()
  const newAct = binder(win).getByRole('textbox', { name: 'Act title' })
  await expect(newAct).toBeFocused()
  await expect(newAct).toHaveValue('Act 1')
  await newAct.fill('Beginnings')
  await newAct.press('Enter')
  await expect(actBlock(win, 'Beginnings').locator('[data-row="chapter"]')).toContainText(['Chapter 1', 'Chapter 2'])
  await expect(chapterRow(win, 'Chapter 1')).toHaveAttribute('aria-level', '2')
  expect((await invoke(win, 'getOutline', story.id)).chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2'])
  await undoIn(win, started).click()
  await expect(actRows(win)).toHaveCount(0)
  await expect(chapterRow(win, 'Chapter 1')).toHaveAttribute('aria-level', '1')
  await expect(chapterRow(win, 'Chapter 2')).toHaveAttribute('aria-level', '1')
  await expect.poll(async () => (await invoke(win, 'getOutline', story.id)).acts).toEqual([])

  const one = await invoke(win, 'createAct', story.id, { title: 'Act One' })
  const two = await invoke(win, 'createAct', story.id, { title: 'Act Two' })
  const docks = await invoke(win, 'createChapterAt', story.id, { actId: one.id, title: 'The Docks' })
  await invoke(win, 'createScene', docks.id, { title: 'Landing' })
  const tower = await invoke(win, 'createChapterAt', story.id, { actId: two.id, title: 'The Tower' })
  await invoke(win, 'createScene', tower.id, { title: 'The climb' })
  await win.reload()
  await expect(actRows(win)).toHaveCount(2)
  await expect(actRows(win)).toContainText(['Act One', 'Act Two'])
  // The chapter written before the story had acts comes first; an act's chapters sit a level in, drawn one step further right.
  await expect(chapterRow(win, 'Chapter 1')).toHaveAttribute('aria-level', '1')
  await expect(chapterRow(win, 'The Docks')).toHaveAttribute('aria-level', '2')
  await expect(actBlock(win, 'Act One').locator('[data-row="scene"]')).toContainText(['Landing'])
  const leftOf = async (row: ReturnType<typeof chapterRow>): Promise<number> =>
    (await row.getByRole('button', { name: 'Hide scenes' }).boundingBox())!.x
  expect((await leftOf(chapterRow(win, 'The Docks'))) - (await leftOf(chapterRow(win, 'Chapter 1')))).toBe(12)

  // ----- Fold and unfold -----
  await actRow(win, 'Act One').getByRole('button', { name: 'Hide chapters' }).click()
  await expect(actRow(win, 'Act One')).toHaveAttribute('aria-expanded', 'false')
  await expect(chapterRow(win, 'The Docks')).toHaveCount(0)
  await expect(sceneRow(win, 'Landing')).toHaveCount(0)
  await expect(chapterRow(win, 'The Tower')).toBeVisible()
  await actRow(win, 'Act One').getByRole('button', { name: 'Show chapters' }).click()
  await expect(actRow(win, 'Act One')).toHaveAttribute('aria-expanded', 'true')
  await expect(sceneRow(win, 'Landing')).toBeVisible()

  // ----- Rename from the menu; F2 renames too, and Esc leaves it as it was -----
  await actRow(win, 'Act One').click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Rename' }).click()
  const title = binder(win).getByRole('textbox', { name: 'Act title' })
  await expect(title).toBeFocused()
  await title.fill('The Arrival')
  await title.press('Enter')
  await expect(actRow(win, 'The Arrival')).toBeVisible()
  await expect.poll(async () => (await invoke(win, 'getOutline', story.id)).acts!.map((a) => a.title)).toEqual(['The Arrival', 'Act Two'])
  await actRow(win, 'Act Two').focus()
  await win.keyboard.press('F2')
  await expect(title).toBeFocused()
  await title.fill('Something else')
  await title.press('Escape')
  await expect(title).toHaveCount(0)
  await expect(actRow(win, 'Act Two')).toBeVisible()

  // ----- A purpose, shown when the pointer rests on the act -----
  await actRow(win, 'The Arrival').click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Edit purpose' }).click()
  const purpose = binder(win).getByRole('textbox', { name: 'Act purpose' })
  await expect(purpose).toBeFocused()
  await purpose.fill('Mara reaches the city and learns what the guild wants.')
  await purpose.press('Enter')
  await expect(purpose).toHaveCount(0)
  await expect(actRow(win, 'The Arrival')).toHaveAttribute('title', 'The Arrival: Mara reaches the city and learns what the guild wants.')
  await expect(actRow(win, 'Act Two')).toHaveAttribute('title', 'Act Two')
  await expect
    .poll(async () => (await invoke(win, 'getOutline', story.id)).acts![0].purpose)
    .toBe('Mara reaches the city and learns what the guild wants.')

  // ----- A new chapter at the end of an act, named straight away -----
  await actRow(win, 'The Arrival').hover()
  await actRow(win, 'The Arrival').getByRole('button', { name: 'Add a chapter to this act' }).click()
  const chapterTitle = binder(win).getByRole('textbox', { name: 'Chapter title' })
  await expect(chapterTitle).toBeFocused()
  await chapterTitle.fill('The Market')
  await chapterTitle.press('Enter')
  await expect(actBlock(win, 'The Arrival').locator('[data-row="chapter"]')).toContainText(['The Docks', 'The Market'])

  // ----- A chapter moves to another act from its menu; Undo puts it back -----
  await chapterRow(win, 'The Docks').click({ button: 'right' })
  // The first chapter of an act starts it already.
  await expect(win.getByRole('menuitem', { name: 'Start a new act here' })).toHaveCount(0)
  await win.getByRole('menuitem', { name: 'Move to act' }).click()
  await win.getByRole('menuitem', { name: 'Act Two', exact: true }).click()
  const moved = 'Moved “The Docks” to “Act Two”.'
  await expect(toastWith(win, moved)).toBeVisible()
  await expect(actBlock(win, 'Act Two').locator('[data-row="chapter"]')).toHaveCount(2)
  await expect(actBlock(win, 'Act Two').locator('[data-row="chapter"]')).toContainText(['The Docks', 'The Tower'])
  await expect(actBlock(win, 'The Arrival').locator('[data-row="chapter"]')).toContainText(['The Market'])
  await undoIn(win, moved).click()
  await expect(actBlock(win, 'The Arrival').locator('[data-row="chapter"]')).toHaveCount(2)
  await expect(actBlock(win, 'The Arrival').locator('[data-row="chapter"]')).toContainText(['The Docks', 'The Market'])
  await expect(actBlock(win, 'Act Two').locator('[data-row="chapter"]')).toHaveCount(1)

  // ----- Deleting an act takes its chapters and scenes with it, straight away; Undo brings them all back -----
  await actRow(win, 'Act Two').click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Delete act' }).click()
  const gone = '“Act Two” and its chapter deleted.'
  await expect(toastWith(win, gone)).toBeVisible()
  await expect(actRow(win, 'Act Two')).toHaveCount(0)
  await expect(chapterRow(win, 'The Tower')).toHaveCount(0)
  await expect(sceneRow(win, 'The climb')).toHaveCount(0)
  expect((await invoke(win, 'getOutline', story.id)).acts!.map((a) => a.title)).toEqual(['The Arrival'])
  await undoIn(win, gone).click()
  await expect(actRow(win, 'Act Two')).toBeVisible()
  await expect(actBlock(win, 'Act Two').locator('[data-row="scene"]')).toContainText(['The climb'])
  expect((await invoke(win, 'getOutline', story.id)).acts!.map((a) => a.title)).toEqual(['The Arrival', 'Act Two'])

  // ----- Once its toast is gone, Recently deleted still has the act, with what went with it -----
  await actRow(win, 'Act Two').click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Delete act' }).click()
  await toastWith(win, gone).getByRole('button', { name: 'Dismiss' }).click()
  await expect(actRow(win, 'Act Two')).toHaveCount(0)
  await openSettings(win, 'Recently deleted')
  const trash = win.getByRole('list', { name: 'Recently deleted' })
  await expect(trash.getByRole('listitem')).toHaveCount(1)
  await expect(trash).toContainText('Act in Book 1, with its chapter and 1 scene')
  await trash.getByRole('button', { name: 'Restore “Act Two”' }).click()
  await expect(win.getByText('Nothing deleted lately')).toBeVisible()
  await expect(actRow(win, 'Act Two')).toBeVisible()
  await expect(actBlock(win, 'Act Two').locator('[data-row="scene"]')).toContainText(['The climb'])
})

// ---------- Next scene ideas ----------

test('next scene ideas: an empty scene card offers three directions, and Use this fills it in one click, with Undo', async ({ launch }) => {
  const fake = await startFake(150)
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Varn')
    const [story] = await invoke(win, 'listStories')
    await useFakeModel(win, fake)
    const [scene] = (await invoke(win, 'getOutline', story.id)).scenes
    await win.getByRole('tab', { name: 'Scene card' }).click()

    // ----- Asked from the empty card: three directions, each with what happens and its beats -----
    fake.reset()
    await sceneCard(win).getByRole('button', { name: 'Ideas for this scene' }).click()
    await expect(ideasList(win).getByRole('button', { name: 'Use “A debt called in” for this scene' })).toBeVisible()
    await expect(ideasList(win).locator('[data-idea]')).toHaveCount(3)
    await expect(ideasList(win).locator('[data-idea]')).toContainText(['The door left open', 'A debt called in', 'The wrong messenger'])
    await expect(ideasList(win).locator('[data-idea]').nth(1)).toContainText(
      'Tobin calls in the favour Mara owes him, and it costs her an old friend.'
    )
    await expect(ideasList(win).locator('[data-idea]').nth(1).locator('li')).toHaveCount(4)
    expect(fake.requestCounts()).toEqual({ 'fake/writer': 1 })
    expect(fake.lastRequest()!.body.messages[0].content.startsWith('[AIWRITE-OUTLINE v1] ideas')).toBe(true)

    // ----- Use this: the card is filled in one click, and the scene takes the idea's name -----
    await ideasList(win).getByRole('button', { name: 'Use “A debt called in” for this scene' }).click()
    const filled = 'Filled the scene card with “A debt called in”, and named the scene after it.'
    await expect(toastWith(win, filled)).toBeVisible()
    await expect(ideasList(win)).toHaveCount(0)
    const beats = [
      'Tobin waits for her at the ferry',
      'He names the job: steal back the ledger',
      'Mara agrees, then learns who holds it',
      'She warns her friend instead, and Tobin sees'
    ]
    await expect(sceneCard(win).getByRole('textbox', { name: 'Beats', exact: true })).toHaveValue(beats[0])
    await expect(sceneCard(win).getByRole('textbox', { name: 'Beat 4', exact: true })).toHaveValue(beats[3])
    await expect(sceneCard(win).getByLabel('Goal', { exact: true })).toHaveValue(
      'Tobin calls in the favour Mara owes him, and it costs her an old friend.'
    )
    await expect(sceneRow(win, 'A debt called in')).toBeVisible()
    await expect(win.locator('main header').getByRole('button', { name: 'A debt called in', exact: true })).toBeVisible()
    // A card with something on it offers no ideas.
    await expect(sceneCard(win).getByRole('button', { name: 'Ideas for this scene' })).toHaveCount(0)
    await expect.poll(async () => (await invoke(win, 'getScene', scene.id)).card.beats).toEqual(beats)

    // ----- Undo: the card and the name as they were, and the ideas back -----
    await undoIn(win, filled).click()
    await expect(sceneCard(win).getByRole('textbox', { name: 'Beats', exact: true })).toHaveValue('')
    await expect(sceneCard(win).getByLabel('Goal', { exact: true })).toHaveValue('')
    await expect(sceneRow(win, 'Scene 1')).toBeVisible()
    await expect(ideasList(win).locator('[data-idea]')).toHaveCount(3)
    await expect.poll(async () => (await invoke(win, 'getScene', scene.id)).card.goal).toBe('')
    await expect.poll(async () => (await invoke(win, 'getScene', scene.id)).title).toBe('Scene 1')

    // ----- Other ideas that fail: the ideas on screen stay, under the reason in plain words -----
    await setModel(win, 'fake/credit')
    await ideasList(win).getByRole('button', { name: 'Other ideas' }).click()
    await expect(ideasList(win).getByRole('alert')).toContainText('out of credit')
    await expect(ideasList(win).getByRole('alert').getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(ideasList(win).locator('[data-idea]')).toHaveCount(3)
    await expect(ideasList(win).getByRole('button', { name: 'Use “A debt called in” for this scene' })).toBeVisible()

    // ----- Other ideas, stopped part way: what arrived stays -----
    await setModel(win, 'fake/slow')
    await ideasList(win).getByRole('button', { name: 'Other ideas' }).click()
    await expect(ideasList(win).getByRole('status')).toBeVisible()
    await expect(ideasList(win).getByRole('alert')).toHaveCount(0)
    await expect(ideasList(win).locator('[data-idea]').first()).toContainText('Mara finds the guild house unguarded')
    await ideasList(win).getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(ideasList(win).getByRole('button', { name: 'Use “The door left open” for this scene' })).toBeVisible()
    await expect(ideasList(win).getByRole('button', { name: 'Use “The wrong messenger” for this scene' })).toHaveCount(0)
    await expect(ideasList(win).getByRole('button', { name: 'Other ideas' })).toBeVisible()

    // ----- Closed: the quiet button is back, and stays put while Adam starts filling the card -----
    await setModel(win, 'fake/writer')
    await ideasList(win).getByRole('button', { name: 'Close the ideas' }).click()
    await expect(ideasList(win)).toHaveCount(0)
    const askButton = sceneCard(win).getByRole('button', { name: 'Ideas for this scene' })
    await expect(askButton).toBeVisible()
    const goal = sceneCard(win).getByLabel('Goal', { exact: true })
    const goalTop = (await goal.boundingBox())!.y
    await goal.pressSequentially('Get the ledger back')
    await expect(askButton).toBeVisible()
    expect((await goal.boundingBox())!.y).toBe(goalTop)
    await expect.poll(async () => (await invoke(win, 'getScene', scene.id)).card.goal).toBe('Get the ledger back')

    // ----- Asked from the palette with another tab showing: the card comes up and asks -----
    await win.getByRole('tab', { name: 'Drafts' }).click()
    await win.keyboard.press('Control+K')
    await win.keyboard.type('Ideas for this scene')
    await palette(win).getByRole('option', { name: 'Ideas for this scene' }).click()
    await expect(win.getByRole('tab', { name: 'Scene card', selected: true })).toBeVisible()
    await expect(ideasList(win).getByRole('button', { name: 'Use “The wrong messenger” for this scene' })).toBeVisible()

    // ----- What the AI saw, and back to the scene with its ideas -----
    await ideasList(win).getByRole('button', { name: 'What the AI saw' }).click()
    await expect(main(win).getByRole('heading', { level: 1, name: 'What the AI saw' })).toBeVisible()
    await expect(main(win).getByText(/^The exact briefing for these ideas, written /)).toBeVisible()
    await main(win).getByRole('button', { name: 'Back to “Scene 1”' }).click()
    await expect(win.locator('.scene-prose')).toBeVisible()
    await expect(ideasList(win).locator('[data-idea]')).toHaveCount(3)

    // ----- Use this on a card Adam has started: his goal stays, and the idea's beats are added -----
    await ideasList(win).getByRole('button', { name: 'Use “The wrong messenger” for this scene' }).click()
    const added = 'Added “The wrong messenger” to the scene card, after what was already on it, and named the scene after it.'
    await expect(toastWith(win, added)).toBeVisible()
    await expect(sceneCard(win).getByLabel('Goal', { exact: true })).toHaveValue('Get the ledger back')
    await expect(sceneCard(win).getByRole('textbox', { name: 'Beats', exact: true })).toHaveValue(
      'A soaked child presses a note into her hand'
    )
    await expect
      .poll(async () => (await invoke(win, 'getScene', scene.id)).card)
      .toMatchObject({ goal: 'Get the ledger back', beats: expect.arrayContaining(["The note names tonight's raid on the Narrows"]) })
    await undoIn(win, added).click()
    await expect(sceneCard(win).getByLabel('Goal', { exact: true })).toHaveValue('Get the ledger back')
    await expect(sceneCard(win).getByRole('textbox', { name: 'Beats', exact: true })).toHaveValue('')
  } finally {
    await fake.close()
  }
})
