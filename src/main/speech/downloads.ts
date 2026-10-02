// Adapted from mcreader-v2, src/server/speech/install.ts (one download at a time, its step and progress kept
// for Settings, Cancel ends it) (Adam's rule, 2 October 2026: only speech code is reused).
//
// The speech engine's downloads, one at a time: the one running, the ones waiting behind it, and the last
// one that failed or was cancelled (for Try again). Planning, running and what happens after are passed in
// (src/main/speech/index.ts), so this is tested without Electron or Python.
import type { SpeechDownload, SpeechDownloadKind } from '@shared/contracts/speech'
import type { Failure } from './output'
import type { Step } from './plan'
import type { RunResult, RunUpdate } from './runner'
import { UserError } from '../util'

export interface DownloadDeps {
  /** The steps, worked out as the download starts (what is already there is skipped), or why it can't start. */
  plan(kind: SpeechDownloadKind): Promise<{ steps: Step[] } | { failure: Failure }>
  /** Something that runs the steps and can be cancelled (a StepRunner). */
  runner(steps: Step[], onUpdate: (u: RunUpdate) => void): { run(): Promise<RunResult>; cancel(): void }
  /** After a download finished: record it, start or tell the server. */
  finished(kind: SpeechDownloadKind, result: { gpu: string | null }): Promise<void> | void
  /** A download stopped on a problem, at the step with this id ('' when it stopped before its first step). */
  failed?(kind: SpeechDownloadKind, stepId: string): void
  /** Something Settings shows changed. */
  changed(): void
}

/** How long "Downloaded" shows before the card goes. */
export const DONE_SHOWS_MS = 4000

/** A message meant for Adam (a UserError) as it is; anything else as the plain sentence given. */
const errorText = (e: unknown, fallback: string): string => (e instanceof UserError && e.message ? e.message : fallback)

export class Downloads {
  current: SpeechDownload | null = null
  queue: SpeechDownloadKind[] = []
  /** The run going now; a newer run (or Cancel) replaces it, and the older one's news is then ignored. */
  private token: object | null = null
  private running: { cancel(): void } | null = null
  private doneTimer: ReturnType<typeof setTimeout> | null = null
  /** Steps run instead of the planned ones for the next start (installing Python). */
  private override: { kind: SpeechDownloadKind; steps: Step[]; then: () => void } | null = null

  constructor(private readonly deps: DownloadDeps) {}

  get busy(): boolean {
    return this.current?.state === 'running'
  }

  /** Starts `kind`, or queues it behind the one running. Starting again after a failure is Try again. */
  start(kind: SpeechDownloadKind): void {
    if (this.busy) {
      if (this.current?.kind !== kind && !this.queue.includes(kind)) this.queue.push(kind)
      this.deps.changed()
      return
    }
    void this.begin(kind)
  }

  /** Runs these steps as `kind`'s download (Python's installer), then `then` when they succeed. */
  startWith(kind: SpeechDownloadKind, steps: Step[], then: () => void): void {
    if (this.busy) return
    this.override = { kind, steps, then }
    void this.begin(kind)
  }

  /** Cancel: stops the download running and forgets the ones waiting. */
  cancel(): void {
    this.queue = []
    if (this.busy && this.current) {
      this.token = null
      this.current = { ...this.current, state: 'cancelled', percent: null, error: '', need: null, link: '' }
      this.running?.cancel()
      this.running = null
    }
    this.deps.changed()
  }

  /** Hides a finished, failed or cancelled download. */
  dismiss(): void {
    if (this.busy) return
    this.current = null
    this.deps.changed()
  }

  /** Takes `kind` out of the downloads waiting (Adam picked the other dictation model before it began). */
  unqueue(kind: SpeechDownloadKind): void {
    if (!this.queue.includes(kind)) return
    this.queue = this.queue.filter((k) => k !== kind)
    this.deps.changed()
  }

  /** Is `kind` running or waiting? */
  pending(kind: SpeechDownloadKind): boolean {
    return (this.busy && this.current?.kind === kind) || this.queue.includes(kind)
  }

  private set(token: object, patch: Partial<SpeechDownload>): boolean {
    if (this.token !== token || !this.current) return false
    this.current = { ...this.current, ...patch }
    this.deps.changed()
    return true
  }

  private async begin(kind: SpeechDownloadKind): Promise<void> {
    if (this.doneTimer) clearTimeout(this.doneTimer)
    this.doneTimer = null
    this.queue = this.queue.filter((k) => k !== kind)
    const token = {}
    this.token = token
    this.current = {
      kind,
      state: 'running',
      step: 'Getting ready',
      stepIndex: 0,
      stepCount: 0,
      percent: null,
      amount: '',
      line: '',
      error: '',
      need: null,
      link: ''
    }
    this.deps.changed()

    const override = this.override?.kind === kind ? this.override : null
    this.override = null
    let steps: Step[]
    if (override) steps = override.steps
    else {
      const planned = await this.deps.plan(kind).catch((e: unknown): { failure: Failure } => ({
        failure: { error: errorText(e, 'The download couldn’t start. Try again.'), need: null, link: '' }
      }))
      if (this.token !== token) return
      if ('failure' in planned) return this.fail(token, planned.failure)
      steps = planned.steps
    }

    let at = ''
    const runner = this.deps.runner(steps, (u) => {
      if (this.token === token) at = u.stepId
      this.set(token, { step: u.label, stepIndex: u.index, stepCount: u.count, percent: u.percent, amount: u.amount, line: u.line })
    })
    this.running = runner
    const result = await runner.run().catch(
      (e: unknown): RunResult => ({
        outcome: 'failed',
        failure: { error: errorText(e, 'The download stopped. Try again.'), need: null, link: '' }
      })
    )
    // Cancelled (Cancel already said so) or replaced.
    if (this.token !== token) return
    this.running = null
    if (result.outcome === 'cancelled') {
      this.queue = []
      this.set(token, { state: 'cancelled', percent: null })
      return
    }
    if (result.outcome === 'failed') return this.fail(token, result.failure, at)

    if (override) {
      // Python is installed: the server's own download starts now and takes over the card (it never shows as done).
      this.token = null
      this.current = null
      try {
        override.then()
      } catch (e) {
        this.current = {
          kind,
          state: 'failed',
          step: '',
          stepIndex: 0,
          stepCount: 0,
          percent: null,
          amount: '',
          line: '',
          error: errorText(e, 'The download couldn’t start. Try again.'),
          need: null,
          link: ''
        }
        this.deps.changed()
      }
      return
    }
    try {
      await this.deps.finished(kind, { gpu: result.gpu })
    } catch (e) {
      return this.fail(token, { error: errorText(e, 'The download couldn’t be finished. Try again.'), need: null, link: '' })
    }
    if (!this.set(token, { state: 'done', percent: 100, error: '', need: null, link: '' })) return
    const next = this.queue.shift()
    if (next) {
      void this.begin(next)
      return
    }
    this.doneTimer = setTimeout(() => {
      if (this.token === token && this.current?.state === 'done') {
        this.current = null
        this.deps.changed()
      }
    }, DONE_SHOWS_MS)
  }

  private fail(token: object, failure: Failure, at = ''): void {
    // What was waiting waits for Try again too (the voices and dictation need the server), and the problem stays in view.
    this.queue = []
    const kind = this.current?.kind
    if (!this.set(token, { state: 'failed', percent: null, error: failure.error, need: failure.need, link: failure.link })) return
    if (kind) this.deps.failed?.(kind, at)
  }
}
