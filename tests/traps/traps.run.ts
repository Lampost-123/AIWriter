// The trap run, as one long Vitest "test", so the app's TypeScript and its import aliases run as they do in the unit
// tests. Only `npm run traps` runs it (tests/traps/cli.mjs, with vitest.traps.config.ts): the normal `npm test`
// never picks up a *.run.ts file, and this does nothing unless TRAPS_RUN or TRAPS_COMPARE is set.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { configFromEnv, runTraps } from './run'
import { compareMarkdown, type RunReport } from './score'

describe.runIf(process.env.TRAPS_RUN === '1')('trap story', () => {
  it(
    'writes at every probe and scores it',
    async () => {
      const { report } = await runTraps(configFromEnv())
      expect(report.probes.length).toBeGreaterThan(0)
    },
    6 * 60 * 60_000
  )
})

describe.runIf(!!process.env.TRAPS_COMPARE)('trap scores compared', () => {
  it('puts two runs side by side', () => {
    const [a, b] = (process.env.TRAPS_COMPARE ?? '').split('|').map((p) => {
      const file = p.endsWith('.json') ? p : join(p, 'report.json')
      return { file, report: JSON.parse(readFileSync(file, 'utf8')) as RunReport }
    })
    const md = compareMarkdown(a.report, b.report)
    const out = join(dirname(b.file), `compare-with-${a.report.tested.commit.slice(0, 7)}.md`)
    writeFileSync(out, md)
    console.log(`${md}\n(written to ${out})`)
  })
})
