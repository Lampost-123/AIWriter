// The direction composer (features/direction): the one box Adam tells the AI what to write in, in Generate's draft
// options, the desk's steer box, Variants (with a direction for each variant), a beat's note and the AI edits' Rewrite.
// Quick asks put a short ask in the box; ↑ brings back the last direction; Recent lists those given before (from the
// records, so they are there after a restart), searchable, with a star to keep one; and a direction for the next draft
// shows beside Generate until a draft has used it. Against the fake AI server.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import type { FakeProvider } from '../fake-provider/server.mjs'
import { closeWindow, createWorldFromWelcome, expect, invoke, startFake, test, useFakeModel, type LaunchOptions } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const optionsButton = (win: Page) => win.getByRole('button', { name: 'Draft options' })
const optionsBox = (win: Page) => win.getByLabel('Direction for this draft (optional)')
const optionsPanel = (win: Page) => win.locator('[data-radix-popper-content-wrapper]').filter({ has: win.getByRole('heading', { name: 'Draft options' }) })
const generateButton = (win: Page) => win.locator('main header').getByRole('button', { name: 'Generate', exact: true })
const nextDirection = (win: Page) => win.locator('main header [data-next-direction]')
const recentList = (win: Page) => win.locator('[data-recent-directions]')
const chip = (scope: ReturnType<Page['locator']>, name: string) => scope.getByRole('button', { name, exact: true })
const dock = (win: Page) => win.getByRole('toolbar', { name: 'AI dock' })
const steerBox = (win: Page) => dock(win).getByRole('textbox', { name: 'Steer the next bit (optional)' })

/** Pictures of the composer, for checking its look by eye, when AIWRITE_SHOTS names a folder. */
async function shot(win: Page, name: string): Promise<void> {
  const dir = process.env.AIWRITE_SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  // A moment for the popovers' entrances to settle.
  await win.waitForTimeout(350)
  await win.screenshot({ path: join(dir, `${name}.png`) })
}

const lastStatus = async (win: Page, sceneId: string): Promise<string | undefined> => (await invoke(win, 'listGenerations', sceneId))[0]?.status

async function firstScene(win: Page): Promise<{ sceneId: string; storyId: string }> {
  const [story] = await invoke(win, 'listStories')
  const { scenes } = await invoke(win, 'getOutline', story.id)
  return { sceneId: scenes[0].id, storyId: story.id }
}

const QUIET: LaunchOptions = { env: { AIWRITE_KEEPER_QUIET_MS: '600000' } }

