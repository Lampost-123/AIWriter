// End-to-end check of the model connection and drafting, in the real built app,
// against the fake provider. Takes screenshots of every drafting screen in
// light and dark themes.
//
//   npm run build            (or, before the editor is merged, the harness build:
//                             npx electron-vite build --config tests/fake-provider/harness/harness.config.mjs)
//   xvfb-run -a -s "-screen 0 1440x900x24" node tests/fake-provider/e2e-ai.mjs /tmp/shots
//
// It drives Settings > Models through the interface, sets up a world through
// the API, presses Generate, stops a draft, and opens "What the AI saw".
import { _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeProvider } from './server.mjs'

const shots = process.argv[2] ?? join(tmpdir(), 'aiwrite-shots')
mkdirSync(shots, { recursive: true })
const dir = mkdtempSync(join(tmpdir(), 'aiwrite-ai-'))
const fake = await startFakeProvider({ delayMs: 25, words: 260, slowWords: 3000, slowDelayMs: 30 })

const failures = []
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

const app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, AIWRITE_DATA_DIR: dir } })
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log('pageerror:', e.message))
win.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()))

const invoke = async (method, ...args) => {
  const res = await win.evaluate(([m, a]) => window.aiwrite.invoke(m, ...a), [method, args])
  if (!res.ok) throw new Error(`${method}: ${res.error.message}`)
  return res.value
}
const shot = async (name) => {
  await win.waitForTimeout(350)
  await win.screenshot({ path: join(shots, `${name}.png`) })
}
const theme = async (t) => {
  await invoke('updateSettings', { theme: t })
  await win.evaluate((t) => (document.documentElement.dataset.theme = t), t)
}

