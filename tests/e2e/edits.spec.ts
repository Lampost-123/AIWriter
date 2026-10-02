// AI edits of selected words (milestone 4): the tools in the bar over selected words, the tracked change
// they write into the page (the old words struck through, the new ones marked), Accept, Reject, Stop, Ctrl+Z
// and Ctrl+Y, Alternatives, Fix voice, and Continue from the cursor. Against the fake AI server, whose
// replies for these are worked out from the selected words (tests/fake-provider/m4/edits.mjs).
import type { Page } from '@playwright/test'
import type { FakeProvider } from '../fake-provider/server.mjs'
import { binder, createWorldFromWelcome, expect, invoke, startFake, test } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const paras = (win: Page) => prose(win).locator('p')
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')
const selectionBar = (win: Page) => win.getByRole('toolbar', { name: 'Selected words' })
const tools = (win: Page) => win.locator('[data-ai-tools]')
const change = (win: Page) => win.getByRole('group', { name: 'The AI’s change' })
const oldWords = (win: Page) => prose(win).locator('.aw-sugg-old')
const newWords = (win: Page) => prose(win).locator('.aw-sugg-words')
const acceptButton = (win: Page) => change(win).getByRole('button', { name: /^Accept/ })
const rejectButton = (win: Page) => change(win).getByRole('button', { name: /^Reject/ })
const stopButton = (win: Page) => change(win).getByRole('button', { name: /^Stop/ })
const versions = (win: Page) => change(win).getByRole('listbox', { name: 'Versions' }).getByRole('option')
const row = (win: Page, title: string) => binder(win).locator('[data-row]', { hasText: title }).first()

const savedText = async (win: Page, sceneId: string): Promise<string> => (await invoke(win, 'getScene', sceneId)).text
const paragraphIds = (win: Page) => paras(win).evaluateAll((ps) => ps.map((p) => p.getAttribute('data-pid')))

const P1 = 'The tavern was warm and loud. Rain hammered the shutters.'
const P2 = 'Mara pushed through the crowd to the back table.'
const TEXT = [P1, P2]

/** The memory waits long after any change, so the only AI calls are the ones each test makes. */
const QUIET = { env: { AIWRITE_KEEPER_QUIET_MS: '600000' } }

/**
 * A world whose first scene has `text`, with the fake server's `model` as the writer model (none when
 * null), and a second scene when asked. The window is reloaded to read it all.
 */
async function setUp(
  win: Page,
  fake: FakeProvider | null,
  o: { model?: string; text?: string[]; secondScene?: boolean } = {}
): Promise<{ sceneId: string; storyId: string }> {
  await createWorldFromWelcome(win, 'Alpha')
  const [story] = await invoke(win, 'listStories')
  const { scenes, chapters } = await invoke(win, 'getOutline', story.id)
  const sceneId = scenes[0].id
  if (o.secondScene) await invoke(win, 'createScene', chapters[0].id, { title: 'Scene 2' })
  if (fake) {
    const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
    const modelId = o.model ?? 'fake/writer'
    await invoke(win, 'updateSettings', {
      models: { writer: { providerId: p.id, modelId, label: modelId, contextLength: 32000, promptPrice: null, completionPrice: null } }
    })
  }
  const text = o.text ?? TEXT
  await invoke(win, 'saveSceneText', sceneId, null, text.join('\n\n'))
  await win.reload()
  await expect(paras(win)).toHaveText(text)
  return { sceneId, storyId: story.id }
}

/**
 * Sets the window's selection from the start of words `a` to the end of words `b` in the page (skipping
 * the words of a change waiting there, which aren't the scene's). Run in the window, as text.
 */
