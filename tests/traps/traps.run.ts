// The trap run, writing the story and comparing runs, each as one long Vitest "test", so the app's TypeScript and its
// import aliases run as they do in the unit tests. Only `npm run traps` and `npm run traps:write` run this
// (tests/traps/cli.mjs, with vitest.traps.config.ts): the normal `npm test` never picks up a *.run.ts file, and this
// does nothing unless TRAPS_RUN, TRAPS_WRITE or TRAPS_COMPARE is set.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { configFromEnv, runTraps } from './run'
import { CHAINS, chainProse, rescoreChain, runChains } from './chain'
import { promptText, proseMarkdown } from './prose'
import { chainsAsSummary, passagesMarkdown, reportMarkdown, summariseChains } from './score'
import { mkdirSync } from 'node:fs'
import { runWrite } from './write'
import { compareMarkdown, type ChainResult, type RunReport } from './score'

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

describe.runIf(!!process.env.TRAPS_RESCORE)('trap scores re-scored offline', () => {
  it('scores a chain run again with the checks as they are now, without a model', () => {
    const from = process.env.TRAPS_RESCORE!
    const out = process.env.TRAPS_OUT
    if (!out) throw new Error('Re-scoring needs --out, a folder of its own (the report it reads is never written over).')
    if (existsSync(join(out, 'report.json'))) throw new Error(`${out} already has a report; give another --out folder.`)
    const old = JSON.parse(readFileSync(join(from, 'report.json'), 'utf8')) as RunReport
    if (!old.chains) throw new Error(`${from} isn't a chain run (probes v4).`)
    const need: { chain: string; sample: number; step: number; plant: string; quote: string }[] = []
    // The writer's saved prompts (for the prose check's sample lines), read only from each chain's evidence world.
    const opened: Database.Database[] = []
    const prompts = (chain: string) => {
      const dbs = new Map<number, Database.Database | null>()
      return (sample: number, generationId: string): string | null => {
        if (!dbs.has(sample)) {
          const file = join(from, `evidence-${chain}-${sample + 1}.db`)
          const db = existsSync(file) ? new Database(file, { readonly: true, fileMustExist: true }) : null
          if (db) opened.push(db)
          dbs.set(sample, db)
        }
        const row = dbs.get(sample)?.prepare('SELECT messages_json AS m FROM generations WHERE id = ?').get(generationId) as { m: string } | undefined
        return row ? promptText(row.m) : null
      }
    }
    let chains: ChainResult[] = []
    try {
      chains = old.chains.map((c) => {
        const spec = CHAINS.find((x) => x.id === c.id)
        if (!spec) throw new Error(`No chain ${c.id} in this harness.`)
        const r = rescoreChain(c, spec, prompts(c.id))
        need.push(...r.needJudge.map((n) => ({ chain: c.id, ...n })))
        return r.result
      })
    } finally {
      for (const db of opened) db.close()
    }
    const report: RunReport = {
      ...old,
      chains,
      chainSummary: summariseChains(chains),
      summary: chainsAsSummary(chains),
      prose: chainProse(chains),
      rescored: { from, at: new Date().toISOString(), needJudge: need }
    }
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
    writeFileSync(join(out, 'report.md'), reportMarkdown(report))
    writeFileSync(join(out, 'passages.md'), passagesMarkdown(report))
    // Old against new, by plant.
    const a = old.chainSummary!.byPlant
    const b = report.chainSummary!.byPlant
    const lines = [`# Re-scored offline: ${old.tested.branch} @ ${old.tested.commit.slice(0, 9)}`, '', `From ${from}; the judge's saved answers reused, every deterministic check run again, nothing sent to a model.`, '']
    lines.push('| Plant | Kept (old → new) | Broken (old → new) | Not touched (old → new) | Ended on the page (old → new) |', '|---|---|---|---|---|')
    for (const id of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
      const x = a[id]
      const y = b[id]
      const f = (k: 'kept' | 'broken' | 'silent' | 'resolved'): string => `${x?.[k] ?? 0} → ${y?.[k] ?? 0}`
      lines.push(`| ${id} | ${f('kept')} | ${f('broken')} | ${f('silent')} | ${f('resolved')} |`)
    }
    lines.push('', need.length ? `Would need the judge (a slip a pattern found, where the judge would now be asked whether the change was on the page before it; counted as broken here):` : 'Nothing would need the judge.')
    for (const n of need) lines.push(`- ${n.chain} chain ${n.sample}, step ${n.step}, ${n.plant}${n.quote ? `: “${n.quote}”` : ' (newly in force, never asked)'}`)
    // The prose check's metrics, from the saved passages and prompts (the judge's marks only where a run saved them).
    lines.push('', ...proseMarkdown(report.prose))
    writeFileSync(join(out, 'rescore.md'), lines.join('\n') + '\n')
    console.log(lines.join('\n'))
  })
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