try {
  // ----- A world -----
  await win.waitForSelector('text=Create a world', { timeout: 15000 })
  await win.fill('input', 'The Northern Reaches')
  await win.click('button:has-text("Create world")')
  await win.waitForTimeout(800)

  // ----- Settings > Models, through the interface -----
  await win.click('button[aria-label="Settings"]')
  await win.waitForSelector('text=Writer model')
  await shot('01-models-empty-light')
  await theme('dark')
  await shot('02-models-empty-dark')
  await theme('light')

  await win.click('button:has-text("Add another provider")')
  await win.click('button:has-text("LM Studio")')
  await shot('03-add-provider-form')
  await win.fill('input[placeholder="LM Studio"]', 'Fake Studio')
  await win.fill('input[placeholder="https://api.example.com/v1"]', fake.url)
  await win.click('button:has-text("Add provider")')
  await win.waitForSelector('text=/Connected to Fake Studio/', { timeout: 10000 })
  check(true, 'custom provider added and tested')
  await win.waitForSelector('button[role="option"]:has-text("fake/writer")', { timeout: 10000 })
  await shot('04-provider-added-picker')
  await win.fill('input[aria-label="Search models"]', 'my-own-model')
  await win.waitForSelector('button:has-text("as the model name")')
  await shot('05a-picker-typed-name')
  await win.fill('input[aria-label="Search models"]', 'writ')
  await shot('05-picker-filtered')
  check((await win.locator('button:has-text("as the model name")').count()) === 0, 'typed-name row hidden when models match')
  await win.click('button[role="option"]:has-text("fake/writer")')
  await win.waitForSelector('text=Test this model')
  await win.click('button:has-text("Test this model")')
  await win.waitForSelector('text=/The model answered in/', { timeout: 10000 })
  check(true, 'writer model chosen and tested')
  await shot('06-writer-chosen-light')
  await theme('dark')
  await shot('07-writer-chosen-dark')
  await win.mouse.move(900, 600)
  await win.mouse.wheel(0, 2000)
  await shot('07b-settings-bottom-dark')
  await theme('light')
  await shot('07c-settings-bottom-light')

  const settings = await invoke('getSettings')
  check(settings.models.writer?.modelId === 'fake/writer' && settings.models.writer.contextLength === 32000, 'writer saved with its context length')
  check(!JSON.stringify(settings).includes('sk-'), 'no key in settings')

  // A bad address explains itself.
  const bad = await invoke('saveProvider', { kind: 'custom', name: 'Nowhere', baseUrl: 'http://127.0.0.1:1/v1' })
  const badTest = await invoke('testProvider', bad.id)
  check(!badTest.ok && /Couldn't reach Nowhere/.test(badTest.message), `bad address: ${badTest.message}`)
  await invoke('deleteProvider', bad.id)

  // Removing a provider can be undone from the toast, key included.
  const keyed = await invoke('saveProvider', { kind: 'custom', name: 'Keyed', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-123' })
  await invoke('deleteProvider', keyed.id)
  const gone = !(await invoke('listProviders')).some((p) => p.id === keyed.id)
  const back = await invoke('restoreProvider', keyed.id)
  const listed = await invoke('listProviders')
  check(gone && back.hasKey && listed.some((p) => p.id === keyed.id && p.hasKey), 'a removed provider comes back with its key (Undo)')
  await invoke('deleteProvider', keyed.id)

  // ----- A scene card with a character and a place (through the API) -----
  const stories = await invoke('listStories')
  const outline = await invoke('getOutline', stories[0].id)
  const first = outline.scenes[0]
  await invoke('saveSceneText', first.id, null, 'She left the docks at dusk, the rain at her back.\n\nThe Narrows were quiet.')
  const second = await invoke('createScene', outline.chapters[0].id, { title: 'The knock at the door' })
  const mara = await invoke('createEntry', 'character', {
    name: 'Mara Venn',
    aliases: ['the Heir'],
    summary: 'A disgraced heir turned smuggler.',
    description: 'Lost her left hand in the siege of Varn.',
    notes: 'PRIVATE: maybe she dies in book 4',
    fields: { pronouns: 'she/her', speech: 'Short, dry sentences.', sampleLines: '"Don\'t."\n"I\'ve had worse."' }
  })
  const tobin = await invoke('createEntry', 'character', { name: 'Tobin', summary: 'A ferryman who owes Mara.', fields: { speech: 'Rambling and warm.' } })
  const varn = await invoke('createEntry', 'place', { name: 'Varn', summary: 'The river capital.' })
  const eel = await invoke('createEntry', 'place', { name: 'The Gilded Eel', summary: 'A smoky tavern in Varn.', parentId: varn.id, fields: { atmosphere: 'Smoke and wet wool.' } })
  await invoke('createEntry', 'lore', { name: 'The Binding', summary: 'Spoken oaths bind.', hardRule: true, fields: { rules: 'A broken oath burns the one who breaks it.' } })
  await invoke('createEntry', 'character', { name: 'The Duke', summary: 'Rules Varn.' })
  const scene = await invoke('getScene', second.id)
  await invoke('updateSceneCard', second.id, {
    ...scene.card,
    povId: mara.id,
    presentIds: [mara.id, tobin.id],
    locationId: eel.id,
    when: 'Day 12, dusk',
    beats: ['Mara reaches the Gilded Eel', 'Tobin offers passage but wants a favour', 'She agrees; someone knocks'],
    goal: 'Get passage out of Varn',
    mood: 'Tense',
    targetWords: 400,
    notes: 'Keep the hand subtle. The Duke must not appear.'
  })
  await invoke('updateSettings', { lastStoryId: stories[0].id, lastSceneId: second.id })
  await win.reload()
  await win.waitForSelector('button:has-text("Generate")', { timeout: 15000 })
  await win.waitForTimeout(900)
  await shot('08-scene-header-idle')
  await win.screenshot({ path: join(shots, '08b-header-zoom.png'), clip: { x: 640, y: 44, width: 470, height: 50 } })
  const caretWidth = await win.evaluate(() => document.querySelector('[aria-label="Draft options"] svg')?.getBoundingClientRect().width ?? 0)
  check(caretWidth >= 12, 'draft options arrow is visible')

  // ----- Draft options -----
  await win.click('button[aria-label="Draft options"]')
  await win.waitForSelector('text=Draft options')
  await win.fill('textarea', 'Make it tense, end on the knock at the door')
  await shot('09-draft-options-light')
  await theme('dark')
  await shot('10-draft-options-dark')
  await theme('light')
  await win.keyboard.press('Escape')

  // ----- Generate -----
  // Built with the harness config, the scene view is a stand-in that records the editor bridge calls.
  const harness = (await win.locator('[data-testid="page"]').count()) > 0
  await win.evaluate(() => (window.__streamEvents = []))
  await win.click('button:has-text("Generate")')
  await win.waitForSelector('text=Writing…', { timeout: 5000 })
  await win.waitForTimeout(500)
  await shot('11-streaming')
  await win.screenshot({ path: join(shots, '11b-streaming-zoom.png'), clip: { x: 640, y: 44, width: 470, height: 50 } })
  await win.waitForSelector('button:has-text("Generate")', { timeout: 20000 })
  if (harness) {
    // The stand-in editor records each bridge call.
    const events = await win.evaluate(() => window.__streamEvents)
    const appended = events.filter((e) => e.type === 'append')
    check(events[0]?.type === 'begin' && events.at(-1)?.type === 'end', 'editor bridge: begin, append..., end')
    check(appended.length > 3 && appended.length < 120, `text arrived in batches (${appended.length} batches)`)
    const page = await win.textContent('[data-testid="page"]')
    check(page.includes('The rain had not let up'), 'draft text is on the page')
  } else {
    // The real editor saves the scene on its own; give it a moment.
    let saved = ''
    for (let i = 0; i < 20 && !saved.includes('The rain had not let up'); i++) {
      await win.waitForTimeout(250)
      saved = (await invoke('getScene', second.id)).text
    }
    check(saved.includes('The rain had not let up'), 'draft text is in the scene')
  }
  await shot('12-after-draft')

  const sent = fake.lastRequest().body
  const sentText = JSON.stringify(sent.messages)
  check(sent.messages[0].role === 'system' && sent.messages[1].role === 'user', 'system + user messages')
  check(sentText.includes('Mara Venn') && sentText.includes('Tobin') && sentText.includes('The Gilded Eel') && sentText.includes('Varn'), 'card entries in the briefing')
  check(sentText.includes('The Binding'), 'hard-rule lore in the briefing')
  check(sentText.includes('The Duke'), 'mentioned entry in the briefing')
  check(sentText.includes('She left the docks at dusk'), 'previous scene in the briefing')
  check(sentText.includes('Make it tense, end on the knock at the door'), 'direction in the briefing')
  check(!sentText.includes('PRIVATE'), 'private notes never sent')
  check(sent.temperature === 0.85 && sent.stream === true, 'creativity and streaming')

  // ----- Stop -----
  await invoke('updateSettings', { models: { writer: { ...settings.models.writer, modelId: 'fake/slow', label: 'Fake: Slow' } } })
  await win.reload()
  await win.waitForSelector('button:has-text("Generate")', { timeout: 15000 })
  await win.waitForTimeout(600)
  await win.click('button:has-text("Generate")')
  await win.waitForSelector('text=Writing…')
  await win.click('button[role="tab"]:has-text("Drafts")')
  await win.waitForTimeout(2000)
  await shot('12b-drafts-while-writing')
  const liveWords = await win.evaluate(() => /([1-9][\d,]*) words/.test([...document.querySelectorAll('li > button')].find((b) => b.disabled)?.textContent ?? ''))
  check(liveWords, 'its word count catches up while it is written')
  const liveRowDisabled = await win.evaluate(() => [...document.querySelectorAll('li > button')].some((b) => b.disabled && b.textContent.includes('Writing')))
  check(liveRowDisabled, 'the draft being written is listed and cannot be opened yet')
  await win.keyboard.press('Escape')
  await win.waitForSelector('button:has-text("Generate")', { timeout: 10000 })
  const afterStop = await invoke('listGenerations', second.id)
  check(afterStop[0].status === 'stopped' && afterStop[0].words > 10 && afterStop[0].words < 3000, `Esc stops and keeps the text (${afterStop[0].words} words)`)

  // ----- Drafts tab -----
  await win.click('button[role="tab"]:has-text("Drafts")')
  await win.waitForSelector('text=What the AI saw')
  await shot('13-drafts-light')
  await theme('dark')
  await shot('14-drafts-dark')
  await theme('light')

  // ----- What the AI saw -----
  await win.click('li:nth-child(2) button')
  await win.waitForSelector('h1:has-text("What the AI saw")')
  await shot('15-what-the-ai-saw-top')
  await win.click('button:has-text("Point-of-view character")')
  await win.click('button:has-text("Setting and world rules")')
  await win.waitForTimeout(200)
  await win.evaluate(() => document.querySelector('h1').closest('.overflow-auto').scrollBy(0, 520))
  await shot('16-what-the-ai-saw-blocks')
  await theme('dark')
  await shot('17-what-the-ai-saw-dark')
  await theme('light')
  await win.click('button[role="switch"]')
  await win.waitForTimeout(200)
  await shot('18-exact-messages')
  await win.evaluate(() => document.querySelector('h1').closest('.overflow-auto').scrollTo(0, 99999))
  await shot('19-response')
  await win.click('button[role="switch"]')
  // An entry link opens the entry.
  await win.evaluate(() => document.querySelector('h1').closest('.overflow-auto').scrollTo(0, 0))
  await win.click('button:has-text("Back to")')
  await win.waitForSelector('button:has-text("Generate")')
  check(true, 'back to the scene')

  // ----- Errors in plain words -----
  await invoke('updateSettings', { models: { writer: { ...settings.models.writer, modelId: 'fake/credit', label: 'Fake: Out of credit' } } })
  await win.reload()
  await win.waitForSelector('button:has-text("Generate")', { timeout: 15000 })
  await win.waitForTimeout(600)
  await win.click('button:has-text("Generate")')
  await win.waitForSelector('text=/out of credit/', { timeout: 10000 })
  await shot('20-error-toast')
  check(true, 'credit error shown in plain words')

  // ----- No writer model -----
  await invoke('updateSettings', { models: { writer: null } })
  await win.reload()
  await win.waitForSelector('button:has-text("Generate")', { timeout: 15000 })
  await win.waitForTimeout(600)
  await win.click('button:has-text("Generate")')
  await win.waitForSelector('text=Choose a writer model first')
  await shot('21-no-writer-model')
  await theme('dark')
  await shot('22-no-writer-model-dark')
} catch (e) {
  failures.push(String(e))
  console.log('ERROR', e)
  await win.screenshot({ path: join(shots, 'zz-failure.png') }).catch(() => undefined)
} finally {
  await app.close()
  await fake.close()
}

console.log(failures.length ? `\n${failures.length} problem(s)` : '\nall good', '\nshots in', shots)
process.exit(failures.length ? 1 : 0)