const SELECT = `(a, b) => {
  const el = document.querySelector('.scene-prose')
  const texts = []
  let all = ''
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node.parentElement && node.parentElement.closest('.aw-sugg-new')) continue
    texts.push({ node, start: all.length })
    all += node.data
  }
  const from = all.indexOf(a)
  const end = from < 0 ? -1 : all.indexOf(b, from)
  if (from < 0 || end < 0) throw new Error('Not in the page: ' + (from < 0 ? a : b))
  const at = (offset, isEnd) => {
    const t = texts.find((x) => (isEnd ? offset > x.start && offset <= x.start + x.node.data.length : offset >= x.start && offset < x.start + x.node.data.length))
    return [t.node, offset - t.start]
  }
  const [n1, o1] = at(from, false)
  const [n2, o2] = at(end + b.length, true)
  document.getSelection().setBaseAndExtent(n1, o1, n2, o2)
}`

/**
 * Selects words in the page, from the start of `first` to the end of `last`, as a drag of the mouse
 * would, and waits for the bar over them.
 */
async function selectWords(win: Page, first: string, last = first): Promise<void> {
  await prose(win).focus()
  await win.evaluate(`(${SELECT})(${JSON.stringify(first)}, ${JSON.stringify(last)})`)
  await expect(selectionBar(win)).toBeVisible()
}

/** Opens the AI tools over the selected words. */
async function openTools(win: Page): Promise<void> {
  await selectionBar(win).getByRole('button', { name: 'Rewrite', exact: true }).click()
  await expect(tools(win)).toBeVisible()
}

/** Runs one of the AI tools on the selected words. */
async function runTool(win: Page, name: string): Promise<void> {
  await openTools(win)
  await tools(win)
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click()
  await expect(tools(win)).toBeHidden()
}

/**
 * True once the page has the caret at the start or end of paragraph `i`. The browser tells the page where a
 * click or a key put the caret a moment later, and a key pressed before then would act where it was.
 */
const CARET = `(i, end) => {
  const { $head, empty } = document.querySelector('.scene-prose').editor.state.selection
  return empty && $head.index(0) === i && $head.parentOffset === (end ? $head.parent.content.size : 0)
}`

/** Where the caret is in its paragraph (run in the window, as text). */
const HEAD = `document.querySelector('.scene-prose').editor.state.selection.$head.parentOffset`

/** Puts the caret at the end of paragraph `i` (or its start). */
async function caretAt(win: Page, i: number, where: 'end' | 'start' = 'end'): Promise<void> {
  await paras(win).nth(i).click()
  await win.keyboard.press(where === 'end' ? 'End' : 'Home')
  await expect.poll(() => win.evaluate(`(${CARET})(${i}, ${where === 'end'})`)).toBe(true)
}

test('Condense shows a tracked change; the scene stays as it was until Accept; Accept puts it in, one Ctrl+Z takes it out, Ctrl+Y puts it back', async ({
  launch
}) => {
  const fake = await startFake()
  try {
    const { win } = await launch(QUIET)
    const { sceneId } = await setUp(win, fake)
    const ids = await paragraphIds(win)
    expect(ids.every(Boolean)).toBe(true)

    await selectWords(win, P1)
    await runTool(win, 'Condense')
    // The old words struck through, the new ones after them (the AI's lead-in line left out).
    const condensed = 'The tavern was warm and loud.'
    await expect(newWords(win)).toHaveText(condensed)
    await expect(oldWords(win)).toHaveText(P1)
    await expect(acceptButton(win)).toBeVisible()
    await expect(acceptButton(win)).toContainText('Tab')
    await expect(rejectButton(win)).toContainText('Esc')
    await expect(change(win).getByRole('button', { name: 'What the AI saw' })).toBeVisible()
    await expect(change(win)).toContainText('Condense')
    // The keyboard stays in the page, and the page itself hasn't changed.
    await expect(prose(win)).toBeFocused()
    await expect(paras(win)).toHaveCount(2)

    // Typing elsewhere keeps the change, and only the typing is saved.
    await caretAt(win, 1)
    await win.keyboard.type(' Still raining.')
    const typed = [P1, `${P2} Still raining.`]
    await expect.poll(() => savedText(win, sceneId)).toBe(typed.join('\n\n'))
    await expect(newWords(win)).toHaveText(condensed)
    await expect(oldWords(win)).toHaveText(P1)
    await win.waitForTimeout(1500)
    expect(await savedText(win, sceneId)).toBe(typed.join('\n\n'))

    // Accept: the new words take the old ones' place, and are saved. The paragraph keeps its id.
    await acceptButton(win).click()
    await expect(change(win)).toBeHidden()
    await expect(oldWords(win)).toHaveCount(0)
    await expect(newWords(win)).toHaveCount(0)
    const accepted = [condensed, `${P2} Still raining.`]
    await expect(paras(win)).toHaveText(accepted)
    await expect.poll(() => savedText(win, sceneId)).toBe(accepted.join('\n\n'))
    expect(await paragraphIds(win)).toEqual(ids)

    // One Ctrl+Z: the words exactly as they were (the typing stays). Ctrl+Y: the change again.
    await expect(prose(win)).toBeFocused()
    await win.keyboard.press('Control+z')
    await expect(paras(win)).toHaveText(typed)
    await expect.poll(() => savedText(win, sceneId)).toBe(typed.join('\n\n'))
    expect(await paragraphIds(win)).toEqual(ids)
    await win.keyboard.press('Control+y')
    await expect(paras(win)).toHaveText(accepted)
    await expect.poll(() => savedText(win, sceneId)).toBe(accepted.join('\n\n'))
    await win.keyboard.press('Control+z')
    await expect(paras(win)).toHaveText(typed)
  } finally {
    await fake.close()
  }
})

