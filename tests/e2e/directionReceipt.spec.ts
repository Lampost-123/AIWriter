// Adam's direction, end to end on the desk against the fake provider (2026-10-19): a whole scene drafted with a direction
// (the steer box, then Draft the scene) has it as the closing instruction's last words, word for word, and not on the
// scene card; the check as the words land goes through it ask by ask (tests/fake-provider/repair.mjs: an ask is kept when
// its words are in the draft, and the fake writer never writes "dialogue"), and the receipt over the dock says which
// asks landed, with Write it in (a Continue steered by what didn't land). What the AI saw shows the same. An Add below
// whose asks all landed says so in one line that fades by itself. Invented test text only.
import type { Page } from '@playwright/test'
import { expect, invoke, startFake, test, useFakeModel } from './helpers'

// The desk; planning, the check as words land and contracts on; the memory reads a scene once and not again on its own;
// the critic after a draft waits.
const ON = {
  env: {
    AIWRITE_ARRANGEMENT: 'desk',
    AIWRITE_PLAN: 'on',
    AIWRITE_REPAIR: 'on',
    AIWRITE_CONTRACT: 'on',
    AIWRITE_KEEPER_QUIET_MS: '600000',
    AIWRITE_AFTER_DRAFT_MS: '600000'
  }
}

const dock = (win: Page) => win.getByRole('toolbar', { name: 'AI dock' })
const steer = (win: Page) => dock(win).getByRole('textbox', { name: 'Steer the next bit (optional)' })
const chip = (win: Page) => win.locator('.desk-chip[data-direction-receipt]')
const DIRECTION = 'Mara counts the doors from the corner. A shutter bangs above the tavern. More dialogue.'
const LEAD = "The author's direction for this draft (make every part of it happen on the page):"

/** A new world, on the desk's writing page. */
async function newWorld(win: Page): Promise<void> {
  await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await win.getByLabel('World name').fill('Harbour')
  await win.getByRole('button', { name: 'Create world' }).click()
  await expect(win.locator('.scene-prose')).toBeVisible()
}

