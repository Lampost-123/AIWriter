// The desk keeps up with a long scene (UI overhaul, phase 3, D3.6 "the lamp"): a 10,000-word scene on the sample
// world, with its margin notes, while Add below streams about 600 words into it at a chunk every 30 ms (the words
// fading in, the lamp line, the page following them). The browser's long-animation-frame entries must show no frame
// over 50 ms while the words arrive, once the first moments are past, and a key pressed while nothing is being written
// must reach the next frame quickly. The text is invented here; the fake provider writes the draft.
import type { Page } from '@playwright/test'
import { expect, invoke, test, useFakeModel } from './helpers'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk' }
const dock = (win: Page) => win.getByRole('toolbar', { name: 'AI dock' })

/** The first moments after Add below (the request, the first words) don't count: the browser is warming up. */
const WARM_UP_MS = 1500
/** A long animation frame is one over 50 ms; none may come while the words arrive, once warmed up. */
const LONG_FRAME_MS = 50
/** No frame at all, the warm-up and the draft's end included, may be longer than this (this PC: about 50 to 55 ms). */
const ANY_FRAME_MS = 150
/** A key pressed on the idle page reaches the next frame within this, for 95 keys in 100 (this PC sees about 5 to 9 ms). */
const KEY_P95_MS = 50

/** About 10,000 words of invented prose: a hundred paragraphs of about a hundred words, none quite the same. */
function longScene(): string {
  const sentences = [
    'The ferry left the north pier before the bell had finished, and the gulls followed it out past the breakwater.',
    'Nobody on deck spoke of the cargo, though every one of them had watched it come aboard under canvas.',
    'A boy with a ledger counted the crates twice and wrote the same number both times, which pleased him.',
    'Far off, the hills were the colour of old pewter, and the rain over them had not yet decided to come.',
    'The captain kept one hand on the rail and the other in his coat, where a letter waited to be read.',
    'Someone below was playing a fiddle badly, the same four bars over and over, as if practice could save it.',
    'By the second hour the wind had turned, and the smell of salt gave way to the smell of wet wool and tar.',
    'She found a seat out of the spray and opened the book she had promised herself she would finish.',
    'The pages were swollen with damp, and the last chapter stuck together as though it had a secret to keep.'
  ]
  const paras: string[] = []
  for (let p = 0; p < 100; p++) {
    const s: string[] = []
    for (let i = 0; i < 5; i++) s.push(sentences[(p * 2 + i * 7) % sentences.length])
    paras.push(`Part ${p + 1}. ${s.join(' ')}`)
  }
  return paras.join('\n\n')
}