test('Reject leaves the words as they were; Undo in its message, Esc, Ctrl+Z and Ctrl+Y', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch(QUIET)
    const { sceneId } = await setUp(win, fake)

    await selectWords(win, P2)
    await runTool(win, 'Expand')
    const expanded = `${P2} She let the silence stretch until the fire popped.`
    await expect(newWords(win)).toHaveText(expanded)
    await rejectButton(win).click()
    await expect(change(win)).toBeHidden()
    await expect(oldWords(win)).toHaveCount(0)
    await expect(newWords(win)).toHaveCount(0)
    await expect(paras(win)).toHaveText(TEXT)
    const rejected = toasts(win).getByText('Change rejected.', { exact: true })
    await expect(rejected).toBeVisible()

    // The message's Undo brings the change back, ready to accept.
    await toasts(win).getByRole('button', { name: 'Undo' }).click()
    await expect(newWords(win)).toHaveText(expanded)
    await expect(acceptButton(win)).toBeVisible()
    await expect(rejected).toBeHidden()

    // Esc rejects it from the page, and Ctrl+Y brings it back (the message goes with it).
    await expect(prose(win)).toBeFocused()
    await win.keyboard.press('Escape')
    await expect(newWords(win)).toHaveCount(0)
    await expect(rejected).toBeVisible()
    await win.keyboard.press('Control+y')
    await expect(newWords(win)).toHaveText(expanded)
    await expect(rejected).toBeHidden()

    // Ctrl+Z undoes it like any other change: it is rejected, and Ctrl+Y brings it back.
    await win.keyboard.press('Control+z')
    await expect(newWords(win)).toHaveCount(0)
    await expect(toasts(win).getByText('Change rejected. Ctrl+Y brings it back.')).toBeVisible()
    await expect(paras(win)).toHaveText(TEXT)
    await win.keyboard.press('Control+y')
    await expect(newWords(win)).toHaveText(expanded)
    await expect(toasts(win).getByRole('button', { name: 'Undo' })).toHaveCount(0)

    // Rejected for good: nothing of it was ever saved.
    await rejectButton(win).click()
    await expect(paras(win)).toHaveText(TEXT)
    await win.waitForTimeout(1200)
    expect(await savedText(win, sceneId)).toBe(TEXT.join('\n\n'))
  } finally {
    await fake.close()
  }
})

