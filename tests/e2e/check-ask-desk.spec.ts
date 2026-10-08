// The desk's Check room, Ask the world and a scene's history (UI overhaul, "the Check room, Ask and history"), on the
// sample world with invented issues and memory lines written into world.db, and the fake provider for the AI: the
// consistency page's column (the lighthouse, the reports with their counts, where the issues are), issue cards with
// their severity in form, the severity filters, Ignore folding a card away while the counts tick down and Undo bringing
// it back, the all-clear; a running check lighting the lighthouse; What changed as a ledger with its filters; Ask's
// answers in the lamp's language with their sources and what to ask next; the history's timeline and Restore; the
// palette's drawings and gliding highlight; less motion; and every page fitting the window.
import Database from 'better-sqlite3'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import type { CheckStart } from '@shared/contracts/checks'
import type { ID } from '@shared/types'
import { expect, invoke, startFake, test, useFakeModel, type LaunchOptions } from './helpers'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk', AIWRITE_KEEPER_QUIET_MS: '600000' }
const rooms = (win: Page) => win.getByRole('navigation', { name: 'Rooms' })
const room = (win: Page, name: string) => rooms(win).getByRole('button', { name: new RegExp(`^${name}`) })
const sheet = (win: Page) => win.locator('[data-desk-room]')
const cards = (win: Page) => sheet(win).locator('[data-issue]')
const dock = (win: Page) => win.getByRole('toolbar', { name: 'AI dock' })

