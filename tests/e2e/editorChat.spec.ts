// The editor chat (Ask the world, 2026-10-03): asked to fix something, it reads the scene for itself, proposes the
// change and says so; nothing changes until Adam applies it; Apply puts it into the page (as one step) and Undo takes
// it back; a new place it proposes is made only on Apply; Ask about this quotes the selected words in the box; a model
// that can't use tools is said so in plain words. The fake provider works as tests/fake-provider/m4/ask.mjs says.
import type { Page } from '@playwright/test'
import { binder, createWorldFromWelcome, expect, invoke, startFake, test, useFakeModel } from './helpers'

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
    await expect(panel(win).locator('[data-steps]')).toContainText('Read Ch 1, Sc 1')
    await expect(prose(win)).toHaveText('The tide came in over the flats. The gulls went quiet.')
    // The model was offered the tools (by default the chat overhaul's one propose_changes), and was sent the scene it read.
    const sent = fake.lastRequest()!.body as { messages: unknown[]; tools?: { function: { name: string } }[] }
    expect(sent.tools?.map((t) => t.function.name)).toContain('propose_changes')
    expect(sent.tools?.map((t) => t.function.name)).not.toContain('propose_edit')
    expect(JSON.stringify(sent.messages)).toContain('The gulls went quiet.')

    // Shown as a word-level change, under the bar that says it is ready.
    await expect(changes(win).locator('[data-changes-bar]')).toContainText('1 change ready')
    await expect(card.locator('del')).toHaveText('The tide came in over the flats.')
    await expect(card.locator('ins')).toHaveText('THE TIDE CAME IN OVER THE FLATS.')

    // Apply: into the page, the card marked applied; its own Undo takes it back.
    await card.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(prose(win)).toHaveText('THE TIDE CAME IN OVER THE FLATS. The gulls went quiet.')
    await expect(card).toHaveAttribute('data-status', 'applied')
    await card.getByRole('button', { name: /^Undo this change/ }).click()
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

