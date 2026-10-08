// The desk keeps up with a long book (UI overhaul, Phase 6 "Polish and speed"): an invented world of 40 chapters, 200
// scenes and 150 entries (scaleWorld.ts), at 1920×1080. Switching rooms, opening the story's home, the World gallery and
// a dossier, the Plan board and dragging a card on it, with the spine showing all 200 scenes, are each timed from the
// click to the frame they are drawn in (the middle of three goes, after one to warm up), and the browser's
// long-animation-frame entries are watched while they happen; typing
// in a 10,000-word scene that names the world's people and places must stay quick. The limits are set well above what
// this PC measures (speed.md in the Phase 6 notes has the numbers), so a slower CI machine passes, but a real slowdown
// (a room taking half a second, a frame of a third of a second) fails. Every word is invented here.
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, invoke, test } from './helpers'
import { makeLargeWorld, type LargeWorld } from './scaleWorld'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk', AIWRITE_KEEPER_QUIET_MS: '600000' }
/** A room switch, from the click to the frame it is drawn in (this PC: 60 to 200 ms; see speed.md). */
const ROOM_MS = 500
/** The worst single frame while a room, the home, the gallery or a dossier opens (this PC: up to about 110 ms). */
const FRAME_MS = 350
/** A key pressed in the long scene reaches the next frame within this, for 95 keys in 100. */
const KEY_P95_MS = 60

async function size(app: ElectronApplication, win: Page, w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [cw, ch]) => BrowserWindow.getAllWindows()[0].setContentSize(cw, ch), [w, h] as [number, number])
  await expect.poll(async () => Math.abs(((await win.evaluate('innerWidth')) as number) - w)).toBeLessThanOrEqual(1)
}

/** Starts noting long animation frames (over 50 ms) from now. */
const watchFrames = (win: Page): Promise<unknown> =>
  win.evaluate(`(() => {
    window.__loaf = []
    if (window.__loafObs) window.__loafObs.disconnect()
    window.__loafObs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__loaf.push({ start: e.startTime, duration: e.duration })
    })
    window.__loafObs.observe({ type: 'long-animation-frame', buffered: false })
  })()`)

/** The long frames since `from` (performance.now()). */
const framesSince = (win: Page, from: number): Promise<{ start: number; duration: number }[]> =>
  win.evaluate(`(window.__loaf || []).filter((f) => f.start + f.duration >= ${from})`)

/**
 * Clicks the element `click` finds (a script returning it), and times it to the frame after `ready` (a selector) is on
 * the page: the work the click starts, its render and its layout. Returns the time and the worst long frame meanwhile.
 */
async function timed(win: Page, click: string, ready: string): Promise<{ ms: number; worst: number }> {
  const r = await win.evaluate<{ ms: number; t0: number }>(`(async () => {
    const el = (${click})()
    if (!el) throw new Error('nothing to click: ' + ${JSON.stringify(click)})
    const t0 = performance.now()
    el.click()
    const until = performance.now() + 5000
    while (!document.querySelector(${JSON.stringify(ready)}) && performance.now() < until) await new Promise((r) => requestAnimationFrame(r))
    // The frame it is drawn in: a rAF, then a task after it.
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
    return { ms: performance.now() - t0, t0 }
  })()`)
  // A long frame is reported once it has ended: give it a moment.
  await win.waitForTimeout(250)
  const frames = await framesSince(win, r.t0)
  return { ms: r.ms, worst: Math.max(0, ...frames.map((f) => f.duration)) }
}

const roomButton = (name: string): string =>
  `() => [...document.querySelectorAll('nav[aria-label="Rooms"] button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(name)}))`

/** About 10,000 invented words that name the world's people and places now and then. */
function longScene(names: string[]): string {
  const s = [
    'The ferry left the north pier before the bell had finished, and the gulls followed it out past the breakwater.',
    'Nobody on deck spoke of the cargo, though every one of them had watched it come aboard under canvas.',
    'Far off, the hills were the colour of old pewter, and the rain over them had not yet decided to come.',
    'By the second hour the wind had turned, and the smell of salt gave way to the smell of wet wool and tar.',
    'She found a seat out of the spray and opened the book she had promised herself she would finish.'
  ]
  const paras: string[] = []
  for (let p = 0; p < 100; p++) {
    const line: string[] = []
    for (let i = 0; i < 5; i++) line.push(s[(p * 2 + i * 3) % s.length])
    line.splice(2, 0, `${names[p % names.length]} was there.`)
    paras.push(`Part ${p + 1}. ${line.join(' ')}`)
  }
  return paras.join('\n\n')
}

