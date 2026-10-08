// The living art (UI overhaul): the start screen's harbour, the empty pages' pictures, the story home's cover and the
// drawings move, slowly and quietly, where nobody is writing; they are still while the window is hidden or left, and
// with less motion; and nothing loops on the Write room's page. The ambient art never makes a long frame, and costs
// little while it idles (the numbers are logged). Every world, story and word here is made up, or the sample world's.
import type { ElectronApplication, Page } from '@playwright/test'
import { createWorldFromWelcome, expect, invoke, test, type LaunchOptions } from './helpers'

const NEW = { AIWRITE_LOOK: 'new' }
const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk' }
const harbour = (win: Page) => win.locator('[data-living-art="harbour"]')

// (The window's own code is passed as text: app tests are type-checked without the browser's types.)

/** The play state of every endless animation (an ambient loop) on or inside what `selector` finds. */
function loops(win: Page, selector: string): Promise<string[]> {
  return win.evaluate(`document.getAnimations().filter((a) => {
    const el = a.effect && a.effect.target
    return !!el && el.closest(${JSON.stringify(selector)}) !== null && a.effect.getTiming().iterations === Infinity
  }).map((a) => a.playState)`)
}

/** Every animation at all (entrances too) inside what `selector` finds. */
function animations(win: Page, selector: string): Promise<number> {
  return win.evaluate(`document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest(${JSON.stringify(selector)})).length`)
}

/** The animations on or inside the first element `selector` finds. */
function animationsIn(win: Page, selector: string): Promise<number> {
  return win.evaluate(`(document.querySelector(${JSON.stringify(selector)})?.getAnimations({ subtree: true }) ?? []).length`)
}

/** Endless animations anywhere in the window that are running, with what they move (for a helpful failure). */
function runningLoops(win: Page): Promise<string[]> {
  return win.evaluate(`document.getAnimations()
    .filter((a) => a.playState === 'running' && a.effect && a.effect.getTiming().iterations === Infinity)
    .map((a) => (a.animationName || '?') + ' on ' + a.effect.target.tagName.toLowerCase() + '.' + [...a.effect.target.classList].join('.'))`)
}

const BLUR = "window.dispatchEvent(new Event('blur'))"
const FOCUS = "window.dispatchEvent(new Event('focus'))"
const HIDE = `Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
  document.dispatchEvent(new Event('visibilitychange'))`
const SHOW = `delete document.visibilityState
  document.dispatchEvent(new Event('visibilitychange'))`

