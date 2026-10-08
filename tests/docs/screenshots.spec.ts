// Screenshots for the README and the user guide, saved to docs/images/.
//
//   npm run docs:screenshots                       builds the app, then takes every shot
//   DOCS_SHOTS=hero,ask npm run docs:screenshots   only those (names without .png)
//   DOCS_THEME=light npm run docs:screenshots      another theme (dark, light or sepia)
//
// Every shot is in the Dark theme by default (Settings › Appearance › Theme, set in the app's own settings), Classic
// and the start screen included, and so is the social preview card (social-preview.png, 1280 x 640).
//
// Not part of the app tests or CI: it has its own config (tests/docs/playwright.config.ts) and the main
// playwright.config.ts only looks in tests/e2e. Everything is invented and nothing costs anything:
//  - the app runs on its own temp data folder (AIWRITE_DATA_DIR), never anyone's real worlds or settings;
//  - the world is the built-in sample, Gullhaven, renamed "Gullhaven" so it reads as a world of one's own (the
//    start screen shot keeps the sample as it comes, beside a made-up world, "The Salt Road");
//  - AI text comes from a stand-in server (tests/docs/provider.ts), shown as LM Studio on localhost:1234, with text
//    from content.ts;
//  - read aloud uses the tests' fake speech server; no models are downloaded;
//  - portraits are painted in the window (portraits.ts).
// Each picture is shrunk to 1440 wide with Electron's own image tools and saved as soon as it is taken.
import Database from 'better-sqlite3'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeWindow, expect, invoke, launchApp, newDataDir, ROOT, type LaunchedApp } from '../e2e/helpers'
import { test } from '@playwright/test'
import { startDocsProvider, type ChatRequest, type DocsProvider, type Reply } from './provider'
import { ASK_ANSWER, ASK_QUESTION, LAMP_RECALL, LOW_TIDE_MORE, LOW_TIDE_VARIANTS, outlineReply, SALT_ROAD } from './content'
import { LOOKS, paintPortrait } from './portraits'
import { encodePng } from './png'
import { socialPage } from './social'

/** The window's size, in the page's own pixels; each picture is shrunk to OUT_WIDTH. */
const WIDTH = Number(process.env.DOCS_WIDTH ?? 1600)
const HEIGHT = Math.round((WIDTH * 10) / 16)
const OUT_WIDTH = 1440
/** Settings › Appearance › Theme for every shot (the owner's choice, 2026-10-08): Dark, unless DOCS_THEME says otherwise. */
const THEME = (process.env.DOCS_THEME ?? 'dark') as 'dark' | 'light' | 'sepia'
const IMAGES = join(ROOT, 'docs', 'images')
/** Above this, a picture is saved with a palette of 256 colours instead. */
const MAX_BYTES = 400 * 1024

const wanted = (process.env.DOCS_SHOTS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const want = (name: string): boolean => !wanted.length || wanted.includes(name)

const ENV = {
  AIWRITE_LOOK: 'new',
  // The memory doesn't read on its own while the shots are taken, and no check runs after a draft.
  AIWRITE_KEEPER_QUIET_MS: '600000',
  AIWRITE_AFTER_DRAFT_MS: '600000'
}

const rail = (win: Page) => win.getByRole('navigation', { name: 'Areas' })
const area = (win: Page, name: string) => rail(win).getByRole('button', { name, exact: true })
const list = (win: Page) => win.locator('[data-area-list]')
const main = (win: Page) => win.locator('main')
const prose = (win: Page) => win.locator('.scene-prose')
const scenePanel = (win: Page) => win.getByRole('complementary', { name: 'Scene panel' })
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')

async function sizeWindow(app: ElectronApplication, win: Page): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [WIDTH, HEIGHT])
  await win.waitForLoadState('domcontentloaded')
  await expect.poll(() => win.evaluate('[innerWidth, innerHeight]').catch(() => null)).toEqual([WIDTH, HEIGHT])
}

/** Fonts loaded, animations over, the pointer somewhere harmless, toasts gone. */
async function settle(win: Page, ms = 900): Promise<void> {
  await dismissToasts(win)
  await win.evaluate('document.fonts.ready.then(() => true)')
  await win.mouse.move(WIDTH - 4, HEIGHT - 4)
  await win.waitForTimeout(ms)
}