test('Rewrite with an instruction; What the AI saw shows it, and the change is still there after; Tab accepts; line breaks stay', async ({
  launch
}) => {
  const fake = await startFake()
  try {
    const { win } = await launch(QUIET)
    const { sceneId } = await setUp(win, fake)

    await selectWords(win, P1)
    await openTools(win)
    const how = tools(win).getByRole('textbox', { name: 'How to rewrite the selected words' })
    await expect(how).toBeFocused()
    await how.fill('Start with the rain')
    await how.press('Enter')
    await expect(tools(win)).toBeHidden()
    const rewritten = 'Rain hammered the shutters. The tavern was warm and loud.'
    await expect(newWords(win)).toHaveText(rewritten)
    await expect(change(win)).toContainText('Rewrite')

    // What the AI saw: the record of this change, with the instruction.
    await change(win).getByRole('button', { name: 'What the AI saw' }).click()
    await expect(win.getByRole('heading', { level: 1, name: 'What the AI saw' })).toBeVisible()
    // It is called a change, named for its tool, not a draft.
    await expect(win.getByText(/^The exact briefing for this change \(Rewrite\) to “.+”, written /)).toBeVisible()
    await expect(win.getByText('Your instruction', { exact: true })).toBeVisible()
    await expect(win.locator('main')).not.toContainText('this draft')
    await expect(win.getByText('Start with the rain', { exact: true })).toBeVisible()
    await win.getByRole('button', { name: /^Back to/ }).click()
    await expect(newWords(win)).toHaveText(rewritten)
    await expect(acceptButton(win)).toBeVisible()

    // Tab in the page accepts it.
    await caretAt(win, 1)
    await win.keyboard.press('Tab')
    await expect(change(win)).toBeHidden()
    await expect(paras(win)).toHaveText([rewritten, P2])
    await expect.poll(() => savedText(win, sceneId)).toBe([rewritten, P2].join('\n\n'))
    // Tab with no change waiting does what it always did: nothing in the text.
    await win.keyboard.press('Tab')
    await expect(paras(win)).toHaveText([rewritten, P2])

    // A line break inside a paragraph (Shift+Enter) stays a line break in the new words, and once accepted.
    await caretAt(win, 1)
    await win.keyboard.press('Enter')
    await win.keyboard.type('Roses are red,')
    await win.keyboard.press('Shift+Enter')
    await win.keyboard.type('violets are blue.')
    await selectWords(win, 'Roses are red,', 'violets are blue.')
    await openTools(win)
    await how.fill('Say it plainer')
    await how.press('Enter')
    await expect(newWords(win)).toContainText('In the end, roses are red,')
    await expect(newWords(win).locator('br')).toHaveCount(1)
    await acceptButton(win).click()
    await expect(paras(win)).toHaveCount(3)
    await expect(paras(win).nth(2).locator('br')).toHaveCount(1)
    await expect.poll(() => savedText(win, sceneId)).toBe([rewritten, P2, 'In the end, roses are red,\nviolets are blue.'].join('\n\n'))
  } finally {
    await fake.close()
  }
})

