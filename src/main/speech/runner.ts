// Adapted from mcreader-v2, src/server/speech/install.ts (installStep: run one step, feed its output to the
// status Settings shows, Cancel ends the step's process) (Adam's rule, 2 October 2026: only speech code is
// reused).
//
// Runs a download's steps one after another, each a program with an argument list (never a shell). Every
// line it prints goes to install.log and to Settings with the Hugging Face key hidden; the bar follows
// its progress. No Electron here.
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { explainFailure, LineSplitter, parseLine, scrub, StepProgress, type Failure, type OutputEvent } from './output'
import type { Step } from './plan'
import { killTree, ownGroup } from './processes'

/** What Settings hears about the step running: never the step's environment (the Hugging Face key is there). */
export interface RunUpdate {
  /** The step's id and its label in plain words. */
  stepId: string
  label: string
  /** From 1. */
  index: number
  count: number
  percent: number | null
  amount: string
  line: string
}

export type RunResult = { outcome: 'done'; gpu: string | null } | { outcome: 'cancelled' } | { outcome: 'failed'; failure: Failure }

export interface RunOptions {
  steps: Step[]
  /** The environment every step starts from (each step adds its own). */
  env: Record<string, string>
  /** The folder the steps run in. */
  cwd: string
  /** Appends to install.log; what it gets is already scrubbed. */
  log: (text: string) => void
  /** Hidden in every line shown or logged (the Hugging Face key). */
  secrets: string[]
  onUpdate: (u: RunUpdate) => void
  platform?: NodeJS.Platform
  spawn?: typeof nodeSpawn
  /** How often Settings hears about progress, at most (ms). */
  everyMs?: number
}

export class StepRunner {
  private child: ChildProcess | null = null
  private cancelled = false
  private readonly platform: NodeJS.Platform

  constructor(private readonly opts: RunOptions) {
    this.platform = opts.platform ?? process.platform
  }

  /** Stops the step running (and everything it started); the run then ends as 'cancelled'. */
  cancel(): void {
    this.cancelled = true
    if (this.child) killTree(this.child, this.platform)
  }

  get isCancelled(): boolean {
    return this.cancelled
  }

  async run(): Promise<RunResult> {
    let gpu: string | null = null
    const { steps } = this.opts
    for (let i = 0; i < steps.length; i++) {
      if (this.cancelled) return { outcome: 'cancelled' }
      const result = await this.runStep(steps[i], i + 1, steps.length)
      if (this.cancelled) return { outcome: 'cancelled' }
      if (result.failure) return { outcome: 'failed', failure: result.failure }
      if (result.gpu !== null) gpu = result.gpu
    }
    return { outcome: 'done', gpu }
  }

  private runStep(step: Step, index: number, count: number): Promise<{ failure: Failure | null; gpu: string | null }> {
    const { opts } = this
    const progress = new StepProgress(step.progress, step.expect ?? 0)
    const recent: string[] = []
    let line = ''
    let gpu: string | null = null
    let last = 0
    const report = (force = false): void => {
      const now = Date.now()
      if (!force && now - last < (opts.everyMs ?? 150)) return
      last = now
      opts.onUpdate({ stepId: step.id, label: step.label, index, count, percent: progress.percent, amount: progress.amount, line })
    }
    const take = (raw: string): void => {
      const text = scrub(raw, opts.secrets)
      if (text.trim()) opts.log(`${text}\n`)
      const ev = parseLine(text)
      if (!ev) return
      const kept = forExplaining(ev)
      if (kept !== null) {
        recent.push(kept)
        if (recent.length > 80) recent.shift()
      }
      if (ev.kind === 'line') line = ev.text
      if (ev.kind === 'file') line = `Downloading ${ev.name}`
      if (ev.kind === 'error') line = ev.message
      if (ev.kind === 'gpu') gpu = ev.name
      progress.take(ev)
      report()
    }

    opts.log(`\n== ${new Date().toISOString()} · ${step.label} (${step.id})\n`)
    report(true)
    return new Promise((resolve) => {
      let child: ChildProcess
      try {
        child = (opts.spawn ?? nodeSpawn)(step.command, step.args, {
          cwd: opts.cwd,
          env: { ...opts.env, ...step.env },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          detached: ownGroup(this.platform),
          shell: false
        })
      } catch (e) {
        opts.log(`Could not start ${step.command}: ${e instanceof Error ? e.message : String(e)}\n`)
        resolve({ failure: orByHand(step, { error: cantStart(step), need: null, link: '' }), gpu })
        return
      }
      this.child = child
      const out = new LineSplitter()
      const err = new LineSplitter()
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => out.push(chunk).forEach(take))
      child.stderr?.on('data', (chunk: string) => err.push(chunk).forEach(take))
      let settled = false
      const finish = (code: number | null, spawnError?: Error): void => {
        if (settled) return
        settled = true
        out.flush().forEach(take)
        err.flush().forEach(take)
        this.child = null
        report(true)
        if (this.cancelled) return resolve({ failure: null, gpu })
        if (spawnError) {
          opts.log(`Could not start ${step.command}: ${spawnError.message}\n`)
          return resolve({ failure: orByHand(step, { error: cantStart(step), need: null, link: '' }), gpu })
        }
        opts.log(`(exit ${code})\n`)
        if (code === 0) return resolve({ failure: null, gpu })
        resolve({ failure: orByHand(step, explainFailure(recent, step.fails, this.platform)), gpu })
      }
      child.on('error', (e) => finish(null, e))
      child.on('close', (code) => finish(code))
      if (this.cancelled) killTree(child, this.platform)
    })
  }
}

/** What a failure is worked out from (explainFailure): the lines a step printed, and what it said in its own words. */
function forExplaining(ev: OutputEvent): string | null {
  if (ev.kind === 'line') return ev.text
  if (ev.kind === 'error') return `@@error ${ev.message}`
  if (ev.kind === 'licence') return `@@licence ${ev.url}`
  if (ev.kind === 'key') return '@@key'
  return null
}

/** A failed step that can be done by hand instead (Python, from python.org) links where, unless its problem has a fix of its own. */
function orByHand(step: Step, failure: Failure): Failure {
  return step.byHand && !failure.need ? { ...failure, need: 'python-manual', link: step.byHand } : failure
}

/** A step whose program couldn't even start. */
function cantStart(step: Step): string {
  return step.id === 'python'
    ? 'Windows’ installer couldn’t be started. Install Python 3.13 from python.org, then Try again.'
    : 'AI Write couldn’t run Python for this step (antivirus sometimes holds it for a moment). Try again.'
}