async function sampleWorld(launch: (o?: LaunchOptions) => Promise<{ app: ElectronApplication; win: Page }>, env: Record<string, string>) {
  const a = await launch({ env })
  await expect(a.win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(a.win, 'openSampleWorld')
  await a.win.reload()
  await expect(a.win.locator('.scene-prose')).toContainText('A hundred and twelve steps to the lamp room.')
  return a
}

/** Runs a command from the palette (Ctrl+K), by its name. */
async function palette(win: Page, command: string): Promise<void> {
  await win.keyboard.press('Control+K')
  await win.keyboard.type(command)
  await win.getByRole('option', { name: new RegExp(`^${command}`) }).first().click()
}

test('the start screen’s harbour moves: the beam sweeps, the sea rolls, the boat bobs; still while the window is away', async ({ launch }) => {
  const { win } = await launch({ env: NEW })
  await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await expect(harbour(win)).toBeVisible()
  // Its loops: three sets of stars, three swells, three glints, the boat's drift and bob, the beam, the lamp, its glow.
  const playing = await loops(win, '[data-living-art="harbour"]')
  expect(playing.length).toBeGreaterThanOrEqual(13)
  expect(new Set(playing)).toEqual(new Set(['running']))
  // The beam really turns.
  const angle = (): Promise<string> => win.evaluate(`getComputedStyle(document.querySelector('.hb-beam')).transform`)
  const first = await angle()
  await expect.poll(angle, { timeout: 3000 }).not.toBe(first)

  // Another window takes the focus: all of it is still, and it goes on when AI Write is back in front.
  await win.evaluate(BLUR)
  await expect.poll(() => loops(win, '[data-living-art="harbour"]').then((s) => [...new Set(s)])).toEqual(['paused'])
  await win.evaluate(FOCUS)
  await expect.poll(() => loops(win, '[data-living-art="harbour"]').then((s) => [...new Set(s)])).toEqual(['running'])

  // Hidden (minimised, behind the lock screen): still too.
  await win.evaluate(HIDE)
  await expect.poll(() => loops(win, '[data-living-art="harbour"]').then((s) => [...new Set(s)])).toEqual(['paused'])
  await win.evaluate(SHOW)
  await expect.poll(() => loops(win, '[data-living-art="harbour"]').then((s) => [...new Set(s)])).toEqual(['running'])
})

test('with less motion nothing moves: the harbour, an empty page and the story home show their resting frame', async ({ launch }) => {
  const { win } = await sampleWorld(launch, DESK)
  await win.emulateMedia({ reducedMotion: 'reduce' })
  await win.getByRole('button', { name: 'Story home' }).click()
  const cover = win.locator('[data-living-art="cover"]')
  await expect(cover).toBeVisible()
  expect(await animations(win, '[data-living-art="cover"]')).toBe(0)
  expect(await runningLoops(win)).toEqual([])
  // Its drawing is all there, drawn.
  await expect(cover.locator('.aw-motif')).toBeVisible()

  // An empty page: the picture shows, still.
  await invoke(win, 'createWorld', 'Quiet Harbour')
  await win.reload()
  await expect(win.getByRole('navigation', { name: 'Rooms' })).toBeVisible()
  await win.emulateMedia({ reducedMotion: 'reduce' })
  await palette(win, 'Plot threads board')
  await expect(win.locator('[data-empty-art="threads"]')).toBeVisible()
  expect(await animations(win, '[data-empty-art]')).toBe(0)

  // And the start screen's harbour.
  await palette(win, 'Go to the start screen')
  await expect(harbour(win)).toBeVisible()
  expect(await animations(win, '[data-living-art="harbour"]')).toBe(0)
  expect(await runningLoops(win)).toEqual([])
})

test('the empty pages have their pictures: the codex’s quill dips, the plot threads weave; none loops on the Write page', async ({ launch }) => {
  const { win } = await launch({ env: NEW })
  await createWorldFromWelcome(win, 'The Salt Road')
  // The Write area, on the new world's first, empty scene: nothing loops here at all.
  await win.waitForTimeout(400)
  expect(await runningLoops(win)).toEqual([])

  await palette(win, 'Codex')
  const codex = win.locator('[data-empty-art="codex"]')
  await expect(codex).toBeVisible()
  await expect(win.getByRole('heading', { name: 'Nothing in the codex yet' })).toBeVisible()
  // The quill's dip is playing (once), and the glow behind it breathes.
  expect(await animations(win, '[data-empty-art="codex"]')).toBeGreaterThanOrEqual(3)
  // (Still for a moment after the palette's last key: Adam was typing.)
  await expect.poll(() => loops(win, '[data-empty-art="codex"]'), { timeout: 4000 }).toEqual(['running'])

  await palette(win, 'Plot threads board')
  const threads = win.locator('[data-empty-art="threads"]')
  await expect(threads).toBeVisible()
  // Three threads weave, and the glow breathes.
  await expect.poll(async () => (await loops(win, '[data-empty-art="threads"]')).filter((s) => s === 'running').length, { timeout: 4000 }).toBeGreaterThanOrEqual(4)
  // Adam typing in a text box anywhere: the loops are still, and go on a moment after the last key.
  await win.evaluate(`(() => {
    const box = document.createElement('input')
    box.id = 'typing-here'
    document.body.append(box)
    box.focus()
  })()`)
  await win.keyboard.type('gull', { delay: 30 })
  expect([...new Set(await loops(win, '[data-empty-art="threads"]'))]).toEqual(['paused'])
  await expect.poll(() => loops(win, '[data-empty-art="threads"]').then((s) => [...new Set(s)]), { timeout: 4000 }).toEqual(['running'])
  await win.evaluate(`document.getElementById('typing-here')?.remove()`)
})

test('the story home’s cover lives, the drawings move on hover and idle in the dossier; the Write room stays still', async ({ launch }) => {
  const { win } = await sampleWorld(launch, DESK)
  // The Write room, a scene open: no living art, and nothing loops but the desk's own small status dots.
  await win.waitForTimeout(400)
  expect(await win.locator('.la').count()).toBe(0)
  expect((await runningLoops(win)).filter((l) => !/on span\.(isl-dot|desk-dock-dot|desk-dock-prog)/.test(l))).toEqual([])

  await win.getByRole('button', { name: 'Story home' }).click()
  const cover = win.locator('[data-living-art="cover"]')
  await expect(cover).toBeVisible()
  // The glow breathes, two sets of stars twinkle, two swells roll, a sheen crosses it, and its drawing idles.
  expect((await loops(win, '[data-living-art="cover"]')).filter((s) => s === 'running').length).toBeGreaterThanOrEqual(6)
  await expect(cover.locator('.aw-motif[data-live]')).toHaveCount(1)

  // The World room: hovering a card plays its drawing's movement; leaving it, the drawing rests.
  await win.getByRole('navigation', { name: 'Rooms' }).getByRole('button', { name: /^World/ }).click()
  const card = win.locator('[data-gallery-card]').filter({ has: win.locator('.aw-motif') }).first()
  await expect(card).toBeVisible()
  // (Each drawing draws itself in, the first time; then it rests.)
  await expect.poll(() => card.locator('.aw-motif[data-draw]').count(), { timeout: 4000 }).toBe(0)
  expect(await animations(win, '[data-gallery-card] .aw-motif')).toBe(0)
  const id = await card.getAttribute('data-gallery-card')
  const drawing = `[data-gallery-card="${id}"] .aw-motif`
  await card.hover()
  await expect.poll(() => animationsIn(win, drawing)).toBeGreaterThan(0)
  await win.mouse.move(2, 2)
  await expect.poll(() => animationsIn(win, drawing)).toBe(0)

  // The dossier: its drawing idles there, the one picture.
  await card.click()
  const live = '.dz-portrait .aw-motif[data-live]'
  await expect(win.locator(live)).toBeVisible()
  await expect.poll(() => animationsIn(win, live), { timeout: 4000 }).toBeGreaterThan(0)
})

test('the ambient art makes no long frames, and costs little while it idles (start screen, story home)', async ({ launch }) => {
  test.setTimeout(90_000)
  const { app, win } = await sampleWorld(launch, DESK)
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.unmaximize()
    w.setContentSize(1920, 1080)
  })

  /** Five seconds of idling: long animation frames, frame times, and the app's CPU use. */
  const measure = async (what: string): Promise<{ long: number[] }> => {
    await win.waitForTimeout(1500)
    await app.evaluate(({ app: a }) => a.getAppMetrics())
    const frames = (await win.evaluate(`new Promise((resolve) => {
      const long = []
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) long.push(Math.round(e.duration))
      })
      obs.observe({ type: 'long-animation-frame', buffered: false })
      const gaps = []
      let last = performance.now()
      const end = last + 5000
      const tick = (now) => {
        gaps.push(now - last)
        last = now
        if (now < end) requestAnimationFrame(tick)
        else {
          obs.disconnect()
          resolve({ long, gaps })
        }
      }
      requestAnimationFrame(tick)
    })`)) as { long: number[]; gaps: number[] }
    const cpu = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10 })))
    const sorted = [...frames.gaps].sort((x, y) => x - y)
    const p = (q: number): number => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] * 10) / 10
    const report = `${what}: ${frames.gaps.length} frames in 5 s, median ${p(0.5)} ms, p95 ${p(0.95)} ms, max ${p(1)} ms; long frames ${JSON.stringify(frames.long)}; CPU ${cpu.map((c) => `${c.type} ${c.cpu}%`).join(', ')}`
    console.log(report)
    test.info().annotations.push({ type: 'frames', description: report })
    return frames
  }

  await win.getByRole('button', { name: 'Story home' }).click()
  await expect(win.locator('[data-living-art="cover"]')).toBeVisible()
  const home = await measure('Story home')
  expect(home.long.filter((d) => d > 50)).toEqual([])

  await palette(win, 'Go to the start screen')
  await expect(harbour(win)).toBeVisible()
  const start = await measure('Start screen')
  expect(start.long.filter((d) => d > 50)).toEqual([])
})
