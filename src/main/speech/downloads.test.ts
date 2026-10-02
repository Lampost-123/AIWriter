import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpeechDownloadKind } from '@shared/contracts/speech'
import { DONE_SHOWS_MS, Downloads, type DownloadDeps } from './downloads'
import type { Failure } from './output'
import type { Step } from './plan'
import type { RunResult, RunUpdate } from './runner'
import { UserError } from '../util'

const step = (id: string, label = `Doing ${id}`): Step => ({
  id,
  label,
  command: 'python',
  args: [id],
  progress: 'whole',
  fails: `${id} failed.`
})

/** A run the test finishes by hand. */
interface FakeRun {
  steps: Step[]
  update(u: Partial<RunUpdate>): void
  finish(r: RunResult): void
  cancelled: boolean
}

function setup(plans: Partial<Record<SpeechDownloadKind, { steps: Step[] } | { failure: Failure }>> = {}) {
  const runs: FakeRun[] = []
  const finished: string[] = []
  let changes = 0
  const deps: DownloadDeps = {
    plan: async (kind) => plans[kind] ?? { steps: [step(`${kind}-1`), step(`${kind}-2`)] },
    runner: (steps, onUpdate) => {
      let finish: (r: RunResult) => void = () => undefined
      const done = new Promise<RunResult>((r) => (finish = r))
      const run: FakeRun = {
        steps,
        cancelled: false,
        update: (u) =>
          onUpdate({
            stepId: steps[0].id,
            label: steps[0].label,
            index: 1,
            count: steps.length,
            percent: null,
            amount: '',
            line: '',
            ...u
          }),
        finish: (r) => finish(r)
      }
      runs.push(run)
      return {
        run: () => done,
        cancel: () => {
          run.cancelled = true
          finish({ outcome: 'cancelled' })
        }
      }
    },
    finished: async (kind) => {
      finished.push(kind)
    },
    changed: () => {
      changes++
    }
  }
  return { d: new Downloads(deps), runs, finished, changes: () => changes }
}

