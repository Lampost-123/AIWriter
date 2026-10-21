// "Keep this, change that" (Change it…, 2026-10-19): the change box on selected words and on the draft just written,
// sentences clicked to keep word for word, a note, and the passage back as a tracked change of only what moved, with
// Accept, Reject and Change again. Against the fake AI server, whose Change it… keeps the kept sentences and starts every
// other one "Now " (tests/fake-provider/m4/edits.mjs; "ignore the keeps" in the note changes those too).
import type { Page } from '@playwright/test'
import type { FakeProvider } from '../fake-provider/server.mjs'
import { createWorldFromWelcome, expect, invoke, startFake, test } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const paras = (win: Page) => prose(win).locator('p')
const selectionBar = (win: Page) => win.getByRole('toolbar', { name: 'Selected words' })
const tools = (win: Page) => win.locator('[data-ai-tools]')
const box = (win: Page) => win.getByRole('dialog', { name: 'Change it' })
const sentence = (win: Page, text: string) => box(win).getByRole('checkbox', { name: `Keep: ${text}` })
const note = (win: Page) => box(win).getByRole('textbox', { name: 'What to change' })
const change = (win: Page) => win.getByRole('group', { name: 'The AI’s change' })
const acceptButton = (win: Page) => change(win).getByRole('button', { name: /^Accept/ })
const justWritten = (win: Page) => win.getByRole('group', { name: 'The draft just written' })
const added = (win: Page) => prose(win).locator('.aw-diff-ins')
const cut = (win: Page) => prose(win).locator('.aw-diff-del')

const savedText = async (win: Page, sceneId: string): Promise<string> => (await invoke(win, 'getScene', sceneId)).text
/** The record of the change waiting in the page (What the AI saw opens it), read from the page's editor. */
async function waitingRecord(win: Page) {
  const read = (): Promise<string | null> => win.evaluate(WAITING_ID) as Promise<string | null>
  await expect.poll(read).not.toBeNull()
  return invoke(win, 'getGeneration', (await read())!)
}

/** The waiting change's record id, from the page's editor (run in the window, as text). */
const WAITING_ID = `(() => {
  const ed = document.querySelector('.scene-prose').editor
  const plugin = ed.state.plugins.find((x) => x.key.startsWith('aiwriteSuggestions'))
  return plugin?.getState(ed.state)?.active?.generationId ?? null
})()`

const P1 = 'The tavern was warm and loud. Rain hammered the shutters.'
const P2 = 'Mara pushed through the crowd to the back table.'

/** The memory waits long after any change, so the only AI calls are the ones each test makes. */
const QUIET = { env: { AIWRITE_KEEPER_QUIET_MS: '600000' } }

async function setUp(win: Page, fake: FakeProvider, text: string[] | null): Promise<string> {
  await createWorldFromWelcome(win, 'Alpha')
  const [story] = await invoke(win, 'listStories')
  const { scenes } = await invoke(win, 'getOutline', story.id)
  const sceneId = scenes[0].id
  const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
  await invoke(win, 'updateSettings', {
    models: { writer: { providerId: p.id, modelId: 'fake/writer', label: 'fake/writer', contextLength: 32000, promptPrice: null, completionPrice: null } }
  })
  if (text) await invoke(win, 'saveSceneText', sceneId, null, text.join('\n\n'))
  await win.reload()
  if (text) await expect(paras(win)).toHaveText(text)
  else await expect(prose(win)).toBeVisible()
  return sceneId
}

/**
 * Sets the window's selection from the start of words `a` to the end of words `b` in the page. Run in the window, as
 * text (as edits.spec.ts does).
 */
const SELECT = `(a, b) => {
  const el = document.querySelector('.scene-prose')
  const texts = []
  let all = ''
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    texts.push({ node, start: all.length })
    all += node.data
  }
  const from = all.indexOf(a)
  const end = all.indexOf(b, from) + b.length
  const at = (o, isEnd) => {
    const t = texts.find((x) => (isEnd ? o > x.start && o <= x.start + x.node.data.length : o >= x.start && o < x.start + x.node.data.length))
    return [t.node, o - t.start]
  }
  const [n1, o1] = at(from, false)
  const [n2, o2] = at(end, true)
  document.getSelection().setBaseAndExtent(n1, o1, n2, o2)
}`