async function dismissToasts(win: Page): Promise<void> {
  for (const b of await toasts(win).getByRole('button', { name: 'Dismiss' }).all()) await b.click().catch(() => undefined)
}

/** Shrinks a screenshot to OUT_WIDTH (Electron's own image tools) and saves it as a small PNG. */
async function save(app: ElectronApplication, png: Buffer, name: string): Promise<void> {
  const small = await app.evaluate(({ nativeImage }, [b64, width]) => {
    const img = nativeImage.createFromBuffer(Buffer.from(b64 as string, 'base64')).resize({ width: width as number, quality: 'best' })
    const size = img.getSize()
    return { bitmap: img.toBitmap().toString('base64'), width: size.width, height: size.height }
  }, [png.toString('base64'), OUT_WIDTH] as [string, number])
  mkdirSync(IMAGES, { recursive: true })
  const bitmap = Buffer.from(small.bitmap, 'base64')
  let out = encodePng(bitmap, small.width, small.height)
  if (out.length > MAX_BYTES) out = encodePng(bitmap, small.width, small.height, { colours: 256 })
  writeFileSync(join(IMAGES, `${name}.png`), out)
  console.log(`saved ${name}.png (${Math.round(out.length / 1024)} KB)`)
}

/** Takes the window once it has settled, and saves it at once. */
async function shot(app: ElectronApplication, win: Page, name: string): Promise<void> {
  await settle(win)
  await save(app, await win.screenshot(), name)
}

/** Runs one shot; a failure is reported and the next shot goes on. */
const failed: string[] = []
/** The temp data folders made, removed at the end. */
const made: string[] = []
async function take(name: string, fn: () => Promise<void>): Promise<void> {
  if (!want(name)) return
  try {
    await fn()
  } catch (e) {
    failed.push(name)
    console.log(`FAILED ${name}: ${e instanceof Error ? e.message.split('\n')[0] : e}`)
  }
}

/** True while Continue's words should stop part-way, for the mid-stream shot. */
let holdContinue = false
/** Drafts asked for so far. */
let drafts = 0

/** What the stand-in server says to the requests the shots show (anything else: the test fake's reply). */
function router(r: ChatRequest): Reply {
  if (r.system.startsWith('[AIWRITE-EDIT v1] continue')) return holdContinue ? { text: LOW_TIDE_MORE, holdAfter: 50 } : LOW_TIDE_MORE
  if (r.system.startsWith('[AIWRITE-CONTINUITY v3]'))
    return r.all.includes('A hundred and twelve steps to the lamp room') ? LAMP_RECALL : '{"characters": []}'
  if (r.system.startsWith('[AIWRITE-ASK v1] answer')) return ASK_ANSWER
  if (r.system.startsWith('[AIWRITE-OUTLINE v1] outline')) return outlineReply(r.all)
  // A draft (Generate, Add below, Variants) has no marker; each in turn gets the next of three.
  if (!r.system.startsWith('[AIWRITE-') && !r.body.tools) return LOW_TIDE_VARIANTS[drafts++ % LOW_TIDE_VARIANTS.length]
  return null
}

/** The stand-in server as every job's model: a local LM Studio with two models it could run. */
async function connect(win: Page, ai: DocsProvider): Promise<void> {
  const p = await invoke(win, 'saveProvider', { name: 'LM Studio', kind: 'custom', baseUrl: ai.url, apiKey: '' })
  const choice = (modelId: string, label: string, contextLength: number) => ({
    providerId: p.id,
    modelId,
    label,
    contextLength,
    promptPrice: null,
    completionPrice: null
  })
  const writer = choice('mistralai/mistral-small-3.2-24b-instruct', 'Mistral Small 3.2 24B', 131072)
  const memory = choice('qwen/qwen3-235b-a22b-2507', 'Qwen3 235B A22B', 262144)
  await invoke(win, 'updateSettings', {
    models: { writer, memory, chat: writer, builder: writer, speech: memory, world: writer, check: memory, recipe: writer }
  })
}