test('each tool call shows as it happens (running, then ✓), opens to what it was asked; folded once answered, or always open as chosen', async ({
  launch
}) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  // A model slow to write each call's arguments, so the call is seen running.
  const fake = await startFakeProvider({ delayMs: 5, toolDelayMs: 600 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    await useFakeModel(win, fake)
    await prose(win).click()
    await win.keyboard.type('The tide came in over the flats. The gulls went quiet.')
    const sceneId = await firstScene(win)
    await expect.poll(async () => (await invoke(win, 'getScene', sceneId)).text).toContain('gulls went quiet')

    await win.getByRole('button', { name: 'Ask the world', exact: true }).click()
    await ask(win, 'Please fix the first sentence')
    const calls = panel(win).getByRole('list', { name: 'Tool calls' })
    const read = calls.locator('[data-tool="read_scene"]')
    const propose = calls.locator('[data-tool="propose_changes"]')
    // While it runs: a row with a spinner, said in the head too; then ✓ with how long it took.
    await expect(read).toHaveAttribute('data-status', 'running')
    await expect(panel(win).locator('[data-steps] [data-running]')).toContainText('Reading the scene…')
    await expect(read).toHaveAttribute('data-status', 'done')
    await expect(read).toContainText('Read Ch 1, Sc 1')
    await expect(read).toContainText(/\d\.\ds/)
    await expect(propose).toHaveAttribute('data-status', 'running')
    await expect(propose).toHaveAttribute('data-status', 'done')
    await expect(propose).toContainText('Proposed 1 edit')

    // Answered: folded to one line, which opens the list again.
    const toggle = panel(win).locator('[data-tools-toggle]')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toContainText('2 tool calls')
    await expect(calls).toBeHidden()
    await toggle.click()
    await expect(calls).toBeVisible()
    // A row opens to what the call was asked with and what came back.
    await propose.getByRole('button', { name: /^Proposed 1 edit, done/ }).click()
    const details = propose.locator('[data-tool-details]')
    await expect(details).toBeVisible()
    await expect(details).toContainText('Asked with')
    await expect(details).toContainText('"changes"')
    await expect(details).toContainText('Proposed to the writer')

    // Always open, from the ⋯ menu, remembered after a restart (and the calls kept with the chat).
    await panel(win).getByRole('button', { name: 'Ask panel options' }).click()
    await win.getByRole('menuitemradio', { name: /^Always open/ }).click()
    await win.reload()
    await expect(prose(win)).toBeVisible()
    if (!(await panel(win).count())) await win.getByRole('button', { name: 'Ask the world', exact: true }).click()
    await expect(panel(win).locator('[data-tools-toggle]')).toHaveAttribute('aria-expanded', 'true')
    await expect(panel(win).getByRole('list', { name: 'Tool calls' }).locator('[data-tool="read_scene"]')).toHaveAttribute('data-status', 'done')
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
    // Only what changes is marked: the words cut, then the words added.
    await expect(card.locator('ins').last()).toHaveText('screamed once, then nothing.')
    await expect(card.locator('del').last()).toHaveText('went quiet.')
    await expect(paragraphs).toHaveCount(2)
    await expect(prose(win)).toContainText('The gulls went quiet.')

    await card.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(paragraphs.nth(0)).toHaveText('The tide roared in over the flats.')
    await expect(paragraphs.nth(0).locator('em')).toHaveText('roared')
    await expect(paragraphs.nth(1)).toHaveText('The gulls screamed once, then nothing.')
    await expect(card).toHaveAttribute('data-status', 'applied')
    // The toast's Undo (the card has its own, "Undo this change").
    await win.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(paragraphs.nth(0)).toHaveText('The tide came in over the flats.')
    await expect(paragraphs.nth(1)).toHaveText('The gulls went quiet.')
    await expect(card).toHaveAttribute('data-status', 'pending')

    // Applied again, then Undo with the scene closed: the saved scene gets its words back.
    await card.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(paragraphs.nth(1)).toHaveText('The gulls screamed once, then nothing.')
    // Another scene opens in the page (a new one, added from the binder).
    const chapter = binder(win).locator('[data-row="chapter"]').first()
    await chapter.hover()
    await chapter.getByRole('button', { name: 'Add a scene to this chapter' }).click()
    await win.getByRole('textbox', { name: 'Scene title' }).press('Enter')
    await expect(paragraphs).toHaveCount(1)
    await expect(prose(win)).not.toContainText('gulls')
    await win.getByRole('button', { name: 'Undo', exact: true }).last().click()
    await expect(card).toHaveAttribute('data-status', 'pending')
    await expect.poll(async () => (await invoke(win, 'getScene', sceneId)).text).toBe('The tide came in over the flats.\n\nThe gulls went quiet.')
    await binder(win).locator('[data-row]', { hasText: 'Scene 1' }).first().click()
    await expect(paragraphs.nth(0)).toHaveText('The tide came in over the flats.')
    await expect(paragraphs.nth(1)).toHaveText('The gulls went quiet.')
  } finally {
    await fake.close()
  }
})

