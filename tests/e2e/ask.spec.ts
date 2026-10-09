// Ask the world (milestone 4): the chat beside the page that can see the memory. Opened from the top
// bar, a question's answer streams in with links to the entries it cites (a name that isn't in the
// world stays plain words); a cited entry shows beside the page (Esc there goes back to the chat, and an
// answer being written goes on); an answer is saved to the memory as Adam's own note, with Undo; Stop
// keeps what arrived; a question that got no answer stays in the chat; New chat starts afresh (an answer
// not yet started stops as it starts), and the last chat is there again after a restart. The fake
// provider answers as tests/fake-provider/m4/ask.mjs says.
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
  // A slow answer takes several seconds: time to look at an entry it cites, then Stop it.
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 15, slowDelayMs: 70 })
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
    // The examples name this world's own characters.
    await expect(panel(win).getByRole('button', { name: 'Did I already say how old Tobin is?' })).toBeVisible()
    await panel(win).getByRole('button', { name: 'What would Mara Venn do if Tobin lied?' }).click()
    await expect(box(win)).toHaveValue('What would Mara Venn do if Tobin lied?')
    await box(win).press('Enter')
    await expect(box(win)).toHaveValue('')

    // The answer streams in, naming what it used as links; a name that isn't in the world stays plain words.
    const answer = turns(win).first().locator('[data-answer]')
    await expect(answer).toContainText('they meet at The Grey Ferry at dusk')
    await expect(answer.getByRole('button', { name: 'Mara Venn' })).toBeVisible()
    await expect(answer.getByRole('button', { name: 'Tobin' })).toBeVisible()
    await expect(answer.locator('[data-entry-id]')).toHaveCount(2)
    await expect(answer).not.toContainText('[[')
    // Words the model set in italics show in italics, without the marks.
    await expect(answer.locator('em')).toHaveText('nobody')
    await expect(answer).not.toContainText('*')
    // What the AI saw is in the answer's ⋯ menu (its actions show on hover or focus).
    await turns(win).first().getByRole('button', { name: 'More about this answer' }).click()
    await expect(win.getByRole('menuitem', { name: 'What the AI saw' })).toBeVisible()
    await win.keyboard.press('Escape')
    // The entries it used, as chips under it.
    await expect(turns(win).first().locator('[data-sources] [data-source-id]')).toHaveCount(2)
    // It was asked from the open scene, with the marker, and the entries it names in full.
    const sent = fake.lastRequest()!.body as { messages: { role: string; content: string }[] }
    expect(sent.messages[0].content.startsWith('[AIWRITE-ASK v1] answer\n')).toBe(true)
    expect(sent.messages[0].content).toContain('### Mara Venn (character)')
    expect(sent.messages[0].content).toContain('Quick to anger, slow to forgive.')
    expect(sent.messages.at(-1)?.content).toBe('What would Mara Venn do if Tobin lied?')

    // A cited entry shows beside the page, inside Ask, with the keyboard; Back returns to the chat.
    await answer.getByRole('button', { name: 'Tobin' }).click()
    const peek = scenePanel(win).getByRole('region', { name: 'Tobin' })
    await expect(peek).toContainText('The ferryman.')
    await expect(peek.getByRole('button', { name: 'Back to Ask the world' })).toBeFocused()
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
    expect(page.description).toContain('where nobody is watching.')
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
    await expect(second.locator('[data-steps]')).toContainText('Answering…')
    await expect(panel(win).locator('[data-ask-status]')).toHaveText('Answering…')
    await expect(second.locator('[data-answer]')).toContainText('Idea 1:')
    // An entry it cites, shown while it is being written: Esc goes back to the chat, and the answer goes on.
    await second.locator('[data-answer]').getByRole('button', { name: 'Tobin' }).click()
    await expect(peek).toContainText('The ferryman.')
    await win.keyboard.press('Escape')
    await expect(peek).toHaveCount(0)
    await expect(second.locator('[data-steps]')).toContainText('Answering…')
    await expect(box(win)).toBeFocused()
    await panel(win).getByRole('button', { name: 'Stop', exact: true }).click()
    // How the answer ended shows under it, and a screen reader hears it.
    await expect(second.locator('[data-end-note]')).toHaveText('Stopped')
    await expect(panel(win).locator('[data-ask-status]')).toHaveText('Stopped')
    await expect(panel(win).getByRole('button', { name: 'Ask', exact: true })).toBeVisible()
    const kept = await second.locator('[data-answer]').innerText()
    expect(kept).toContain('Answer 2 in this chat.')
    expect(kept).not.toContain('Idea 20:')
    // The second question carried the first turn with it.
    const slow = fake.lastRequest()!.body as { messages: { role: string; content: string }[] }
    expect(slow.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])

    // A question the AI was asked that got no answer stays, as it does in the chat's record: while it is
    // the last, it says why, with Try again; once another question follows, it says so quietly.
    await invoke(win, 'updateSettings', { models: { chat: choice(providerId, 'fake/credit') } })
    await box(win).fill('Who keeps the ferry these days?')
    await box(win).press('Enter')
    const third = turns(win).nth(2)
    await expect(third.getByRole('alert')).toContainText('credit')
    await expect(third.getByRole('button', { name: 'More about this answer' })).toBeVisible()
    await invoke(win, 'updateSettings', { models: { chat: choice(providerId, 'fake/writer') } })
    await third.getByRole('alert').getByRole('button', { name: 'Try again' }).click()
    await expect(turns(win)).toHaveCount(4)
    await expect(turns(win).nth(3).locator('[data-answer]')).toContainText('they meet at The Grey Ferry at dusk')
    await expect(third.getByRole('alert')).toHaveCount(0)
    await expect(third).toContainText('Didn’t get an answer')
    await expect(third.getByRole('button', { name: 'More about this answer' })).toBeVisible()

    // New chat starts afresh; the first is in the list of earlier chats.
    await panel(win).getByRole('button', { name: 'New chat' }).click()
    await expect(conversation(win)).toHaveCount(0)
    await expect(panel(win).getByText('Try asking')).toBeVisible()
    await panel(win).getByRole('button', { name: 'Earlier chats' }).click()
    await expect(win.getByRole('menuitem', { name: /What would Mara Venn do if Tobin lied\?/ })).toBeVisible()
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
    await expect(turns(again.win)).toHaveCount(4)
    await expect(turns(again.win).first()).toContainText('What would Mara Venn do if Tobin lied?')
    await expect(turns(again.win).first().locator('[data-answer]').getByRole('button', { name: 'Mara Venn' })).toBeVisible()
    await expect(turns(again.win).nth(1)).toContainText('Stopped')
    await expect(turns(again.win).nth(2)).toContainText('Didn’t get an answer')
    await expect(turns(again.win).nth(2).getByRole('alert')).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

