// Ask the world (milestone 4): the chat beside the page that can see the memory. Opened from the top
// bar, a question's answer streams in with links to the entries it cites (a name that isn't in the
// world stays plain words); a cited entry shows beside the page; an answer is saved to the memory as
// Adam's own note, with Undo; Stop keeps what arrived; New chat starts afresh, and the last chat is
// there again after a restart. The fake provider answers as tests/fake-provider/m4/ask.mjs says.
import type { Page } from '@playwright/test'
import type { ModelChoice } from '@shared/types'
import { closeWindow, createWorldFromWelcome, expect, invoke, startFake, test, useFakeModel } from './helpers'

const scenePanel = (win: Page) => win.getByRole('complementary', { name: 'Scene panel' })
const panel = (win: Page) => win.getByRole('region', { name: 'Ask the world' })
const box = (win: Page) => panel(win).getByRole('textbox', { name: 'Ask about your world' })
const conversation = (win: Page) => panel(win).getByRole('list', { name: 'Conversation' })
const turns = (win: Page) => conversation(win).locator(':scope > li')
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')

const choice = (providerId: string, modelId: string): ModelChoice => ({
  providerId,
  modelId,
  label: modelId,
  contextLength: 32000,
  promptPrice: null,
  completionPrice: null
})

test('Ask the world: ask, cited entries, save to memory, Stop, New chat, and the last chat after a restart', async ({ launch }) => {
  const fake = await startFake({ delayMs: 15 })
  try {
    const first = await launch()
    const { win } = first
    await createWorldFromWelcome(win, 'Alpha')
    const [story] = await invoke(win, 'listStories')
    const mara = await invoke(win, 'createEntry', 'character', {
      name: 'Mara Venn',
      aliases: ['Mara'],
      summary: 'A smith’s daughter.',
      description: 'Quick to anger, slow to forgive.',
      originStoryId: story.id
    })
    const tobin = await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'The ferryman.', originStoryId: story.id })
    await useFakeModel(win, fake, 'fake/writer')

    // Opened from the top bar, beside the page, with the keyboard in its box and the spec's examples.
    await win.getByRole('button', { name: 'Ask the world', exact: true }).click()
    await expect(scenePanel(win).getByRole('region', { name: 'Ask the world' })).toBeVisible()
    await expect(box(win)).toBeFocused()
    await expect(panel(win).getByText('As of Book 1, Ch 1, Sc 1')).toBeVisible()
    await panel(win).getByRole('button', { name: 'What would Mara do if Tobin lied to her?' }).click()
    await expect(box(win)).toHaveValue('What would Mara do if Tobin lied to her?')
    await box(win).press('Enter')
    await expect(box(win)).toHaveValue('')

    // The answer streams in, naming what it used as links; a name that isn't in the world stays plain words.
    const answer = turns(win).first().locator('[data-answer]')
    await expect(answer).toContainText('they meet at The Grey Ferry at dusk')
    await expect(answer.getByRole('button', { name: 'Mara Venn' })).toBeVisible()
    await expect(answer.getByRole('button', { name: 'Tobin' })).toBeVisible()
    await expect(answer.locator('[data-entry-id]')).toHaveCount(2)
    await expect(answer).not.toContainText('[[')
    await expect(turns(win).first()).toContainText('What the AI saw')
    // It was asked from the open scene, with the marker, and the entries it names in full.
    const sent = fake.lastRequest()!.body as { messages: { role: string; content: string }[] }
    expect(sent.messages[0].content.startsWith('[AIWRITE-ASK v1] answer\n')).toBe(true)
    expect(sent.messages[0].content).toContain('### Mara Venn (character)')
    expect(sent.messages[0].content).toContain('Quick to anger, slow to forgive.')
    expect(sent.messages.at(-1)?.content).toBe('What would Mara do if Tobin lied to her?')

    // A cited entry shows beside the page, inside Ask; Back returns to the chat.
    await answer.getByRole('button', { name: 'Tobin' }).click()
    const peek = scenePanel(win).getByRole('region', { name: 'Tobin' })
    await expect(peek).toContainText('The ferryman.')
    await peek.getByRole('button', { name: 'Back to Ask the world' }).click()
    await expect(answer).toBeVisible()
    await expect(box(win)).toBeFocused()

    // Saved to the memory in one click, as Adam's own note on the first entry it cites; Undo takes it out.
    await turns(win).first().getByRole('button', { name: 'Save to Mara Venn' }).click()
    await expect(toasts(win)).toContainText('Saved to memory for Mara Venn, as your own note.')
    await expect(turns(win).first()).toContainText('Saved to Mara Venn')
    // The toast shows beside the panel, not over the newest words or the box.
    const toastBox = (await toasts(win).boundingBox())!
    expect(toastBox.x + toastBox.width).toBeLessThanOrEqual((await panel(win).boundingBox())!.x)
    let page = await invoke(win, 'getEntry', mara.id)
    expect(page.description).toContain('Quick to anger, slow to forgive.\n\nFrom the memory: Mara Venn and Tobin.')
    expect(page.description).not.toContain('[[')
    expect(page.fieldOrigins.description).toBe('adam')
    await toasts(win).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await invoke(win, 'getEntry', mara.id)).description).toBe('Quick to anger, slow to forgive.')
    await expect(turns(win).first().getByRole('button', { name: 'Save to Mara Venn' })).toBeVisible()
    // Or to another entry it cites, from the arrow beside it.
    await turns(win).first().getByRole('button', { name: 'Save somewhere else' }).click()
    await win.getByRole('menuitem', { name: /^Tobin/ }).click()
    await expect(toasts(win)).toContainText('Saved to memory for Tobin, as your own note.')
    page = await invoke(win, 'getEntry', tobin.id)
    expect(page.description).toContain('From the memory: Mara Venn and Tobin.')
    expect(page.fieldOrigins.description).toBe('adam')

    // Stop keeps what has arrived (a slow chat model, so there is time).
    const providerId = (await invoke(win, 'getSettings')).models.writer!.providerId
    await invoke(win, 'updateSettings', { models: { chat: choice(providerId, 'fake/slow') } })
    await box(win).fill('Give me ten tavern names that fit the north')
    await panel(win).getByRole('button', { name: 'Ask', exact: true }).click()
    const second = turns(win).nth(1)
    await expect(second.getByRole('status')).toContainText('Answering…')
    await expect(second.locator('[data-answer]')).toContainText('Idea 1:')
    await panel(win).getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(second).toContainText('Stopped')
    await expect(panel(win).getByRole('button', { name: 'Ask', exact: true })).toBeVisible()
    const kept = await second.locator('[data-answer]').innerText()
    expect(kept).toContain('Answer 2 in this chat.')
    expect(kept).not.toContain('Idea 20:')
    // The second question carried the first turn with it.
    const slow = fake.lastRequest()!.body as { messages: { role: string; content: string }[] }
    expect(slow.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])

    // New chat starts afresh; the first is in the list of earlier chats.
    await panel(win).getByRole('button', { name: 'New chat' }).click()
    await expect(conversation(win)).toHaveCount(0)
    await expect(panel(win).getByText('Try asking')).toBeVisible()
    await panel(win).getByRole('button', { name: 'Earlier chats' }).click()
    await expect(win.getByRole('menuitem', { name: /What would Mara do if Tobin lied to her\?/ })).toBeVisible()
    await win.keyboard.press('Escape')

    // Closing returns to the scene panel's tabs.
    await panel(win).getByRole('button', { name: 'Close Ask the world' }).click()
    await expect(panel(win)).toHaveCount(0)
    await expect(scenePanel(win).getByRole('tab', { name: 'Scene card' })).toBeVisible()

    // After a restart, Ask opens on the last chat, with its answers and links.
    await closeWindow(first.app)
    const again = await launch({ dataDir: first.dataDir })
    await expect(again.win.locator('.scene-prose')).toBeVisible()
    await again.win.getByRole('button', { name: 'Ask the world', exact: true }).click()
    await expect(turns(again.win)).toHaveCount(2)
    await expect(turns(again.win).first()).toContainText('What would Mara do if Tobin lied to her?')
    await expect(turns(again.win).first().locator('[data-answer]').getByRole('button', { name: 'Mara Venn' })).toBeVisible()
    await expect(turns(again.win).nth(1)).toContainText('Stopped')
  } finally {
    await fake.close()
  }
})

