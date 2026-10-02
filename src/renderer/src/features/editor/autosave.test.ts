import { describe, expect, it } from 'vitest'
import { Autosaver, combineSaveStates, debounce, type AutosaveState, type Timers } from './autosave'

/** Manual clock: advance() runs due timers in order. */
class FakeTimers implements Timers {
  time = 0
  private seq = 0
  private items = new Map<number, { at: number; fn: () => void }>()
  set = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq
    this.items.set(id, { at: this.time + ms, fn })
    return id
  }
  clear = (h: unknown): void => void this.items.delete(h as number)
  now = (): number => this.time
  async advance(ms: number): Promise<void> {
    const end = this.time + ms
    for (;;) {
      const due = [...this.items.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      this.items.delete(due[0])
      this.time = due[1].at
      due[1].fn()
      await flushPromises()
    }
    this.time = end
    await flushPromises()
  }
}

const flushPromises = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

function setup(opts: { fail?: () => boolean; saveMs?: number } = {}) {
  const timers = new FakeTimers()
  const saves: number[] = []
  const states: AutosaveState[] = []
  const saver = new Autosaver({
    timers,
    save: () =>
      new Promise<void>((resolve, reject) => {
        saves.push(timers.time)
        const done = (): void => (opts.fail?.() ? reject(new Error('disk full')) : resolve())
        if (opts.saveMs) timers.set(done, opts.saveMs)
        else done()
      }),
    onState: (s) => states.push(s)
  })
  return { timers, saves, states, saver }
}

describe('Autosaver', () => {
  it('saves half a second after typing pauses', async () => {
    const { timers, saves, saver } = setup()
    saver.changed()
    await timers.advance(300)
    saver.changed()
    await timers.advance(400)
    expect(saves).toEqual([])
    await timers.advance(100)
    expect(saves).toEqual([800])
    expect(saver.dirty).toBe(false)
  })

  it('saves at least every five seconds while typing continues', async () => {
    const { timers, saves, saver } = setup()
    for (let t = 0; t < 12000; t += 200) {
      saver.changed()
      await timers.advance(200)
    }
    expect(saves).toEqual([5000, 10000])
  })

  it('does not flash "Saving…" for quick saves', async () => {
    const { timers, states, saver } = setup({ saveMs: 50 })
    saver.changed()
    await timers.advance(1000)
    expect(states).toEqual(['saved'])
  })

  it('shows "Saving…" when a save is slow', async () => {
    const { timers, states, saver } = setup({ saveMs: 800 })
    saver.changed()
    await timers.advance(2000)
    expect(states).toEqual(['saving', 'saved'])
  })

  it('saves again when more was typed during a save', async () => {
    const { timers, saves, saver } = setup({ saveMs: 300 })
    saver.changed()
    await timers.advance(600) // save starts at 500
    saver.changed() // during the save
    await timers.advance(2000)
    expect(saves.length).toBe(2)
    expect(saver.dirty).toBe(false)
  })

  it('retries with backoff after a failure and shows the error until it succeeds', async () => {
    let failing = true
    const { timers, saves, states, saver } = setup({ fail: () => failing })
    saver.changed()
    await timers.advance(500)
    expect(states).toEqual(['error'])
    await timers.advance(1000) // first retry after 1s
    await timers.advance(2000) // second after 2s
    expect(saves).toEqual([500, 1500, 3500])
    failing = false
    await timers.advance(4000)
    expect(saves).toEqual([500, 1500, 3500, 7500])
    expect(states[states.length - 1]).toBe('saved')
    expect(saver.dirty).toBe(false)
  })

  it('flush saves immediately and waits for it', async () => {
    const { saves, saver } = setup()
    saver.changed()
    expect(await saver.flush()).toBe(true)
    expect(saves).toEqual([0])
    expect(await saver.flush()).toBe(true)
    expect(saves).toEqual([0]) // nothing new to save
  })

  it('flush waits for a running save and then saves the newer changes', async () => {
    const { timers, saves, saver } = setup({ saveMs: 100 })
    saver.changed()
    await timers.advance(550) // save running
    saver.changed()
    const done = saver.flush()
    await timers.advance(300)
    expect(await done).toBe(true)
    expect(saves.length).toBe(2)
  })

  it('stops after dispose', async () => {
    const { timers, saves, saver } = setup()
    saver.changed()
    saver.dispose()
    await timers.advance(6000)
    expect(saves).toEqual([])
  })
})

describe('debounce', () => {
  it('fires after a pause and at least every maxWait', async () => {
    const timers = new FakeTimers()
    const calls: number[] = []
    const d = debounce(() => calls.push(timers.time), 250, 2000, timers)
    d.call()
    await timers.advance(300)
    expect(calls).toEqual([250])
    for (let t = 0; t < 4500; t += 100) {
      d.call()
      await timers.advance(100)
    }
    expect(calls).toEqual([250, 2300, 4300])
    d.cancel()
    await timers.advance(1000)
    expect(calls.length).toBe(3)
  })
})

describe('combineSaveStates', () => {
  it('shows a failing save even when the open scene saved fine', () => {
    expect(combineSaveStates(['saved', 'error'])).toBe('error')
    expect(combineSaveStates(['error', 'saving'])).toBe('error')
  })

  it('shows saving while any save is running, else saved', () => {
    expect(combineSaveStates(['saved', 'saving'])).toBe('saving')
    expect(combineSaveStates(['saved', null])).toBe('saved')
  })

  it('reports nothing when no scene has saved yet', () => {
    expect(combineSaveStates([null, undefined])).toBeNull()
    expect(combineSaveStates([])).toBeNull()
  })
})
