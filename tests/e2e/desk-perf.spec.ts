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
    const frames = await win.evaluate<{ start: number; duration: number }[]>('window.__frames')
    // The frames while the words arrive: after the warm-up, and over before the draft ends. The frame that ends it (the
    // draft put back as one undo step, saved and counted) was already about 50 to 70 ms here before the lamp, so it is
    // held to a looser limit of its own.
    const writing = frames.filter((f) => f.start >= start + WARM_UP_MS && f.start + f.duration < ended)
    const worst = Math.max(0, ...writing.map((f) => f.duration))
    const all = Math.max(0, ...frames.map((f) => f.duration))
    console.log(`desk-perf: wrote for ${Math.round(ended - start)} ms; ${frames.length} long frames in all (worst ${Math.round(all)} ms), ${writing.length} while writing after warm-up (worst ${Math.round(worst)} ms)`)
    expect(writing.filter((f) => f.duration > LONG_FRAME_MS)).toEqual([])
    expect(all).toBeLessThan(ANY_FRAME_MS)

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
    // How far the page moves each frame while the change is written.
    await win.evaluate(`(() => {
      const el = document.querySelector('.desk-scroller')
      window.__steps = []
      let last = el.scrollTop
      const tick = () => {
        const writing = !!document.querySelector('.scene-prose .aw-sugg-caret')
        if (writing) window.__steps.push(el.scrollTop - last)
        last = el.scrollTop
        window.__stepRaf = requestAnimationFrame(tick)
      }
      tick()
    })()`)
    await dock(win).getByRole('button', { name: /^Continue/ }).click()
    await expect(prose.locator('.aw-sugg-words .aw-arrive').first()).toBeAttached()
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'review', { timeout: 30_000 })
    const steps = await win.evaluate<number[]>('(cancelAnimationFrame(window.__stepRaf), window.__steps)')
    // Leaving out the change being brought into view at the start (in one step, as before).
    const moving = steps.slice(steps.findIndex((s) => s !== 0) + 1)
    const moved = moving.reduce((a, b) => a + b, 0)
    const biggest = Math.max(0, ...moving.map(Math.abs))
    console.log(`desk-perf: Continue followed ${Math.round(moved)} px over ${moving.length} frames; biggest step ${Math.round(biggest)} px`)
    expect(moved).toBeGreaterThan(100)
    // A line at a time would be a step of a whole line (about 30 px or more): the page glides instead.
    expect(biggest).toBeLessThan(25)
    await win.keyboard.press('Tab')
    await expect(dock(win)).toHaveAttribute('data-desk-dock', 'idle')
    await expect(prose.locator('.aw-settle-words').first()).toBeAttached()
    await expect(prose.locator('.aw-settle-words')).toHaveCount(0, { timeout: 3000 })
  } finally {
    await fake.close()
  }
})