// The chat overhaul's Phase 3 text tools (TEXTTOOLS; on by default, named here so the test keeps them).
test('text tools: an insert goes in after its paragraph and Undo takes it out; a cut comes back with Undo, the scene closed; find_mentions shows its count', async ({
  launch
}) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 5 })
  try {
    const { win } = await launch({ env: { AIWRITE_EXP_CHAT_TEXTTOOLS: 'on' } })
    await createWorldFromWelcome(win, 'Harbour')
    await useFakeModel(win, fake)
    await prose(win).click()
    for (const [i, line] of ['The tide came in over the flats.', 'The gulls went quiet.', 'Mara waited by the wall.'].entries()) {
      if (i) await win.keyboard.press('Enter')
      await win.keyboard.type(line)
    }
    const sceneId = await firstScene(win)
    await expect.poll(async () => (await invoke(win, 'getScene', sceneId)).text).toContain('waited by the wall')
    const paragraphs = prose(win).locator('p')
    await expect(paragraphs).toHaveCount(3)
    await win.getByRole('button', { name: 'Ask the world', exact: true }).click()

    // An insert: the paragraph it goes after, faint, then the new words; nothing changes until Apply.
    await ask(win, 'Add a line where she hesitates')
    const insert = changes(win).last().locator('[data-proposal]').first()
    await expect(insert).toContainText('Insert · Ch 1, Sc 1')
    await expect(insert.locator('[data-insert-near]')).toContainText('The tide came in over the flats.')
    await expect(insert.locator('[data-insert-text]')).toHaveText('She hesitated at the door.')
    await expect(paragraphs).toHaveCount(3)
    await insert.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(paragraphs).toHaveCount(4)
    await expect(paragraphs.nth(1)).toHaveText('She hesitated at the door.')
    await expect(paragraphs.nth(1).locator('em')).toHaveText('hesitated')
    await expect(insert).toHaveAttribute('data-status', 'applied')
    // Adam types in the paragraph before it; Undo takes out only the new one.
    await paragraphs.nth(0).click()
    await win.keyboard.press('Home')
    await win.keyboard.type('Then ')
    await insert.getByRole('button', { name: /^Undo this change/ }).click()
    await expect(paragraphs).toHaveCount(3)
    await expect(paragraphs.nth(0)).toHaveText('Then The tide came in over the flats.')
    await expect(insert).toHaveAttribute('data-status', 'pending')

    // A cut: the paragraph struck through; Apply takes it out.
    await ask(win, 'Cut the paragraph about the gulls')
    const cut = changes(win).last().locator('[data-proposal]').first()
    await expect(cut).toContainText('Cut · Ch 1, Sc 1')
    await expect(cut.locator('[data-cut-paragraph]')).toHaveText('The gulls went quiet.')
    await cut.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(paragraphs).toHaveCount(2)
    await expect(prose(win)).not.toContainText('gulls')
    // Undo with another scene open: the saved scene gets the paragraph back, in its place.
    const chapter = binder(win).locator('[data-row="chapter"]').first()
    await chapter.hover()
    await chapter.getByRole('button', { name: 'Add a scene to this chapter' }).click()
    await win.getByRole('textbox', { name: 'Scene title' }).press('Enter')
    await expect(paragraphs).toHaveCount(1)
    await cut.getByRole('button', { name: /^Undo this change/ }).click()
    await expect(cut).toHaveAttribute('data-status', 'pending')
    await expect
      .poll(async () => (await invoke(win, 'getScene', sceneId)).text)
      .toBe('Then The tide came in over the flats.\n\nThe gulls went quiet.\n\nMara waited by the wall.')

    // find_mentions: its row says what it found.
    await binder(win).locator('[data-row]', { hasText: 'Scene 1' }).first().click()
    await expect(paragraphs).toHaveCount(3)
    await ask(win, 'Where do I mention the gulls?')
    const row = panel(win).getByRole('list', { name: 'Tool calls' }).last().locator('[data-tool="find_mentions"]')
    await expect(row).toHaveAttribute('data-status', 'done')
    await expect(row).toContainText('Found “gulls” 1 time in 1 scene')
  } finally {
    await fake.close()
  }
})

// The chat overhaul's Phase 1 tools, behind their lab switches (ASKUSER, DRAFT; on by default, named here so these
// tests keep them whatever the defaults): what the window makes of them.
const PHASE1 = { env: { AIWRITE_EXP_CHAT_ASKUSER: 'on', AIWRITE_EXP_CHAT_DRAFT: 'on' } }

test('a question with options shows as buttons; a pick is the next question, and the chat shows it picked when opened again', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 5 })
  try {
    const { win } = await launch(PHASE1)
    await createWorldFromWelcome(win, 'Harbour')
    await useFakeModel(win, fake)
    await prose(win).click()
    await win.keyboard.type('The tide came in over the flats. The gulls went quiet.')
    await win.getByRole('button', { name: 'Ask the world', exact: true }).click()
    await ask(win, 'Make it better')

    const choice = panel(win).locator('[data-choice]')
    await expect(choice).toHaveAttribute('data-state', 'open')
    await expect(choice).toContainText('Which part do you mean?')
    const options = choice.locator('[data-option]')
    await expect(options).toHaveCount(3)
    await expect(options.nth(0)).toContainText('Recommended')
    await expect(options.nth(1)).toContainText('the last two lines, where the gulls go quiet')
    // The numbered options the answer's text ends with (for a window without buttons) don't show twice.
    await expect(panel(win)).not.toContainText('1. The opening paragraph')
    // Other… takes the keyboard to the box.
    await choice.getByRole('button', { name: 'Other…' }).click()
    await expect(box(win)).toBeFocused()

    // A pick, by keyboard: it goes as the next question in the same chat.
    await options.nth(1).focus()
    await win.keyboard.press('Enter')
    const questions = panel(win).locator('li > div > p')
    await expect(questions.last()).toHaveText('The ending — the last two lines, where the gulls go quiet')
    await expect(choice).toHaveAttribute('data-state', 'answered')
    await expect(options.nth(1)).toHaveAttribute('data-picked', '')
    await expect(options.nth(1)).toBeDisabled()
    expect(JSON.stringify(fake.lastRequest()!.body)).toContain('The ending — the last two lines')

    // Another chat, then this one again: it still shows which was picked.
    await panel(win).getByRole('button', { name: 'New chat' }).click()
    await expect(panel(win).locator('[data-choice]')).toHaveCount(0)
    await panel(win).getByRole('button', { name: 'Earlier chats' }).click()
    await win.getByRole('menuitem', { name: /Make it better/ }).click()
    await expect(choice).toHaveAttribute('data-state', 'answered')
    await expect(options.nth(1)).toHaveAttribute('data-picked', '')
  } finally {
    await fake.close()
  }
})

