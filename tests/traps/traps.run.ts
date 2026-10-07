// The trap run, writing the story and comparing runs, each as one long Vitest "test", so the app's TypeScript and its
// import aliases run as they do in the unit tests. Only `npm run traps` and `npm run traps:write` run this
// (tests/traps/cli.mjs, with vitest.traps.config.ts): the normal `npm test` never picks up a *.run.ts file, and this
// does nothing unless TRAPS_RUN, TRAPS_WRITE or TRAPS_COMPARE is set.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { configFromEnv, runTraps } from './run'
import { runChains } from './chain'
import { runWrite } from './write'
import { compareMarkdown, type RunReport } from './score'

const SIX_HOURS = 6 * 60 * 60_000

describe.runIf(process.env.TRAPS_RUN === '1')('trap story', () => {
  it(
    'writes at every probe and scores it',
    async () => {
      const cfg = configFromEnv()
      // Probes v4 (chains) unless --probes-version 3 or the hand-written story asks for one passage per probe.
      const { report } = cfg.probesVersion === 4 ? await runChains(cfg) : await runTraps(cfg)
      expect(report.probes.length + (report.chains?.length ?? 0)).toBeGreaterThan(0)
    },
    SIX_HOURS
  )
})

describe.runIf(process.env.TRAPS_WRITE === '1')('writing the trap story', () => {
  it(
    'writes every scene, with its planted events',
    async () => {
      const { fixture } = await runWrite(configFromEnv())
      expect(fixture.complete).toBe(true)
    },
    SIX_HOURS
  )
})

describe.runIf(!!process.env.TRAPS_COMPARE)('trap scores compared', () => {
  it('puts two runs side by side', () => {
    const [a, b] = (process.env.TRAPS_COMPARE ?? '').split('|').map((p) => {
      const file = p.endsWith('.json') ? p : join(p, 'report.json')
      return { file, report: JSON.parse(readFileSync(file, 'utf8')) as RunReport }
    })
    const md = compareMarkdown(a.report, b.report)
    // Never written over: a second comparison gets a number.
    const base = join(dirname(b.file), `compare-with-${a.report.tested.commit.slice(0, 7)}`)
    let out = `${base}.md`
    for (let n = 2; existsSync(out); n++) out = `${base}-${n}.md`
    writeFileSync(out, md)
    console.log(`${md}\n(written to ${out})`)
  })
})