const scene = async (win: Page, title: string): Promise<string> => {
  const [story] = await invoke(win, 'listStories')
  const s = (await invoke(win, 'getOutline', story.id)).scenes.find((x) => x.title === title)
  if (!s) throw new Error(`No scene "${title}"`)
  return s.id
}

/** Opens a scene in the Write area from its list. */
async function openScene(win: Page, title: string): Promise<void> {
  if ((await area(win, 'Write').getAttribute('aria-current')) !== 'page') await area(win, 'Write').click()
  await list(win).getByRole('treeitem', { name: new RegExp(title) }).click()
  await expect(win.locator('[data-page-title]')).toContainText(title)
  await expect(prose(win)).toBeVisible()
}

/** Scrolls the scroller holding the words `near` by `by` pixels (written as a script: this file is typed for Node). */
async function scrollMain(win: Page, near: string, by: number): Promise<void> {
  await win.evaluate(`(() => {
    const el = [...document.querySelectorAll('main *')].find((e) => e.childElementCount === 0 && e.textContent.trim() === ${JSON.stringify(near)})
    let box = el && el.parentElement
    while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement
    if (box) box.scrollBy(0, ${by})
  })()`)
}

async function panelTab(win: Page, name: string | RegExp): Promise<void> {
  await scenePanel(win).getByRole('tab', { name }).click()
}

/** Invented beats for the sample's scene cards. */
const BEATS: Record<string, string[]> = {
  'Lighting the Lamp': ['Wren climbs the hundred and twelve steps with the oil can', 'Edric hides his shaking hands', 'Wren trims the wick and lights the lamp', 'They see the night ferry coming in early'],
  'A Letter for the Keeper': ['Ansel meets Wren on the quay', 'Iska comes ashore with the sealed letter', 'Wren asks for it; Iska refuses', 'Iska admits the news is bad'],
  'What the Letter Said': ['Edric reads the letter at the kitchen table', 'The light is to go dark at midwinter', 'Wren counts seven weeks'],
  'Low Tide': ['Wren leads Iska across the Drowned Steps', 'Iska admits she is only a cheap clerk', 'Wren tears her palm on the rotted bell rope', 'Iska takes Wren’s hand on the way back']
}

/** A sentence in "Low Tide" that the consistency shot flags (the memory says Wren's eyes are grey). */
const EYES_FROM = '“She did,” Wren said. “Tell them that too.”'
const EYES_TO = '“She did,” Wren said, her brown eyes steady. “Tell them that too.”'

/**
 * Makes the data folder: the sample world with portraits, the stand-in models and the one changed sentence,
 * then (closed) renamed "Gullhaven" with the sample mark taken off and a few consistency issues written in.
 */
