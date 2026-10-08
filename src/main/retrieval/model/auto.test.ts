// The search model downloads by itself (Adam, 2026-10-08): when it starts and when it doesn't. The download is a
// stand-in and the clock and timers are the test's own: nothing waits and nothing goes near the internet.
import { describe, expect, it } from 'vitest'
import type { SearchModelState } from '@shared/contracts/searchModel'
import type { DownloadEnd } from './manager'
import { AUTO_AFTER_START_MS, AutoDownload, autoAllowed, autoWanted, retryAfter, RETRY_FIRST_MS, RETRY_MAX_MS, startDelay } from './auto'

const HOUR = 60 * 60_000

/** An AutoDownload on a pretend clock, with a stand-in download that ends as told. */
function rig(o: { wanted?: boolean; state?: SearchModelState; ends?: DownloadEnd[] } = {}) {
  let clock = 0
  const timers: { fn: () => void; at: number; live: boolean }[] = []
  const r = {
    wanted: o.wanted ?? true,
    state: o.state ?? ('none' as SearchModelState),
    ends: [...(o.ends ?? ['done'])],
    downloads: 0,
    auto: null as unknown as AutoDownload,
    /** Moves the clock on, running each timer that comes due, and lets the downloads settle. */
    async pass(ms: number) {
      clock += ms
      for (;;) {
        const due = timers.find((t) => t.live && t.at <= clock)
        if (!due) break
        due.live = false
        due.fn()
        await new Promise((res) => setTimeout(res, 0))
      }
    }
  }
  r.auto = new AutoDownload({
    wanted: () => r.wanted,
    state: () => r.state,
    download: async () => {
      r.downloads++
      const end = r.ends.shift() ?? 'done'
      if (end === 'done') r.state = 'starting'
      return end
    },
    now: () => clock,
    setTimer: (fn, ms) => {
      const t = { fn, at: clock + ms, live: true }
      timers.push(t)
      return t
    },
    clearTimer: (t) => void ((t as { live: boolean }).live = false)
  })
  return r
}

describe('whether it may download by itself', () => {
  it('only with Find by meaning on and nothing Adam pressed against it', () => {
    const env = {}
    expect(autoWanted({ findByMeaning: true, searchModelAuto: true }, env)).toBe(true)
    // Settings from before 0.6.31 have no searchModelAuto: on.
    expect(autoWanted({ findByMeaning: true }, env)).toBe(true)
    expect(autoWanted({ findByMeaning: false, searchModelAuto: true }, env)).toBe(false)
    // Stop or Remove pressed.
    expect(autoWanted({ findByMeaning: true, searchModelAuto: false }, env)).toBe(false)
  })

  it('never in app tests or unit tests, nor with step 5 off or the stand-in model', () => {
    expect(autoAllowed({})).toBe(true)
    expect(autoAllowed({ AIWRITE_SEARCH_MODEL_AUTO: 'off' })).toBe(false)
    expect(autoAllowed({ AIWRITE_RECALL: 'off' })).toBe(false)
    expect(autoAllowed({ AIWRITE_SEARCH_MODEL: 'stub' })).toBe(false)
    expect(autoWanted({ findByMeaning: true }, { AIWRITE_SEARCH_MODEL_AUTO: 'off' })).toBe(false)
    // This run itself (vitest.config.ts).
    expect(autoAllowed()).toBe(false)
  })

  it('waits a little after start-up', () => {
    expect(startDelay({})).toBe(AUTO_AFTER_START_MS)
    expect(AUTO_AFTER_START_MS).toBeGreaterThanOrEqual(30_000)
    expect(startDelay({ AIWRITE_SEARCH_MODEL_AUTO_MS: '500' })).toBe(500)
    expect(startDelay({ AIWRITE_SEARCH_MODEL_AUTO_MS: 'soon' })).toBe(AUTO_AFTER_START_MS)
  })
})