test('the desk keeps up with a 10,000-word scene while Add below writes 600 words, and typing stays quick', async ({ launch }) => {
  test.setTimeout(90_000)
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ slowWords: 600, slowDelayMs: 30 })
  try {
    const { win } = await launch({ env: { ...DESK, AIWRITE_KEEPER_QUIET_MS: '600000' } })
    await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
    await invoke(win, 'openSampleWorld')
    const [story] = await invoke(win, 'listStories')
    const { scenes } = await invoke(win, 'getOutline', story.id)
    const text = longScene()
    await invoke(win, 'saveSceneText', scenes[0].id, null, text)
    await useFakeModel(win, fake, 'fake/slow')
    const prose = win.locator('.scene-prose')
    await expect(prose).toContainText('Part 100. ')
    expect(text.split(/\s+/).length).toBeGreaterThanOrEqual(10_000)
    // The margin notes have come (the sample world's slips beside its paragraphs), and the page is at its end, so it follows the draft.
    await win.evaluate(`(() => { const el = document.querySelector('.desk-scroller'); el.scrollTop = el.scrollHeight })()`)
    await win.waitForTimeout(500)

    // Long animation frames from here on, with when Add below was pressed and when the draft ended (the lamp line went).
    const start = await win.evaluate<number>(`(() => {
      window.__frames = []
      window.__ended = 0
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__frames.push({ start: e.startTime, duration: e.duration })
      }).observe({ type: 'long-animation-frame', buffered: false })
      const prose = document.querySelector('.scene-prose')
      let wrote = false
      // Only class changes (the lamp line moving to a new paragraph, the warm ink): a handful while it writes.
      new MutationObserver(() => {
        const on = !!prose.querySelector('p.aw-writing')
        if (on) wrote = true
        else if (wrote && !window.__ended) window.__ended = performance.now()
      }).observe(prose, { subtree: true, attributes: true, attributeFilter: ['class'] })
      return performance.now()
    })()`)
    await dock(win).getByRole('button', { name: /^Add below/ }).click()
    await expect(dock(win)).toContainText(/Writing… \d+ words?/)
    // While it writes, the lamp line stands beside the paragraph being written and the newest words fade in.
    await expect(prose.locator('p.aw-writing')).toHaveCount(1)
    await expect(prose.locator('.aw-arrive').first()).toBeAttached()
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle', { timeout: 40_000 })
    // Once done: the lamp line goes, and the settle into ink has its class taken away again.
    await expect(prose.locator('p.aw-writing')).toHaveCount(0)
    await expect(prose.locator('.aw-settle')).toHaveCount(0, { timeout: 3000 })
    await expect(prose.locator('.aw-arrive')).toHaveCount(0)
    // The page followed the draft to its end (Adam was at the end of the page when it started).
    await expect
      .poll(() => win.evaluate<number>(`(() => { const el = document.querySelector('.desk-scroller'); return el.scrollHeight - el.scrollTop - el.clientHeight })()`))
      .toBeLessThan(4)

    const ended = await win.evaluate<number>('window.__ended')
    expect(ended).toBeGreaterThan(start)
    // Only frames from Add below on: the observer also hands over frames that were already over before it started (the
    // page scrolling to the end of the long scene, just before), which aren't the draft's.
    const frames = (await win.evaluate<{ start: number; duration: number }[]>('window.__frames')).filter((f) => f.start + f.duration >= start)
    // The frames while the words arrive: after the warm-up, and over before the draft ends. The frame that ends it (the
    // draft put back as one undo step, saved and counted) was already about 50 to 70 ms here before the lamp, so it is
    // held to a looser limit of its own.
    const writing = frames.filter((f) => f.start >= start + WARM_UP_MS && f.start + f.duration < ended)
    const worst = Math.max(0, ...writing.map((f) => f.duration))
    const all = Math.max(0, ...frames.map((f) => f.duration))
    console.log(`desk-perf: wrote for ${Math.round(ended - start)} ms; ${frames.length} long frames in all (worst ${Math.round(all)} ms), ${writing.length} while writing after warm-up (worst ${Math.round(worst)} ms)`)
    // CI's shared runners are slower and noisier than a writer's PC: there a frame or two just over the line is
    // allowed, and the whole stays within a looser bound; on a PC the strict limits hold.
    if (process.env.CI || process.env.PERF_THROTTLE) {
      expect(writing.filter((f) => f.duration > LONG_FRAME_MS * 2)).toEqual([])
      expect(all).toBeLessThan(ANY_FRAME_MS * 3)
    } else {
      expect(writing.filter((f) => f.duration > LONG_FRAME_MS)).toEqual([])
      expect(all).toBeLessThan(ANY_FRAME_MS)
    }

    // Typing on the idle page: from each key to the frame after it.
    await prose.click()
    await win.keyboard.press('Control+End')
    await win.evaluate(`(() => {
      window.__keys = []
      const channel = new MessageChannel()
      let at = 0
      channel.port1.onmessage = () => window.__keys.push(performance.now() - at)
      document.addEventListener('keydown', (e) => {
        at = e.timeStamp
        // Just after the frame the key's change is drawn in.
        requestAnimationFrame(() => channel.port2.postMessage(null))
      }, { capture: true })
    })()`)
    await win.keyboard.type(' and the harbour lights came on one by one along the wall', { delay: 40 })
    const keys = await win.evaluate<number[]>('window.__keys')
    const sorted = [...keys].sort((a, b) => a - b)
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
    console.log(`desk-perf: ${keys.length} keys, median ${Math.round(sorted[Math.floor(sorted.length / 2)])} ms, p95 ${Math.round(p95)} ms, worst ${Math.round(sorted[sorted.length - 1])} ms`)
    expect(keys.length).toBeGreaterThanOrEqual(50)
    expect(p95).toBeLessThan(KEY_P95_MS)
    await expect(prose).toContainText('the harbour lights came on one by one along the wall')
  } finally {
    await fake.close()
  }
})

