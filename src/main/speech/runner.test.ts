import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { Step } from './plan'
import { StepRunner, type RunUpdate } from './runner'

const KEY = 'hf_RunnerTestKeyNeverShown0123456789'

/** Is process `pid` still running? (One that ended but wasn't collected yet, a zombie, has ended.) */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
  try {
    return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.[0] !== 'Z'
  } catch {
    return true
  }
}

/** A step that runs `code` in Node (the same as Python would: a program and its arguments). */
const nodeStep = (id: string, code: string, extra: Partial<Step> = {}): Step => ({
  id,
  label: `Step ${id}`,
  command: process.execPath,
  args: ['-e', code],
  progress: 'whole',
  fails: `Step ${id} didn’t finish. Try again.`,
  ...extra
})

function runner(steps: Step[]) {
  const updates: RunUpdate[] = []
  const log: string[] = []
  const r = new StepRunner({
    steps,
    cwd: tmpdir(),
    env: { PATH: process.env.PATH ?? '', HF_TOKEN_FROM_PARENT: '' },
    log: (t) => log.push(t),
    secrets: [KEY],
    onUpdate: (u) => updates.push(u),
    everyMs: 0
  })
  return { r, updates, log }
}

describe('running a download’s steps', () => {
  it('runs them in order and follows their progress', async () => {
    const { r, updates } = runner([
      nodeStep('one', `console.log('@@progress 50 100'); console.log('half way')`),
      nodeStep('two', `console.log('Progress 3 of 4'); console.log('Successfully installed fake-1.0')`, { progress: 'files' })
    ])
    expect(await r.run()).toEqual({ outcome: 'done', gpu: null })
    const one = updates.filter((u) => u.stepId === 'one')
    expect(one[0]).toMatchObject({ index: 1, count: 2 })
    expect(one.some((u) => u.percent === 50 && u.amount === '50 bytes of 100 bytes')).toBe(true)
    expect(one.at(-1)?.line).toBe('half way')
    const two = updates.filter((u) => u.stepId === 'two')
    expect(two[0]).toMatchObject({ index: 2, count: 2 })
    expect(two.at(-1)?.line).toBe('Successfully installed fake-1.0')
  })

  it('passes each step its own environment', async () => {
    const { r, updates } = runner([
      nodeStep('env', `console.log('home is ' + process.env.HF_HOME)`, { env: { HF_HOME: '/speech/models/hf' } })
    ])
    await r.run()
    expect(updates.at(-1)?.line).toBe('home is /speech/models/hf')
  })

  it('reports the graphics card the check found', async () => {
    const { r } = runner([nodeStep('check', `console.log('@@gpu NVIDIA GeForce RTX 4090')`)])
    expect(await r.run()).toEqual({ outcome: 'done', gpu: 'NVIDIA GeForce RTX 4090' })
  })

  it('never shows or logs the Hugging Face key, even when a step prints it', async () => {
    const { r, updates, log } = runner([
      nodeStep('weights', `console.log('Using ' + process.env.HF_TOKEN); console.error('Authorization: Bearer ' + process.env.HF_TOKEN)`, {
        env: { HF_TOKEN: KEY }
      })
    ])
    await r.run()
    expect(log.join('')).not.toContain(KEY)
    expect(log.join('')).toContain('Using ••••')
    expect(JSON.stringify(updates)).not.toContain(KEY)
  })

  it('stops at the first step that fails, in plain words', async () => {
    const { r } = runner([
      nodeStep(
        'bad',
        `console.log('Traceback (most recent call last):'); console.log('@@error Breeze’s code didn’t download. Try again.'); process.exit(1)`
      ),
      nodeStep('never', `console.log('should not run')`)
    ])
    expect(await r.run()).toEqual({
      outcome: 'failed',
      failure: { error: 'Breeze’s code didn’t download. Try again.', need: null, link: '' }
    })
  })

  it('falls back to the step’s own sentence when the program says nothing useful', async () => {
    const { r } = runner([nodeStep('quiet', `process.exit(2)`)])
    expect(await r.run()).toEqual({ outcome: 'failed', failure: { error: 'Step quiet didn’t finish. Try again.', need: null, link: '' } })
  })

  it('says so when a program can’t start at all', async () => {
    const { r, log } = runner([{ ...nodeStep('missing', ''), command: '/no/such/python' }])
    const result = await r.run()
    expect(result.outcome).toBe('failed')
    expect(result.outcome === 'failed' && result.failure.error).toMatch(/couldn’t run Python for this step/)
    expect(log.join('')).toContain('Could not start /no/such/python')
  })

  it('links where to get it by hand when a step that can be done by hand fails (Python, from python.org)', async () => {
    const byHand = 'https://www.python.org/downloads/'
    const failed = await runner([nodeStep('python', `process.exit(1)`, { byHand })]).r.run()
    expect(failed).toEqual({
      outcome: 'failed',
      failure: { error: 'Step python didn’t finish. Try again.', need: 'python-manual', link: byHand }
    })
    const missing = await runner([{ ...nodeStep('python', '', { byHand }), command: '/no/such/winget' }]).r.run()
    expect(missing).toMatchObject({ outcome: 'failed', failure: { need: 'python-manual', link: byHand } })
    expect(missing.outcome === 'failed' && missing.failure.error).toMatch(/Windows’ installer couldn’t be started/)
    // A problem with a fix of its own keeps it.
    const licence = await runner([
      nodeStep('python', `console.log('@@licence https://huggingface.co/x'); process.exit(3)`, { byHand })
    ]).r.run()
    expect(licence).toMatchObject({ outcome: 'failed', failure: { need: 'licence', link: 'https://huggingface.co/x' } })
  })

  it('ends a step at Cancel, with everything it started', async () => {
    const { r, updates } = runner([
      nodeStep(
        'slow',
        `const c = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); console.log('started ' + c.pid); setInterval(() => {}, 1000)`
      ),
      nodeStep('after', `console.log('should not run')`)
    ])
    const done = r.run()
    let started: RunUpdate | undefined
    while (!(started = updates.find((u) => u.line.startsWith('started ')))) await new Promise((res) => setTimeout(res, 20))
    const grandchild = Number(started.line.split(' ')[1])
    expect(alive(grandchild)).toBe(true)
    r.cancel()
    expect(await done).toEqual({ outcome: 'cancelled' })
    expect(updates.some((u) => u.stepId === 'after')).toBe(false)
    for (let i = 0; i < 50 && alive(grandchild); i++) await new Promise((res) => setTimeout(res, 20))
    expect(alive(grandchild)).toBe(false)
  })
})