test('Alternatives: pick one, look at the others again, pick with the keyboard, then accept; italics show as italics', async ({
  launch
}) => {
  const fake = await startFake()
  try {
    const { win } = await launch(QUIET)
    const { sceneId } = await setUp(win, fake)

    await selectWords(win, P1)
    await openTools(win)
    await expect(tools(win).getByRole('button', { name: /^Alternatives/ })).toContainText('Three versions to pick from')
    await tools(win)
      .getByRole('button', { name: /^Alternatives/ })
      .click()
    await expect(tools(win)).toBeHidden()
    const V1 = 'Quietly, the tavern was warm and loud. Rain hammered the shutters.'
    const V2 = 'The tavern was warm and loud. Rain hammered the shutters, and nobody noticed.'
    const V3 = 'Even then, the tavern was warm and loud. Rain hammered the shutters.'
    await expect(change(win)).toContainText('Pick the version you like')
    await expect(versions(win)).toHaveCount(3)
    await expect(versions(win).nth(0)).toContainText(V1)
    await expect(versions(win).nth(1)).toContainText(V2)
    await expect(versions(win).nth(2)).toContainText(V3)
    // Nothing is in the page until one is picked.
    await expect(newWords(win)).toHaveCount(0)
    await expect(oldWords(win)).toHaveText(P1)

    await versions(win).nth(1).click()
    await expect(newWords(win)).toHaveText(V2)
    await expect(acceptButton(win)).toBeVisible()
    await expect(prose(win)).toBeFocused()

    // The others again; Tab in the page goes to them, and a number picks one.
    await change(win).getByRole('button', { name: 'Other versions' }).click()
    await expect(versions(win)).toHaveCount(3)
    await expect(newWords(win)).toHaveCount(0)
    await win.keyboard.press('Tab')
    await expect(versions(win).nth(0)).toBeFocused()
    await win.keyboard.press('3')
    await expect(newWords(win)).toHaveText(V3)
    await expect(prose(win)).toBeFocused()
    await win.keyboard.press('Tab')
    await expect(change(win)).toBeHidden()
    await expect(paras(win)).toHaveText([V3, P2])
    await expect.poll(() => savedText(win, sceneId)).toBe([V3, P2].join('\n\n'))
    await win.keyboard.press('Control+z')
    await expect(paras(win)).toHaveText(TEXT)

    // Italics in the words come back as italics in the versions, not as asterisks.
    await selectWords(win, 'warm')
    await win.keyboard.press('Control+i')
    await expect(prose(win).locator('p').first().locator('em')).toHaveText('warm')
    await selectWords(win, P1)
    await runTool(win, 'Alternatives')
    await expect(versions(win)).toHaveCount(3)
    for (let i = 0; i < 3; i++) {
      await expect(versions(win).nth(i).locator('em')).toHaveText('warm')
      await expect(versions(win).nth(i)).not.toContainText('*')
    }
    await versions(win).nth(0).click()
    await expect(newWords(win).locator('em')).toHaveText('warm')
    await rejectButton(win).click()
    await expect(change(win)).toBeHidden()
  } finally {
    await fake.close()
  }
})