test('a proposed draft starts the writer’s own drafting on Apply, and says it has started', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 5 })
  try {
    const { win } = await launch(PHASE1)
    await createWorldFromWelcome(win, 'Harbour')
    await useFakeModel(win, fake)
    await expect(prose(win)).toHaveText('')
    await win.getByRole('button', { name: 'Ask the world', exact: true }).click()
    await ask(win, 'Please draft the scene')
    const card = changes(win).locator('[data-proposal]').first()
    await expect(card).toContainText('Draft · Ch 1, Sc 1')
    await expect(card.locator('[data-draft-mode]')).toContainText('Generate')
    await expect(card).toContainText('please draft the scene')
    // Nothing is written until Apply.
    await expect(prose(win)).toHaveText('')

    await card.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(card).toHaveAttribute('data-status', 'applied')
    await expect(card).toContainText('Started')
    await expect(card.getByRole('button', { name: 'Show Ch 1, Sc 1' })).toBeVisible()
    // The draft is written into the page by Generate's own run.
    await expect(prose(win)).not.toHaveText('', { timeout: 15_000 })

    // Carrying on from the end is Continue's tracked change, to accept or reject as usual.
    await expect(win.getByRole('button', { name: 'Stop' })).toHaveCount(0, { timeout: 15_000 })
    await ask(win, 'Write the next bit')
    const next = changes(win).last().locator('[data-proposal]').first()
    await expect(next.locator('[data-draft-mode]')).toContainText('Continue from the end')
    await next.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(next).toHaveAttribute('data-status', 'applied')
    await expect(prose(win).locator('.aw-sugg-new').first()).toBeVisible({ timeout: 15_000 })
  } finally {
    await fake.close()
  }
})

