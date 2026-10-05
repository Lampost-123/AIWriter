// The editor chat (Ask the world, 2026-10-03): asked to fix something, it reads the scene for itself, proposes the
// change and says so; nothing changes until Adam applies it; Apply puts it into the page (as one step) and Undo takes
// it back; a new place it proposes is made only on Apply; Ask about this quotes the selected words in the box; a model
// that can't use tools is said so in plain words. The fake provider works as tests/fake-provider/m4/ask.mjs says.
import type { Page } from '@playwright/test'
import { createWorldFromWelcome, expect, invoke, test, useFakeModel } from './helpers'

const panel = (win: Page) => win.getByRole('region', { name: 'Ask the world' })
const box = (win: Page) => panel(win).getByRole('textbox', { name: 'Ask about your world' })
const prose = (win: Page) => win.locator('.scene-prose')
const changes = (win: Page) => panel(win).getByRole('region', { name: 'Proposed changes' })

async function firstScene(win: Page): Promise<string> {
  const [story] = await invoke(win, 'listStories')
  return (await invoke(win, 'getOutline', story.id)).scenes[0].id
}
const hasSaltStair = async (win: Page): Promise<boolean> => (await invoke(win, 'listEntries', 'place')).some((e) => e.name === 'The Salt Stair')

async function ask(win: Page, question: string): Promise<void> {
  await box(win).fill(question)
  await box(win).press('Enter')
}

test('the editor chat reads the scene, proposes a change, and changes nothing until it is applied; Undo takes it back', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 5 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    await useFakeModel(win, fake)
    await prose(win).click()
    await win.keyboard.type('The tide came in over the flats. The gulls went quiet.')
    const sceneId = await firstScene(win)
    await expect.poll(async () => (await invoke(win, 'getScene', sceneId)).text).toContain('gulls went quiet')

    // Asked to fix something: it reads the scene first, then proposes; the page is untouched.
    await win.getByRole('button', { name: 'Ask the world', exact: true }).click()
    await ask(win, 'Please fix the first sentence')
    const card = changes(win).locator('[data-proposal]').first()
    await expect(card).toContainText('THE TIDE CAME IN OVER THE FLATS.')
    await expect(card).toContainText('The tide came in over the flats.')
    await expect(card).toHaveAttribute('data-status', 'pending')
    await expect(panel(win).locator('[data-steps]')).toContainText('Reading Ch 1, Sc 1')
    await expect(prose(win)).toHaveText('The tide came in over the flats. The gulls went quiet.')
    // The model was offered the tools, and was sent the scene it read.
    const sent = fake.lastRequest()!.body as { messages: unknown[]; tools?: { function: { name: string } }[] }
    expect(sent.tools?.map((t) => t.function.name)).toContain('propose_edit')
    expect(JSON.stringify(sent.messages)).toContain('The gulls went quiet.')

    // Apply: into the page, the card marked applied; Undo takes it back.
    await card.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(prose(win)).toHaveText('THE TIDE CAME IN OVER THE FLATS. The gulls went quiet.')
    await expect(card).toHaveAttribute('data-status', 'applied')
    await win.getByRole('button', { name: 'Undo' }).click()
    await expect(prose(win)).toHaveText('The tide came in over the flats. The gulls went quiet.')
    await expect(card).toHaveAttribute('data-status', 'pending')

    // A new place is only proposed; Apply makes it.
    await ask(win, 'Suggest a new place by the harbour')
    const place = changes(win).last().locator('[data-proposal]').first()
    await expect(place).toContainText('The Salt Stair')
    expect(await hasSaltStair(win)).toBe(false)
    await place.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect.poll(() => hasSaltStair(win)).toBe(true)

    // Not this sets a change aside without doing it.
    await ask(win, 'Fix the first sentence again')
    const again = changes(win).last().locator('[data-proposal]').first()
    await again.getByRole('button', { name: 'Not this' }).click()
    await expect(again).toHaveAttribute('data-status', 'declined')
    await expect(prose(win)).toHaveText('The tide came in over the flats. The gulls went quiet.')

    // An answer that claims changes it never proposed is asked once more: the changes come, and the claim is gone.
    await ask(win, 'Pretend to tidy the opening')
    const tidied = changes(win).last().locator('[data-proposal]').first()
    await expect(tidied).toContainText('Tidied, as claimed.')
    await expect(panel(win).locator('[data-no-changes]')).toHaveCount(0)
    await expect(panel(win)).not.toContainText('I’ve tidied up the opening.')
    // One that still doesn't propose them is put right under its answer.
    await ask(win, 'Pretend stubbornly to tidy the opening')
    await expect(panel(win).locator('[data-no-changes]')).toHaveText('No changes came with this answer, so there’s nothing to apply. Ask again to have them proposed.')
    await expect(panel(win).locator('[data-no-changes]')).toHaveCount(1)
  } finally {
    await fake.close()
  }
})

test('a passage across paragraphs is proposed as one rewrite; Apply replaces it all, Undo brings it back', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 5 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    await useFakeModel(win, fake)
    await prose(win).click()
    await win.keyboard.type('The tide came in over the flats.')
    await win.keyboard.press('Enter')
    await win.keyboard.type('The gulls went quiet.')
    const sceneId = await firstScene(win)
    await expect.poll(async () => (await invoke(win, 'getScene', sceneId)).text).toContain('gulls went quiet')
    const paragraphs = prose(win).locator('p')
    await expect(paragraphs).toHaveCount(2)

    await win.getByRole('button', { name: 'Ask the world', exact: true }).click()
    await ask(win, 'Push this beat harder')
    const card = changes(win).locator('[data-proposal]').first()
    await expect(card).toContainText('Rewrite · Ch 1, Sc 1')
    await expect(card).toContainText('The gulls screamed once, then nothing.')
    await expect(paragraphs).toHaveCount(2)
    await expect(prose(win)).toContainText('The gulls went quiet.')

    await card.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(paragraphs.nth(0)).toHaveText('The tide roared in over the flats.')
    await expect(paragraphs.nth(0).locator('em')).toHaveText('roared')
    await expect(paragraphs.nth(1)).toHaveText('The gulls screamed once, then nothing.')
    await expect(card).toHaveAttribute('data-status', 'applied')
    await win.getByRole('button', { name: 'Undo' }).click()
    await expect(paragraphs.nth(0)).toHaveText('The tide came in over the flats.')
    await expect(paragraphs.nth(1)).toHaveText('The gulls went quiet.')
    await expect(card).toHaveAttribute('data-status', 'pending')
  } finally {
    await fake.close()
  }
})

test('Ask about this quotes the selected words; a model that can’t use tools is said so plainly', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 5 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    await useFakeModel(win, fake, 'fake/no-tools')
    await prose(win).click()
    await win.keyboard.type('The tide came in over the flats.')
    await win.keyboard.press('Shift+Home')
    await win.getByRole('button', { name: 'Ask about this' }).click()
    await expect(box(win)).toHaveValue(/^About this passage: “The tide came in over the flats\.”/)
    await expect(box(win)).toBeFocused()
    await win.keyboard.type('Is this too plain?')
    await box(win).press('Enter')
    await expect(panel(win)).toContainText('can’t use the tools the editor chat needs')
  } finally {
    await fake.close()
  }
})