test('Continue from the cursor writes the next paragraphs; at the start of one, the paragraphs before it; part-way through one, it carries the sentence on', async ({
  launch
}) => {
  const fake = await startFake()
  try {
    const { win } = await launch(QUIET)
    const { sceneId } = await setUp(win, fake)

    // At the end of the scene, from the command palette.
    await caretAt(win, 1)
    await win.keyboard.press('Control+k')
    await win.getByRole('combobox', { name: 'Search, or find an action' }).fill('Continue from the cursor')
    await win.getByRole('option', { name: /Continue from the cursor/ }).click()
    const next = [
      'Tobin set his cup down at last. “Then we go tonight,” he said, “before the bells finish.”',
      'Mara looked at the door, then back at him, and for the first time that evening she sat.'
    ]
    await expect(newWords(win)).toHaveText(next)
    await expect(oldWords(win)).toHaveCount(0)
    await expect(acceptButton(win)).toBeVisible()
    await expect(change(win)).toContainText('Continue')
    // Nothing is in the scene yet: the new paragraphs show inside the last one, as part of the change.
    await expect(paras(win)).toHaveCount(2)
    await expect(paras(win).nth(1).locator('.aw-sugg-new')).toHaveCount(1)
    expect(await savedText(win, sceneId)).toBe(TEXT.join('\n\n'))

    await acceptButton(win).click()
    await expect(paras(win)).toHaveText([...TEXT, ...next])
    await expect.poll(() => savedText(win, sceneId)).toBe([...TEXT, ...next].join('\n\n'))
    const ids = await paragraphIds(win)
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids).size).toBe(4)
    await win.keyboard.press('Control+z')
    await expect(paras(win)).toHaveText(TEXT)
    const twoIds = await paragraphIds(win)

    // At the start of a paragraph: the new paragraphs go ahead of it, and it stays a paragraph of its own.
    await caretAt(win, 1, 'start')
    await win.keyboard.press('Control+k')
    await win.getByRole('combobox', { name: 'Search, or find an action' }).fill('Continue from the cursor')
    await win.getByRole('option', { name: /Continue from the cursor/ }).click()
    await expect(newWords(win)).toHaveText(next)
    await expect(acceptButton(win)).toBeVisible()
    await expect(paras(win)).toHaveText(TEXT)
    expect(await savedText(win, sceneId)).toBe(TEXT.join('\n\n'))
    await acceptButton(win).click()
    await expect(change(win)).toBeHidden()
    await expect(paras(win)).toHaveCount(4)
    await expect(paras(win)).toHaveText([P1, ...next, P2])
    await expect.poll(() => savedText(win, sceneId)).toBe([P1, ...next, P2].join('\n\n'))
    const ahead = await paragraphIds(win)
    expect(ahead[0]).toBe(twoIds[0])
    expect(ahead[3]).toBe(twoIds[1])
    expect(new Set(ahead).size).toBe(4)
    await win.keyboard.press('Control+z')
    await expect(paras(win)).toHaveText(TEXT)

    // Words selected up to the start of the next paragraph (as a drag a little past them makes): it carries
    // on after the words, not at the start of the next paragraph.
    await prose(win).focus()
    await win.evaluate(`(() => {
      const ps = document.querySelectorAll('.scene-prose p')
      document.getSelection().setBaseAndExtent(ps[0].firstChild, 0, ps[1].firstChild, 0)
    })()`)
    await expect(selectionBar(win)).toBeVisible()
    await runTool(win, 'Continue after these words')
    await expect(newWords(win)).toHaveText(next)
    await acceptButton(win).click()
    await expect(paras(win)).toHaveText([P1, ...next, P2])
    await win.keyboard.press('Control+z')
    await expect(paras(win)).toHaveText(TEXT)

    // Part-way through a paragraph, from inside a word: it carries on after the whole word.
    await caretAt(win, 1)
    await win.keyboard.press('Enter')
    await win.keyboard.type('She waited')
    await win.keyboard.press('ArrowLeft')
    await win.keyboard.press('ArrowLeft')
    await expect.poll(() => win.evaluate(HEAD)).toBe('She wait'.length)
    await win.keyboard.press('Control+k')
    await win.getByRole('combobox', { name: 'Search, or find an action' }).fill('Continue from the cursor')
    await win.getByRole('option', { name: /Continue from the cursor/ }).click()
    const on = 'and then, without a word, she sat down across from him.'
    await expect(newWords(win)).toHaveText(on)
    await expect(acceptButton(win)).toBeVisible()
    await expect(paras(win).nth(2)).toHaveText(`She waited ${on}`)
    await win.keyboard.press('Escape')
    await expect(change(win)).toBeHidden()

    // Part-way through a paragraph, from the AI tools over the words before: it carries on the sentence.
    await selectWords(win, 'She waited')
    await runTool(win, 'Continue after these words')
    await expect(newWords(win)).toHaveText(on)
    await expect(oldWords(win)).toHaveCount(0)
    await expect(acceptButton(win)).toBeVisible()
    await win.keyboard.press('Tab')
    await expect(paras(win)).toHaveText([...TEXT, `She waited ${on}`])
    await expect.poll(() => savedText(win, sceneId)).toBe([...TEXT, `She waited ${on}`].join('\n\n'))
  } finally {
    await fake.close()
  }
})