test('Ask the world’s answers in blocks: quick actions, option cards and what they do, follow-ups, a fact check’s verdict, density', async ({ launch }) => {
  const fake = await startFake({ delayMs: 2 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Gamma')
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    await invoke(win, 'createEntry', 'character', { name: 'Mara Venn', aliases: ['Mara'], summary: 'A smith’s daughter.', originStoryId: story.id })
    await useFakeModel(win, fake)
    const beats = async (): Promise<string[]> => (await invoke(win, 'getScene', sceneId)).card.beats

    // A quick action over the empty box starts the question.
    await win.getByRole('button', { name: 'Ask the world', exact: true }).click()
    // All four fit on the row in the panel's own width (short words there), with no scrolling sideways.
    const row = panel(win).locator('[data-context-row]')
    await expect(row.locator('[data-quick]')).toHaveCount(4)
    expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await expect(row.locator('[data-quick="check"]')).toHaveText('Check', { useInnerText: true })
    await panel(win).locator('[data-context-row]').getByRole('button', { name: 'Brainstorm' }).click()
    await expect(box(win)).toHaveValue('Brainstorm ideas for ')
    await expect(box(win)).toBeFocused()
    await win.keyboard.type('the harbour')
    await box(win).press('Enter')

    // The ideas come as cards.
    const turn = turns(win).first()
    const cards = turn.locator('[data-option-card]')
    await expect(cards).toHaveCount(3)
    await expect(cards.first()).toContainText('Cut it back')
    await expect(panel(win).locator('[data-ask-status]')).toHaveText('Answer ready: 3 options')

    // Kept (★), with the answer (still kept after a reload, below).
    await cards.first().getByRole('button', { name: /^Keep / }).click()
    await expect(cards.first()).toHaveAttribute('data-state', 'kept')
    // Use as beat: on the open scene's card, with Undo.
    await cards.nth(1).getByRole('button', { name: /as a beat$/ }).click()
    await expect(cards.nth(1)).toContainText('Added as beat 1')
    await expect.poll(beats).toEqual(['End on the dialogue — the line of dialogue instead.'])
    await toasts(win).getByRole('button', { name: 'Undo' }).last().click()
    await expect.poll(beats).toEqual([])
    await expect(cards.nth(1)).toHaveAttribute('data-state', 'idle')
    // Set aside, and back.
    await cards.nth(2).getByRole('button', { name: / aside$/ }).click()
    await expect(cards.nth(2)).toHaveAttribute('data-state', 'aside')
    await cards.nth(2).getByRole('button', { name: /^Bring back/ }).click()
    await expect(cards.nth(2)).toHaveAttribute('data-state', 'idle')

    // A follow-up fills the box, ready to change or ask.
    const followUps = turn.locator('[data-follow-ups] button')
    await expect(followUps).toHaveCount(2)
    await followUps.nth(1).click()
    await expect(box(win)).toHaveValue('Give me three more')
    await expect(box(win)).toBeFocused()
    // More like this asks at once.
    await cards.first().getByRole('button', { name: /^More ideas like/ }).click()
    await expect(turns(win)).toHaveCount(2)
    await expect(turns(win).nth(1)).toContainText('More ideas like “Cut it back”')
    await expect(turns(win).nth(1).locator('[data-option-card]')).toHaveCount(3)

    // A fact check opens with its verdict, then what the memory has.
    await panel(win).getByRole('button', { name: 'New chat' }).click()
    await box(win).fill('Did I already say how old Mara is?')
    await box(win).press('Enter')
    const check = turns(win).first()
    await expect(check.locator('[data-verdict="unknown"]')).toHaveText('Not in memory yet')
    await expect(check.locator('[data-facts] [data-fact]')).toHaveCount(1)
    await expect(check.locator('[data-fact] [data-source-id]')).toHaveAttribute('aria-label', /^Mara Venn/)

    // Compact, from the panel's ⋯ menu, and remembered.
    await panel(win).getByRole('button', { name: 'Ask panel options' }).click()
    await win.getByRole('menuitemradio', { name: /^Compact/ }).click()
    await expect(panel(win).locator('[data-density="compact"]')).toHaveCount(1)
    await win.reload()
    await expect(win.locator('.scene-prose')).toBeVisible()
    if (!(await panel(win).count())) await win.getByRole('button', { name: 'Ask the world', exact: true }).click()
    await expect(panel(win).locator('[data-density="compact"]')).toHaveCount(1)

    // What was made of the option cards is kept with the answer (chat Phase 4): the earlier chat, read back from its
    // records after the reload, shows its first card kept still; the others, put back, show as they were.
    await panel(win).getByRole('button', { name: 'Earlier chats' }).click()
    await win.getByRole('menuitem', { name: /Brainstorm ideas for the harbour/ }).click()
    const keptCards = turns(win).first().locator('[data-option-card]')
    await expect(keptCards).toHaveCount(3)
    await expect(keptCards.first()).toHaveAttribute('data-state', 'kept')
    await expect(keptCards.nth(1)).toHaveAttribute('data-state', 'idle')
    await expect(keptCards.nth(2)).toHaveAttribute('data-state', 'idle')
  } finally {
    await fake.close()
  }
})

test('Ask the world opens on the writing page with no scene open, says plainly when no model is set up, and stops an answer on Esc or a new chat', async ({
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
  // The top bar's panel button hides and shows it, as it does the scene panel.
  const side = win.getByRole('complementary', { name: 'Ask the world' })
  const panelButton = win.getByRole('button', { name: 'Show or hide the scene panel' })
  await expect(panelButton).toBeEnabled()
  await panelButton.click()
  // Closed, it takes no room (bar its 1px edge).
  await expect.poll(async () => (await side.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1)
  await panelButton.click()
  await expect.poll(async () => (await side.boundingBox())?.width ?? 0).toBeGreaterThan(200)
  await expect(ask).toBeVisible()
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

    // Asked, and left at once for a new chat before the answer has started: it stops as soon as it
    // starts, rather than going on being written where it can't be seen. The chat it was asked in
    // keeps it, stopped.
    const question = 'Who keeps the ferry these days?'
    await box(win).fill(question)
    await win.evaluate(`(() => {
      const panel = document.querySelector('section[aria-label="Ask the world"]')
      panel.querySelector('form').requestSubmit()
      panel.querySelector('button[aria-label="New chat"]').click()
    })()`)
    await expect(ask.getByText('Try asking')).toBeVisible()
    await expect
      .poll(
        async () => {
          const [latest] = await invoke(win, 'listChats', story.id)
          const asked = latest ? (await invoke(win, 'getChat', latest.chatId)).find((t) => t.question === question) : undefined
          return asked?.status ?? 'not asked yet'
        },
        { timeout: 15000 }
      )
      .toBe('stopped')
    await expect(conversation(win)).toHaveCount(0)
  } finally {
    await fake.close()
  }

  // The top bar's button closes it again.
  await win.getByRole('button', { name: 'Ask the world', exact: true }).click()
  await expect(ask).toHaveCount(0)
})