test('Ask the world opens on the writing page with no scene open, says plainly when no model is set up, and Esc stops an answer', async ({
  launch
}) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Beta')
  const [story] = await invoke(win, 'listStories')
  const { scenes } = await invoke(win, 'getOutline', story.id)
  await invoke(win, 'deleteScene', scenes[0].id)
  await win.reload()
  await expect(win.getByRole('button', { name: 'Ask the world', exact: true })).toBeVisible()

  await win.getByRole('button', { name: 'Ask the world', exact: true }).click()
  const ask = win.getByRole('complementary', { name: 'Ask the world' }).getByRole('region', { name: 'Ask the world' })
  await expect(ask).toBeVisible()
  await expect(ask.getByText('As of the end of Book 1')).toBeVisible()
  await box(win).fill('Did I already say how old the Duke is?')
  await box(win).press('Enter')
  // No model yet: the question stays, with what to do in plain words.
  await expect(ask.getByRole('alert')).toContainText('Choose a writer model first, in Settings › Models.')
  await expect(ask.getByRole('alert').getByRole('button', { name: 'Open Settings' })).toBeVisible()
  await expect(ask.getByRole('alert').getByRole('button', { name: 'Try again' })).toBeVisible()

  // With a model chosen, Try again asks it; Esc stops the answer and keeps what arrived.
  const fake = await startFake({ delayMs: 15 })
  try {
    const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
    await invoke(win, 'updateSettings', { models: { writer: choice(p.id, 'fake/slow') } })
    await ask.getByRole('alert').getByRole('button', { name: 'Try again' }).click()
    await expect(ask.getByRole('alert')).toHaveCount(0)
    await expect(turns(win)).toHaveCount(1)
    await expect(turns(win).first().locator('[data-answer]')).toContainText('Idea 1:')
    await box(win).press('Escape')
    await expect(turns(win).first()).toContainText('Stopped')
    expect(await turns(win).first().locator('[data-answer]').innerText()).not.toContain('Idea 20:')
  } finally {
    await fake.close()
  }

  // The top bar's button closes it again.
  await win.getByRole('button', { name: 'Ask the world', exact: true }).click()
  await expect(ask).toHaveCount(0)
})