test('Stop while the AI writes keeps the words that came, to accept or reject; Esc stops too, then rejects', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch(QUIET)
    const { sceneId } = await setUp(win, fake, { model: 'fake/slow' })
    const stopped = 'Stopped before the end: these are the words that came.'

    // Esc while it writes stops it; Esc again rejects what came.
    await selectWords(win, P1)
    await runTool(win, 'Expand')
    await expect(change(win)).toContainText('Expanding…')
    await expect(newWords(win)).toContainText('She let the silence')
    await expect(stopButton(win)).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(change(win)).toContainText(stopped)
    await expect(acceptButton(win)).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(change(win)).toBeHidden()
    await expect(paras(win)).toHaveText(TEXT)

    // The Stop button: the words so far stay (and no more come), and Accept puts them in.
    await selectWords(win, P1)
    await runTool(win, 'Expand')
    await expect(newWords(win)).toContainText('She let the silence stretch until the fire popped. The tavern')
    expect(await savedText(win, sceneId)).toBe(TEXT.join('\n\n'))
    await stopButton(win).click()
    await expect(change(win)).toContainText(stopped)
    const came = ((await newWords(win).textContent()) ?? '').trim()
    expect(came.startsWith(`${P1} She let the silence`)).toBe(true)
    await win.waitForTimeout(800)
    expect(((await newWords(win).textContent()) ?? '').trim()).toBe(came)
    expect(await savedText(win, sceneId)).toBe(TEXT.join('\n\n'))
    await acceptButton(win).click()
    await expect(paras(win).first()).toHaveText(came)
    await expect.poll(() => savedText(win, sceneId)).toBe([came, P2].join('\n\n'))

    // Stopped before any words came (a model that thinks first): nothing to keep, and it says so.
    const { models } = await invoke(win, 'getSettings')
    await invoke(win, 'updateSettings', { models: { writer: { ...models.writer, modelId: 'fake/wait', label: 'fake/wait' } } })
    await selectWords(win, P2)
    await runTool(win, 'Condense')
    await expect(change(win)).toContainText('Condensing…')
    await win.keyboard.press('Escape')
    await expect(toasts(win).getByText('Stopped. Nothing in the text was changed.')).toBeVisible()
    await expect(change(win)).toBeHidden()
    await expect(paras(win)).toHaveText([came, P2])
  } finally {
    await fake.close()
  }
})

test('while the AI writes, the page stays where Adam scrolls to; a message says when the change is ready, and Show it goes to it', async ({
  launch
}) => {
  const fake = await startFake()
  try {
    const { win } = await launch(QUIET)
    const filler = Array.from({ length: 24 }, (_, i) => `Filler paragraph ${i + 1}. The rain went on over the roofs of Lowtown all night.`)
    const last = 'She watched the door.'
    await setUp(win, fake, { model: 'fake/slow', text: [P1, P2, ...filler, last] })

    // The change at the end of the scene, followed into view while its words come.
    await selectWords(win, last)
    await runTool(win, 'Expand')
    await expect(newWords(win)).toContainText('She let the silence')
    await expect(stopButton(win)).toBeInViewport()

    // Adam scrolls back to the start of the scene: the page stays there, even once the change is ready.
    const box = (await prose(win).boundingBox())!
    await win.mouse.move(box.x + 100, 400)
    await win.mouse.wheel(0, -100000)
    await expect(paras(win).first()).toBeInViewport()
    await expect(acceptButton(win)).toBeVisible({ timeout: 20000 })
    await expect(toasts(win).getByText('The AI’s change is ready.')).toBeVisible()
    await expect(paras(win).first()).toBeInViewport()
    await expect(acceptButton(win)).not.toBeInViewport()

    // Show it goes to the change.
    await toasts(win).getByRole('button', { name: 'Show it' }).click()
    await expect(acceptButton(win)).toBeInViewport()
    await expect(toasts(win).getByText('The AI’s change is ready.')).toBeHidden()
    await win.keyboard.press('Escape')
    await expect(change(win)).toBeHidden()
    await expect(paras(win).last()).toHaveText(last)
  } finally {
    await fake.close()
  }
})

