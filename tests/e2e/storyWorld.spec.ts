// A new story's world (Adam, 2026-10-17): a kept outline that names characters and places the world doesn't have
// makes their pages straight away, the scene cards point at them, and the World builder then lays out what the
// story needs in the background (characters' looks and traits, places, plot threads...), with a toast saying how
// it goes. Against the fake provider: "[[fake: new cast]]" in the premise makes its chapter cards name Mara Venn
// and Tobin Hale at Gull Quay, and each third scene in "the kitchen, Venn House" (tests/fake-provider/m4/outline.mjs), and its fill-gaps answers fill each empty
// field as "<Label> of <name>, filled in from the story." (tests/fake-provider/server.mjs).
import type { Page } from '@playwright/test'
import type { FakeProvider } from '../fake-provider/server.mjs'
import { binder, createWorldFromWelcome, expect, invoke, test, useFakeModel } from './helpers'

const PREMISE = 'A ferryman who owes the Duke more than she can pay is hired to smuggle the heir out of Varn. [[fake: new cast]]'

const main = (win: Page) => win.locator('main')
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')

async function choose(win: Page, label: string, option: string): Promise<void> {
  await main(win).getByRole('combobox', { name: label, exact: true }).click()
  await win.getByRole('option', { name: option, exact: true }).click()
}

test('keeping an outline gives the story its cast and places before anything is written', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake: FakeProvider = await startFakeProvider({ delayMs: 2 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Varn')
    const [story] = await invoke(win, 'listStories')
    await invoke(win, 'updateStory', story.id, { premise: PREMISE })
    await useFakeModel(win, fake)

    await binder(win).locator('[data-story-menu]').click()
    await win.getByRole('menuitem', { name: 'Plan with AI' }).click()
    await expect(main(win).locator('[data-plan-hub]')).toBeVisible()
    await choose(win, 'Acts', '2 acts')
    await choose(win, 'Chapters', '3 chapters')
    await choose(win, 'Scenes in each chapter', '3 scenes in each')
    await main(win).locator('[data-plan-it]').click()
    await expect(main(win).locator('[data-batch-head]')).toContainText('14 suggestions to keep, change or discard')
    // Nothing is in the codex until Adam keeps something.
    expect(await invoke(win, 'listEntries', 'character')).toEqual([])

    await main(win).getByRole('button', { name: 'Keep “A bargain at the docks”', exact: true }).click()

    // Straight away: a page for each character and place the cards name, drafted by AI, and the cards point at them.
    const people = await invoke(win, 'listEntries', 'character')
    expect(people.map((e) => [e.name, e.origin]).sort()).toEqual([
      ['Mara Venn', 'ai'],
      ['Tobin Hale', 'ai']
    ])
    const [quay] = (await invoke(win, 'listEntries', 'place')).filter((e) => e.name === 'Gull Quay')
    expect(quay?.origin).toBe('ai')
    const outline = await invoke(win, 'getOutline', story.id)
    const scene = await invoke(win, 'getScene', outline.scenes[0].id)
    const mara = people.find((e) => e.name === 'Mara Venn')!
    expect([scene.card.povId, scene.card.locationId]).toEqual([mara.id, quay.id])
    expect(scene.card.presentIds).toContain(mara.id)

    // Then the World builder lays out what the story needs, in the background, and says when it is done.
    await expect(toasts(win).getByText(/^Building your story’s (characters|world)/)).toBeVisible({ timeout: 15_000 })
    await expect(toasts(win).getByText(/^Your story’s world is ready/)).toBeVisible({ timeout: 60_000 })
    const filled = await invoke(win, 'getEntry', mara.id)
    expect(filled.summary).not.toBe('')
    // Her looks (build, hair...) and other traits are filled in, drafted by AI.
    for (const key of ['build', 'hair']) expect(String(filled.fields[key] ?? '')).toContain('Mara Venn')
    // The World builder page's own summary is still Adam's (empty here), not the story's plan.
    expect((await invoke(win, 'getWorldBuilder')).summary).toBe('')

    // A room the cards name ("the kitchen, Venn House") is a kitchen page inside the house.
    await main(win).locator('[data-batch-head]').getByRole('button', { name: 'Keep all' }).click()
    await expect(main(win).locator('[data-batch-head]')).toContainText('All decided')
    const places = await invoke(win, 'listEntries', 'place')
    const house = places.find((e) => e.name === 'Venn House')
    expect(house?.origin).toBe('ai')
    expect(places.filter((e) => e.name === 'Kitchen').map((e) => e.parentId)).toEqual([house?.id])
  } finally {
    await fake.close()
  }
})