test('the direction: said last of all, checked ask by ask, and a receipt over the dock with Write it in; also in What the AI saw', async ({
  launch
}) => {
  const fake = await startFake()
  try {
    const { win } = await launch(ON)
    await newWorld(win)
    const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the ferry.' })
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    const card = (await invoke(win, 'getScene', sceneId)).card
    await invoke(win, 'updateSceneCard', sceneId, { ...card, povId: mara.id, presentIds: [mara.id], beats: ['Mara waits in the tavern.'], targetWords: 600 })
    await useFakeModel(win, fake)

    // A whole scene, steered from the dock.
    await steer(win).fill(DIRECTION)
    await dock(win).getByRole('button', { name: /^Draft the scene/ }).click()

    // The receipt: what landed, and what didn't (the fake writer has no dialogue to speak of), with Write it in.
    await expect(chip(win)).toHaveAttribute('data-direction-receipt', 'missing', { timeout: 60_000 })
    await expect(win.getByRole('status', { name: 'Your direction: Mara counts the doors from the corner, done; A shutter bangs above the tavern, done; More dialogue, not yet.' })).toBeVisible()
    await expect(chip(win).locator('[data-ask="landed"]')).toHaveCount(2)
    await expect(chip(win).locator('[data-ask="missing"]')).toHaveText(/More dialogue/)
    const writeIn = chip(win).getByRole('button', { name: 'Write it in' })
    await expect(writeIn).toBeVisible()

    // The writer read the direction once, last of all, word for word; the scene card no longer says it. The plan's notes
    // carry how it should read.
    const [draft] = (await invoke(win, 'listGenerations', sceneId)).filter((g) => g.job === 'draft')
    const rec = await invoke(win, 'getGeneration', draft.id)
    const user = rec.messages[1].content as string
    expect(user).toContain(`${LEAD}\n${DIRECTION}`)
    expect(user.split('Mara counts the doors from the corner')).toHaveLength(2)
    expect(rec.blocks.find((b) => b.id === 'scene-card')!.text).not.toContain('counts the doors')
    expect(rec.blocks.find((b) => b.id === 'scene-contract')!.text).toContain('1. What the author directs, as given last of all, below.')
    expect(user).toContain('How it reads, as the author asks: More dialogue.')
    // The check read each ask as an item of its own (no new call: the check's own).
    const check = (await invoke(win, 'getCheckReport', sceneId))!.contract!
    expect(check.recordId).toBe(draft.id)
    expect(check.items.filter((i) => i.ask).map((i) => [i.text, i.result])).toEqual([
      ['Mara counts the doors from the corner', 'kept'],
      ['A shutter bangs above the tavern', 'kept'],
      ['More dialogue', 'not yet']
    ])

    // What the AI saw, for this draft: the same receipt under the direction.
    await win.locator('[data-page-title]').getByRole('button', { name: 'Scene details' }).click()
    const drawer = win.locator('aside.desk-drawer')
    await drawer.getByRole('tab', { name: /^Drafts/ }).click()
    await drawer.getByRole('button', { name: /What the AI saw/ }).first().click()
    await expect(win.getByRole('heading', { level: 1, name: 'What the AI saw' })).toBeVisible()
    const saw = win.getByRole('group', { name: 'How the draft kept to your direction' })
    await expect(saw).toContainText('Mara counts the doors from the corner · in the draft')
    await expect(saw).toContainText('More dialogue · not in the draft')
    await win.getByRole('navigation', { name: 'Rooms' }).getByRole('button', { name: /^Write/ }).click()
    await expect(win.locator('.scene-prose')).toBeVisible()
    await expect(chip(win)).toHaveAttribute('data-direction-receipt', 'missing')

    // Write it in: a Continue from the end of the scene, steered by what didn't land; the receipt goes.
    await chip(win).getByRole('button', { name: 'Write it in' }).click()
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'review', { timeout: 30_000 })
    expect(JSON.stringify(fake.lastRequest()?.body.messages ?? [])).toContain('More dialogue.')
    await expect(chip(win)).toHaveCount(0)
    await win.keyboard.press('Escape')
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle')

    // Add below whose every ask lands: one quiet line, which fades by itself.
    await steer(win).fill('Mara counts the doors from the corner.')
    await dock(win).getByRole('button', { name: /^Add below/ }).click()
    await expect(chip(win)).toHaveAttribute('data-direction-receipt', 'landed', { timeout: 60_000 })
    await expect(chip(win)).toContainText('Mara counts the doors from the corner')
    await expect(chip(win).getByRole('button')).toHaveCount(0)
    await expect(chip(win)).toHaveCount(0, { timeout: 10_000 })
  } finally {
    await fake.close()
  }
})

test('Add below with the steer box empty has no direction, not the last Generate’s', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch({ env: { AIWRITE_ARRANGEMENT: 'desk', AIWRITE_KEEPER_QUIET_MS: '600000' } })
    await newWorld(win)
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    await useFakeModel(win, fake)
    // A whole draft with a direction in the Draft options, kept for the scene.
    await dock(win).getByRole('button', { name: /^More ways to write/ }).click()
    await win.getByRole('menuitem', { name: /^Draft options/ }).click()
    await win.getByLabel('Direction for this draft (optional)').fill('Tobin sells the ferry.')
    await win.getByRole('button', { name: /^Generate draft/ }).click()
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId)).filter((g) => g.job === 'draft')[0]?.status, { timeout: 30_000 }).toBe('complete')
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle')
    // Add below from the dock, the steer box empty: no direction (it was the whole draft's).
    await dock(win).getByRole('button', { name: /^Add below/ }).click()
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId)).filter((g) => g.job === 'draft').length, { timeout: 30_000 }).toBe(2)
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle', { timeout: 30_000 })
    const [below, whole] = (await invoke(win, 'listGenerations', sceneId)).filter((g) => g.job === 'draft')
    expect((await invoke(win, 'getGeneration', whole.id)).direction).toBe('Tobin sells the ferry.')
    const rec = await invoke(win, 'getGeneration', below.id)
    expect(rec.direction).toBe('')
    expect(rec.messages[1].content as string).not.toContain('Tobin sells the ferry')
  } finally {
    await fake.close()
  }
})