async function prepare(ai: DocsProvider): Promise<string> {
  const dataDir = newDataDir()
  made.push(dataDir)
  const first = await launchApp({ dataDir, env: ENV })
  const { app, win } = first
  await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(win, 'openSampleWorld')
  await invoke(win, 'updateSettings', { theme: THEME })
  await connect(win, ai)
  for (const e of await invoke(win, 'listEntries', 'character')) {
    const look = LOOKS[e.name]
    if (look) await win.evaluate(paintPortrait(e.id, look))
  }
  // The changed sentence, kept in the page's own document so every paragraph keeps its id.
  const lowTide = await scene(win, 'Low Tide')
  const s = await invoke(win, 'getScene', lowTide)
  const doc = JSON.parse(JSON.stringify(s.doc).replace(JSON.stringify(EYES_FROM).slice(1, -1), JSON.stringify(EYES_TO).slice(1, -1)))
  await invoke(win, 'saveSceneText', lowTide, doc, s.text.replace(EYES_FROM, EYES_TO))
  // Done, like the others (the page's header then says Done and Reopen, as in the other shots).
  await invoke(win, 'markSceneDone', lowTide)
  // Beats on each scene card, so the card looks used.
  for (const [title, beats] of Object.entries(BEATS)) {
    const id = await scene(win, title)
    const { card } = await invoke(win, 'getScene', id)
    await invoke(win, 'updateSceneCard', id, { ...card, beats })
  }
  // Two more ties for the relationship map.
  const people = new Map((await invoke(win, 'listEntries', 'character')).map((e) => [e.name, e.id]))
  const who = (name: string): string => people.get(name)!
  await invoke(win, 'createChange', {
    kind: 'relationship',
    payload: { otherId: who('Ansel Crane'), type: 'old friends', feels: 'Trusts him, and pities him his post', otherFeels: 'Owes him more than he can say' },
    entryId: who('Edric Halloway'),
    anchor: 'baseline'
  })
  await invoke(win, 'createChange', {
    kind: 'relationship',
    payload: { otherId: who('Iska Vey'), type: 'colleague on the Board', feels: 'Wary of what she will write', otherFeels: 'Thinks him kinder than his office' },
    entryId: who('Ansel Crane'),
    anchor: 'scene',
    sceneId: await scene(win, 'A Letter for the Keeper')
  })
  const folder = (await invoke(win, 'getWorld'))!.folder
  await closeWindow(app)
  await first.close()

  const db = new Database(join(folder, 'world.db'))
  try {
    db.pragma('busy_timeout = 5000')
    db.prepare("DELETE FROM meta WHERE key = 'sample_world'").run()
    db.prepare("UPDATE meta SET value = 'Gullhaven' WHERE key = 'name'").run()
    const story = db.prepare('SELECT id FROM stories WHERE deleted_at IS NULL ORDER BY position LIMIT 1').get() as { id: string }
    const sceneId = (title: string) => (db.prepare('SELECT id FROM scenes WHERE title = ? AND deleted_at IS NULL').get(title) as { id: string }).id
    const at = (n: number) => `2026-10-08T09:0${n}:00.000Z`
    const add = db.prepare(
      `INSERT INTO issues (id, scene_id, story_id, kind, severity, status, quote, message, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`
    )
    const issues: [string, string, string, string, string, string, string | null][] = [
      ['docs-eyes', 'Low Tide', 'fact', 'must-fix', 'her brown eyes steady', 'Wren’s eyes are grey in her profile, but brown here.', 'her grey eyes steady'],
      ['docs-weeks', 'What the Letter Said', 'timeline', 'warning', 'That’s seven weeks.', 'By the dates on the scene cards so far, midwinter is eight weeks off, not seven.', null],
      ['docs-tense', 'Lighting the Lamp', 'style', 'minor', 'The light is never dark.', 'This sentence slips into the present tense. If it is the Charter’s words, set them in italics.', null],
      ['docs-voice', 'What the Letter Said', 'voice', 'minor', 'Bells are cheap.', 'Edric usually talks in slow sea sayings; this is blunter than his other lines.', null]
    ]
    const wren = (db.prepare("SELECT id FROM entries WHERE name = 'Wren Halloway'").get() as { id: string }).id
    issues.forEach(([id, title, kind, severity, quote, message, fix], i) => {
      const sources = id === 'docs-eyes' ? [{ kind: 'entry', entryId: wren, name: 'Wren Halloway', field: 'eyes' }] : []
      const payload = JSON.stringify({ key: `docs:${id}`, sources, fix, memoryFix: null })
      add.run(id, sceneId(title), story.id, kind, severity, quote, message, payload, at(i), at(i))
    })
  } finally {
    db.close()
  }
  return dataDir
}

/** The start screen's data folder: the sample world as it comes, and a made-up world of one's own. */
async function prepareStart(ai: DocsProvider): Promise<string> {
  const dataDir = newDataDir()
  made.push(dataDir)
  const first = await launchApp({ dataDir, env: ENV })
  const { app, win } = first
  await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(win, 'createWorld', SALT_ROAD.name)
  const stories = await invoke(win, 'listStories')
  for (const [si, st] of SALT_ROAD.stories.entries()) {
    const story = si === 0 ? stories[0] : await invoke(win, 'createStory', { title: st.title })
    await invoke(win, 'updateStory', story.id, { title: st.title })
    const outline = await invoke(win, 'getOutline', story.id)
    const chapter = outline.chapters[0] ?? (await invoke(win, 'createChapter', story.id, { title: 'Chapter 1' }))
    for (const [ti, [title, text]] of st.scenes.entries()) {
      const id = si === 0 && ti === 0 ? outline.scenes[0].id : (await invoke(win, 'createScene', chapter.id, { title })).id
      await invoke(win, 'updateScene', id, { title })
      await invoke(win, 'saveSceneText', id, null, text)
    }
  }
  await invoke(win, 'openSampleWorld')
  await invoke(win, 'updateSettings', { theme: THEME })
  await connect(win, ai)
  await closeWindow(app)
  await first.close()
  return dataDir
}