test('panels: quick asks go in and out, the direction shows beside Generate until a draft uses it, and Recent and ↑ bring it back after a restart', async ({
  launch
}) => {
  const fake = await startFake()
  try {
    const { app, win, dataDir } = await launch(QUIET)
    await createWorldFromWelcome(win, 'Alpha')
    await useFakeModel(win, fake)
    const { sceneId } = await firstScene(win)

    // ----- Quick asks: each puts a short ask in the box, and takes it out when pressed again -----
    await optionsButton(win).click()
    await expect(optionsBox(win)).toBeFocused()
    await win.keyboard.type('End on the knock')
    const asks = win.getByRole('group', { name: 'Quick asks' })
    await chip(asks, 'Shorter').click()
    await expect(optionsBox(win)).toHaveValue('End on the knock. Keep it shorter.')
    await expect(chip(asks, 'Shorter')).toHaveAttribute('aria-pressed', 'true')
    // The box keeps the keyboard, and one Ctrl+Z there takes the ask back out (it went in as typing does).
    await expect(optionsBox(win)).toBeFocused()
    await win.keyboard.press('Control+z')
    await expect(optionsBox(win)).toHaveValue('End on the knock')
    await chip(asks, 'Shorter').click()
    // Its opposite takes its place.
    await chip(asks, 'Longer').click()
    await expect(optionsBox(win)).toHaveValue('End on the knock. Make it longer.')
    await expect(chip(asks, 'Shorter')).toHaveAttribute('aria-pressed', 'false')
    await chip(asks, 'Longer').click()
    // (The full stop the asks were joined with stays: the box's words end a sentence.)
    await expect(optionsBox(win)).toHaveValue('End on the knock.')
    // The rest are behind More.
    await asks.getByRole('button', { name: 'More quick asks' }).click()
    const more = win.locator('[data-quick-asks]')
    await expect(chip(more, 'End on a hook')).toBeVisible()
    await shot(win, 'panels-draft-options-more')
    await chip(more, 'Tenser').click()
    await expect(optionsBox(win)).toHaveValue('End on the knock. Make it tenser.')
    await win.keyboard.press('Escape')
    await expect(more).toBeHidden()
    await shot(win, 'panels-draft-options')

    // ----- Set, it shows beside Generate; a draft uses it once and it clears -----
    await win.keyboard.press('Escape')
    await expect(optionsPanel(win)).toBeHidden()
    await expect(nextDirection(win)).toContainText('Direction:End on the knock. Make it tenser.')
    await shot(win, 'panels-direction-label')
    await generateButton(win).click()
    await expect.poll(() => lastStatus(win, sceneId)).toBe('complete')
    expect(JSON.stringify(fake.lastRequest()?.body.messages)).toContain('End on the knock. Make it tenser.')
    await expect(nextDirection(win)).toHaveCount(0)
    await optionsButton(win).click()
    await expect(optionsBox(win)).toHaveValue('')
    // ↑ in the empty box brings it back; ↓ gives the empty box back.
    await optionsBox(win).press('ArrowUp')
    await expect(optionsBox(win)).toHaveValue('End on the knock. Make it tenser.')
    await optionsBox(win).press('ArrowDown')
    await expect(optionsBox(win)).toHaveValue('')
    await win.keyboard.press('Escape')

    // ----- After a restart: Recent offers it back (from the draft's record), searchable, with a star to keep it -----
    await closeWindow(app)
    const again = await launch({ ...QUIET, dataDir })
    const w = again.win
    await expect(prose(w)).toBeVisible()
    await optionsButton(w).click()
    await w.getByRole('group', { name: 'Quick asks' }).getByRole('button', { name: 'Your recent directions' }).click()
    const list = recentList(w)
    await expect(list.getByRole('searchbox', { name: 'Search your directions' })).toBeFocused()
    await expect(list.getByRole('button', { name: /^End on the knock\. Make it tenser\./ })).toBeVisible()
    await expect(list).toContainText('Draft ·')
    await w.keyboard.type('storm')
    await expect(list).toContainText('No directions with “storm” in them.')
    await w.keyboard.press('Control+a')
    await w.keyboard.type('KNOCK')
    await list.getByRole('button', { name: 'Star “End on the knock. Make it tenser.”' }).click()
    await expect(list.getByRole('region', { name: 'Starred' })).toContainText('End on the knock. Make it tenser.')
    await expect.poll(async () => invoke(w, 'directionFavourites')).toEqual(['End on the knock. Make it tenser.'])
    await shot(w, 'panels-recent')
    // The keyboard stays on its star, now in the starred list.
    await expect(list.getByRole('button', { name: 'Take the star off “End on the knock. Make it tenser.”' })).toBeFocused()
    // ↓ from the search box, then Enter: it goes in the box, and the box has the keyboard.
    await list.getByRole('searchbox').focus()
    await w.keyboard.press('ArrowDown')
    await w.keyboard.press('Enter')
    await expect(list).toBeHidden()
    await expect(optionsBox(w)).toHaveValue('End on the knock. Make it tenser.')
    await expect(optionsBox(w)).toBeFocused()
    // Starred, it is kept outside the world (in the writing preferences), for every story.
    expect((await invoke(w, 'getWritingPrefs')).favouriteDirections).toEqual(['End on the knock. Make it tenser.'])
  } finally {
    await fake.close()
  }
})