async function sampleWorld(
  launch: (o?: LaunchOptions) => Promise<{ app: ElectronApplication; win: Page }>
): Promise<{ app: ElectronApplication; win: Page; folder: string; storyId: ID; scenes: ID[]; entries: Map<string, ID> }> {
  const a = await launch({ env: DESK })
  await expect(a.win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(a.win, 'openSampleWorld')
  await invoke(a.win, 'updateSettings', { editor: { spellCheck: false } })
  await a.win.reload()
  await expect(a.win.locator('.scene-prose')).toContainText('A hundred and twelve steps to the lamp room.')
  const [story] = await invoke(a.win, 'listStories')
  const outline = await invoke(a.win, 'getOutline', story.id)
  const entries = new Map((await invoke(a.win, 'listEntries')).map((e) => [e.name, e.id]))
  const world = await invoke(a.win, 'getWorld')
  return { ...a, folder: world!.folder, storyId: story.id, scenes: outline.scenes.map((s) => s.id), entries }
}

/** Invented issues on the sample scenes' own words, as the checks would have raised them. */
function seedIssues(folder: string, storyId: ID, scenes: ID[], wren: ID): void {
  const db = new Database(join(folder, 'world.db'))
  try {
    db.pragma('busy_timeout = 5000')
    const add = db.prepare(
      `INSERT INTO issues (id, scene_id, story_id, kind, severity, status, quote, message, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const rows: [string, ID, string, string, string, string, object][] = [
      ['t-burn', scenes[0], 'fact', 'must-fix', 'Her right hand still carried the shiny burn', 'Wren’s burn is on her left hand in the memory.', { sources: [{ kind: 'entry', entryId: wren, name: 'Wren Halloway', field: 'Appearance' }] }],
      ['t-coat', scenes[0], 'continuity', 'warning', 'kept his hands in his coat pockets', 'Edric left his coat at the foot of the stairs.', {}],
      ['t-weeks', scenes[2], 'timeline', 'warning', 'That’s seven weeks.', 'Midwinter is nine weeks away, not seven.', {}]
    ]
    rows.forEach(([id, scene, kind, severity, quote, message, extra], i) => {
      const at = `2026-10-08T10:00:0${i}.000Z`
      add.run(id, scene, storyId, kind, severity, 'open', quote, message, JSON.stringify({ key: `t:${id}`, sources: [], fix: null, memoryFix: null, ...extra }), at, at)
    })
  } finally {
    db.close()
  }
}

/** Invented lines of What changed: two reads of the sample scenes. */
function seedMemory(folder: string, scenes: ID[], entries: Map<string, ID>): void {
  const db = new Database(join(folder, 'world.db'))
  try {
    db.pragma('busy_timeout = 5000')
    const add = db.prepare(
      `INSERT INTO memory_log (id, run_id, scene_id, action, what, entry_id, fact_id, entry_name, text, before, after, quote, question_json, undo_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, '{}', ?)`
    )
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
    add.run('l1', 'r1', scenes[2], 'updated', 'change', entries.get('Edric Halloway'), 'Edric Halloway', 'To be pensioned off', 'Keeper of the light', 'Pensioned at midwinter', 'four shillings a week', null, ago(20))
    add.run('l2', 'r2', scenes[3], 'added', 'change', entries.get('Wren Halloway'), 'Wren Halloway', 'Tore her left palm on the bell rope', '', '', 'it took the skin off her left palm', null, ago(2))
    add.run('l3', 'r2', scenes[3], 'added', 'entry', null, 'Bell Rock', 'New place', '', '', 'Bell Rock', JSON.stringify({ text: 'Is Bell Rock its own place?', options: [{ id: 'own', label: 'Its own place' }, { id: 'part', label: 'Part of The Drowned Steps' }], answer: null }), ago(2))
  } finally {
    db.close()
  }
}

async function size(app: ElectronApplication, win: Page, w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [cw, ch]) => {
    const b = BrowserWindow.getAllWindows()[0]
    b.unmaximize()
    b.setContentSize(cw, ch)
  }, [w, h] as [number, number])
  await expect.poll(async () => Math.abs(((await win.evaluate('innerWidth')) as number) - w)).toBeLessThanOrEqual(1)
}

/** How far anything spills past the window's right edge (0 or less: nothing does). */
const overflow = (win: Page) =>
  win.evaluate<number>(
    `Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, ...[...document.querySelectorAll('[data-desk-room] *')].map((e) => e.getBoundingClientRect().right)) - innerWidth`
  )

test('the Check room: the lighthouse, the reports, issue cards with their severity, filters, Ignore folding away, Undo, and the all-clear', async ({ launch }) => {
  const { win, folder, storyId, scenes, entries } = await sampleWorld(launch)
  // With nothing found yet: the all-clear, the lighthouse over a calm sea.
  await room(win, 'Check').click()
  const clear = sheet(win).locator('.ck-clear')
  await expect(clear.getByRole('heading', { name: 'No issues found' })).toBeVisible()
  await expect(clear.locator('[data-room-art="lighthouse"]')).toBeVisible()
  await expect(sheet(win).getByRole('heading', { level: 1, name: 'Consistency' })).toBeVisible()

  seedIssues(folder, storyId, scenes, entries.get('Wren Halloway')!)
  await win.reload()
  await expect(win.locator('.scene-prose')).toBeVisible()
  await room(win, 'Check').click()
  await expect(cards(win)).toHaveCount(3)
  // The column: the lighthouse, and the three reports with their counts.
  const side = sheet(win).getByRole('complementary', { name: 'Consistency' })
  await expect(side.locator('[data-room-art="lighthouse"]')).toHaveAttribute('data-state', 'idle')
  const reports = side.getByRole('tablist', { name: 'Reports' })
  await expect(reports.getByRole('tab', { name: /Issues/ })).toHaveAttribute('aria-selected', 'true')
  await expect(reports.getByRole('tab', { name: /Issues/ })).toContainText('1 must fix')
  await expect(reports.getByRole('tab', { name: /Issues/ })).toContainText('3')
  await expect(side.getByRole('navigation', { name: 'Where the issues are' })).toContainText('The Night Ferry')

  // A card: its severity in form, the story's words as a quote, what it disagrees with drawn as a small card.
  const burn = sheet(win).locator('[data-issue="t-burn"]')
  await expect(burn).toHaveAttribute('data-severity', 'must-fix')
  await expect(burn.locator('.ck-sev')).toHaveText('Must fix')
  await expect(burn.locator('blockquote')).toHaveText('“Her right hand still carried the shiny burn”')
  await expect(burn.getByRole('button', { name: /Wren Halloway/ }).locator('[data-motif]')).toBeVisible()
  await expect(sheet(win).getByRole('region', { name: 'Ch 1: The Night Ferry' })).toBeVisible()

  // The filters: Must fix shows only the one; All brings the rest back.
  const filters = sheet(win).getByRole('group', { name: 'Show issues' })
  await expect(filters.getByRole('button', { name: /^Worth a look/ })).toContainText('2')
  await filters.getByRole('button', { name: /^Must fix/ }).click()
  await expect(cards(win)).toHaveCount(1)
  await expect(filters.getByRole('button', { name: /^Must fix/ })).toHaveAttribute('aria-pressed', 'true')
  await filters.getByRole('button', { name: /^All/ }).click()
  await expect(cards(win)).toHaveCount(3)

  // Ignore folds the card away; the count ticks down; Undo brings it back.
  const coat = sheet(win).locator('[data-issue="t-coat"]')
  await coat.getByRole('button', { name: 'Ignore' }).click()
  await expect(coat).toHaveAttribute('data-leaving')
  await expect(coat).toHaveCount(0)
  await expect(filters.getByRole('button', { name: /^Worth a look/ })).toContainText('1')
  await expect(win.getByText('Issue ignored. It won’t be raised again.')).toBeVisible()
  await win.getByRole('button', { name: 'Undo' }).click()
  await expect(coat).toBeVisible()
  await expect(filters.getByRole('button', { name: /^Worth a look/ })).toContainText('2')

  // The card opens its scene at the words.
  await burn.locator('.ck-msg').click()
  await expect(win.locator('.scene-prose')).toBeVisible()
  await expect.poll(() => win.evaluate<string>('String(getSelection() ?? "")')).toBe('Her right hand still carried the shiny burn')

  // Ignoring the rest: the all-clear's moment, with the way to see the ignored ones.
  await room(win, 'Check').click()
  for (const id of ['t-burn', 't-coat', 't-weeks']) {
    await sheet(win).locator(`[data-issue="${id}"]`).getByRole('button', { name: 'Ignore' }).click()
    await expect(sheet(win).locator(`[data-issue="${id}"]`)).toHaveCount(0)
  }
  await expect(sheet(win).locator('.ck-clear')).toHaveAttribute('data-moment')
  await expect(sheet(win).getByRole('heading', { name: 'Nothing left to look at' })).toBeVisible()
  await sheet(win).getByLabel('Show ignored (3)').check()
  await expect(cards(win)).toHaveCount(3)
  await expect(cards(win).first()).toHaveAttribute('data-ignored')

  // The reports: repetition and plot threads, each with its drawing.
  await reports.getByRole('tab', { name: /Plot threads/ }).click()
  await expect(sheet(win).locator('[data-room-art="loom"]').first()).toBeVisible()
  await reports.getByRole('tab', { name: /Repetition/ }).click()
  await expect(sheet(win).locator('[data-room-art="echo"]').first()).toBeVisible()
})

test('a check running lights the lighthouse in the lamp’s amber, with a meter and Stop', async ({ launch }) => {
  const { app, win } = await sampleWorld(launch)
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const g = globalThis as unknown as { starts: CheckStart[] }
    g.starts = []
    const send = (event: string, payload: unknown): void => BrowserWindow.getAllWindows()[0].webContents.send(`event:${event}`, payload)
    const swap = (name: string, fn: (arg: never) => unknown): void => {
      ipcMain.removeHandler(`api:${name}`)
      ipcMain.handle(`api:${name}`, (_e, arg: unknown) => ({ ok: true, value: fn(arg as never) }))
    }
    swap('startCheck', (input: CheckStart) => {
      g.starts.push(input)
      setTimeout(() => send('checks:progress', { runId: input.runId, target: input.target, done: 1, total: 4, current: 'Ch 1, Sc 2: A Letter for the Keeper' }), 100)
    })
    swap('stopCheck', (runId: string) => {
      const run = g.starts.find((s) => s.runId === runId)
      if (run) setTimeout(() => send('checks:done', { runId, target: run.target, status: 'stopped', error: null, found: 0 }), 50)
    })
  })
  await room(win, 'Check').click()
  const side = sheet(win).getByRole('complementary', { name: 'Consistency' })
  await side.getByRole('button', { name: 'Check this story', exact: true }).click()
  await expect(side.locator('[data-room-art="lighthouse"]')).toHaveAttribute('data-state', 'busy')
  await expect(side.locator('.ck-meter')).toContainText('Checking Ch 1, Sc 2')
  await side.getByRole('button', { name: 'Stop' }).click()
  await expect(side.locator('[data-room-art="lighthouse"]')).toHaveAttribute('data-state', 'idle')
  await expect(side.getByRole('button', { name: 'Check this story', exact: true })).toBeVisible()
})

test('What changed on the desk: the ledger, how the memory is doing, and its filters', async ({ launch }) => {
  const { win, folder, scenes, entries } = await sampleWorld(launch)
  seedMemory(folder, scenes, entries)
  await win.reload()
  await expect(win.locator('.scene-prose')).toBeVisible()
  await room(win, 'Check').click()
  await sheet(win).locator('[data-desk-sublinks]').getByRole('button', { name: 'What changed' }).click()
  await expect(sheet(win).getByRole('heading', { level: 1, name: 'What changed' })).toBeVisible()
  await expect(sheet(win).locator('[data-room-art="ledger"]')).toBeVisible()
  await expect(sheet(win).locator('.lg-keeper')).toBeVisible()
  // Two reads, newest first, each a ruled page; each change a line with the entry's drawing.
  const pages = sheet(win).locator('.lg-page')
  await expect(pages).toHaveCount(2)
  await expect(pages.first()).toContainText('Tore her left palm on the bell rope')
  await expect(pages.first().locator('.lg-line').first().locator('[data-motif]')).toBeVisible()
  await expect(pages.nth(1).locator('.lg-before')).toContainText('Keeper of the light')
  await expect(pages.nth(1).locator('.lg-after')).toContainText('Pensioned at midwinter')
  // The filters, with their counts: Changed shows only the change; To answer, the question.
  const tally = sheet(win).getByRole('group', { name: 'Show changes' })
  await expect(tally.getByRole('button', { name: /^Added/ })).toContainText('2')
  await tally.getByRole('button', { name: /^Changed/ }).click()
  await expect(sheet(win).locator('.lg-line')).toHaveCount(1)
  await tally.getByRole('button', { name: /^To answer/ }).click()
  await expect(sheet(win).locator('.lg-line')).toHaveCount(1)
  await expect(sheet(win).getByRole('group', { name: 'Is Bell Rock its own place?' })).toBeVisible()
  await tally.getByRole('button', { name: /^All/ }).click()
  await expect(sheet(win).locator('.lg-line')).toHaveCount(3)
})

test('Ask on the desk: the lanterns, an answer arriving in the lamp’s language, its sources, and what to ask next', async ({ launch }) => {
  const fake = await startFake({ delayMs: 20 })
  try {
    const { win } = await sampleWorld(launch)
    await useFakeModel(win, fake, 'fake/slow')
    await (await openDockMenu(win)).getByRole('menuitemcheckbox', { name: 'Ask the world' }).click()
    const panel = win.getByRole('region', { name: 'Ask the world' })
    await expect(panel.locator('[data-room-art="lanterns"]').first()).toBeVisible()
    await expect(panel.getByRole('heading', { name: 'Ask your world' })).toBeVisible()
    // A question to try fills the box.
    await panel.getByRole('button', { name: /^What would Wren Halloway do if/ }).click()
    const box = panel.getByRole('textbox', { name: 'Ask about your world' })
    await expect(box).toHaveValue(/^What would Wren Halloway do if/)
    await box.press('Enter')
    // Arriving: the lamp's language, its new words fading in.
    const answer = panel.locator('[data-answer]').first()
    await expect(answer).toHaveAttribute('data-streaming')
    await expect(answer.locator('.ask-arrive').first()).toBeAttached()
    await expect(panel.locator('.ask-head [data-room-art="lanterns"]')).toHaveAttribute('data-state', 'busy')
    await expect(answer).not.toHaveAttribute('data-streaming', { timeout: 30_000 })
    await expect(answer).toContainText('Idea 20')
    // Its sources, as small cards with their drawings; one opens its page beside the chat.
    const sources = panel.getByRole('group', { name: 'From your world' })
    await expect(sources.getByRole('button', { name: /Wren Halloway/ }).locator('[data-motif]')).toBeVisible()
    // What to ask next fills the box (nothing is sent).
    const next = panel.getByRole('group', { name: 'Ask next' })
    await next.getByRole('button', { name: 'What does Wren Halloway want most right now?' }).click()
    await expect(box).toHaveValue('What does Wren Halloway want most right now?')
    await sources.getByRole('button', { name: /Wren Halloway/ }).click()
    await expect(win.getByRole('button', { name: 'Back to Ask the world' })).toBeVisible()
  } finally {
    await fake.close()
  }
})

test('history on the desk: a timeline in each kind’s ink, the two sheets, and Restore', async ({ launch }) => {
  const fake = await startFake({ delayMs: 5 })
  try {
    const { win } = await sampleWorld(launch)
    await useFakeModel(win, fake)
    const paras = win.locator('.scene-prose > p')
    const before = await paras.count()
    await win.locator('.scene-prose').click()
    await win.keyboard.press('Control+Shift+Enter')
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'review', { timeout: 30_000 })
    await win.keyboard.press('Tab')
    await expect.poll(() => paras.count()).toBeGreaterThan(before)
    await win.keyboard.press('Control+K')
    await win.keyboard.type('scene history')
    await win.keyboard.press('Enter')
    const list = win.getByRole('navigation', { name: 'Earlier versions' })
    await expect(list.locator('[data-snapshot]').first()).toHaveAttribute('data-kind', 'ai')
    await expect(sheet(win).locator('[data-room-art="pages"]')).toBeVisible()
    const compare = win.getByRole('region', { name: 'Comparison' })
    await expect(compare.locator('[data-side="now"] .hist-whole').first()).toBeVisible()
    await compare.getByRole('button', { name: 'Restore this version' }).click()
    await expect(win.locator('.scene-prose')).toBeVisible()
    await expect.poll(() => paras.count()).toBe(before)
  } finally {
    await fake.close()
  }
})

test('the palette on the desk: entries with their drawings, and one highlight that moves with the keys', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  await win.locator('.scene-prose').click()
  await win.keyboard.press('Control+K')
  await win.keyboard.type('wren')
  const dialog = win.getByRole('dialog', { name: 'Search' })
  const hit = dialog.getByRole('option', { name: /Wren Halloway/ }).first()
  await expect(hit.locator('.pal-tile [data-motif]')).toBeVisible()
  await expect(dialog.locator('.pal-pill')).toHaveCount(1)
  await win.keyboard.press('ArrowDown')
  await expect(dialog.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true')
  await win.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('with less motion the drawings rest and a card goes at once; the Check room and What changed fit the window', async ({ launch }) => {
  const { app, win, folder, storyId, scenes, entries } = await sampleWorld(launch)
  seedIssues(folder, storyId, scenes, entries.get('Wren Halloway')!)
  seedMemory(folder, scenes, entries)
  await win.emulateMedia({ reducedMotion: 'reduce' })
  await win.reload()
  await expect(win.locator('.scene-prose')).toBeVisible()
  await room(win, 'Check').click()
  await expect(cards(win)).toHaveCount(3)
  expect(await win.evaluate<string>(`getComputedStyle(document.querySelector('[data-desk-room] .ra-beam-left')).animationName`)).toBe('none')
  const coat = sheet(win).locator('[data-issue="t-coat"]')
  await coat.getByRole('button', { name: 'Ignore' }).click()
  await expect(coat).toHaveCount(0)
  await win.getByRole('button', { name: 'Undo' }).click()
  await expect(coat).toBeVisible()
  await win.emulateMedia({ reducedMotion: 'no-preference' })

  for (const [w, h] of [
    [1366, 768],
    [1920, 1080],
    [960, 600]
  ] as const) {
    await size(app, win, w, h)
    await room(win, 'Check').click()
    await sheet(win).locator('[data-desk-sublinks]').getByRole('button', { name: 'Consistency' }).click()
    await expect(cards(win).first()).toBeVisible()
    await win.waitForTimeout(300)
    expect(await overflow(win), `consistency at ${w}x${h}`).toBeLessThanOrEqual(0)
    await sheet(win).locator('[data-desk-sublinks]').getByRole('button', { name: 'What changed' }).click()
    await expect(sheet(win).locator('.lg-page').first()).toBeVisible()
    await win.waitForTimeout(300)
    expect(await overflow(win), `what changed at ${w}x${h}`).toBeLessThanOrEqual(0)
  }
})

async function openDockMenu(win: Page) {
  await dock(win).getByRole('button', { name: 'More ways to write' }).click()
  return win.getByRole('menu')
}