test('Continue’s words fade in and the page glides along with them, then settle into the page once accepted', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ slowWords: 300, slowDelayMs: 30 })
  try {
    const { win } = await launch({ env: { ...DESK, AIWRITE_KEEPER_QUIET_MS: '600000' } })
    await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
    await invoke(win, 'openSampleWorld')
    await useFakeModel(win, fake, 'fake/slow')
    const prose = win.locator('.scene-prose')
    await expect(prose).toContainText('A hundred and twelve steps to the lamp room.')
    // (P6_THROTTLE=4 slows the window's CPU fourfold, as on CI's runners, to see the glide there.)
    if (process.env.P6_THROTTLE) await (await win.context().newCDPSession(win)).send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.P6_THROTTLE) })
    // How far the page moves each frame while the change is written, and how long each frame was.
    await win.evaluate(`(() => {
      const el = document.querySelector('.desk-scroller')
      window.__steps = []
      let last = el.scrollTop
      let lastT = performance.now()
      const tick = (now) => {
        const writing = !!document.querySelector('.scene-prose .aw-sugg-caret')
        if (writing) window.__steps.push([el.scrollTop - last, now - lastT])
        last = el.scrollTop
        lastT = now
        window.__stepRaf = requestAnimationFrame(tick)
      }
      window.__stepRaf = requestAnimationFrame(tick)
    })()`)
    await dock(win).getByRole('button', { name: /^Continue/ }).click()
    await expect(prose.locator('.aw-sugg-words .aw-arrive').first()).toBeAttached()
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'review', { timeout: 30_000 })
    const steps = await win.evaluate<[number, number][]>('(cancelAnimationFrame(window.__stepRaf), window.__steps)')
    // Leaving out the change being brought into view at the start (in one step, as before).
    const moving = steps.slice(steps.findIndex(([d]) => d !== 0) + 1)
    const moved = moving.reduce((a, [d]) => a + d, 0)
    // Gliding, the page moves a little on nearly every frame between its first and last move (it waits only while it
    // has caught up with the words); going a line at a time it would sit still on most frames and then jump a whole line
    // (about 30 px). Both are measured in frames that moved and frames that didn't, not in pixels per frame: how far a
    // timed glide (scrollGlide.ts) goes in one frame depends on how fast the screen draws, and CI's virtual screen draws
    // fewer, uneven frames (a cap of 25 px a frame measured that, not the glide).
    // The glide is timed (scrollGlide.ts: a share of the gap for the time passed, never faster than 1.2 px a ms), so the
    // page's speed is measured over a tenth of a second at a time, not per frame: frames come unevenly (fewer, and late,
    // on CI's slower machines, where the words also arrive in bunches), and a single frame's step measured the machine.
    const WINDOW = 100
    let fastest = 0
    for (let i = 0; i < moving.length; i++) {
      let px = 0
      let ms = 0
      for (let j = i; j < moving.length && ms < WINDOW; j++) {
        px += Math.abs(moving[j][0])
        ms += moving[j][1]
      }
      if (ms >= WINDOW) fastest = Math.max(fastest, px / ms)
    }
    // Gliding, the page moves on nearly every frame between its first and last move (it waits only while it has caught
    // up with the words); going a line at a time it would sit still on most frames and then jump a whole line.
    const first = moving.findIndex(([d]) => d !== 0)
    const lastMove = moving.length - 1 - [...moving].reverse().findIndex(([d]) => d !== 0)
    const span = first < 0 ? [] : moving.slice(first, lastMove + 1)
    const still = span.filter(([d]) => d === 0).length / Math.max(1, span.length)
    console.log(
      `desk-perf: Continue followed ${Math.round(moved)} px over ${moving.length} frames; fastest ${fastest.toFixed(2)} px a ms over a tenth of a second; still on ${Math.round(still * 100)}% of the frames while moving`
    )
    expect(moved).toBeGreaterThan(100)
    // About the glide's top speed at most (1.2 px a ms, with room for rounding and the editor keeping the words in view):
    // a line at a time at 60 frames a second would be 30 px a frame, 1.8 px a ms.
    expect(fastest).toBeLessThan(1.6)
    expect(still).toBeLessThan(0.8)
    await win.keyboard.press('Tab')
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle')
    await expect(prose.locator('.aw-settle-words').first()).toBeAttached()
    await expect(prose.locator('.aw-settle-words')).toHaveCount(0, { timeout: 3000 })
  } finally {
    await fake.close()
  }
})