/** Lets the downloads' promises settle. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

afterEach(() => vi.useRealTimers())

describe('the speech downloads', () => {
  it('show their step, its number and progress as they run', async () => {
    const { d, runs } = setup()
    d.start('server')
    expect(d.current).toMatchObject({ kind: 'server', state: 'running', step: 'Getting ready' })
    await settle()
    runs[0].update({
      stepId: 'server-2',
      label: 'Downloading the speech engine',
      index: 2,
      count: 2,
      percent: 40,
      amount: '16 MB of about 40 MB',
      line: 'Progress 16 of 40'
    })
    expect(d.current).toMatchObject({
      step: 'Downloading the speech engine',
      stepIndex: 2,
      stepCount: 2,
      percent: 40,
      amount: '16 MB of about 40 MB',
      line: 'Progress 16 of 40'
    })
    expect(d.busy).toBe(true)
    expect(d.pending('server')).toBe(true)
  })

  it('record a download that finished, say so for a moment, then clear', async () => {
    vi.useFakeTimers()
    const { d, runs, finished } = setup()
    d.start('whisper')
    await vi.advanceTimersByTimeAsync(0)
    runs[0].finish({ outcome: 'done', gpu: null })
    await vi.advanceTimersByTimeAsync(0)
    expect(finished).toEqual(['whisper'])
    expect(d.current).toMatchObject({ kind: 'whisper', state: 'done', percent: 100 })
    await vi.advanceTimersByTimeAsync(DONE_SHOWS_MS + 10)
    expect(d.current).toBeNull()
  })

  it('run one at a time: the next waits, then starts by itself', async () => {
    const { d, runs, finished } = setup()
    d.start('server')
    d.start('voices')
    d.start('voices')
    expect(d.queue).toEqual(['voices'])
    expect(d.pending('voices')).toBe(true)
    await settle()
    runs[0].finish({ outcome: 'done', gpu: null })
    await settle()
    expect(finished).toEqual(['server'])
    expect(d.current).toMatchObject({ kind: 'voices', state: 'running' })
    expect(d.queue).toEqual([])
    expect(runs).toHaveLength(2)
  })

  it('stop at Cancel, with the ones waiting, and leave Try again', async () => {
    const { d, runs, finished } = setup()
    d.start('server')
    d.start('parakeet')
    await settle()
    d.cancel()
    expect(runs[0].cancelled).toBe(true)
    expect(d.current).toMatchObject({ kind: 'server', state: 'cancelled' })
    expect(d.queue).toEqual([])
    await settle()
    expect(finished).toEqual([])
    expect(d.busy).toBe(false)
    // Try again starts it over.
    d.start('server')
    expect(d.current).toMatchObject({ kind: 'server', state: 'running' })
  })

  it('keep a problem in view with its fix, and forget the ones waiting', async () => {
    const { d, runs } = setup()
    d.start('server')
    d.start('voices')
    await settle()
    runs[0].finish({ outcome: 'failed', failure: { error: 'Couldn’t reach the internet to download it.', need: null, link: '' } })
    await settle()
    expect(d.current).toMatchObject({ kind: 'server', state: 'failed', error: 'Couldn’t reach the internet to download it.' })
    expect(d.queue).toEqual([])
    d.dismiss()
    expect(d.current).toBeNull()
  })

  it('stop before any step when Python is missing, asking to install it', async () => {
    const failure: Failure = { error: 'The speech engine runs on Python, which isn’t on this computer yet.', need: 'python', link: '' }
    const { d, runs } = setup({ server: { failure } })
    d.start('server')
    await settle()
    expect(runs).toHaveLength(0)
    expect(d.current).toMatchObject({ kind: 'server', state: 'failed', need: 'python', error: failure.error })
  })

  it('install Python first, then carry on with the server’s own download', async () => {
    const { d, runs } = setup()
    const then = vi.fn(() => d.start('server'))
    d.startWith('server', [step('python', 'Installing Python with Windows’ installer')], then)
    await settle()
    expect(runs[0].steps.map((s) => s.id)).toEqual(['python'])
    expect(d.current).toMatchObject({ kind: 'server', state: 'running' })
    runs[0].finish({ outcome: 'done', gpu: null })
    await settle()
    expect(then).toHaveBeenCalledOnce()
    // The server's own steps take over the card; Python's step never shows as a finished download.
    expect(runs[1].steps.map((s) => s.id)).toEqual(['server-1', 'server-2'])
    expect(d.current).toMatchObject({ kind: 'server', state: 'running', step: 'Getting ready' })
  })

  it('ignore news from a run that was cancelled', async () => {
    const { d, runs } = setup()
    d.start('voices')
    await settle()
    const old = runs[0]
    d.cancel()
    d.start('voices')
    await settle()
    old.update({ percent: 99, line: 'from the old run' })
    expect(d.current).toMatchObject({ state: 'running', line: '' })
  })

  it('tell the window each time something changes', async () => {
    const { d, runs, changes } = setup()
    const before = changes()
    d.start('server')
    await settle()
    runs[0].update({ percent: 10 })
    expect(changes()).toBeGreaterThanOrEqual(before + 2)
  })

  it('turn anything unexpected into plain words, never a program’s own message', async () => {
    const d = new Downloads({
      plan: async () => ({ steps: [step('one')] }),
      runner: () => ({ run: () => Promise.reject(new Error('spawn EACCES')), cancel: () => undefined }),
      finished: () => undefined,
      changed: () => undefined
    })
    d.start('server')
    await settle()
    expect(d.current).toMatchObject({ state: 'failed', error: 'The download stopped. Try again.' })
    const e = new Downloads({
      plan: async () => {
        throw new UserError('The speech folder couldn’t be made. Check there is space on the disk.')
      },
      runner: () => ({ run: async () => ({ outcome: 'done', gpu: null }), cancel: () => undefined }),
      finished: () => undefined,
      changed: () => undefined
    })
    e.start('server')
    await settle()
    expect(e.current).toMatchObject({ state: 'failed', error: 'The speech folder couldn’t be made. Check there is space on the disk.' })
  })
})