test('panels: Variants take a direction for the set and one for each variant, and offer them back', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch(QUIET)
    await createWorldFromWelcome(win, 'Alpha')
    await useFakeModel(win, fake)
    const { sceneId } = await firstScene(win)
    await win.getByRole('button', { name: 'Variants', exact: true }).click()
    const direction = win.getByLabel('Direction for these drafts (optional)')
    await expect(direction).toBeFocused()
    await direction.fill('End on the knock.')
    await win.getByRole('button', { name: 'Give each variant its own direction' }).click()
    const own = (n: number) => win.getByRole('textbox', { name: `Direction for variant ${n}` })
    await expect(own(1)).toBeFocused()
    await own(1).fill('Tense')
    await own(2).fill('Tender')
    await own(3).fill('Funny')
    await shot(win, 'panels-variants')
    await own(3).press('Enter')
    const column = (n: number) => win.getByRole('region', { name: `Variant ${n}`, exact: true })
    for (const [n, note] of [
      [1, 'Tense'],
      [2, 'Tender'],
      [3, 'Funny']
    ] as const)
      await expect(column(n).locator('[data-variant-note]')).toHaveText(note)
    await expect.poll(async () => (await invoke(win, 'getVariantSet', sceneId))?.variants.every((v) => v.status === 'complete'), { timeout: 30_000 }).toBe(true)
    const set = (await invoke(win, 'getVariantSet', sceneId))!
    expect(set.direction).toBe('End on the knock.')
    expect(set.variants.map((v) => v.note)).toEqual(['Tense', 'Tender', 'Funny'])
    const records = await Promise.all(set.variants.map((v) => invoke(win, 'getGeneration', v.generationId)))
    expect(records[1].messages.at(-1)?.content).toContain('For this version of the scene, as the author asks: Tender')
    // Used once: the boxes are empty for the next set, and Recent offers each back.
    const recents = (await invoke(win, 'recentDirections', null, 10, 'scene')).map((d) => d.text).sort()
    expect(recents).toEqual(['End on the knock.', 'Funny', 'Tender', 'Tense'])
  } finally {
    await fake.close()
  }
})

test('panels: the Rewrite box keeps the ways Adam asked before (↑ and Recent), apart from the scene’s directions', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch(QUIET)
    await createWorldFromWelcome(win, 'Alpha')
    const { sceneId } = await firstScene(win)
    await invoke(win, 'saveSceneText', sceneId, null, 'The tavern was warm and loud. Rain hammered the shutters.\n\nMara pushed through the crowd.')
    await useFakeModel(win, fake)
    const tools = win.locator('[data-ai-tools]')
    const how = tools.getByRole('textbox', { name: 'How to rewrite the selected words' })
    const openTools = async (): Promise<void> => {
      await prose(win).focus()
      await expect(async () => {
        await win.evaluate(`(() => {
          const p = document.querySelector('.scene-prose p')
          const t = p.firstChild
          document.getSelection().setBaseAndExtent(t, 0, t, 29)
        })()`)
        await expect(win.getByRole('toolbar', { name: 'Selected words' })).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 15_000 })
      await win.getByRole('toolbar', { name: 'Selected words' }).getByRole('button', { name: 'Rewrite', exact: true }).click()
      await expect(how).toBeFocused()
    }
    await openTools()
    await expect(tools.getByRole('group', { name: 'Quick asks' })).toBeVisible()
    await shot(win, 'panels-rewrite')
    await how.fill('Start with the rain')
    await how.press('Enter')
    const change = win.getByRole('group', { name: 'The AI’s change' })
    await expect(change.getByRole('button', { name: /^Reject/ })).toBeVisible({ timeout: 20_000 })
    await change.getByRole('button', { name: /^Reject/ }).click()
    await expect(change).toBeHidden()

    await openTools()
    await expect(how).toHaveValue('')
    await how.press('ArrowUp')
    await expect(how).toHaveValue('Start with the rain')
    await expect(how).toBeFocused()
    await how.fill('')
    await tools.getByRole('button', { name: 'Your recent directions' }).click()
    await expect(recentList(win).getByRole('button', { name: /^Start with the rain/ })).toBeVisible()
    await expect(recentList(win)).toContainText('Rewrite ·')
    await win.keyboard.press('Escape')
    // The scene's directions are kept apart: Rewrite's ways aren't offered for drafting.
    expect((await invoke(win, 'recentDirections', null, 10, 'scene')).map((d) => d.text)).toEqual([])
    expect((await invoke(win, 'recentDirections', null, 10, 'rewrite')).map((d) => d.text)).toEqual(['Start with the rain'])
  } finally {
    await fake.close()
  }
})