test('a long book on the desk: rooms, the home, the gallery and a dossier open quickly; the board drags; typing stays quick', async ({ launch }) => {
  test.setTimeout(240_000)
  const { app, win } = await launch({ env: DESK })
  await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  const big: LargeWorld = await makeLargeWorld(win)
  expect(big.sceneIds).toHaveLength(200)
  expect(big.entryIds).toHaveLength(150)
  const entries = await invoke(win, 'listEntries')
  const names = entries.filter((e) => e.kind === 'character' || e.kind === 'place').map((e) => e.name)
  await invoke(win, 'saveSceneText', big.sceneIds[0], null, longScene(names))
  await win.reload()
  await size(app, win, 1920, 1080)
  await expect(win.locator('.scene-prose')).toContainText('Part 100. ')
  // The spine has the whole story: 40 chapters and their 200 scenes.
  await expect(win.locator('[data-desk-spine]')).toHaveAttribute('data-shape', 'full')
  await expect(win.locator('[data-desk-spine]')).toContainText('The First Crossing')
  await win.waitForTimeout(1500)
  await watchFrames(win)

  const results: Record<string, { ms: number; worst: number }> = {}
  /** The middle of three goes (after one to warm up: the first time each room's code and data load). */
  const median = async (run: () => Promise<{ ms: number; worst: number }>, between?: () => Promise<void>): Promise<{ ms: number; worst: number }> => {
    const got: { ms: number; worst: number }[] = []
    for (let i = 0; i < 4; i++) {
      const r = await run()
      if (i) got.push(r)
      await win.waitForTimeout(350)
      if (between) await between()
    }
    const mid = (xs: number[]): number => [...xs].sort((a, b) => a - b)[1]
    return { ms: mid(got.map((g) => g.ms)), worst: mid(got.map((g) => g.worst)) }
  }
  const rooms = [
    ['Plan', '[data-desk-board]'],
    ['World', '[data-world-gallery] [data-gallery-card]'],
    ['Check', '[data-desk-room="check"]'],
    ['Write', '.scene-prose']
  ] as const
  // Each room from the one before it, round the four.
  for (let i = 0; i < rooms.length; i++) {
    const [name, ready] = rooms[i]
    const [before] = rooms[(i + rooms.length - 1) % rooms.length]
    results[`room ${name}`] = await median(
      () => timed(win, roomButton(name), ready),
      async () => {
        await timed(win, roomButton(before), rooms[(i + rooms.length - 1) % rooms.length][1])
        await win.waitForTimeout(350)
      }
    )
  }
  const homeButton = `() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.title || b.textContent).trim().startsWith('Story home'))`
  results['story home'] = await median(
    () => timed(win, homeButton, '[data-desk-home] .home-chap'),
    () => timed(win, roomButton('Write'), '.scene-prose').then(() => win.waitForTimeout(350))
  )
  await timed(win, roomButton('World'), '[data-world-gallery] [data-gallery-card]')
  await win.waitForTimeout(400)
  results['dossier'] = await median(
    () => timed(win, `() => document.querySelector('[data-world-gallery] [data-gallery-card]')`, '[data-dossier] .dz-facts'),
    async () => {
      await win.keyboard.press('Escape')
      await expect(win.locator('[data-dossier]')).toHaveCount(0)
      await win.waitForTimeout(350)
    }
  )
  await win.waitForTimeout(600)

  // The board: drag a card down its column and back, watching every frame.
  await timed(win, roomButton('Plan'), '[data-desk-board] [data-board-card]')
  await win.waitForTimeout(600)
  const card = win.locator('[data-desk-board] [data-board-card]').nth(1)
  await card.scrollIntoViewIfNeeded()
  const box = (await card.boundingBox())!
  const t0 = await win.evaluate<number>('performance.now()')
  await win.mouse.move(box.x + box.width / 2, box.y + 20)
  await win.mouse.down()
  for (let i = 1; i <= 20; i++) await win.mouse.move(box.x + box.width / 2 + i * 3, box.y + 20 + i * 12, { steps: 2 })
  for (let i = 20; i >= 0; i--) await win.mouse.move(box.x + box.width / 2 + i * 3, box.y + 20 + i * 12, { steps: 2 })
  await win.mouse.up()
  await win.waitForTimeout(400)
  const drag = await framesSince(win, t0)
  results['board drag'] = { ms: 0, worst: Math.max(0, ...drag.map((f) => f.duration)) }

  // Typing in the long scene, with its margin notes.
  await timed(win, roomButton('Write'), '.scene-prose')
  await win.waitForTimeout(800)
  const prose = win.locator('.scene-prose')
  await prose.click()
  await win.keyboard.press('Control+End')
  await win.evaluate(`(() => {
    window.__keys = []
    const channel = new MessageChannel()
    let at = 0
    channel.port1.onmessage = () => window.__keys.push(performance.now() - at)
    document.addEventListener('keydown', (e) => {
      at = e.timeStamp
      requestAnimationFrame(() => channel.port2.postMessage(null))
    }, { capture: true })
  })()`)
  await win.keyboard.type(' and the harbour lights came on one by one along the wall', { delay: 40 })
  const keys = (await win.evaluate<number[]>('window.__keys')).sort((a, b) => a - b)
  const p95 = keys[Math.min(keys.length - 1, Math.floor(keys.length * 0.95))]

  console.log(`desk-scale: ${Object.entries(results).map(([k, v]) => `${k} ${Math.round(v.ms)} ms (worst frame ${Math.round(v.worst)} ms)`).join('; ')}; typing p95 ${Math.round(p95)} ms over ${keys.length} keys`)
  for (const [k, v] of Object.entries(results)) {
    if (k.startsWith('room')) expect(v.ms, k).toBeLessThan(ROOM_MS)
    expect(v.worst, `${k}: worst frame`).toBeLessThan(FRAME_MS)
  }
  expect(keys.length).toBeGreaterThanOrEqual(50)
  expect(p95).toBeLessThan(KEY_P95_MS)
  await expect(prose).toContainText('the harbour lights came on one by one along the wall')
})
