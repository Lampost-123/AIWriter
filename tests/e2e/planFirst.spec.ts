// Show me the plan first, and Write in what a draft missed (2026-10-19), end to end on the desk (the New look) against the
// fake provider. With "Show me the plan first" ticked in the draft options, Generate stops once the scene is planned and
// shows the plan, with what the card check noticed (an age on the card that contradicts the entry); a beat changed there
// is what the writer gets. Cancel writes nothing. With "Write in what a draft missed" on, a draft whose direction asked for
// more dialogue (the fake writer writes none) has it written in once by itself, as Write it in would, and the receipt says
// so. Invented test text only.
import type { Page } from '@playwright/test'
import { expect, invoke, startFake, test, useFakeModel } from './helpers'

const dock = (win: Page) => win.getByRole('toolbar', { name: 'AI dock' })
const plan = (win: Page) => win.getByTestId('scene-plan')
const chip = (win: Page) => win.locator('.desk-chip[data-direction-receipt]')

/** A new world, on the desk's writing page. */
async function newWorld(win: Page): Promise<void> {
  await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await win.getByLabel('World name').fill('Harbour')
  await win.getByRole('button', { name: 'Create world' }).click()
  await expect(win.locator('.scene-prose')).toBeVisible()
}

/** Mara (40, says her entry) on the first scene's card, with two beats and an age on the card that contradicts it. */
async function maraScene(win: Page): Promise<string> {
  const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the ferry.', fields: { age: '40' } })
  const [story] = await invoke(win, 'listStories')
  const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
  const card = (await invoke(win, 'getScene', sceneId)).card
  await invoke(win, 'updateSceneCard', sceneId, {
    ...card,
    povId: mara.id,
    presentIds: [mara.id],
    beats: ['Mara waits in the tavern.', 'Mara counts the doors from the corner.'],
    notes: 'Mara, 17, keeps watch.',
    targetWords: 300
  })
  return sceneId
}

/** Opens the draft options from the dock's menu. */
async function draftOptions(win: Page): Promise<void> {
  await dock(win).getByRole('button', { name: /^More ways to write/ }).click()
  await win.getByRole('menuitem', { name: /^Draft options/ }).click()
}

test('Show me the plan first: the plan waits with what the card check noticed; a beat changed is what the writer gets; Cancel writes nothing', async ({
  launch
}) => {
  const fake = await startFake()
  try {
    const { win } = await launch({ env: { AIWRITE_ARRANGEMENT: 'desk', AIWRITE_PLAN: 'on', AIWRITE_KEEPER_QUIET_MS: '600000', AIWRITE_AFTER_DRAFT_MS: '600000' } })
    await newWorld(win)
    const sceneId = await maraScene(win)
    await useFakeModel(win, fake)

    // For this draft only: Show me the plan first.
    await draftOptions(win)
    const toggle = win.locator('[data-plan-first-toggle] input[type=checkbox]')
    await expect(toggle).not.toBeChecked()
    await toggle.check()
    await win.getByRole('button', { name: /^Generate draft/ }).click()

    // The plan waits for Adam: its beats, and what the card check noticed. Nothing is written yet.
    await expect(win.getByRole('heading', { name: 'The plan for this scene' })).toBeVisible({ timeout: 60_000 })
    await expect(plan(win).locator('[data-plan-notes]')).toContainText('This card says Mara is 17, but Mara’s entry says 40')
    await expect(plan(win).locator('[data-plan-beat="1"]')).toContainText('Mara waits in the tavern')
    expect((await invoke(win, 'listGenerations', sceneId)).filter((g) => g.job === 'draft')).toHaveLength(0)

    // Change the plan: the first beat, then Write.
    await win.getByTestId('scene-plan-change').click()
    const beat = plan(win).getByRole('textbox', { name: 'Beat 1' })
    await beat.fill('Mara bolts the tavern door and waits by the fire.')
    await win.getByTestId('scene-plan-write').click()
    await expect(plan(win)).toHaveCount(0)
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId)).filter((g) => g.job === 'draft')[0]?.status, { timeout: 60_000 }).toBe('complete')
    const [draft] = (await invoke(win, 'listGenerations', sceneId)).filter((g) => g.job === 'draft')
    const user = (await invoke(win, 'getGeneration', draft.id)).messages[1].content as string
    const notes = user.slice(user.indexOf('My notes before I write'))
    expect(notes).toContain('1. Mara bolts the tavern door and waits by the fire.')
    expect(notes).not.toContain('Mara waits in the tavern')
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle', { timeout: 30_000 })

    // The choice was for that draft only; on in Settings, every draft shows its plan first. Cancel writes nothing.
    await invoke(win, 'updateSettings', { showPlanFirst: true })
    await win.reload()
    await expect(win.locator('.scene-prose')).toBeVisible()
    const before = (await invoke(win, 'getScene', sceneId)).text
    await dock(win).getByRole('button', { name: /^Add below/ }).click()
    await expect(win.getByRole('heading', { name: 'The plan for what comes next' })).toBeVisible({ timeout: 60_000 })
    await win.getByTestId('scene-plan-cancel').click()
    await expect(plan(win)).toHaveCount(0)
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle', { timeout: 30_000 })
    expect((await invoke(win, 'listGenerations', sceneId)).filter((g) => g.job === 'draft')).toHaveLength(1)
    expect((await invoke(win, 'getScene', sceneId)).text).toBe(before)
  } finally {
    await fake.close()
  }
})

test('Write in what a draft missed: once, by itself, and the receipt says what was written in', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch({
      env: {
        AIWRITE_ARRANGEMENT: 'desk',
        AIWRITE_PLAN: 'on',
        AIWRITE_REPAIR: 'on',
        AIWRITE_CONTRACT: 'on',
        AIWRITE_KEEPER_QUIET_MS: '600000',
        AIWRITE_AFTER_DRAFT_MS: '600000'
      }
    })
    await newWorld(win)
    await maraScene(win)
    await useFakeModel(win, fake)
    await invoke(win, 'updateSettings', { autoWriteIn: true })

    // A whole scene with a direction whose "More dialogue" the fake writer leaves out.
    await dock(win).getByRole('textbox', { name: 'Steer the next bit (optional)' }).fill('Mara counts the doors from the corner. More dialogue.')
    await dock(win).getByRole('button', { name: /^Draft the scene/ }).click()

    // Written in by itself, with the same steered Continue as Write it in; the receipt says what was written in.
    await expect(chip(win)).toHaveAttribute('data-direction-receipt', 'written', { timeout: 60_000 })
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'review', { timeout: 30_000 })
    expect(JSON.stringify(fake.lastRequest()?.body.messages ?? [])).toContain('More dialogue.')
    await expect(chip(win).locator('[data-ask="written"]')).toHaveText(/More dialogue/)
    await expect(chip(win).locator('[data-ask="landed"]')).toHaveCount(1)
    await expect(chip(win)).toContainText('Written in below')
    await expect(win.getByRole('status', { name: /More dialogue, written in below for you to keep or not/ })).toBeVisible()

    // Adam doesn't keep it: it goes, and it is never written in again for this draft.
    await win.keyboard.press('Escape')
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle')
    const writes = fake.requestCounts()
    await win.waitForTimeout(2_500)
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle')
    expect(fake.requestCounts()).toEqual(writes)
    await chip(win).getByRole('button', { name: 'Dismiss' }).click()
    await expect(chip(win)).toHaveCount(0)
  } finally {
    await fake.close()
  }
})