async function deskWorld(
  launch: (o?: LaunchOptions) => Promise<{ app: ElectronApplication; win: Page; dataDir: string }>,
  fake: FakeProvider
): Promise<{ app: ElectronApplication; win: Page; dataDir: string }> {
  const a = await launch({ env: { AIWRITE_ARRANGEMENT: 'desk', AIWRITE_KEEPER_QUIET_MS: '600000' } })
  await expect(a.win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(a.win, 'openSampleWorld')
  await a.win.reload()
  await expect(prose(a.win)).toContainText('A hundred and twelve steps to the lamp room.')
  await useFakeModel(a.win, fake)
  return a
}

test('desk: the steer box brings back the last direction with ↑, and its clock holds the quick asks and Recent', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await deskWorld(launch, fake)
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle')
    await steerBox(win).fill('The ferry horn sounds twice')
    await steerBox(win).press('Enter')
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'review')
    await win.keyboard.press('Tab')
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle')
    await expect(steerBox(win)).toHaveValue('')
    // ↑ in the empty steer box brings the last direction back.
    await steerBox(win).click()
    await steerBox(win).press('ArrowUp')
    await expect(steerBox(win)).toHaveValue('The ferry horn sounds twice')
    await steerBox(win).fill('')

    // The clock beside it: every quick ask, then the directions given before.
    await dock(win).getByRole('button', { name: 'Quick asks and your recent directions' }).click()
    const list = recentList(win)
    await expect(list.getByRole('button', { name: /^The ferry horn sounds twice/ })).toBeVisible()
    await expect(list).toContainText('Continue ·')
    await shot(win, 'desk-dock-recent')
    await chip(list, 'Tenser').click()
    await expect(steerBox(win)).toHaveValue('Make it tenser.')
    await expect(chip(list, 'Tenser')).toHaveAttribute('aria-pressed', 'true')
    await chip(list, 'Slower').click()
    await expect(steerBox(win)).toHaveValue('Make it tenser. Slow the pace down.')
    await win.keyboard.press('Escape')
    await expect(list).toBeHidden()

    // On the desk the draft options' direction is the steer box itself: one direction, in sight, used once.
    await dock(win).getByRole('button', { name: 'More ways to write' }).click()
    await win.getByRole('menuitem', { name: /^Draft options/ }).click()
    await expect(optionsBox(win)).toHaveValue('Make it tenser. Slow the pace down.')
    await optionsBox(win).press('End')
    await win.keyboard.type(' The keeper waits.')
    await expect(steerBox(win)).toHaveValue('Make it tenser. Slow the pace down. The keeper waits.')
    await shot(win, 'desk-draft-options')
    await win.keyboard.press('Escape')

    // A fast draft (Add below) uses the direction: the box stays empty once it is done, nothing stale left in it, and ↑
    // brings it back.
    await dock(win).getByRole('button', { name: /^Add below/ }).click()
    await expect(steerBox(win)).toHaveValue('')
    await expect.poll(() => JSON.stringify(fake.lastRequest()?.body.messages ?? [])).toContain('Make it tenser. Slow the pace down. The keeper waits.')
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle', { timeout: 20_000 })
    await win.waitForTimeout(500)
    await expect(steerBox(win)).toHaveValue('')
    await steerBox(win).click()
    await steerBox(win).press('ArrowUp')
    await expect(steerBox(win)).toHaveValue('Make it tenser. Slow the pace down. The keeper waits.')
  } finally {
    await fake.close()
  }
})

test('panels: a beat’s note has the quick asks, and ↑ brings back the note given for the last beat', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch(QUIET)
    await createWorldFromWelcome(win, 'Alpha')
    const { sceneId } = await firstScene(win)
    const card = (await invoke(win, 'getScene', sceneId)).card
    await invoke(win, 'updateSceneCard', sceneId, { ...card, beats: ['Mara meets Tobin.', 'Tobin asks for the ledger.', 'Someone knocks.'], targetWords: 1500 })
    await useFakeModel(win, fake)
    await win.locator('main header').getByRole('button', { name: 'Beat by beat', exact: true }).click()
    const bar = win.locator('[data-beat-bar]')
    const note = bar.getByRole('textbox')
    await expect(bar.getByRole('status')).toHaveText('Beat 2 of 3')
    await expect(note).toBeFocused()
    await note.fill('Make Tobin stall')
    await chip(bar.getByRole('group', { name: 'Quick asks' }), 'More dialogue').click()
    await expect(note).toHaveValue('Make Tobin stall. More dialogue.')
    await shot(win, 'panels-beat-note')
    await note.press('Enter')
    await expect(bar.getByRole('status')).toHaveText('Beat 3 of 3')
    await expect(note).toHaveValue('')
    expect((await invoke(win, 'listGenerations', sceneId)).length).toBe(2)
    await note.press('ArrowUp')
    await expect(note).toHaveValue('Make Tobin stall. More dialogue.')
  } finally {
    await fake.close()
  }
})