test('one change at a time; editing its words, opening another scene or a new draft drops it, with a word about why', async ({
  launch
}) => {
  const fake = await startFake()
  try {
    const { win } = await launch(QUIET)
    await setUp(win, fake, { secondScene: true })

    // One at a time: the tools say so while a change waits.
    await selectWords(win, P1)
    await runTool(win, 'Condense')
    await expect(acceptButton(win)).toBeVisible()
    await selectWords(win, P2)
    // The bar over the words below the change keeps clear of its buttons, which still take a click.
    const bar = (await selectionBar(win).boundingBox())!
    const buttons = (await change(win).boundingBox())!
    expect(bar.y >= buttons.y + buttons.height || bar.y + bar.height <= buttons.y).toBe(true)
    await acceptButton(win).click({ trial: true, timeout: 2000 })
    await openTools(win)
    await expect(tools(win)).toContainText('Accept or reject the AI’s waiting change first.')
    await expect(tools(win).getByRole('button', { name: /^Expand/ })).toBeDisabled()
    await win.keyboard.press('Escape')
    await expect(tools(win)).toBeHidden()
    await expect(acceptButton(win)).toBeVisible()

    // Editing the words under it drops it.
    await oldWords(win).click({ position: { x: 12, y: 6 } })
    await win.keyboard.type('x')
    await expect(toasts(win).getByText('The words under the AI’s change were edited, so the change was dropped.')).toBeVisible()
    await expect(change(win)).toBeHidden()
    await expect(oldWords(win)).toHaveCount(0)
    await win.keyboard.press('Control+z')
    await expect(paras(win)).toHaveText(TEXT)

    // Opening another scene drops it.
    await selectWords(win, P2)
    await runTool(win, 'More vivid')
    await expect(acceptButton(win)).toBeVisible()
    await row(win, 'Scene 2').click()
    await expect(toasts(win).getByText('The AI’s change was dropped because you opened another scene.')).toBeVisible()
    await row(win, 'Scene 1').click()
    await expect(paras(win)).toHaveText(TEXT)
    await expect(newWords(win)).toHaveCount(0)
    await expect(change(win)).toBeHidden()

    // A new draft starting drops it.
    await selectWords(win, P2)
    await runTool(win, 'More vivid')
    await expect(acceptButton(win)).toBeVisible()
    await win.locator('main header').getByRole('button', { name: 'Generate', exact: true }).click()
    await win.getByRole('button', { name: 'Add below', exact: true }).click()
    await expect(toasts(win).getByText('A new draft started, so the AI’s change was dropped.')).toBeVisible()
    await expect(change(win)).toBeHidden()
    await expect(newWords(win)).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

test('Fix voice matches a speaker’s voice, says whose, and says plainly what to do when a speaker has no voice yet', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch(QUIET)
    const said = '“I don’t think we should go tonight,” said Mara.'
    const answered = '“We go now,” said Tobin.'
    const { storyId } = await setUp(win, fake, { text: [said, answered] })
    await invoke(win, 'createEntry', 'character', {
      name: 'Mara Venn',
      aliases: ['Mara'],
      summary: 'A smith’s daughter who keeps her own counsel.',
      fields: { speech: 'Short and plain', sampleLines: '"Aye, I heard you."\n"Leave it."' },
      originStoryId: storyId
    })
    await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'The ferryman.', originStoryId: storyId })

    await selectWords(win, said)
    await runTool(win, 'Fix voice')
    await expect(newWords(win)).toHaveText('“Aye, I heard you.” said Mara.')
    await expect(change(win)).toContainText('Matching the voice of Mara Venn.')
    await rejectButton(win).click()

    // Tobin has no voice to match: nothing is sent, and the message opens his page.
    await selectWords(win, answered)
    await runTool(win, 'Fix voice')
    await expect(
      toasts(win).getByText(
        'Tobin has no voice profile yet. Add how they speak or a few sample lines under Voice on Tobin’s page, then try Fix voice again.'
      )
    ).toBeVisible()
    await expect(change(win)).toBeHidden()
    await toasts(win).getByRole('button', { name: 'Open Tobin' }).click()
    await expect(win.locator('main').getByRole('textbox', { name: 'Name' })).toHaveValue('Tobin')
    // His page opens at Voice, where how he speaks goes.
    await expect(win.locator('main').getByLabel('How they speak')).toBeInViewport()
  } finally {
    await fake.close()
  }
})

test('with no writer model, the tools say where to choose one', async ({ launch }) => {
  const { win } = await launch(QUIET)
  await setUp(win, null)
  await selectWords(win, P1)
  await runTool(win, 'Condense')
  await expect(toasts(win).getByText('Choose a writer model first, in Settings › Models.')).toBeVisible()
  await expect(change(win)).toBeHidden()
  await expect(prose(win).locator('.aw-sugg-target')).toHaveCount(0)
  await toasts(win).getByRole('button', { name: 'Open Settings' }).click()
  await expect(win.getByRole('heading', { level: 1, name: 'Models' })).toBeVisible()
})