async function reopen(dataDir: string, env: Record<string, string> = {}): Promise<LaunchedApp> {
  const a = await launchApp({ dataDir, env: { ...ENV, ...env } })
  await sizeWindow(a.app, a.win)
  if (!env.AIWRITE_START) {
    // The memory catches up with the changed scene as the world opens; reloaded after it, the top bar's quiet
    // "Memory updated" note (for runs since the world opened) stays away.
    await expect(prose(a.win)).toBeVisible()
    await a.win.waitForTimeout(4000)
    await a.win.reload()
    await expect(prose(a.win)).toBeVisible()
  }
  return a
}

test('docs screenshots', async () => {
  const ai = await startDocsProvider({ delayMs: 14, port: 1234 })
  ai.reply = router
  let speech: { url: string; close(): Promise<void> } | null = null
  let open: LaunchedApp | null = null
  try {
    const dataDir = await prepare(ai)
    open = await reopen(dataDir)
    let { app, win } = open
    await expect(prose(win)).toContainText('A hundred and twelve steps to the lamp room.')
    await expect(win.getByRole('region', { name: 'Sample world' })).toHaveCount(0)

    await take('hero', async () => {
      await openScene(win, 'Lighting the Lamp')
      await panelTab(win, 'Scene card')
      await shot(app, win, 'hero')
    })

    // GitHub's social preview card, drawn from a small page of its own in a hidden window, with part of hero.png.
    await take('social', async () => {
      const file = join(dataDir, 'social-preview.html')
      writeFileSync(file, socialPage(ROOT, THEME))
      const card = await app.evaluate(async ({ BrowserWindow }, path) => {
        const w = new BrowserWindow({ show: false, width: 1280, height: 640, useContentSize: true, webPreferences: { offscreen: true } })
        try {
          await w.loadFile(path)
          await w.webContents.executeJavaScript('document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode())))')
          await new Promise((r) => setTimeout(r, 800))
          let img = await w.webContents.capturePage()
          if (img.getSize().width !== 1280 || img.getSize().height !== 640) img = img.resize({ width: 1280, height: 640, quality: 'best' })
          return { bitmap: img.toBitmap().toString('base64'), width: img.getSize().width, height: img.getSize().height }
        } finally {
          w.destroy()
        }
      }, file)
      const bitmap = Buffer.from(card.bitmap, 'base64')
      let out = encodePng(bitmap, card.width, card.height)
      if (out.length > 1000 * 1024) out = encodePng(bitmap, card.width, card.height, { colours: 256 })
      writeFileSync(join(IMAGES, 'social-preview.png'), out)
      console.log(`saved social-preview.png (${card.width}x${card.height}, ${Math.round(out.length / 1024)} KB)`)
    })

    await take('ai-writing', async () => {
      await openScene(win, 'Low Tide')
      holdContinue = true
      await prose(win).locator('p').last().click()
      await win.keyboard.press('Control+End')
      await win.keyboard.press('Control+k')
      await win.getByRole('combobox', { name: 'Search, or find an action' }).fill('Continue from the cursor')
      await win.getByRole('option', { name: /Continue from the cursor/ }).click()
      await expect(prose(win).locator('.aw-sugg-words').first()).toBeVisible()
      await expect(prose(win)).toContainText('Above them the tower stood white', { timeout: 30_000 })
      await win.waitForTimeout(400)
      // The new words in view, the end of the scene before them.
      // The new words in view, with the bar that says it is still writing just under them.
      await win.evaluate(`(() => {
        const bar = [...document.querySelectorAll('[role="group"]')].find((g) => g.getAttribute('aria-label') === 'The AI’s change')
        let box = document.querySelector('.scene-prose').parentElement
        while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement
        if (bar && box) box.scrollTop += bar.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom + 70
      })()`)
      await shot(app, win, 'ai-writing')
      holdContinue = false
      ai.release()
      const change = win.getByRole('group', { name: 'The AI’s change' })
      await expect(change.getByRole('button', { name: /^Reject/ })).toBeVisible({ timeout: 30_000 })
      await expect(change.getByRole('button', { name: /^Stop/ })).toHaveCount(0, { timeout: 30_000 })
      await change.getByRole('button', { name: /^Reject/ }).click()
    })

    await take('story-memory', async () => {
      await openScene(win, 'Lighting the Lamp')
      const sceneId = await scene(win, 'Lighting the Lamp')
      await invoke(win, 'refreshRecall', sceneId)
      await panelTab(win, 'Cast')
      const again = scenePanel(win).getByRole('region', { name: 'Recall' }).getByRole('button', { name: /Read again|Work it out/ })
      if (await again.count()) await again.first().click()
      const recall = scenePanel(win).getByRole('region', { name: 'Recall' })
      await expect(recall.locator('[data-recall-character="Edric Halloway"]')).toContainText('great glass', { timeout: 30_000 })
      await recall.scrollIntoViewIfNeeded()
      await shot(app, win, 'story-memory')
    })

    await take('consistency', async () => {
      await area(win, 'Check').click()
      await list(win).getByRole('button', { name: 'Consistency' }).click()
      await expect(main(win).getByRole('heading', { level: 1, name: 'Consistency' })).toBeVisible()
      await expect(main(win).locator('[data-issue]').first()).toBeVisible()
      await shot(app, win, 'consistency')
    })

    await take('world-entry', async () => {
      await area(win, 'World').click()
      await expect(main(win).getByRole('heading', { level: 1, name: 'Codex' })).toBeVisible()
      await main(win).getByRole('button', { name: 'Wren Halloway', exact: true }).first().click()
      await expect(main(win).getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Wren Halloway')
      const looks = main(win).getByRole('button', { name: /^Looks/ })
      if ((await looks.getAttribute('aria-expanded')) === 'false') await looks.click()
      await shot(app, win, 'world-entry')
    })

    // The start screen has its own data folder (the sample world kept as it comes).
    await take('start-screen', async () => {
      await open!.close()
      const startDir = await prepareStart(ai)
      const s = await reopen(startDir, { AIWRITE_START: 'on' })
      try {
        const start = s.win.locator('.start-screen')
        await expect(start).toBeVisible()
        await expect(start).toHaveAttribute('data-opening', 'done', { timeout: 10_000 })
        await expect(start.getByRole('list', { name: 'Your worlds' })).toContainText(SALT_ROAD.name)
        await shot(s.app, s.win, 'start-screen')
      } finally {
        await s.close()
        open = await reopen(dataDir)
        ;({ app, win } = open)
        await expect(prose(win)).toBeVisible()
      }
    })

    await take('ask', async () => {
      await openScene(win, 'What the Letter Said')
      await area(win, 'Ask').click()
      const panel = win.getByRole('region', { name: 'Ask the world' })
      const box = panel.getByRole('textbox', { name: 'Ask about your world' })
      await box.fill(ASK_QUESTION)
      await box.press('Enter')
      const answer = panel.getByRole('list', { name: 'Conversation' }).locator(':scope > li').first().locator('[data-answer]')
      await expect(answer).toContainText('not the Board', { timeout: 30_000 })
      await shot(app, win, 'ask')
      await area(win, 'Ask').click().catch(() => undefined)
    })

    await take('outline', async () => {
      await area(win, 'Plan').click()
      await list(win).getByRole('button', { name: 'Outline helper' }).click()
      await main(win).getByRole('button', { name: /^Suggest/ }).first().click()
      await expect(main(win).locator('[data-suggestion]').first()).toBeVisible({ timeout: 30_000 })
      await expect(main(win)).toContainText('The Light Holds', { timeout: 30_000 })
      await expect(main(win).getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, { timeout: 30_000 })
      await scrollMain(win, 'Premise', 0)
      await shot(app, win, 'outline')
    })

    await take('world-map', async () => {
      await area(win, 'World').click()
      await list(win).getByRole('button', { name: 'Relationship map' }).click()
      await expect(main(win).getByRole('group', { name: 'Relationship map' })).toBeVisible()
      // As of the end of the story, so everyone with a tie shows, then fitted to the window.
      await main(win).getByRole('slider', { name: 'As of' }).focus()
      await win.keyboard.press('End')
      await expect(main(win)).toContainText('4 characters', { timeout: 10_000 })
      await win.waitForTimeout(1500)
      await main(win).getByRole('button', { name: 'Fit the map to the window' }).click()
      await win.waitForTimeout(800)
      // The four are a small group: brought closer.
      for (let i = 0; i < 2; i++) {
        await main(win).getByRole('button', { name: /^Zoom in/ }).click()
        await win.waitForTimeout(400)
      }
      await win.waitForTimeout(1200)
      await shot(app, win, 'world-map')
    })

    await take('timeline', async () => {
      await area(win, 'World').click()
      await list(win).getByRole('button', { name: 'Timeline' }).click()
      await expect(main(win).getByRole('heading', { level: 1, name: 'Timeline' })).toBeVisible()
      await shot(app, win, 'timeline')
    })

    await take('read-aloud', async () => {
      const { startFakeSpeech } = (await import(pathToFileURL(join(ROOT, 'tests', 'fake-speech', 'server.mjs')).href)) as {
        startFakeSpeech(o: object): Promise<{ url: string; close(): Promise<void> }>
      }
      speech = await startFakeSpeech({})
      await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url, readAloud: true, speed: 1 } })
      await win.reload()
      await expect(prose(win)).toBeVisible()
      await openScene(win, 'Lighting the Lamp')
      await prose(win).locator('p').nth(1).click()
      await win.keyboard.press('Home')
      await win.keyboard.press('Control+l')
      const bar = win.getByRole('region', { name: 'Reading aloud' })
      await expect(bar).toContainText('Narrator', { timeout: 30_000 })
      await expect(prose(win).locator('.aw-reading').first()).toBeVisible()
      await win.mouse.move(WIDTH - 4, HEIGHT - 4)
      await win.waitForTimeout(300)
      // Taken straight away, while the line is still being read.
      await save(app, await win.screenshot(), 'read-aloud')
      await win.keyboard.press('Control+Shift+Space')
      await bar.getByRole('button', { name: 'Close' }).click().catch(() => undefined)
      await invoke(win, 'updateSettings', { speech: { readAloud: false } })
      await win.reload()
      await expect(prose(win)).toBeVisible()
    })

    await take('settings-ai', async () => {
      await area(win, 'Settings').click()
      await expect(main(win).getByRole('heading', { level: 1, name: 'Models' })).toBeVisible()
      await shot(app, win, 'settings-ai')
      await area(win, 'Write').click()
    })

    await take('look-classic', async () => {
      await invoke(win, 'updateSettings', { look: 'classic' })
      await open!.close()
      open = await reopen(dataDir)
      ;({ app, win } = open)
      await expect(prose(win)).toContainText('A hundred and twelve steps to the lamp room.')
      await dismissToasts(win)
      await shot(app, win, 'look-classic')
      await invoke(win, 'updateSettings', { look: 'new' })
      await open.close()
      open = await reopen(dataDir)
      ;({ app, win } = open)
      await expect(prose(win)).toBeVisible()
    })

    await take('variants', async () => {
      await openScene(win, 'Low Tide')
      drafts = 0
      await win.getByRole('button', { name: 'Variants', exact: true }).click()
      await win.getByRole('button', { name: 'Write three variants' }).click()
      for (const n of [1, 2, 3])
        await expect(win.getByRole('region', { name: `Variant ${n}`, exact: true }).getByRole('button', { name: 'Use this one' })).toBeVisible({ timeout: 60_000 })
      await expect(win.getByRole('button', { name: 'Stop all' })).toHaveCount(0, { timeout: 60_000 })
      await shot(app, win, 'variants')
      await openScene(win, 'Lighting the Lamp')
    })

  } finally {
    await open?.close()
    await (speech as { close(): Promise<void> } | null)?.close()
    await ai.close()
    for (const dir of made) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      } catch {
        /* a file still held open on Windows: left for the system to clear */
      }
    }
  }
  expect(failed, `shots that failed: ${failed.join(', ')}`).toEqual([])
})