test('Edit this quotes the selected words with the box set to ask for a change', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 5 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    await useFakeModel(win, fake)
    await prose(win).click()
    await win.keyboard.type('The tide came in over the flats.')
    await win.keyboard.press('Shift+Home')
    await win.getByRole('button', { name: 'Edit this' }).click()
    await expect(box(win)).toHaveValue(/^About this passage: “The tide came in over the flats\.”/)
    await expect(box(win)).toBeFocused()
    await expect(panel(win).locator('[data-edit-mode]')).toContainText('Say what to change')
    await expect(panel(win).getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
    await win.keyboard.type('Make it slower')
    await box(win).press('Enter')
    await expect(panel(win).locator('li > div > p').last()).toContainText('Make it slower')
    await expect(box(win)).toHaveValue('')
    await expect(panel(win).locator('[data-edit-mode]')).toHaveCount(0)
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

// The chat overhaul's story tools (Phase 3, STORYTOOLS; on by default, named here so these tests keep them).
const STORY = { env: { AIWRITE_EXP_CHAT_STORYTOOLS: 'on', AIWRITE_KEEPER_QUIET_MS: '600000' } }

test('the chat lists the scene’s open issues and fixes one with the check’s rewrite: Apply marks it fixed, Undo reopens it', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch(STORY)
    await createWorldFromWelcome(win, 'Lowtown')
    await useFakeModel(win, fake)
    await invoke(win, 'createEntry', 'character', { name: 'Mara', fields: { eyes: 'blue' } })
    await win.reload()
    await expect(prose(win)).toBeVisible()
    const sceneId = await firstScene(win)
    // A planted contradiction, caught when the scene is marked done (the fake check: tests/fake-provider/m5/check.mjs).
    await prose(win).click()
    await win.keyboard.type('Mara pushed the door open. Mara’s eyes were green in the firelight.')
    await win.keyboard.press('Control+Enter')
    const open = async (): Promise<string[]> => (await invoke(win, 'listIssues', sceneId)).filter((i) => i.status === 'open').map((i) => i.id)
    await expect.poll(open, { timeout: 30_000 }).toHaveLength(1)
    const [issueId] = await open()

    await win.getByRole('button', { name: 'Ask the world', exact: true }).click()
    await ask(win, 'Fix the open continuity issue in this scene')
    const card = changes(win).locator('[data-proposal]').first()
    await expect(card).toContainText('Issue fix · Ch 1, Sc 1')
    await expect(card.locator('[data-issue-fix="text"]')).toContainText('eyes are blue in the memory')
    await expect(card.locator('ins')).toHaveText('blue')
    await expect(card.locator('del')).toHaveText('green')
    await expect(panel(win).getByRole('list', { name: 'Tool calls' }).locator('[data-tool="list_issues"]')).toHaveCount(1)
    await expect(panel(win).locator('[data-tools-toggle]')).toContainText('2 tool calls')
    // Nothing changes until Apply.
    await expect(prose(win)).toContainText('eyes were green')

    await card.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(prose(win)).toContainText('Mara’s eyes were blue in the firelight.')
    await expect(card).toHaveAttribute('data-status', 'applied')
    await expect.poll(async () => (await invoke(win, 'listIssues', sceneId)).find((i) => i.id === issueId)?.status).toBe('fixed')
    await card.getByRole('button', { name: /^Undo this change/ }).click()
    await expect(prose(win)).toContainText('Mara’s eyes were green in the firelight.')
    await expect(card).toHaveAttribute('data-status', 'pending')
    await expect.poll(async () => (await invoke(win, 'listIssues', sceneId)).find((i) => i.id === issueId)?.status).toBe('open')
  } finally {
    await fake.close()
  }
})

test('the chat reads a chapter card and proposes its point of view by name: Apply writes it into the scenes, Undo puts them back', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch(STORY)
    await createWorldFromWelcome(win, 'Harbour')
    await useFakeModel(win, fake)
    const ilse = await invoke(win, 'createEntry', 'character', { name: 'Ilse Marrow', aliases: ['Ilse'] })
    const [story] = await invoke(win, 'listStories')
    const outline = await invoke(win, 'getOutline', story.id)
    const chapterId = outline.chapters[0].id
    const sceneId = outline.scenes[0].id
    await win.reload()
    await expect(prose(win)).toBeVisible()

    await win.getByRole('button', { name: 'Ask the world', exact: true }).click()
    await ask(win, "Set chapter 1's POV to Ilse")
    const card = changes(win).locator('[data-proposal]').first()
    await expect(card).toContainText(/Chapter card · Ch 1/)
    await expect(card).toContainText('Point of view: Ilse Marrow')
    await expect(card.locator('[data-chapter-scenes]')).toHaveText('Updates 1 scene that follows this chapter card')
    await expect(panel(win).getByRole('list', { name: 'Tool calls' }).locator('[data-tool="chapter_card"]')).toHaveCount(1)
    expect((await invoke(win, 'getChapterCard', chapterId)).povId).toBeNull()

    await card.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(card).toHaveAttribute('data-status', 'applied')
    await expect.poll(async () => (await invoke(win, 'getChapterCard', chapterId)).povId).toBe(ilse.id)
    await expect.poll(async () => (await invoke(win, 'getScene', sceneId)).card.povId).toBe(ilse.id)
    await card.getByRole('button', { name: /^Undo this change/ }).click()
    await expect(card).toHaveAttribute('data-status', 'pending')
    await expect.poll(async () => (await invoke(win, 'getChapterCard', chapterId)).povId).toBeNull()
    await expect.poll(async () => (await invoke(win, 'getScene', sceneId)).card.povId).toBeNull()
  } finally {
    await fake.close()
  }
})