describe('the download by itself', () => {
  it('starts once, after the wait, when the model is not here', async () => {
    const r = rig()
    r.auto.soon(AUTO_AFTER_START_MS)
    await r.pass(AUTO_AFTER_START_MS - 1)
    expect(r.downloads).toBe(0)
    await r.pass(1)
    expect(r.downloads).toBe(1)
    // Here now: looking again starts nothing.
    r.auto.soon(0)
    await r.pass(HOUR)
    expect(r.downloads).toBe(1)
    expect(r.auto.waiting).toBe(false)
  })

  it('does not start when the model is here or already downloading', async () => {
    for (const state of ['ready', 'starting', 'downloading', 'broken'] as const) {
      const r = rig({ state })
      r.auto.soon(0)
      await r.pass(AUTO_AFTER_START_MS)
      expect(r.downloads).toBe(0)
    }
  })

  it('does not start with Find by meaning off, or after Stop or Remove', async () => {
    const r = rig({ wanted: false })
    r.auto.soon(AUTO_AFTER_START_MS)
    await r.pass(AUTO_AFTER_START_MS)
    expect(r.downloads).toBe(0)
  })

  it('looks at the settings as they are when the wait is over', async () => {
    const r = rig()
    r.auto.soon(AUTO_AFTER_START_MS)
    // Adam turns Find by meaning off in the meantime.
    r.wanted = false
    await r.pass(AUTO_AFTER_START_MS)
    expect(r.downloads).toBe(0)
  })

  it('a download Adam stopped is not started again', async () => {
    const r = rig({ ends: ['stopped'] })
    r.auto.soon(0)
    await r.pass(0)
    expect(r.downloads).toBe(1)
    await r.pass(10 * RETRY_MAX_MS)
    expect(r.downloads).toBe(1)
  })

  it('tries again after a failure an hour later, then two, never sooner', async () => {
    const r = rig({ ends: ['failed', 'failed', 'done'] })
    r.auto.soon(0)
    await r.pass(0)
    expect(r.downloads).toBe(1)
    expect(r.auto.failures).toBe(1)
    await r.pass(HOUR / 2)
    // The switch turned off and on meanwhile doesn't bring it forward.
    r.auto.soon(5_000)
    await r.pass(5_000)
    expect(r.downloads).toBe(1)
    await r.pass(HOUR / 2 - 5_000 - 1)
    expect(r.downloads).toBe(1)
    await r.pass(1)
    expect(r.downloads).toBe(2)
    await r.pass(2 * HOUR - 1)
    expect(r.downloads).toBe(2)
    await r.pass(1)
    expect(r.downloads).toBe(3)
    expect(r.auto.failures).toBe(0)
    await r.pass(10 * RETRY_MAX_MS)
    expect(r.downloads).toBe(3)
  })

  it('waits at most a day between tries', () => {
    expect(retryAfter(1)).toBe(RETRY_FIRST_MS)
    expect(retryAfter(2)).toBe(2 * RETRY_FIRST_MS)
    expect(retryAfter(20)).toBe(RETRY_MAX_MS)
  })

  it('a download that throws counts as failed', async () => {
    const r = rig()
    const auto = new AutoDownload({
      wanted: () => true,
      state: () => 'none',
      download: async () => {
        r.downloads++
        throw new Error('offline')
      },
      setTimer: () => ({}),
      clearTimer: () => undefined
    })
    expect(await auto.check()).toBe('failed')
    expect(auto.failures).toBe(1)
    // Too soon to try again.
    expect(await auto.check()).toBeNull()
    expect(r.downloads).toBe(1)
    auto.close()
  })

  it('a sooner look replaces a later one; closing ends it', async () => {
    const r = rig()
    r.auto.soon(AUTO_AFTER_START_MS)
    r.auto.soon(5_000)
    await r.pass(5_000)
    expect(r.downloads).toBe(1)
    const q = rig()
    q.auto.soon(AUTO_AFTER_START_MS)
    q.auto.close()
    await q.pass(AUTO_AFTER_START_MS)
    expect(q.downloads).toBe(0)
  })
})