/** Selects the words of the page from the start of `first` to the end of `last`, and waits for the bar over them. */
async function selectWords(win: Page, first: string, last = first): Promise<void> {
  await prose(win).focus()
  await expect(async () => {
    await win.evaluate(`(${SELECT})(${JSON.stringify(first)}, ${JSON.stringify(last)})`)
    await expect(selectionBar(win)).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
}

test('Change it… on selected words: sentences kept word for word, a note, only what moved marked, Change again, Accept', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch(QUIET)
    const sceneId = await setUp(win, fake, [P1, P2])

    // The AI tools' Change it… opens the change box on the selected words.
    await selectWords(win, P1)
    await selectionBar(win).getByRole('button', { name: 'Rewrite', exact: true }).click()
    await expect(tools(win)).toBeVisible()
    await tools(win).getByRole('button', { name: /^Change it…/ }).click()
    await expect(box(win)).toBeVisible()
    await expect(box(win)).toContainText('The selected words')
    await expect(note(win)).toBeFocused()
    // Each sentence can be kept; Change it waits for a note.
    await expect(sentence(win, 'The tavern was warm and loud.')).toHaveAttribute('aria-checked', 'false')
    await sentence(win, 'Rain hammered the shutters.').click()
    await expect(sentence(win, 'Rain hammered the shutters.')).toHaveAttribute('aria-checked', 'true')
    await expect(box(win)).toContainText('1 kept')
    await expect(box(win).getByRole('button', { name: /^Change it/ })).toBeDisabled()
    await note(win).fill('Make it tenser')
    await win.keyboard.press('Enter')
    await expect(box(win)).toBeHidden()

    // Back as a tracked change of only what moved: the first word cut, "Now the" added, the kept sentence as it was.
    await expect(acceptButton(win)).toBeVisible()
    await expect(added(win)).toHaveText(['Now the'])
    await expect(cut(win)).toHaveText(['The'])
    await expect(prose(win).locator('.aw-sugg-diff')).toContainText('Now the tavern was warm and loud. Rain hammered the shutters.')
    await expect(change(win)).toContainText('The sentence you marked Keep is word for word.')
    // The page itself hasn't changed yet.
    expect(await savedText(win, sceneId)).toBe([P1, P2].join('\n\n'))
    // What was sent: the passage as it was, the note, and the kept sentence.
    const sent = await waitingRecord(win)
    expect(sent.params.tool).toBe('revise')
    expect(sent.direction).toBe('Make it tenser')
    expect(sent.blocks.find((b) => b.id === 'selection')?.text).toContain(P1)
    expect(sent.blocks.find((b) => b.id === 'keep')?.text).toContain('- Rain hammered the shutters.')

    // Change again: the box on the new version, the kept sentence still kept. A model that changes it anyway: it's put back.
    await change(win).getByRole('button', { name: 'Change again…' }).click()
    await expect(box(win)).toContainText('The new version')
    await expect(sentence(win, 'Rain hammered the shutters.')).toHaveAttribute('aria-checked', 'true')
    await note(win).fill('Darker, and ignore the keeps')
    await win.keyboard.press('Enter')
    await expect(change(win)).toContainText('The AI changed a sentence you marked Keep, so it was put back word for word.')
    await expect(prose(win).locator('.aw-sugg-diff')).toContainText('Now now the tavern was warm and loud. Rain hammered the shutters.')

    // Accept: the new words go in, the kept sentence word for word.
    await acceptButton(win).click()
    await expect(change(win)).toBeHidden()
    await expect(paras(win)).toHaveText(['Now now the tavern was warm and loud. Rain hammered the shutters.', P2])
    await expect.poll(() => savedText(win, sceneId)).toBe(['Now now the tavern was warm and loud. Rain hammered the shutters.', P2].join('\n\n'))
    // One Ctrl+Z puts the words back as they were.
    await win.keyboard.press('Control+z')
    await expect(paras(win)).toHaveText([P1, P2])
  } finally {
    await fake.close()
  }
})

test('Change it… on the draft just written: the row under the draft, the box on all of it, Esc closes, Reject keeps the draft', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch(QUIET)
    const sceneId = await setUp(win, fake, null)

    // A draft into the empty scene: the row under it says so, with Change it…, What the AI saw and Undo.
    await win.locator('main header').getByRole('button', { name: 'Draft the scene', exact: true }).click()
    await expect(justWritten(win)).toBeVisible({ timeout: 30_000 })
    await expect(justWritten(win)).toContainText('Draft written')
    await expect(justWritten(win).getByRole('button', { name: 'What the AI saw' })).toBeVisible()
    await expect(justWritten(win).getByRole('button', { name: 'Undo' })).toBeVisible()
    const draft = await savedText(win, sceneId)
    expect(draft.length).toBeGreaterThan(50)

    // Change it… opens the box on the whole draft; Esc closes it and nothing is sent.
    await justWritten(win).getByRole('button', { name: 'Change it…' }).click()
    await expect(box(win)).toContainText('The draft just written')
    await expect(note(win)).toBeFocused()
    await win.keyboard.press('Escape')
    await expect(box(win)).toBeHidden()
    await expect(change(win)).toHaveCount(0)
    await expect(justWritten(win)).toBeVisible()

    // Again, with a note: the whole draft revised, only what moved marked.
    await justWritten(win).getByRole('button', { name: 'Change it…' }).click()
    await note(win).fill('Closer, but shorter')
    await box(win).getByRole('button', { name: /^Change it/ }).click()
    await expect(acceptButton(win)).toBeVisible()
    await expect(justWritten(win)).toBeHidden()
    await expect(added(win).first()).toContainText('Now')
    const sent = await waitingRecord(win)
    expect(sent.params.tool).toBe('revise')
    expect(sent.direction).toBe('Closer, but shorter')
    expect(sent.blocks.find((b) => b.id === 'selection')?.text).toContain(draft.split('\n\n')[0])

    // Reject: the draft stays as it was written.
    await change(win).getByRole('button', { name: /^Reject/ }).click()
    await expect(change(win)).toBeHidden()
    expect(await savedText(win, sceneId)).toBe(draft)
  } finally {
    await fake.close()
  }
})
